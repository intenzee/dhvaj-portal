-- ─────────────────────────────────────────────────────────────────────────
-- 0051 · Audit Rules Library  (Implementation Guide §4)
--
-- Foundational subsystem #1 — the single source of every statutory number,
-- ratio, effective date and exemption condition used by the Section 02 engines
-- (guide §1: NO statutory number lives in code). Modelled on the compliance
-- effective-dated, append-only, version-frozen precedent (compliance_engine
-- 1756700000000): editing a threshold creates a NEW version with a new
-- effective_from; prior versions are never mutated, so a future change affects
-- future periods only and never rewrites history.
--
-- FOUR TABLES:
--   • audit_rule                — rule identity (area, entity class, criterion,
--                                 operator, unit, measurement basis).
--   • audit_rule_version        — append-only calculation snapshot (threshold,
--                                 effective dates, outcome, cited provision).
--   • audit_rule_band           — band table for a version (e.g. Schedule V
--                                 effective-capital → remuneration ceilings).
--   • audit_ruleset_version     — the methodology bundle frozen onto an
--                                 engagement at framework approval.
--
-- SECURITY — firm-wide methodology reference data owned by the catalogue,
-- exactly like catalogue_templates / authority_provision: everyone with a role
-- SELECTs; only firm-wide admins write. Version + band rows are append-only
-- (REVOKE UPDATE, DELETE) so a frozen snapshot can never be silently rewritten.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Rule identity ─────────────────────────────────────────────────────────
CREATE TABLE hsdg.audit_rule (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,60}$'),
  area_key          text NOT NULL CHECK (area_key ~ '^[a-z0-9_]{2,60}$'),
  entity_class      text CHECK (entity_class IS NULL OR entity_class ~ '^[a-z0-9_]{2,40}$'),
  criterion         text NOT NULL CHECK (criterion ~ '^[a-z0-9_]{2,60}$'),
  operator          text NOT NULL CHECK (operator IN ('>=','>','<=','<','==','between')),
  unit              text NOT NULL CHECK (unit IN ('inr','percent','boolean','date')),
  measurement_basis text,
  is_active         boolean NOT NULL DEFAULT true,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_rule_area_idx ON hsdg.audit_rule (area_key, criterion);
CREATE TRIGGER audit_rule_set_updated_at
  BEFORE UPDATE ON hsdg.audit_rule
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Effective-dated, append-only version snapshot ─────────────────────────
CREATE TABLE hsdg.audit_rule_version (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_rule_id          uuid NOT NULL REFERENCES hsdg.audit_rule (id) ON DELETE CASCADE,
  version                integer NOT NULL,
  effective_from         date NOT NULL,
  effective_to           date,
  threshold              numeric,
  threshold_high         numeric,           -- 'between' uses both
  condition              jsonb,
  outcome                text,
  authority_provision_id uuid REFERENCES hsdg.authority_provision (id) ON DELETE SET NULL,
  guidance_reference     text,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_rule_id, version),
  CONSTRAINT audit_rule_version_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX audit_rule_version_rule_idx ON hsdg.audit_rule_version (audit_rule_id, effective_from);

-- ── Band table (e.g. Schedule V remuneration ceilings) ────────────────────
CREATE TABLE hsdg.audit_rule_band (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_rule_version_id uuid NOT NULL REFERENCES hsdg.audit_rule_version (id) ON DELETE CASCADE,
  lower                 numeric,
  upper                 numeric,
  ceiling_value         numeric,
  label                 text,
  sort_order            integer NOT NULL DEFAULT 0
);
CREATE INDEX audit_rule_band_version_idx ON hsdg.audit_rule_band (audit_rule_version_id, sort_order);

