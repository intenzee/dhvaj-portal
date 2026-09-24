-- ─────────────────────────────────────────────────────────────────────────
-- 0067 · Statutory Audit — 03.5 Audit Areas & Assertions
--   (DHVAJ 03.5 spec — FROZEN; docs/section-03-planning-build-spec.md §5.5)
--
-- 03.5 is the completeness step for the audit universe. On first entry the
-- engagement receives EVERY active area of the applicable DHVAJ Audit Area
-- Library, all Retained; the Manager removes what is not required, adds what
-- is missing and reviews the suggested assertions. No RMM, no procedures, no
-- TB mapping.
--
-- METHODOLOGY (firm-wide, versioned — never hard-coded in page logic, §7):
--   • audit_area_library_release — one row per released library version.
--   • audit_area_library         — §6 master data per version (default
--     assertions, signal mapping tags, 03.2 metric mapping, indicators,
--     assertion-attention suggestion rules, authorities, aliases).
--   • audit_assertion            — §15 canonical SA 315 assertion master.
--   Same security as authority_provision / audit_rule*: everyone with a role
--   reads, only firm-wide admins write; FORCE RLS applied AFTER the seed.
--
-- ENGAGEMENT (members SELECT, leads write; ENABLE not FORCE):
--   • audit_area_review          — one row per audit file: status, section
--     version, library version/profile used, completion basis (impact rules).
--   • audit_engagement_area      — §8 engagement area (library snapshot or
--     custom); removal never deletes.
--   • audit_area_assertion       — §16/§17 assertions per area.
--   • audit_area_signal_link     — §18 area ↔ Planning Signal (many-to-many).
--   • audit_area_specific_link   — VAL-04 area ↔ 03.3 specific materiality.
--   • audit_area_signal_resolution — VAL-05 "no Audit Area mapping required".
--   • audit_area_matrix_version  — §22/§23 immutable matrix snapshot per
--     completion (insert-only).
--   • audit_area_review_comment  — §27 Partner challenge / comment / request.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Methodology: canonical assertion master (§15) ─────────────────────────
CREATE TABLE hsdg.audit_assertion (
  id               text PRIMARY KEY CHECK (id ~ '^[A-Z_]{4,20}$'),
  assertion_group  text NOT NULL CHECK (assertion_group IN ('transactions','balances','presentation')),
  label            text NOT NULL,
  sort_order       integer NOT NULL,
  active           boolean NOT NULL DEFAULT true
);

-- ── Methodology: Audit Area Library (§6) ──────────────────────────────────
CREATE TABLE hsdg.audit_area_library_release (
  library_version  text PRIMARY KEY CHECK (library_version ~ '^[a-z0-9_.-]{3,60}$'),
  industry_profile text NOT NULL DEFAULT 'general_corporate',
  released_at      timestamptz NOT NULL DEFAULT now(),
  note             text
);

CREATE TABLE hsdg.audit_area_library (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_version            text NOT NULL REFERENCES hsdg.audit_area_library_release (library_version),
  area_code                  text NOT NULL CHECK (area_code ~ '^[A-Z0-9_]{2,20}$'),
  area_name                  text NOT NULL CHECK (length(trim(area_name)) > 0),
  area_type                  text NOT NULL CHECK (area_type IN
                               ('balance_sheet','profit_loss','disclosure','cross_cutting')),
  category                   text NOT NULL CHECK (category IN
                               ('assets','liabilities_equity','income_expenses','disclosure_cross_cutting')),
  framework_profile          text NOT NULL DEFAULT 'both' CHECK (framework_profile IN ('both','as','ind_as')),
  industry_profile           text NOT NULL DEFAULT 'general_corporate',
  -- Library selection (§4): NULL = always; otherwise only when the fact holds.
  condition_key              text CHECK (condition_key IS NULL OR condition_key IN
                               ('cfs_applicable','initial_audit')),
  default_assertions         text[] NOT NULL DEFAULT '{}',
  non_assertion_workstream   boolean NOT NULL DEFAULT false,
  default_attention          text NOT NULL DEFAULT 'standard' CHECK (default_attention IN ('standard','enhanced')),
  related_authorities        text[] NOT NULL DEFAULT '{}',
  signal_mapping_tags        text[] NOT NULL DEFAULT '{}',
  -- 03.2 canonical metric ids giving a DIRECT financial mapping (§13).
  metric_keys                text[] NOT NULL DEFAULT '{}',
  -- Compact indicators (§5): caro / statutory / cfs.
  indicator_tags             text[] NOT NULL DEFAULT '{}',
  -- §17 suggestion mappings: [{ "tags": [...], "assertions": [...], "scenario": "..." }]
  assertion_attention_rules  jsonb NOT NULL DEFAULT '[]',
  aliases                    text[] NOT NULL DEFAULT '{}',
  effective_from             date NOT NULL DEFAULT '2020-04-01',
  effective_to               date,
  active                     boolean NOT NULL DEFAULT true,
  sort_order                 integer NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (library_version, area_code),
  CONSTRAINT audit_area_library_assertions CHECK (
    non_assertion_workstream OR cardinality(default_assertions) > 0
  )
);
CREATE INDEX audit_area_library_version_idx ON hsdg.audit_area_library (library_version);

