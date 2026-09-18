-- ─────────────────────────────────────────────────────────────────────────
-- 0049 · Statutory Audit — Change-Impact / Reassessment  (SA-9 · §29, §30)
--
-- Change-impact is CONTROLLED (§30): when an upstream professional input changes
-- (materiality, risk, framework rule version, a new subsidiary, …), the affected
-- downstream work is FLAGGED for reassessment — never silently deleted. Each
-- reassessment is one append-only event recording the change TYPE (the §30
-- table), the professional REASON, the controlled IMPACT it applied and its
-- open/resolved lifecycle. The full mutation trail (which areas/phases moved,
-- which approvals were cleared) lives in the §32 immutable event log; this table
-- is the professional register the Reassessment screen reads.
--
-- Raising an event re-opens the affected layers by moving their objects to the
-- first-class attention states the earlier slices already model (framework areas
-- → reassessment_required, work areas → needs_attention + conclusion reset to
-- draft, phases → needs_attention) and, if the file was completion-approved or
-- signed off, clears that approval so the §29 gate re-blocks — all in the service.
--
-- SECURITY — engagement child data, same assignment-based access as the SA-2..SA-8
-- tables: members SELECT, only leads (EP/manager) INSERT/UPDATE. ENABLE (not
-- FORCE) RLS so the migrator-owned SECURITY DEFINER helpers bypass. No new
-- permission slug (endpoints reuse engagement.read / engagement.manage; RLS
-- gates). Append-only: no DELETE policy.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_reassessments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- The controlled change type (§30 table).
  change_type           text NOT NULL CHECK (change_type IN (
                          'materiality_revised','risk_changed','audit_approach_changed',
                          'new_subsidiary','caro_ifc_applicability','reporting_date_changed',
                          'specialist_required','new_significant_transaction',
                          'framework_rule_version_changed')),
  -- The professional reason for the change (§30 — always recorded).
  reason                text NOT NULL CHECK (length(trim(reason)) > 0),
  -- The layers this event re-opened { framework, planning, risk, work, reporting }.
  impact                jsonb NOT NULL,
  -- A short human summary of what was flagged (areas / work / phases).
  affected_summary      text,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  raised_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  resolved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  resolved_at           timestamptz,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- A resolved event records who resolved it and when.
  CONSTRAINT reassessment_resolved_shape CHECK (
    status <> 'resolved' OR (resolved_by_employee_id IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX audit_reassessments_instance_idx ON hsdg.audit_reassessments (workflow_instance_id);
CREATE INDEX audit_reassessments_engagement_idx ON hsdg.audit_reassessments (engagement_id);
CREATE INDEX audit_reassessments_status_idx ON hsdg.audit_reassessments (status);
CREATE TRIGGER audit_reassessments_set_updated_at
  BEFORE UPDATE ON hsdg.audit_reassessments
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_reassessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_reassessments_select ON hsdg.audit_reassessments
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_reassessments_insert ON hsdg.audit_reassessments
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_reassessments_update ON hsdg.audit_reassessments
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_reassessments CASCADE;
