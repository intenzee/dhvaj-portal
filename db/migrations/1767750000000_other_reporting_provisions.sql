-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.7 Other Companies Act Reporting — the Provision Library behind every 02.7
-- "View …" action (DHVAJ Section 02.7 spec §18; build split Track B).
-- References resolve centrally by engagement period — no URL lives in a
-- component.
--
--   • New provisions: §128(5), §123, §124–125 (IEPF), §196, Form ADT-4, and the
--     ICAI guidance the 02.7 cards cite (Rule 11(e)/(f) implementation guide,
--     Rule 11(g) audit-trail implementation guide, §197(16) advisory).
--   • AUDIT_RULE_11 (seeded 1763000000000) — version check: split into
--       v1 as notified (clauses (a)–(c));
--       v2 with clause (d) Specified Bank Notes inserted by G.S.R. 307(E)
--          (30 March 2017);
--       v3 from 1 April 2021 — clause (d) omitted and clauses (e), (f), (g)
--          inserted by the Companies (Audit and Auditors) Amendment Rules 2021
--          (G.S.R. 206(E), 24 March 2021); clause (g) applies for financial
--          years commencing on or after 1 April 2023 (AUDIT_RULE_11G).
--   • AUDIT_RULE_13 (seeded 1763000000000) — version check: split into
--       v1 as notified (every fraud reported to the Central Government);
--       v2 from 14 December 2015 — the ₹1 crore route of the Companies (Audit
--          and Auditors) Amendment Rules 2015: below the threshold the auditor
--          reports to the Audit Committee / Board within 2 days.
--     Every version keeps its code; exactly one row per code stays open
--     (effective_to IS NULL). Rule versions citing v1 keep citing v1.
--   • Viewer summaries for §143(3), §143(12), §164(2), §197, §197(16), §198 and
--     Schedule V where none is held yet.
--   • authority_reference_link rows for context '02.7' (every anchor in
--     OTHER_REPORTING_REFERENCE_ANCHOR).
--
-- FORCE RLS on the provision / reference tables is lifted for the seed and
-- restored after (no request context in a migration).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

