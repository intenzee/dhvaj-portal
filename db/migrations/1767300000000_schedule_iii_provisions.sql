-- Up Migration
-- 02.3 Schedule III & Financial Statement Presentation — the Provision Library
-- behind every "View …" action of 02.3 (DHVAJ 02.3 spec §4, §22; acceptance
-- test 12 "every statutory/guidance reference opens through the central
-- Provision Library").
--
--   • New provisions:
--       – COS_ACT_129 — Section 129 (financial statements in the Schedule III
--         form; the second proviso keeps banking / insurance / electricity and
--         other specially governed companies on their own statutory format).
--       – ICAI_GN_SCH_III_DIV_I / _II / _III — the ICAI Guidance Notes on
--         Divisions I, II and III, effective from each Division's commencement
--         so every audit period resolves one; the link is the current edition
--         (Revised January 2022, reflecting G.S.R. 207(E) of 24-Mar-2021). A
--         methodology administrator supersedes a row when ICAI revises it.
--       – SCH_III_ROUNDING_REQ — the General Instructions rounding-off
--         requirement, as two versions so an earlier audit period keeps the
--         wording in force for it: v1 from Schedule III's commencement
--         (turnover band, rounding "may"), v2 from 1-Apr-2021 (total income
--         band, rounding "shall").
--   • Source links and viewer summaries for the existing Schedule III Division
--     rows and Section 2(40) — rows an administrator already set are left alone.
--   • authority_reference_link rows for context '02.3' — one per
--     SCH_REFERENCE_ANCHOR in @hsdg/contracts; the portal never embeds a URL.
--
-- Provision codes are shared by their versions (1767150000000), so the seeds
-- skip on any existing row rather than on the code alone.

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary)
VALUES
  ('COS_ACT_129', 'MCA', 'Financial statements', 'Section 129',
   '2014-04-01', NULL, 1,
   'Companies Act 2013, s.129', 'provision',
   'https://www.indiacode.nic.in/handle/123456789/2114',
   'The financial statements shall give a true and fair view of the state of affairs of the '
   || 'company, comply with the notified accounting standards and be in the form or forms '
   || 'provided for different classes of companies in Schedule III. The second proviso to '
   || 'section 129(1) excludes any insurance or banking company, any company engaged in the '
   || 'generation or supply of electricity, and any other class of company for which a form of '
   || 'financial statement has been specified in or under the Act governing that class — those '
   || 'companies follow their own statutory format.'),
  ('ICAI_GN_SCH_III_DIV_I', 'ICAI',
   'Guidance Note on Division I – Non Ind AS Schedule III to the Companies Act, 2013',
   'Guidance Note (Revised January 2022)',
   '2014-04-01', NULL, 1,
   'ICAI Corporate Laws & Corporate Governance Committee, Revised January 2022', 'guidance',
   'https://publication.icai.org/publication/76',
   'ICAI guidance on preparing and presenting financial statements under Division I of '
   || 'Schedule III (companies following the Companies (Accounting Standards) Rules): each '
   || 'Balance Sheet and Statement of Profit and Loss item, the General Instructions and the '
   || 'additional regulatory information introduced by the MCA amendment of 24 March 2021.'),
  ('ICAI_GN_SCH_III_DIV_II', 'ICAI',
   'Guidance Note on Division II – Ind AS Schedule III to the Companies Act, 2013',
   'Guidance Note (Revised January 2022)',
   '2015-04-01', NULL, 1,
   'ICAI Corporate Laws & Corporate Governance Committee, Revised January 2022', 'guidance',
   'https://publication.icai.org/publication/77',
   'ICAI guidance on Division II of Schedule III for companies (other than NBFCs) that apply '
   || 'Ind AS: Balance Sheet, Statement of Profit and Loss with Other Comprehensive Income, '
   || 'Statement of Changes in Equity, the notes, illustrative standalone and consolidated '
   || 'formats, and the 2021 additional disclosures.'),
  ('ICAI_GN_SCH_III_DIV_III', 'ICAI',
   'Guidance Note on Division III to Schedule III to the Companies Act, 2013 for NBFCs required to comply with Ind AS',
   'Guidance Note (Revised January 2022)',
   '2018-10-11', NULL, 1,
   'ICAI Corporate Laws & Corporate Governance Committee, Revised January 2022', 'guidance',
   'https://publication.icai.org/publication/79',
   'ICAI guidance on Division III of Schedule III for Non-Banking Financial Companies that '
   || 'apply Ind AS: the liquidity-order Balance Sheet, the Statement of Profit and Loss, the '
   || 'Statement of Changes in Equity, NBFC-specific notes and the 2021 additional '
   || 'regulatory information.')
