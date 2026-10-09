-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.4 CARO 2020 — the Provision Library behind every CARO "View …" action and
-- the versioned CARO clause library (DHVAJ Section 02.4 spec §11, §17; build
-- split Track B).
--
--   • Provisions (§17): CARO 2020 paragraph 1 (application / exemptions), the
--     ICAI Guidance Note on CARO 2020 (Revised 2022), Companies Act 2013 s.8,
--     s.2(62) and s.143(11), and one row per paragraph-3 clause and sub-clause
--     (CARO_2020_3_I … CARO_2020_3_XXI, sub-clauses e.g. CARO_2020_3_I_A_A).
--     All effective from 1 April 2021 — CARO 2020 applies to financial years
--     commencing on or after that date — so an earlier period resolves none.
--   • hsdg.caro_order_version — one row per notified version of the Order:
--     effective dates, notification, the Order / paragraph 1 / ICAI Guidance
--     Note provision codes and the Guidance Note edition.
--   • hsdg.caro_clause_library — the paragraph-3 clauses and sub-clauses of
--     each Order, effective-dated per row: clause reference, title, concise
--     requirement, report context (standalone paragraph 3, or the consolidated
--     clause 3(xxi)), provision + guidance codes, the related Schedule III
--     disclosure keys (division-agnostic; 02.3 resolves them as
--     SCH3_<division>_<key>) and audit-area codes (03.5 library), and the
--     methodology procedures. The portal never holds a clause list in code.
--   • authority_reference_link rows for context '02.4'.
--
-- Library tables are firm-wide reference data: every signed-in role reads;
-- only firm-wide roles write. FORCE RLS on the provision / reference tables is
-- lifted for the seed and restored after (no request context in a migration).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.caro_order_version (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code                  text NOT NULL CHECK (order_code ~ '^[A-Z0-9_]{2,60}$'),
  title                       text NOT NULL CHECK (length(trim(title)) > 0),
  version_label               text NOT NULL CHECK (length(trim(version_label)) > 0),
  effective_from              date NOT NULL,
  effective_to                date,
  notification_reference      text,
  provision_code              text NOT NULL,
  applicability_provision_code text,
  guidance_provision_code     text,
  guidance_version            text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caro_order_version_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT caro_order_version_key UNIQUE (order_code, effective_from)
);

CREATE TABLE hsdg.caro_clause_library (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code               text NOT NULL CHECK (order_code ~ '^[A-Z0-9_]{2,60}$'),
  -- Stable clause ID; also the Provision Library code of its legal text.
  clause_code              text NOT NULL CHECK (clause_code ~ '^[A-Z0-9_]{2,60}$'),
  -- NULL for a paragraph-3 clause; the clause code for a sub-clause.
  parent_clause_code       text CHECK (parent_clause_code IS NULL OR parent_clause_code ~ '^[A-Z0-9_]{2,60}$'),
  clause_ref               text NOT NULL CHECK (length(trim(clause_ref)) > 0),
  title                    text NOT NULL CHECK (length(trim(title)) > 0),
  requirement              text NOT NULL CHECK (length(trim(requirement)) > 0),
  report_context           text NOT NULL DEFAULT 'standalone'
                             CHECK (report_context IN ('standalone','consolidated')),
  provision_code           text NOT NULL,
  guidance_provision_code  text,
  guidance_reference       text,
  -- When the clause is normally relevant to an entity's facts (display only;
  -- relevance is always the team's Level-2 decision).
  relevance_hint           text,
  schedule_iii_keys        text[] NOT NULL DEFAULT '{}',
  audit_area_codes         text[] NOT NULL DEFAULT '{}',
  -- [{key, title, objective, evidence}]
  procedures               jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_partner_review  boolean NOT NULL DEFAULT false,
  sort_order               integer NOT NULL DEFAULT 0,
  effective_from           date NOT NULL,
  effective_to             date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caro_clause_library_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT caro_clause_library_key UNIQUE (clause_code, effective_from)
);
CREATE INDEX caro_clause_library_order_idx
  ON hsdg.caro_clause_library (order_code, effective_from);

ALTER TABLE hsdg.caro_order_version  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.caro_clause_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY caro_order_version_read ON hsdg.caro_order_version
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY caro_order_version_write ON hsdg.caro_order_version
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY caro_clause_library_read ON hsdg.caro_clause_library
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY caro_clause_library_write ON hsdg.caro_clause_library
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- ── The clause seed (one source for the library and the provision rows) ────
CREATE TEMP TABLE caro_clause_seed (
  code text, parent text, ref text, title text, requirement text, ctx text,
  hint text, sch text[], areas text[], procs jsonb, partner boolean, sort integer
) ON COMMIT DROP;

INSERT INTO caro_clause_seed VALUES
-- 3(i) Property, plant and equipment and intangible assets
('CARO_2020_3_I', NULL, '3(i)', 'Property, plant and equipment and intangible assets',
 'Records, physical verification, title deeds, revaluation and benami proceedings for property, plant and equipment, right-of-use assets and intangible assets.',
 'standalone', 'Relevant where the company holds property, plant and equipment or intangible assets.',
 '{}', '{PPE,INTANG}', '[]', false, 100),
('CARO_2020_3_I_A_A', 'CARO_2020_3_I', '3(i)(a)(A)', 'Records of property, plant and equipment',
 'Whether the company is maintaining proper records showing full particulars, including quantitative details and situation, of property, plant and equipment.',
 'standalone', NULL, '{}', '{PPE,CWIP}',
 '[{"key":"far","title":"Fixed asset register — completeness of particulars","objective":"Agree the fixed asset register to the general ledger and check that it records full particulars, quantitative details and location of each asset.","evidence":"Fixed asset register reconciled to the trial balance."}]',
 false, 101),
('CARO_2020_3_I_A_B', 'CARO_2020_3_I', '3(i)(a)(B)', 'Records of intangible assets',
 'Whether the company is maintaining proper records showing full particulars of intangible assets.',
 'standalone', 'Relevant where the company holds intangible assets.', '{BS_INTANGIBLES_UD}', '{INTANG}',
 '[{"key":"intangible_register","title":"Intangible asset records","objective":"Check that the intangible asset register records full particulars and agrees to the general ledger.","evidence":"Intangible asset register reconciled to the trial balance."}]',
 false, 102),
