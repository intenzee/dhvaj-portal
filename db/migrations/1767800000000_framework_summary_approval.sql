-- ─────────────────────────────────────────────────────────────────────────
-- 02.8 Audit Framework Summary & Approval — Track A (spec v1.0 §9, §12–§15, §18)
--
-- Extends the Audit Framework Baseline (migration 1764100000000) with the full
-- approval record and controlled-reopen fields, and adds:
--   • audit_framework_condition — AF-02 "Approve Subject to Conditions" (§12):
--     condition, owner, due date, impact, whether Planning may commence.
--   • audit_framework_return    — AF-01 "No – Further Work Required" and AF-02
--     "Return for Further Work" items sent back to a source section (§9, §12).
-- An approved baseline is immutable (§13–§14): only its supersession on a
-- controlled reopen may touch it, and baselines are never deleted while the
-- engagement exists.
--
-- SECURITY — engagement child data: members SELECT, leads INSERT/UPDATE (the
-- service additionally restricts AF-02 to the Engagement Partner). ENABLE (not
-- FORCE) RLS so migrator-owned helpers bypass.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_framework_baseline
  ADD COLUMN preview_reviewed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN preview_reviewed_at        timestamptz,
  ADD COLUMN manager_note               text,
  ADD COLUMN ep_decision                text CHECK (ep_decision IS NULL OR ep_decision IN
                                          ('approve','approve_subject_to_conditions')),
  ADD COLUMN audit_period               text,
  ADD COLUMN rule_versions              jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN memo_version               text,
  ADD COLUMN memo_reference             text,
  ADD COLUMN reopen_affected_sections   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN reopen_identified_at       timestamptz,
  ADD COLUMN reopen_identified_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN reopen_evidence_note       text,
  ADD COLUMN reopen_evidence_document_id uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  ADD COLUMN reopen_reapproval_required boolean,
  ADD COLUMN reopened_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN reopened_at                timestamptz,
  ADD COLUMN reopened_from_version      text,
  ADD COLUMN superseded_at              timestamptz;

-- Baselines approved before this migration recorded a plain approval.
UPDATE hsdg.audit_framework_baseline
   SET ep_decision = 'approve',
       methodology_version = COALESCE(methodology_version, 'Audit Framework v' || version),
       snapshot = COALESCE(snapshot, '{}'::jsonb)
 WHERE ep_approved_at IS NOT NULL AND ep_decision IS NULL;

ALTER TABLE hsdg.audit_framework_baseline
  ADD CONSTRAINT audit_framework_baseline_reopen_sections CHECK (
    reopen_affected_sections <@ ARRAY['02.1','02.2','02.3','02.4','02.5','02.6','02.7','other_areas']::text[]
  ),
  ADD CONSTRAINT audit_framework_baseline_approved_record CHECK (
    status NOT IN ('approved') OR (ep_approved_at IS NOT NULL AND ep_decision IS NOT NULL
                                   AND methodology_version IS NOT NULL AND snapshot IS NOT NULL)
  );

-- At most one live (non-superseded) baseline per audit file.
CREATE UNIQUE INDEX audit_framework_baseline_one_live
  ON hsdg.audit_framework_baseline (workflow_instance_id) WHERE status <> 'superseded';

-- §13–§14 immutability: an approved baseline can only be superseded (status +
-- superseded_at + record_version); a superseded one never changes again.
CREATE FUNCTION hsdg.audit_framework_baseline_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A direct delete (depth 1) is refused; a cascade from the engagement /
    -- audit file being removed (RI trigger, depth > 1) is allowed.
    IF OLD.ep_approved_at IS NOT NULL AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'An approved Audit Framework baseline is preserved permanently'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'A superseded Audit Framework baseline cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'approved' AND (
       NEW.status <> 'superseded'
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.rule_versions IS DISTINCT FROM OLD.rule_versions
    OR NEW.rule_version_ids IS DISTINCT FROM OLD.rule_version_ids
    OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version
    OR NEW.ep_approved_at IS DISTINCT FROM OLD.ep_approved_at
    OR NEW.ep_approved_by_employee_id IS DISTINCT FROM OLD.ep_approved_by_employee_id
    OR NEW.ep_decision IS DISTINCT FROM OLD.ep_decision
    OR NEW.memo_document_id IS DISTINCT FROM OLD.memo_document_id
    OR NEW.memo_version IS DISTINCT FROM OLD.memo_version
    OR NEW.manager_confirmed_at IS DISTINCT FROM OLD.manager_confirmed_at
    OR NEW.audit_period IS DISTINCT FROM OLD.audit_period
  ) THEN
    RAISE EXCEPTION 'An approved Audit Framework baseline is immutable; reopen it to revise'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_framework_baseline_guard
  BEFORE UPDATE OR DELETE ON hsdg.audit_framework_baseline
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_framework_baseline_guard();