ON CONFLICT DO NOTHING;

-- Rounding-off requirement — the version in force before the 2021 amendment …
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary, change_note)
VALUES
  ('SCH_III_ROUNDING_REQ', 'MCA', 'Schedule III — rounding off of figures',
   'Schedule III, General Instructions',
   '2014-04-01', '2021-03-31', 1,
   'Companies Act 2013, Schedule III, General Instructions for preparation of Balance Sheet and Statement of Profit and Loss',
   'provision', 'https://www.indiacode.nic.in/handle/123456789/2114',
   'Depending upon the turnover of the company, the figures appearing in the financial '
   || 'statements may be rounded off — turnover below one hundred crore rupees: to the nearest '
   || 'hundreds, thousands, lakhs or millions, or decimals thereof; one hundred crore rupees or '
   || 'more: to the nearest lakhs, millions or crores, or decimals thereof. Once a unit is used '
   || 'it is used uniformly. The band and units DHVAJ applies are held in the Audit Rules Library.',
   NULL)
ON CONFLICT DO NOTHING;
-- … and from 1 April 2021 (G.S.R. 207(E), 24 March 2021).
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary, change_note)
VALUES
  ('SCH_III_ROUNDING_REQ', 'MCA', 'Schedule III — rounding off of figures',
   'Schedule III, General Instructions (as amended)',
   '2021-04-01', NULL, 2,
   'Companies Act 2013, Schedule III as amended by G.S.R. 207(E), 24 March 2021',
   'provision', 'https://www.indiacode.nic.in/handle/123456789/2114',
   'Depending upon the total income of the company, the figures appearing in the financial '
   || 'statements shall be rounded off — total income below one hundred crore rupees: to the '
   || 'nearest hundreds, thousands, lakhs or millions, or decimals thereof; one hundred crore '
   || 'rupees or more: to the nearest lakhs, millions or crores, or decimals thereof. Once a unit '
   || 'is used it shall be used uniformly. The band and units DHVAJ applies are held in the '
   || 'Audit Rules Library.',
   'Amended by G.S.R. 207(E) of 24 March 2021 for financial years from 1 April 2021: rounding '
   || 'becomes mandatory and the band is measured on total income.')
ON CONFLICT DO NOTHING;
UPDATE hsdg.authority_provision v1
   SET superseded_by_id = v2.id
  FROM hsdg.authority_provision v2
 WHERE v1.code = 'SCH_III_ROUNDING_REQ' AND v1.version_no = 1
   AND v2.code = 'SCH_III_ROUNDING_REQ' AND v2.version_no = 2
   AND v1.superseded_by_id IS NULL;

-- Source links for the existing rows 02.3 cites, pinned to each row's version.
UPDATE hsdg.authority_provision p
   SET source_url = v.url
  FROM (VALUES
    ('SCH_III_DIV_I',   DATE '2014-04-01', 'https://www.indiacode.nic.in/handle/123456789/2114'),
    ('SCH_III_DIV_II',  DATE '2015-04-01', 'https://www.indiacode.nic.in/handle/123456789/2114'),
    ('SCH_III_DIV_III', DATE '2018-10-11', 'https://www.indiacode.nic.in/handle/123456789/2114'),
    ('COS_ACT_2_40',    DATE '2014-04-01', 'https://www.indiacode.nic.in/handle/123456789/2114')
  ) AS v(code, effective_from, url)
 WHERE p.code = v.code
   AND p.effective_from = v.effective_from
   AND p.source_url IS NULL;

