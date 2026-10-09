-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.3 Schedule III & Presentation Framework — the versioned presentation
-- library (DHVAJ Section 02.3 spec §7, §8, §9, §11, §12, §14, §15).
--
-- Nothing about presentation lives in code: the engine reads
--   • hsdg.schedule_iii_framework_version  — one row per Division per MCA
--     amendment: effective dates, notification, the Division provision, the
--     ICAI Guidance Note + version, the required FS components and the FS
--     workbook template key (spec §8, §9, §16);
--   • hsdg.schedule_iii_disclosure_requirement — the disclosure universe of
--     each Division, effective-dated per requirement, baseline-mandatory or
--     triggered by a named fact (spec §11, §12);
--   • hsdg.schedule_iii_specialised_format_rule — which 02.1 special-entity
--     category is governed by another statute's format, and how (spec §7);
--   • the Audit Rules Library — the rounding band now carries its permitted
--     units as rule data, and the Division presentation-materiality thresholds
--     ("1% of revenue or ₹X, whichever is higher") are rules (spec §14, §15).
--
-- Library tables are firm-wide reference data: every signed-in role reads;
-- only firm-wide roles write (as the Audit Rules Library).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.schedule_iii_framework_version (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id                text NOT NULL CHECK (framework_id ~ '^[A-Z0-9_]{2,60}$'),
  division                    text NOT NULL CHECK (division IN ('I','II','III')),
  title                       text NOT NULL CHECK (length(trim(title)) > 0),
  version_label               text NOT NULL CHECK (length(trim(version_label)) > 0),
  effective_from              date NOT NULL,
  effective_to                date,
  notification_reference      text,
  provision_code              text,
  guidance_provision_code     text,
  guidance_version            text,
  -- [{key, label, when: 'always' | 'cash_flow_required', oci?: boolean}]
  components                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_key                text CHECK (template_key IS NULL OR template_key ~ '^[a-z0-9_]{2,80}$'),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_iii_framework_version_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT schedule_iii_framework_version_key UNIQUE (framework_id, effective_from)
);
CREATE INDEX schedule_iii_framework_version_division_idx
  ON hsdg.schedule_iii_framework_version (division, effective_from);

CREATE TABLE hsdg.schedule_iii_disclosure_requirement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id    text NOT NULL CHECK (framework_id ~ '^[A-Z0-9_]{2,60}$'),
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,80}$'),
  category        text NOT NULL CHECK (category IN (
                    'balance_sheet','profit_and_loss','additional_regulatory_information',
                    'ratios','property_title_deeds','loans_advances','borrowings_charges',
                    'benami_property','undisclosed_income','crypto_virtual_currency','csr',
                    'promoter_shareholding','struck_off_companies','consolidated',
                    'transition','other')),
  label           text NOT NULL CHECK (length(trim(label)) > 0),
  description     text,
  -- NULL = baseline-mandatory; otherwise the fact that activates it (spec §12).
  trigger_fact    text CHECK (trigger_fact IS NULL OR trigger_fact IN (
                    'ppe_exists','immovable_property_exists','intangibles_exist',
                    'borrowings_exist','loans_given','investments_exist',
                    'csr_applicable','cfs_required','first_time_ind_as')),
  provision_code  text,
  cross_link      text,
  sort_order      integer NOT NULL DEFAULT 0,
  effective_from  date NOT NULL,
  effective_to    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_iii_disclosure_requirement_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT schedule_iii_disclosure_requirement_key UNIQUE (framework_id, code, effective_from)
);
CREATE INDEX schedule_iii_disclosure_requirement_fw_idx
  ON hsdg.schedule_iii_disclosure_requirement (framework_id, effective_from);

CREATE TABLE hsdg.schedule_iii_specialised_format_rule (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,60}$'),
  entity_category      text NOT NULL CHECK (entity_category ~ '^[a-z0-9_]{2,40}$'),
  governing_authority  text NOT NULL CHECK (length(trim(governing_authority)) > 0),
  framework_name       text NOT NULL CHECK (length(trim(framework_name)) > 0),
  effect               text NOT NULL CHECK (effect IN ('replaces','modifies','supplements')),
  provision_code       text,
  effective_from       date NOT NULL,
  effective_to         date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_iii_specialised_format_rule_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT schedule_iii_specialised_format_rule_key UNIQUE (code, effective_from)
);