REVOKE DELETE ON hsdg.audit_assertion FROM hsdg_app;
REVOKE DELETE ON hsdg.audit_area_library FROM hsdg_app;
REVOKE DELETE ON hsdg.audit_area_library_release FROM hsdg_app;
ALTER TABLE hsdg.audit_assertion ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library_release ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_assertion_read ON hsdg.audit_assertion
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_assertion_write ON hsdg.audit_assertion
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY audit_area_library_read ON hsdg.audit_area_library
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_area_library_write ON hsdg.audit_area_library
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY audit_area_library_release_read ON hsdg.audit_area_library_release
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_area_library_release_write ON hsdg.audit_area_library_release
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- ── Seed: assertion master (§15 — canonical IDs, exactly) ──────────────────
INSERT INTO hsdg.audit_assertion (id, assertion_group, label, sort_order) VALUES
  ('TX_OCC',       'transactions', 'Occurrence',                          1),
  ('TX_COMP',      'transactions', 'Completeness',                        2),
  ('TX_ACC',       'transactions', 'Accuracy',                            3),
  ('TX_CUTOFF',    'transactions', 'Cut-off',                             4),
  ('TX_CLASS',     'transactions', 'Classification',                      5),
  ('BAL_EXIST',    'balances',     'Existence',                           6),
  ('BAL_RO',       'balances',     'Rights & Obligations',                7),
  ('BAL_COMP',     'balances',     'Completeness',                        8),
  ('BAL_VAL',      'balances',     'Valuation & Allocation',              9),
  ('PD_OCC_RO',    'presentation', 'Occurrence & Rights and Obligations', 10),
  ('PD_COMP',      'presentation', 'Completeness',                        11),
  ('PD_CLASS_UND', 'presentation', 'Classification & Understandability',  12),
  ('PD_ACC_VAL',   'presentation', 'Accuracy & Valuation',                13);

-- ── Seed: General Corporate library v2026.1 (§7 baseline list) ─────────────
-- Default assertions, tags and suggestion rules are DHVAJ methodology data —
-- revised by releasing a new library version, never by code.
INSERT INTO hsdg.audit_area_library_release (library_version, note)
VALUES ('dhvaj-gc-2026.1', 'Initial General Corporate Audit Area Library (03.5 §7 baseline).');

INSERT INTO hsdg.audit_area_library
  (library_version, sort_order, area_code, area_name, area_type, category, condition_key,
   default_assertions, metric_keys, signal_mapping_tags, indicator_tags, related_authorities,
   aliases, assertion_attention_rules)
SELECT 'dhvaj-gc-2026.1', v.ord, v.code, v.name, v.atype, v.cat, v.cond,
       v.asr, v.metrics, v.tags, v.ind, v.auth, v.aliases, v.rules::jsonb