('CARO_2020_3_I_B', 'CARO_2020_3_I', '3(i)(b)', 'Physical verification of property, plant and equipment',
 'Whether property, plant and equipment have been physically verified by management at reasonable intervals; whether material discrepancies were noticed and properly dealt with in the books.',
 'standalone', NULL, '{}', '{PPE}',
 '[{"key":"verification_programme","title":"Physical verification programme and results","objective":"Obtain management''s verification programme, assess whether the interval is reasonable for the size and nature of the assets, and examine how discrepancies were dealt with in the books.","evidence":"Verification programme; verification reports; discrepancy reconciliation."}]',
 false, 103),
('CARO_2020_3_I_C', 'CARO_2020_3_I', '3(i)(c)', 'Title deeds of immovable property',
 'Whether the title deeds of all immovable properties (other than properties where the company is the lessee and the lease agreements are duly executed in its favour) are held in the name of the company; if not, the prescribed particulars.',
 'standalone', 'Relevant where the company holds immovable property.', '{ARI_TITLE_DEEDS}', '{PPE}',
 '[{"key":"title_deeds","title":"Examine title deeds of immovable property","objective":"Inspect the title deeds (or registered sale deeds / transfer deeds / conveyance deeds) of each immovable property and identify any not held in the company''s name.","evidence":"Copies of title deeds; property schedule; confirmation from custodian where held as security."}]',
 false, 104),
('CARO_2020_3_I_D', 'CARO_2020_3_I', '3(i)(d)', 'Revaluation of property, plant and equipment and intangible assets',
 'Whether the company has revalued its property, plant and equipment (including right-of-use assets) or intangible assets during the year and, if so, whether the revaluation is based on the valuation by a registered valuer; the amount of change where it is 10% or more in aggregate of the net carrying value of each class.',
 'standalone', NULL, '{ARI_REVALUATION}', '{PPE,INTANG}',
 '[{"key":"revaluation","title":"Revaluation during the year","objective":"Identify any revaluation in the year and confirm the valuer is a registered valuer; compute the change by class against the net carrying value.","evidence":"Registered valuer''s report; revaluation working by class."}]',
 false, 105),
('CARO_2020_3_I_E', 'CARO_2020_3_I', '3(i)(e)', 'Benami property proceedings',
 'Whether any proceedings have been initiated or are pending against the company for holding any benami property under the Benami Transactions (Prohibition) Act, 1988 and the rules made thereunder; whether the company has appropriately disclosed the details in its financial statements.',
 'standalone', NULL, '{ARI_BENAMI}', '{PPE,LAWS}',
 '[{"key":"benami","title":"Benami property proceedings","objective":"Enquire of management and legal counsel, inspect correspondence and obtain a written representation on any benami proceedings; check the disclosure.","evidence":"Management representation; legal confirmation; disclosure note."}]',
 false, 106),
-- 3(ii) Inventory and working capital
('CARO_2020_3_II', NULL, '3(ii)', 'Inventory and working capital limits',
 'Physical verification of inventory and the quarterly returns or statements filed with banks or financial institutions for working capital limits secured on current assets.',
 'standalone', 'Relevant where the company holds inventory or has working capital limits.',
 '{}', '{INV,BORR}', '[]', false, 200),
('CARO_2020_3_II_A', 'CARO_2020_3_II', '3(ii)(a)', 'Physical verification of inventory',
 'Whether physical verification of inventory has been conducted at reasonable intervals by management, whether the coverage and procedure are appropriate, and whether discrepancies of 10% or more in aggregate for each class of inventory were noticed and properly dealt with in the books.',
 'standalone', 'Relevant where the company holds inventory.', '{}', '{INV}',
 '[{"key":"count","title":"Inventory count — coverage, procedure and discrepancies","objective":"Attend or review the physical counts, assess the coverage and procedure, and compute the discrepancies by class of inventory against the books (SA 501).","evidence":"Count instructions; count sheets; discrepancy analysis by class."}]',
 false, 201),
('CARO_2020_3_II_B', 'CARO_2020_3_II', '3(ii)(b)', 'Working capital limits — quarterly returns',
 'Whether, during the year, the company has been sanctioned working capital limits in excess of five crore rupees in aggregate from banks or financial institutions on the basis of security of current assets, and whether the quarterly returns or statements filed are in agreement with the books of account; if not, the details.',
 'standalone', 'Relevant where working capital limits are secured on current assets.',
 '{ARI_CURRENT_ASSET_BORROWINGS}', '{BORR,INV,AR}',
 '[{"key":"quarterly_returns","title":"Agree quarterly stock and book-debt statements to the books","objective":"Obtain the sanction letters and the quarterly returns filed with each lender and reconcile them to the books; list and explain each difference.","evidence":"Sanction letters; quarterly returns; reconciliation with explanations."}]',
 false, 202),
-- 3(iii) Investments, guarantees, security and loans
('CARO_2020_3_III', NULL, '3(iii)', 'Investments, guarantees, security and loans or advances',
 'Investments made in, guarantees or security provided to, and loans or advances in the nature of loans granted to companies, firms, limited liability partnerships or any other parties.',
 'standalone', 'Relevant where the company has made investments or given loans, advances, guarantees or security.',
 '{ARI_LOANS_RELATED}', '{LOANS,INVEST,COMMIT}', '[]', false, 300),
('CARO_2020_3_III_A', 'CARO_2020_3_III', '3(iii)(a)', 'Aggregate loans, advances, guarantees and security',
 'Where the company provided loans or advances in the nature of loans, or stood guarantee, or provided security to any other entity: the aggregate amount during the year and the balance outstanding at the balance sheet date, separately for subsidiaries, joint ventures and associates and for others.',
 'standalone', NULL, '{ARI_LOANS_RELATED}', '{LOANS,COMMIT,RPT}',
 '[{"key":"loan_schedule","title":"Schedule of loans, advances, guarantees and security","objective":"Prepare the schedule of amounts granted during the year and balances at the year end, split between group entities and others, and agree it to the books.","evidence":"Loan / guarantee register; agreements; ledger balances."}]',
 false, 301),
