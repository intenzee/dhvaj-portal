-- ─────────────────────────────────────────────────────────────────────────
-- Section 05 / 06 audit work — suggested work
--
-- The audit work seeds itself from Sections 03–04: a work area per retained
-- 03.5 audit area, the area detail (owner, reviewer, risk, materiality, due
-- date, figures) and suggested procedures (risk responses, area programmes,
-- workstream programmes).
--   • audit_procedures.source_key / source_note — where a suggested procedure
--     came from (NULL for a procedure the team added by hand).
--   • audit_work_suggestion_log — every key ever suggested on a file, so a
--     suggestion the team deleted is never suggested again.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_procedures
  ADD COLUMN source_key  text,
  ADD COLUMN source_note text;
CREATE UNIQUE INDEX audit_procedures_source_key_uq
  ON hsdg.audit_procedures (workflow_instance_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE TABLE hsdg.audit_work_suggestion_log (
  workflow_instance_id uuid NOT NULL
                         REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id        uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  source_key           text NOT NULL CHECK (length(trim(source_key)) > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_instance_id, source_key)
);

ALTER TABLE hsdg.audit_work_suggestion_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_work_suggestion_log_select ON hsdg.audit_work_suggestion_log
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_work_suggestion_log_insert ON hsdg.audit_work_suggestion_log
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_work_suggestion_log;
DROP INDEX IF EXISTS hsdg.audit_procedures_source_key_uq;
ALTER TABLE hsdg.audit_procedures DROP COLUMN IF EXISTS source_note, DROP COLUMN IF EXISTS source_key;