FROM (VALUES
  -- Assets
  (1,'CASH','Cash & Bank','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL'],ARRAY['cash_bank'],ARRAY['cash_bank','bank','cash'],
     ARRAY[]::text[],ARRAY['SA_505','AS_3','INDAS_7'],ARRAY['bank balances','cash equivalents','fixed deposits'],'[]'),
  (2,'AR','Trade Receivables','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL'],ARRAY['trade_receivables'],ARRAY['receivable','debtor','collection','ageing','aging'],
     ARRAY[]::text[],ARRAY['SA_505','INDAS_109','INDAS_115','AS_9'],ARRAY['debtors','sundry debtors','accounts receivable'],
     '[{"scenario":"Receivables aging / collection concern","tags":["receivable","debtor","ageing","aging","collection"],"assertions":["BAL_VAL"]}]'),
  (3,'INV','Inventory','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL'],ARRAY['inventory'],ARRAY['inventory','stock','warehouse','obsolete'],
     ARRAY['caro'],ARRAY['SA_501','AS_2','INDAS_2','CARO_2020'],ARRAY['stock','stock-in-trade','raw materials','finished goods','work in progress'],
     '[{"scenario":"Inventory at multiple locations","tags":["warehouse","location","multiple_warehouses"],"assertions":["BAL_EXIST"]},{"scenario":"Inventory obsolescence","tags":["obsolete","slow-moving","slow moving","ageing"],"assertions":["BAL_VAL"]}]'),
  (4,'PPE','Property, Plant & Equipment','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL'],ARRAY['ppe'],ARRAY['ppe','fixed asset','capex','property'],
     ARRAY['caro'],ARRAY['AS_10','INDAS_16','CARO_2020','SCH_III_DIV_I'],ARRAY['fixed assets','tangible assets','plant and machinery'],'[]'),
  (5,'CWIP','Capital Work-in-Progress','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['cwip','capital work','capex','project'],
     ARRAY['statutory'],ARRAY['AS_10','INDAS_16','SCH_III_DIV_I'],ARRAY['cwip','capital work in progress','assets under construction'],'[]'),
  (6,'INTANG','Intangible Assets','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_VAL'],ARRAY[]::text[],ARRAY['intangible','software','capitalis'],
     ARRAY[]::text[],ARRAY['AS_26','INDAS_38'],ARRAY['software','intangibles under development','licences'],'[]'),
  (7,'GW','Goodwill','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_VAL'],ARRAY[]::text[],ARRAY['goodwill','acquisition','impairment'],
     ARRAY[]::text[],ARRAY['INDAS_103','INDAS_36','AS_26'],ARRAY['business combination'],'[]'),
  (8,'INVEST','Investments','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL'],ARRAY['investments'],ARRAY['investment','subsidiar','unlisted','mutual fund'],
     ARRAY['caro'],ARRAY['AS_13','INDAS_109','CARO_2020'],ARRAY['equity instruments','mutual funds','bonds'],'[]'),
  (9,'LOANS','Loans & Advances','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_VAL'],ARRAY[]::text[],ARRAY['loan given','advance','inter-corporate','icd'],
     ARRAY['caro','statutory'],ARRAY['CARO_2020','INDAS_109'],ARRAY['loans given','advances','inter corporate deposits'],'[]'),
  (10,'OFA','Other Financial Assets','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_VAL'],ARRAY[]::text[],ARRAY['deposit','financial asset'],
     ARRAY[]::text[],ARRAY['INDAS_109'],ARRAY['security deposits','interest accrued'],'[]'),
  (11,'OA','Other Assets','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_VAL'],ARRAY[]::text[],ARRAY['prepaid','other asset'],
     ARRAY[]::text[],ARRAY['SCH_III_DIV_I'],ARRAY['prepaid expenses','balances with government authorities','gst input'],'[]'),
  (12,'CTA','Current Tax Assets','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_VAL'],ARRAY[]::text[],ARRAY['income tax','advance tax','tds'],
     ARRAY[]::text[],ARRAY['AS_22','INDAS_12'],ARRAY['advance tax','tds receivable','income tax refund'],'[]'),
  (13,'DTA','Deferred Tax Assets','balance_sheet','assets',NULL,
     ARRAY['BAL_EXIST','BAL_VAL'],ARRAY[]::text[],ARRAY['deferred tax','tax loss'],
     ARRAY[]::text[],ARRAY['AS_22','INDAS_12'],ARRAY['dta','mat credit'],'[]'),
  -- Liabilities & Equity
  (14,'SHARECAP','Share Capital','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','PD_CLASS_UND'],ARRAY[]::text[],ARRAY['share capital','allotment','equity shares'],
     ARRAY['caro','statutory'],ARRAY['CARO_2020','SCH_III_DIV_I'],ARRAY['equity share capital','preference shares'],'[]'),
  (15,'EQUITY','Other Equity / Reserves','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_COMP','BAL_VAL','PD_CLASS_UND'],ARRAY['net_worth'],ARRAY['reserve','net_worth','dividend'],
     ARRAY['statutory'],ARRAY['SCH_III_DIV_I','SCH_III_DIV_II'],ARRAY['reserves and surplus','retained earnings','other equity'],'[]'),
  (16,'BORR','Borrowings','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL'],ARRAY['total_borrowings'],ARRAY['borrowing','loan','debt','covenant','finance_cost'],
     ARRAY['caro'],ARRAY['SA_505','INDAS_109','AS_16','CARO_2020'],ARRAY['loans','term loans','working capital loans','debentures'],
     '[{"scenario":"New/complex borrowing","tags":["borrowing","loan","covenant","debenture","finance_cost"],"assertions":["BAL_COMP","PD_CLASS_UND"]},{"scenario":"Unrecorded liability concern","tags":["unrecorded"],"assertions":["BAL_COMP"]}]'),
  (17,'AP','Trade Payables','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_RO','BAL_COMP','BAL_VAL'],ARRAY['trade_payables'],ARRAY['payable','creditor','msme','unrecorded'],
     ARRAY['statutory'],ARRAY['SA_505','SCH_III_DIV_I'],ARRAY['creditors','sundry creditors','accounts payable','msme dues'],
     '[{"scenario":"Unrecorded liability concern","tags":["unrecorded","payable","creditor","accrual"],"assertions":["BAL_COMP"]}]'),
  (18,'LEASELIAB','Lease Liabilities','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['lease'],
     ARRAY[]::text[],ARRAY['INDAS_116','AS_19'],ARRAY['right of use','rou'],'[]'),
  (19,'EMPOBL','Employee Benefit Obligations','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['gratuity','leave encashment','actuarial','employee benefit'],
     ARRAY[]::text[],ARRAY['AS_15','INDAS_19','SA_620'],ARRAY['gratuity','compensated absences','provision for employee benefits'],'[]'),
  (20,'PROV','Provisions','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['provision','warranty','onerous'],
     ARRAY[]::text[],ARRAY['AS_29','INDAS_37'],ARRAY['warranty provision','provision for expenses'],
     '[{"scenario":"Unrecorded liability concern","tags":["unrecorded","litigation","claim"],"assertions":["BAL_COMP"]}]'),
  (21,'CTL','Current Tax Liabilities','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['income tax','tax demand','statutory dues'],
     ARRAY['caro'],ARRAY['AS_22','INDAS_12','CARO_2020'],ARRAY['provision for tax','income tax payable'],'[]'),
  (22,'DTL','Deferred Tax Liabilities','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['deferred tax'],
     ARRAY[]::text[],ARRAY['AS_22','INDAS_12'],ARRAY['dtl'],'[]'),
  (23,'OFL','Other Financial Liabilities','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['deposit received','financial liabilit','capital creditor'],
     ARRAY[]::text[],ARRAY['INDAS_109'],ARRAY['capital creditors','security deposits received','interest accrued'],'[]'),
  (24,'OL','Other Liabilities','balance_sheet','liabilities_equity',NULL,
     ARRAY['BAL_EXIST','BAL_COMP','BAL_VAL'],ARRAY[]::text[],ARRAY['statutory dues','advance from customer','gst payable'],
     ARRAY['caro'],ARRAY['CARO_2020','SCH_III_DIV_I'],ARRAY['statutory dues payable','advances from customers','contract liabilities'],'[]'),
  -- Income & Expenses
  (25,'REV','Revenue','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_COMP','TX_ACC','TX_CUTOFF','TX_CLASS'],ARRAY['revenue'],ARRAY['revenue','sales','turnover','customer'],
     ARRAY[]::text[],ARRAY['SA_240','AS_9','INDAS_115'],ARRAY['sales','turnover','revenue from operations','income from operations'],
     '[{"scenario":"Revenue spike / unusual year-end pattern","tags":["movement_revenue","rel_revenue","spike","year-end","year end","cut-off","cut off"],"assertions":["TX_OCC","TX_CUTOFF"]}]'),
  (26,'OI','Other Income','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_COMP','TX_ACC','TX_CLASS'],ARRAY['other_income'],ARRAY['other_income','interest income','dividend income'],
     ARRAY[]::text[],ARRAY['AS_9','INDAS_115'],ARRAY['interest income','dividend income','miscellaneous income'],'[]'),
  (27,'PURCH','Purchases / Cost of Materials','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_COMP','TX_ACC','TX_CUTOFF','TX_CLASS'],ARRAY['purchases','cost_of_sales'],ARRAY['purchase','cost_of_sales','material','procurement','vendor'],
     ARRAY[]::text[],ARRAY['AS_2','INDAS_2'],ARRAY['cost of materials consumed','purchases of stock-in-trade','cost of goods sold'],'[]'),
  (28,'CHGINV','Changes in Inventory','profit_loss','income_expenses',NULL,
     ARRAY['TX_ACC','TX_CUTOFF','TX_CLASS'],ARRAY[]::text[],ARRAY['changes in inventor'],
     ARRAY[]::text[],ARRAY['AS_2','INDAS_2','SCH_III_DIV_I'],ARRAY['changes in inventories of finished goods'],'[]'),
  (29,'EMPEXP','Employee Benefits Expense','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_COMP','TX_ACC','TX_CLASS'],ARRAY['employee_cost'],ARRAY['employee_cost','payroll','salary','wages','headcount'],
     ARRAY[]::text[],ARRAY['AS_15','INDAS_19'],ARRAY['salaries and wages','payroll','staff costs'],'[]'),
  (30,'FINCOST','Finance Costs','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_COMP','TX_ACC','TX_CUTOFF'],ARRAY['finance_cost'],ARRAY['finance_cost','interest expense'],
     ARRAY[]::text[],ARRAY['AS_16','INDAS_23','INDAS_109'],ARRAY['interest expense','borrowing costs'],'[]'),
  (31,'DEPR','Depreciation & Amortisation','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_ACC','TX_CLASS'],ARRAY[]::text[],ARRAY['depreciation','amortisation','useful life'],
     ARRAY['statutory'],ARRAY['AS_10','INDAS_16','INDAS_38'],ARRAY['depreciation','amortization'],'[]'),
  (32,'OTHEXP','Other Expenses','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_COMP','TX_ACC','TX_CUTOFF','TX_CLASS'],ARRAY[]::text[],ARRAY['other expense','expenditure','csr'],
     ARRAY['statutory'],ARRAY['SCH_III_DIV_I','COS_ACT_135'],ARRAY['administrative expenses','selling expenses','csr expenditure','auditor remuneration'],'[]'),
  (33,'EXCEPT','Exceptional / Unusual Items','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_ACC','TX_CLASS','PD_CLASS_UND'],ARRAY[]::text[],ARRAY['exceptional','unusual','one-off','one off'],
     ARRAY['statutory'],ARRAY['SCH_III_DIV_I','SCH_III_DIV_II'],ARRAY['exceptional items','extraordinary items'],'[]'),
  (34,'TAXEXP','Tax Expense','profit_loss','income_expenses',NULL,
     ARRAY['TX_OCC','TX_COMP','TX_ACC'],ARRAY[]::text[],ARRAY['tax expense','effective tax'],
     ARRAY[]::text[],ARRAY['AS_22','INDAS_12'],ARRAY['income tax expense','current tax','deferred tax charge'],'[]'),
  -- Disclosure / Cross-cutting
  (35,'RPT','Related Parties','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['TX_OCC','TX_COMP','PD_OCC_RO','PD_COMP'],ARRAY['related_party'],ARRAY['related_party','related party','promoter','group company'],
     ARRAY['statutory'],ARRAY['SA_550','AS_18','INDAS_24','COS_ACT_188'],ARRAY['rpt','related party transactions','kmp'],
     '[{"scenario":"Related-party completeness concern","tags":["related_party","related party","promoter"],"assertions":["TX_COMP","PD_COMP"]}]'),
  (36,'PROVCONT','Provisions & Contingencies','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['BAL_COMP','BAL_VAL','PD_COMP'],ARRAY[]::text[],ARRAY['litigation','contingen','claim','dispute'],
     ARRAY[]::text[],ARRAY['AS_29','INDAS_37'],ARRAY['contingent liabilities','litigation','claims'],'[]'),
  (37,'COMMIT','Commitments','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['PD_COMP','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['commitment','capital commitment'],
     ARRAY['statutory'],ARRAY['SCH_III_DIV_I'],ARRAY['capital commitments','other commitments'],'[]'),
  (38,'GC','Going Concern','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['PD_COMP','PD_CLASS_UND'],ARRAY[]::text[],ARRAY['going concern','negative_net_worth','liquidity','losses','net worth'],
     ARRAY[]::text[],ARRAY['SA_570'],ARRAY['material uncertainty'],'[]'),
  (39,'SUBSEQ','Subsequent Events','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['TX_CUTOFF','BAL_COMP','PD_COMP'],ARRAY[]::text[],ARRAY['subsequent event','post balance sheet'],
     ARRAY[]::text[],ARRAY['SA_560','AS_4','INDAS_10'],ARRAY['events after the reporting period','post balance sheet events'],'[]'),
  (40,'EST','Accounting Estimates','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['BAL_VAL','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['estimate','judgement','judgment','impairment'],
     ARRAY[]::text[],ARRAY['SA_540'],ARRAY['estimates','significant judgements'],'[]'),
  (41,'FININST','Financial Instruments','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['BAL_EXIST','BAL_VAL','PD_CLASS_UND','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['financial instrument','derivative','hedg','ecl'],
     ARRAY[]::text[],ARRAY['INDAS_109','INDAS_107'],ARRAY['derivatives','expected credit loss','hedging'],'[]'),
  (42,'FV','Fair Value','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['BAL_VAL','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['fair value','valuation','unlisted'],
     ARRAY[]::text[],ARRAY['INDAS_113','SA_540','SA_620'],ARRAY['fair value measurement','valuation'],'[]'),
  (43,'LEASES','Leases','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['BAL_COMP','BAL_VAL','PD_COMP'],ARRAY[]::text[],ARRAY['lease','rent'],
     ARRAY[]::text[],ARRAY['AS_19','INDAS_116'],ARRAY['right-of-use assets','operating leases','rent'],'[]'),
  (44,'FX','Foreign Currency','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['TX_ACC','BAL_VAL','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['foreign currency','forex','export','import','fema'],
     ARRAY[]::text[],ARRAY['AS_11','INDAS_21'],ARRAY['forex','exchange differences','foreign exchange'],'[]'),
  (45,'GRANTS','Government Grants','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['TX_OCC','BAL_RO','PD_COMP'],ARRAY[]::text[],ARRAY['grant','subsidy','incentive'],
     ARRAY[]::text[],ARRAY['AS_12','INDAS_20'],ARRAY['subsidies','government assistance','incentives'],'[]'),
  (46,'EPS','Earnings Per Share','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['PD_ACC_VAL','PD_COMP'],ARRAY[]::text[],ARRAY['earnings per share','eps'],
     ARRAY['statutory'],ARRAY['AS_20','INDAS_33'],ARRAY['eps','basic and diluted eps'],'[]'),
  (47,'CFSTMT','Cash Flow Statement','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['PD_CLASS_UND','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['cash flow','rel_profit_cash'],
     ARRAY['statutory'],ARRAY['AS_3','INDAS_7'],ARRAY['cash flow statement','statement of cash flows'],'[]'),
  (48,'SOCE','Statement of Changes in Equity','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['PD_COMP','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['changes in equity'],
     ARRAY['statutory'],ARRAY['SCH_III_DIV_II'],ARRAY['soce','statement of changes in equity'],'[]'),
  (49,'CONSOL','Consolidation','cross_cutting','disclosure_cross_cutting','cfs_applicable',
     ARRAY['BAL_COMP','BAL_VAL','PD_COMP','PD_CLASS_UND'],ARRAY[]::text[],ARRAY['cfs_required','consolidation','subsidiar','component','group'],
     ARRAY['cfs','statutory'],ARRAY['SA_600','COS_ACT_129_3','AS_21','INDAS_110'],ARRAY['cfs','consolidated financial statements','group accounts'],'[]'),
  (50,'PRESDISC','Presentation & Disclosures','disclosure','disclosure_cross_cutting',NULL,
     ARRAY['PD_OCC_RO','PD_COMP','PD_CLASS_UND','PD_ACC_VAL'],ARRAY[]::text[],ARRAY['disclosure','schedule iii','presentation'],
     ARRAY['statutory'],ARRAY['SCH_III_DIV_I','SCH_III_DIV_II'],ARRAY['schedule iii','notes to accounts','financial statement presentation'],'[]'),
  (51,'OB','Opening Balances','cross_cutting','disclosure_cross_cutting','initial_audit',
     ARRAY['BAL_EXIST','BAL_RO','BAL_VAL','PD_CLASS_UND'],ARRAY[]::text[],ARRAY['initial_audit','opening balance','predecessor'],
     ARRAY[]::text[],ARRAY['SA_510'],ARRAY['initial audit','predecessor auditor','opening balances'],'[]'),
  (52,'JE','Journal Entries','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['TX_OCC','TX_ACC'],ARRAY[]::text[],ARRAY['journal','erp','manual entr','override'],
     ARRAY['statutory'],ARRAY['SA_240','AUDIT_RULE_11G'],ARRAY['manual journals','management override','audit trail'],'[]'),
  (53,'LAWS','Laws & Regulations','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['BAL_COMP','PD_COMP'],ARRAY[]::text[],ARRAY['regulat','compliance','non-compliance','penalt','litigation'],
     ARRAY['statutory'],ARRAY['SA_250'],ARRAY['compliance','non-compliance','regulatory'],'[]'),
  (54,'FRAUD','Fraud Considerations','cross_cutting','disclosure_cross_cutting',NULL,
     ARRAY['TX_OCC','BAL_EXIST'],ARRAY[]::text[],ARRAY['fraud','misappropriation','whistle','override'],
     ARRAY['statutory'],ARRAY['SA_240','COS_ACT_143_12'],ARRAY['fraud risk','management override','misappropriation'],'[]')
) AS v(ord, code, name, atype, cat, cond, asr, metrics, tags, ind, auth, aliases, rules);