('CARO_2020_3_III_B', 'CARO_2020_3_III', '3(iii)(b)', 'Terms not prejudicial',
 'Whether the investments made, guarantees provided, security given and the terms and conditions of the grant of all loans and advances in the nature of loans and guarantees provided are not prejudicial to the company''s interest.',
 'standalone', NULL, '{}', '{LOANS,INVEST}',
 '[{"key":"terms","title":"Assess terms against the company''s interest","objective":"Review the terms (rate, tenure, security, repayment) and the approvals for each investment, loan, guarantee and security and conclude whether they are prejudicial to the company''s interest.","evidence":"Agreements; board / shareholder approvals; terms comparison."}]',
 false, 302),
('CARO_2020_3_III_C', 'CARO_2020_3_III', '3(iii)(c)', 'Schedule of repayment and regularity',
 'In respect of loans and advances in the nature of loans, whether the schedule of repayment of principal and payment of interest has been stipulated and whether the repayments or receipts are regular.',
 'standalone', NULL, '{}', '{LOANS}',
 '[{"key":"repayment","title":"Test repayment schedule and regularity","objective":"Compare the stipulated repayment and interest schedule with actual receipts and identify irregularities.","evidence":"Repayment schedules; bank statements; interest workings."}]',
 false, 303),
('CARO_2020_3_III_D', 'CARO_2020_3_III', '3(iii)(d)', 'Overdue amounts',
 'If any amount is overdue, the total amount overdue for more than ninety days, and whether reasonable steps have been taken by the company for recovery of the principal and interest.',
 'standalone', NULL, '{}', '{LOANS}',
 '[{"key":"overdue","title":"Ageing of overdue loans and recovery steps","objective":"Age the overdue principal and interest, total the amounts overdue beyond the reporting period and examine the recovery steps taken.","evidence":"Ageing analysis; recovery correspondence."}]',
 false, 304),
('CARO_2020_3_III_E', 'CARO_2020_3_III', '3(iii)(e)', 'Renewed or extended loans',
 'Whether any loan or advance in the nature of loan granted which has fallen due during the year has been renewed or extended, or fresh loans granted to settle the overdues of existing loans given to the same parties; if so, the aggregate amount and its percentage of the total loans granted.',
 'standalone', NULL, '{}', '{LOANS}',
 '[{"key":"evergreening","title":"Renewals, extensions and fresh loans to settle overdues","objective":"Identify loans falling due in the year that were renewed, extended or settled by fresh loans to the same party, and compute the aggregate and its percentage.","evidence":"Loan register movements; renewal approvals."}]',
 false, 305),
('CARO_2020_3_III_F', 'CARO_2020_3_III', '3(iii)(f)', 'Loans repayable on demand or without terms',
 'Whether the company has granted any loans or advances in the nature of loans either repayable on demand or without specifying any terms or period of repayment; if so, the aggregate amount, its percentage of total loans and the amount granted to promoters and related parties.',
 'standalone', NULL, '{ARI_LOANS_RELATED}', '{LOANS,RPT}',
 '[{"key":"on_demand","title":"Loans repayable on demand or without terms","objective":"Identify loans repayable on demand or without terms and compute the aggregate, the percentage and the portion to promoters and related parties.","evidence":"Loan agreements; related-party list."}]',
 false, 306),
-- 3(iv)
('CARO_2020_3_IV', NULL, '3(iv)', 'Loans, investments, guarantees and security — sections 185 and 186',
 'In respect of loans, investments, guarantees and security, whether the provisions of sections 185 and 186 of the Companies Act, 2013 have been complied with; if not, the details.',
 'standalone', 'Relevant where the company has given loans, guarantees or security or made investments.',
 '{}', '{LOANS,INVEST,LAWS}',
 '[{"key":"s185_s186","title":"Compliance with sections 185 and 186","objective":"Test each loan to directors and interested parties against section 185 and each loan, guarantee, security and investment against the limits, approvals, rate and register requirements of section 186.","evidence":"Section 186 register; resolutions; limit computation."}]',
 false, 400),
-- 3(v)
('CARO_2020_3_V', NULL, '3(v)', 'Deposits and deemed deposits',
 'In respect of deposits accepted or amounts deemed to be deposits, whether the directives of the Reserve Bank of India and the provisions of sections 73 to 76 or any other relevant provisions of the Companies Act, 2013 and the rules made thereunder have been complied with; whether any order has been passed by the Company Law Board, National Company Law Tribunal, Reserve Bank of India, any court or any other tribunal and whether it has been complied with.',
 'standalone', 'Relevant where the company has accepted deposits or holds amounts that are deemed deposits.',
 '{}', '{BORR,OFL,LAWS}',
 '[{"key":"deposits","title":"Deposits and deemed deposits","objective":"Analyse the receipts of money against the exclusions in the Companies (Acceptance of Deposits) Rules, identify deposits and deemed deposits and test compliance and any orders.","evidence":"Analysis of unsecured receipts; deposit register; returns filed."}]',
 false, 500),
-- 3(vi)
('CARO_2020_3_VI', NULL, '3(vi)', 'Cost records',
 'Whether maintenance of cost records has been specified by the Central Government under section 148(1) of the Companies Act, 2013 and whether such accounts and records have been made and maintained.',
 'standalone', 'Relevant where the company is covered by the Companies (Cost Records and Audit) Rules.',
 '{}', '{LAWS}',
 '[{"key":"cost_records","title":"Cost records under section 148(1)","objective":"Determine whether the company''s products or services are covered by the cost-records rules and, if so, perform a general review of the records maintained.","evidence":"Applicability assessment; extracts of cost records."}]',
 false, 600),
-- 3(vii) Statutory dues
('CARO_2020_3_VII', NULL, '3(vii)', 'Statutory dues',
 'Regularity in depositing undisputed statutory dues and the details of dues not deposited on account of any dispute.',
 'standalone', NULL, '{}', '{CTL,OL,EMPOBL,PROVCONT}', '[]', false, 700),