ALTER TABLE hsdg.schedule_iii_framework_version       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.schedule_iii_disclosure_requirement  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.schedule_iii_specialised_format_rule ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedule_iii_framework_version_read ON hsdg.schedule_iii_framework_version
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY schedule_iii_framework_version_write ON hsdg.schedule_iii_framework_version
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY schedule_iii_disclosure_requirement_read ON hsdg.schedule_iii_disclosure_requirement
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY schedule_iii_disclosure_requirement_write ON hsdg.schedule_iii_disclosure_requirement
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY schedule_iii_specialised_format_rule_read ON hsdg.schedule_iii_specialised_format_rule
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY schedule_iii_specialised_format_rule_write ON hsdg.schedule_iii_specialised_format_rule
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- ── Framework versions (spec §8, §9) ────────────────────────────────────────
-- Each Division as first notified, then as amended by G.S.R. 207(E) of
-- 24 March 2021 (effective for periods from 1 April 2021).
INSERT INTO hsdg.schedule_iii_framework_version
  (framework_id, division, title, version_label, effective_from, effective_to,
   notification_reference, provision_code, guidance_provision_code, guidance_version,
   components, template_key)
SELECT v.framework_id, v.division, v.title, v.version_label, v.eff::date, v.eff_to::date,
       v.notification, v.provision_code, v.guidance_code, v.guidance_version,
       CASE v.division
         WHEN 'I' THEN
           '[{"key":"balance_sheet","label":"Balance Sheet","when":"always"},
             {"key":"statement_of_profit_and_loss","label":"Statement of Profit and Loss","when":"always"},
             {"key":"cash_flow_statement","label":"Cash Flow Statement","when":"cash_flow_required"},
             {"key":"notes_to_accounts","label":"Notes to Financial Statements","when":"always"}]'::jsonb
         ELSE
           '[{"key":"balance_sheet","label":"Balance Sheet","when":"always"},
             {"key":"statement_of_profit_and_loss","label":"Statement of Profit and Loss (including Other Comprehensive Income)","when":"always","oci":true},
             {"key":"statement_of_changes_in_equity","label":"Statement of Changes in Equity","when":"always"},
             {"key":"cash_flow_statement","label":"Cash Flow Statement","when":"cash_flow_required"},
             {"key":"notes_to_accounts","label":"Notes to Financial Statements","when":"always"}]'::jsonb
       END,
       v.template_key
FROM (VALUES
  ('SCHEDULE_III_DIVISION_I', 'I', 'Schedule III Division I — Accounting Standards',
   'As notified with the Companies Act, 2013', '2014-04-01', '2021-03-31',
   'Companies Act, 2013 — Schedule III commenced 1 April 2014 (S.O. 902(E), 26 March 2014)',
   'SCH_III_DIV_I', 'ICAI_GN_SCH_III_DIV_I', 'Edition in force before the 2021 amendment',
   'fs_workbook_as_div_i'),
  ('SCHEDULE_III_DIVISION_I', 'I', 'Schedule III Division I — Accounting Standards',
   'As amended by G.S.R. 207(E), 24 March 2021', '2021-04-01', NULL,
   'MCA notification G.S.R. 207(E) dated 24 March 2021',
   'SCH_III_DIV_I', 'ICAI_GN_SCH_III_DIV_I', '2022 edition (reflects the 2021 amendments)',
   'fs_workbook_as_div_i'),
  ('SCHEDULE_III_DIVISION_II', 'II', 'Schedule III Division II — Ind AS (other than NBFC)',
   'As inserted by G.S.R. 404(E), 6 April 2016', '2015-04-01', '2021-03-31',
   'MCA notification G.S.R. 404(E) dated 6 April 2016',
   'SCH_III_DIV_II', 'ICAI_GN_SCH_III_DIV_II', 'Edition in force before the 2021 amendment',
   'fs_workbook_indas_div_ii'),
  ('SCHEDULE_III_DIVISION_II', 'II', 'Schedule III Division II — Ind AS (other than NBFC)',
   'As amended by G.S.R. 207(E), 24 March 2021', '2021-04-01', NULL,
   'MCA notification G.S.R. 207(E) dated 24 March 2021',
   'SCH_III_DIV_II', 'ICAI_GN_SCH_III_DIV_II', '2022 edition (reflects the 2021 amendments)',
   'fs_workbook_indas_div_ii'),
  ('SCHEDULE_III_DIVISION_III', 'III', 'Schedule III Division III — Ind AS NBFC',
   'As inserted by G.S.R. 1022(E), 11 October 2018', '2018-04-01', '2021-03-31',
   'MCA notification G.S.R. 1022(E) dated 11 October 2018',
   'SCH_III_DIV_III', 'ICAI_GN_SCH_III_DIV_III', 'Edition in force before the 2021 amendment',
   'fs_workbook_indas_div_iii'),
  ('SCHEDULE_III_DIVISION_III', 'III', 'Schedule III Division III — Ind AS NBFC',
   'As amended by G.S.R. 207(E), 24 March 2021', '2021-04-01', NULL,
   'MCA notification G.S.R. 207(E) dated 24 March 2021',
   'SCH_III_DIV_III', 'ICAI_GN_SCH_III_DIV_III', '2022 edition (reflects the 2021 amendments)',
   'fs_workbook_indas_div_iii')
) AS v(framework_id, division, title, version_label, eff, eff_to, notification,
       provision_code, guidance_code, guidance_version, template_key)
