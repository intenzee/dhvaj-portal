-- ─────────────────────────────────────────────────────────────────────────
-- 0022 · Component supersession (frequency change = new configuration version)
--
-- Spec §23 (Superseded = "replaced by new configuration/version") and §24
-- ("Change Frequency → future periods use new setup; do not rewrite completed
-- history"). Changing a component's frequency once work exists is not an in-place
-- edit — it is a controlled configuration CHANGE: the current
-- `engagement_component` is SUPERSEDED and a new version takes over, so the old
-- frequency's work is preserved as history rather than reconciled away.
--
-- Two small schema additions support that:
--   1. `engagement_components.superseded_by_id` — the version chain (old → new).
--   2. `component_instances.status` gains 'superseded' — the old-frequency work
--      is marked superseded (distinct from a plain out-of-scope 'cancelled'),
--      and hidden from the operational view like cancelled work.
-- The partial live-unique index already excludes 'superseded', so the new
-- version is a legal live configuration for the same component.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.engagement_components
  ADD COLUMN superseded_by_id uuid REFERENCES hsdg.engagement_components (id) ON DELETE SET NULL,
  ADD COLUMN superseded_at    timestamptz;
CREATE INDEX engagement_components_superseded_by_idx
  ON hsdg.engagement_components (superseded_by_id);

ALTER TABLE hsdg.component_instances DROP CONSTRAINT component_instances_status_check;
ALTER TABLE hsdg.component_instances ADD CONSTRAINT component_instances_status_check
  CHECK (status IN ('scheduled', 'active', 'completed', 'waived', 'cancelled', 'superseded'));

-- Down Migration

ALTER TABLE hsdg.component_instances DROP CONSTRAINT component_instances_status_check;
-- Fold any 'superseded' instances back to 'cancelled' so the old CHECK holds.
UPDATE hsdg.component_instances SET status = 'cancelled' WHERE status = 'superseded';
ALTER TABLE hsdg.component_instances ADD CONSTRAINT component_instances_status_check
  CHECK (status IN ('scheduled', 'active', 'completed', 'waived', 'cancelled'));

DROP INDEX IF EXISTS hsdg.engagement_components_superseded_by_idx;
ALTER TABLE hsdg.engagement_components
  DROP COLUMN IF EXISTS superseded_at,
  DROP COLUMN IF EXISTS superseded_by_id;
