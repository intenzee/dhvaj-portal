-- Up Migration
-- 02.3 Schedule III — the Financial Statements Workbook (DHVAJ 02.3 spec §16)
-- and the 02.3 technical memo (§17).
--
--   • document_templates gains the Schedule III Presentation Framework memo
--     (Word) and one Excel FS-workbook key per Schedule III framework — each
--     framework version names its key. A 'standard' variant per key is where
--     the firm uploads its approved file; entity-type and period-dated
--     variants (template effective version) are added by an administrator.
--   • hsdg.audit_fs_workbooks — the workbook created for a statutory-audit
--     workflow: the engagement document (SharePoint-backed when Microsoft 365
--     is on) plus the exact template id / variant / version, the Schedule III
--     framework version and the creation date, so a later template or
--     amendment never changes a historical engagement. One live workbook per
--     workflow; removal is soft (a controlled new revision). Same RLS as the
--     Section 02 files: members read, only leads create or change.

ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii'));

INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
  ('schedule_iii_presentation_memo', 'standard', 'Schedule III Presentation Framework Technical Memo'),
  ('fs_workbook_as_div_i',      'standard', 'Financial Statements Workbook — AS / Schedule III Division I'),
  ('fs_workbook_indas_div_ii',  'standard', 'Financial Statements Workbook — Ind AS / Schedule III Division II'),
  ('fs_workbook_indas_div_iii', 'standard', 'Financial Statements Workbook — Ind AS NBFC / Schedule III Division III')
ON CONFLICT (template_key, variant_key) DO NOTHING;

CREATE TABLE hsdg.audit_fs_workbooks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id    uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  subassessment_id        uuid REFERENCES hsdg.audit_framework_subassessment (id) ON DELETE SET NULL,
  document_id             uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  template_id             uuid NOT NULL REFERENCES hsdg.document_templates (id) ON DELETE RESTRICT,
  template_key            text NOT NULL,
  template_variant_key    text NOT NULL,
  template_version_id     uuid NOT NULL REFERENCES hsdg.document_template_versions (id) ON DELETE RESTRICT,
  template_version_no     integer NOT NULL,
  -- The Schedule III framework version (02.3 library) — kept as a value, not a
  -- foreign key, so the record survives any later library maintenance.
  framework_version_id    uuid,
  framework_id            text,
  framework_version_label text,
  division                text CHECK (division IS NULL OR division IN ('I','II','III')),
  financial_year          text,
  entity_type_slug        text,
  missing_fields          text[] NOT NULL DEFAULT '{}',
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  removed_at              timestamptz,
  removed_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL
);
CREATE INDEX audit_fs_workbooks_engagement_idx ON hsdg.audit_fs_workbooks (engagement_id);
CREATE UNIQUE INDEX audit_fs_workbooks_one_live
  ON hsdg.audit_fs_workbooks (workflow_instance_id) WHERE removed_at IS NULL;

REVOKE DELETE ON hsdg.audit_fs_workbooks FROM hsdg_app;
ALTER TABLE hsdg.audit_fs_workbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_fs_workbooks_select ON hsdg.audit_fs_workbooks
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_fs_workbooks_insert ON hsdg.audit_fs_workbooks
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_fs_workbooks_update ON hsdg.audit_fs_workbooks
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_fs_workbooks CASCADE;

-- A 02.3 memo linked to a sub-assessment pins its template version (RESTRICT).
DELETE FROM hsdg.audit_framework_files WHERE template_key = 'schedule_iii_presentation_memo';
DELETE FROM hsdg.document_template_versions v
 USING hsdg.document_templates t
 WHERE v.template_id = t.id
   AND t.template_key IN ('schedule_iii_presentation_memo','fs_workbook_as_div_i',
                          'fs_workbook_indas_div_ii','fs_workbook_indas_div_iii');
DELETE FROM hsdg.document_templates
 WHERE template_key IN ('schedule_iii_presentation_memo','fs_workbook_as_div_i',
                        'fs_workbook_indas_div_ii','fs_workbook_indas_div_iii');
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo'));