ON CONFLICT (framework_id, effective_from) DO NOTHING;

-- ── Disclosure library (spec §11, §12) ──────────────────────────────────────
-- 'base' rows apply from each Division's first version; '2021' rows from the
-- 2021 amendment (Additional Regulatory Information etc.). A requirement with a
-- trigger is activated by that fact; an unknown fact keeps it in the library.
INSERT INTO hsdg.schedule_iii_disclosure_requirement
  (framework_id, code, category, label, description, trigger_fact, provision_code,
   cross_link, sort_order, effective_from)
SELECT fw.framework_id,
       'SCH3_' || fw.division || '_' || r.suffix,
       r.category, r.label, r.description, r.trigger_fact,
       COALESCE(r.provision_code, fw.provision_code),
       r.cross_link, r.sort_order,
       CASE r.since WHEN '2021' THEN DATE '2021-04-01' ELSE fw.first_from END
FROM (VALUES
  ('SCHEDULE_III_DIVISION_I',   'I',   'SCH_III_DIV_I',   DATE '2014-04-01'),
  ('SCHEDULE_III_DIVISION_II',  'II',  'SCH_III_DIV_II',  DATE '2015-04-01'),
  ('SCHEDULE_III_DIVISION_III', 'III', 'SCH_III_DIV_III', DATE '2018-04-01')
) AS fw(framework_id, division, provision_code, first_from)
JOIN (VALUES
  -- suffix, divisions, since, category, label, description, trigger, provision, cross_link, sort
  ('BS_CLASSIFICATION', '{I,II,III}', 'base', 'balance_sheet',
   'Balance Sheet line items and current / non-current classification',
   'Classification and presentation of assets, liabilities and equity as the Division prescribes (Division III: order of liquidity).',
   NULL, NULL, NULL, 10),
  ('BS_SHARE_CAPITAL', '{I,II,III}', 'base', 'balance_sheet',
   'Share capital — classes, reconciliation of shares, shareholders holding more than 5%',
   NULL, NULL, NULL, NULL, 20),
  ('BS_CONTINGENT', '{I,II,III}', 'base', 'balance_sheet',
   'Contingent liabilities and commitments', NULL, NULL, NULL, NULL, 30),
  ('BS_RECEIVABLES_AGEING', '{I,II}', '2021', 'balance_sheet',
   'Trade receivables ageing schedule', NULL, NULL, NULL, NULL, 40),
  ('BS_PAYABLES_AGEING', '{I,II}', '2021', 'balance_sheet',
   'Trade payables ageing schedule (including MSME dues and disputed dues)', NULL, NULL, NULL, NULL, 50),
  ('BS_CWIP_AGEING', '{I,II,III}', '2021', 'balance_sheet',
   'Capital work-in-progress ageing and completion schedule', NULL, 'ppe_exists', NULL, NULL, 60),
  ('BS_INTANGIBLES_UD', '{I,II,III}', '2021', 'balance_sheet',
   'Intangible assets under development — ageing and completion schedule', NULL, 'intangibles_exist', NULL, NULL, 70),
  ('PL_LINE_ITEMS', '{I,II,III}', 'base', 'profit_and_loss',
   'Statement of Profit and Loss line items and classification of expenses by nature', NULL, NULL, NULL, NULL, 110),
  ('PL_OCI', '{II,III}', 'base', 'profit_and_loss',
   'Other Comprehensive Income — items that will and will not be reclassified to profit or loss', NULL, NULL, NULL, NULL, 120),
  ('PL_ADDITIONAL_INFO', '{I,II,III}', 'base', 'profit_and_loss',
   'Additional information — payments to the auditor and items of income / expenditure above the presentation threshold',
   NULL, NULL, NULL, NULL, 130),
  ('ARI_TITLE_DEEDS', '{I,II,III}', '2021', 'property_title_deeds',
   'Title deeds of immovable property not held in the name of the company', NULL, 'immovable_property_exists', NULL, NULL, 210),
  ('ARI_REVALUATION', '{I,II,III}', '2021', 'property_title_deeds',
   'Revaluation of property, plant and equipment / intangible assets — whether by a registered valuer', NULL, 'ppe_exists', NULL, NULL, 220),
  ('ARI_LOANS_RELATED', '{I,II,III}', '2021', 'loans_advances',
   'Loans or advances to promoters, directors, KMPs and related parties — repayable on demand or without terms', NULL, 'loans_given', NULL, NULL, 230),
  ('ARI_BENAMI', '{I,II,III}', '2021', 'benami_property',
   'Proceedings for holding benami property', NULL, NULL, NULL, NULL, 240),
  ('ARI_CURRENT_ASSET_BORROWINGS', '{I,II,III}', '2021', 'borrowings_charges',
   'Borrowings secured by current assets — quarterly returns / statements agreed with the books', NULL, 'borrowings_exist', NULL, NULL, 250),
  ('ARI_WILFUL_DEFAULTER', '{I,II,III}', '2021', 'borrowings_charges',
   'Wilful defaulter declaration by any bank, financial institution or lender', NULL, 'borrowings_exist', NULL, NULL, 260),
  ('ARI_CHARGES', '{I,II,III}', '2021', 'borrowings_charges',
   'Registration or satisfaction of charges with the Registrar beyond the statutory period', NULL, 'borrowings_exist', NULL, NULL, 270),
  ('ARI_STRUCK_OFF', '{I,II,III}', '2021', 'struck_off_companies',
   'Relationship with struck-off companies', NULL, NULL, NULL, NULL, 280),
  ('ARI_LAYERS', '{I,II,III}', '2021', 'additional_regulatory_information',
   'Compliance with the number of layers of companies', NULL, 'investments_exist', NULL, NULL, 290),
  ('ARI_SCHEMES', '{I,II,III}', '2021', 'additional_regulatory_information',
   'Compliance with approved scheme(s) of arrangements', NULL, NULL, NULL, NULL, 300),
  ('ARI_FUNDS_UTILISATION', '{I,II,III}', '2021', 'additional_regulatory_information',
   'Utilisation of borrowed funds and share premium — intermediaries and ultimate beneficiaries', NULL, NULL, NULL, NULL, 310),
  ('ARI_UNDISCLOSED_INCOME', '{I,II,III}', '2021', 'undisclosed_income',
   'Undisclosed income surrendered or disclosed in tax assessments', NULL, NULL, NULL, NULL, 320),
  ('ARI_CRYPTO', '{I,II,III}', '2021', 'crypto_virtual_currency',
   'Crypto currency or virtual currency — profit / loss, amount held, deposits or advances', NULL, NULL, NULL, NULL, 330),
  ('ARI_RATIOS', '{I,II}', '2021', 'ratios',
   'Prescribed ratios with explanation of any change of more than 25%', NULL, NULL, NULL, NULL, 340),
  ('ARI_RATIOS_NBFC', '{III}', '2021', 'ratios',
   'Prescribed NBFC ratios — CRAR, Tier I CRAR, Tier II CRAR and Liquidity Coverage Ratio', NULL, NULL, NULL, NULL, 345),
  ('ARI_CSR', '{I,II,III}', '2021', 'csr',
   'Corporate Social Responsibility — amount required, spent, shortfall and reasons', NULL, 'csr_applicable', 'COS_ACT_135', '02.7', 350),
  ('ARI_PROMOTERS', '{I,II,III}', '2021', 'promoter_shareholding',
   'Shareholding of promoters and changes during the year', NULL, NULL, NULL, NULL, 360),
  ('CFS_ADDITIONAL_INFO', '{I,II,III}', 'base', 'consolidated',
   'Consolidated financial statements — share of each group entity in net assets and profit or loss', NULL, 'cfs_required', 'COS_ACT_129_3', '02.6', 410),
  ('INDAS_101_RECONCILIATION', '{II,III}', 'base', 'transition',
   'First-time adoption — Ind AS 101 equity and comprehensive income reconciliations', NULL, 'first_time_ind_as', 'INDAS_101', '02.2', 420),
  ('ACCOUNTING_POLICIES', '{I,II,III}', 'base', 'other',
   'Significant / material accounting policy information', NULL, NULL, NULL, NULL, 510),
  ('RELATED_PARTIES', '{I,II,III}', 'base', 'other',
   'Related party disclosures', NULL, NULL, NULL, NULL, 520),
  ('NBFC_REGULATORY', '{III}', 'base', 'other',
   'NBFC regulatory disclosures required by the Reserve Bank of India in the notes', NULL, NULL, NULL, NULL, 530)
) AS r(suffix, divisions, since, category, label, description, trigger_fact, provision_code, cross_link, sort_order)
  ON fw.division = ANY (r.divisions::text[])
