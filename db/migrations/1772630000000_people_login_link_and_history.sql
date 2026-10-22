-- ─────────────────────────────────────────────────────────────────────────
-- HR role · the login ceiling on the employee master, and each record's
-- history (spec docs/accountant-hr-roles-spec.md §4.3, §4.4, §4.5, §7.5).
--
-- 1. employees.user_id is what makes a login act as an employee: the request
--    context's employee id — and with it every engagement, task and working
--    paper that person is on — comes from it. HR keeps the employee master, so
--    without this rule HR could point a partner's employee record at a login
--    HR controls (a Manager login HR just created and gave a temporary
--    password) and so reach that partner's client work, or unlink their own
--    record. HR may link or unlink a login only within the same ceiling as
--    every other login change (hsdg.ctx_may_onboard_user: someone else, holding
--    nothing above Manager). Firm-wide roles (Managing Partner, Administrator,
--    system) are unchanged.
--
-- 2. employee_history(employee) — the change history HR sees on an employee's
--    record (§4.3: "HR sees the history of each employee record on that
--    record"; the firm-wide audit log stays with the MP and the Administrator).
--    It returns the audit events about that person only: their employee
--    record (including exit, HR documents and the payroll events recorded
--    against the employee), their articleships, and their login — not sign-in
--    noise. HR and the Managing Partner only. audit_events is FORCE RLS and its
--    select policy is firm-wide only, so the function reads it through a
--    migrator-only policy that is live only while hsdg.people_history = 'on',
--    which it sets for its own query and clears before returning (the pattern
--    of 1772600000000_people_desk). No other function sets that flag.
--
-- Needs 1772400000000 (ctx_is_people_ops, ctx_may_onboard_user) and
-- 1772600000000 (ctx_reads_people).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Linking a login to an employee record ────────────────────────────
-- A partner's record is above the ceiling whichever login it carries: one with
-- no login yet must not take a login HR controls. Engagements are not HR's to
-- read, hence SECURITY DEFINER; partner_profiles is, but HR can also edit it,
-- so leading an engagement counts on its own.
CREATE FUNCTION hsdg.employee_is_partner(p_employee_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM hsdg.partner_profiles pp WHERE pp.employee_id = p_employee_id)
      OR EXISTS (SELECT 1 FROM hsdg.engagements e WHERE e.engagement_partner_id = p_employee_id);
$$;
REVOKE ALL ON FUNCTION hsdg.employee_is_partner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.employee_is_partner(uuid) TO hsdg_app;

CREATE FUNCTION hsdg.employees_login_link_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  -- Only the HR path is held to the ceiling; firm-wide roles keep user.manage.
  IF hsdg.ctx_is_firmwide() OR NOT hsdg.ctx_is_people_ops() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.user_id IS NOT NULL AND NOT hsdg.ctx_may_onboard_user(OLD.user_id))
     OR (NEW.user_id IS NOT NULL AND NOT hsdg.ctx_may_onboard_user(NEW.user_id))
     OR (TG_OP = 'UPDATE' AND hsdg.employee_is_partner(NEW.id)) THEN
    RAISE EXCEPTION 'Linking or unlinking your own login, or one above Manager, is for an administrator.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER employees_login_link_guard
  BEFORE INSERT OR UPDATE OF user_id ON hsdg.employees
  FOR EACH ROW EXECUTE FUNCTION hsdg.employees_login_link_guard();

-- ── 2. An employee record's history ─────────────────────────────────────
CREATE POLICY audit_events_people_history ON hsdg.audit_events
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.people_history', true) = 'on');

CREATE FUNCTION hsdg.employee_history(p_employee_id uuid, p_limit integer DEFAULT 200)
  RETURNS TABLE (
    id            uuid,
    occurred_at   timestamptz,
    actor_user_id uuid,
    actor_name    text,
    actor_role    text,
    action        text,
    object_type   text,
    object_id     text,
    before_state  jsonb,
    after_state   jsonb,
    reason        text
  )
  -- VOLATILE: it sets (and clears) the hsdg.people_history flag.
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT hsdg.ctx_reads_people() THEN
    RAISE EXCEPTION 'Only HR or the Managing Partner can see an employee''s history.'
      USING ERRCODE = '42501';
  END IF;
  -- The employee master is read under the caller's own policies.
  SELECT e.user_id INTO v_user FROM hsdg.employees e WHERE e.id = p_employee_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM set_config('hsdg.people_history', 'on', true);
  RETURN QUERY
    SELECT a.id, a.occurred_at, a.actor_user_id, u.display_name::text, a.actor_role,
           a.action, a.object_type, a.object_id, a.before_state, a.after_state, a.reason
      FROM hsdg.audit_events a
      LEFT JOIN hsdg.users u ON u.id = a.actor_user_id
     WHERE (a.object_type = 'employee' AND a.object_id = p_employee_id::text)
        OR (a.object_type = 'articleship' AND a.object_id IN (
              SELECT ar.id::text FROM hsdg.articleships ar WHERE ar.employee_id = p_employee_id))
        OR (v_user IS NOT NULL AND a.object_type = 'user' AND a.object_id = v_user::text
            AND (a.action NOT LIKE 'auth.%'
                 OR a.action IN ('auth.password_changed', 'auth.password_locked')))
     ORDER BY a.occurred_at DESC, a.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  PERFORM set_config('hsdg.people_history', '', true);
END;
$$;
REVOKE ALL ON FUNCTION hsdg.employee_history(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.employee_history(uuid, integer) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.employee_history(uuid, integer);
DROP POLICY IF EXISTS audit_events_people_history ON hsdg.audit_events;
DROP TRIGGER IF EXISTS employees_login_link_guard ON hsdg.employees;
DROP FUNCTION IF EXISTS hsdg.employees_login_link_guard();
DROP FUNCTION IF EXISTS hsdg.employee_is_partner(uuid);
