-- ─────────────────────────────────────────────────────────────────────────
-- Quick tasks: an urgent job handed to one person, answered like a chat
--
-- "New → New task": pick the client, type the job, pick who does it. It
-- reaches them at once (bell, and a pop-up on whatever screen they are on);
-- they answer Received, Doing — done in 1 h / 2 h / …, or Done, and either
-- side can write in the thread. A quick task needs no engagement and is seen
-- by the two people on it (and the Managing Partner / administrators).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.quick_tasks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                  bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  entity_id               uuid REFERENCES hsdg.entities (id) ON DELETE SET NULL,
  -- The client as the assigner saw it: the assignee may not be on its team.
  entity_label            text,
  title                   text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  details                 text CHECK (details IS NULL OR length(details) <= 4000),
  urgent                  boolean NOT NULL DEFAULT true,
  assigned_by_employee_id uuid NOT NULL REFERENCES hsdg.employees (id),
  assigned_to_employee_id uuid NOT NULL REFERENCES hsdg.employees (id),
  status                  text NOT NULL DEFAULT 'sent'
                            CHECK (status IN ('sent', 'received', 'doing', 'done', 'cancelled')),
  -- When the assignee said it will be done.
  eta_at                  timestamptz,
  -- When the assigner needs it, if they said.
  due_at                  timestamptz,
  received_at             timestamptz,
  started_at              timestamptz,
  done_at                 timestamptz,
  cancelled_at            timestamptz,
  last_activity_at        timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quick_tasks_to_idx ON hsdg.quick_tasks (assigned_to_employee_id, status, last_activity_at DESC);
CREATE INDEX quick_tasks_by_idx ON hsdg.quick_tasks (assigned_by_employee_id, status, last_activity_at DESC);
CREATE INDEX quick_tasks_entity_idx ON hsdg.quick_tasks (entity_id);

CREATE TABLE hsdg.quick_task_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quick_task_id      uuid NOT NULL REFERENCES hsdg.quick_tasks (id) ON DELETE CASCADE,
  author_employee_id uuid REFERENCES hsdg.employees (id),
  body               text CHECK (body IS NULL OR length(body) <= 4000),
  -- The status this message set (Received / Doing / Done / Cancelled …), if any.
  status             text CHECK (status IS NULL
                                 OR status IN ('sent', 'received', 'doing', 'done', 'cancelled')),
  eta_at             timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- When the other person opened it (the second tick).
  read_at            timestamptz,
  CHECK (body IS NOT NULL OR status IS NOT NULL OR eta_at IS NOT NULL)
);
CREATE INDEX quick_task_messages_task_idx ON hsdg.quick_task_messages (quick_task_id, created_at);
CREATE INDEX quick_task_messages_unread_idx ON hsdg.quick_task_messages (quick_task_id)
  WHERE read_at IS NULL;

REVOKE ALL ON hsdg.quick_tasks, hsdg.quick_task_messages FROM hsdg_app;
GRANT SELECT, INSERT, UPDATE ON hsdg.quick_tasks TO hsdg_app;
GRANT SELECT, INSERT ON hsdg.quick_task_messages TO hsdg_app;
GRANT UPDATE (read_at) ON hsdg.quick_task_messages TO hsdg_app;
GRANT USAGE ON SEQUENCE hsdg.quick_tasks_number_seq TO hsdg_app;

ALTER TABLE hsdg.quick_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.quick_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.quick_task_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.quick_task_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY quick_tasks_select ON hsdg.quick_tasks
  FOR SELECT USING (hsdg.ctx_employee_id() IN (assigned_by_employee_id, assigned_to_employee_id)
                    OR hsdg.ctx_is_business_firmwide());
CREATE POLICY quick_tasks_insert ON hsdg.quick_tasks
  FOR INSERT WITH CHECK (assigned_by_employee_id = hsdg.ctx_employee_id());
CREATE POLICY quick_tasks_update ON hsdg.quick_tasks
  FOR UPDATE USING (hsdg.ctx_employee_id() IN (assigned_by_employee_id, assigned_to_employee_id))
  WITH CHECK (hsdg.ctx_employee_id() IN (assigned_by_employee_id, assigned_to_employee_id));