ON CONFLICT (framework_id, code, effective_from) DO NOTHING;

-- ── Specialised statutory formats (spec §7) and their governing provisions ──
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, source_reference,
   reference_kind, summary, version_no)
VALUES
  ('BANKING_REG_ACT_29', 'RBI', 'Accounts and balance sheet of banking companies',
   'Section 29 and Third Schedule', '1949-03-16', NULL,
   'Banking Regulation Act, 1949, s.29 and the Third Schedule (Forms A and B)', 'provision',
   'A banking company prepares its balance sheet and profit and loss account in Forms A and B of the Third Schedule, as the Reserve Bank directs; Section 129(1) of the Companies Act does not require Schedule III for it.',
   1),
  ('IRDAI_FS_REGS', 'IRDAI', 'Financial statements of insurers',
   'IRDA Financial Statements Regulations, 2002', '2002-04-01', '2024-03-31',
   'IRDA (Preparation of Financial Statements and Auditor''s Report of Insurance Companies) Regulations, 2002',
   'provision',
   'Insurers prepare the revenue account, profit and loss account and balance sheet in the forms the Regulations prescribe, in place of Schedule III.',
   1),
  ('IRDAI_FS_REGS', 'IRDAI', 'Financial statements of insurers',
   'IRDAI AFI Regulations, 2024', '2024-04-01', NULL,
   'IRDAI (Actuarial, Finance and Investment Functions of Insurers) Regulations, 2024 and the related master circular',
   'provision',
   'From 1 April 2024 insurers prepare financial statements in the formats prescribed under the 2024 Regulations and the IRDAI master circular, in place of Schedule III.',
   2)