-- Every default assertion id must exist in the master (arrays can't carry FKs).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM hsdg.audit_area_library l, unnest(l.default_assertions) a
     WHERE NOT EXISTS (SELECT 1 FROM hsdg.audit_assertion x WHERE x.id = a)
  ) THEN
    RAISE EXCEPTION 'audit_area_library seed references an unknown assertion id';
  END IF;
END $$;

-- ── Authority / Provision Library (§19 framework panel) ───────────────────
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, source_reference)
VALUES
  ('SA_240', 'ICAI', 'The auditor''s responsibilities relating to fraud',       'SA 240', '2008-04-01', 'ICAI Standard on Auditing 240 (Revised)'),
  ('SA_250', 'ICAI', 'Consideration of laws and regulations',                    'SA 250', '2008-04-01', 'ICAI Standard on Auditing 250'),
  ('SA_315', 'ICAI', 'Identifying and assessing the risks of material misstatement','SA 315','2008-04-01','ICAI Standard on Auditing 315'),
  ('SA_540', 'ICAI', 'Auditing accounting estimates and related disclosures',    'SA 540', '2009-04-01', 'ICAI Standard on Auditing 540'),
  ('SA_550', 'ICAI', 'Related parties',                                          'SA 550', '2010-04-01', 'ICAI Standard on Auditing 550'),
  ('SA_560', 'ICAI', 'Subsequent events',                                        'SA 560', '2009-04-01', 'ICAI Standard on Auditing 560'),
  ('SA_570', 'ICAI', 'Going concern',                                            'SA 570', '2016-04-01', 'ICAI Standard on Auditing 570 (Revised)'),
  ('COS_ACT_188','MCA','Related party transactions',                             'Section 188','2014-04-01','Companies Act 2013, s.188'),
  ('AS_2',   'MCA', 'Valuation of inventories',                                  'AS 2',   '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_3',   'MCA', 'Cash flow statements',                                      'AS 3',   '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_4',   'MCA', 'Contingencies and events occurring after the balance sheet date','AS 4','2006-12-07','Companies (Accounting Standards) Rules'),
  ('AS_9',   'MCA', 'Revenue recognition',                                       'AS 9',   '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_10',  'MCA', 'Property, plant and equipment',                             'AS 10',  '2016-04-01', 'Companies (Accounting Standards) Rules'),
  ('AS_11',  'MCA', 'The effects of changes in foreign exchange rates',          'AS 11',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_12',  'MCA', 'Accounting for government grants',                          'AS 12',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_13',  'MCA', 'Accounting for investments',                                'AS 13',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_15',  'MCA', 'Employee benefits',                                         'AS 15',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_16',  'MCA', 'Borrowing costs',                                           'AS 16',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_18',  'MCA', 'Related party disclosures',                                 'AS 18',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_19',  'MCA', 'Leases',                                                    'AS 19',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_20',  'MCA', 'Earnings per share',                                        'AS 20',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_22',  'MCA', 'Accounting for taxes on income',                            'AS 22',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_26',  'MCA', 'Intangible assets',                                         'AS 26',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('AS_29',  'MCA', 'Provisions, contingent liabilities and contingent assets',  'AS 29',  '2006-12-07', 'Companies (Accounting Standards) Rules'),
  ('INDAS_2',  'MCA','Inventories',                                              'Ind AS 2',  '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_7',  'MCA','Statement of cash flows',                                  'Ind AS 7',  '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_10', 'MCA','Events after the reporting period',                        'Ind AS 10', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_12', 'MCA','Income taxes',                                             'Ind AS 12', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_16', 'MCA','Property, plant and equipment',                            'Ind AS 16', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_19', 'MCA','Employee benefits',                                        'Ind AS 19', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_20', 'MCA','Accounting for government grants',                         'Ind AS 20', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_21', 'MCA','The effects of changes in foreign exchange rates',         'Ind AS 21', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_23', 'MCA','Borrowing costs',                                          'Ind AS 23', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_24', 'MCA','Related party disclosures',                                'Ind AS 24', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_33', 'MCA','Earnings per share',                                       'Ind AS 33', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_36', 'MCA','Impairment of assets',                                     'Ind AS 36', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_37', 'MCA','Provisions, contingent liabilities and contingent assets', 'Ind AS 37', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_38', 'MCA','Intangible assets',                                        'Ind AS 38', '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_103','MCA','Business combinations',                                    'Ind AS 103','2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_107','MCA','Financial instruments: disclosures',                       'Ind AS 107','2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_109','MCA','Financial instruments',                                    'Ind AS 109','2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_113','MCA','Fair value measurement',                                   'Ind AS 113','2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_115','MCA','Revenue from contracts with customers',                    'Ind AS 115','2018-04-01', 'Companies (Indian Accounting Standards) Rules 2015'),
  ('INDAS_116','MCA','Leases',                                                   'Ind AS 116','2019-04-01', 'Companies (Indian Accounting Standards) Rules 2015')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- FORCE RLS only after the seed (see 1763100000000).
ALTER TABLE hsdg.audit_assertion            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_area_library_release FORCE ROW LEVEL SECURITY;

-- ── Engagement: section record ─────────────────────────────────────────────
CREATE TABLE hsdg.audit_area_review (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL UNIQUE
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Section / matrix version (v1 → v2 on re-completion after reopening).
  version_no               integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  status                   text NOT NULL DEFAULT 'in_progress' CHECK (status IN
                             ('in_progress','complete','update_required')),
  library_version          text NOT NULL REFERENCES hsdg.audit_area_library_release (library_version),
  -- Profile the applicable library was selected with (§4): frf, industry, cfs, initialAudit.
  library_profile          jsonb NOT NULL DEFAULT '{}',
  initial_population_count integer NOT NULL DEFAULT 0,
  -- Facts at completion — the impact rules (§25) compare against these.
  completion_basis         jsonb,
  update_reason            text,
  reopen_reason            text,
  completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  completed_at             timestamptz,
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_area_review_engagement_idx ON hsdg.audit_area_review (engagement_id);
CREATE TRIGGER audit_area_review_set_updated_at
  BEFORE UPDATE ON hsdg.audit_area_review
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Engagement: Audit Area (§8) ─────────────────────────────────────────────
CREATE TABLE hsdg.audit_engagement_area (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id                uuid NOT NULL REFERENCES hsdg.audit_area_review (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                      integer NOT NULL,
  source                   text NOT NULL CHECK (source IN ('library','custom')),
  source_audit_area_id     uuid REFERENCES hsdg.audit_area_library (id),
  area_code                text,
  library_version          text,
  -- How it entered: initial population, Add from Library, methodology refresh, custom.
  origin                   text NOT NULL CHECK (origin IN ('population','added_from_library','methodology_refresh','custom')),
  area_name                text NOT NULL CHECK (length(trim(area_name)) > 0),
  area_type                text NOT NULL CHECK (area_type IN
                             ('balance_sheet','profit_loss','disclosure','cross_cutting')),
  addition_reason          text,
  disposition              text NOT NULL DEFAULT 'retained' CHECK (disposition IN ('retained','removed')),
  attention                text NOT NULL DEFAULT 'standard' CHECK (attention IN ('standard','enhanced')),
  attention_source         text NOT NULL DEFAULT 'default' CHECK (attention_source IN ('default','portal','manager')),
  attention_reason         text,
  removal_reason_code      text CHECK (removal_reason_code IS NULL OR removal_reason_code IN
                             ('NO_BALANCE_ACTIVITY','NOT_APPLICABLE','COVERED_ELSEWHERE',
                              'NOT_SEPARATELY_SCOPED','OTHER')),
  removal_reason_text      text,
  covered_under_area_id    uuid REFERENCES hsdg.audit_engagement_area (id),
  removed_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  removed_at               timestamptz,
  -- Optional manual amount (§13). NULL source = read live from 03.2 where mapped.
  cy_amount                numeric(20,2),
  py_amount                numeric(20,2),
  currency                 text,
  unit                     text,
  amount_source            text CHECK (amount_source IS NULL OR amount_source IN ('manual','other')),
  amount_note              text,
  planning_owner_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- Requires Review raised by an impact rule / methodology refresh (§14, §25).
  review_flag              text,
  review_flag_source       text,
  -- Explicit resolution of a CFS / initial-audit framework inconsistency (VAL-06/07).
  inconsistency_resolution text,
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  updated_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, seq),
  CONSTRAINT audit_engagement_area_source_shape CHECK (
    (source = 'library' AND source_audit_area_id IS NOT NULL AND area_code IS NOT NULL)
    OR (source = 'custom' AND source_audit_area_id IS NULL AND area_code IS NULL
        AND addition_reason IS NOT NULL AND length(trim(addition_reason)) > 0)
  ),
  CONSTRAINT audit_engagement_area_removal_shape CHECK (
    disposition = 'retained'
    OR (removal_reason_code IS NOT NULL
        AND (removal_reason_code <> 'COVERED_ELSEWHERE'
             OR (covered_under_area_id IS NOT NULL AND covered_under_area_id <> id))
        AND (removal_reason_code NOT IN ('NOT_SEPARATELY_SCOPED','OTHER')
             OR (removal_reason_text IS NOT NULL AND length(trim(removal_reason_text)) > 0)))
  ),
  CONSTRAINT audit_engagement_area_manual_amount CHECK (
    amount_source IS NULL OR (currency IS NOT NULL AND unit IS NOT NULL)
  )
);
-- No duplicate library area per engagement (active or removed, §11).
CREATE UNIQUE INDEX audit_engagement_area_code_uk
  ON hsdg.audit_engagement_area (review_id, area_code) WHERE area_code IS NOT NULL;

-- ── Engagement: assertions (§16/§17) ────────────────────────────────────────
CREATE TABLE hsdg.audit_area_assertion (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id                uuid NOT NULL REFERENCES hsdg.audit_engagement_area (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  assertion_id           text NOT NULL REFERENCES hsdg.audit_assertion (id),
  origin                 text NOT NULL CHECK (origin IN ('suggested','user_added')),
  active                 boolean NOT NULL DEFAULT true,
  removal_reason         text,
  attention              text NOT NULL DEFAULT 'standard' CHECK (attention IN ('standard','enhanced')),
  -- Portal suggestion (§17): 'enhanced' when a mapped scenario matched.
  suggested_attention    text CHECK (suggested_attention IS NULL OR suggested_attention IN ('standard','enhanced')),
  suggestion_basis       text,
  attention_reason       text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area_id, assertion_id),
  CONSTRAINT audit_area_assertion_removed_reason CHECK (
    active OR origin = 'user_added'
    OR (removal_reason IS NOT NULL AND length(trim(removal_reason)) > 0)
  ),
  CONSTRAINT audit_area_assertion_downgrade_reason CHECK (
    NOT (suggested_attention = 'enhanced' AND attention = 'standard')
    OR (attention_reason IS NOT NULL AND length(trim(attention_reason)) > 0)
  )
);

-- ── Engagement: Planning Signal links (§18) ─────────────────────────────────
CREATE TABLE hsdg.audit_area_signal_link (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id                uuid NOT NULL REFERENCES hsdg.audit_engagement_area (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  signal_id              uuid NOT NULL REFERENCES hsdg.audit_planning_signal (id) ON DELETE CASCADE,
  origin                 text NOT NULL CHECK (origin IN ('auto','manual')),
  -- An unlinked auto link stays (inactive) so a refresh never re-links it.
  active                 boolean NOT NULL DEFAULT true,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area_id, signal_id)
);
CREATE INDEX audit_area_signal_link_signal_idx ON hsdg.audit_area_signal_link (signal_id);

-- ── Engagement: specific-materiality links (VAL-04) ─────────────────────────
-- Keyed by the normalised matter name so the link survives 03.3 revisions.
CREATE TABLE hsdg.audit_area_specific_link (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id                uuid NOT NULL REFERENCES hsdg.audit_engagement_area (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  specific_key           text NOT NULL CHECK (length(specific_key) > 0),
  origin                 text NOT NULL CHECK (origin IN ('auto','manual')),
  active                 boolean NOT NULL DEFAULT true,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (area_id, specific_key)
);

-- ── Engagement: VAL-05 "no Audit Area mapping required" ─────────────────────
CREATE TABLE hsdg.audit_area_signal_resolution (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id              uuid NOT NULL REFERENCES hsdg.audit_area_review (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  signal_id              uuid NOT NULL REFERENCES hsdg.audit_planning_signal (id) ON DELETE CASCADE,
  note                   text NOT NULL CHECK (length(trim(note)) > 0),
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, signal_id)
);

-- ── Engagement: immutable matrix snapshots (§22/§23) ────────────────────────
CREATE TABLE hsdg.audit_area_matrix_version (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id                uuid NOT NULL REFERENCES hsdg.audit_area_review (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version_no               integer NOT NULL,
  library_version          text NOT NULL,
  matrix                   jsonb NOT NULL,
  summary                  jsonb NOT NULL,
  confirmed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  confirmed_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, version_no)
);

-- ── Engagement: Partner review comments (§27) ───────────────────────────────
CREATE TABLE hsdg.audit_area_review_comment (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id                uuid NOT NULL REFERENCES hsdg.audit_area_review (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  area_id                  uuid REFERENCES hsdg.audit_engagement_area (id) ON DELETE CASCADE,
  kind                     text NOT NULL CHECK (kind IN ('comment','challenge','reassessment_request')),
  body                     text NOT NULL CHECK (length(trim(body)) > 0),
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open','addressed')),
  response                 text,
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  responded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_area_review_comment_addressed CHECK (
    status <> 'addressed' OR (response IS NOT NULL AND length(trim(response)) > 0)
  )
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_engagement_area','audit_area_assertion','audit_area_signal_link',
                           'audit_area_specific_link','audit_area_signal_resolution',
                           'audit_area_review_comment']
  LOOP
    EXECUTE format('CREATE INDEX %I ON hsdg.%I (engagement_id)', t || '_engagement_idx', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON hsdg.%I FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END $$;
CREATE INDEX audit_area_matrix_version_engagement_idx ON hsdg.audit_area_matrix_version (engagement_id);

-- ── Row Level Security ────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_area_review','audit_engagement_area','audit_area_assertion',
                           'audit_area_signal_link','audit_area_specific_link',
                           'audit_area_signal_resolution','audit_area_review_comment']
  LOOP
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.is_engagement_member(engagement_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR DELETE USING (hsdg.is_engagement_lead(engagement_id))', t || '_delete', t);
  END LOOP;
END $$;
-- Matrix snapshots are insert-only (immutable once generated).
REVOKE UPDATE, DELETE ON hsdg.audit_area_matrix_version FROM hsdg_app;
ALTER TABLE hsdg.audit_area_matrix_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_area_matrix_version_select ON hsdg.audit_area_matrix_version
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_area_matrix_version_insert ON hsdg.audit_area_matrix_version
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_area_review_comment CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_matrix_version CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_signal_resolution CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_specific_link CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_signal_link CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_assertion CASCADE;
DROP TABLE IF EXISTS hsdg.audit_engagement_area CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_review CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_library CASCADE;
DROP TABLE IF EXISTS hsdg.audit_area_library_release CASCADE;
DROP TABLE IF EXISTS hsdg.audit_assertion CASCADE;
