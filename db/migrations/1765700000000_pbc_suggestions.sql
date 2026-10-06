-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — the PBC tracker builds itself from the file
--
-- Requests are suggested from the client master (standard list), the 03.5
-- audit areas, the Section 04 risks, the completion stage and last year's
-- tracker. Each suggestion carries a stable source key and is logged, so a
-- request the team deletes is never suggested again. `last_chased_on` records
-- when the client was last reminded about an outstanding request.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_pbc_items
  ADD COLUMN source_key     text,
  ADD COLUMN source_note    text,
  ADD COLUMN last_chased_on date;
CREATE UNIQUE INDEX audit_pbc_items_source_key_uq
  ON hsdg.audit_pbc_items (workflow_instance_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE TABLE hsdg.audit_pbc_suggestion_log (
  workflow_instance_id uuid NOT NULL
                         REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id        uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  source_key           text NOT NULL CHECK (length(trim(source_key)) > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_instance_id, source_key)
);
ALTER TABLE hsdg.audit_pbc_suggestion_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_pbc_suggestion_log_select ON hsdg.audit_pbc_suggestion_log
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_pbc_suggestion_log_insert ON hsdg.audit_pbc_suggestion_log
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Undo / redo (1765600000000_audit_file_undo) captures every audit-file table
-- that existed then; a refresh that adds requests also logs them here, so undo
-- must replay both together.
CREATE TRIGGER audit_pbc_suggestion_log_undo_capture
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.audit_pbc_suggestion_log
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_undo_capture('workflow_instance_id', 'source_key');

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_pbc_suggestion_log;
DROP INDEX IF EXISTS hsdg.audit_pbc_items_source_key_uq;
ALTER TABLE hsdg.audit_pbc_items
  DROP COLUMN IF EXISTS last_chased_on,
  DROP COLUMN IF EXISTS source_note,
  DROP COLUMN IF EXISTS source_key;