('CARO_2020_3_VII_A', 'CARO_2020_3_VII', '3(vii)(a)', 'Undisputed statutory dues',
 'Whether the company is regular in depositing undisputed statutory dues including goods and services tax, provident fund, employees'' state insurance, income-tax, sales-tax, service tax, duty of customs, duty of excise, value added tax, cess and any other statutory dues with the appropriate authorities; the extent of arrears outstanding for more than six months from the date they became payable.',
 'standalone', NULL, '{}', '{CTL,OL,EMPOBL}',
 '[{"key":"dues_regularity","title":"Regularity of statutory dues","objective":"Compare the due dates with the payment dates of each statutory due for the year, identify delays and list arrears outstanding for more than six months at the year end.","evidence":"Challans; returns; dues ledgers; delay analysis."}]',
 false, 701),
('CARO_2020_3_VII_B', 'CARO_2020_3_VII', '3(vii)(b)', 'Disputed statutory dues',
 'Where statutory dues referred to in sub-clause (a) have not been deposited on account of any dispute, the amounts involved and the forum where the dispute is pending.',
 'standalone', NULL, '{BS_CONTINGENT}', '{PROVCONT,CTL}',
 '[{"key":"disputed_dues","title":"Disputed statutory dues","objective":"Obtain the list of disputes, agree it to the orders and appeals, and record the amount not deposited and the forum for each.","evidence":"Dispute list; assessment orders; appeal papers."}]',
 false, 702),
-- 3(viii)
('CARO_2020_3_VIII', NULL, '3(viii)', 'Unrecorded income surrendered or disclosed in tax assessments',
 'Whether any transactions not recorded in the books of account have been surrendered or disclosed as income during the year in the tax assessments under the Income Tax Act, 1961; if so, whether the previously unrecorded income has been properly recorded in the books.',
 'standalone', NULL, '{ARI_UNDISCLOSED_INCOME}', '{REV,OI,TAXEXP}',
 '[{"key":"surrendered_income","title":"Income surrendered in tax assessments","objective":"Review the assessment orders, search or survey proceedings and representations for any income surrendered or disclosed, and check it is recorded in the books.","evidence":"Assessment orders; management representation; ledger entries."}]',
 false, 800),
-- 3(ix) Borrowings
('CARO_2020_3_IX', NULL, '3(ix)', 'Borrowings — defaults and utilisation',
 'Default in repayment of borrowings, wilful-defaulter declarations, application of term loans and the use of short-term funds and funds raised for group entities.',
 'standalone', 'Relevant where the company has borrowings.', '{}', '{BORR,FINCOST}', '[]', false, 900),
('CARO_2020_3_IX_A', 'CARO_2020_3_IX', '3(ix)(a)', 'Default in repayment of loans or other borrowings',
 'Whether the company has defaulted in the repayment of loans or other borrowings or in the payment of interest thereon to any lender; if so, the period and the amount of default.',
 'standalone', NULL, '{}', '{BORR,FINCOST}',
 '[{"key":"defaults","title":"Defaults in repayment","objective":"Compare repayment and interest schedules with actual payments for each lender and record any default with its period and amount.","evidence":"Lender statements; repayment schedules; lender confirmations."}]',
 false, 901),
('CARO_2020_3_IX_B', 'CARO_2020_3_IX', '3(ix)(b)', 'Wilful defaulter',
 'Whether the company is a declared wilful defaulter by any bank or financial institution or other lender.',
 'standalone', NULL, '{ARI_WILFUL_DEFAULTER}', '{BORR}',
 '[{"key":"wilful_defaulter","title":"Wilful-defaulter status","objective":"Enquire of management, inspect lender correspondence and obtain a representation on any wilful-defaulter declaration.","evidence":"Management representation; lender correspondence."}]',
 false, 902),
('CARO_2020_3_IX_C', 'CARO_2020_3_IX', '3(ix)(c)', 'Application of term loans',
 'Whether term loans were applied for the purpose for which the loans were obtained; if not, the amount of loan so diverted and the purpose for which it is used.',
 'standalone', NULL, '{ARI_FUNDS_UTILISATION}', '{BORR}',
 '[{"key":"term_loan_use","title":"End-use of term loans","objective":"Trace term-loan disbursements to the sanctioned purpose and identify any diversion.","evidence":"Sanction letters; disbursement trail; end-use certificate."}]',
 false, 903),
('CARO_2020_3_IX_D', 'CARO_2020_3_IX', '3(ix)(d)', 'Short-term funds used for long-term purposes',
 'Whether funds raised on short-term basis have been utilised for long-term purposes; if yes, the nature and amount.',
 'standalone', NULL, '{}', '{BORR,CFSTMT}',
 '[{"key":"short_for_long","title":"Short-term funds applied to long-term uses","objective":"Compare short-term sources with long-term applications from the balance sheet and cash flow to identify any short-term funds used for long-term purposes.","evidence":"Funds-flow analysis."}]',
 false, 904),
('CARO_2020_3_IX_E', 'CARO_2020_3_IX', '3(ix)(e)', 'Funds taken to meet obligations of group entities',
 'Whether the company has taken any funds from any entity or person on account of or to meet the obligations of its subsidiaries, associates or joint ventures; if so, the details.',
 'standalone', NULL, '{}', '{BORR,INVEST,RPT}',
 '[{"key":"group_obligations","title":"Funds raised for group entities'' obligations","objective":"Trace borrowings to their application and identify any raised on account of or to meet the obligations of subsidiaries, associates or joint ventures.","evidence":"Borrowing trail; group fund-flow analysis."}]',
 false, 905),
('CARO_2020_3_IX_F', 'CARO_2020_3_IX', '3(ix)(f)', 'Loans raised on pledge of securities in group entities',
 'Whether the company has raised loans during the year on the pledge of securities held in its subsidiaries, joint ventures or associate companies; if so, the details and any default in repayment of such loans.',
 'standalone', NULL, '{}', '{BORR,INVEST}',
 '[{"key":"pledge","title":"Loans raised on pledge of group securities","objective":"Inspect loan and pledge documents for any pledge of securities held in subsidiaries, joint ventures or associates and test repayment.","evidence":"Pledge agreements; depository statements."}]',
 false, 906),