-- ── New provisions ──────────────────────────────────────────────────────────
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary)
VALUES
  ('COS_ACT_128_5', 'MCA', 'Preservation of books of account', 'Section 128(5)',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, s.128(5)', 'provision', NULL,
   'The books of account of every company relating to a period of not less than eight financial '
   || 'years immediately preceding a financial year, together with the vouchers relevant to any '
   || 'entry in them, are preserved in good order. Rule 11(g) reporting reads with this: the audit '
   || 'trail is preserved as statutorily required for record retention.'),
  ('COS_ACT_123', 'MCA', 'Declaration of dividend', 'Section 123',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, s.123', 'provision', NULL,
   'Dividend is declared or paid only out of the profits of the year (after depreciation), or '
   || 'of previous years, or both, or out of money provided by the Government under a guarantee; '
   || 'interim dividend may be declared by the Board within the limits of the section; dividend '
   || 'is deposited in a separate bank account within five days of declaration and paid in cash '
   || 'only to the registered shareholder or to its order or banker. Rule 11(f) asks whether '
   || 'dividend declared or paid during the year complies with section 123.'),
  ('COS_ACT_124_125', 'MCA', 'Unpaid dividend account and Investor Education and Protection Fund',
   'Sections 124–125',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, ss.124–125 r/w the IEPF Authority (Accounting, Audit, Transfer and '
   || 'Refund) Rules 2016', 'provision', NULL,
   'Dividend unpaid or unclaimed within thirty days of declaration is transferred to an Unpaid '
   || 'Dividend Account; amounts remaining unpaid or unclaimed for seven years, and the shares on '
   || 'which dividend has been unclaimed for seven consecutive years, are transferred to the '
   || 'Investor Education and Protection Fund. Rule 11(c) asks whether there has been any delay in '
   || 'transferring amounts required to be transferred to the Fund.'),
  ('COS_ACT_196', 'MCA', 'Appointment of managing director, whole-time director or manager',
   'Section 196',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, s.196 r/w Schedule V', 'provision', NULL,
   'A company does not appoint or employ at the same time a managing director and a manager; '
   || 'appointment is for a term of not more than five years at a time, subject to the age and '
   || 'eligibility conditions in the section and Part I of Schedule V, and the terms and '
   || 'remuneration are approved by the Board and the general meeting (and the Central Government '
   || 'where Schedule V is not met).'),
  ('FORM_ADT_4', 'MCA', 'Report to the Central Government on fraud', 'Form ADT-4',
   '2014-04-01', NULL, 1,
   'Companies (Audit and Auditors) Rules 2014, Rule 13 — Form ADT-4', 'provision', NULL,
   'The form in which the auditor reports a fraud reportable to the Central Government under '
   || 'section 143(12): sent to the Secretary, Ministry of Corporate Affairs, in a sealed cover by '
   || 'registered post with acknowledgement due or by speed post, followed by an e-mail in '
   || 'confirmation, on the letterhead of the auditor, signed and stating the auditor''s '
   || 'membership number. It carries the nature of the fraud, the amount involved, the parties '
   || 'involved, and the reply or observations of the Board or Audit Committee (or a note that '
   || 'none was received).'),
  ('ICAI_IG_RULE_11', 'ICAI',
   'Implementation guide on reporting under Rule 11(e) and Rule 11(f)',
   'Implementation Guide (Rule 11(e) and 11(f))', '2021-04-01', NULL, 1,
   'ICAI — Implementation Guide on Reporting under Rule 11(e) and Rule 11(f) of the Companies '
   || '(Audit and Auditors) Rules 2014 (current authoritative version)', 'guidance', NULL,
   'ICAI guidance on the auditor''s comments on management''s representations about funds '
   || 'advanced or loaned to, or received from, intermediaries and funding parties with the '
   || 'understanding that they will lend or invest in ultimate beneficiaries (Rule 11(e)(i) and '
   || '(ii)), the procedures that support the Rule 11(e)(iii) statement that nothing has caused '
   || 'the auditor to believe the representations contain material misstatement, and dividend '
   || 'compliance with section 123 (Rule 11(f)).'),
  ('ICAI_IG_AUDIT_TRAIL', 'ICAI',
   'Implementation guide on reporting on audit trail under Rule 11(g)',
   'Implementation Guide (Rule 11(g))', '2023-04-01', NULL, 1,
   'ICAI — Implementation Guide on Reporting under Rule 11(g) of the Companies (Audit and '
   || 'Auditors) Rules 2014 (current authoritative version)', 'guidance', NULL,
   'ICAI guidance on reporting whether the accounting software used for maintaining books of '
   || 'account has an audit trail (edit log) feature, whether it was operated throughout the '
   || 'year for all relevant transactions, whether it was tampered with, and whether it has been '
   || 'preserved as statutorily required — including software hosted by service providers, '
   || 'database-level changes and the evidence the auditor obtains for each limb.'),
  ('ICAI_ADVISORY_197_16', 'ICAI',
   'Advisory on the auditor''s reporting under section 197(16)',
   'ICAI advisory — section 197(16)', '2014-04-01', NULL, 1,
   'ICAI — advisory / announcement on reporting under section 197(16) of the Companies Act 2013 '
   || '(current authoritative version)', 'guidance', NULL,
   'ICAI guidance on the statement the auditor makes under section 197(16): whether the '
   || 'remuneration paid by the company to its directors is in accordance with section 197, '
   || 'whether any remuneration paid is in excess of the limit laid down, and other details as '
   || 'may be prescribed. The comment applies to public companies; the computation follows '
   || 'section 198 and the Schedule V limits where profits are inadequate.')
ON CONFLICT (code, version_no) DO NOTHING;

-- ── Rule 11 / Rule 13 — version check (close the open v1, then add later ones)
-- Remember each v1 as it was so the down migration restores it exactly.
CREATE TABLE hsdg.other_reporting_provision_backup (
  code         text PRIMARY KEY,
  effective_to date,
  summary      text,
  change_note  text
);
-- Migration bookkeeping only: no app access.
ALTER TABLE hsdg.other_reporting_provision_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO hsdg.other_reporting_provision_backup (code, effective_to, summary, change_note)
SELECT p.code, p.effective_to, p.summary, p.change_note
  FROM hsdg.authority_provision p
 WHERE p.code IN ('AUDIT_RULE_11', 'AUDIT_RULE_13') AND p.version_no = 1
   AND NOT EXISTS (SELECT 1 FROM hsdg.authority_provision x
                    WHERE x.code = p.code AND x.version_no > 1)
ON CONFLICT (code) DO NOTHING;

UPDATE hsdg.authority_provision
   SET effective_to = '2017-03-29',
       summary = 'The auditor''s report also includes its views and comments on: (a) whether the '
         || 'company has disclosed the impact, if any, of pending litigations on its financial '
         || 'position in its financial statements; (b) whether the company has made provision, as '
         || 'required under any law or accounting standards, for material foreseeable losses, if '
         || 'any, on long-term contracts including derivative contracts; and (c) whether there has '
         || 'been any delay in transferring amounts required to be transferred to the Investor '
         || 'Education and Protection Fund by the company.',
       change_note = 'As notified (Companies (Audit and Auditors) Rules 2014).'
 WHERE code = 'AUDIT_RULE_11' AND version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.other_reporting_provision_backup b WHERE b.code = 'AUDIT_RULE_11');

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary, change_note)
SELECT 'AUDIT_RULE_11', 'MCA', p.title, 'Rule 11', s.effective_from, s.effective_to, s.version_no,
       s.source_reference, 'provision', NULL, s.summary, s.change_note
  FROM hsdg.authority_provision p
  CROSS JOIN (VALUES
    (2, DATE '2017-03-30', DATE '2021-03-31',
     'Companies (Audit and Auditors) Rules 2014, Rule 11, as amended by G.S.R. 307(E) '
     || '(30 March 2017)',
     'Rule 11(a) pending litigations, (b) material foreseeable losses on long-term contracts '
     || 'including derivative contracts, (c) delay in transfers to the Investor Education and '
     || 'Protection Fund, and (d) whether the company has provided requisite disclosures in its '
     || 'financial statements as to holdings as well as dealings in Specified Bank Notes during '
     || 'the period from 8 November 2016 to 30 December 2016, and whether these are in accordance '
     || 'with the books of account maintained by the company.',
     'Clause (d) — Specified Bank Notes — inserted.'),
    (3, DATE '2021-04-01', NULL::date,
     'Companies (Audit and Auditors) Rules 2014, Rule 11, as amended by the Companies (Audit and '
     || 'Auditors) Amendment Rules 2021 (G.S.R. 206(E), 24 March 2021)',
     'Rule 11(a) pending litigations, (b) material foreseeable losses, (c) delay in transfers to '
     || 'the Investor Education and Protection Fund; (e)(i) whether management has represented '
     || 'that, to the best of its knowledge and belief, no funds have been advanced or loaned or '
     || 'invested (from borrowed funds, share premium or any other sources) by the company to or in '
     || 'any intermediary with the understanding that the intermediary will lend or invest in, or '
     || 'provide guarantee or security on behalf of, ultimate beneficiaries; (e)(ii) the same as '
     || 'to funds received from any funding party; (e)(iii) whether, based on audit procedures '
     || 'considered reasonable and appropriate, nothing has come to the auditor''s notice that '
     || 'causes it to believe those representations contain any material misstatement; (f) whether '
     || 'the dividend declared or paid during the year is in compliance with section 123; and (g) '
     || 'whether the company has used accounting software with an audit trail (edit log) facility '
     || 'that operated throughout the year for all relevant transactions, was not tampered with, '
     || 'and was preserved as required — clause (g) for financial years commencing on or after '
     || '1 April 2023.',
     'Clause (d) omitted; clauses (e), (f) and (g) inserted.')
  ) AS s(version_no, effective_from, effective_to, source_reference, summary, change_note)
 WHERE p.code = 'AUDIT_RULE_11' AND p.version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.other_reporting_provision_backup b WHERE b.code = 'AUDIT_RULE_11')
