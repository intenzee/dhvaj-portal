-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — Reassessment detects changes in the file
--
-- • A reassessment raised from a detected change keeps the detection's key, so
--   the same change is not offered again, and records exactly what it flagged
--   (`affected_area_ids`, `affected_phases`) so its progress — and when it is
--   ready to resolve — can be read from the file.
-- • A detected change the team dismisses is logged and never offered again.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_reassessments
  ADD COLUMN detection_key     text,
  ADD COLUMN affected_area_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN affected_phases   text[] NOT NULL DEFAULT '{}';
CREATE INDEX audit_reassessments_detection_key_idx
  ON hsdg.audit_reassessments (workflow_instance_id, detection_key)
  WHERE detection_key IS NOT NULL;

CREATE TABLE hsdg.audit_reassessment_dismissals (
  workflow_instance_id uuid NOT NULL
                         REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id        uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  detection_key        text NOT NULL CHECK (length(trim(detection_key)) > 0),
  dismissed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_instance_id, detection_key)
);
ALTER TABLE hsdg.audit_reassessment_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_reassessment_dismissals_select ON hsdg.audit_reassessment_dismissals
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_reassessment_dismissals_insert ON hsdg.audit_reassessment_dismissals
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
-- Undo / redo (1765600000000_audit_file_undo) only captured tables that existed then.
CREATE TRIGGER audit_reassessment_dismissals_undo_capture
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.audit_reassessment_dismissals
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_undo_capture('workflow_instance_id', 'detection_key');

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_reassessment_dismissals;
DROP INDEX IF EXISTS hsdg.audit_reassessments_detection_key_idx;
ALTER TABLE hsdg.audit_reassessments
  DROP COLUMN IF EXISTS affected_phases,
  DROP COLUMN IF EXISTS affected_area_ids,
  DROP COLUMN IF EXISTS detection_key;