-- 3(x) Raising of money
('CARO_2020_3_X', NULL, '3(x)', 'Money raised by public offer and preferential allotment',
 'Application of money raised by public offers and compliance on preferential allotments or private placements.',
 'standalone', 'Relevant where the company raised money through securities during the year.', '{}', '{SHARECAP,BORR}', '[]', false, 1000),
('CARO_2020_3_X_A', 'CARO_2020_3_X', '3(x)(a)', 'Initial or further public offer',
 'Whether moneys raised by way of initial public offer or further public offer (including debt instruments) during the year were applied for the purposes for which those are raised; if not, the details with delays or default and subsequent rectification.',
 'standalone', NULL, '{}', '{SHARECAP,BORR}',
 '[{"key":"ipo_use","title":"Use of public-offer proceeds","objective":"Compare the stated objects of the offer with the utilisation of proceeds and identify any deviation.","evidence":"Offer document; utilisation statement; monitoring agency report."}]',
 false, 1001),
('CARO_2020_3_X_B', 'CARO_2020_3_X', '3(x)(b)', 'Preferential allotment or private placement',
 'Whether the company has made any preferential allotment or private placement of shares or convertible debentures during the year and whether the requirements of sections 42 and 62 of the Companies Act, 2013 have been complied with and the funds used for the purposes raised; if not, the details.',
 'standalone', NULL, '{}', '{SHARECAP,LAWS}',
 '[{"key":"preferential","title":"Preferential allotment and private placement compliance","objective":"Test each allotment against sections 42 and 62 (offer, approvals, separate bank account, filings) and trace the use of funds.","evidence":"Offer letters; resolutions; PAS-3; bank account statements."}]',
 false, 1002),
-- 3(xi) Fraud
('CARO_2020_3_XI', NULL, '3(xi)', 'Fraud and whistle-blower complaints',
 'Fraud by or on the company, reports under section 143(12) and whistle-blower complaints.',
 'standalone', NULL, '{}', '{FRAUD}', '[]', false, 1100),
('CARO_2020_3_XI_A', 'CARO_2020_3_XI', '3(xi)(a)', 'Fraud by or on the company',
 'Whether any fraud by the company or any fraud on the company has been noticed or reported during the year; if yes, the nature and the amount involved.',
 'standalone', NULL, '{}', '{FRAUD}',
 '[{"key":"fraud","title":"Fraud noticed or reported","objective":"Enquire of management and those charged with governance, review minutes, internal audit and vigilance reports, and record the nature and amount of any fraud (SA 240).","evidence":"Enquiry notes; minutes; internal audit reports; representation."}]',
 false, 1101),
('CARO_2020_3_XI_B', 'CARO_2020_3_XI', '3(xi)(b)', 'Report under section 143(12)',
 'Whether any report under sub-section (12) of section 143 of the Companies Act, 2013 has been filed by the auditors in Form ADT-4 as prescribed under rule 13 of the Companies (Audit and Auditors) Rules, 2014 with the Central Government.',
 'standalone', NULL, '{}', '{FRAUD,LAWS}',
 '[{"key":"adt4","title":"Section 143(12) reporting","objective":"Confirm whether any fraud reportable to the Central Government was identified and, if so, that Form ADT-4 was filed.","evidence":"ADT-4 filing or nil confirmation."}]',
 false, 1102),
('CARO_2020_3_XI_C', 'CARO_2020_3_XI', '3(xi)(c)', 'Whistle-blower complaints',
 'Whether the auditor has considered whistle-blower complaints, if any, received during the year by the company.',
 'standalone', NULL, '{}', '{FRAUD}',
 '[{"key":"whistle_blower","title":"Whistle-blower complaints","objective":"Obtain the register of whistle-blower complaints and consider their impact on the audit.","evidence":"Complaint register; audit committee minutes."}]',
 false, 1103),
-- 3(xii) Nidhi
('CARO_2020_3_XII', NULL, '3(xii)', 'Nidhi company',
 'For a Nidhi company: the net owned funds to deposits ratio, the unencumbered term deposits and any default in payment of interest on or repayment of deposits.',
 'standalone', 'Relevant only to a Nidhi company.', '{}', '{OFL,LAWS}', '[]', false, 1200),
('CARO_2020_3_XII_A', 'CARO_2020_3_XII', '3(xii)(a)', 'Net owned funds to deposits',
 'Whether the Nidhi company has complied with the net owned funds to deposits ratio of 1:20 to meet out the liability.',
 'standalone', NULL, '{}', '{OFL,LAWS}',
 '[{"key":"nof_ratio","title":"Net owned funds to deposits ratio","objective":"Compute the ratio at the year end and at the required intervals and compare with the Nidhi Rules.","evidence":"Ratio computation; NDH returns."}]',
 false, 1201),
('CARO_2020_3_XII_B', 'CARO_2020_3_XII', '3(xii)(b)', 'Unencumbered term deposits',
 'Whether the Nidhi company is maintaining ten per cent unencumbered term deposits as specified in the Nidhi Rules, 2014 to meet out the liability.',
 'standalone', NULL, '{}', '{CASH,LAWS}',
 '[{"key":"unencumbered_deposits","title":"Unencumbered term deposits","objective":"Confirm the unencumbered term deposits held against the deposit liability.","evidence":"Bank confirmations; deposit computation."}]',
 false, 1202),
('CARO_2020_3_XII_C', 'CARO_2020_3_XII', '3(xii)(c)', 'Default in interest or repayment of deposits',
 'Whether there has been any default in payment of interest on deposits or repayment thereof for any period; if so, the details.',
 'standalone', NULL, '{}', '{OFL}',
 '[{"key":"deposit_default","title":"Defaults on deposits","objective":"Test the payment of interest and repayment of deposits against their due dates.","evidence":"Deposit ledger; payment trail."}]',
 false, 1203),
