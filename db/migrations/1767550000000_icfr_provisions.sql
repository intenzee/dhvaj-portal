-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.5 Internal Financial Controls / ICFR — the Provision Library behind every
-- ICFR "View …" action (DHVAJ Section 02.5 spec §21; build split Track B).
--
--   • MCA_ICFR_PVT_EXEMPTION — the private-company exemption from section
--     143(3)(i) (notification G.S.R. 583(E) of 13 June 2017 amending the
--     private-company exemptions notification G.S.R. 464(E) of 5 June 2015).
--     Two effective-dated versions: v1 as published, then v2 as corrected by
--     the corrigendum of 13 July 2017 (turnover AND borrowings cumulative; the
--     sections 92 / 137 filing-default proviso). 02.5 resolves this provision by
--     the audit period END, so FY 2017-18 opens v2.
--   • COS_ACT_92 (annual return) and COS_ACT_137 (filing of financial
--     statements) — the filing-default condition.
--   • ICAI_GN_ICFR — Guidance Note on Audit of Internal Financial Controls over
--     Financial Reporting; ICAI_IG_ICFR_SMALL — ICAI implementation guidance for
--     smaller / less complex entities.
--   • COS_ACT_143_3_I and AUDIT_RULE_11G (seeded 1763000000000) gain their
--     viewer summaries.
--   • The 02.5 exemption rules (Track A) cite the exemption notification
--     instead of section 143(3)(i) itself — the version in force at each rule
--     version's start (Track A seeds them before this migration runs).
--   • authority_reference_link rows for context '02.5' (the anchors 02.5's
--     workspace passes to FrameworkReferences).
--
-- FORCE RLS on the provision / reference / rule tables is lifted for the seed
-- and restored after (no request context in a migration).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary, change_note)
VALUES
  ('MCA_ICFR_PVT_EXEMPTION', 'MCA',
   'Private company exemption from reporting on internal financial controls',
   'G.S.R. 583(E) dated 13 June 2017',
   '2017-06-13', '2017-07-12', 1,
   'MCA notification G.S.R. 583(E) dated 13 June 2017, amending notification G.S.R. 464(E) '
   || 'dated 5 June 2015 (exemptions to private companies under section 462)',
   'provision', NULL,
   'Section 143(3)(i) does not apply to a private company that is a One Person Company or a '
   || 'small company, or that has turnover less than INR 50 crore as per its latest audited '
   || 'financial statements or aggregate borrowings from banks, financial institutions or any '
   || 'body corporate at any point of time during the financial year less than INR 25 crore — '
   || 'provided the company has not committed a default in filing its financial statements '
   || 'under section 137 or its annual return under section 92. As published, the two monetary '
   || 'conditions read as alternatives; the corrigendum of 13 July 2017 made them cumulative.',
   'As published.'),
  ('MCA_ICFR_PVT_EXEMPTION', 'MCA',
   'Private company exemption from reporting on internal financial controls',
   'G.S.R. 583(E) dated 13 June 2017, as corrected 13 July 2017',
   '2017-07-13', NULL, 2,
   'MCA notification G.S.R. 583(E) dated 13 June 2017 read with the corrigendum dated '
   || '13 July 2017',
   'provision', NULL,
   'Section 143(3)(i) does not apply to a private company that is (a) a One Person Company or '
   || 'a small company, or (b) a company that has turnover less than INR 50 crore as per its '
   || 'latest audited financial statements AND aggregate borrowings from banks, financial '
   || 'institutions or any body corporate at any point of time during the financial year less '
   || 'than INR 25 crore. The exemption is not available to a private company that has '
   || 'committed a default in filing its financial statements under section 137 or its annual '
   || 'return under section 92. Both limits are strict (less than); the borrowing test is the '
   || 'maximum aggregate at any point in the year, not the closing balance.',
   'Corrigendum of 13 July 2017: the turnover and borrowing conditions are cumulative.'),
  ('COS_ACT_92', 'MCA', 'Annual return', 'Section 92',
   '2014-04-01', NULL, 1, 'Companies Act 2013, s.92', 'provision', NULL,
   'Every company must prepare an annual return in the prescribed form (MGT-7 / MGT-7A) and '
   || 'file it with the Registrar within sixty days from the date of its annual general '
   || 'meeting. A default in filing the annual return removes the private-company exemption '
   || 'from section 143(3)(i) reporting.',
   NULL),
  ('COS_ACT_137', 'MCA', 'Copy of financial statements to be filed with Registrar',
   'Section 137', '2014-04-01', NULL, 1, 'Companies Act 2013, s.137', 'provision', NULL,
   'A copy of the financial statements, including consolidated financial statements, adopted '
   || 'at the annual general meeting must be filed with the Registrar (AOC-4) within thirty days '
   || 'of the meeting. A default in filing the financial statements removes the private-company '
   || 'exemption from section 143(3)(i) reporting.',
   NULL),
  ('ICAI_GN_ICFR', 'ICAI',
   'Guidance Note on Audit of Internal Financial Controls Over Financial Reporting',
   'Guidance Note (ICFR)', '2015-04-01', NULL, 1,
   'ICAI Auditing and Assurance Standards Board — Guidance Note on Audit of Internal Financial '
   || 'Controls Over Financial Reporting (current authoritative version)',
   'guidance', NULL,
   'ICAI guidance on the audit of internal financial controls over financial reporting under '
   || 'section 143(3)(i): the integrated audit with the financial-statement audit, the top-down '
   || 'risk-based approach (entity-level controls, significant accounts, relevant assertions, '
   || 'significant processes and IT general controls), testing design and operating '
   || 'effectiveness, evaluating deficiencies (control deficiency, significant deficiency, '
   || 'material weakness), and the form of the report, including the consolidated financial '
   || 'statements.',
   NULL),
  ('ICAI_IG_ICFR_SMALL', 'ICAI',
   'Implementation guidance on internal financial controls for smaller entities',
   'Implementation guidance (ICFR — smaller / less complex entities)', '2015-04-01', NULL, 1,
   'ICAI — implementation guidance on reporting on internal financial controls for smaller and '
   || 'less complex entities (current authoritative version)',
   'guidance', NULL,
   'ICAI implementation guidance for applying the Guidance Note on Audit of ICFR to smaller and '
   || 'less complex entities: scaling the documentation of controls, reliance on entity-level and '
   || 'owner-manager controls, and evidence appropriate to the size and complexity of the '
   || 'company.',
   NULL)