ON CONFLICT (code, version_no) DO NOTHING;

UPDATE hsdg.authority_provision
   SET effective_to = '2015-12-13',
       summary = 'Where the auditor, in the course of performance of its duties, has sufficient '
         || 'reason to believe that an offence involving fraud is being or has been committed '
         || 'against the company by its officers or employees, it reports the matter to the Board '
         || 'or the Audit Committee immediately after coming to knowledge of it, seeking their reply '
         || 'or observations within forty-five days; on receipt of the reply it forwards its report '
         || 'with the reply or observations and its comments to the Central Government within '
         || 'fifteen days; where no reply is received within forty-five days it forwards its report '
         || 'with a note containing the details of the report for which it failed to receive a '
         || 'reply. The report is in Form ADT-4. As notified, every such fraud is reported to the '
         || 'Central Government — there is no amount threshold.',
       change_note = 'As notified (Companies (Audit and Auditors) Rules 2014).'
 WHERE code = 'AUDIT_RULE_13' AND version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.other_reporting_provision_backup b WHERE b.code = 'AUDIT_RULE_13');

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary, change_note)
SELECT 'AUDIT_RULE_13', 'MCA', p.title, 'Rule 13', DATE '2015-12-14', NULL, 2,
       'Companies (Audit and Auditors) Rules 2014, Rule 13, as substituted by the Companies (Audit '
       || 'and Auditors) Amendment Rules 2015 (14 December 2015)',
       'provision', NULL,
       'Fraud involving or expected to involve an amount of rupees one crore or above: the auditor '
       || 'reports to the Board or the Audit Committee immediately but not later than two days of '
       || 'its knowledge, seeking their reply or observations within forty-five days; on receipt '
       || 'of the reply it forwards its report with the reply or observations and its comments to '
       || 'the Central Government within fifteen days of receipt; where no reply is received within '
       || 'forty-five days it forwards its report with a note containing the details of the report '
       || 'for which it failed to receive any reply. The report is in Form ADT-4. Fraud below '
       || 'rupees one crore: the auditor reports to the Audit Committee or the Board within two '
       || 'days of its knowledge, stating the nature of the fraud with description, the approximate '
       || 'amount involved and the parties involved; the Board''s report discloses it.',
       'Amount threshold of ₹1 crore introduced; frauds below it reported to the Audit Committee '
       || '/ Board, not the Central Government.'
  FROM hsdg.authority_provision p
 WHERE p.code = 'AUDIT_RULE_13' AND p.version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.other_reporting_provision_backup b WHERE b.code = 'AUDIT_RULE_13')