-- 3(xiii)
('CARO_2020_3_XIII', NULL, '3(xiii)', 'Related party transactions',
 'Whether all transactions with the related parties are in compliance with sections 177 and 188 of the Companies Act, 2013 where applicable and the details have been disclosed in the financial statements as required by the applicable accounting standards.',
 'standalone', NULL, '{RELATED_PARTIES}', '{RPT}',
 '[{"key":"rpt_compliance","title":"Related party transactions — sections 177 and 188 and disclosure","objective":"Test related-party transactions for the approvals required by sections 177 and 188 and agree them to the related-party disclosure (SA 550).","evidence":"RPT register; audit committee and board approvals; disclosure note."}]',
 false, 1300),
-- 3(xiv) Internal audit
('CARO_2020_3_XIV', NULL, '3(xiv)', 'Internal audit system',
 'Whether the company has an internal audit system commensurate with the size and nature of its business, and whether the reports of the internal auditors were considered.',
 'standalone', 'Relevant where internal audit is required by section 138 or exists.', '{}', '{LAWS}', '[]', false, 1400),
('CARO_2020_3_XIV_A', 'CARO_2020_3_XIV', '3(xiv)(a)', 'Internal audit commensurate with business',
 'Whether the company has an internal audit system commensurate with the size and nature of its business.',
 'standalone', NULL, '{}', '{LAWS}',
 '[{"key":"ia_system","title":"Internal audit system","objective":"Evaluate the scope, coverage, independence and reporting of the internal audit function against the size and nature of the business (SA 610).","evidence":"Internal audit charter and plan; appointment resolution."}]',
 false, 1401),
('CARO_2020_3_XIV_B', 'CARO_2020_3_XIV', '3(xiv)(b)', 'Internal audit reports considered',
 'Whether the reports of the internal auditors for the period under audit were considered by the statutory auditor.',
 'standalone', NULL, '{}', '{LAWS}',
 '[{"key":"ia_reports","title":"Internal audit reports considered","objective":"Read the internal audit reports for the period and record how their findings were considered in the audit.","evidence":"Internal audit reports; cross-reference to audit work."}]',
 false, 1402),
-- 3(xv)
('CARO_2020_3_XV', NULL, '3(xv)', 'Non-cash transactions with directors',
 'Whether the company has entered into any non-cash transactions with directors or persons connected with them; if so, whether the provisions of section 192 of the Companies Act, 2013 have been complied with.',
 'standalone', NULL, '{}', '{RPT,LAWS}',
 '[{"key":"s192","title":"Non-cash transactions with directors","objective":"Identify non-cash transactions with directors or connected persons and test the prior approval required by section 192.","evidence":"Board minutes; general meeting resolutions; representation."}]',
 false, 1500),
-- 3(xvi) RBI registration
('CARO_2020_3_XVI', NULL, '3(xvi)', 'Registration under section 45-IA of the RBI Act and Core Investment Companies',
 'Registration under section 45-IA of the Reserve Bank of India Act, 1934, non-banking financial or housing finance activity without a valid certificate, and Core Investment Company status in the company and its group.',
 'standalone', 'Relevant where the company carries on, or may be required to register for, non-banking financial activity.',
 '{NBFC_REGULATORY}', '{LAWS}', '[]', false, 1600),
('CARO_2020_3_XVI_A', 'CARO_2020_3_XVI', '3(xvi)(a)', 'Registration under section 45-IA',
 'Whether the company is required to be registered under section 45-IA of the Reserve Bank of India Act, 1934 and, if so, whether the registration has been obtained.',
 'standalone', NULL, '{NBFC_REGULATORY}', '{LAWS,INVEST,LOANS}',
 '[{"key":"principal_business","title":"Principal business test","objective":"Apply the financial-assets and financial-income test to the year-end balance sheet and the income for the year to decide whether registration is required, and inspect the certificate.","evidence":"Principal business computation; certificate of registration."}]',
 false, 1601),
('CARO_2020_3_XVI_B', 'CARO_2020_3_XVI', '3(xvi)(b)', 'Non-banking financial activity without a valid certificate',
 'Whether the company has conducted any non-banking financial or housing finance activities without a valid Certificate of Registration from the Reserve Bank of India as per the Reserve Bank of India Act, 1934.',
 'standalone', NULL, '{NBFC_REGULATORY}', '{LAWS}',
 '[{"key":"nbfc_activity","title":"NBFC / HFC activity without registration","objective":"Review the activities in the year for non-banking financial or housing finance activity carried on without a valid certificate.","evidence":"Activity analysis; certificate of registration."}]',
 false, 1602),
('CARO_2020_3_XVI_C', 'CARO_2020_3_XVI', '3(xvi)(c)', 'Core Investment Company',
 'Whether the company is a Core Investment Company as defined in the regulations made by the Reserve Bank of India; if so, whether it continues to fulfil the criteria of a CIC and, in case of an exempted or unregistered CIC, whether it continues to fulfil such criteria.',
 'standalone', NULL, '{NBFC_REGULATORY}', '{INVEST,LAWS}',
 '[{"key":"cic","title":"Core Investment Company criteria","objective":"Test the CIC criteria (investment in group companies, public funds) against the year-end balance sheet.","evidence":"CIC criteria computation."}]',
 false, 1603),
('CARO_2020_3_XVI_D', 'CARO_2020_3_XVI', '3(xvi)(d)', 'Core Investment Companies in the group',
 'Whether the group has more than one CIC as part of the group; if yes, the number of CICs which are part of the group.',
 'standalone', NULL, '{}', '{INVEST,LAWS}',
 '[{"key":"group_cic","title":"CICs in the group","objective":"Obtain the group structure and identify the CICs within it.","evidence":"Group structure; representation."}]',
 false, 1604),
-- 3(xvii)
('CARO_2020_3_XVII', NULL, '3(xvii)', 'Cash losses',
 'Whether the company has incurred cash losses in the financial year and in the immediately preceding financial year; if so, the amount of cash losses.',
 'standalone', NULL, '{}', '{GC,PRESDISC}',
 '[{"key":"cash_loss","title":"Cash loss computation","objective":"Compute the cash profit or loss for the year and the preceding year by adjusting the results for non-cash items.","evidence":"Cash loss computation for both years."}]',
 false, 1700),
