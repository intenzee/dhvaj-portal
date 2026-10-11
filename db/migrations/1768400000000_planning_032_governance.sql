-- ─────────────────────────────────────────────────────────────────────────
-- 03.2 Business Understanding & Preliminary Analytics — governance, revision
-- and evidence (DHVAJ 03.2 §18, §20, §21, §23, §25; Track A of the 03.2 gap
-- build).
--
--   • §23 permissions — Article / Senior (engagement team members) enter the
--     factual business and financial data, attach evidence and prepare the
--     investigation draft; only the Engagement Manager (or an EP acting as
--     Manager) assesses exceptions, decides signals, confirms understanding
--     and answers BA-01. RLS is widened to members on the 03.2 fact tables,
--     exactly as 03.1 governance did; the API enforces the per-role matrix
--     (PlanningGovernanceGuard + field-level checks).
--   • audit_business_understanding — version number (v1.0 → v1.1), who
--     completed it, a system "reassessment required" state with its reason,
--     and the Manager's per-item decision on the suggested industry
--     considerations.
--   • audit_understanding_revision — controlled revision of a completed 03.2
--     with a frozen baseline (§20 "controlled revision after approval").
--   • audit_understanding_challenge — Engagement Partner comments /
--     challenges on 03.2 and the Manager's response (§23 "view / challenge").
--   • audit_financial_value — prior-year figures rolled forward from last
--     year's file keep their origin; changing one needs a recorded override
--     reason (§21 "do not silently overwrite").
--   • audit_planning_evidence — 03.2 targets (section, dataset, Investigation
--     Card, expectation) on the same SharePoint-backed evidence store (§20).
--   • Authority Library — SA 520 (and RBI's NBFC directions for the NBFC
--     profile) plus the '03.2' View Provision links (§25).
--   • notifications gain the two 03.2 types.
--
-- RLS: ENABLE (not FORCE) like every 03.x table; members SELECT.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── §23 the engagement team writes the 03.2 facts ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_business_understanding','audit_understanding_section',
                           'audit_financial_dataset','audit_financial_custom_metric',
                           'audit_financial_value','audit_analytics_exception',
                           'audit_planning_expectation']
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_member(engagement_id)) WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_update', t);
  END LOOP;
END $$;
-- Clearing a figure is a data-entry step too.
DROP POLICY audit_financial_value_delete ON hsdg.audit_financial_value;
CREATE POLICY audit_financial_value_delete ON hsdg.audit_financial_value
  FOR DELETE USING (hsdg.is_engagement_member(engagement_id));

-- A Senior's first save moves the 03.2 checklist row to In progress.
DROP POLICY audit_planning_items_update ON hsdg.audit_planning_items;
CREATE POLICY audit_planning_items_update ON hsdg.audit_planning_items
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id) AND item_key = 'engagement_understanding')
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id) AND item_key = 'engagement_understanding')
  );

-- ── 03.2 record: version, completion, reassessment, consideration decisions ─
ALTER TABLE hsdg.audit_business_understanding
  DROP CONSTRAINT audit_business_understanding_status_check;
ALTER TABLE hsdg.audit_business_understanding
  ADD CONSTRAINT audit_business_understanding_status_check CHECK (status IN
    ('not_started','in_progress','complete','reassessment_required'));
ALTER TABLE hsdg.audit_business_understanding
  ADD COLUMN version_no               integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  ADD COLUMN completed_at             timestamptz,
  ADD COLUMN completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- Why a completed 03.2 needs reassessment (a source figure / methodology change).
  ADD COLUMN reassessment_reason      text,
  ADD COLUMN reassessment_flagged_at  timestamptz,
  -- { "<suggested consideration text>": { "relevant": bool, "note": text|null,
  --   "by": uuid, "at": iso } } — the Manager's confirmation per item (§7).
  ADD COLUMN industry_consideration_decisions jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE hsdg.audit_business_understanding
   SET completed_at = updated_at
 WHERE status = 'complete' AND completed_at IS NULL;

-- ── §20 controlled revision of a completed 03.2 ───────────────────────────
CREATE TABLE hsdg.audit_understanding_revision (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  from_version_no          integer NOT NULL CHECK (from_version_no >= 1),
  to_version_no            integer NOT NULL,
  reason                   text NOT NULL CHECK (length(trim(reason)) > 0),
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  -- Frozen snapshot of the completed version (record, sections, dataset,
  -- figures, Investigation Cards, expectations). Never rewritten.
  baseline                 jsonb NOT NULL,
  opened_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  opened_at                timestamptz NOT NULL DEFAULT now(),
  completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  completed_at             timestamptz,
  CONSTRAINT audit_understanding_revision_next CHECK (to_version_no = from_version_no + 1),
  UNIQUE (workflow_instance_id, to_version_no)
);
CREATE UNIQUE INDEX audit_understanding_revision_one_open
  ON hsdg.audit_understanding_revision (workflow_instance_id) WHERE status = 'open';
