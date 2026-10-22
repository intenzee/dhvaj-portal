-- ─────────────────────────────────────────────────────────────────────────
-- A staff role brings an employee record with it
--
-- Administration → Users creates a portal login and its roles; Administration
-- → People creates the employee (grade, office). Nothing tied the two, so a
-- user given the Partner or Manager role had no employee row and never
-- appeared as an Engagement Partner / Manager: those pickers, the
-- engagements FKs and enforce_engagement_grades() all read employee grade.
--
-- Filing work, time and task actions also need an employee (ctx_employee_id),
-- so every role gets one. The support roles (accountant, hr, admin) get a new
-- Staff grade: not Article, which the HR desk counts as articled trainees
-- (articleship register, stipend, "articleship completes"), and ranked below
-- every professional grade, so never in an engagement-lead picker.
--
-- hsdg.sync_employee_from_roles(user) closes the gap. For an active user it
-- takes the highest grade their roles imply (managing_partner/partner →
-- partner, manager, senior, article; accountant, hr, admin → staff) and:
--   · links the one unlinked, non-partner employee with exactly the same
--     name, else creates one (today's date, the user's office, code U + id
--     prefix);
--   · raises a linked employee's grade to what the roles imply. Never
--     lowers it: a demotion is an HR decision made in People.
-- Partner grade also gets its (empty) partner profile. Runs as the caller,
-- so RLS and employees_login_link_guard (1772630000000) still decide who may
-- write employees. When they refuse (HR's own login, a login above HR's
-- ceiling), the sync is skipped rather than failing the login change: an
-- administrator links that record in People.
-- The API calls it whenever a user's roles are set; this migration runs it
-- once for everyone already in the firm.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- grades is ENABLE (not FORCE) row security since 1756400000000, so the
-- migrator, as owner, can add the row.
INSERT INTO hsdg.grades (slug, name, rank, is_partner_grade)
VALUES ('staff', 'Staff', 20, false)
ON CONFLICT (slug) DO NOTHING;

CREATE FUNCTION hsdg.sync_employee_from_roles(p_user uuid)
RETURNS TABLE (employee_id uuid, action text)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  u        hsdg.users%ROWTYPE;
  want_grade  hsdg.grades%ROWTYPE;
  emp_id      uuid;
  emp_rank    integer;
  match_id    uuid;
  match_count integer;
BEGIN
  -- Your own record is HR's to leave alone (the login-link guard says so too).
  IF p_user = hsdg.ctx_user_id() AND NOT hsdg.ctx_is_firmwide() THEN
    RETURN;
  END IF;

  SELECT * INTO u FROM hsdg.users WHERE id = p_user;
  IF NOT FOUND OR NOT u.is_active THEN
    RETURN;
  END IF;

  SELECT g.* INTO want_grade
  FROM hsdg.user_roles ur
  JOIN hsdg.roles r ON r.id = ur.role_id
  JOIN hsdg.grades g ON g.slug = CASE r.slug
         WHEN 'managing_partner' THEN 'partner'
         WHEN 'partner' THEN 'partner'
         WHEN 'manager' THEN 'manager'
         WHEN 'senior' THEN 'senior'
         WHEN 'article' THEN 'article'
         WHEN 'accountant' THEN 'staff'
         WHEN 'hr' THEN 'staff'
         WHEN 'admin' THEN 'staff'
       END
  WHERE ur.user_id = p_user
  ORDER BY g.rank DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN; -- no roles yet.
  END IF;

  SELECT e.id, g.rank INTO emp_id, emp_rank
  FROM hsdg.employees e JOIN hsdg.grades g ON g.id = e.grade_id
  WHERE e.user_id = p_user;

  BEGIN
    IF emp_id IS NULL THEN
      -- A partner's record never takes a login this way: that is an
      -- administrator's call in People.
      SELECT count(*), min(e.id::text)::uuid INTO match_count, match_id
      FROM hsdg.employees e
      WHERE e.user_id IS NULL
        AND e.employment_status <> 'exited'
        AND lower(btrim(e.full_name)) = lower(btrim(u.display_name))
        AND NOT hsdg.employee_is_partner(e.id);

      IF match_count = 1 THEN
        UPDATE hsdg.employees e SET user_id = p_user WHERE e.id = match_id;
        emp_id := match_id;
        SELECT g.rank INTO emp_rank
        FROM hsdg.employees e JOIN hsdg.grades g ON g.id = e.grade_id
        WHERE e.id = emp_id;
        action := 'linked';
      ELSE
        INSERT INTO hsdg.employees
          (employee_code, full_name, user_id, grade_id, primary_office_id,
           employment_status, date_of_joining)
        VALUES
          ('U' || upper(substr(replace(p_user::text, '-', ''), 1, 12)),
           u.display_name, p_user, want_grade.id, u.primary_office_id,
           'active', current_date)
        RETURNING id INTO emp_id;
        emp_rank := want_grade.rank;
        action := 'created';
      END IF;
    END IF;

    IF emp_rank < want_grade.rank THEN
      UPDATE hsdg.employees SET grade_id = want_grade.id, version = version + 1
      WHERE id = emp_id;
      action := COALESCE(action || '+', '') || 'promoted';
    END IF;

    IF want_grade.is_partner_grade AND action IS NOT NULL THEN
      INSERT INTO hsdg.partner_profiles (employee_id) VALUES (emp_id)
      ON CONFLICT (employee_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    -- RLS or the login-link guard refused this caller: leave it to an
    -- administrator instead of failing the login change.
    RETURN;
  END;

  IF action IS NOT NULL THEN
    employee_id := emp_id;
    RETURN NEXT;
  END IF;
END $$;
REVOKE ALL ON FUNCTION hsdg.sync_employee_from_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.sync_employee_from_roles(uuid) TO hsdg_app;

-- Backfill everyone already in the firm. partner_profiles forces RLS, so act
-- as the system for this transaction only.
SELECT set_config('hsdg.role', 'system', true);
SELECT hsdg.sync_employee_from_roles(u.id) FROM hsdg.users u WHERE u.is_active;
SELECT set_config('hsdg.role', '', true);

-- Down Migration

-- The backfilled employees stay: they may already be on engagements, and
-- keep the Staff grade they were given.
DROP FUNCTION IF EXISTS hsdg.sync_employee_from_roles(uuid);
