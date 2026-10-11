-- ─────────────────────────────────────────────────────────────────────────
-- 02.8 Audit Framework Summary & Approval — Track B records (spec v1.0 §7,
-- §10–§11, §14–§17)
--
--   • audit_matter gains the 02.8 matter fields: impact (affected framework /
--     downstream work), Partner Attention, and the "returned to source section"
--     trail — the matter is re-assigned in place, never recreated (§7).
--   • audit_framework_memo — one Audit Framework Memorandum per baseline
--     version (§10–§11): draft → submitted → approved (controlled). A revision
--     gets a NEW memo; an approved one is preserved and later superseded,
--     never silently replaced.
--   • audit_framework_impact — the professional confirmation of the system
--     change-impact first pass of a reopened revision (§15–§16). The items and
--     their fingerprint are frozen at confirmation; a later fact change voids it.
--   • audit_framework_work_link — downstream work linked to the baseline that
--     configured it (§14); on reopen the links are kept, marked superseded and
--     flagged for reassessment — completed work is never deleted (§17).
--   • document_templates gains 'audit_framework_memorandum' (§10).
--   • notifications gain 'framework_reopened' and 'framework_work_impacted' (§17).
--
-- SECURITY — engagement child data: members SELECT, leads INSERT / UPDATE, no
-- app DELETE. ENABLE (not FORCE) RLS so migrator-owned helpers bypass.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_matter
  ADD COLUMN impact                  text,
  ADD COLUMN partner_attention       boolean NOT NULL DEFAULT false,
  ADD COLUMN returned_at             timestamptz,
  ADD COLUMN returned_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN return_note             text;

CREATE TABLE hsdg.audit_framework_memo (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id                uuid NOT NULL UNIQUE
                               REFERENCES hsdg.audit_framework_baseline (id) ON DELETE CASCADE,
  workflow_instance_id       uuid NOT NULL
                               REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id              uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  baseline_version           text NOT NULL,
  document_id                uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE RESTRICT,
  status                     text NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','submitted','approved','superseded')),
  template_version_id        uuid REFERENCES hsdg.document_template_versions (id) ON DELETE SET NULL,
  template_variant_key       text,
  template_version_no        integer,
  missing_fields             text[] NOT NULL DEFAULT '{}',
  prepared_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  submitted_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  submitted_at               timestamptz,
  submitted_version_no       integer,
  controlled_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  controlled_at              timestamptz,
  controlled_version_no      integer,
  returned_at                timestamptz,
  superseded_at              timestamptz,
  version                    integer NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_framework_memo_submitted CHECK (
    status <> 'submitted' OR submitted_at IS NOT NULL
  ),
  CONSTRAINT audit_framework_memo_controlled CHECK (
    status <> 'approved' OR controlled_at IS NOT NULL
  )
);
CREATE INDEX audit_framework_memo_instance_idx ON hsdg.audit_framework_memo (workflow_instance_id);
CREATE INDEX audit_framework_memo_engagement_idx ON hsdg.audit_framework_memo (engagement_id);
CREATE INDEX audit_framework_memo_document_idx ON hsdg.audit_framework_memo (document_id);
CREATE TRIGGER audit_framework_memo_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_memo
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- §11: an approved memorandum is controlled — it may only become superseded.
CREATE FUNCTION hsdg.audit_framework_memo_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'A superseded Audit Framework Memorandum cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'approved' AND (
       NEW.status <> 'superseded'
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.controlled_version_no IS DISTINCT FROM OLD.controlled_version_no
    OR NEW.controlled_at IS DISTINCT FROM OLD.controlled_at
  ) THEN
    RAISE EXCEPTION 'The approved Audit Framework Memorandum is controlled; reopen the framework to revise it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_framework_memo_guard
  BEFORE UPDATE ON hsdg.audit_framework_memo
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_framework_memo_guard();

