-- ─────────────────────────────────────────────────────────────────────────
-- 0046 · Entity listings  (spec §15, §31; ADR-0033)
--
-- Per exchange × security-type listing lines (0..n per entity). Entity-level
-- listing_status lives on hsdg.entities (0040); regulated-sector / special
-- regulatory status are recorded as coded facts in entity_regulatory_attributes
-- (0047). Facts only — applicability is decided downstream (§1).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.entity_listings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  exchange      text NOT NULL CHECK (exchange IN ('nse','bse','sme','other')),
  security_type text NOT NULL DEFAULT 'equity'
                  CHECK (security_type IN ('equity','preference','debt','other')),
  listing_date  date,
  status        text NOT NULL DEFAULT 'listed'
                  CHECK (status IN ('listed','in_process','delisted','suspended')),
  symbol        text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- One line per (entity, exchange, security type).
  CONSTRAINT entity_listings_unique UNIQUE (entity_id, exchange, security_type)
);
-- entity_id lookups ride the leading column of the unique index below.
CREATE TRIGGER entity_listings_set_updated_at BEFORE UPDATE ON hsdg.entity_listings
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.entity_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_listings FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_listings_all ON hsdg.entity_listings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_listings.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_listings.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  );

-- Down Migration

DROP TABLE IF EXISTS hsdg.entity_listings CASCADE;
