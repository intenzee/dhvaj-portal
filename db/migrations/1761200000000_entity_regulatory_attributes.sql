-- ─────────────────────────────────────────────────────────────────────────
-- 0047 · Entity regulatory attributes  (spec §15, §19, §31, §32; ADR-0033)
--
-- An extensible, CODED FACT STORE the downstream Regulatory Engine reads (§19):
-- regulated sectors, special regulatory status, and any future structured fact
-- — without schema churn per fact. Each row is ONE fact about the entity, with
-- a typed value and provenance. This is the ONE deliberate EAV in the design.
--
-- Hard rule (§32): FACTS ONLY. No conclusions, no applicability results, no
-- statutory rules here — those are downstream engine objects.
--
-- attribute_defs is a migration-managed catalogue of allowed codes (like
-- entity_types) so values stay controlled; the app reads it, cannot write it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Catalogue of allowed attribute codes ─────────────────────────────────
CREATE TABLE hsdg.entity_regulatory_attribute_defs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,60}$'),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  -- Which typed column carries this attribute's value.
  value_kind  text NOT NULL CHECK (value_kind IN ('text','number','boolean','date')),
  -- Whether multiple rows of this code may coexist for one entity (e.g. an
  -- entity can be in several regulated sectors).
  multi       boolean NOT NULL DEFAULT false,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER entity_regulatory_attribute_defs_set_updated_at
  BEFORE UPDATE ON hsdg.entity_regulatory_attribute_defs
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── The facts ─────────────────────────────────────────────────────────────
CREATE TABLE hsdg.entity_regulatory_attributes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  attribute_code  text NOT NULL REFERENCES hsdg.entity_regulatory_attribute_defs (code) ON DELETE RESTRICT,
  value_text      text,
  value_number    numeric(18,2),
  value_boolean   boolean,
  value_date      date,
  effective_from  date,
  source          text NOT NULL DEFAULT 'client'
                    CHECK (source IN ('client','hsdg','government_portal','system_derived','other')),
  notes           text,
  created_by      uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_regulatory_attributes_entity_idx ON hsdg.entity_regulatory_attributes (entity_id);
CREATE INDEX entity_regulatory_attributes_code_idx   ON hsdg.entity_regulatory_attributes (attribute_code);
CREATE TRIGGER entity_regulatory_attributes_set_updated_at
  BEFORE UPDATE ON hsdg.entity_regulatory_attributes
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Seed the starter attribute catalogue (BEFORE FORCE RLS) ───────────────
INSERT INTO hsdg.entity_regulatory_attribute_defs (code, name, value_kind, multi, description) VALUES
  ('regulated_sector',          'Regulated Sector',            'text',    true,  'Banking / Insurance / NBFC / HFC / FI / SEBI-RBI regulated / Other (§15)'),
  ('special_regulatory_status', 'Special Regulatory Status',   'text',    true,  'Government company, regulated entity, etc. (§15)'),
  ('is_government_company',      'Government Company',          'boolean', false, 'Structured fact for the engine (§19)'),
  ('is_public_interest_entity',  'Public Interest Entity',     'boolean', false, 'PIE flag for framework determination'),
  ('accepts_public_deposits',    'Accepts Public Deposits',    'boolean', false, 'Deposit-acceptance fact (§16/§19)');

-- ── Privileges: the defs catalogue is migration-managed ───────────────────
REVOKE INSERT, UPDATE, DELETE ON hsdg.entity_regulatory_attribute_defs FROM hsdg_app;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE hsdg.entity_regulatory_attribute_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_regulatory_attribute_defs FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_regulatory_attribute_defs_read ON hsdg.entity_regulatory_attribute_defs
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

ALTER TABLE hsdg.entity_regulatory_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_regulatory_attributes FORCE  ROW LEVEL SECURITY;
CREATE POLICY entity_regulatory_attributes_all ON hsdg.entity_regulatory_attributes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_regulatory_attributes.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM hsdg.entities e
            WHERE e.id = entity_regulatory_attributes.entity_id
              AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
  );

-- Down Migration

DROP TABLE IF EXISTS hsdg.entity_regulatory_attributes CASCADE;
DROP TABLE IF EXISTS hsdg.entity_regulatory_attribute_defs CASCADE;
