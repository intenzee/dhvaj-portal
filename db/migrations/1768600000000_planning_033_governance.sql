-- ─────────────────────────────────────────────────────────────────────────
-- 03.3 Materiality — governance, reassessment and evidence (DHVAJ 03.3 §20,
-- §21, §23; Track A of the 03.3 gap build).
--
--   • §23 permissions — Article / Senior (engagement team members) prepare
--     the source data, prior-year figures, user context and the normalisation
--     adjustment schedule; only the Engagement Manager (or an EP acting as
--     Manager) assesses benchmarks, determines OM / PM / specific / clearly
--     trivial and completes 03.3 (MAT-08). RLS is widened to members on the
--     determination, the adjustment schedule and the system-derived revision
--     items, exactly as 03.1 / 03.2 governance did; the API enforces the
--     per-role matrix (PlanningGovernanceGuard + field-level checks).
--   • audit_materiality_determination — a "reassessment required" flag on a
--     completed version: raised by a 03.2 source-figure change (§20
--     "flags existing conclusion for reassessment; never silently changes
--     approved OM") or by the Engagement Partner (§23 "require
--     reassessment"), resolved by a revision or a reasoned Manager decision.
--   • audit_materiality_challenge — Engagement Partner comments / challenges
--     on 03.3 and the Manager's response (§23 "view / challenge").
--   • audit_planning_evidence — 03.3 targets (the determination, an
--     adjustment line, a specific materiality record, a qualitative item) on
--     the same SharePoint-backed evidence store (§21).
--   • notifications gain the two 03.3 types.
--
-- RLS: ENABLE (not FORCE) like every 03.x table; members SELECT.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── §23 the engagement team prepares the 03.3 source data ────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_materiality_determination','audit_materiality_adjustment',
                           'audit_materiality_revision_item']
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_member(engagement_id)) WITH CHECK (hsdg.is_engagement_member(engagement_id))', t || '_update', t);
  END LOOP;
END $$;
-- Removing a draft adjustment line is a preparation step too.
DROP POLICY audit_materiality_adjustment_delete ON hsdg.audit_materiality_adjustment;
CREATE POLICY audit_materiality_adjustment_delete ON hsdg.audit_materiality_adjustment
  FOR DELETE USING (hsdg.is_engagement_member(engagement_id));

-- A Senior's first save moves the 03.2 / 03.3 checklist row to In progress.
DROP POLICY audit_planning_items_update ON hsdg.audit_planning_items;
CREATE POLICY audit_planning_items_update ON hsdg.audit_planning_items
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality'))
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND item_key IN ('engagement_understanding','materiality'))
  );

-- ── §20 / §23 reassessment of a completed determination ──────────────────
ALTER TABLE hsdg.audit_materiality_determination
  -- What raised it: a 03.2 source-figure change, or the Engagement Partner.
  ADD COLUMN reassessment_source      text CHECK (reassessment_source IS NULL OR
                                        reassessment_source IN ('source_change','partner')),
  ADD COLUMN reassessment_reason      text,
  ADD COLUMN reassessment_flagged_at  timestamptz,
  ADD COLUMN reassessment_flagged_by_employee_id uuid
    REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- The Manager's decision ("no change, because …") or the revision that took it over.
  ADD COLUMN reassessment_resolution  text,
  ADD COLUMN reassessment_resolved_at timestamptz,
  ADD COLUMN reassessment_resolved_by_employee_id uuid
    REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- The live 03.2 benchmark amount the Manager reassessed against (dataset
  -- units): the next source check compares with this, not the selection snapshot.
  ADD COLUMN reassessed_benchmark_amount numeric(20,2),
  ADD CONSTRAINT audit_materiality_reassessment_shape CHECK (
    reassessment_flagged_at IS NULL
    OR (reassessment_source IS NOT NULL AND reassessment_reason IS NOT NULL
        AND length(trim(reassessment_reason)) > 0)
  ),
  ADD CONSTRAINT audit_materiality_reassessment_resolved CHECK (
    reassessment_resolved_at IS NULL
    OR (reassessment_flagged_at IS NOT NULL AND reassessment_resolution IS NOT NULL
        AND length(trim(reassessment_resolution)) > 0)
  );

