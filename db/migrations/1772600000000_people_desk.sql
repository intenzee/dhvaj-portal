-- ─────────────────────────────────────────────────────────────────────────
-- HR role · the People desk (spec docs/accountant-hr-roles-spec.md §4.4, §7.3).
--
-- HR runs the firm's people but never its client work: no engagement, client
-- or task row reaches them through RLS (they hold none of the 67 role-keyed
-- policies). What the desk needs is numbers about people, so it reads three
-- SECURITY DEFINER functions that return per-person figures and nothing that
-- names a client, an engagement or a task:
--
--   attendance_by_day(from, to) — per employee per IST day: first start, last
--       stop, whether a timer is running, and seconds by kind (work / review /
--       other) and by "other time" category. No engagement id, no note. HR and
--       the Managing Partner see everyone; anyone else sees only their own.
--   people_workload(week_start) — per employee: active engagements by role
--       (as partner / manager / team), open and overdue tasks, and hours this
--       week. Counts only. HR and the Managing Partner only.
--   people_login_flags() — per user with a portal password: temporary or not,
--       when it was set, locked or not. Never a hash. HR and the Managing
--       Partner only (the administrator has GET /user-passwords already).
--   leaver_reassign_partners(employee) — who to ask to reassign a leaver's
--       work: the engagement partners on their active engagements, and their
--       reporting manager. Ids only, for the employee_exit_reassign
--       notification (added to notifications_type_check here).
--
-- ctx_reads_people() — HR or the Managing Partner; the gate the functions and
-- the HR tables (articleship register, HR documents vault) use.
--
-- The tables these read (engagement_time_entries, engagements, tasks) are
-- FORCE RLS, so even their owner, which runs the functions, is held to the
-- caller's policies. Each gets a migrator-only SELECT policy that is live only
-- while hsdg.people_read = 'on' — which these functions set for their own
-- query and clear before returning. So no other function sees more rows.
-- Checked on the schema (Oct 2026): the SECURITY DEFINER functions that read
-- those tables today — can_access_entity_via_engagement,
-- can_manage_entity_compliance, can_read_entity_compliance,
-- client_upload_link_info, ctx_may_bill_engagement, ctx_on_entity_team,
-- fee_waiver_request_guard, record_engagement_registration,
-- shares_engagement_with — never set the flag, so they are unchanged.
--
-- Needs phase 0 (1772400000000_accountant_hr_roles): hsdg.ctx_is_people_ops().
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE POLICY engagement_time_entries_people_read ON hsdg.engagement_time_entries
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.people_read', true) = 'on');
CREATE POLICY engagements_people_read ON hsdg.engagements
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.people_read', true) = 'on');
CREATE POLICY tasks_people_read ON hsdg.tasks
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.people_read', true) = 'on');

-- HR or the Managing Partner: the people-wide readers.
CREATE FUNCTION hsdg.ctx_reads_people() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_people_ops() OR hsdg.ctx_role() = 'managing_partner'
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_reads_people() TO hsdg_app;

