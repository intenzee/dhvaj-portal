-- ─────────────────────────────────────────────────────────────────────────
-- 0054 · Statutory Audit — 02.1 Entity & Regulatory Profile  (Guide §9.1, §6)
--
-- THE FACT FOUNDATION of Section 02. One confirmable profile per statutory-audit
-- shell that captures the fact set 02.2–02.9 reuse (guide §1: capture-once). Its
-- own decisions are the Small Company system assessment (COMPUTED from the §2(85)
-- rule version — never a checkbox) and the SA 510 / 402 / 299 triggers carried
-- forward to 02.8 and Planning.
--
-- TWO TABLES:
--   • audit_entity_profile     — one row per shell (UNIQUE), carrying the captured
--     professional facts (special-entity matrix, initial/joint audit, accounting
--     environment), the frozen small-company outcome + basis + cited rule/version
--     & provision, the SA flags, and — on CONFIRM PROFILE — the preparer,
--     timestamp, methodology version and an immutable fact snapshot.
--   • audit_profile_financials — the reusable financial-data block: one row per
--     parameter, current + prior FY, with source/preparer/evidence (guide Card D).
--
-- Plus a SEED that adds the §2(85) Small Company thresholds to the Audit Rules
-- Library (they did not exist — the COS_ACT_2_85 provision was already seeded in
-- 1763000000000). Effective-dated version history so the computed outcome is
-- period-correct and a future change affects future periods only (guide §4).
--
-- SECURITY — engagement child data, same assignment-based access as the shell
-- (1762100000000) and the acceptance/framework tables: members SELECT, only
-- leads (EP/manager) INSERT/UPDATE. ENABLE (not FORCE) RLS so migrator-owned
-- SECURITY DEFINER helpers bypass.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
-- The methodology seed below writes firm-wide library tables that are FORCE
-- RLS; lift FORCE for the migrator (no request context) and restore it after,
-- as catalogue_templates (1760200000000) does.
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;


CREATE TABLE hsdg.audit_entity_profile (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  state                    text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','confirmed')),

  -- ── Captured professional facts (Cards B / G / H / I) ─────────────────────
  special_entity_types     text[] NOT NULL DEFAULT '{}',
  initial_audit            boolean NOT NULL DEFAULT false,
  -- True while initial_audit still holds the system-derived value (not overridden).
  initial_audit_derived    boolean NOT NULL DEFAULT true,
  joint_audit              boolean NOT NULL DEFAULT false,
  accounting_environment   text CHECK (accounting_environment IS NULL OR accounting_environment IN
                             ('in_house','outsourced_service_organisation','hybrid')),

  -- ── Small Company system assessment (Card E) — computed, frozen on confirm ─
  small_company_outcome    text CHECK (small_company_outcome IS NULL OR small_company_outcome IN
                             ('small','not_small','not_applicable','pending')),
  small_company_basis      text,
  small_company_rule_version_id uuid REFERENCES hsdg.audit_rule_version (id) ON DELETE SET NULL,
  small_company_provision_id    uuid REFERENCES hsdg.authority_provision (id) ON DELETE SET NULL,

  -- ── SA triggers carried forward (guide §9.1) ──────────────────────────────
  sa510_flag               boolean NOT NULL DEFAULT false,
  sa402_flag               boolean NOT NULL DEFAULT false,
  sa299_flag               boolean NOT NULL DEFAULT false,

  -- ── Confirmation record (Completion) ──────────────────────────────────────
  methodology_version      text,
  snapshot                 jsonb,
  confirmed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  confirmed_at             timestamptz,

  -- Set by a downstream change-impact trigger; never rewrites the snapshot (§12).
  needs_reevaluation       boolean NOT NULL DEFAULT false,

  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id)
);
CREATE INDEX audit_entity_profile_engagement_idx
  ON hsdg.audit_entity_profile (engagement_id);
CREATE TRIGGER audit_entity_profile_set_updated_at
  BEFORE UPDATE ON hsdg.audit_entity_profile
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_profile_financials (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id               uuid NOT NULL
                             REFERENCES hsdg.audit_entity_profile (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  parameter                text NOT NULL CHECK (parameter IN
                             ('paid_up_capital','turnover','net_worth','total_assets',
                              'borrowings','bank_fi_borrowings','public_deposits')),
  current_value            numeric(18,2),
  prior_value              numeric(18,2),
  source                   text CHECK (source IS NULL OR source IN
                             ('audited_financials','provisional_financials','management_accounts',
                              'tax_return','other')),
  preparer                 text,
  document_id              uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, parameter)
);
CREATE INDEX audit_profile_financials_profile_idx
  ON hsdg.audit_profile_financials (profile_id);
CREATE INDEX audit_profile_financials_engagement_idx
  ON hsdg.audit_profile_financials (engagement_id);
CREATE TRIGGER audit_profile_financials_set_updated_at
  BEFORE UPDATE ON hsdg.audit_profile_financials
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (mirrors audit_acceptance_segments) ─────────────────
ALTER TABLE hsdg.audit_entity_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_entity_profile_select ON hsdg.audit_entity_profile
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_entity_profile_insert ON hsdg.audit_entity_profile
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_entity_profile_update ON hsdg.audit_entity_profile
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_profile_financials ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_profile_financials_select ON hsdg.audit_profile_financials
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_profile_financials_insert ON hsdg.audit_profile_financials
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_profile_financials_update ON hsdg.audit_profile_financials
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── Seed: Small Company §2(85) thresholds into the Audit Rules Library (§4) ──
-- The small-company outcome is COMPUTED, not a checkbox (guide §9.1 Card E), so
-- its thresholds must be library data. Area 'entity_regulatory_profile' owns
-- them; the engine gates on private/company/holding/subsidiary from facts. All
-- amounts in rupees (one crore = 1e7). Version history reflects the §2(85)
-- amendments so a historical engagement resolves the value in force then.
INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('SMALL_CO_CAPITAL',  'entity_regulatory_profile', NULL, 'paid_up_capital', '<=', 'inr', 'balance_sheet_date'),
  ('SMALL_CO_TURNOVER', 'entity_regulatory_profile', NULL, 'turnover',        '<=', 'inr', 'balance_sheet_date')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, 'small', p.id
FROM (VALUES
  -- Paid-up capital ceiling: ₹50L (2014) → ₹2cr (2021) → ₹4cr (Sep 2022).
  ('SMALL_CO_CAPITAL',  1, '2014-04-01', '2021-03-31', 5000000::numeric),
  ('SMALL_CO_CAPITAL',  2, '2021-04-01', '2022-09-14', 20000000::numeric),
  ('SMALL_CO_CAPITAL',  3, '2022-09-15', NULL,         40000000::numeric),
  -- Turnover ceiling: ₹2cr (2014) → ₹20cr (2021) → ₹40cr (Sep 2022).
  ('SMALL_CO_TURNOVER', 1, '2014-04-01', '2021-03-31', 20000000::numeric),
  ('SMALL_CO_TURNOVER', 2, '2021-04-01', '2022-09-14', 200000000::numeric),
  ('SMALL_CO_TURNOVER', 3, '2022-09-15', NULL,         400000000::numeric)
) AS v(rule_code, ver, eff, eff_to, threshold)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = 'COS_ACT_2_85'
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Restore FORCE RLS on the library tables (see top of Up).
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_profile_financials CASCADE;
DROP TABLE IF EXISTS hsdg.audit_entity_profile CASCADE;
DELETE FROM hsdg.audit_rule WHERE code IN ('SMALL_CO_CAPITAL','SMALL_CO_TURNOVER');