-- ── Methodology bundle frozen onto an engagement ──────────────────────────
CREATE TABLE hsdg.audit_ruleset_version (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  methodology_version text NOT NULL UNIQUE CHECK (length(trim(methodology_version)) > 0),
  effective_from     date NOT NULL,
  effective_to       date,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_ruleset_version_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- ── Row Level Security (firm-wide reference data) ─────────────────────────
REVOKE UPDATE, DELETE ON hsdg.audit_rule_version FROM hsdg_app;
REVOKE UPDATE, DELETE ON hsdg.audit_rule_band    FROM hsdg_app;

ALTER TABLE hsdg.audit_rule            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_band       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_ruleset_version ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_rule_read ON hsdg.audit_rule
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_rule_write ON hsdg.audit_rule
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

CREATE POLICY audit_rule_version_read ON hsdg.audit_rule_version
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_rule_version_insert ON hsdg.audit_rule_version
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

CREATE POLICY audit_rule_band_read ON hsdg.audit_rule_band
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_rule_band_insert ON hsdg.audit_rule_band
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

CREATE POLICY audit_ruleset_version_read ON hsdg.audit_ruleset_version
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_ruleset_version_write ON hsdg.audit_ruleset_version
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- ── Seed (guide §4.4): the thresholds currently hard-coded in
-- framework-suggestions.ts become data. Values are rupees; one crore = 1e7.
-- These replace the literals 250cr (Ind AS), 1/1/10cr (CARO), 50/200/100/25cr
-- (Sec 138), 50/250cr (Sec 204) and 500/1000/5cr (Sec 135). ──────────────────
INSERT INTO hsdg.audit_ruleset_version (methodology_version, effective_from, notes)
VALUES ('v2026.1', '2014-04-01', 'Baseline methodology bundle seeded with the Rules Library.')
ON CONFLICT (methodology_version) DO NOTHING;

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('INDAS_NETWORTH',    'ind_as_as',         NULL, 'net_worth',       '>=', 'inr', 'standalone_audited_fs'),
  ('CARO_PVT_CAPITAL',  'caro',              NULL, 'paid_up_capital', '<=', 'inr', 'balance_sheet_date'),
  ('CARO_PVT_BORROWINGS','caro',             NULL, 'borrowings',      '<=', 'inr', 'at_any_point_in_year'),
  ('CARO_PVT_REVENUE',  'caro',              NULL, 'revenue',         '<=', 'inr', 'caro_measurement_basis'),
  ('IA_CAPITAL',        'internal_audit',    NULL, 'paid_up_capital', '>=', 'inr', 'balance_sheet_date'),
  ('IA_TURNOVER',       'internal_audit',    NULL, 'turnover',        '>=', 'inr', 'balance_sheet_date'),
  ('IA_BORROWINGS',     'internal_audit',    NULL, 'borrowings',      '>=', 'inr', 'balance_sheet_date'),
  ('IA_DEPOSITS',       'internal_audit',    NULL, 'deposits',        '>=', 'inr', 'balance_sheet_date'),
  ('SA204_CAPITAL',     'secretarial_audit', NULL, 'paid_up_capital', '>=', 'inr', 'balance_sheet_date'),
  ('SA204_TURNOVER',    'secretarial_audit', NULL, 'turnover',        '>=', 'inr', 'balance_sheet_date'),
  ('CSR_NETWORTH',      'csr',               NULL, 'net_worth',       '>=', 'inr', 'balance_sheet_date'),
  ('CSR_TURNOVER',      'csr',               NULL, 'turnover',        '>=', 'inr', 'balance_sheet_date'),
  ('CSR_NETPROFIT',     'csr',               NULL, 'net_profit',      '>=', 'inr', 'balance_sheet_date')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, threshold, outcome, authority_provision_id)
SELECT r.id, 1, v.eff::date, v.threshold, v.outcome, p.id
FROM (VALUES
  ('INDAS_NETWORTH',     '2016-04-01', 2500000000::numeric, 'ind_as',    'INDAS_RULE_4'),
  ('CARO_PVT_CAPITAL',   '2021-04-01', 10000000::numeric,   'exempt',    'CARO_2020'),
  ('CARO_PVT_BORROWINGS','2021-04-01', 10000000::numeric,   'exempt',    'CARO_2020'),
  ('CARO_PVT_REVENUE',   '2021-04-01', 100000000::numeric,  'exempt',    'CARO_2020'),
  ('IA_CAPITAL',         '2014-04-01', 500000000::numeric,  'applicable','COS_ACT_138'),
  ('IA_TURNOVER',        '2014-04-01', 2000000000::numeric, 'applicable','COS_ACT_138'),
  ('IA_BORROWINGS',      '2014-04-01', 1000000000::numeric, 'applicable','COS_ACT_138'),
  ('IA_DEPOSITS',        '2014-04-01', 250000000::numeric,  'applicable','COS_ACT_138'),
  ('SA204_CAPITAL',      '2014-04-01', 500000000::numeric,  'applicable','COS_ACT_204'),
  ('SA204_TURNOVER',     '2014-04-01', 2500000000::numeric, 'applicable','COS_ACT_204'),
  ('CSR_NETWORTH',       '2014-04-01', 5000000000::numeric, 'applicable','COS_ACT_135'),
  ('CSR_TURNOVER',       '2014-04-01', 10000000000::numeric,'applicable','COS_ACT_135'),
  ('CSR_NETPROFIT',      '2014-04-01', 50000000::numeric,   'applicable','COS_ACT_135')
) AS v(rule_code, eff, threshold, outcome, prov_code)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = v.prov_code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- FORCE RLS only AFTER the seed: under FORCE even the owning migrator (no
-- request context) is policy-gated, so a seed placed after it is rejected.
-- Same ordering as catalogue_templates (1760200000000).
ALTER TABLE hsdg.audit_rule            FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version    FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_band       FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_ruleset_version FORCE  ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_rule_band       CASCADE;
DROP TABLE IF EXISTS hsdg.audit_rule_version    CASCADE;
DROP TABLE IF EXISTS hsdg.audit_rule            CASCADE;
DROP TABLE IF EXISTS hsdg.audit_ruleset_version CASCADE;
