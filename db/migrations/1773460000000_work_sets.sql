-- ─────────────────────────────────────────────────────────────────────────
-- Work sets (Phase 2, C-3 and C-4)
--
-- A Manager or above gives a set of open tasks to someone below them, often a
-- Senior: for example all 16 GSTR-1 for Oct 2026, saved by name ("GSTR-1 Oct
-- 2026 — arjun") with a due date and a note. The tasks move to that person,
-- with the giver as reviewer. The Senior may split the set among their
-- Articles. Each task keeps its set, so the giver still sees the whole set and
-- who holds each piece. A set may span several engagements.
--
-- tasks.work_set_id is the set a task was given in; tasks.assigned_at is when
-- it last changed hands (assigned_by_employee_id is who handed it). The
-- history lives in task_assignments.
--
-- Anyone who can see one of a set's tasks can see the set, so a set's
-- visibility follows the task rules (reporting tree, C-2).
--
-- Notification type work_set_assigned: one per set (or per split), not one
-- per task.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.work_sets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  created_by_employee_id  uuid REFERENCES hsdg.employees(id) ON DELETE SET NULL,
  assigned_to_employee_id uuid NOT NULL REFERENCES hsdg.employees(id) ON DELETE RESTRICT,
  due_date                date,
  note                    text CHECK (note IS NULL OR length(note) <= 2000),
  created_at              timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  version                 integer NOT NULL DEFAULT 1
);
CREATE INDEX work_sets_assigned_to_idx ON hsdg.work_sets (assigned_to_employee_id, created_at DESC);
CREATE INDEX work_sets_created_by_idx ON hsdg.work_sets (created_by_employee_id, created_at DESC);

ALTER TABLE hsdg.tasks
  ADD COLUMN work_set_id uuid REFERENCES hsdg.work_sets(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz;
CREATE INDEX tasks_work_set_idx ON hsdg.tasks (work_set_id) WHERE work_set_id IS NOT NULL;

-- A task handed on before now: its last hand-over, else its creation.
ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_assignments NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.tasks t
   SET assigned_at = coalesce(
         (SELECT max(a.at) FROM hsdg.task_assignments a
           WHERE a.task_id = t.id AND a.kind = 'assignee'),
         t.created_at)
 WHERE t.assigned_to_employee_id IS NOT NULL;
ALTER TABLE hsdg.task_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON hsdg.work_sets TO hsdg_app;
ALTER TABLE hsdg.work_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.work_sets FORCE ROW LEVEL SECURITY;

CREATE POLICY work_sets_owner_select ON hsdg.work_sets FOR SELECT TO hsdg_migrator USING (true);
CREATE POLICY work_sets_select ON hsdg.work_sets FOR SELECT TO hsdg_app USING (
  (SELECT hsdg.ctx_is_business_firmwide())
  OR created_by_employee_id = (SELECT hsdg.ctx_employee_id())
  OR assigned_to_employee_id = (SELECT hsdg.ctx_employee_id())
  OR EXISTS (SELECT 1 FROM hsdg.tasks t WHERE t.work_set_id = work_sets.id)
);
CREATE POLICY work_sets_insert ON hsdg.work_sets FOR INSERT TO hsdg_app WITH CHECK (
  created_by_employee_id = (SELECT hsdg.ctx_employee_id())
);
CREATE POLICY work_sets_update ON hsdg.work_sets FOR UPDATE TO hsdg_app USING (
  (SELECT hsdg.ctx_is_business_firmwide())
  OR created_by_employee_id = (SELECT hsdg.ctx_employee_id())
  OR assigned_to_employee_id = (SELECT hsdg.ctx_employee_id())
);

DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'work_set_assigned'), 'work_set_assigned');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type = 'work_set_assigned';
DO $$
DECLARE
  types text[] := array_remove(hsdg.notification_types_now(), 'work_set_assigned');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

DROP POLICY work_sets_select ON hsdg.work_sets;
ALTER TABLE hsdg.tasks DROP COLUMN assigned_at, DROP COLUMN work_set_id;
DROP TABLE hsdg.work_sets;