ON CONFLICT (code, version_no) DO NOTHING;

UPDATE hsdg.authority_provision v
   SET superseded_by_id = n.id
  FROM hsdg.authority_provision n
 WHERE v.code IN ('AUDIT_RULE_11', 'AUDIT_RULE_13') AND n.code = v.code
   AND n.version_no = v.version_no + 1
   AND v.superseded_by_id IS NULL;

-- ── Viewer summaries (only where none is held) ──────────────────────────────
UPDATE hsdg.authority_provision SET summary = s.summary
  FROM (VALUES
    ('COS_ACT_143_3',
     'The auditor''s report also states: (a) whether it sought and obtained all information and '
     || 'explanations necessary for the audit; (b) whether proper books of account as required by '
     || 'law have been kept and proper returns adequate for the audit received from branches not '
     || 'visited; (c) whether the report on branch accounts audited by another person has been '
     || 'sent and how it has been dealt with; (d) whether the balance sheet and profit and loss '
     || 'account agree with the books and returns; (e) whether the financial statements comply '
     || 'with the accounting standards; (f) observations or comments on financial transactions or '
     || 'matters with any adverse effect on the functioning of the company; (g) whether any '
     || 'director is disqualified under section 164(2); (h) any qualification, reservation or '
     || 'adverse remark relating to the maintenance of accounts; (i) the adequacy and operating '
     || 'effectiveness of internal financial controls; and (j) such other matters as may be '
     || 'prescribed (Rule 11).'),
    ('COS_ACT_143_12',
     'If an auditor of a company, in the course of the performance of its duties as auditor, has '
     || 'reason to believe that an offence of fraud involving such amount or amounts as may be '
     || 'prescribed is being or has been committed in the company by its officers or employees, it '
     || 'reports the matter to the Central Government within the prescribed time and manner; for '
     || 'fraud below the prescribed amount it reports to the Audit Committee or the Board, and the '
     || 'details are disclosed in the Board''s report. The duty extends to cost auditors and '
     || 'secretarial auditors, and to a branch auditor for the branch.'),
    ('COS_ACT_164_2',
     'No person who is or has been a director of a company which (a) has not filed financial '
     || 'statements or annual returns for any continuous period of three financial years, or (b) '
     || 'has failed to repay deposits accepted, or pay interest on them, or redeem debentures on '
     || 'the due date or pay interest due on them, or pay any dividend declared, where the failure '
     || 'continues for one year or more, is eligible to be reappointed a director of that company '
     || 'or appointed in another company for five years from the date of the failure. The auditor '
     || 'reports under section 143(3)(g) on the basis of the written representations received from '
     || 'the directors and taken on record by the Board.'),
    ('COS_ACT_197',
     'Overall maximum managerial remuneration of a public company: total remuneration to its '
     || 'directors, including the managing director and whole-time director, and its manager, is '
     || 'not to exceed eleven per cent. of the net profits computed under section 198, with the '
     || 'individual limits in the section unless approved by the company in general meeting; where '
     || 'profits are absent or inadequate, remuneration is payable only under Schedule V. Excess '
     || 'remuneration is refunded and held in trust until refunded.'),
    ('COS_ACT_197_16',
     'The auditor of the company, in its report under section 143, makes a statement as to '
     || 'whether the remuneration paid by the company to its directors is in accordance with the '
     || 'provisions of section 197, whether any remuneration paid to any director is in excess of '
     || 'the limit laid down under the section, and gives such other details as may be prescribed.'),
    ('COS_ACT_198',
     'Calculation of net profits for the managerial remuneration limits: credit is given for the '
     || 'items in sub-section (2) and not for those in sub-section (3); deductions are made for '
     || 'the items in sub-section (4) and not for those in sub-section (5). Net profits under '
     || 'section 198 are not the profit before tax in the statement of profit and loss.'),
    ('SCH_V',
     'Conditions for the appointment of a managing or whole-time director or manager without '
     || 'Central Government approval (Part I), and the remuneration payable where the company has '
     || 'no profits or its profits are inadequate (Part II), on the effective-capital scale and '
     || 'with the approvals the Schedule sets out.')
  ) AS s(code, summary)
 WHERE hsdg.authority_provision.code = s.code
   AND hsdg.authority_provision.summary IS NULL
   AND hsdg.authority_provision.effective_to IS NULL;

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- ── 02.7 references (spec §18; resolved through the library, period-correct) ─
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('02.7', 'section_143_3',        'View Section 143(3)',                 'COS_ACT_143_3',        10),
  ('02.7', 'rule_11',              'View Rule 11',                        'AUDIT_RULE_11',        20),
  ('02.7', 'rule_11_ef_guidance',  'View Implementation Guide',           'ICAI_IG_RULE_11',      30),
  ('02.7', 'rule_11_g',            'View Rule 11(g)',                     'AUDIT_RULE_11G',       40),
  ('02.7', 'rule_11_g_guidance',   'View Audit Trail Guidance',           'ICAI_IG_AUDIT_TRAIL',  50),
  ('02.7', 'section_128_5',        'View Section 128(5)',                 'COS_ACT_128_5',        60),
  ('02.7', 'section_164_2',        'View Section 164(2)',                 'COS_ACT_164_2',        70),
  ('02.7', 'section_197_16',       'View Section 197(16)',                'COS_ACT_197_16',       80),
  ('02.7', 'section_197',          'View Section 197',                    'COS_ACT_197',          90),
  ('02.7', 'section_198',          'View Section 198',                    'COS_ACT_198',         100),
  ('02.7', 'schedule_v',           'View Schedule V',                     'SCH_V',               110),
  ('02.7', 'section_196',          'View Section 196',                    'COS_ACT_196',         120),
  ('02.7', 'icai_197_16_advisory', 'View ICAI Advisory',                  'ICAI_ADVISORY_197_16', 130),
  ('02.7', 'section_143_12',       'View Section 143(12)',                'COS_ACT_143_12',      140),
  ('02.7', 'rule_13',              'View Rule 13',                        'AUDIT_RULE_13',       150),
  ('02.7', 'form_adt_4',           'View Form ADT-4',                     'FORM_ADT_4',          160),
  ('02.7', 'section_143_8',        'View Section 143(8)',                 'COS_ACT_143_8',       170),
  ('02.7', 'section_123',          'View Section 123',                    'COS_ACT_123',         180),
  ('02.7', 'iepf',                 'View applicable IEPF provisions',     'COS_ACT_124_125',     190)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '02.7';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

