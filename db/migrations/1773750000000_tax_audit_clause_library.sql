-- ─────────────────────────────────────────────────────────────────────────
-- Form 3CD clause library (Phase 4, F-4)
--
-- Form 3CD is data, not code. hsdg.tax_audit_clause_library_versions holds
-- one row per version of the form (the Act it reports under, the first
-- financial year audited on it, draft or published); hsdg.tax_audit_clause_
-- library holds each version's clauses: number, part, title, the sub-items the
-- e-filing utility asks for, when the clause applies (a condition over the
-- audit's facts, with the Not applicable reason), its default work package
-- and preparer grade, the evidence its working paper must hold, and where a
-- first draft can come from.
--
-- A published version is immutable (triggers below); Admin and the Managing
-- Partner change the library on one draft and publish it as the next version.
-- Each tax audit stays on the version it started with.
--
-- Version 1 is Form 3CD under the Income-tax Rules 1962 as it stands for
-- audits from FY 2018-19 (Notification 33/2018 and later amendments).
-- Library rows are firm-wide reference data: every signed-in role reads, only
-- firm-wide roles write.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.tax_audit_clause_library_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no               integer NOT NULL UNIQUE CHECK (version_no >= 1),
  label                    text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  act                      text NOT NULL CHECK (act IN ('1961','2025')),
  form                     text NOT NULL DEFAULT '3CD' CHECK (form ~ '^[0-9A-Z-]{2,12}$'),
  applies_from_fy          text NOT NULL CHECK (applies_from_fy ~ '^[0-9]{4}-[0-9]{2}$'),
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  notes                    text CHECK (length(notes) <= 2000),
  based_on_version_id      uuid REFERENCES hsdg.tax_audit_clause_library_versions (id),
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  published_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  published_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);
-- One draft at a time.
CREATE UNIQUE INDEX tax_audit_clause_library_one_draft
  ON hsdg.tax_audit_clause_library_versions (status) WHERE status = 'draft';