CREATE POLICY quick_task_messages_select ON hsdg.quick_task_messages
  FOR SELECT USING (EXISTS (SELECT 1 FROM hsdg.quick_tasks q WHERE q.id = quick_task_id));
CREATE POLICY quick_task_messages_insert ON hsdg.quick_task_messages
  FOR INSERT WITH CHECK (
    author_employee_id = hsdg.ctx_employee_id()
    AND EXISTS (SELECT 1 FROM hsdg.quick_tasks q
                 WHERE q.id = quick_task_id
                   AND hsdg.ctx_employee_id() IN (q.assigned_by_employee_id,
                                                  q.assigned_to_employee_id)));
-- Only the reader marks a message read: never one's own.
CREATE POLICY quick_task_messages_update ON hsdg.quick_task_messages
  FOR UPDATE USING (
    author_employee_id IS DISTINCT FROM hsdg.ctx_employee_id()
    AND EXISTS (SELECT 1 FROM hsdg.quick_tasks q
                 WHERE q.id = quick_task_id
                   AND hsdg.ctx_employee_id() IN (q.assigned_by_employee_id,
                                                  q.assigned_to_employee_id)))
  WITH CHECK (true);

-- The owner reads logins, roles and offices only while quick_task_people says so.
CREATE POLICY users_quick_task_people ON hsdg.users
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.quick_task_people', true) = 'on');
CREATE POLICY user_roles_quick_task_people ON hsdg.user_roles
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.quick_task_people', true) = 'on');
CREATE POLICY roles_quick_task_people ON hsdg.roles
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.quick_task_people', true) = 'on');
CREATE POLICY offices_quick_task_people ON hsdg.offices
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.quick_task_people', true) = 'on');

/**
 * Everyone a quick task can go to, for any signed-in employee: the firm's
 * people (names, codes, office and main role only); can_receive when they
 * have a working login and have not left.
 */
CREATE FUNCTION hsdg.quick_task_people()
  RETURNS TABLE (id uuid, full_name text, employee_code text, office_code text,
                 role_slug text, can_receive boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF hsdg.ctx_role() IS NULL THEN RETURN; END IF;
  PERFORM set_config('hsdg.quick_task_people', 'on', true);
  RETURN QUERY
  SELECT e.id, e.full_name, e.employee_code, o.code::text,
         (SELECT r.slug::text FROM hsdg.user_roles ur JOIN hsdg.roles r ON r.id = ur.role_id
           WHERE ur.user_id = e.user_id
           ORDER BY array_position(ARRAY['managing_partner', 'admin', 'partner', 'manager',
                                         'senior', 'article', 'accountant', 'hr'], r.slug::text)
           LIMIT 1),
         (e.user_id IS NOT NULL AND e.employment_status <> 'exited' AND e.deleted_at IS NULL
           AND COALESCE(u.is_active, false))
    FROM hsdg.employees e
    LEFT JOIN hsdg.users u ON u.id = e.user_id
    LEFT JOIN hsdg.offices o ON o.id = e.primary_office_id;
  PERFORM set_config('hsdg.quick_task_people', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.quick_task_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.quick_task_people() TO hsdg_app;

DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'quick_task_assigned'), 'quick_task_assigned');
  types := array_append(array_remove(types, 'quick_task_reply'), 'quick_task_reply');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type IN ('quick_task_assigned', 'quick_task_reply');
DO $$
DECLARE
  types text[] := array_remove(array_remove(hsdg.notification_types_now(),
                                            'quick_task_assigned'), 'quick_task_reply');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;
DROP FUNCTION IF EXISTS hsdg.quick_task_people();
DROP POLICY IF EXISTS offices_quick_task_people ON hsdg.offices;
DROP POLICY IF EXISTS roles_quick_task_people ON hsdg.roles;
DROP POLICY IF EXISTS user_roles_quick_task_people ON hsdg.user_roles;
DROP POLICY IF EXISTS users_quick_task_people ON hsdg.users;
DROP TABLE IF EXISTS hsdg.quick_task_messages;
DROP TABLE IF EXISTS hsdg.quick_tasks;