CREATE TABLE hsdg.audit_framework_impact (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id                uuid NOT NULL UNIQUE
                               REFERENCES hsdg.audit_framework_baseline (id) ON DELETE CASCADE,
  compared_to_baseline_id    uuid NOT NULL
                               REFERENCES hsdg.audit_framework_baseline (id) ON DELETE CASCADE,
  workflow_instance_id       uuid NOT NULL
                               REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id              uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  items                      jsonb NOT NULL DEFAULT '[]'::jsonb,
  fingerprint                text,
  confirmed_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  confirmed_at               timestamptz,
  confirmation_note          text,
  notified_at                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_framework_impact_confirmed CHECK (
    confirmed_at IS NULL OR fingerprint IS NOT NULL
  )
);
CREATE INDEX audit_framework_impact_instance_idx ON hsdg.audit_framework_impact (workflow_instance_id);
CREATE INDEX audit_framework_impact_engagement_idx ON hsdg.audit_framework_impact (engagement_id);
CREATE TRIGGER audit_framework_impact_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_impact
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_framework_work_link (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id                uuid NOT NULL
                               REFERENCES hsdg.audit_framework_baseline (id) ON DELETE CASCADE,
  workflow_instance_id       uuid NOT NULL
                               REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id              uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  work_kind                  text NOT NULL CHECK (work_kind IN
                               ('work_area','caro_programme','icfr_workstream',
                                'group_component','group_branch','reporting_card')),
  work_ref                   text NOT NULL CHECK (length(trim(work_ref)) > 0),
  label                      text NOT NULL CHECK (length(trim(label)) > 0),
  section                    text NOT NULL,
  owner_employee_id          uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  state_at_link              text,
  completed                  boolean NOT NULL DEFAULT false,
  relation                   text NOT NULL DEFAULT 'configured_by'
                               CHECK (relation IN ('configured_by','superseded')),
  reassessment_required      boolean NOT NULL DEFAULT false,
  reassessment_reason        text,
  notified_at                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_framework_work_link_unique UNIQUE (baseline_id, work_kind, work_ref)
);
CREATE INDEX audit_framework_work_link_instance_idx
  ON hsdg.audit_framework_work_link (workflow_instance_id);
CREATE INDEX audit_framework_work_link_engagement_idx
  ON hsdg.audit_framework_work_link (engagement_id);
CREATE TRIGGER audit_framework_work_link_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_work_link
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_framework_memo','audit_framework_impact','audit_framework_work_link']
  LOOP
    EXECUTE format('REVOKE DELETE ON hsdg.%I FROM hsdg_app', t);
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.is_engagement_member(engagement_id))',
                   t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))',
                   t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) '
                   'WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
  END LOOP;
END $$;

-- ── The Audit Framework Memorandum template (§10) ───────────────────────────
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo','icfr_applicability_memo',
    'consolidation_group_audit_memo','component_auditor_instructions',
    'audit_framework_memorandum'));

INSERT INTO hsdg.document_templates (template_key, variant_key, title) VALUES
  ('audit_framework_memorandum', 'standard', 'Audit Framework Memorandum')
ON CONFLICT (template_key, variant_key) DO NOTHING;

-- ── Reopen notifications (§17) ──────────────────────────────────────────────
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception',
   'document_uploaded',
   'framework_reopened','framework_work_impacted'));

-- Down Migration

DELETE FROM hsdg.notifications WHERE type IN ('framework_reopened','framework_work_impacted');
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception',
   'document_uploaded'));

DROP TABLE IF EXISTS hsdg.audit_framework_work_link CASCADE;
DROP TABLE IF EXISTS hsdg.audit_framework_impact CASCADE;
DROP TABLE IF EXISTS hsdg.audit_framework_memo CASCADE;
DROP FUNCTION IF EXISTS hsdg.audit_framework_memo_guard();

DELETE FROM hsdg.document_template_versions v
 USING hsdg.document_templates t
 WHERE v.template_id = t.id AND t.template_key = 'audit_framework_memorandum';
DELETE FROM hsdg.document_templates WHERE template_key = 'audit_framework_memorandum';
ALTER TABLE hsdg.document_templates DROP CONSTRAINT document_templates_template_key_check;
ALTER TABLE hsdg.document_templates ADD CONSTRAINT document_templates_template_key_check
  CHECK (template_key IN (
    'previous_auditor_communication','auditor_consent_certificate',
    'engagement_letter','client_acknowledgement','financial_reporting_framework_memo',
    'schedule_iii_presentation_memo',
    'fs_workbook_as_div_i','fs_workbook_indas_div_ii','fs_workbook_indas_div_iii',
    'caro_applicability_memo','icfr_applicability_memo',
    'consolidation_group_audit_memo','component_auditor_instructions'));

ALTER TABLE hsdg.audit_matter
  DROP COLUMN IF EXISTS return_note,
  DROP COLUMN IF EXISTS returned_by_employee_id,
  DROP COLUMN IF EXISTS returned_at,
  DROP COLUMN IF EXISTS partner_attention,
  DROP COLUMN IF EXISTS impact;