CREATE FUNCTION hsdg.attendance_by_day(p_from date, p_to date)
  RETURNS TABLE (
    employee_id      uuid,
    day              date,
    first_start      timestamptz,
    last_stop        timestamptz,
    running          boolean,
    total_seconds    integer,
    work_seconds     integer,
    review_seconds   integer,
    other_seconds    integer,
    category_seconds jsonb
  )
  -- VOLATILE: it sets (and clears) the hsdg.people_read flag.
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  everyone boolean := hsdg.ctx_reads_people();
  me uuid := hsdg.ctx_employee_id();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Give a from date on or before the to date.' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Attendance covers at most 93 days at a time.' USING ERRCODE = '22023';
  END IF;
  IF NOT everyone AND me IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('hsdg.people_read', 'on', true);
  RETURN QUERY
    WITH t AS (
      SELECT te.employee_id,
             (te.started_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
             te.started_at, te.ended_at, te.entry_kind, te.category,
             COALESCE(te.duration_seconds,
                      GREATEST(0, EXTRACT(EPOCH FROM now() - te.started_at))::integer) AS secs
        FROM hsdg.effective_time_entries te
       WHERE (te.started_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
         AND (everyone OR te.employee_id = me)
    ), cat AS (
      SELECT t.employee_id, t.day, jsonb_object_agg(t.category, t.s) AS by_cat
        FROM (SELECT t.employee_id, t.day, t.category, sum(t.secs)::integer AS s
                FROM t WHERE t.entry_kind = 'other' GROUP BY 1, 2, 3) t
       GROUP BY 1, 2
    )
    SELECT t.employee_id, t.day,
           min(t.started_at), max(t.ended_at),
           bool_or(t.ended_at IS NULL),
           sum(t.secs)::integer,
           (sum(t.secs) FILTER (WHERE t.entry_kind = 'work'))::integer,
           (sum(t.secs) FILTER (WHERE t.entry_kind = 'review'))::integer,
           (sum(t.secs) FILTER (WHERE t.entry_kind = 'other'))::integer,
           COALESCE(c.by_cat, '{}'::jsonb)
      FROM t
      LEFT JOIN cat c ON c.employee_id = t.employee_id AND c.day = t.day
     GROUP BY t.employee_id, t.day, c.by_cat
     ORDER BY t.day, t.employee_id;
  PERFORM set_config('hsdg.people_read', '', true);
END;
$$;
REVOKE ALL ON FUNCTION hsdg.attendance_by_day(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.attendance_by_day(date, date) TO hsdg_app;

CREATE FUNCTION hsdg.people_workload(p_week_start date)
  RETURNS TABLE (
    employee_id        uuid,
    as_partner         integer,
    as_manager         integer,
    as_team            integer,
    active_engagements integer,
    open_tasks         integer,
    overdue_tasks      integer,
    week_seconds       integer
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT hsdg.ctx_reads_people() THEN
    RAISE EXCEPTION 'Only HR or the Managing Partner can see the firm''s workload.'
      USING ERRCODE = '42501';
  END IF;
  IF p_week_start IS NULL THEN
    RAISE EXCEPTION 'Give the week''s first day.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('hsdg.people_read', 'on', true);
  RETURN QUERY
    WITH acc AS (
      SELECT a.employee_id,
             count(DISTINCT a.engagement_id) FILTER (WHERE a.source = 'partner') AS p,
             count(DISTINCT a.engagement_id) FILTER (WHERE a.source = 'manager') AS m,
             count(DISTINCT a.engagement_id) FILTER (WHERE a.source = 'team') AS t,
             count(DISTINCT a.engagement_id) AS n
        FROM hsdg.engagement_access a
        JOIN hsdg.engagements e ON e.id = a.engagement_id AND e.status = 'active'
       GROUP BY a.employee_id
    ), tk AS (
      SELECT k.assigned_to_employee_id AS employee_id,
             count(*) AS open,
             count(*) FILTER (WHERE k.due_date < today) AS overdue
        FROM hsdg.tasks k
       WHERE k.assigned_to_employee_id IS NOT NULL
         AND k.status NOT IN ('done', 'cancelled')
       GROUP BY 1
    ), wk AS (
      SELECT te.employee_id,
             sum(COALESCE(te.duration_seconds,
                          GREATEST(0, EXTRACT(EPOCH FROM now() - te.started_at))::integer)) AS s
        FROM hsdg.effective_time_entries te
       WHERE (te.started_at AT TIME ZONE 'Asia/Kolkata')::date
             BETWEEN p_week_start AND p_week_start + 6
       GROUP BY 1
    )
    SELECT emp.id,
           COALESCE(acc.p, 0)::integer, COALESCE(acc.m, 0)::integer, COALESCE(acc.t, 0)::integer,
           COALESCE(acc.n, 0)::integer,
           COALESCE(tk.open, 0)::integer, COALESCE(tk.overdue, 0)::integer,
           COALESCE(wk.s, 0)::integer
      FROM hsdg.employees emp
      LEFT JOIN acc ON acc.employee_id = emp.id
      LEFT JOIN tk ON tk.employee_id = emp.id
      LEFT JOIN wk ON wk.employee_id = emp.id
     WHERE emp.employment_status <> 'exited';
  PERFORM set_config('hsdg.people_read', '', true);
END;
$$;
REVOKE ALL ON FUNCTION hsdg.people_workload(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.people_workload(date) TO hsdg_app;

CREATE FUNCTION hsdg.people_login_flags()
  RETURNS TABLE (
    user_id     uuid,
    must_change boolean,
    set_at      timestamptz,
    locked      boolean
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_reads_people() THEN
    RAISE EXCEPTION 'Only HR or the Managing Partner can see login flags.'
      USING ERRCODE = '42501';
  END IF;
  -- user_passwords has its own owner policy; no flag needed.
  RETURN QUERY
    SELECT p.user_id, p.must_change, p.changed_at,
           (p.locked_until IS NOT NULL AND p.locked_until > now())
      FROM hsdg.user_passwords p;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.people_login_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.people_login_flags() TO hsdg_app;

-- The partners to ask when someone leaves: the engagement partner of every
-- active engagement the person works on (as manager or team), and their
-- reporting partner. Employee ids only — which engagements stays unsaid.
CREATE FUNCTION hsdg.leaver_reassign_partners(p_employee_id uuid)
  RETURNS TABLE (employee_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_reads_people() THEN
    RAISE EXCEPTION 'Only HR or the Managing Partner can start an exit.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('hsdg.people_read', 'on', true);
  RETURN QUERY
    SELECT DISTINCT e.engagement_partner_id
      FROM hsdg.engagement_access a
      JOIN hsdg.engagements e ON e.id = a.engagement_id AND e.status = 'active'
     WHERE a.employee_id = p_employee_id
       AND e.engagement_partner_id IS NOT NULL
       AND e.engagement_partner_id <> p_employee_id
    UNION
    SELECT emp.reports_to_id FROM hsdg.employees emp
     WHERE emp.id = p_employee_id AND emp.reports_to_id IS NOT NULL;
  PERFORM set_config('hsdg.people_read', '', true);
END;
$$;
REVOKE ALL ON FUNCTION hsdg.leaver_reassign_partners(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.leaver_reassign_partners(uuid) TO hsdg_app;

-- Notification type employee_exit_reassign. The type list is rebuilt from
-- whatever it holds now (other tracks add types in parallel), plus ours.
DO $$
DECLARE
  types text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO types
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
   WHERE c.conrelid = 'hsdg.notifications'::regclass AND c.conname = 'notifications_type_check';
  types := array_append(array_remove(types, 'employee_exit_reassign'), 'employee_exit_reassign');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type = 'employee_exit_reassign';
DO $$
DECLARE
  types text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO types
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
   WHERE c.conrelid = 'hsdg.notifications'::regclass AND c.conname = 'notifications_type_check';
  types := array_remove(types, 'employee_exit_reassign');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;
DROP FUNCTION IF EXISTS hsdg.leaver_reassign_partners(uuid);
DROP FUNCTION IF EXISTS hsdg.people_login_flags();
DROP FUNCTION IF EXISTS hsdg.people_workload(date);
DROP FUNCTION IF EXISTS hsdg.attendance_by_day(date, date);
DROP FUNCTION IF EXISTS hsdg.ctx_reads_people();
DROP POLICY IF EXISTS tasks_people_read ON hsdg.tasks;
DROP POLICY IF EXISTS engagements_people_read ON hsdg.engagements;
DROP POLICY IF EXISTS engagement_time_entries_people_read ON hsdg.engagement_time_entries;
