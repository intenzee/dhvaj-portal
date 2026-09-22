-- ─────────────────────────────────────────────────────────────────────────
-- 0061 · Statutory Audit — 02.8 Audit Framework Baseline (summary & approval) §9.8/§13
--
-- The closure/control record for Section 02. One row per baseline VERSION per
-- statutory-audit shell: v1.0 on first approval, v1.1+ on each controlled reopen.
-- It carries the two approval gates (AF-01 Manager confirmation, AF-02 EP
-- approval), the frozen methodology version + cited rule-version ids + an
-- immutable dashboard snapshot, and the reopen reason. It decides nothing on its
-- own — 02.8 aggregates the 02.2–02.7 sub-assessments and the 02.1 profile.
--
-- SECURITY — engagement child data: members SELECT, only leads INSERT/UPDATE.
-- ENABLE (not FORCE) RLS so migrator-owned helpers bypass. Mirrors the
-- audit_framework_subassessment policies (migration 0055).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_framework_baseline (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version                  text NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+$'),
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN
                             ('draft','manager_confirmed','approved','superseded')),
  methodology_version      text,
  snapshot                 jsonb,
  rule_version_ids         uuid[] NOT NULL DEFAULT '{}',
  memo_document_id         uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  manager_confirmed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  manager_confirmed_at     timestamptz,
  ep_approved_by_employee_id       uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ep_approved_at           timestamptz,
  reopen_reason            text,
  record_version           integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, version)
);
CREATE INDEX audit_framework_baseline_engagement_idx
  ON hsdg.audit_framework_baseline (engagement_id);
CREATE INDEX audit_framework_baseline_instance_idx
  ON hsdg.audit_framework_baseline (workflow_instance_id);
CREATE TRIGGER audit_framework_baseline_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_baseline
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_framework_baseline ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_baseline_select ON hsdg.audit_framework_baseline
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_baseline_insert ON hsdg.audit_framework_baseline
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_framework_baseline_update ON hsdg.audit_framework_baseline
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_framework_baseline CASCADE;
