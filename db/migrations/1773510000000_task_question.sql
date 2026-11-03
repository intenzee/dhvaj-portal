-- ─────────────────────────────────────────────────────────────────────────
-- Notification type task_question (C-5, My Work)
--
-- "Ask <giver>" on a My Work row: the person holding a task asks the person
-- who gave it (tasks.assigned_by_employee_id). The question travels as the
-- notification's body and is audited (task.asked).
--
-- The type list is rebuilt from whatever it holds now (other tracks add types
-- in parallel), as in 1773410000000_team_changed_notification.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'task_question'), 'task_question');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type = 'task_question';
DO $$
DECLARE
  types text[] := array_remove(hsdg.notification_types_now(), 'task_question');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;
