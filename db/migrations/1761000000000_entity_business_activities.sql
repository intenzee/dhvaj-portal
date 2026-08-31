-- ─────────────────────────────────────────────────────────────────────────
-- 0045 · Entity business activities  (spec §18, §31; ADR-0033)
--
-- Industry / NIC classification rows (0..n per entity). Exactly one primary
-- industry; secondary industries are additional rows. The singular yes/no
-- activity flags (manufacturing/trading/…) and business_description live on
-- hsdg.entities (migration 0040) — this table is the multi-valued classification.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.entity_business_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  industry_id uuid NOT NULL REFERENCES hsdg.industries (id) ON DELETE RESTRICT,
  nic_code_id uuid REFERENCES hsdg.nic_codes (id) ON DELETE SET NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- An industry appears at most once per entity.
  CONSTRAINT entity_business_activities_unique UNIQUE (entity_id, industry_id)
);
-- entity_id lookups ride the leading column of the (entity_id, industry_id)
-- unique index below; only the industry_id reverse lookup needs its own index.
CREATE INDEX entity_business_activities_industry_idx ON hsdg.entity_business_activities (industry_id);
-- At most one primary industry per entity.
CREATE UNIQUE INDEX entity_business_activities_one_primary
  ON hsdg.entity_business_activities (entity_id) WHERE is_primary;
CREATE TRIGGER entity_business_activities_set_updated_at BEFORE UPDATE ON hsdg.entity_business_activities
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.entity_business_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_business_activities FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_business_activities_all ON hsdg.entity_business_activities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_business_activities.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_business_activities.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  );

-- Down Migration

DROP TABLE IF EXISTS hsdg.entity_business_activities CASCADE;
