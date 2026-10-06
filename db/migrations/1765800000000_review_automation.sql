-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — Review reads the file
--
-- • Review notes raised from a suggestion carry its stable `source_key`, so
--   the screen can tell when the issue has been fixed in the file and so the
--   same suggestion is not offered twice while its note is live.
-- • A suggestion the reviewer dismisses is logged and never offered again.
-- • An audit area's submitted conclusion can now be signed off by its
--   reviewer (`reviewed_at`): it leaves the review queue. Changing the
--   conclusion afterwards clears the sign-off, so it is reviewed again.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_review_notes ADD COLUMN source_key text;
CREATE UNIQUE INDEX audit_review_notes_live_source_key_uq
  ON hsdg.audit_review_notes (workflow_instance_id, source_key)
  WHERE source_key IS NOT NULL AND status IN ('open', 'responded');

CREATE TABLE hsdg.audit_review_dismissals (
  workflow_instance_id uuid NOT NULL
                         REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id        uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  source_key           text NOT NULL CHECK (length(trim(source_key)) > 0),
  dismissed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_instance_id, source_key)
);
ALTER TABLE hsdg.audit_review_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_review_dismissals_select ON hsdg.audit_review_dismissals
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_review_dismissals_insert ON hsdg.audit_review_dismissals
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
-- Undo / redo (1765600000000_audit_file_undo) only captured tables that existed then.
CREATE TRIGGER audit_review_dismissals_undo_capture
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.audit_review_dismissals
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_undo_capture('workflow_instance_id', 'source_key');

ALTER TABLE hsdg.audit_work_areas
  ADD COLUMN reviewed_at             timestamptz,
  ADD COLUMN reviewed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL;

-- A reviewed conclusion that changes is no longer reviewed.
CREATE OR REPLACE FUNCTION hsdg.audit_work_area_review_reset() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
     AND (NEW.conclusion IS DISTINCT FROM OLD.conclusion
          OR NEW.conclusion_state IS DISTINCT FROM OLD.conclusion_state) THEN
    NEW.reviewed_at := NULL;
    NEW.reviewed_by_employee_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_work_areas_review_reset
  BEFORE UPDATE ON hsdg.audit_work_areas
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_work_area_review_reset();

-- Down Migration

DROP TRIGGER IF EXISTS audit_work_areas_review_reset ON hsdg.audit_work_areas;
DROP FUNCTION IF EXISTS hsdg.audit_work_area_review_reset();
ALTER TABLE hsdg.audit_work_areas
  DROP COLUMN IF EXISTS reviewed_by_employee_id,
  DROP COLUMN IF EXISTS reviewed_at;
DROP TABLE IF EXISTS hsdg.audit_review_dismissals;
DROP INDEX IF EXISTS hsdg.audit_review_notes_live_source_key_uq;
ALTER TABLE hsdg.audit_review_notes DROP COLUMN IF EXISTS source_key;
