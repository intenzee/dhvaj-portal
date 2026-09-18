-- ─────────────────────────────────────────────────────────────────────────
-- 0042 · Statutory Audit — Framework (Phase 02)  (SA-2 · Audit Spec §18–§20, §33)
--
-- The Framework layer determines WHAT applies (§1). For each regulatory area the
-- system may offer an advisory SUGGESTION from the entity's facts, but the
-- professional records the CONCLUSION (§19). Approving the Framework Memo freezes
-- the conclusions (a versioned, immutable snapshot) and marks Phase 02 complete —
-- the gate for meaningful Planning and later dynamic work generation (§20).
--
-- THREE TABLES (§33 audit_framework_assessment / _evidence / _approval):
--   • audit_framework_assessments — one row per area per shell, carrying the §19
--     applicability state, the system suggestion + basis, and the professional
--     conclusion + basis + impact. Seeded (16 areas) with the shell.
--   • audit_framework_evidence — evidence supporting a conclusion; may point at an
--     existing hsdg.documents row or carry a free-text note. Never duplicates the
--     source file (§16).
--   • audit_framework_approvals — the Framework Memo, versioned. Each approval
--     snapshots the conclusions as jsonb so history is never rewritten (§30).
--
-- IDEMPOTENCY (§36): UNIQUE (workflow_instance_id, area_key) means seeding is safe
-- to repeat; the app seeds with ON CONFLICT DO NOTHING. Approvals are versioned
-- UNIQUE (workflow_instance_id, version) so re-approval appends, never overwrites.
--
-- SECURITY — engagement child data, same assignment-based access as the shell
-- (1762100000000): members SELECT, only leads (EP/manager) INSERT/UPDATE. ENABLE
-- (not FORCE) RLS so the migrator-owned SECURITY DEFINER helpers bypass and avoid
-- recursion; hsdg_app is never the owner. No new permission slug (endpoints reuse
-- engagement.read / engagement.manage; RLS does the real gating).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Framework assessments (one per area per shell) ────────────────────────
CREATE TABLE hsdg.audit_framework_assessments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  area_key              text NOT NULL CHECK (area_key ~ '^[a-z0-9_]{2,60}$'),
  title                 text NOT NULL CHECK (length(trim(title)) > 0),
  kind                  text NOT NULL DEFAULT 'applicability'
                          CHECK (kind IN ('applicability','descriptive')),
  -- §19 applicability state model.
  state                 text NOT NULL DEFAULT 'not_assessed' CHECK (state IN
                          ('not_assessed','pending_information','system_suggested_applicable',
                           'system_suggested_not_applicable','professional_judgement_required',
                           'applicable','not_applicable','overridden','reassessment_required',
                           'approved')),
  -- Advisory rule-engine suggestion (never a decision).
  system_suggestion     text CHECK (system_suggestion IN ('applicable','not_applicable')),
  system_basis          text,
  -- Professional conclusion.
  conclusion            text CHECK (conclusion IN ('applicable','not_applicable')),
  is_overridden         boolean NOT NULL DEFAULT false,
  basis                 text,
  impact                text,
  reviewer_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  decided_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at            timestamptz,
  sort_order            integer NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, area_key),
  -- An overridden conclusion must carry a basis (§19).
  CONSTRAINT framework_override_needs_basis CHECK (
    is_overridden = false OR (basis IS NOT NULL AND length(trim(basis)) > 0)
  )
);
CREATE INDEX audit_framework_assessments_instance_idx
  ON hsdg.audit_framework_assessments (workflow_instance_id);
CREATE INDEX audit_framework_assessments_engagement_idx
  ON hsdg.audit_framework_assessments (engagement_id);
CREATE TRIGGER audit_framework_assessments_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_assessments
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Evidence supporting a conclusion ──────────────────────────────────────
CREATE TABLE hsdg.audit_framework_evidence (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id          uuid NOT NULL
                           REFERENCES hsdg.audit_framework_assessments (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Points at an existing document (never a duplicate copy), or is a note.
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  note                   text,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- Evidence must be one of the two (a linked document or a note).
  CONSTRAINT framework_evidence_has_content CHECK (
    document_id IS NOT NULL OR (note IS NOT NULL AND length(trim(note)) > 0)
  )
);
CREATE INDEX audit_framework_evidence_assessment_idx
  ON hsdg.audit_framework_evidence (assessment_id);
CREATE INDEX audit_framework_evidence_engagement_idx
  ON hsdg.audit_framework_evidence (engagement_id);
CREATE INDEX audit_framework_evidence_document_idx
  ON hsdg.audit_framework_evidence (document_id);

-- ── Framework Memo approvals (versioned, immutable) ───────────────────────
CREATE TABLE hsdg.audit_framework_approvals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version                integer NOT NULL,
  memo                   text,
  -- Immutable snapshot of the conclusions at approval time (§30 do not rewrite
  -- history); [{ areaKey, conclusion, isOverridden }].
  snapshot               jsonb NOT NULL,
  approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  approved_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, version)
);
CREATE INDEX audit_framework_approvals_instance_idx
  ON hsdg.audit_framework_approvals (workflow_instance_id);
CREATE INDEX audit_framework_approvals_engagement_idx
  ON hsdg.audit_framework_approvals (engagement_id);

-- ── Row Level Security (mirrors service_workflow_instances) ────────────────
ALTER TABLE hsdg.audit_framework_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_assessments_select ON hsdg.audit_framework_assessments
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_assessments_insert ON hsdg.audit_framework_assessments
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_framework_assessments_update ON hsdg.audit_framework_assessments
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_framework_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_evidence_select ON hsdg.audit_framework_evidence
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_evidence_insert ON hsdg.audit_framework_evidence
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_framework_evidence_delete ON hsdg.audit_framework_evidence
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_framework_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_approvals_select ON hsdg.audit_framework_approvals
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_approvals_insert ON hsdg.audit_framework_approvals
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_framework_approvals CASCADE;
DROP TABLE IF EXISTS hsdg.audit_framework_evidence CASCADE;
DROP TABLE IF EXISTS hsdg.audit_framework_assessments CASCADE;
