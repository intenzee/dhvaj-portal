-- Up Migration
-- 02.2 Financial Reporting Framework — the Provision Library behind every
-- View Provision / View Standard action of 02.2 (DHVAJ 02.2 spec §20, acceptance
-- test 11), plus the SMC exemptions/relaxations the AS review methodology
-- applies (spec §16, §19 "AS + SMC").
--
--   • New provisions: the Companies (Accounting Standards) Rules, 2021, the
--     Section 2(57) net-worth definition and the current MCA-notified Ind AS.
--     The Rule-4 sub-provisions and the 2021/2006 SMC definitions are created
--     by 1766800000000 (their rule versions cite them) — here they only get
--     their source links.
--   • Source links, pinned to each row's effective_from (a later version gets
--     its own link when it supersedes the row):
--       – MCA "Indian Accounting Standards" page (G.S.R. 111(E) of 16-Feb-2015
--         and every amendment) for Rule 4 and the current Ind AS;
--       – MCA's consolidated text of Ind AS 101;
--       – MCA's G.S.R. 432(E) of 23-Jun-2021 for the 2021 AS Rules / SMC;
--       – MCA's accounting-standards notifications page for the 2006 Rules;
--       – India Code (Companies Act, 2013) for Section 2(57).
--     Rows whose link an administrator already set are left alone.
--   • authority_reference_link rows for context '02.2' (the §20 labels and the
--     View Rule 4 / 4(1)(i) / proviso / 4(2A) / Ind AS 101 links of §6–§17).
--   • hsdg.as_smc_relaxation — the SMC exemptions/relaxations, effective-dated
--     methodology data (never code), per ICAI's Appendix I to the Compendium of
--     Accounting Standards.

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to,
   source_reference, reference_kind, summary)
VALUES
  ('AS_RULES_2021', 'MCA', 'Companies (Accounting Standards) Rules, 2021', 'AS Rules 2021',
   '2021-04-01', NULL,
   'Companies (Accounting Standards) Rules 2021 (G.S.R. 432(E), 23 June 2021)', 'provision',
   'Specify Accounting Standards 1 to 5, 7 and 9 to 29 (as recommended by ICAI) for companies '
   || 'to which the Companies (Indian Accounting Standards) Rules, 2015 do not apply, for '
   || 'accounting periods commencing on or after 1 April 2021, in supersession of the 2006 '
   || 'Rules. Rule 2(1)(e) defines a Small and Medium Sized Company (SMC); the Annexure sets out '
   || 'the exemptions and relaxations an SMC may apply.'),
  ('COS_ACT_2_57', 'MCA', 'Net worth definition', 'Section 2(57)',
   '2013-09-12', NULL,
   'Companies Act 2013, s.2(57)', 'provision',
   'Net worth means the aggregate value of the paid-up share capital and all reserves created '
   || 'out of the profits, securities premium account and debit or credit balance of profit and '
   || 'loss account, after deducting the aggregate value of the accumulated losses, deferred '
   || 'expenditure and miscellaneous expenditure not written off, as per the audited balance '
   || 'sheet, but does not include reserves created out of revaluation of assets, write-back of '
   || 'depreciation and amalgamation. Rule 2(1)(f) of the Ind AS Rules 2015 adopts this meaning '
   || 'for the Rule 4 roadmap.'),
  ('INDAS_COMPENDIUM', 'MCA', 'Indian Accounting Standards — current MCA-notified set', 'Ind AS',
   '2015-04-01', NULL,
   'Companies (Indian Accounting Standards) Rules 2015, Annexure, as amended', 'standard',
   'The Indian Accounting Standards notified by the Ministry of Corporate Affairs under section '
   || '133 of the Companies Act, 2013, as amended from time to time, read with the ICAI '
   || 'authoritative compendium. The library row of each standard (Ind AS 1 … 116) carries its '
   || 'own effective date.')
ON CONFLICT (code) DO NOTHING;

UPDATE hsdg.authority_provision p
   SET source_url = v.url
  FROM (VALUES
    ('INDAS_RULE_4',         DATE '2015-04-01', 'https://www.mca.gov.in/MinistryV2/Stand.html'),
    ('INDAS_RULE_4_1_I',     DATE '2015-04-01', 'https://www.mca.gov.in/MinistryV2/Stand.html'),
    ('INDAS_RULE_4_PROVISO', DATE '2015-04-01', 'https://www.mca.gov.in/MinistryV2/Stand.html'),
    ('INDAS_RULE_4_2A',      DATE '2016-03-30', 'https://www.mca.gov.in/MinistryV2/Stand.html'),
    ('INDAS_COMPENDIUM',     DATE '2015-04-01', 'https://www.mca.gov.in/MinistryV2/Stand.html'),
    ('INDAS_101',            DATE '2015-04-01', 'https://www.mca.gov.in/Ministry/pdf/IndAS101_2020_10112020.pdf'),
    ('AS_RULES_2021',        DATE '2021-04-01', 'https://www.mca.gov.in/bin/ebook/dms/getdocument?doc=MjA0NzM%3D&docCategory=NotificationsAndCirculars&type=download'),
    ('AS_RULES_2021_SMC',    DATE '2021-04-01', 'https://www.mca.gov.in/bin/ebook/dms/getdocument?doc=MjA0NzM%3D&docCategory=NotificationsAndCirculars&type=download'),
    ('AS_RULES_2006_SMC',    DATE '2006-12-07', 'https://www.mca.gov.in/Ministry/notification/notification_comp_Acct.html'),
    ('COS_ACT_2_57',         DATE '2013-09-12', 'https://www.indiacode.nic.in/handle/123456789/2114')
  ) AS v(code, effective_from, url)
 WHERE p.code = v.code
   AND p.effective_from = v.effective_from
   AND p.source_url IS NULL;