CREATE INDEX audit_understanding_revision_engagement_idx
  ON hsdg.audit_understanding_revision (engagement_id);

-- The baseline is evidence of what was concluded: never edited.
CREATE FUNCTION hsdg.audit_understanding_revision_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.baseline IS DISTINCT FROM OLD.baseline
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.from_version_no IS DISTINCT FROM OLD.from_version_no THEN
    RAISE EXCEPTION 'A 03.2 revision baseline cannot be changed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_understanding_revision_immutable
  BEFORE UPDATE ON hsdg.audit_understanding_revision
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_understanding_revision_immutable();

ALTER TABLE hsdg.audit_understanding_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_understanding_revision_select ON hsdg.audit_understanding_revision
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
-- Members: a figure refresh by the team can flag a completed 03.2 for
-- reassessment, which freezes its baseline; who may reopen is the API's call.
CREATE POLICY audit_understanding_revision_insert ON hsdg.audit_understanding_revision
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_understanding_revision_update ON hsdg.audit_understanding_revision
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── §23 Engagement Partner comment / challenge on 03.2 ────────────────────
CREATE TABLE hsdg.audit_understanding_challenge (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Per-instance sequence behind the display code PC-00n.
  seq                      integer NOT NULL,
  target_type              text NOT NULL CHECK (target_type IN
                             ('section','dataset','analytics','exception','expectation','conclusion')),
  -- Section key, Investigation Card / expectation id, or NULL for the whole area.
  target_ref               text CHECK (target_ref IS NULL OR length(target_ref) <= 80),
  kind                     text NOT NULL CHECK (kind IN ('comment','challenge')),
  body                     text NOT NULL CHECK (length(trim(body)) > 0),
  raised_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  raised_at                timestamptz NOT NULL DEFAULT now(),
  response                 text,
  responded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  responded_at             timestamptz,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','closed')),
  closed_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  closed_at                timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, seq),
  CONSTRAINT audit_understanding_challenge_response CHECK (
    status = 'open' OR kind = 'comment' OR (response IS NOT NULL AND length(trim(response)) > 0)
  )
);
CREATE INDEX audit_understanding_challenge_instance_idx
  ON hsdg.audit_understanding_challenge (workflow_instance_id);
CREATE INDEX audit_understanding_challenge_engagement_idx
  ON hsdg.audit_understanding_challenge (engagement_id);
CREATE TRIGGER audit_understanding_challenge_set_updated_at
  BEFORE UPDATE ON hsdg.audit_understanding_challenge
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_understanding_challenge ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_understanding_challenge_select ON hsdg.audit_understanding_challenge
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_understanding_challenge_insert ON hsdg.audit_understanding_challenge
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_understanding_challenge_update ON hsdg.audit_understanding_challenge
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── §21 prior-year figures rolled forward from last year's file ───────────
ALTER TABLE hsdg.audit_financial_value
  ADD COLUMN rolled_forward_from_instance_id uuid
    REFERENCES hsdg.service_workflow_instances (id) ON DELETE SET NULL,
  ADD COLUMN rolled_forward_amount   numeric(20,2),
  -- Last year's 03.2 was completed (BA-01) when the figure was brought forward.
  ADD COLUMN rolled_forward_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN override_reason         text,
  -- A changed approved roll-forward always carries its reason.
  ADD CONSTRAINT audit_financial_value_rollforward_override CHECK (
    NOT rolled_forward_approved
    OR rolled_forward_amount IS NULL
    OR amount = rolled_forward_amount
    OR (override_reason IS NOT NULL AND length(trim(override_reason)) > 0)
  );

-- ── §20 evidence on 03.2 records ──────────────────────────────────────────
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion',
     'understanding_section','financial_dataset','analytics_exception','planning_expectation'));

-- ── §25 Authority Library ─────────────────────────────────────────────────
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, source_reference,
   reference_kind, summary)