-- 3(xviii)
('CARO_2020_3_XVIII', NULL, '3(xviii)', 'Resignation of the statutory auditors',
 'Whether there has been any resignation of the statutory auditors during the year; if so, whether the auditor has taken into consideration the issues, objections or concerns raised by the outgoing auditors.',
 'standalone', 'Relevant where the previous auditor resigned during the year.', '{}', '{LAWS}',
 '[{"key":"outgoing_auditor","title":"Concerns raised by the outgoing auditor","objective":"Review the outgoing auditor''s resignation letter, ADT-3 and communication, and record how any issues raised were considered.","evidence":"Resignation letter; ADT-3; communication with the previous auditor (Section 01)."}]',
 false, 1800),
-- 3(xix)
('CARO_2020_3_XIX', NULL, '3(xix)', 'Material uncertainty about meeting liabilities',
 'On the basis of the financial ratios, ageing and expected dates of realisation of financial assets and payment of financial liabilities, other information accompanying the financial statements and the auditor''s knowledge of the board of directors and management plans, whether any material uncertainty exists as on the date of the audit report that the company is not capable of meeting its liabilities existing at the date of the balance sheet as and when they fall due within a period of one year from the balance sheet date.',
 'standalone', NULL, '{ARI_RATIOS}', '{GC,SUBSEQ}',
 '[{"key":"liquidity","title":"Ability to meet liabilities within one year","objective":"Analyse the ratios, the ageing and expected realisation of financial assets and the payment of financial liabilities, and management''s plans, to conclude on any material uncertainty (SA 570).","evidence":"Ratio and maturity analysis; cash flow forecast; management plans."}]',
 false, 1900),
-- 3(xx) CSR
('CARO_2020_3_XX', NULL, '3(xx)', 'Corporate social responsibility — unspent amounts',
 'Transfer of unspent corporate social responsibility amounts to a fund specified in Schedule VII or to the Unspent CSR Account.',
 'standalone', 'Relevant where section 135 applies to the company.', '{ARI_CSR}', '{LAWS}', '[]', false, 2000),
('CARO_2020_3_XX_A', 'CARO_2020_3_XX', '3(xx)(a)', 'Unspent amount — other than ongoing projects',
 'Whether, in respect of other than ongoing projects, the company has transferred the unspent amount to a fund specified in Schedule VII of the Companies Act, 2013 within a period of six months of the expiry of the financial year in compliance with the second proviso to section 135(5).',
 'standalone', NULL, '{ARI_CSR}', '{LAWS}',
 '[{"key":"csr_unspent_other","title":"Unspent CSR — other than ongoing projects","objective":"Compute the CSR obligation and spend, identify the unspent amount not relating to ongoing projects and test its transfer within the time allowed.","evidence":"CSR obligation working; transfer challan."}]',
 false, 2001),
('CARO_2020_3_XX_B', 'CARO_2020_3_XX', '3(xx)(b)', 'Unspent amount — ongoing projects',
 'Whether any amount remaining unspent under section 135(5) of the Companies Act, 2013, pursuant to any ongoing project, has been transferred to a special account in compliance with section 135(6).',
 'standalone', NULL, '{ARI_CSR}', '{LAWS,CASH}',
 '[{"key":"csr_unspent_ongoing","title":"Unspent CSR — ongoing projects","objective":"Identify the unspent amount relating to ongoing projects and test its transfer to the Unspent CSR Account within thirty days of the year end.","evidence":"Ongoing project list; Unspent CSR Account statement."}]',
 false, 2002),
-- 3(xxi) Consolidated
('CARO_2020_3_XXI', NULL, '3(xxi)', 'Qualifications or adverse remarks in the CARO reports of companies included in the consolidated financial statements',
 'Whether there have been any qualifications or adverse remarks by the respective auditors in the Companies (Auditor''s Report) Order reports of the companies included in the consolidated financial statements; if yes, the details of the companies and the paragraph numbers of the CARO report containing the qualifications or adverse remarks.',
 'consolidated', 'Applies only to the auditor''s report on consolidated financial statements.',
 '{CFS_ADDITIONAL_INFO}', '{CONSOL}',
 '[{"key":"component_caro_reports","title":"Collect the CARO reports of the companies in the CFS","objective":"For each company included in the consolidated financial statements to which CARO applies, obtain its CARO report and identify the qualifications or adverse remarks and their paragraph numbers.","evidence":"CARO reports of the components; component-auditor communications."}]',
 true, 2100);

-- Provisions (§17): the Order's application, the Guidance Note, the Act
-- sections, then one row per clause / sub-clause from the seed above.
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary)
VALUES
  ('CARO_2020_PARA_1', 'MCA', 'CARO 2020 — application and exemptions', 'Paragraph 1',
   '2021-04-01', NULL, 1,
   'Companies (Auditor''s Report) Order, 2020, paragraph 1', 'provision', NULL,
   'The Order applies to every company, including a foreign company, except: a banking '
   || 'company; an insurance company; a company licensed to operate under section 8; a One '
   || 'Person Company and a small company; and a private limited company that is not a '
   || 'subsidiary or holding company of a public company, whose paid-up capital and reserves '
   || 'and surplus, borrowings from any bank or financial institution at any point of time '
   || 'during the year, and total revenue (including revenue from discontinuing operations) '
   || 'are within the limits in the Order. On consolidated financial statements the Order '
   || 'applies only to the extent of clause (xxi) of paragraph 3. It applies to audits of '
   || 'financial years commencing on or after 1 April 2021. The limits DHVAJ applies are held '
   || 'in the Audit Rules Library.'),
  ('ICAI_GN_CARO_2020', 'ICAI',
   'Guidance Note on the Companies (Auditor''s Report) Order, 2020',
   'Guidance Note (Revised 2022)',
   '2021-04-01', NULL, 1,
   'ICAI Auditing and Assurance Standards Board, Revised 2022', 'guidance', NULL,
   'ICAI guidance on applying CARO 2020: the applicability and exemptions in paragraph 1 '
   || '(including how borrowings "at any point of time" and total revenue are measured for the '
   || 'private-company exemption), and the audit procedures and reporting for each clause of '
   || 'paragraph 3, with illustrative reporting language.'),
  ('COS_ACT_8', 'MCA', 'Formation of companies with charitable objects', 'Section 8',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, s.8', 'provision', 'https://www.indiacode.nic.in/handle/123456789/2114',
   'A company licensed by the Central Government under section 8 to promote commerce, art, '
   || 'science, sports, education, research, social welfare, religion, charity, environmental '
   || 'protection or similar objects, which applies its profits to those objects and prohibits '
   || 'the payment of dividends to its members.'),
  ('COS_ACT_2_62', 'MCA', 'One Person Company', 'Section 2(62)',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, s.2(62)', 'provision', 'https://www.indiacode.nic.in/handle/123456789/2114',
   'A One Person Company means a company which has only one person as a member.'),
  ('COS_ACT_143_11', 'MCA', 'Additional matters in the auditor''s report', 'Section 143(11)',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, s.143(11)', 'provision', 'https://www.indiacode.nic.in/handle/123456789/2114',
   'The Central Government may, in consultation with the National Financial Reporting '
   || 'Authority, direct by general or special order that, for such class of companies as may '
   || 'be specified, the auditor''s report shall also include a statement on such matters as '
   || 'may be specified — the authority under which the Companies (Auditor''s Report) Order is '
   || 'issued.')
