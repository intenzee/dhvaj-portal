-- Up Migration
-- The firm's GST sheet closes a filing's task too.
--
-- apply_return_marks closes the filings the client's sheet marks filed / NA on
-- whichever engagement holds them, not only where the importer leads. Since
-- every filing has a task (C-1), closing the filing moves its untouched task
-- as well (filing_tasks_follow_filing), and that ran on the importer's own
-- rights: an importer who still holds the task but has left the engagement
-- could not write its history row, so the client failed to import; one who
-- neither leads nor holds it left the task open on a filed month. The owner
-- now moves the calendar's own filing tasks, and writes their history, while
-- apply_return_marks has said so for its transaction.

CREATE POLICY tasks_return_marks_select ON hsdg.tasks
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.applying_return_marks', true) = 'on'
         AND auto_created AND source_compliance_instance_id IS NOT NULL);
CREATE POLICY tasks_return_marks_update ON hsdg.tasks
  FOR UPDATE TO hsdg_migrator
  USING (current_setting('hsdg.applying_return_marks', true) = 'on'
         AND auto_created AND source_compliance_instance_id IS NOT NULL)
  WITH CHECK (current_setting('hsdg.applying_return_marks', true) = 'on'
              AND auto_created AND source_compliance_instance_id IS NOT NULL);
CREATE POLICY task_events_return_marks_insert ON hsdg.task_events
  FOR INSERT TO hsdg_migrator
  WITH CHECK (current_setting('hsdg.applying_return_marks', true) = 'on');

-- Down Migration

DROP POLICY IF EXISTS task_events_return_marks_insert ON hsdg.task_events;
DROP POLICY IF EXISTS tasks_return_marks_update ON hsdg.tasks;
DROP POLICY IF EXISTS tasks_return_marks_select ON hsdg.tasks;