VALUES
  ('SA_520', 'ICAI', 'Analytical Procedures', 'SA 520', '2010-04-01',
   'ICAI Standard on Auditing 520', 'standard',
   'Deals with the auditor''s use of analytical procedures as substantive procedures and near the '
   || 'end of the audit, and with investigating fluctuations or relationships that are inconsistent '
   || 'with other relevant information or differ significantly from expected values. Planning-stage '
   || 'analytics (SA 315) are not substantive evidence by default.'),
  ('RBI_NBFC_SBR', 'RBI',
   'Master Direction — Reserve Bank of India (Non-Banking Financial Company — Scale Based Regulation) Directions, 2023',
   'RBI/DoR/2023-24/106', '2023-10-19',
   'RBI Master Direction DoR.FIN.REC.No.45/03.10.119/2023-24', 'guidance',
   'The consolidated regulatory framework for NBFCs by layer (base, middle, upper, top): capital '
   || 'adequacy, asset classification and provisioning, concentration and governance requirements. '
   || 'Sector metrics replace generic working-capital analytics for an NBFC.')
ON CONFLICT (code, version_no) DO NOTHING;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('03.2', 'view_sa_315',          'View SA 315',                          'SA_315',       10),
  ('03.2', 'view_sa_520',          'View SA 520',                          'SA_520',       20),
  ('03.2', 'view_sa_300',          'View SA 300',                          'SA_300',       30),
  ('03.2', 'view_ig_rba',          'View Implementation Guide to RBA',     'IG_RBA',       40),
  ('03.2', 'industry_construction','View Ind AS 115 (contract revenue)',   'INDAS_115',   110),
  ('03.2', 'industry_construction_as','View AS 9 (revenue recognition)',   'AS_9',        120),
  ('03.2', 'industry_nbfc',        'View RBI NBFC Scale Based Regulation', 'RBI_NBFC_SBR',130)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- ── notifications ─────────────────────────────────────────────────────────
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
   'framework_reopened','framework_work_impacted',
   'planning_signal_alert','planning_partner_attention','planning_strategy_reopened',
   'planning_understanding_reassessment','planning_understanding_challenge'));

-- Down Migration

DELETE FROM hsdg.notifications
 WHERE type IN ('planning_understanding_reassessment','planning_understanding_challenge');
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
   'framework_reopened','framework_work_impacted',
   'planning_signal_alert','planning_partner_attention','planning_strategy_reopened'));

ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '03.2';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_provision
 WHERE code IN ('SA_520','RBI_NBFC_SBR') AND version_no = 1
   AND NOT EXISTS (SELECT 1 FROM hsdg.authority_reference_link l
                    WHERE l.provision_code = authority_provision.code);
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.audit_planning_evidence
 WHERE target_type IN ('understanding_section','financial_dataset','analytics_exception',
                       'planning_expectation');
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion'));

ALTER TABLE hsdg.audit_financial_value
  DROP CONSTRAINT IF EXISTS audit_financial_value_rollforward_override,
  DROP COLUMN IF EXISTS override_reason,
  DROP COLUMN IF EXISTS rolled_forward_approved,
  DROP COLUMN IF EXISTS rolled_forward_amount,
  DROP COLUMN IF EXISTS rolled_forward_from_instance_id;

DROP TABLE IF EXISTS hsdg.audit_understanding_challenge CASCADE;
DROP TABLE IF EXISTS hsdg.audit_understanding_revision CASCADE;
DROP FUNCTION IF EXISTS hsdg.audit_understanding_revision_immutable();

UPDATE hsdg.audit_business_understanding SET status = 'in_progress'
 WHERE status = 'reassessment_required';
ALTER TABLE hsdg.audit_business_understanding
  DROP COLUMN IF EXISTS industry_consideration_decisions,
  DROP COLUMN IF EXISTS reassessment_flagged_at,
  DROP COLUMN IF EXISTS reassessment_reason,
  DROP COLUMN IF EXISTS completed_by_employee_id,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS version_no;
ALTER TABLE hsdg.audit_business_understanding
  DROP CONSTRAINT audit_business_understanding_status_check;
ALTER TABLE hsdg.audit_business_understanding
  ADD CONSTRAINT audit_business_understanding_status_check CHECK (status IN
    ('not_started','in_progress','complete'));

DROP POLICY audit_planning_items_update ON hsdg.audit_planning_items;
CREATE POLICY audit_planning_items_update ON hsdg.audit_planning_items
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

DROP POLICY audit_financial_value_delete ON hsdg.audit_financial_value;
CREATE POLICY audit_financial_value_delete ON hsdg.audit_financial_value
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_business_understanding','audit_understanding_section',
                           'audit_financial_dataset','audit_financial_custom_metric',
                           'audit_financial_value','audit_analytics_exception',
                           'audit_planning_expectation']
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
  END LOOP;
END $$;