ON CONFLICT (code, version_no) DO NOTHING;

-- v1 is superseded by the corrigendum version.
UPDATE hsdg.authority_provision v1
   SET superseded_by_id = v2.id
  FROM hsdg.authority_provision v2
 WHERE v1.code = 'MCA_ICFR_PVT_EXEMPTION' AND v1.version_no = 1
   AND v2.code = 'MCA_ICFR_PVT_EXEMPTION' AND v2.version_no = 2
   AND v1.superseded_by_id IS NULL;

UPDATE hsdg.authority_provision
   SET summary = 'The auditor''s report must state whether the company has adequate internal '
       || 'financial controls with reference to financial statements in place and the operating '
       || 'effectiveness of such controls. Exempt private companies are set out in the MCA '
       || 'private-company exemption notification; the report on consolidated financial '
       || 'statements covers the parent and its subsidiaries, associates and joint ventures '
       || 'incorporated in India.'
 WHERE code = 'COS_ACT_143_3_I' AND summary IS NULL;

UPDATE hsdg.authority_provision
   SET summary = 'The auditor''s report must state whether the company has used accounting '
       || 'software with an audit trail (edit log) facility that operated throughout the year for '
       || 'all relevant transactions, was not tampered with, and was preserved as required. A '
       || 'separate requirement from section 143(3)(i): an audit-trail matter may cross-refer to an '
       || 'IT general control deficiency but keeps its own conclusion and report wording.'
 WHERE code = 'AUDIT_RULE_11G' AND summary IS NULL;

