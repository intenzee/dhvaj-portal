-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · audit file links.
--
-- A statutory-audit task may be about one area of the audit file (Receivables,
-- Revenue, IFC …). tasks.audit_work_area_id names it, so every list that links to
-- the task opens the audit file on that area instead of the top of the tab.
-- Nullable: most tasks are not about one area. The area must be on the task's
-- engagement — the API checks it; an area removed later just drops the link.
-- (Not "audit_area_id": audit_work_areas already uses that for its 03.5 area.)
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.tasks
  ADD COLUMN audit_work_area_id uuid REFERENCES hsdg.audit_work_areas (id) ON DELETE SET NULL;
CREATE INDEX tasks_audit_work_area_idx ON hsdg.tasks (audit_work_area_id)
  WHERE audit_work_area_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS hsdg.tasks_audit_work_area_idx;
ALTER TABLE hsdg.tasks DROP COLUMN IF EXISTS audit_work_area_id;
