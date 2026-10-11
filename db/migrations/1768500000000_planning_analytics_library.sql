-- ─────────────────────────────────────────────────────────────────────────
-- 03.2 Analytics Methodology Library (DHVAJ 03.2 §12, §15, §17, §23)
--
-- The preliminary-analytics methodology used to be constants in code
-- (planning-analytics-engine.ts). §15 / §23 make it controlled, versioned
-- configuration maintained by the Methodology Admin (holders of service.manage)
-- without a deployment — the same pattern as the Planning Signal and
-- Strategic Consideration libraries:
--   • analytics_metric_definition — canonical metric ids (a future TB module
--     populates the same ids), value type, profile applicability;
--   • analytics_industry_profile  — sector profiles that both EXCLUDE generic
--     analytics and ADD sector analytics (via a rule's applies_to), plus the
--     debt definition, finance-cost basis, average balances and the ordered
--     cost bases (never revenue for inventory / payable days);
--   • analytics_rule — ratios and attention rules (movement, relationship,
--     ratio shift / change, trend reversal, threshold) with the attention
--     parameter, Enhanced / Immediate Partner levels, minimum data quality,
--     neutral wording, why it may matter and suggested affected areas.
-- Every edit appends a version effective from a date; the version in force
-- on the audit period end is used, and an inactive version retires the item.
-- An Investigation Card keeps the rule code + version it was raised under.
--
-- The seed reproduces the previous code methodology (same rule keys, so 03.5
-- area tags and existing cards keep matching) and adds the §12 / §17 gaps.
-- It is generated from analytics-methodology-v1.fixture.ts; the e2e suite
-- asserts the two are equal.
--
-- SECURITY — insert-only for the app (no UPDATE/DELETE); readable by any
-- authenticated role (no client data lives here), appendable only firm-wide.
-- FORCE RLS is applied after the seed so the migrator may insert.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.analytics_metric_definition (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key              text NOT NULL CHECK (metric_key ~ '^[a-z][a-z0-9_]{1,59}$'
                                               AND metric_key !~ '^custom_'),
  version                 integer NOT NULL CHECK (version >= 1),
  label                   text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
  value_type              text NOT NULL CHECK (value_type IN ('amount','count','percent')),
  core                    boolean NOT NULL DEFAULT false,
  note                    text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  applies_to              text[] NOT NULL DEFAULT '{}'
                            CHECK (array_position(applies_to, NULL) IS NULL),
  sort_order              integer NOT NULL DEFAULT 1000,
  effective_from          date NOT NULL DEFAULT DATE '2000-01-01',
  effective_to            date,
  active                  boolean NOT NULL DEFAULT true,
  methodology_version     text NOT NULL CHECK (length(trim(methodology_version)) BETWEEN 1 AND 60),
  change_note             text CHECK (change_note IS NULL OR length(change_note) <= 2000),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metric_key, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE hsdg.analytics_industry_profile (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key              text NOT NULL CHECK (profile_key ~ '^[a-z0-9_]{2,40}$'),
  version                  integer NOT NULL CHECK (version >= 1),
  label                    text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  description              text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  sub_industries           text[] NOT NULL DEFAULT '{}'
                             CHECK (array_position(sub_industries, NULL) IS NULL),
  considerations           text[] NOT NULL DEFAULT '{}'
                             CHECK (array_position(considerations, NULL) IS NULL),
  average_balances         boolean NOT NULL DEFAULT false,
  debt_metrics             text[] NOT NULL CHECK (cardinality(debt_metrics) > 0
                             AND array_position(debt_metrics, NULL) IS NULL),
  finance_cost_basis       text NOT NULL CHECK (finance_cost_basis IN ('average','closing')),
  -- §12 / §24: inventory and payable days never silently use revenue.
  inventory_cost_bases     text[] NOT NULL CHECK (cardinality(inventory_cost_bases) > 0
                             AND NOT ('revenue' = ANY (inventory_cost_bases))
                             AND array_position(inventory_cost_bases, NULL) IS NULL),
  payable_cost_bases       text[] NOT NULL CHECK (cardinality(payable_cost_bases) > 0
                             AND NOT ('revenue' = ANY (payable_cost_bases))
                             AND array_position(payable_cost_bases, NULL) IS NULL),
  inventory_trend_fallback text,
  effective_from           date NOT NULL DEFAULT DATE '2000-01-01',
  effective_to             date,
  active                   boolean NOT NULL DEFAULT true,
  methodology_version      text NOT NULL CHECK (length(trim(methodology_version)) BETWEEN 1 AND 60),
  change_note              text CHECK (change_note IS NULL OR length(change_note) <= 2000),
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_key, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- The generic profile is the fallback for every file; it is never retired.
  CHECK (profile_key <> 'generic' OR active)
);

CREATE TABLE hsdg.analytics_rule (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code               text NOT NULL CHECK (rule_code ~ '^PAR-[0-9]{3}$'),
  version                 integer NOT NULL CHECK (version >= 1),
  rule_key                text NOT NULL CHECK (rule_key ~ '^[a-z0-9_]{2,80}$'),
  name                    text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  kind                    text NOT NULL CHECK (kind IN
                            ('ratio','movement','relationship','ratio_shift','ratio_change',
                             'trend_reversal','threshold')),
  applies_to              text[] NOT NULL DEFAULT '{}'
                            CHECK (array_position(applies_to, NULL) IS NULL),
  excluded_for            text[] NOT NULL DEFAULT '{}'
                            CHECK (array_position(excluded_for, NULL) IS NULL),
  required_metrics        text[] NOT NULL DEFAULT '{}'
                            CHECK (array_position(required_metrics, NULL) IS NULL),
  formula                 text NOT NULL CHECK (length(trim(formula)) BETWEEN 1 AND 500),
  definition              jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  parameter_type          text CHECK (parameter_type IS NULL OR parameter_type IN
                            ('absolute','percent','ratio','trend','relationship')),
  parameter_value         numeric,
  enhanced_at             numeric,
  immediate_at            numeric,
  min_data_status         text[] NOT NULL DEFAULT '{}'
                            CHECK (min_data_status <@ ARRAY['draft','final']::text[]),
  min_source_types        text[] NOT NULL DEFAULT '{}'
                            CHECK (min_source_types <@ ARRAY['management_accounts','draft_fs',
                                   'audited_py_fs','other']::text[]),
  signal_wording          text NOT NULL DEFAULT '' CHECK (length(signal_wording) <= 1000),
  why_may_matter          text NOT NULL DEFAULT '' CHECK (length(why_may_matter) <= 1000),
  affected_areas          text[] NOT NULL DEFAULT '{}'
                            CHECK (array_position(affected_areas, NULL) IS NULL),
  suggested_attention     text NOT NULL DEFAULT 'standard' CHECK (suggested_attention IN
                            ('standard','enhanced','immediate_partner')),
  effective_from          date NOT NULL DEFAULT DATE '2000-01-01',
  effective_to            date,
  active                  boolean NOT NULL DEFAULT true,
  methodology_version     text NOT NULL CHECK (length(trim(methodology_version)) BETWEEN 1 AND 60),
  change_note             text CHECK (change_note IS NULL OR length(change_note) <= 2000),
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (definition ->> 'kind' = kind),
  -- An attention rule carries its parameter, wording and explanation (§15).
  CHECK (kind = 'ratio' OR (parameter_type IS NOT NULL AND parameter_value IS NOT NULL
         AND length(trim(signal_wording)) > 0 AND length(trim(why_may_matter)) > 0)),
  CHECK (enhanced_at IS NULL OR immediate_at IS NULL OR immediate_at >= enhanced_at)
);
CREATE INDEX analytics_rule_key_idx ON hsdg.analytics_rule (rule_key);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['analytics_metric_definition','analytics_industry_profile','analytics_rule'] LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON hsdg.%I FROM hsdg_app', t);
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.ctx_role() IS NOT NULL)',
                   t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide())',
                   t || '_insert', t);
  END LOOP;