UPDATE hsdg.authority_provision p
   SET summary = v.summary
  FROM (VALUES
    ('SCH_III_DIV_I',
     'Division I of Schedule III sets the form of the Balance Sheet and the Statement of Profit '
     || 'and Loss, with the General Instructions and notes, for a company whose financial '
     || 'statements follow the Companies (Accounting Standards) Rules. A Cash Flow Statement is '
     || 'prepared under AS 3 unless section 2(40) exempts the company.'),
    ('SCH_III_DIV_II',
     'Division II of Schedule III (inserted by G.S.R. 404(E), 6 April 2016) sets the form of the '
     || 'Balance Sheet, the Statement of Profit and Loss including Other Comprehensive Income and '
     || 'the Statement of Changes in Equity for a company, other than an NBFC, whose financial '
     || 'statements comply with the Companies (Indian Accounting Standards) Rules, 2015.'),
    ('SCH_III_DIV_III',
     'Division III of Schedule III (inserted by G.S.R. 1022(E), 11 October 2018) sets the form '
     || 'of the financial statements of a Non-Banking Financial Company that complies with the '
     || 'Companies (Indian Accounting Standards) Rules, 2015 — the Balance Sheet in order of '
     || 'liquidity, the Statement of Profit and Loss and the Statement of Changes in Equity.'),
    ('COS_ACT_2_40',
     'Section 2(40) defines the financial statements — the balance sheet, the profit and loss '
     || 'account, the cash flow statement, the statement of changes in equity and the notes. '
     || 'Its proviso allows a One Person Company, a small company and a dormant company to omit '
     || 'the cash flow statement.')
  ) AS v(code, summary)
 WHERE p.code = v.code AND p.summary IS NULL;

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- ── 02.3 references (spec §22; resolved through the library, period-correct) ─
-- FORCE RLS would reject the migrator's insert (no firm-wide context).
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('02.3', 'section_129',          'View Section 129',                      'COS_ACT_129',             10),
  ('02.3', 'schedule_iii_div_i',   'View Schedule III - Division I',        'SCH_III_DIV_I',           20),
  ('02.3', 'schedule_iii_div_ii',  'View Schedule III - Division II',       'SCH_III_DIV_II',          30),
  ('02.3', 'schedule_iii_div_iii', 'View Schedule III - Division III',      'SCH_III_DIV_III',         40),
  ('02.3', 'icai_gn_div_i',        'View ICAI Division I Guidance Note',    'ICAI_GN_SCH_III_DIV_I',   50),
  ('02.3', 'icai_gn_div_ii',       'View ICAI Division II Guidance Note',   'ICAI_GN_SCH_III_DIV_II',  60),
  ('02.3', 'icai_gn_div_iii',      'View ICAI Division III Guidance Note',  'ICAI_GN_SCH_III_DIV_III', 70),
  ('02.3', 'section_2_40',         'View Section 2(40) - Cash Flow Exemption', 'COS_ACT_2_40',         80),
  ('02.3', 'rounding',             'View Rounding Requirement',             'SCH_III_ROUNDING_REQ',    90)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '02.3';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
-- Rows that cite the new provisions keep working: their references fall away.
UPDATE hsdg.authority_provision SET superseded_by_id = NULL
 WHERE code IN ('COS_ACT_129','ICAI_GN_SCH_III_DIV_I','ICAI_GN_SCH_III_DIV_II',
                'ICAI_GN_SCH_III_DIV_III','SCH_III_ROUNDING_REQ');
DELETE FROM hsdg.authority_provision
 WHERE code IN ('COS_ACT_129','ICAI_GN_SCH_III_DIV_I','ICAI_GN_SCH_III_DIV_II',
                'ICAI_GN_SCH_III_DIV_III','SCH_III_ROUNDING_REQ');
UPDATE hsdg.authority_provision
   SET source_url = NULL
 WHERE code IN ('SCH_III_DIV_I','SCH_III_DIV_II','SCH_III_DIV_III','COS_ACT_2_40')
   AND source_url = 'https://www.indiacode.nic.in/handle/123456789/2114';
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