ON CONFLICT DO NOTHING;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary)
SELECT s.code, 'MCA', 'CARO 2020 ' || s.ref || ' — ' || s.title,
       'Paragraph 3 clause ' || substr(s.ref, 2),
       DATE '2021-04-01', NULL, 1,
       'Companies (Auditor''s Report) Order, 2020, paragraph 3 clause ' || substr(s.ref, 2),
       'provision', NULL, s.requirement
  FROM caro_clause_seed s
ON CONFLICT DO NOTHING;

-- The CARO 2020 Order row (seeded 1763000000000) gains its viewer summary.
UPDATE hsdg.authority_provision
   SET summary = 'The Companies (Auditor''s Report) Order, 2020, issued under section 143(11), '
       || 'requires the auditor''s report of companies to which it applies to include a '
       || 'statement on the matters in paragraph 3, clauses (i) to (xxi). Paragraph 1 sets its '
       || 'application and exemptions; it applies to audits of financial years commencing on '
       || 'or after 1 April 2021.'
 WHERE code = 'CARO_2020' AND summary IS NULL;

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- ── Order version (§11) ────────────────────────────────────────────────────
INSERT INTO hsdg.caro_order_version
  (order_code, title, version_label, effective_from, effective_to, notification_reference,
   provision_code, applicability_provision_code, guidance_provision_code, guidance_version)
VALUES
  ('CARO_2020', 'Companies (Auditor''s Report) Order, 2020',
   'CARO 2020 — applicable from FY 2021-22', '2021-04-01', NULL,
   'MCA Order S.O. 849(E) dated 25 February 2020; commencement deferred to financial years '
   || 'commencing on or after 1 April 2021',
   'CARO_2020', 'CARO_2020_PARA_1', 'ICAI_GN_CARO_2020', 'Revised 2022')
ON CONFLICT (order_code, effective_from) DO NOTHING;

-- ── Clause library (§11) ───────────────────────────────────────────────────
INSERT INTO hsdg.caro_clause_library
  (order_code, clause_code, parent_clause_code, clause_ref, title, requirement, report_context,
   provision_code, guidance_provision_code, guidance_reference, relevance_hint,
   schedule_iii_keys, audit_area_codes, procedures, requires_partner_review, sort_order,
   effective_from)
SELECT 'CARO_2020', s.code, s.parent, s.ref, s.title, s.requirement, s.ctx,
       s.code, 'ICAI_GN_CARO_2020', 'Guidance Note on CARO 2020 — clause ' || substr(s.ref, 2),
       s.hint, s.sch, s.areas, s.procs, s.partner, s.sort, DATE '2021-04-01'
  FROM caro_clause_seed s
ON CONFLICT (clause_code, effective_from) DO NOTHING;

-- ── 02.4 references (spec §17; resolved through the library, period-correct) ─
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('02.4', 'caro_order',     'View CARO 2020 Order',            'CARO_2020',         10),
  ('02.4', 'caro_para_1',    'View Applicability / Exemptions', 'CARO_2020_PARA_1',  20),
  ('02.4', 'icai_gn_caro',   'View ICAI Guidance Note',         'ICAI_GN_CARO_2020', 30),
  ('02.4', 'section_8',      'View Section 8',                  'COS_ACT_8',         40),
  ('02.4', 'section_2_62',   'View Section 2(62)',              'COS_ACT_2_62',      50),
  ('02.4', 'section_2_85',   'View Section 2(85)',              'COS_ACT_2_85',      60),
  ('02.4', 'section_143_11', 'View Section 143',                'COS_ACT_143_11',    70)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '02.4';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS hsdg.caro_clause_library CASCADE;
DROP TABLE IF EXISTS hsdg.caro_order_version CASCADE;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
-- Anything that cited a removed provision keeps working: the citation falls away.
UPDATE hsdg.audit_rule_version SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision
    WHERE code IN ('CARO_2020_PARA_1','ICAI_GN_CARO_2020','COS_ACT_8','COS_ACT_2_62','COS_ACT_143_11')
       OR code LIKE 'CARO\_2020\_3\_%');
UPDATE hsdg.audit_framework_subassessment SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision
    WHERE code IN ('CARO_2020_PARA_1','ICAI_GN_CARO_2020','COS_ACT_8','COS_ACT_2_62','COS_ACT_143_11')
       OR code LIKE 'CARO\_2020\_3\_%');
UPDATE hsdg.authority_provision SET superseded_by_id = NULL
 WHERE code IN ('CARO_2020_PARA_1','ICAI_GN_CARO_2020','COS_ACT_8','COS_ACT_2_62','COS_ACT_143_11')
    OR code LIKE 'CARO\_2020\_3\_%';
DELETE FROM hsdg.authority_provision
 WHERE code IN ('CARO_2020_PARA_1','ICAI_GN_CARO_2020','COS_ACT_8','COS_ACT_2_62','COS_ACT_143_11')
    OR code LIKE 'CARO\_2020\_3\_%';
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