-- Anything citing a removed version falls back to v1, or away for new codes.
UPDATE hsdg.audit_rule_version t SET authority_provision_id = f.id
  FROM hsdg.authority_provision p, hsdg.authority_provision f, hsdg.other_reporting_provision_backup b
 WHERE t.authority_provision_id = p.id AND p.code = b.code AND p.version_no > 1
   AND f.code = b.code AND f.version_no = 1;
UPDATE hsdg.audit_framework_subassessment t SET authority_provision_id = f.id
  FROM hsdg.authority_provision p, hsdg.authority_provision f, hsdg.other_reporting_provision_backup b
 WHERE t.authority_provision_id = p.id AND p.code = b.code AND p.version_no > 1
   AND f.code = b.code AND f.version_no = 1;
UPDATE hsdg.audit_rule_version SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision
    WHERE code IN ('COS_ACT_128_5','COS_ACT_123','COS_ACT_124_125','COS_ACT_196','FORM_ADT_4',
                   'ICAI_IG_RULE_11','ICAI_IG_AUDIT_TRAIL','ICAI_ADVISORY_197_16'));
UPDATE hsdg.audit_framework_subassessment SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision
    WHERE code IN ('COS_ACT_128_5','COS_ACT_123','COS_ACT_124_125','COS_ACT_196','FORM_ADT_4',
                   'ICAI_IG_RULE_11','ICAI_IG_AUDIT_TRAIL','ICAI_ADVISORY_197_16'));

