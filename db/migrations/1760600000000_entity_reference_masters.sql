-- ─────────────────────────────────────────────────────────────────────────
-- 0041 · Entity reference masters  (spec §18; ADR-0033)
--
-- Controlled vocabularies referenced by FK from entity business activities:
--   • industries — HSDG's primary/secondary industry master.
--   • nic_codes  — National Industrial Classification codes (structured).
-- Both are MIGRATION-MANAGED config (like entity_types): the app reads them,
-- REVOKE writes from hsdg_app. Small/stable vocabularies (registration types,
-- relationship types, address types, listing/security types) stay as CHECK
-- enums on their tables, matching the existing convention.
--
-- Seeds are a pragmatic starter set; the firm extends via migration.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.industries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,50}$'),
  name       text NOT NULL CHECK (length(trim(name)) > 0),
  -- Broad sector grouping for reporting/analysis.
  sector     text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER industries_set_updated_at BEFORE UPDATE ON hsdg.industries
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.nic_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NIC 2008 code (2–5 digits, kept as text to preserve leading zeros).
  code       text NOT NULL UNIQUE CHECK (code ~ '^[0-9]{2,5}$'),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  -- Optional parent (section/division) for hierarchy; free-form for now.
  section    text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER nic_codes_set_updated_at BEFORE UPDATE ON hsdg.nic_codes
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Seed (BEFORE FORCE RLS) ───────────────────────────────────────────────
INSERT INTO hsdg.industries (slug, name, sector) VALUES
  ('manufacturing',        'Manufacturing',                 'Industrial'),
  ('trading',              'Trading / Wholesale / Retail',  'Commerce'),
  ('it_software',          'IT & Software Services',        'Services'),
  ('financial_services',   'Financial Services',            'BFSI'),
  ('banking',              'Banking',                       'BFSI'),
  ('nbfc',                 'NBFC',                          'BFSI'),
  ('insurance',            'Insurance',                     'BFSI'),
  ('real_estate',          'Real Estate & Construction',    'Infrastructure'),
  ('infrastructure',       'Infrastructure',                'Infrastructure'),
  ('healthcare',           'Healthcare & Pharma',           'Services'),
  ('education',            'Education',                      'Services'),
  ('hospitality',          'Hospitality & Tourism',         'Services'),
  ('logistics',            'Logistics & Transport',         'Services'),
  ('agriculture',          'Agriculture & Allied',          'Primary'),
  ('energy',               'Energy & Power',                'Utilities'),
  ('telecom',              'Telecommunications',            'Utilities'),
  ('professional_services','Professional Services',         'Services'),
  ('ecommerce',            'E-commerce',                    'Commerce'),
  ('media',                'Media & Entertainment',         'Services'),
  ('other',                'Other',                         'Other');

-- ── Privileges: reference tables are migration-managed ────────────────────
REVOKE INSERT, UPDATE, DELETE ON hsdg.industries FROM hsdg_app;
REVOKE INSERT, UPDATE, DELETE ON hsdg.nic_codes  FROM hsdg_app;

-- ── RLS: any authenticated context reads; nobody writes via the app ───────
ALTER TABLE hsdg.industries ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.industries FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.nic_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.nic_codes  FORCE  ROW LEVEL SECURITY;

CREATE POLICY industries_read ON hsdg.industries
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY nic_codes_read ON hsdg.nic_codes
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

-- Down Migration

DROP TABLE IF EXISTS hsdg.nic_codes  CASCADE;
DROP TABLE IF EXISTS hsdg.industries CASCADE;
