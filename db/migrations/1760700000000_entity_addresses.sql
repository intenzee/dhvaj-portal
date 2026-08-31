-- ─────────────────────────────────────────────────────────────────────────
-- 0042 · Entity addresses  (spec §8, §31; ADR-0033)
--
-- Registered / business / branch / other addresses (0..n per entity). Follows
-- the visibility of its parent entity (office-scoped, fail-closed). At most one
-- primary address per (entity, type).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.entity_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  address_type text NOT NULL DEFAULT 'registered'
                 CHECK (address_type IN ('registered','business','branch','communication','other')),
  line1        text NOT NULL CHECK (length(trim(line1)) > 0),
  line2        text,
  city         text,
  state        text,
  pincode      text CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$'),
  country      text NOT NULL DEFAULT 'IN' CHECK (country ~ '^[A-Z]{2}$'),
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_addresses_entity_idx ON hsdg.entity_addresses (entity_id);
-- At most one primary address per (entity, type).
CREATE UNIQUE INDEX entity_addresses_one_primary
  ON hsdg.entity_addresses (entity_id, address_type) WHERE is_primary;
CREATE TRIGGER entity_addresses_set_updated_at BEFORE UPDATE ON hsdg.entity_addresses
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.entity_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_addresses FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_addresses_all ON hsdg.entity_addresses
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_addresses.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_addresses.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  );

-- Down Migration

DROP TABLE IF EXISTS hsdg.entity_addresses CASCADE;
