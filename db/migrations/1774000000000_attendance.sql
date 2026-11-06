-- ─────────────────────────────────────────────────────────────────────────
-- Attendance from the work people log
--
--   · engagement_time_entries.work_location: where the work was done (office,
--     home, the client's office). It lives on the original row: a correction
--     (adjusts_entry_id) is read through to it, so the view is unchanged.
--   · hsdg.internal_time_entries: firm work that is not for a client
--     (training, admin, internal meetings…), in minutes on a day. It counts
--     toward the day like client work.
--   · hsdg.firm_holidays: the firm's holidays (Sunday is the weekly off).
--   · hsdg.leave_requests: full or half days, approved by the person's
--     reporting manager, or HR / the Managing Partner when they have none.
--   · hsdg.attendance_settings: one row — the full day (8h), the half day
--     (4h), and the days of each leave a year.
--   · hsdg.attendance_hours(from, to, employees): seconds per person, day and
--     place, from both kinds of time. HR and the Managing Partner get
--     anyone; everyone else their own reporting tree (themselves included).
--     No client, engagement or task.
--   · hsdg.filing_time_seconds(instances): everyone's time on each filing's
--     task, for "Filed by … · 2h 10m" — for filings the caller can see.
--   · A person takes their own logged (manual) row out for today and the
--     last 3 days; task clocks and corrections stay as they are.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.engagement_time_entries
  ADD COLUMN work_location text CHECK (work_location IN ('office', 'home', 'client_office'));

CREATE TABLE hsdg.internal_time_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  work_day       date NOT NULL,
  minutes        integer NOT NULL CHECK (minutes BETWEEN 1 AND 720),
  category       text NOT NULL
                   CHECK (category IN ('internal_meeting', 'training', 'admin', 'travel', 'other')),
  work_location  text NOT NULL CHECK (work_location IN ('office', 'home', 'client_office')),
  note           text CHECK (note IS NULL OR length(note) <= 500),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX internal_time_entries_day_idx ON hsdg.internal_time_entries (employee_id, work_day);
CREATE TRIGGER internal_time_entries_set_updated_at BEFORE UPDATE ON hsdg.internal_time_entries
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.firm_holidays (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_on              date NOT NULL UNIQUE,
  name                    text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hsdg.leave_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  leave_type              text NOT NULL CHECK (leave_type IN ('casual', 'sick', 'earned', 'unpaid')),
  from_day                date NOT NULL,
  to_day                  date NOT NULL,
  half                    text CHECK (half IN ('first_half', 'second_half')),
  -- Working days it takes (Sundays and holidays left out), worked out on applying.
  days                    numeric(5,1) NOT NULL CHECK (days > 0),
  reason                  text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  -- The reporting manager when it was asked; null: HR / the Managing Partner decide.
  approver_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at              timestamptz,
  decision_note           text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_range CHECK (to_day >= from_day),
  CONSTRAINT leave_requests_half_one_day CHECK (half IS NULL OR from_day = to_day),
  CONSTRAINT leave_requests_decided CHECK (
    status NOT IN ('approved', 'rejected')
    OR (decided_at IS NOT NULL AND decided_by_employee_id IS NOT NULL))
);
CREATE INDEX leave_requests_employee_idx ON hsdg.leave_requests (employee_id, from_day);
CREATE INDEX leave_requests_approver_idx ON hsdg.leave_requests (approver_employee_id)
  WHERE status = 'pending';
CREATE INDEX leave_requests_days_idx ON hsdg.leave_requests (from_day, to_day)
  WHERE status IN ('pending', 'approved');
CREATE TRIGGER leave_requests_set_updated_at BEFORE UPDATE ON hsdg.leave_requests
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- A decided or withdrawn request clears its approvers' "Leave to approve".
CREATE FUNCTION hsdg.leave_request_resolve_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    PERFORM hsdg.resolve_notifications('leave_request_approval', ARRAY[NEW.id], ARRAY['leave_requested']);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hsdg.leave_request_resolve_notifications() FROM PUBLIC;
CREATE TRIGGER leave_requests_resolve_notifications AFTER UPDATE OF status ON hsdg.leave_requests
  FOR EACH ROW EXECUTE FUNCTION hsdg.leave_request_resolve_notifications();

CREATE TABLE hsdg.attendance_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  present_minutes        integer NOT NULL DEFAULT 480 CHECK (present_minutes BETWEEN 60 AND 960),
  half_day_minutes       integer NOT NULL DEFAULT 240 CHECK (half_day_minutes >= 30),
  allowances             jsonb NOT NULL
                           DEFAULT '{"casual": 12, "sick": 6, "earned": 15, "unpaid": null}'::jsonb
                           CHECK (jsonb_typeof(allowances) = 'object'),
  updated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_settings_half_under_full CHECK (half_day_minutes < present_minutes)
);
INSERT INTO hsdg.attendance_settings DEFAULT VALUES;