-- ── §23 Engagement Partner comment / challenge on 03.3 ────────────────────
CREATE TABLE hsdg.audit_materiality_challenge (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Per-instance sequence behind the display code PC-00n.
  seq                      integer NOT NULL,
  -- The 03.3 version the comment was raised on (v1.0 → 1, v1.1 → 2, …).
  determination_version_no integer NOT NULL CHECK (determination_version_no >= 1),
  target_type              text NOT NULL CHECK (target_type IN
                             ('context','benchmarks','normalisation','overall','performance',
                              'specific','clearly_trivial','qualitative','sensitivity','revision',
                              'conclusion')),
  -- A candidate benchmark key, SM-00n record, consideration key … or NULL for the whole area.
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
  CONSTRAINT audit_materiality_challenge_response CHECK (
    status = 'open' OR kind = 'comment' OR (response IS NOT NULL AND length(trim(response)) > 0)
  )
);
CREATE INDEX audit_materiality_challenge_engagement_idx
  ON hsdg.audit_materiality_challenge (engagement_id);
CREATE TRIGGER audit_materiality_challenge_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality_challenge
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_materiality_challenge ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_materiality_challenge_select ON hsdg.audit_materiality_challenge
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_materiality_challenge_insert ON hsdg.audit_materiality_challenge
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_materiality_challenge_update ON hsdg.audit_materiality_challenge
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── §21 evidence on 03.3 records ──────────────────────────────────────────
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion',
     'understanding_section','financial_dataset','analytics_exception','planning_expectation',
     'materiality_determination','materiality_adjustment','materiality_specific',
     'materiality_qualitative'));

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
   'planning_understanding_reassessment','planning_understanding_challenge',
   'planning_materiality_reassessment','planning_materiality_challenge'));

-- Down Migration

DELETE FROM hsdg.notifications
 WHERE type IN ('planning_materiality_reassessment','planning_materiality_challenge');
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

DELETE FROM hsdg.audit_planning_evidence
 WHERE target_type IN ('materiality_determination','materiality_adjustment',
                       'materiality_specific','materiality_qualitative');
ALTER TABLE hsdg.audit_planning_evidence
  DROP CONSTRAINT audit_planning_evidence_target_type_check;
ALTER TABLE hsdg.audit_planning_evidence
  ADD CONSTRAINT audit_planning_evidence_target_type_check CHECK (target_type IN
    ('signal','change','prior_year','acceptance','discussion',
     'understanding_section','financial_dataset','analytics_exception','planning_expectation'));

DROP TABLE IF EXISTS hsdg.audit_materiality_challenge CASCADE;

ALTER TABLE hsdg.audit_materiality_determination
  DROP CONSTRAINT IF EXISTS audit_materiality_reassessment_resolved,
  DROP CONSTRAINT IF EXISTS audit_materiality_reassessment_shape,
  DROP COLUMN IF EXISTS reassessed_benchmark_amount,
  DROP COLUMN IF EXISTS reassessment_resolved_by_employee_id,
  DROP COLUMN IF EXISTS reassessment_resolved_at,
  DROP COLUMN IF EXISTS reassessment_resolution,
  DROP COLUMN IF EXISTS reassessment_flagged_by_employee_id,
  DROP COLUMN IF EXISTS reassessment_flagged_at,
  DROP COLUMN IF EXISTS reassessment_reason,
  DROP COLUMN IF EXISTS reassessment_source;

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

DROP POLICY audit_materiality_adjustment_delete ON hsdg.audit_materiality_adjustment;
CREATE POLICY audit_materiality_adjustment_delete ON hsdg.audit_materiality_adjustment
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_materiality_determination','audit_materiality_adjustment',
                           'audit_materiality_revision_item']
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY %I ON hsdg.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
  END LOOP;
END $$;
