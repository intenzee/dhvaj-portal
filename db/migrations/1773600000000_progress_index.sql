-- Up Migration
-- Phase 3, D-1 — the Progress tracker counts open and finished work by
-- assignee, status and internal due date (GET /work/progress); this is the
-- index the plan names for it.

CREATE INDEX IF NOT EXISTS tasks_progress_idx
  ON hsdg.tasks (assigned_to_employee_id, status, due_date);

-- Down Migration
DROP INDEX IF EXISTS hsdg.tasks_progress_idx;