ON CONFLICT DO NOTHING;

INSERT INTO hsdg.schedule_iii_specialised_format_rule
  (code, entity_category, governing_authority, framework_name, effect, provision_code,
   effective_from, effective_to)
VALUES
  ('SPEC_FMT_BANK', 'bank', 'Reserve Bank of India — Banking Regulation Act, 1949',
   'Third Schedule to the Banking Regulation Act, 1949 (Forms A and B)', 'replaces',
   'BANKING_REG_ACT_29', '2014-04-01', NULL),
  ('SPEC_FMT_INSURANCE', 'insurance', 'Insurance Regulatory and Development Authority of India',
   'IRDA (Preparation of Financial Statements and Auditor''s Report of Insurance Companies) Regulations, 2002',
   'replaces', 'IRDAI_FS_REGS', '2014-04-01', '2024-03-31'),
  ('SPEC_FMT_INSURANCE', 'insurance', 'Insurance Regulatory and Development Authority of India',
   'IRDAI (Actuarial, Finance and Investment Functions of Insurers) Regulations, 2024',
   'replaces', 'IRDAI_FS_REGS', '2024-04-01', NULL)
ON CONFLICT (code, effective_from) DO NOTHING;

-- ── Rounding units + presentation materiality into the Rules Library ───────
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