REVOKE ALL ON hsdg.internal_time_entries, hsdg.firm_holidays, hsdg.leave_requests,
  hsdg.attendance_settings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.internal_time_entries TO hsdg_app;
GRANT SELECT, INSERT, DELETE ON hsdg.firm_holidays TO hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.leave_requests TO hsdg_app;
GRANT SELECT, UPDATE ON hsdg.attendance_settings TO hsdg_app;

ALTER TABLE hsdg.internal_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.internal_time_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.firm_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.firm_holidays FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.leave_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.attendance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.attendance_settings FORCE ROW LEVEL SECURITY;

-- Firm work: your own; your reporting tree reads it; HR / the Managing Partner read all.
CREATE POLICY internal_time_entries_select ON hsdg.internal_time_entries FOR SELECT TO hsdg_app
  USING (employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[]) OR hsdg.ctx_reads_people());
CREATE POLICY internal_time_entries_insert ON hsdg.internal_time_entries FOR INSERT TO hsdg_app
  WITH CHECK (employee_id = hsdg.ctx_employee_id());
CREATE POLICY internal_time_entries_update ON hsdg.internal_time_entries FOR UPDATE TO hsdg_app
  USING (employee_id = hsdg.ctx_employee_id())
  WITH CHECK (employee_id = hsdg.ctx_employee_id());
CREATE POLICY internal_time_entries_delete ON hsdg.internal_time_entries FOR DELETE TO hsdg_app
  USING (employee_id = hsdg.ctx_employee_id());
-- For hsdg.attendance_hours, as the other people-wide readers (1772600000000).
CREATE POLICY internal_time_entries_people_read ON hsdg.internal_time_entries
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.people_read', true) = 'on');

-- Holidays: everyone signed in reads them; HR, the Managing Partner and the administrator keep them.
CREATE POLICY firm_holidays_select ON hsdg.firm_holidays FOR SELECT TO hsdg_app
  USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY firm_holidays_insert ON hsdg.firm_holidays FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_reads_people() OR hsdg.ctx_role() = 'admin');
CREATE POLICY firm_holidays_delete ON hsdg.firm_holidays FOR DELETE TO hsdg_app
  USING (hsdg.ctx_reads_people() OR hsdg.ctx_role() = 'admin');

-- Leave: yours, your tree's, the ones you approve; HR / the Managing Partner all.
CREATE POLICY leave_requests_select ON hsdg.leave_requests FOR SELECT TO hsdg_app
  USING (employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[])
         OR approver_employee_id = hsdg.ctx_employee_id()
         OR hsdg.ctx_reads_people());
CREATE POLICY leave_requests_insert ON hsdg.leave_requests FOR INSERT TO hsdg_app
  WITH CHECK (employee_id = hsdg.ctx_employee_id() AND status = 'pending'
              AND decided_at IS NULL);
-- You withdraw your own; the approver (or HR / the Managing Partner) decides —
-- never on their own request.
CREATE POLICY leave_requests_update ON hsdg.leave_requests FOR UPDATE TO hsdg_app
  USING (employee_id = hsdg.ctx_employee_id()
         OR approver_employee_id = hsdg.ctx_employee_id()
         OR hsdg.ctx_reads_people())
  WITH CHECK (
    (employee_id = hsdg.ctx_employee_id() AND status IN ('pending', 'cancelled'))
    OR (employee_id <> hsdg.ctx_employee_id()
        AND (approver_employee_id = hsdg.ctx_employee_id() OR hsdg.ctx_reads_people())));
CREATE POLICY leave_requests_people_read ON hsdg.leave_requests
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.people_read', true) = 'on');

CREATE POLICY attendance_settings_select ON hsdg.attendance_settings FOR SELECT TO hsdg_app
  USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY attendance_settings_update ON hsdg.attendance_settings FOR UPDATE TO hsdg_app
  USING (hsdg.ctx_reads_people()) WITH CHECK (hsdg.ctx_reads_people());

-- Take your own logged row out (today and the last 3 days). A row already
-- billed, or corrected, is held by its foreign keys.
CREATE POLICY time_entries_delete_own_logged ON hsdg.engagement_time_entries
  FOR DELETE TO hsdg_app
  USING (employee_id = hsdg.ctx_employee_id()
         AND source = 'manual' AND adjusts_entry_id IS NULL AND ended_at IS NOT NULL
         AND (started_at AT TIME ZONE 'Asia/Kolkata')::date
               >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 3);

