-- ─────────────────────────────────────────────────────────────────────────
-- 0043 · Statutory Audit — Framework → Dynamic Work Generation  (SA-3 · §20)
--
-- Once the Framework Memo is approved (§18), the approved applicability
-- conclusions drive WHAT work exists: "APPROVED FRAMEWORK → APPLICABLE WORK
-- AREAS" (§20). This migration adds the generated work-area layer — the top of
-- the §20 cascade. The workpaper / procedure / evidence detail inside each area
-- (§9–§14) is SA-5.
--
-- ONE TABLE:
--   • audit_work_areas — one row per generated work area per shell. Carries the
--     provenance (source, origin_area_key, generated_from_version), the §8/§31
--     professional state model, and is_active. Generation upserts by
--     (workflow_instance_id, work_area_key).
--
-- IDEMPOTENCY (§20, §36 "Run generation twice → no duplicate objects"):
-- UNIQUE (workflow_instance_id, work_area_key) means a repeated generation can
-- never create a second row for the same area — the engine upserts. An area a
-- later framework change makes not-applicable is DEACTIVATED (is_active = false),
-- never deleted, so completed work is preserved (§20 "Existing completed work is
-- never silently deleted", §30). There is deliberately NO delete policy.
--
-- SECURITY — engagement child data, same assignment-based access as the shell
-- (1762100000000) and the framework (1762200000000): members SELECT, only leads
-- (EP/manager) INSERT/UPDATE. ENABLE (not FORCE) RLS so the migrator-owned
-- SECURITY DEFINER helpers bypass; hsdg_app is never the owner. No new permission
-- slug (endpoints reuse engagement.read / engagement.manage; RLS gates).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_work_areas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  work_area_key         text NOT NULL CHECK (work_area_key ~ '^[a-z0-9_]{2,60}$'),
  title                 text NOT NULL CHECK (length(trim(title)) > 0),
  scope                 text,
  -- Provenance of the generation, e.g. 'framework:caro' (§20).
  source                text NOT NULL CHECK (length(trim(source)) > 0),
  -- The framework area key that drove this area (null for non-framework sources).
  origin_area_key       text,
  -- §8/§31 professional state model (a work area is not a task).
  state                 text NOT NULL DEFAULT 'not_started' CHECK (state IN
                          ('not_started','in_progress','complete','needs_attention','locked')),
  -- False once a later framework change makes the area not-applicable (§20 — the
  -- row is deactivated, never deleted, so completed work survives).
  is_active             boolean NOT NULL DEFAULT true,
  -- The framework approval version this generation reflects (§30 provenance).
  generated_from_version integer,
  sort_order            integer NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, work_area_key)
);
CREATE INDEX audit_work_areas_instance_idx
  ON hsdg.audit_work_areas (workflow_instance_id);
CREATE INDEX audit_work_areas_engagement_idx
  ON hsdg.audit_work_areas (engagement_id);
CREATE TRIGGER audit_work_areas_set_updated_at
  BEFORE UPDATE ON hsdg.audit_work_areas
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (mirrors service_workflow_instances) ────────────────
ALTER TABLE hsdg.audit_work_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_work_areas_select ON hsdg.audit_work_areas
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_work_areas_insert ON hsdg.audit_work_areas
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_work_areas_update ON hsdg.audit_work_areas
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_work_areas CASCADE;