CREATE TABLE hsdg.audit_framework_condition (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id            uuid NOT NULL REFERENCES hsdg.audit_framework_baseline (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  condition              text NOT NULL CHECK (length(trim(condition)) > 0),
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  due_date               date NOT NULL,
  impact                 text NOT NULL CHECK (length(trim(impact)) > 0),
  planning_may_commence  boolean NOT NULL,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution             text,
  resolved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  resolved_at            timestamptz,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_framework_condition_resolved CHECK (
    status = 'open' OR (resolution IS NOT NULL AND length(trim(resolution)) > 0 AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX audit_framework_condition_baseline_idx ON hsdg.audit_framework_condition (baseline_id);
CREATE INDEX audit_framework_condition_instance_idx
  ON hsdg.audit_framework_condition (workflow_instance_id);
CREATE INDEX audit_framework_condition_engagement_idx
  ON hsdg.audit_framework_condition (engagement_id);
CREATE TRIGGER audit_framework_condition_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_condition
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_framework_return (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id            uuid NOT NULL REFERENCES hsdg.audit_framework_baseline (id) ON DELETE CASCADE,
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  gate                   text NOT NULL CHECK (gate IN ('AF-01','AF-02')),
  section                text NOT NULL CHECK (section IN
                           ('02.1','02.2','02.3','02.4','02.5','02.6','02.7','other_areas')),
  action                 text NOT NULL CHECK (length(trim(action)) > 0),
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution             text,
  raised_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  raised_at              timestamptz NOT NULL DEFAULT now(),
  resolved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  resolved_at            timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_framework_return_resolved CHECK (
    status = 'open' OR (resolution IS NOT NULL AND length(trim(resolution)) > 0 AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX audit_framework_return_instance_idx
  ON hsdg.audit_framework_return (workflow_instance_id, status);
CREATE INDEX audit_framework_return_engagement_idx ON hsdg.audit_framework_return (engagement_id);
CREATE INDEX audit_framework_return_baseline_idx ON hsdg.audit_framework_return (baseline_id);
CREATE TRIGGER audit_framework_return_set_updated_at
  BEFORE UPDATE ON hsdg.audit_framework_return
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_framework_condition ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_condition_select ON hsdg.audit_framework_condition
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_condition_insert ON hsdg.audit_framework_condition
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
-- The service lets the condition owner (any member) or a lead resolve it.
CREATE POLICY audit_framework_condition_update ON hsdg.audit_framework_condition
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

ALTER TABLE hsdg.audit_framework_return ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_framework_return_select ON hsdg.audit_framework_return
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_framework_return_insert ON hsdg.audit_framework_return
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
-- The return owner may clear it (the source section's preparer), as may a lead.
CREATE POLICY audit_framework_return_update ON hsdg.audit_framework_return
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_framework_return CASCADE;
DROP TABLE IF EXISTS hsdg.audit_framework_condition CASCADE;
DROP TRIGGER IF EXISTS audit_framework_baseline_guard ON hsdg.audit_framework_baseline;
DROP FUNCTION IF EXISTS hsdg.audit_framework_baseline_guard();
DROP INDEX IF EXISTS hsdg.audit_framework_baseline_one_live;
ALTER TABLE hsdg.audit_framework_baseline
  DROP CONSTRAINT IF EXISTS audit_framework_baseline_approved_record,
  DROP CONSTRAINT IF EXISTS audit_framework_baseline_reopen_sections,
  DROP COLUMN IF EXISTS superseded_at,
  DROP COLUMN IF EXISTS reopened_from_version,
  DROP COLUMN IF EXISTS reopened_at,
  DROP COLUMN IF EXISTS reopened_by_employee_id,
  DROP COLUMN IF EXISTS reopen_reapproval_required,
  DROP COLUMN IF EXISTS reopen_evidence_document_id,
  DROP COLUMN IF EXISTS reopen_evidence_note,
  DROP COLUMN IF EXISTS reopen_identified_by_employee_id,
  DROP COLUMN IF EXISTS reopen_identified_at,
  DROP COLUMN IF EXISTS reopen_affected_sections,
  DROP COLUMN IF EXISTS memo_reference,
  DROP COLUMN IF EXISTS memo_version,
  DROP COLUMN IF EXISTS rule_versions,
  DROP COLUMN IF EXISTS audit_period,
  DROP COLUMN IF EXISTS ep_decision,
  DROP COLUMN IF EXISTS manager_note,
  DROP COLUMN IF EXISTS preview_reviewed_at,
  DROP COLUMN IF EXISTS preview_reviewed_by_employee_id;