-- Viewer summaries for the two existing rows 02.2 cites (left alone when an
-- administrator already wrote one).
UPDATE hsdg.authority_provision p
   SET summary = v.summary
  FROM (VALUES
    ('INDAS_RULE_4',
     'Rule 4 of the Companies (Indian Accounting Standards) Rules, 2015 sets the Ind AS roadmap: '
     || 'voluntary adoption (4(1)(i)); mandatory phases by listing status and net worth for '
     || 'ordinary companies (4(1)(ii)–(iii)) and NBFCs (4(1)(iv)); the holding / subsidiary / '
     || 'joint venture / associate extension; the SME-exchange proviso; and the net-worth '
     || 'measurement mechanics (4(2)), including when a company first meeting a threshold starts '
     || 'applying Ind AS. Once Ind AS applies it applies to all later periods. The thresholds and '
     || 'dates DHVAJ applies are held, effective-dated, in the Audit Rules Library.'),
    ('INDAS_101',
     'Ind AS 101 sets the procedures an entity follows when it adopts Ind AS for the first time: '
     || 'the opening Ind AS balance sheet at the date of transition, the mandatory exceptions and '
     || 'optional exemptions from retrospective application, and the reconciliations of equity '
     || 'and total comprehensive income from previous GAAP that the first Ind AS financial '
     || 'statements disclose.')
  ) AS v(code, summary)
 WHERE p.code = v.code AND p.summary IS NULL;

UPDATE hsdg.authority_provision SET reference_kind = 'standard'
 WHERE code = 'INDAS_101' AND reference_kind = 'provision';

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- ── 02.2 references (resolved through the library, never hard-coded) ─────────
-- Anchors may carry digits (rule_4_1_i, indas_101); still lowercase keys.
ALTER TABLE hsdg.authority_reference_link
  DROP CONSTRAINT authority_reference_link_anchor_check,
  ADD CONSTRAINT authority_reference_link_anchor_check CHECK (anchor ~ '^[a-z][a-z0-9_]*$');
-- FORCE RLS would reject the migrator's insert (no firm-wide context).
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('02.2', 'indas_applicability', 'View Ind AS Applicability Provision', 'INDAS_RULE_4',          10),
  ('02.2', 'rule_4',              'View Rule 4',                         'INDAS_RULE_4',          20),
  ('02.2', 'rule_4_1_i',          'View Rule 4(1)(i) - Voluntary Adoption', 'INDAS_RULE_4_1_I',   30),
  ('02.2', 'rule_4_proviso',      'View Rule 4 proviso - SME Exchange',  'INDAS_RULE_4_PROVISO',  40),
  ('02.2', 'rule_4_nbfc',         'View Rule 4(1)(iv) - NBFC Roadmap',   'INDAS_RULE_4_2A',       50),
  ('02.2', 'group_applicability', 'View Group Applicability Provision',  'INDAS_RULE_4',          60),
  ('02.2', 'net_worth',           'View Net Worth Definition',           'COS_ACT_2_57',          70),
  ('02.2', 'current_indas',       'View Current Ind AS',                 'INDAS_COMPENDIUM',      80),
  ('02.2', 'as_rules',            'View AS Rules',                       'AS_RULES_2021',         90),
  ('02.2', 'smc_definition',      'View SMC Definition',                 'AS_RULES_2021_SMC',    100),
  ('02.2', 'indas_101',           'View Ind AS 101',                     'INDAS_101',            110)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- ── SMC exemptions / relaxations (AS review methodology data) ─────────────────
-- One row per relaxation, effective-dated like every rule: the AS review
-- marks these items for an SMC (spec §19). An administrator supersedes a row
-- by closing effective_to and adding the new wording — history never changes.
CREATE TABLE hsdg.as_smc_relaxation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relaxation_key        text NOT NULL CHECK (relaxation_key ~ '^[a-z0-9_]{2,60}$'),
  standard_code         text NOT NULL CHECK (standard_code ~ '^[A-Z0-9_]{2,60}$'),
  standard_label        text NOT NULL CHECK (length(trim(standard_label)) > 0),
  kind                  text NOT NULL CHECK (kind IN ('not_applicable','relaxation','disclosure_exemption')),
  paragraphs            text,
  relaxation            text NOT NULL CHECK (length(trim(relaxation)) > 0),
  provision_code        text NOT NULL CHECK (provision_code ~ '^[A-Z0-9_]{2,60}$'),
  source_reference      text,
  effective_from        date NOT NULL,
  effective_to          date,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (relaxation_key, effective_from)
);
CREATE TRIGGER as_smc_relaxation_set_updated_at
  BEFORE UPDATE ON hsdg.as_smc_relaxation
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