END $$;

-- ── v1 seed (generated from analytics-methodology-v1.fixture.ts) ──────────

INSERT INTO hsdg.analytics_metric_definition
  (metric_key, version, label, value_type, core, note, applies_to, sort_order, methodology_version, change_note)
VALUES
  ('revenue', 1, 'Revenue from operations', 'amount', true, 'Core', ARRAY[]::text[], 10, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('other_income', 1, 'Other income', 'amount', true, 'Core', ARRAY[]::text[], 20, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('cost_of_sales', 1, 'Cost of sales / materials consumed', 'amount', false, 'Needed for inventory days', ARRAY[]::text[], 30, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('purchases', 1, 'Purchases', 'amount', false, 'Preferred base for payable days', ARRAY[]::text[], 40, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('gross_profit', 1, 'Gross profit', 'amount', false, 'Where meaningful', ARRAY[]::text[], 50, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('ebitda', 1, 'EBITDA / operating profit', 'amount', false, 'Where meaningful', ARRAY[]::text[], 60, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('pbt', 1, 'Profit before tax', 'amount', true, 'Core', ARRAY[]::text[], 70, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('pat', 1, 'Profit after tax', 'amount', true, 'Core', ARRAY[]::text[], 80, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('total_assets', 1, 'Total assets', 'amount', true, 'Core', ARRAY[]::text[], 90, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('net_worth', 1, 'Net worth / total equity', 'amount', true, 'Core', ARRAY[]::text[], 100, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('cash_bank', 1, 'Cash & bank', 'amount', true, 'Core', ARRAY[]::text[], 110, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('trade_receivables', 1, 'Trade receivables', 'amount', false, 'Where applicable', ARRAY[]::text[], 120, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('inventory', 1, 'Inventory', 'amount', false, 'Where applicable', ARRAY[]::text[], 130, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('trade_payables', 1, 'Trade payables', 'amount', false, 'Where applicable', ARRAY[]::text[], 140, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('total_borrowings', 1, 'Total borrowings', 'amount', false, 'Core if financed', ARRAY[]::text[], 150, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('lease_liabilities', 1, 'Lease liabilities', 'amount', false, 'Where applicable — part of debt only if the profile says so', ARRAY[]::text[], 160, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('current_assets', 1, 'Current assets', 'amount', false, 'For liquidity analytics', ARRAY[]::text[], 170, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('current_liabilities', 1, 'Current liabilities', 'amount', false, 'For liquidity analytics', ARRAY[]::text[], 180, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('ppe', 1, 'Property, plant & equipment', 'amount', false, 'Where applicable', ARRAY[]::text[], 190, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('investments', 1, 'Investments', 'amount', false, 'Where applicable', ARRAY[]::text[], 200, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('employee_cost', 1, 'Employee benefit expense', 'amount', false, 'Where applicable', ARRAY[]::text[], 210, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('finance_cost', 1, 'Finance cost', 'amount', false, 'Where applicable', ARRAY[]::text[], 220, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('related_party', 1, 'Related-party balances / transactions', 'amount', false, 'Optional, if readily available', ARRAY[]::text[], 230, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('inventory_raw_materials', 1, 'Inventory — raw materials', 'amount', false, 'If available', ARRAY['manufacturing']::text[], 240, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('inventory_finished_goods', 1, 'Inventory — finished goods', 'amount', false, 'If available', ARRAY['manufacturing']::text[], 250, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('headcount', 1, 'Employee headcount (period end)', 'count', false, 'For revenue per employee', ARRAY['services']::text[], 260, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('unbilled_revenue', 1, 'Unbilled / accrued revenue', 'amount', false, 'If relevant', ARRAY['services','construction']::text[], 270, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('order_book', 1, 'Order book (unexecuted orders)', 'amount', false, 'Project / order backlog', ARRAY['construction']::text[], 280, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('contract_assets', 1, 'Contract assets', 'amount', false, 'Ind AS 115 / AS 7', ARRAY['construction']::text[], 290, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('contract_liabilities', 1, 'Contract liabilities (incl. advances)', 'amount', false, 'Ind AS 115 / AS 7', ARRAY['construction']::text[], 300, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('retention_receivables', 1, 'Retention money receivable', 'amount', false, 'Where applicable', ARRAY['construction']::text[], 310, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('loan_book', 1, 'Loans & advances (loan book)', 'amount', false, 'NBFC core', ARRAY['nbfc']::text[], 320, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('interest_income', 1, 'Interest income', 'amount', false, 'NBFC core', ARRAY['nbfc']::text[], 330, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('gross_npa', 1, 'Gross NPA / Stage 3 assets', 'amount', false, 'NBFC asset quality', ARRAY['nbfc']::text[], 340, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('net_npa', 1, 'Net NPA', 'amount', false, 'NBFC asset quality', ARRAY['nbfc']::text[], 350, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('capital_adequacy', 1, 'Capital adequacy ratio (CRAR %)', 'percent', false, 'Regulatory metric', ARRAY['nbfc']::text[], 360, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('grants_received', 1, 'Grants / donations received', 'amount', false, 'Section 8 / NPO', ARRAY['section8']::text[], 370, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('restricted_funds', 1, 'Restricted / earmarked funds', 'amount', false, 'Section 8 / NPO', ARRAY['section8']::text[], 380, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('programme_expenditure', 1, 'Programme (objects) expenditure', 'amount', false, 'Section 8 / NPO', ARRAY['section8']::text[], 390, 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.');

INSERT INTO hsdg.analytics_industry_profile
  (profile_key, version, label, description, sub_industries, considerations, average_balances,
   debt_metrics, finance_cost_basis, inventory_cost_bases, payable_cost_bases, inventory_trend_fallback,
   methodology_version, change_note)
VALUES
  ('generic', 1, 'Generic corporate',
   'Generic planning analytics for a commercial entity.',
   ARRAY[]::text[],
   ARRAY[]::text[],
   false, ARRAY['total_borrowings']::text[], 'closing', ARRAY['cost_of_sales','purchases']::text[], ARRAY['purchases','cost_of_sales']::text[], 'revenue',
   'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('manufacturing', 1, 'Manufacturing',
   'Gross margin, inventory days and inventory mix; capacity and input-cost sensitivity.',
   ARRAY['Automotive & components','Chemicals','Pharmaceuticals','Textiles & apparel','FMCG / food processing','Engineering & capital goods','Metals & mining','Electronics']::text[],
   ARRAY['Inventory existence and valuation (raw material / WIP / finished goods mix)','Capacity utilisation and production KPIs','Commodity / input-price sensitivity','Standard costing and overhead absorption']::text[],
   false, ARRAY['total_borrowings']::text[], 'closing', ARRAY['cost_of_sales','purchases']::text[], ARRAY['purchases','cost_of_sales']::text[], 'revenue',
   'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('trading', 1, 'Trading / distribution',
   'Gross margin, inventory, receivable and payable days; concentration and returns.',
   ARRAY['Wholesale distribution','Retail','E-commerce / marketplace seller','Import / export trading','Commodity trading']::text[],
   ARRAY['Customer and supplier concentration','Returns, discounts and rebates','Inventory ageing and slow-moving stock']::text[],
   false, ARRAY['total_borrowings']::text[], 'closing', ARRAY['cost_of_sales','purchases']::text[], ARRAY['purchases','cost_of_sales']::text[], 'revenue',
   'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('services', 1, 'Services',
   'Revenue per employee, employee-cost ratio and unbilled revenue; no inventory analytics.',
   ARRAY['IT / software services','Professional services','Healthcare','Education','Hospitality','Logistics','Media & entertainment','BPO / ITeS']::text[],
   ARRAY['Unbilled / accrued revenue and contract cut-off','Revenue per employee / utilisation metrics','Contract and customer concentration']::text[],
   false, ARRAY['total_borrowings']::text[], 'closing', ARRAY['cost_of_sales','purchases']::text[], ARRAY['purchases','cost_of_sales']::text[], 'revenue',
   'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('construction', 1, 'Construction / project-based',
   'Order book, contract assets / liabilities, retention and unbilled revenue.',
   ARRAY['Infrastructure / EPC','Real estate development','Civil contracting','Engineering projects']::text[],
   ARRAY['Order book and stage-of-completion measurement','Contract assets / liabilities, retentions and advances','Onerous contracts and cost-to-complete estimates']::text[],
   false, ARRAY['total_borrowings']::text[], 'closing', ARRAY['cost_of_sales','purchases']::text[], ARRAY['purchases','cost_of_sales']::text[], 'revenue',
   'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('nbfc', 1, 'NBFC / financial services',
   'Sector methodology: asset quality, net interest margin and capital adequacy. Generic working-capital ratios do not apply.',
   ARRAY['Investment & credit company (NBFC-ICC)','Housing finance company (HFC)','Microfinance (NBFC-MFI)','Core investment company (CIC)','Asset reconstruction company (ARC)','Infrastructure finance (NBFC-IFC)']::text[],
   ARRAY['Sector-specific RBI regulatory metrics (capital adequacy, NPA / ECL staging)','Generic working-capital ratios do not apply — use the sector methodology','Asset-liability maturity profile and liquidity coverage']::text[],
   true, ARRAY['total_borrowings']::text[], 'average', ARRAY['cost_of_sales','purchases']::text[], ARRAY['purchases','cost_of_sales']::text[], NULL,
   'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('section8', 1, 'Section 8 / not-for-profit',
   'Grants, restricted funds and programme expenditure; no margin or inventory analytics.',
   ARRAY['Charitable activities','Education','Healthcare','Skill development','CSR implementation agency']::text[],
   ARRAY['Grants, donations and restricted funds','Programme / utilisation metrics and application of income','Compliance with registration conditions']::text[],
   false, ARRAY['total_borrowings']::text[], 'closing', ARRAY['cost_of_sales','purchases']::text[], ARRAY['purchases','cost_of_sales']::text[], NULL,
   'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.');

INSERT INTO hsdg.analytics_rule
  (rule_code, version, rule_key, name, kind, applies_to, excluded_for, required_metrics, formula, definition,
   parameter_type, parameter_value, enhanced_at, immediate_at, min_data_status, min_source_types,
   signal_wording, why_may_matter, affected_areas, suggested_attention, methodology_version, change_note)
VALUES
  ('PAR-001', 1, 'gross_margin', 'Gross margin', 'ratio', ARRAY[]::text[], ARRAY['nbfc','section8']::text[], ARRAY['gross_profit','revenue']::text[],
   'Gross profit / Revenue × 100',
   '{"kind":"ratio","num":{"metric":"gross_profit"},"den":{"metric":"revenue"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-002', 1, 'pbt_margin', 'PBT margin', 'ratio', ARRAY[]::text[], ARRAY[]::text[], ARRAY['pbt','revenue']::text[],
   'Profit before tax / Revenue × 100',
   '{"kind":"ratio","num":{"metric":"pbt"},"den":{"metric":"revenue"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-003', 1, 'pat_margin', 'PAT margin', 'ratio', ARRAY[]::text[], ARRAY[]::text[], ARRAY['pat','revenue']::text[],
   'Profit after tax / Revenue × 100',
   '{"kind":"ratio","num":{"metric":"pat"},"den":{"metric":"revenue"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-004', 1, 'receivable_days', 'Receivable days', 'ratio', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['trade_receivables','revenue']::text[],
   'Trade receivables / Revenue × 365',
   '{"kind":"ratio","num":{"metric":"trade_receivables","balance":"average"},"den":{"metric":"revenue"},"scale":365,"unit":"days"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-005', 1, 'inventory_days', 'Inventory days', 'ratio', ARRAY[]::text[], ARRAY['nbfc','services','section8']::text[], ARRAY['inventory']::text[],
   'Inventory / Cost base × 365 (cost base per profile; never Revenue)',
   '{"kind":"ratio","num":{"metric":"inventory","balance":"average"},"den":{"base":"inventory_cost"},"scale":365,"unit":"days"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-006', 1, 'payable_days', 'Payable days', 'ratio', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['trade_payables']::text[],
   'Trade payables / Purchases or cost base × 365 (never Revenue)',
   '{"kind":"ratio","num":{"metric":"trade_payables","balance":"average"},"den":{"base":"payable_cost"},"scale":365,"unit":"days"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-007', 1, 'current_ratio', 'Current ratio', 'ratio', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['current_assets','current_liabilities']::text[],
   'Current assets / Current liabilities',
   '{"kind":"ratio","num":{"metric":"current_assets"},"den":{"metric":"current_liabilities"},"scale":1,"unit":"x"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-008', 1, 'debt_equity', 'Debt to equity', 'ratio', ARRAY[]::text[], ARRAY[]::text[], ARRAY['net_worth']::text[],
   'Debt (profile definition) / Net worth',
   '{"kind":"ratio","num":{"debt":true},"den":{"metric":"net_worth"},"scale":1,"unit":"x"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-009', 1, 'finance_cost_rate', 'Finance cost to borrowings', 'ratio', ARRAY[]::text[], ARRAY[]::text[], ARRAY['finance_cost']::text[],
   'Finance cost / Debt (average or closing per profile) × 100',
   '{"kind":"ratio","num":{"metric":"finance_cost"},"den":{"debt":true,"balance":"finance_cost_basis"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-010', 1, 'employee_cost_ratio', 'Employee-cost ratio', 'ratio', ARRAY[]::text[], ARRAY[]::text[], ARRAY['employee_cost','revenue']::text[],
   'Employee cost / Revenue × 100',
   '{"kind":"ratio","num":{"metric":"employee_cost"},"den":{"metric":"revenue"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-011', 1, 'working_capital', 'Trade working capital', 'ratio', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['trade_receivables','inventory','trade_payables']::text[],
   'Trade receivables + Inventory − Trade payables',
   '{"kind":"ratio","value":{"sum":[{"metric":"trade_receivables"},{"metric":"inventory"}],"less":[{"metric":"trade_payables"}]},"unit":"amount"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-012', 1, 'working_capital_days', 'Working-capital days', 'ratio', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['revenue']::text[],
   '(Trade receivables + Inventory − Trade payables) / Revenue × 365',
   '{"kind":"ratio","num":{"sum":[{"metric":"trade_receivables"},{"metric":"inventory"}],"less":[{"metric":"trade_payables"}]},"den":{"metric":"revenue"},"scale":365,"unit":"days"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-013', 1, 'revenue_per_employee', 'Revenue per employee', 'ratio', ARRAY['services']::text[], ARRAY[]::text[], ARRAY['revenue','headcount']::text[],
   'Revenue / Headcount',
   '{"kind":"ratio","num":{"metric":"revenue"},"den":{"metric":"headcount"},"scale":1,"unit":"per_unit"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-014', 1, 'unbilled_revenue_days', 'Unbilled revenue days', 'ratio', ARRAY['services','construction']::text[], ARRAY[]::text[], ARRAY['unbilled_revenue','revenue']::text[],
   'Unbilled revenue / Revenue × 365',
   '{"kind":"ratio","num":{"metric":"unbilled_revenue"},"den":{"metric":"revenue"},"scale":365,"unit":"days"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-015', 1, 'order_book_cover', 'Order-book cover', 'ratio', ARRAY['construction']::text[], ARRAY[]::text[], ARRAY['order_book','revenue']::text[],
   'Order book / Revenue',
   '{"kind":"ratio","num":{"metric":"order_book"},"den":{"metric":"revenue"},"scale":1,"unit":"x"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-016', 1, 'contract_assets_days', 'Contract-asset days', 'ratio', ARRAY['construction']::text[], ARRAY[]::text[], ARRAY['contract_assets','revenue']::text[],
   'Contract assets / Revenue × 365',
   '{"kind":"ratio","num":{"metric":"contract_assets"},"den":{"metric":"revenue"},"scale":365,"unit":"days"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-017', 1, 'contract_liabilities_ratio', 'Contract liabilities to revenue', 'ratio', ARRAY['construction']::text[], ARRAY[]::text[], ARRAY['contract_liabilities','revenue']::text[],
   'Contract liabilities / Revenue × 100',
   '{"kind":"ratio","num":{"metric":"contract_liabilities"},"den":{"metric":"revenue"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-018', 1, 'retention_ratio', 'Retention to revenue', 'ratio', ARRAY['construction']::text[], ARRAY[]::text[], ARRAY['retention_receivables','revenue']::text[],
   'Retention receivable / Revenue × 100',
   '{"kind":"ratio","num":{"metric":"retention_receivables"},"den":{"metric":"revenue"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-019', 1, 'finished_goods_share', 'Finished goods share of inventory', 'ratio', ARRAY['manufacturing']::text[], ARRAY[]::text[], ARRAY['inventory_finished_goods','inventory']::text[],
   'Finished goods / Inventory × 100',
   '{"kind":"ratio","num":{"metric":"inventory_finished_goods"},"den":{"metric":"inventory"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-020', 1, 'gross_npa_ratio', 'Gross NPA ratio', 'ratio', ARRAY['nbfc']::text[], ARRAY[]::text[], ARRAY['gross_npa','loan_book']::text[],
   'Gross NPA / Loan book × 100',
   '{"kind":"ratio","num":{"metric":"gross_npa"},"den":{"metric":"loan_book"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-021', 1, 'net_npa_ratio', 'Net NPA ratio', 'ratio', ARRAY['nbfc']::text[], ARRAY[]::text[], ARRAY['net_npa','loan_book']::text[],
   'Net NPA / Loan book × 100',
   '{"kind":"ratio","num":{"metric":"net_npa"},"den":{"metric":"loan_book"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-022', 1, 'net_interest_margin', 'Net interest margin', 'ratio', ARRAY['nbfc']::text[], ARRAY[]::text[], ARRAY['interest_income','finance_cost','loan_book']::text[],
   '(Interest income − Finance cost) / Loan book (average per profile) × 100',
   '{"kind":"ratio","num":{"sum":[{"metric":"interest_income"}],"less":[{"metric":"finance_cost"}]},"den":{"metric":"loan_book","balance":"average"},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-023', 1, 'programme_expense_ratio', 'Programme expenditure ratio', 'ratio', ARRAY['section8']::text[], ARRAY[]::text[], ARRAY['programme_expenditure']::text[],
   'Programme expenditure / (Revenue + Other income + Grants) × 100',
   '{"kind":"ratio","num":{"metric":"programme_expenditure"},"den":{"sum":[{"metric":"revenue"},{"metric":"other_income"},{"metric":"grants_received"}]},"scale":100,"unit":"%"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-024', 1, 'restricted_funds_cover', 'Restricted-fund cover', 'ratio', ARRAY['section8']::text[], ARRAY[]::text[], ARRAY['restricted_funds']::text[],
   '(Cash & bank + Investments) / Restricted funds',
   '{"kind":"ratio","num":{"sum":[{"metric":"cash_bank"},{"metric":"investments"}]},"den":{"metric":"restricted_funds"},"scale":1,"unit":"x"}'::jsonb,
   NULL, NULL, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '',
   '',
   ARRAY[]::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-025', 1, 'movement_revenue', 'Revenue — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['revenue']::text[],
   '(CY − PY) / |PY| × 100 for Revenue',
   '{"kind":"movement","metric":"revenue"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in revenue may indicate changes in the business, cut-off or recognition practices that the audit plan should reflect.',
   ARRAY['Revenue']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-026', 1, 'movement_gross_profit', 'Gross profit — movement', 'movement', ARRAY[]::text[], ARRAY['nbfc','section8']::text[], ARRAY['gross_profit']::text[],
   '(CY − PY) / |PY| × 100 for Gross profit',
   '{"kind":"movement","metric":"gross_profit"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in gross profit may reflect pricing, cost or classification changes.',
   ARRAY['Revenue','Cost of sales']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-027', 1, 'movement_pbt', 'Profit before tax — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['pbt']::text[],
   '(CY − PY) / |PY| × 100 for Profit before tax',
   '{"kind":"movement","metric":"pbt"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in profit may reflect changes in operations, estimates or one-off items.',
   ARRAY['Profit & loss']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-028', 1, 'movement_pat', 'Profit after tax — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['pat']::text[],
   '(CY − PY) / |PY| × 100 for Profit after tax',
   '{"kind":"movement","metric":"pat"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in profit after tax may reflect operating, tax or one-off changes.',
   ARRAY['Profit & loss','Taxation']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-029', 1, 'movement_cash_bank', 'Cash & bank — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['cash_bank']::text[],
   '(CY − PY) / |PY| × 100 for Cash & bank',
   '{"kind":"movement","metric":"cash_bank"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in cash may reflect financing, collection or liquidity changes.',
   ARRAY['Cash & bank']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-030', 1, 'movement_trade_receivables', 'Trade receivables — movement', 'movement', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['trade_receivables']::text[],
   '(CY − PY) / |PY| × 100 for Trade receivables',
   '{"kind":"movement","metric":"trade_receivables"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in receivables may reflect credit terms, collections or revenue cut-off.',
   ARRAY['Trade receivables','Revenue']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-031', 1, 'movement_inventory', 'Inventory — movement', 'movement', ARRAY[]::text[], ARRAY['services','nbfc','section8']::text[], ARRAY['inventory']::text[],
   '(CY − PY) / |PY| × 100 for Inventory',
   '{"kind":"movement","metric":"inventory"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in inventory may reflect build-up, obsolescence or valuation matters.',
   ARRAY['Inventory','Cost of sales']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-032', 1, 'movement_trade_payables', 'Trade payables — movement', 'movement', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['trade_payables']::text[],
   '(CY − PY) / |PY| × 100 for Trade payables',
   '{"kind":"movement","metric":"trade_payables"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in payables may reflect purchasing, payment terms or cut-off.',
   ARRAY['Trade payables','Purchases']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-033', 1, 'movement_total_borrowings', 'Total borrowings — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['total_borrowings']::text[],
   '(CY − PY) / |PY| × 100 for Total borrowings',
   '{"kind":"movement","metric":"total_borrowings"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in borrowings may bring new terms, covenants or classification matters.',
   ARRAY['Borrowings']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-034', 1, 'movement_employee_cost', 'Employee cost — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['employee_cost']::text[],
   '(CY − PY) / |PY| × 100 for Employee cost',
   '{"kind":"movement","metric":"employee_cost"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in employee cost may reflect headcount, pay or benefit-plan changes.',
   ARRAY['Employee benefits']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-035', 1, 'movement_finance_cost', 'Finance cost — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['finance_cost']::text[],
   '(CY − PY) / |PY| × 100 for Finance cost',
   '{"kind":"movement","metric":"finance_cost"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in finance cost may reflect new borrowings, rates or capitalisation.',
   ARRAY['Finance cost','Borrowings']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-036', 1, 'movement_related_party', 'Related-party balances / transactions — movement', 'movement', ARRAY[]::text[], ARRAY[]::text[], ARRAY['related_party']::text[],
   '(CY − PY) / |PY| × 100 for Related-party balances / transactions',
   '{"kind":"movement","metric":"related_party","newFromNil":true,"nilWording":"{{label}} is {{cy}} this year against nil last year (new relationship)."}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant or new related-party relationship may need identification, approval and disclosure work (SA 550).',
   ARRAY['Related parties']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-037', 1, 'rel_revenue_receivables', 'Revenue vs receivables', 'relationship', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['trade_receivables','revenue']::text[],
   'Growth of trade receivables − growth of revenue (percentage points)',
   '{"kind":"relationship","a":{"metric":"trade_receivables"},"b":{"metric":"revenue"}}'::jsonb,
   'relationship', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Trade receivables moved {{ga}} while revenue moved {{gb}} — receivables have grown {{fasterSlower}} than revenue.',
   'Receivables growing out of line with revenue may point to changes in credit terms, collection difficulties or revenue cut-off matters to understand.',
   ARRAY['Trade receivables','Revenue']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-038', 1, 'rel_revenue_inventory', 'Revenue / cost vs inventory', 'relationship', ARRAY[]::text[], ARRAY['services','nbfc','section8']::text[], ARRAY['inventory']::text[],
   'Growth of inventory − growth of the cost base (cost of sales → purchases → profile fallback)',
   '{"kind":"relationship","a":{"metric":"inventory"},"b":{"base":"inventory_trend"}}'::jsonb,
   'relationship', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Inventory moved {{ga}} while {{bLower}} moved {{gb}} — inventory movement is inconsistent with the {{bLower}} trend.',
   'Inventory moving out of line with the cost trend may point to build-up, slow-moving stock or valuation matters to understand.',
   ARRAY['Inventory','Cost of sales']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-039', 1, 'rel_borrowings_finance_cost', 'Borrowings vs finance cost', 'relationship', ARRAY[]::text[], ARRAY[]::text[], ARRAY['finance_cost']::text[],
   'Growth of finance cost − growth of debt (percentage points)',
   '{"kind":"relationship","a":{"metric":"finance_cost"},"b":{"debt":true}}'::jsonb,
   'relationship', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Finance cost moved {{ga}} while borrowings moved {{gb}} — the finance-cost movement appears inconsistent with the debt movement.',
   'Finance cost out of line with debt may reflect new facilities, rate changes, capitalised interest or unrecorded borrowings.',
   ARRAY['Finance cost','Borrowings']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-040', 1, 'rel_profit_cash', 'Profit vs cash', 'relationship', ARRAY[]::text[], ARRAY[]::text[], ARRAY['pat','cash_bank']::text[],
   'PAT and cash & bank move in opposite directions; gap in percentage points',
   '{"kind":"relationship","a":{"metric":"pat"},"b":{"metric":"cash_bank"},"oppositeDirection":true}'::jsonb,
   'relationship', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Profit after tax moved {{ga}} while cash & bank moved {{gb}} — the profit trend is inconsistent with the cash trend.',
   'Profit and cash moving apart may reflect working-capital changes, revenue recognition timing or financing.',
   ARRAY['Revenue','Trade receivables','Cash & bank']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-041', 1, 'gross_margin_shift', 'Gross margin shift', 'ratio_shift', ARRAY[]::text[], ARRAY['nbfc','section8']::text[], ARRAY['gross_profit','revenue']::text[],
   'Gross margin CY − PY (percentage points)',
   '{"kind":"ratio_shift","ratio":"gross_margin"}'::jsonb,
   'ratio', 3, 6, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
   'A change in gross margin may reflect pricing, cost, product-mix or classification changes, or cut-off matters.',
   ARRAY['Revenue','Cost of sales','Inventory']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-042', 1, 'rel_revenue_employee_cost', 'Revenue vs employee cost', 'ratio_shift', ARRAY[]::text[], ARRAY[]::text[], ARRAY['employee_cost','revenue']::text[],
   'Employee-cost ratio CY − PY (percentage points)',
   '{"kind":"ratio_shift","ratio":"employee_cost_ratio"}'::jsonb,
   'ratio', 3, 6, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
   'A change in the employee-cost relationship may reflect headcount, pay or benefit-plan changes or classification.',
   ARRAY['Employee benefits']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-043', 1, 'working_capital_trend', 'Working-capital trend', 'ratio_shift', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['revenue']::text[],
   'Working-capital days CY − PY',
   '{"kind":"ratio_shift","ratio":"working_capital_days"}'::jsonb,
   'ratio', 30, 60, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Trade working capital moved from {{py}} to {{cy}} of revenue ({{delta}}).',
   'A change in the working-capital cycle may reflect credit terms, collection, stock-holding or payment practices, and affects liquidity.',
   ARRAY['Trade receivables','Inventory','Trade payables']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-044', 1, 'gross_margin_trend_reversal', 'Gross margin trend reversal', 'trend_reversal', ARRAY[]::text[], ARRAY['nbfc','section8']::text[], ARRAY['gross_profit','revenue']::text[],
   'Gross margin direction PY−1→PY vs PY→CY (needs the prior file’s prior-year figures)',
   '{"kind":"trend_reversal","ratio":"gross_margin"}'::jsonb,
   'trend', 1, 3, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} {{dir1}} from {{pp}} to {{py}} last year but {{dir2}} to {{cy}} this year — the margin trend has reversed.',
   'A reversal of the margin trend may reflect pricing, cost or mix changes, or cut-off and classification matters.',
   ARRAY['Revenue','Cost of sales','Inventory']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-045', 1, 'liquidity_current_ratio', 'Liquidity — current ratio', 'ratio_change', ARRAY[]::text[], ARRAY['nbfc']::text[], ARRAY['current_assets','current_liabilities']::text[],
   'Current ratio % change; or falls below 1',
   '{"kind":"ratio_change","ratio":"current_ratio","crossBelow":1,"crossAttention":"enhanced","crossWording":"{{label}} moved from {{py}} to {{cy}} and is now below {{level}}."}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved from {{py}} to {{cy}}.',
   'A significant change in liquidity may need explanation and can bear on going-concern considerations (SA 570).',
   ARRAY['Going concern / liquidity','Borrowings']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-046', 1, 'negative_net_worth', 'Negative net worth', 'threshold', ARRAY[]::text[], ARRAY[]::text[], ARRAY['net_worth']::text[],
   'Net worth (CY) < 0',
   '{"kind":"threshold","metric":"net_worth","op":"lt"}'::jsonb,
   'absolute', 0, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Net worth is negative at the period end ({{value}}).',
   'Negative equity can bear on going concern (SA 570), borrowing covenants and regulatory matters.',
   ARRAY['Going concern / liquidity','Equity']::text[], 'enhanced', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-047', 1, 'revenue_per_employee_change', 'Revenue per employee change', 'ratio_change', ARRAY['services']::text[], ARRAY[]::text[], ARRAY['revenue','headcount']::text[],
   'Revenue per employee % change',
   '{"kind":"ratio_change","ratio":"revenue_per_employee"}'::jsonb,
   'percent', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (from {{py}} to {{cy}}).',
   'A change in revenue per employee may reflect utilisation, pricing or revenue recognition matters in a services business.',
   ARRAY['Revenue','Employee benefits']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-048', 1, 'rel_revenue_unbilled', 'Revenue vs unbilled revenue', 'relationship', ARRAY['services','construction']::text[], ARRAY[]::text[], ARRAY['unbilled_revenue','revenue']::text[],
   'Growth of unbilled revenue − growth of revenue (percentage points)',
   '{"kind":"relationship","a":{"metric":"unbilled_revenue"},"b":{"metric":"revenue"}}'::jsonb,
   'relationship', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Unbilled revenue moved {{ga}} while revenue moved {{gb}} — unbilled revenue has grown {{fasterSlower}} than revenue.',
   'Unbilled revenue growing out of line with revenue may point to cut-off, estimation or billing matters.',
   ARRAY['Revenue','Contract assets / liabilities']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-049', 1, 'rel_revenue_contract_assets', 'Revenue vs contract assets', 'relationship', ARRAY['construction']::text[], ARRAY[]::text[], ARRAY['contract_assets','revenue']::text[],
   'Growth of contract assets − growth of revenue (percentage points)',
   '{"kind":"relationship","a":{"metric":"contract_assets"},"b":{"metric":"revenue"}}'::jsonb,
   'relationship', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Contract assets moved {{ga}} while revenue moved {{gb}} — contract assets have grown {{fasterSlower}} than revenue.',
   'Contract assets out of line with revenue may point to stage-of-completion estimates, billing delays or recoverability matters.',
   ARRAY['Revenue','Contract assets / liabilities']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-050', 1, 'movement_order_book', 'Order book — movement', 'movement', ARRAY['construction']::text[], ARRAY[]::text[], ARRAY['order_book']::text[],
   '(CY − PY) / |PY| × 100 for Order book',
   '{"kind":"movement","metric":"order_book"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in the order book may affect revenue trends and the assessment of onerous contracts.',
   ARRAY['Revenue','Contract assets / liabilities']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-051', 1, 'movement_retention_receivables', 'Retention money receivable — movement', 'movement', ARRAY['construction']::text[], ARRAY[]::text[], ARRAY['retention_receivables']::text[],
   '(CY − PY) / |PY| × 100 for Retention money receivable',
   '{"kind":"movement","metric":"retention_receivables"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in retention money may reflect contract terms, disputes or recoverability matters.',
   ARRAY['Trade receivables','Contract assets / liabilities']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-052', 1, 'nbfc_gross_npa_shift', 'Gross NPA ratio shift', 'ratio_shift', ARRAY['nbfc']::text[], ARRAY[]::text[], ARRAY['gross_npa','loan_book']::text[],
   'Gross NPA ratio CY − PY (percentage points)',
   '{"kind":"ratio_shift","ratio":"gross_npa_ratio"}'::jsonb,
   'ratio', 1, 2, 4, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
   'A change in asset quality bears on impairment / ECL measurement, income recognition and RBI prudential reporting.',
   ARRAY['Loans & advances','Impairment / ECL']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-053', 1, 'nbfc_crar_below_level', 'Capital adequacy below configured level', 'threshold', ARRAY['nbfc']::text[], ARRAY[]::text[], ARRAY['capital_adequacy']::text[],
   'CRAR % (CY) < configured level',
   '{"kind":"threshold","metric":"capital_adequacy","op":"lt"}'::jsonb,
   'absolute', 15, NULL, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Capital adequacy (CRAR) is {{value}} at the period end, below the configured level of {{threshold}}.',
   'Capital adequacy below the regulatory level for the NBFC’s layer can bring regulatory action and bear on going concern and disclosures (RBI Scale Based Regulation).',
   ARRAY['Regulatory compliance','Going concern / liquidity']::text[], 'immediate_partner', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-054', 1, 'rel_loan_book_interest_income', 'Loan book vs interest income', 'relationship', ARRAY['nbfc']::text[], ARRAY[]::text[], ARRAY['interest_income','loan_book']::text[],
   'Growth of interest income − growth of loan book (percentage points)',
   '{"kind":"relationship","a":{"metric":"interest_income"},"b":{"metric":"loan_book"}}'::jsonb,
   'relationship', 20, 40, NULL, ARRAY[]::text[], ARRAY[]::text[],
   'Interest income moved {{ga}} while the loan book moved {{gb}} — interest income has grown {{fasterSlower}} than the loan book.',
   'Interest income out of line with the loan book may reflect yield changes, income recognition on stressed assets or classification.',
   ARRAY['Interest income','Loans & advances']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-055', 1, 'movement_grants_received', 'Grants / donations received — movement', 'movement', ARRAY['section8']::text[], ARRAY[]::text[], ARRAY['grants_received']::text[],
   '(CY − PY) / |PY| × 100 for Grants / donations received',
   '{"kind":"movement","metric":"grants_received"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in grants may affect income recognition and compliance with grant conditions.',
   ARRAY['Grants','Revenue']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-056', 1, 'movement_restricted_funds', 'Restricted / earmarked funds — movement', 'movement', ARRAY['section8']::text[], ARRAY[]::text[], ARRAY['restricted_funds']::text[],
   '(CY − PY) / |PY| × 100 for Restricted / earmarked funds',
   '{"kind":"movement","metric":"restricted_funds"}'::jsonb,
   'percent', 25, 50, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved {{change}} (CY {{cy}} vs PY {{py}}).',
   'A significant change in restricted funds may affect fund accounting and compliance with donor conditions.',
   ARRAY['Funds / reserves','Grants']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.'),
  ('PAR-057', 1, 'section8_programme_ratio_shift', 'Programme expenditure ratio shift', 'ratio_shift', ARRAY['section8']::text[], ARRAY[]::text[], ARRAY['programme_expenditure']::text[],
   'Programme expenditure ratio CY − PY (percentage points)',
   '{"kind":"ratio_shift","ratio":"programme_expense_ratio"}'::jsonb,
   'ratio', 10, 20, NULL, ARRAY[]::text[], ARRAY[]::text[],
   '{{label}} moved from {{py}} to {{cy}} ({{delta}}).',
   'A change in the share of income applied to the objects may bear on registration conditions and the application-of-income requirements.',
   ARRAY['Programme expenditure','Regulatory compliance']::text[], 'standard', 'dhvaj-analytics-2026.1', 'v1 — moved from the hard-coded analytics engine.');

-- An Investigation Card remembers the library rule + version it was raised
-- under, and the methodology's "why it may matter" (§13, §15).
ALTER TABLE hsdg.audit_analytics_exception
  ADD COLUMN rule_code      text CHECK (rule_code IS NULL OR rule_code ~ '^PAR-[0-9]{3}$'),
  ADD COLUMN rule_version   integer CHECK (rule_version IS NULL OR rule_version >= 1),
  ADD COLUMN why_may_matter text;

-- Existing cards came from the code rules the seed reproduces (v1). Backfill
-- the trace without moving updated_at / version.
ALTER TABLE hsdg.audit_analytics_exception
  DISABLE TRIGGER audit_analytics_exception_set_updated_at;
UPDATE hsdg.audit_analytics_exception c
   SET rule_code = r.rule_code, rule_version = r.version, why_may_matter = r.why_may_matter
  FROM hsdg.analytics_rule r
 WHERE c.rule_key = r.rule_key AND r.version = 1;
ALTER TABLE hsdg.audit_analytics_exception
  ENABLE TRIGGER audit_analytics_exception_set_updated_at;

-- Industry profiles are data now: a file may pick any profile key in the
-- library (the service checks it is in force), not a fixed list.
ALTER TABLE hsdg.audit_business_understanding
  DROP CONSTRAINT audit_business_understanding_industry_profile_check;
ALTER TABLE hsdg.audit_business_understanding
  ADD CONSTRAINT audit_business_understanding_industry_profile_check
  CHECK (industry_profile ~ '^[a-z0-9_]{2,40}$');

-- After the seed: the migrator itself has no RLS context.
ALTER TABLE hsdg.analytics_metric_definition FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.analytics_industry_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.analytics_rule FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.audit_business_understanding
  DISABLE TRIGGER audit_business_understanding_set_updated_at;
UPDATE hsdg.audit_business_understanding
   SET industry_profile = 'generic'
 WHERE industry_profile NOT IN
       ('generic','manufacturing','trading','services','construction','nbfc','section8');
ALTER TABLE hsdg.audit_business_understanding
  ENABLE TRIGGER audit_business_understanding_set_updated_at;
ALTER TABLE hsdg.audit_business_understanding
  DROP CONSTRAINT audit_business_understanding_industry_profile_check;
ALTER TABLE hsdg.audit_business_understanding
  ADD CONSTRAINT audit_business_understanding_industry_profile_check
  CHECK (industry_profile IN ('generic','manufacturing','trading','services','construction',
                              'nbfc','section8'));

ALTER TABLE hsdg.audit_analytics_exception
  DROP COLUMN IF EXISTS why_may_matter,
  DROP COLUMN IF EXISTS rule_version,
  DROP COLUMN IF EXISTS rule_code;
DROP TABLE IF EXISTS hsdg.analytics_rule;
DROP TABLE IF EXISTS hsdg.analytics_industry_profile;
DROP TABLE IF EXISTS hsdg.analytics_metric_definition;
