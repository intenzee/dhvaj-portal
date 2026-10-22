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
-- so every role gets one — the support roles (accountant, hr, admin) at
-- article grade, below the manager grade any engagement-lead picker needs.
--
-- hsdg.sync_employee_from_roles(user) closes the gap. For an active user it
-- takes the highest grade their roles imply (managing_partner/partner →
-- partner, manager, senior; article, accountant, hr, admin → article) and:
--   · links the one unlinked employee with exactly the same name, else
--     creates one (today's date, the user's office, code U + id prefix);
--   · raises a linked employee's grade to what the roles imply. Never
--     lowers it: a demotion is an HR decision made in People.
-- Partner grade also gets its (empty) partner profile. Runs as the caller,
-- so RLS still decides who may write employees (firm-wide or people ops).
-- The API calls it whenever a user's roles are set; this migration runs it
-- once for everyone already in the firm.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

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
  match_count integer;
BEGIN
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
         WHEN 'accountant' THEN 'article'
         WHEN 'hr' THEN 'article'
         WHEN 'admin' THEN 'article'
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

  IF emp_id IS NULL THEN
    SELECT count(*) INTO match_count
    FROM hsdg.employees e
    WHERE e.user_id IS NULL
      AND e.employment_status <> 'exited'
      AND lower(btrim(e.full_name)) = lower(btrim(u.display_name));

    IF match_count = 1 THEN
      UPDATE hsdg.employees e SET user_id = p_user
      WHERE e.user_id IS NULL
        AND e.employment_status <> 'exited'
        AND lower(btrim(e.full_name)) = lower(btrim(u.display_name))
      RETURNING e.id INTO emp_id;
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

-- The backfilled employees stay: they may already be on engagements.
DROP FUNCTION IF EXISTS hsdg.sync_employee_from_roles(uuid);