-- Seconds per person, IST day and place, from client and firm work.
CREATE FUNCTION hsdg.attendance_hours(p_from date, p_to date, p_employees uuid[])
  RETURNS TABLE (employee_id uuid, day date, work_location text, seconds bigint)
  -- VOLATILE: it sets (and clears) the hsdg.people_read flag.
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  allowed uuid[];
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Give a from date on or before the to date.' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Attendance covers at most 93 days at a time.' USING ERRCODE = '22023';
  END IF;
  IF hsdg.ctx_reads_people() THEN
    allowed := p_employees;
  ELSE
    SELECT COALESCE(array_agg(x), '{}') INTO allowed
      FROM unnest(p_employees) x WHERE x = ANY (hsdg.ctx_subtree());
  END IF;
  IF coalesce(cardinality(allowed), 0) = 0 THEN
    RETURN;
  END IF;

  PERFORM set_config('hsdg.people_read', 'on', true);
  RETURN QUERY
    WITH t AS (
      SELECT te.employee_id AS emp,
             (te.started_at AT TIME ZONE 'Asia/Kolkata')::date AS d,
             loc.work_location AS place,
             COALESCE(te.duration_seconds,
                      GREATEST(0, EXTRACT(EPOCH FROM now() - te.started_at))::integer)::bigint AS s
        FROM hsdg.effective_time_entries te
        JOIN hsdg.engagement_time_entries loc ON loc.id = COALESCE(te.adjusts_entry_id, te.id)
       WHERE te.employee_id = ANY (allowed)
         AND (te.started_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
      UNION ALL
      SELECT i.employee_id, i.work_day, i.work_location, i.minutes::bigint * 60
        FROM hsdg.internal_time_entries i
       WHERE i.employee_id = ANY (allowed) AND i.work_day BETWEEN p_from AND p_to
    )
    SELECT t.emp, t.d, t.place, sum(t.s)::bigint FROM t GROUP BY 1, 2, 3 ORDER BY 1, 2;
  PERFORM set_config('hsdg.people_read', '', true);
END;
$$;
REVOKE ALL ON FUNCTION hsdg.attendance_hours(date, date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.attendance_hours(date, date, uuid[]) TO hsdg_app;

-- Everyone's time on each filing's task, for filings whose engagement the caller can see.
CREATE FUNCTION hsdg.filing_time_seconds(p_instances uuid[])
  RETURNS TABLE (compliance_instance_id uuid, seconds bigint)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF coalesce(cardinality(p_instances), 0) = 0 THEN
    RETURN;
  END IF;
  PERFORM set_config('hsdg.people_read', 'on', true);
  RETURN QUERY
    SELECT t.source_compliance_instance_id,
           sum(COALESCE(te.duration_seconds,
                        GREATEST(0, EXTRACT(EPOCH FROM now() - te.started_at))::integer))::bigint
      FROM hsdg.tasks t
      JOIN hsdg.effective_time_entries te ON te.task_id = t.id
     WHERE t.source_compliance_instance_id = ANY (p_instances)
       AND hsdg.is_engagement_member(t.engagement_id)
     GROUP BY 1;
  PERFORM set_config('hsdg.people_read', '', true);
END;
$$;
REVOKE ALL ON FUNCTION hsdg.filing_time_seconds(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.filing_time_seconds(uuid[]) TO hsdg_app;

-- Leave to approve, and the decision.
DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_remove(array_remove(types, 'leave_requested'), 'leave_decided')
           || ARRAY['leave_requested', 'leave_decided'];
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type IN ('leave_requested', 'leave_decided');
DO $$
DECLARE
  types text[] := array_remove(array_remove(hsdg.notification_types_now(), 'leave_requested'),
                               'leave_decided');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

DROP FUNCTION IF EXISTS hsdg.filing_time_seconds(uuid[]);
DROP FUNCTION IF EXISTS hsdg.attendance_hours(date, date, uuid[]);
DROP POLICY IF EXISTS time_entries_delete_own_logged ON hsdg.engagement_time_entries;
DROP TABLE IF EXISTS hsdg.attendance_settings;
DROP TABLE IF EXISTS hsdg.leave_requests;
DROP FUNCTION IF EXISTS hsdg.leave_request_resolve_notifications();
DROP TABLE IF EXISTS hsdg.firm_holidays;
DROP TABLE IF EXISTS hsdg.internal_time_entries;
ALTER TABLE hsdg.engagement_time_entries DROP COLUMN IF EXISTS work_location;