UPDATE hsdg.authority_provision SET superseded_by_id = NULL
 WHERE code IN ('COS_ACT_128_5','COS_ACT_123','COS_ACT_124_125','COS_ACT_196','FORM_ADT_4',
                'ICAI_IG_RULE_11','ICAI_IG_AUDIT_TRAIL','ICAI_ADVISORY_197_16')
    OR code IN (SELECT code FROM hsdg.other_reporting_provision_backup);
DELETE FROM hsdg.authority_provision
 WHERE code IN ('COS_ACT_128_5','COS_ACT_123','COS_ACT_124_125','COS_ACT_196','FORM_ADT_4',
                'ICAI_IG_RULE_11','ICAI_IG_AUDIT_TRAIL','ICAI_ADVISORY_197_16');
DELETE FROM hsdg.authority_provision p
 USING hsdg.other_reporting_provision_backup b
 WHERE p.code = b.code AND p.version_no > 1;
UPDATE hsdg.authority_provision p
   SET effective_to = b.effective_to, summary = b.summary, change_note = b.change_note
  FROM hsdg.other_reporting_provision_backup b
 WHERE p.code = b.code AND p.version_no = 1;
DROP TABLE IF EXISTS hsdg.other_reporting_provision_backup;

ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
-- The viewer summaries added above are content only and stay (harmless on re-up).
