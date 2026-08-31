-- ─────────────────────────────────────────────────────────────────────────
-- 0043 · Entity relationships  (spec §13, §14, §31; ADR-0033)
--
-- Structured ownership/group relationships between two entities (holding,
-- subsidiary, WOS, associate, JV, step-down, fellow, ultimate/intermediate
-- holding, other). Directional: from_entity_id --relationship--> to_entity_id
-- (read "from IS relationship OF to", e.g. B is 'subsidiary' of A). Optional
-- shareholding % and effective dating; auditable at the service layer.
--
-- Regulatory calculations stay entity-specific unless a rule expressly needs
-- group-level analysis (§14) — this table is FACTS only, no conclusions.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.entity_relationships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id    uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  to_entity_id      uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN
                      ('holding','subsidiary','wholly_owned_subsidiary','associate',
                       'joint_venture','step_down_subsidiary','fellow_subsidiary',
                       'ultimate_holding','intermediate_holding','other')),
  -- Shareholding / interest percentage where relevant.
  shareholding_pct  numeric(5,2) CHECK (shareholding_pct IS NULL OR (shareholding_pct >= 0 AND shareholding_pct <= 100)),
  effective_from    date,
  effective_to      date,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','ended')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_relationships_no_self CHECK (from_entity_id <> to_entity_id),
  CONSTRAINT entity_relationships_range CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  -- One active edge of a given type between the same ordered pair.
  CONSTRAINT entity_relationships_unique UNIQUE (from_entity_id, to_entity_id, relationship_type)
);
-- from_entity_id lookups ride the leading column of the unique index below;
-- to_entity_id (reverse "who holds this entity") needs its own index.
CREATE INDEX entity_relationships_to_idx   ON hsdg.entity_relationships (to_entity_id);
CREATE TRIGGER entity_relationships_set_updated_at BEFORE UPDATE ON hsdg.entity_relationships
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Visible if EITHER endpoint is accessible to the caller (a relationship is
-- meaningful to both offices). Fail-closed with no context.
ALTER TABLE hsdg.entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_relationships FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_relationships_all ON hsdg.entity_relationships
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id IN (entity_relationships.from_entity_id, entity_relationships.to_entity_id)
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  ) WITH CHECK (
    -- To write, the caller must be able to access BOTH endpoints (can't wire an
    -- entity to one they cannot see).
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_relationships.from_entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
    AND
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_relationships.to_entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  );

-- Down Migration

DROP TABLE IF EXISTS hsdg.entity_relationships CASCADE;
