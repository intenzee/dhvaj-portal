-- Up Migration
-- Section 02 evidence and technical memo (DHVAJ 02.2 spec §7 evidence actions,
-- §18 Evidence / Technical Memo).
--
--   • hsdg.audit_framework_files — the files behind one Section 02
--     sub-assessment (02.2 now; 02.3–02.7 reuse it): engagement documents
--     (SharePoint-backed when Microsoft 365 is on — documents.m365_live_item_id)
--     added or linked, never copied. A technical memo created from the firm's
--     Word template keeps the exact template version it came from. Removal is
--     soft so the audit trail keeps the link. Same RLS as the sub-assessment:
--     members read, only leads change.
--   • document_templates gains the Financial Reporting Framework Technical
--     Memo key, with a standard variant the firm uploads its Word file into.

ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo'));

INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
  ('financial_reporting_framework_memo', 'standard', 'Financial Reporting Framework Technical Memo')
ON CONFLICT (template_key, variant_key) DO NOTHING;

CREATE TABLE hsdg.audit_framework_files (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subassessment_id       uuid NOT NULL REFERENCES hsdg.audit_framework_subassessment (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  document_id            uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  kind                   text NOT NULL DEFAULT 'evidence' CHECK (kind IN ('evidence','technical_memo')),
  template_version_id    uuid REFERENCES hsdg.document_template_versions (id) ON DELETE RESTRICT,
  template_key           text,
  template_variant_key   text,
  template_version_no    integer,
  linked_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz,
  removed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL
);
CREATE INDEX audit_framework_files_subassessment_idx
  ON hsdg.audit_framework_files (subassessment_id);
CREATE UNIQUE INDEX audit_framework_files_live_unique
  ON hsdg.audit_framework_files (subassessment_id, document_id) WHERE removed_at IS NULL;
-- One live technical memo per sub-assessment; a removed one can be recreated.
CREATE UNIQUE INDEX audit_framework_files_one_memo
  ON hsdg.audit_framework_files (subassessment_id)
  WHERE removed_at IS NULL AND kind = 'technical_memo';

REVOKE DELETE ON hsdg.audit_framework_files FROM hsdg_app;
ALTER TABLE hsdg.audit_framework_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_files_select ON hsdg.audit_framework_files
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_files_insert ON hsdg.audit_framework_files
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_framework_files_update ON hsdg.audit_framework_files
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_framework_files CASCADE;

DELETE FROM hsdg.document_template_versions v
 USING hsdg.document_templates t
 WHERE v.template_id = t.id AND t.template_key = 'financial_reporting_framework_memo';
DELETE FROM hsdg.document_templates WHERE template_key = 'financial_reporting_framework_memo';
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement'));