INSERT INTO hsdg.as_smc_relaxation
  (relaxation_key, standard_code, standard_label, kind, paragraphs, relaxation,
   provision_code, source_reference, effective_from, effective_to, sort_order)
VALUES
  ('as17_segment', 'AS_17', 'AS 17 Segment Reporting', 'not_applicable', NULL,
   'AS 17 does not apply to an SMC — no segment information is required.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 10),
  ('as15_compensated_absences', 'AS_15', 'AS 15 Employee Benefits', 'relaxation', '11–16',
   'Recognition and measurement of short-term accumulating compensated absences that are non-vesting need not follow paragraphs 11–16.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 20),
  ('as15_discounting', 'AS_15', 'AS 15 Employee Benefits', 'relaxation', '46, 139',
   'Amounts falling due more than 12 months after the balance sheet date need not be discounted.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 30),
  ('as15_defined_benefit', 'AS_15', 'AS 15 Employee Benefits', 'relaxation', '50–116, 117–123',
   'Defined benefit plans: the full recognition, measurement, presentation and disclosure paragraphs do not apply, but the accrued liability is still provided using the Projected Unit Credit Method with a discount rate by reference to government bond yields (para 78), and the actuarial assumptions are disclosed (para 120(l)).',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 40),
  ('as15_other_long_term', 'AS_15', 'AS 15 Employee Benefits', 'relaxation', '129–131',
   'Other long-term employee benefits: the paragraphs do not apply, but the liability is still measured using the Projected Unit Credit Method with the government-bond discount rate.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 50),
  ('as19_disclosures', 'AS_19', 'AS 19 Leases', 'disclosure_exemption', '22(c),(e),(f); 25(a),(b),(e); 37(a),(f); 46(b),(d)',
   'The listed lease disclosures are not required of an SMC.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 60),
  ('as20_diluted_eps', 'AS_20', 'AS 20 Earnings Per Share', 'disclosure_exemption', NULL,
   'Diluted earnings per share (both including and excluding extraordinary items) need not be disclosed.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 70),
  ('as28_value_in_use', 'AS_28', 'AS 28 Impairment of Assets', 'relaxation', '121(g)',
   'Value in use may be measured on a reasonable estimate instead of the present value technique; if so, the discount-rate requirements and the paragraph 121(g) disclosure do not apply.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 80),
  ('as29_disclosures', 'AS_29', 'AS 29 Provisions, Contingent Liabilities and Contingent Assets', 'disclosure_exemption', '66, 67',
   'The disclosures in paragraphs 66 and 67 are not required of an SMC.',
   'AS_RULES_2021_SMC', 'ICAI Compendium of Accounting Standards, Appendix I', '2021-04-01', NULL, 90);

REVOKE DELETE ON hsdg.as_smc_relaxation FROM hsdg_app;
ALTER TABLE hsdg.as_smc_relaxation ENABLE ROW LEVEL SECURITY;
CREATE POLICY as_smc_relaxation_read ON hsdg.as_smc_relaxation
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY as_smc_relaxation_write ON hsdg.as_smc_relaxation
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
ALTER TABLE hsdg.as_smc_relaxation FORCE ROW LEVEL SECURITY;

-- Down Migration
DROP TABLE IF EXISTS hsdg.as_smc_relaxation CASCADE;

ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '02.2';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_reference_link
  DROP CONSTRAINT authority_reference_link_anchor_check,
  ADD CONSTRAINT authority_reference_link_anchor_check CHECK (anchor ~ '^[a-z_]+$');

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.authority_provision
   SET source_url = NULL
 WHERE code IN ('INDAS_RULE_4','INDAS_RULE_4_1_I','INDAS_RULE_4_PROVISO','INDAS_RULE_4_2A',
                'INDAS_101','AS_RULES_2021_SMC','AS_RULES_2006_SMC')
   AND source_url IN (
     'https://www.mca.gov.in/MinistryV2/Stand.html',
     'https://www.mca.gov.in/Ministry/pdf/IndAS101_2020_10112020.pdf',
     'https://www.mca.gov.in/bin/ebook/dms/getdocument?doc=MjA0NzM%3D&docCategory=NotificationsAndCirculars&type=download',
     'https://www.mca.gov.in/Ministry/notification/notification_comp_Acct.html');
DELETE FROM hsdg.authority_provision
 WHERE code IN ('AS_RULES_2021','COS_ACT_2_57','INDAS_COMPENDIUM');
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