-- The permitted units and the measured amount become rule data. v1 (2014):
-- the band is tested on turnover and rounding is permissive ("may"). v2 (the
-- G.S.R. 207(E) amendment, periods from 1 April 2021): the band is tested on
-- TOTAL INCOME and rounding is mandatory ("shall"). Append-only: v1 keeps
-- resolving for FY 2020-21 and earlier.
UPDATE hsdg.audit_rule_version rv
   SET condition = '{"measure":"turnover","measureLabel":"Turnover","mandatory":false,"belowUnits":["hundreds","thousands","lakhs","millions"],"atOrAboveUnits":["lakhs","millions","crores"],"suggestedBelow":"lakhs","suggestedAtOrAbove":"crores","decimalsPermitted":true}'::jsonb
  FROM hsdg.audit_rule r
 WHERE rv.audit_rule_id = r.id AND r.code = 'SCH_III_ROUNDING' AND rv.version = 1
   AND rv.condition IS NULL;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, condition, outcome, notes)
SELECT r.id, 2, DATE '2021-04-01', NULL, 1000000000::numeric,
       '{"measure":"total_income","measureLabel":"Total income","mandatory":true,"belowUnits":["hundreds","thousands","lakhs","millions"],"atOrAboveUnits":["lakhs","millions","crores"],"suggestedBelow":"lakhs","suggestedAtOrAbove":"crores","decimalsPermitted":true}'::jsonb,
       'higher_band',
       'G.S.R. 207(E), 24 March 2021: rounding band measured on total income; rounding mandatory.'
  FROM hsdg.audit_rule r
 WHERE r.code = 'SCH_III_ROUNDING'
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- "Any item of income or expenditure exceeding 1% of revenue from operations
-- (Division III: total income) or ₹X, whichever is higher" — the Division
-- presentation thresholds (General Instructions, Statement of Profit and Loss).
INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('SCH_III_PRES_MAT_DIV_I',   'schedule_iii', 'division_i',   'presentation_materiality', '>=', 'inr', 'standalone_audited_fs'),
  ('SCH_III_PRES_MAT_DIV_II',  'schedule_iii', 'division_ii',  'presentation_materiality', '>=', 'inr', 'standalone_audited_fs'),
  ('SCH_III_PRES_MAT_DIV_III', 'schedule_iii', 'division_iii', 'presentation_materiality', '>=', 'inr', 'standalone_audited_fs')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, condition, outcome,
   authority_provision_id, notes)
SELECT r.id, 1, v.eff::date, NULL, v.floor, v.cond::jsonb, 'separate_disclosure',
       (SELECT p.id FROM hsdg.authority_provision p
         WHERE p.code = v.prov AND p.effective_to IS NULL LIMIT 1),
       'Seeded with the 02.3 presentation library.'
FROM (VALUES
  ('SCH_III_PRES_MAT_DIV_I',   '2014-04-01', 100000::numeric,
   '{"percentOfMeasure":1,"measure":"revenue_from_operations","measureLabel":"Revenue from operations","whicheverHigher":true}',
   'SCH_III_DIV_I'),
  ('SCH_III_PRES_MAT_DIV_II',  '2015-04-01', 1000000::numeric,
   '{"percentOfMeasure":1,"measure":"revenue_from_operations","measureLabel":"Revenue from operations","whicheverHigher":true}',
   'SCH_III_DIV_II'),
  ('SCH_III_PRES_MAT_DIV_III', '2018-04-01', 1000000::numeric,
   '{"percentOfMeasure":1,"measure":"total_income","measureLabel":"Total income","whicheverHigher":true}',
   'SCH_III_DIV_III')
) AS v(code, eff, floor, cond, prov)
JOIN hsdg.audit_rule r ON r.code = v.code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.schedule_iii_framework_version       FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.schedule_iii_disclosure_requirement  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.schedule_iii_specialised_format_rule FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.audit_rule
 WHERE code IN ('SCH_III_PRES_MAT_DIV_I','SCH_III_PRES_MAT_DIV_II','SCH_III_PRES_MAT_DIV_III');
DELETE FROM hsdg.audit_rule_version rv
 USING hsdg.audit_rule r
 WHERE rv.audit_rule_id = r.id AND r.code = 'SCH_III_ROUNDING' AND rv.version = 2;
UPDATE hsdg.audit_rule_version rv SET condition = NULL
  FROM hsdg.audit_rule r
 WHERE rv.audit_rule_id = r.id AND r.code = 'SCH_III_ROUNDING' AND rv.version = 1;
DELETE FROM hsdg.authority_provision WHERE code IN ('BANKING_REG_ACT_29','IRDAI_FS_REGS');

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS hsdg.schedule_iii_specialised_format_rule;
DROP TABLE IF EXISTS hsdg.schedule_iii_disclosure_requirement;
DROP TABLE IF EXISTS hsdg.schedule_iii_framework_version;
