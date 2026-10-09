-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.4 CARO 2020 — the Level-2 clause work programme of an engagement, its
-- clause work, findings, the consolidated 3(xxi) component table and the
-- CARO Applicability Memo template (DHVAJ Section 02.4 spec §11–§16, §18).
--
--   • hsdg.audit_caro_programme — one per statutory-audit workflow, created
--     on read once 02.4 concludes CARO applies to the standalone report. It
--     freezes the Order version resolved for the audit period (a later
--     library change never rewrites it). When 02.4 later concludes not
--     applicable the programme and its items are WITHDRAWN, never deleted.
--   • hsdg.audit_caro_clause_item — one per library clause / sub-clause that
--     carries work (a clause with sub-clauses is a heading): a frozen copy of
--     the clause, its Level-2 relevance (Applicable / Not Applicable to Facts
--     / Assessment Required — never a Level-1 input), management response,
--     draft reporting language, conclusion and the submit → approve review.
--   • hsdg.audit_caro_clause_evidence — engagement documents or Section 06
--     evidence linked to a clause (reuse, never a second upload).
--   • hsdg.audit_caro_finding — a clause finding, created once and linked to
--     its clause, the audit area and the reporting.
--   • hsdg.audit_caro_component — clause 3(xxi): the companies included in
--     the consolidated financial statements (from 02.6's perimeter), each
--     with its CARO applicability, linked auditor's report, qualification /
--     adverse remark and paragraph numbers.
--   • document_templates gains 'caro_applicability_memo'.
--
-- Engagement child data: members SELECT, only leads INSERT / UPDATE (the
-- Section 02 / 06 tables' access). Nothing is ever hard-deleted by the app.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.audit_caro_programme (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id        uuid NOT NULL UNIQUE
                                REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id               uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- The Order version (library) frozen as values, so the record survives any
  -- later library maintenance.
  order_version_id            uuid,
  order_code                  text NOT NULL,
  order_title                 text NOT NULL,
  order_version_label         text NOT NULL,
  period_start                date NOT NULL,
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  withdrawn_at                timestamptz,
  withdrawn_reason            text,
  instantiated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_caro_programme_engagement_idx ON hsdg.audit_caro_programme (engagement_id);
CREATE TRIGGER audit_caro_programme_set_updated_at
  BEFORE UPDATE ON hsdg.audit_caro_programme
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_caro_clause_item (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id              uuid NOT NULL REFERENCES hsdg.audit_caro_programme (id) ON DELETE CASCADE,
  workflow_instance_id      uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id             uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Frozen copy of the library row.
  library_clause_id         uuid,
  clause_code               text NOT NULL,
  parent_clause_code        text,
  clause_ref                text NOT NULL,
  parent_title              text,
  title                     text NOT NULL,
  requirement               text NOT NULL,
  report_context            text NOT NULL CHECK (report_context IN ('standalone','consolidated')),
  provision_code            text NOT NULL,
  guidance_provision_code   text,
  guidance_reference        text,
  relevance_hint            text,
  schedule_iii_keys         text[] NOT NULL DEFAULT '{}',
  audit_area_codes          text[] NOT NULL DEFAULT '{}',
  procedures                jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_partner_review   boolean NOT NULL DEFAULT false,
  sort_order                integer NOT NULL DEFAULT 0,
  -- Level 2 — relevance to the entity's facts (spec §11, §12).
  relevance                 text NOT NULL DEFAULT 'assessment_required'
                              CHECK (relevance IN ('applicable','not_applicable_to_facts','assessment_required')),
  relevance_reason          text,
  -- Clause work (spec §13).
  work_performed            text,
  management_response       text,
  draft_reporting           text,
  conclusion                text CHECK (conclusion IS NULL OR conclusion IN
                              ('no_reportable_exception','reportable_matter',
                               'not_applicable_to_facts','further_work_required')),
  conclusion_note           text,
  review_state              text NOT NULL DEFAULT 'open'
                              CHECK (review_state IN ('open','submitted','returned','approved')),
  return_note               text,
  submitted_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  submitted_at              timestamptz,
  approved_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  approved_at               timestamptz,
  partner_reviewed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  partner_reviewed_at       timestamptz,
  -- Section 06 procedure generated for this clause (spec §18).
  procedure_id              uuid REFERENCES hsdg.audit_procedures (id) ON DELETE SET NULL,
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  withdrawn_at              timestamptz,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_caro_clause_item_key UNIQUE (programme_id, clause_code),
  -- An approved conclusion is never "further work required".
  CONSTRAINT audit_caro_clause_item_approved_concluded CHECK (
    review_state <> 'approved'
    OR (conclusion IS NOT NULL AND conclusion <> 'further_work_required')
  )
);
CREATE INDEX audit_caro_clause_item_instance_idx ON hsdg.audit_caro_clause_item (workflow_instance_id);
CREATE INDEX audit_caro_clause_item_engagement_idx ON hsdg.audit_caro_clause_item (engagement_id);
CREATE TRIGGER audit_caro_clause_item_set_updated_at
  BEFORE UPDATE ON hsdg.audit_caro_clause_item
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_caro_clause_evidence (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                uuid NOT NULL REFERENCES hsdg.audit_caro_clause_item (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  audit_evidence_id      uuid REFERENCES hsdg.audit_evidence (id) ON DELETE CASCADE,
  note                   text,
  linked_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz,
  removed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  CONSTRAINT audit_caro_clause_evidence_one_source
    CHECK ((document_id IS NULL) <> (audit_evidence_id IS NULL))
);
CREATE INDEX audit_caro_clause_evidence_item_idx ON hsdg.audit_caro_clause_evidence (item_id);
CREATE UNIQUE INDEX audit_caro_clause_evidence_live_doc
  ON hsdg.audit_caro_clause_evidence (item_id, document_id)
  WHERE removed_at IS NULL AND document_id IS NOT NULL;
CREATE UNIQUE INDEX audit_caro_clause_evidence_live_ev
  ON hsdg.audit_caro_clause_evidence (item_id, audit_evidence_id)
  WHERE removed_at IS NULL AND audit_evidence_id IS NOT NULL;

CREATE TABLE hsdg.audit_caro_finding (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                uuid NOT NULL REFERENCES hsdg.audit_caro_clause_item (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Per-workflow sequence behind the display code CF-00n.
  seq                    integer NOT NULL,
  description            text NOT NULL CHECK (length(trim(description)) > 0),
  severity               text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  -- The audit area it belongs to (Section 06 work area key) and procedure.
  work_area_key          text,
  procedure_id           uuid REFERENCES hsdg.audit_procedures (id) ON DELETE SET NULL,
  amount                 numeric(18,2),
  include_in_report      boolean NOT NULL DEFAULT true,
  management_response    text,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution             text,
  raised_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  withdrawn_at           timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_caro_finding_seq UNIQUE (workflow_instance_id, seq)
);
CREATE INDEX audit_caro_finding_item_idx ON hsdg.audit_caro_finding (item_id);
CREATE INDEX audit_caro_finding_engagement_idx ON hsdg.audit_caro_finding (engagement_id);
CREATE TRIGGER audit_caro_finding_set_updated_at
  BEFORE UPDATE ON hsdg.audit_caro_finding
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_caro_component (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                     uuid NOT NULL REFERENCES hsdg.audit_caro_clause_item (id) ON DELETE CASCADE,
  engagement_id               uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- '02.6' when it comes from the group structure (one source, spec §14),
  -- 'manual' when the team adds it.
  source                      text NOT NULL CHECK (source IN ('02.6','manual')),
  source_key                  text NOT NULL CHECK (length(trim(source_key)) > 0),
  component_name              text NOT NULL CHECK (length(trim(component_name)) > 0),
  relationship                text,
  caro_applicable             text NOT NULL DEFAULT 'pending'
                                CHECK (caro_applicable IN ('yes','no','pending')),
  auditor_name                text,
  auditor_report_document_id  uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  qualification_identified    boolean,
  paragraph_refs              text,
  remarks                     text,
  sort_order                  integer NOT NULL DEFAULT 0,
  -- No longer in the 02.6 perimeter — kept for the record.
  withdrawn_at                timestamptz,
  version                     integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_caro_component_key UNIQUE (item_id, source_key)
);
CREATE INDEX audit_caro_component_engagement_idx ON hsdg.audit_caro_component (engagement_id);
CREATE TRIGGER audit_caro_component_set_updated_at
  BEFORE UPDATE ON hsdg.audit_caro_component
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (engagement child data) ─────────────────────────────
REVOKE DELETE ON hsdg.audit_caro_programme       FROM hsdg_app;
REVOKE DELETE ON hsdg.audit_caro_clause_item     FROM hsdg_app;
REVOKE DELETE ON hsdg.audit_caro_clause_evidence FROM hsdg_app;
REVOKE DELETE ON hsdg.audit_caro_finding         FROM hsdg_app;
REVOKE DELETE ON hsdg.audit_caro_component       FROM hsdg_app;

ALTER TABLE hsdg.audit_caro_programme ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_caro_programme_select ON hsdg.audit_caro_programme
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_caro_programme_insert ON hsdg.audit_caro_programme
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_caro_programme_update ON hsdg.audit_caro_programme
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_caro_clause_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_caro_clause_item_select ON hsdg.audit_caro_clause_item
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_caro_clause_item_insert ON hsdg.audit_caro_clause_item
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_caro_clause_item_update ON hsdg.audit_caro_clause_item
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_caro_clause_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_caro_clause_evidence_select ON hsdg.audit_caro_clause_evidence
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_caro_clause_evidence_insert ON hsdg.audit_caro_clause_evidence
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_caro_clause_evidence_update ON hsdg.audit_caro_clause_evidence
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_caro_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_caro_finding_select ON hsdg.audit_caro_finding
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_caro_finding_insert ON hsdg.audit_caro_finding
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_caro_finding_update ON hsdg.audit_caro_finding
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_caro_component ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_caro_component_select ON hsdg.audit_caro_component
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_caro_component_insert ON hsdg.audit_caro_component
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_caro_component_update ON hsdg.audit_caro_component
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── CARO Applicability Memo template (spec §16) ────────────────────────────
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo'));

INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
  ('caro_applicability_memo', 'standard', 'CARO 2020 Applicability Memo')
ON CONFLICT (template_key, variant_key) DO NOTHING;

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_caro_component CASCADE;
DROP TABLE IF EXISTS hsdg.audit_caro_finding CASCADE;
DROP TABLE IF EXISTS hsdg.audit_caro_clause_evidence CASCADE;
DROP TABLE IF EXISTS hsdg.audit_caro_clause_item CASCADE;
DROP TABLE IF EXISTS hsdg.audit_caro_programme CASCADE;

-- A CARO memo linked to a sub-assessment pins its template version (RESTRICT).
DELETE FROM hsdg.audit_framework_files WHERE template_key = 'caro_applicability_memo';
DELETE FROM hsdg.document_template_versions v
 USING hsdg.document_templates t
 WHERE v.template_id = t.id AND t.template_key = 'caro_applicability_memo';
DELETE FROM hsdg.document_templates WHERE template_key = 'caro_applicability_memo';
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii'));