-- ── The 02.5 exemption rules cite the notification (Track A seeds them) ────
-- Remember what each rule version cited before, so the down migration restores it.
CREATE TABLE hsdg.icfr_rule_citation_backup (
  rule_version_id        uuid PRIMARY KEY,
  authority_provision_id uuid
);
-- Migration bookkeeping only: no app access.
ALTER TABLE hsdg.icfr_rule_citation_backup ENABLE ROW LEVEL SECURITY;

ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.icfr_rule_citation_backup (rule_version_id, authority_provision_id)
SELECT v.id, v.authority_provision_id
  FROM hsdg.audit_rule_version v
  JOIN hsdg.audit_rule r ON r.id = v.audit_rule_id
  LEFT JOIN hsdg.authority_provision cur ON cur.id = v.authority_provision_id
 WHERE r.code IN ('ICFR_OPC_ROUTE','ICFR_SMALL_COMPANY_ROUTE','ICFR_FILING_CONDITION',
                  'ICFR_PRIVATE_MONETARY_JOIN','ICFR_EXEMPT_TURNOVER','ICFR_EXEMPT_BORROWINGS')
   AND (v.authority_provision_id IS NULL OR cur.code = 'COS_ACT_143_3_I')
ON CONFLICT (rule_version_id) DO NOTHING;

-- The version in force at the rule's start, else the latest (the rules are
-- dated from FY 2016-17 and apply the corrected, cumulative test).
UPDATE hsdg.audit_rule_version v
   SET authority_provision_id = (
         SELECT p.id FROM hsdg.authority_provision p
          WHERE p.code = 'MCA_ICFR_PVT_EXEMPTION'
          ORDER BY (p.effective_from <= v.effective_from
                    AND (p.effective_to IS NULL OR p.effective_to >= v.effective_from)) DESC,
                   p.effective_from DESC
          LIMIT 1)
  FROM hsdg.icfr_rule_citation_backup b
 WHERE b.rule_version_id = v.id;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- ── 02.5 references (spec §21; resolved through the library, period-correct) ─
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('02.5', 'section_143_3_i',    'View Section 143(3)(i)',           'COS_ACT_143_3_I',        10),
  ('02.5', 'mca_exemption',      'View MCA Private Company Exemption','MCA_ICFR_PVT_EXEMPTION', 20),
  ('02.5', 'section_92',         'View Section 92',                  'COS_ACT_92',             30),
  ('02.5', 'section_137',        'View Section 137',                 'COS_ACT_137',            40),
  ('02.5', 'icai_gn_icfr',       'View ICAI ICFR Guidance Note',     'ICAI_GN_ICFR',           50),
  ('02.5', 'icai_impl_guidance', 'View Implementation Guidance',     'ICAI_IG_ICFR_SMALL',     60),
  ('02.5', 'rule_11g',           'View Rule 11(g)',                  'AUDIT_RULE_11G',         70)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '02.5';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.audit_rule_version v
   SET authority_provision_id = b.authority_provision_id
  FROM hsdg.icfr_rule_citation_backup b
 WHERE b.rule_version_id = v.id;
DROP TABLE IF EXISTS hsdg.icfr_rule_citation_backup;
-- Anything else that cited a removed provision keeps working: the citation falls away.
UPDATE hsdg.audit_rule_version SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision
    WHERE code IN ('MCA_ICFR_PVT_EXEMPTION','COS_ACT_92','COS_ACT_137','ICAI_GN_ICFR','ICAI_IG_ICFR_SMALL'));
UPDATE hsdg.audit_framework_subassessment SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision
    WHERE code IN ('MCA_ICFR_PVT_EXEMPTION','COS_ACT_92','COS_ACT_137','ICAI_GN_ICFR','ICAI_IG_ICFR_SMALL'));
UPDATE hsdg.authority_provision SET superseded_by_id = NULL
 WHERE code IN ('MCA_ICFR_PVT_EXEMPTION','COS_ACT_92','COS_ACT_137','ICAI_GN_ICFR','ICAI_IG_ICFR_SMALL');
DELETE FROM hsdg.authority_provision
 WHERE code IN ('MCA_ICFR_PVT_EXEMPTION','COS_ACT_92','COS_ACT_137','ICAI_GN_ICFR','ICAI_IG_ICFR_SMALL');
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