CREATE TABLE hsdg.tax_audit_clause_library (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_version_id     uuid NOT NULL
                           REFERENCES hsdg.tax_audit_clause_library_versions (id) ON DELETE CASCADE,
  clause_no              text NOT NULL CHECK (clause_no ~ '^[0-9]{1,2}[A-Za-z]?(\([a-z]{1,3}\))?$'),
  part                   text NOT NULL CHECK (part IN ('A','B')),
  title                  text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  -- [{key, label, kind}] — the fields the e-filing utility asks for.
  sub_items              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sub_items) = 'array'),
  -- {fact, is} | {all: […]} | {any: […]} | {not: …}; NULL = always applies.
  applies_when           jsonb CHECK (applies_when IS NULL OR jsonb_typeof(applies_when) = 'object'),
  not_applicable_reason  text CHECK (length(not_applicable_reason) <= 500),
  default_package        text NOT NULL CHECK (default_package IN
                           ('general','accounting_methods','stock','depreciation','inadmissible',
                            'cash_payments','msme','statutory_payments','loans_deposits','losses',
                            'tds_tcs','ratios','gst_breakup')),
  default_grade          text NOT NULL CHECK (default_grade IN ('article','senior','manager')),
  evidence               jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  draft_source           text CHECK (draft_source IN
                           ('client_master','tds_filings','gst_filings','last_year','msme_list')),
  partner_review         boolean NOT NULL DEFAULT false,
  sort_order             integer NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- A clause that can fall away says why.
  CHECK (applies_when IS NULL OR not_applicable_reason IS NOT NULL),
  UNIQUE (library_version_id, clause_no)
);
CREATE INDEX tax_audit_clause_library_version_idx
  ON hsdg.tax_audit_clause_library (library_version_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.tax_audit_clause_library_versions TO hsdg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.tax_audit_clause_library TO hsdg_app;
ALTER TABLE hsdg.tax_audit_clause_library_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audit_clause_library_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audit_clause_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audit_clause_library FORCE ROW LEVEL SECURITY;

CREATE POLICY tax_audit_clause_library_versions_read ON hsdg.tax_audit_clause_library_versions
  FOR SELECT TO hsdg_app USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY tax_audit_clause_library_versions_write ON hsdg.tax_audit_clause_library_versions
  FOR ALL TO hsdg_app USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY tax_audit_clause_library_read ON hsdg.tax_audit_clause_library
  FOR SELECT TO hsdg_app USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY tax_audit_clause_library_write ON hsdg.tax_audit_clause_library
  FOR ALL TO hsdg_app USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
-- The clause trigger runs as the owner (hsdg_migrator), which FORCE RLS
-- would otherwise blind to which versions are published.
CREATE POLICY tax_audit_clause_library_versions_owner_read ON hsdg.tax_audit_clause_library_versions
  FOR SELECT TO hsdg_migrator USING (true);
CREATE POLICY erase_person ON hsdg.tax_audit_clause_library_versions TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');

CREATE TRIGGER tax_audit_clause_library_versions_set_updated_at
  BEFORE UPDATE ON hsdg.tax_audit_clause_library_versions
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
CREATE TRIGGER tax_audit_clause_library_set_updated_at
  BEFORE UPDATE ON hsdg.tax_audit_clause_library
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- A published version and its clauses never change.
CREATE FUNCTION hsdg.tax_audit_library_version_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'A published Form 3CD library version cannot be deleted.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'published' AND current_setting('hsdg.erasing_person', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'A published Form 3CD library version cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_audit_library_version_immutable
  BEFORE UPDATE OR DELETE ON hsdg.tax_audit_clause_library_versions
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_library_version_immutable();

CREATE FUNCTION hsdg.tax_audit_library_clause_immutable() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_ids uuid[];
BEGIN
  v_ids := CASE TG_OP
             WHEN 'INSERT' THEN ARRAY[NEW.library_version_id]
             WHEN 'DELETE' THEN ARRAY[OLD.library_version_id]
             ELSE ARRAY[OLD.library_version_id, NEW.library_version_id] END;
  IF EXISTS (SELECT 1 FROM hsdg.tax_audit_clause_library_versions
              WHERE id = ANY (v_ids) AND status = 'published') THEN
    RAISE EXCEPTION 'The clauses of a published Form 3CD library version cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER tax_audit_library_clause_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON hsdg.tax_audit_clause_library
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_audit_library_clause_immutable();

-- ── Version 1: Form 3CD (Income-tax Rules 1962) ───────────────────────────
-- Inserted as a draft, filled, then published (the clause trigger refuses
-- rows on a published version). The migrator owns the tables: no FORCE lift
-- is needed for its own inserts, but RLS would hide rows, so lift it.
ALTER TABLE hsdg.tax_audit_clause_library_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audit_clause_library NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.tax_audit_clause_library_versions (version_no, label, act, form, applies_from_fy, status, notes)
VALUES (1, 'Form 3CD — Income-tax Rules 1962', '1961', '3CD', '2018-19', 'draft',
        'Form 3CD as revised by Notification 33/2018 and amended since, for audits from FY 2018-19.');

CREATE TEMP TABLE tax_audit_clause_seed (
  clause_no text, part text, title text, sub_items jsonb, applies_when jsonb, na text,
  pkg text, grade text, evidence jsonb, draft text, partner boolean
) ON COMMIT DROP;

INSERT INTO tax_audit_clause_seed VALUES
-- Part A
('1','A','Name of the assessee','[{"key":"name","label":"Name","kind":"text"}]',NULL,NULL,
 'general','manager','["PAN card or the client master record"]','client_master',false),
('2','A','Address','[{"key":"address","label":"Address","kind":"text"}]',NULL,NULL,
 'general','manager','["Client master address, checked to a recent bill or registration"]','client_master',false),
('3','A','Permanent Account Number (PAN) or Aadhaar number','[{"key":"pan","label":"PAN or Aadhaar","kind":"text"}]',NULL,NULL,
 'general','manager','["PAN card"]','client_master',false),
('4','A','Liability to pay indirect tax and registration numbers',
 '[{"key":"liable","label":"Liable to pay indirect tax (GST, customs …)","kind":"yes_no"},{"key":"registrations","label":"Type of registration and number","kind":"table"}]',
 NULL,NULL,'general','manager','["GST registration certificates","Other indirect tax registrations"]','client_master',false),
('5','A','Status','[{"key":"status","label":"Status (individual, firm, company …)","kind":"text"}]',NULL,NULL,
 'general','manager','["Constitution document (partnership deed, incorporation certificate)"]','client_master',false),
('6','A','Previous year','[{"key":"from","label":"From","kind":"date"},{"key":"to","label":"To","kind":"date"}]',NULL,NULL,
 'general','manager','[]','client_master',false),
('7','A','Assessment year','[{"key":"ay","label":"Assessment year","kind":"text"}]',NULL,NULL,
 'general','manager','[]','client_master',false),
('8','A','Clause of section 44AB under which the audit is conducted',
 '[{"key":"clause","label":"Relevant clause of s.44AB","kind":"text"}]',NULL,NULL,
 'general','manager','["The year''s applicability decision"]',NULL,true),
('8a','A','Taxation regime opted under s.115BA / 115BAA / 115BAB / 115BAC / 115BAD / 115BAE',
 '[{"key":"opted","label":"Opted for a concessional regime","kind":"yes_no"},{"key":"section","label":"Section","kind":"text"},{"key":"form","label":"Form and date of the option","kind":"text"}]',
 NULL,NULL,'general','manager','["Form 10-IC / 10-ID / 10-IE filing, where filed"]',NULL,true),
-- Part B
('9','B','Partners or members and their profit sharing ratios; changes during the year',
 '[{"key":"a","label":"Names and profit sharing ratios","kind":"table"},{"key":"b","label":"Change in partners or members, or in their ratios","kind":"table"}]',
 '{"fact":"isFirmOrAop","is":true}','The assessee is not a firm, LLP, AOP or BOI.',
 'general','manager','["Partnership deed and any supplementary deed","LLP agreement"]',NULL,false),
('10','B','Nature of business or profession; changes during the year',
 '[{"key":"a","label":"Nature of every business or profession (with code)","kind":"table"},{"key":"b","label":"Change in the nature of business","kind":"text"}]',
 NULL,NULL,'general','manager','[]',NULL,false),
('11','B','Books of account',
 '[{"key":"a","label":"Books prescribed under s.44AA","kind":"text"},{"key":"b","label":"Books maintained and the address where kept","kind":"table"},{"key":"c","label":"Books examined","kind":"text"}]',
 NULL,NULL,'general','manager','["List of books maintained","Accounting software and its location"]',NULL,false),
('12','B','Profits assessable on a presumptive basis included in the profit and loss account',
 '[{"key":"included","label":"Presumptive income included","kind":"yes_no"},{"key":"details","label":"Section and amount","kind":"table"}]',
 '{"fact":"presumptiveIncome","is":true}','No income on a presumptive basis in the year.',
 'general','manager','[]',NULL,false),
('13','B','Method of accounting, changes and ICDS adjustments',
 '[{"key":"a","label":"Method of accounting","kind":"text"},{"key":"b","label":"Change from the previous year","kind":"yes_no"},{"key":"c","label":"Effect of the change on profit","kind":"table"},{"key":"d","label":"Adjustments to conform to ICDS","kind":"table"},{"key":"e","label":"Disclosures required by ICDS","kind":"text"}]',
 NULL,NULL,'accounting_methods','senior','["Accounting policies note","ICDS adjustment working"]',NULL,true),
('14','B','Method of valuation of closing stock',
 '[{"key":"a","label":"Method of valuation","kind":"text"},{"key":"b","label":"Deviation from s.145A and its effect","kind":"table"}]',
 '{"fact":"holdsStock","is":true}','No stock-in-trade or inventory.',
 'stock','senior','["Stock valuation working","Inventory policy"]',NULL,false),
('15','B','Capital asset converted into stock-in-trade',
 '[{"key":"details","label":"Description, date of acquisition and conversion, cost and amount","kind":"table"}]',
 '{"fact":"holdsStock","is":true}','No stock-in-trade, so no capital asset converted into it.',
 'stock','senior','[]',NULL,false),
('16','B','Amounts not credited to the profit and loss account',
 '[{"key":"a","label":"Items under s.28","kind":"table"},{"key":"b","label":"Pro forma credits, drawbacks, refunds of duty or tax","kind":"table"},{"key":"c","label":"Escalation claims accepted","kind":"table"},{"key":"d","label":"Any other item of income","kind":"table"},{"key":"e","label":"Capital receipt, if any","kind":"table"}]',
 NULL,NULL,'general','manager','[]',NULL,false),
('17','B','Land or building transferred for less than the stamp duty value (s.43CA / 50C)',
 '[{"key":"details","label":"Property, consideration and stamp duty value","kind":"table"}]',
 NULL,NULL,'general','manager','["Sale deeds of land or buildings transferred"]',NULL,false),
('18','B','Depreciation allowable under the Income-tax Act',
 '[{"key":"blocks","label":"By block: rate, opening WDV, additions, deductions, depreciation, closing WDV","kind":"table"}]',
 NULL,NULL,'depreciation','article','["Income-tax depreciation schedule","Purchase bills for additions","Put-to-use dates"]','last_year',false),
('19','B','Amounts admissible under s.32AC, 33AB, 33ABA, 35, 35ABA, 35ABB, 35AD, 35CCA … 35E',
 '[{"key":"details","label":"Section, amount debited and amount admissible","kind":"table"}]',
 NULL,NULL,'general','manager','[]',NULL,false),
('20','B','Bonus or commission to employees; employees'' contributions to PF and other funds',
 '[{"key":"a","label":"Bonus or commission paid (s.36(1)(ii))","kind":"amount"},{"key":"b","label":"Employees'' contributions: due date and date paid","kind":"table"}]',
 NULL,NULL,'statutory_payments','article','["PF and ESI challans","Salary register"]',NULL,false),
('21(a)','B','Capital, personal, political advertisement and penalty expenditure debited',
 '[{"key":"items","label":"Nature and amount","kind":"table"}]',
 NULL,NULL,'inadmissible','senior','["Expense ledgers"]',NULL,false),
('21(b)','B','Amounts inadmissible under s.40(a)',
 '[{"key":"items","label":"Payments without TDS or with TDS not paid, and other s.40(a) items","kind":"table"}]',
 NULL,NULL,'inadmissible','senior','["TDS working","Challans"]',NULL,false),
('21(c)','B','Interest, salary, bonus, commission or remuneration to partners (s.40(b) / 40(ba))',
 '[{"key":"items","label":"Partner, nature and amount; amount inadmissible","kind":"table"}]',
 '{"fact":"isFirmOrAop","is":true}','The assessee is not a firm, LLP, AOP or BOI.',
 'inadmissible','senior','["Partners'' current accounts","Partnership deed remuneration clause"]',NULL,false),
('21(d)','B','Payments otherwise than by account payee cheque, draft or bank transfer (s.40A(3) / 40A(3A))',
 '[{"key":"payments","label":"Date, payee, nature and amount","kind":"table"}]',
 NULL,NULL,'cash_payments','article','["Cash book","Cash vouchers over ₹10,000"]',NULL,false),
('21(e)','B','Provision for gratuity not allowable (s.40A(7))',
 '[{"key":"amount","label":"Amount","kind":"amount"}]',NULL,NULL,'inadmissible','senior','["Actuarial report"]',NULL,false),
('21(f)','B','Sums paid towards a fund or trust not allowable (s.40A(9))',
 '[{"key":"amount","label":"Amount","kind":"amount"}]',NULL,NULL,'inadmissible','senior','[]',NULL,false),
('21(g)','B','Contingent liabilities','[{"key":"items","label":"Nature and amount","kind":"table"}]',NULL,NULL,
 'inadmissible','senior','["Provisions schedule"]',NULL,false),
('21(h)','B','Expenditure on exempt income not allowable (s.14A)',
 '[{"key":"amount","label":"Amount","kind":"amount"}]',NULL,NULL,'inadmissible','senior','["Exempt income and Rule 8D working"]',NULL,false),
('21(i)','B','Interest inadmissible under the proviso to s.36(1)(iii)',
 '[{"key":"amount","label":"Amount","kind":"amount"}]',NULL,NULL,'inadmissible','senior','["Borrowings and capital work in progress"]',NULL,false),
('22','B','Interest inadmissible under s.23 of the MSMED Act 2006',
 '[{"key":"amount","label":"Amount of interest","kind":"amount"}]',
 NULL,NULL,'msme','senior','["MSME supplier list","Ageing of MSME creditors"]','msme_list',false),
('23','B','Payments to persons specified in s.40A(2)(b)',
 '[{"key":"items","label":"Person, relation, nature and amount","kind":"table"}]',
 NULL,NULL,'general','manager','["Related party list"]',NULL,true),
('24','B','Amounts deemed to be profits under s.32AC, 33AB, 33ABA or 33AC',
 '[{"key":"items","label":"Section and amount","kind":"table"}]',NULL,NULL,'general','manager','[]',NULL,false),
('25','B','Profit chargeable to tax under s.41','[{"key":"items","label":"Name, nature, amount and assessment year","kind":"table"}]',
 NULL,NULL,'general','manager','["Written-back liabilities ledger"]',NULL,false),
('26','B','Sums referred to in s.43B — liabilities paid and unpaid',
 '[{"key":"pre_existing","label":"Pre-existing on the first day: paid or not paid in the year","kind":"table"},{"key":"incurred","label":"Incurred in the year: paid by the due date of the return, or not","kind":"table"},{"key":"in_pl","label":"Whether passed through the profit and loss account","kind":"yes_no"}]',
 NULL,NULL,'statutory_payments','article','["GST, TDS, PF and ESI challans","Bonus, leave encashment and interest paid dates","MSME payments over 45 days (s.43B(h))"]','msme_list',false),
('27','B','Input tax credit and prior period items',
 '[{"key":"a","label":"Input tax credit: availed, utilised and its treatment","kind":"table"},{"key":"b","label":"Prior period income and expenditure","kind":"table"}]',
 NULL,NULL,'gst_breakup','article','["GSTR-3B and GSTR-2B","Electronic credit ledger"]','gst_filings',false),
('28','B','Shares of a company received for inadequate consideration (s.56(2)(viia))',
 '[{"key":"items","label":"Company, number of shares, consideration and value","kind":"table"}]',
 '{"any":[{"fact":"isFirmOrAop","is":true},{"fact":"closelyHeldCompany","is":true}]}',
 'The assessee is neither a firm nor a closely held company.','general','manager','[]',NULL,false),
('29','B','Consideration for issue of shares over the fair market value (s.56(2)(viib))',
 '[{"key":"items","label":"Name, number of shares, consideration and fair market value","kind":"table"}]',
 '{"fact":"closelyHeldCompany","is":true}','The assessee is not a closely held company.',
 'general','manager','["Share allotment records","Valuation report"]',NULL,false),
('29A','B','Income under s.56(2)(ix) — advance forfeited on a capital asset',
 '[{"key":"items","label":"Nature and amount","kind":"table"}]',NULL,NULL,'general','manager','[]',NULL,false),
('29B','B','Income under s.56(2)(x) — property received without or for inadequate consideration',
 '[{"key":"items","label":"Nature and amount","kind":"table"}]',NULL,NULL,'general','manager','[]',NULL,false),
('30','B','Amount borrowed on a hundi or repaid otherwise than by account payee cheque (s.69D)',
 '[{"key":"items","label":"Name, PAN, amount and dates","kind":"table"}]',NULL,NULL,'loans_deposits','article','[]',NULL,false),
('30A','B','Primary and secondary adjustment to the transfer price (s.92CE)',
 '[{"key":"items","label":"Adjustment, section and repatriation","kind":"table"}]',
 '{"fact":"internationalTransactions","is":true}','No international or specified domestic transactions.',
 'general','manager','["Form 3CEB"]',NULL,true),
('30B','B','Interest beyond the limit under s.94B',
 '[{"key":"items","label":"Interest, EBITDA and amount exceeding the limit","kind":"table"}]',
 '{"fact":"internationalTransactions","is":true}','No borrowing from an associated enterprise abroad.',
 'general','manager','[]',NULL,true),
('30C','B','Impermissible avoidance arrangement (s.96)',
 '[{"key":"entered","label":"Entered into an impermissible avoidance arrangement","kind":"yes_no"},{"key":"details","label":"Nature, value and tax benefit","kind":"table"}]',
 NULL,NULL,'general','manager','[]',NULL,true),
('31','B','Loans, deposits and specified sums taken or repaid (s.269SS / 269ST / 269T)',
 '[{"key":"a","label":"Loans or deposits accepted","kind":"table"},{"key":"b","label":"Specified sums accepted","kind":"table"},{"key":"ba","label":"Receipts of ₹2 lakh or more otherwise than by banking channel","kind":"table"},{"key":"bb","label":"Payments of ₹2 lakh or more otherwise than by banking channel","kind":"table"},{"key":"c","label":"Loans or deposits repaid","kind":"table"},{"key":"d","label":"Repayments received otherwise than by account payee cheque","kind":"table"},{"key":"e","label":"Repayments made otherwise than by account payee cheque","kind":"table"}]',
 '{"fact":"loansOrDeposits","is":true}','No loans, deposits or specified sums taken or repaid in the year.',
 'loans_deposits','article','["Loan ledgers","Loan confirmations","Bank statements for the receipts and repayments"]',NULL,false),
('32','B','Losses and depreciation brought forward; change in shareholding; speculation losses',
 '[{"key":"a","label":"Brought forward loss or depreciation, by year","kind":"table"},{"key":"b","label":"Change in shareholding (s.79)","kind":"text"},{"key":"c","label":"Speculation loss (s.73)","kind":"amount"},{"key":"d","label":"Loss in a specified business (s.73A)","kind":"amount"},{"key":"e","label":"Business deemed speculation (Explanation to s.73)","kind":"text"}]',
 '{"fact":"broughtForwardLosses","is":true}','No losses or depreciation brought forward.',
 'losses','senior','["Last year''s ITR loss schedule","Assessment orders"]','last_year',false),
('33','B','Deductions under Chapter VI-A or Chapter III (s.10A, 10AA)',
 '[{"key":"items","label":"Section and amount admissible","kind":"table"}]',NULL,NULL,'general','manager','[]',NULL,false),
('34','B','TDS and TCS compliance',
 '[{"key":"a","label":"Tax deducted or collected: section, nature, amount, short or not deducted","kind":"table"},{"key":"b","label":"Statements furnished within time","kind":"table"},{"key":"c","label":"Interest under s.201(1A) / 206C(7)","kind":"table"}]',
 NULL,NULL,'tds_tcs','article','["TDS and TCS returns","Challans","TRACES default summary"]','tds_filings',false),
('35(a)','B','Quantitative details of principal goods traded',
 '[{"key":"items","label":"Item, unit, opening, purchases, sales, closing, shortage","kind":"table"}]',
 '{"fact":"tradesGoods","is":true}','The assessee does not trade in goods.',
 'stock','senior','["Stock register"]',NULL,false),
('35(b)','B','Quantitative details of raw materials, finished products and by-products',
 '[{"key":"raw","label":"Raw materials","kind":"table"},{"key":"finished","label":"Finished products and by-products","kind":"table"}]',
 '{"fact":"manufactures","is":true}','The assessee does not manufacture or process goods.',
 'stock','senior','["Production and consumption records"]',NULL,false),
('36','B','Tax on distributed profits (s.115-O)',
 '[{"key":"items","label":"Dividend, tax and date of payment","kind":"table"}]',
 '{"fact":"isCompany","is":true}','The assessee is not a company.',
 'general','manager','[]',NULL,false),
('36A','B','Amount received as deemed dividend (s.2(22)(e))',
 '[{"key":"items","label":"Amount and date","kind":"table"}]',NULL,NULL,'general','manager','[]',NULL,false),
('37','B','Cost audit carried out','[{"key":"done","label":"Cost audit carried out","kind":"yes_no"},{"key":"details","label":"Disqualifications or disagreements","kind":"text"}]',
 NULL,NULL,'general','manager','["Cost audit report, where one was done"]',NULL,false),
('38','B','Audit under the Central Excise Act 1944','[{"key":"done","label":"Audit carried out","kind":"yes_no"},{"key":"details","label":"Disqualifications or disagreements","kind":"text"}]',
 NULL,NULL,'general','manager','[]',NULL,false),
('39','B','Audit under s.72A of the Finance Act 1994 (service tax)','[{"key":"done","label":"Audit carried out","kind":"yes_no"},{"key":"details","label":"Disqualifications or disagreements","kind":"text"}]',
 NULL,NULL,'general','manager','[]',NULL,false),
('40','B','Accounting ratios — turnover, gross profit, net profit, stock-in-trade, material consumed',
 '[{"key":"ratios","label":"This year and the previous year","kind":"table"}]',
 NULL,NULL,'ratios','senior','["Financial statements for both years"]','last_year',false),
('41','B','Demands raised or refunds issued under other tax laws',
 '[{"key":"items","label":"Law, type, date, amount and remarks","kind":"table"}]',NULL,NULL,'general','manager','["Orders and intimations received"]',NULL,false),
('42','B','Form 61, 61A and 61B furnished',
 '[{"key":"items","label":"Form, due date, date furnished, and whether complete","kind":"table"}]',NULL,NULL,'general','manager','[]',NULL,false),
('43','B','Country-by-country report (s.286)',
 '[{"key":"required","label":"Report required","kind":"yes_no"},{"key":"details","label":"Parent entity and date furnished","kind":"table"}]',
 '{"fact":"internationalTransactions","is":true}','The assessee is not part of an international group.',
 'general','manager','[]',NULL,false),
('44','B','Break-up of total expenditure — GST registered and unregistered suppliers',
 '[{"key":"breakup","label":"Total; exempt or nil rated; composition; other registered; unregistered","kind":"table"}]',
 NULL,NULL,'gst_breakup','article','["Purchase register","GSTR-2B"]','gst_filings',false);

INSERT INTO hsdg.tax_audit_clause_library
  (library_version_id, clause_no, part, title, sub_items, applies_when, not_applicable_reason,
   default_package, default_grade, evidence, draft_source, partner_review, sort_order)
SELECT v.id, s.clause_no, s.part, s.title, s.sub_items, s.applies_when, s.na,
       s.pkg, s.grade, s.evidence, s.draft, s.partner,
       (row_number() OVER (ORDER BY
         (substring(s.clause_no FROM '^[0-9]+'))::int,
         substring(s.clause_no FROM '^[0-9]+([A-Za-z]?)'),
         s.clause_no)) * 10
  FROM tax_audit_clause_seed s
 CROSS JOIN hsdg.tax_audit_clause_library_versions v
 WHERE v.version_no = 1;

UPDATE hsdg.tax_audit_clause_library_versions
   SET status = 'published', published_at = now()
 WHERE version_no = 1;

ALTER TABLE hsdg.tax_audit_clause_library_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audit_clause_library FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE hsdg.tax_audit_clause_library;
DROP TABLE hsdg.tax_audit_clause_library_versions;
DROP FUNCTION hsdg.tax_audit_library_clause_immutable();
DROP FUNCTION hsdg.tax_audit_library_version_immutable();
