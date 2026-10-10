-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- 02.6 Consolidation / Group Audit Framework — the Provision Library behind
-- every 02.6 "View …" action (DHVAJ Section 02.6 spec §23; build split
-- Track B). References resolve centrally by engagement period — no URL lives in
-- a component.
--
--   • COS_ACT_2_6 — "associate company" / significant influence, in two
--     effective-dated versions: as enacted (20% of total SHARE CAPITAL, or of
--     business decisions under an agreement), then as substituted by the
--     Companies (Amendment) Act 2017 from 9 February 2018 (20% of total VOTING
--     POWER, or control of or participation in business decisions under an
--     agreement; joint venture defined). 02.6 opens the version in force for
--     the audit period.
--   • ACCT_RULE_6 (seeded 1763000000000) — version check: split into the rule
--     as notified, the intermediate wholly-owned subsidiary proviso inserted by
--     the Companies (Accounts) Amendment Rules 2014 (14 October 2014), and the
--     cumulative three-condition exemption substituted by the Companies
--     (Accounts) Amendment Rules 2016 (G.S.R. 742(E), 27 July 2016) that the
--     current 02.6 Rule 6 test applies.
--   • SA_600 — version check: the current Indian SA 600 "Using the Work of
--     Another Auditor" (audits of periods beginning on or after 1 April 2002)
--     stays the one version; IAASB ISA 600 (Revised) is NOT substituted unless
--     ICAI adopts it for the engagement period (spec §13).
--   • AUDIT_RULE_12 — Companies (Audit and Auditors) Rules 2014, Rule 12
--     (branch audit), the "applicable Audit and Auditors Rules" of BR-01.
--   • Viewer summaries for §129(3), §143(8), AS 21 / 23 / 27, Ind AS 110 / 111
--     / 28 where none is held yet.
--   • authority_reference_link rows for context '02.6' (every anchor in
--     CONSOLIDATION_REFERENCE_ANCHOR plus the branch-audit rule).
--
-- FORCE RLS on the provision / reference tables is lifted for the seed and
-- restored after (no request context in a migration).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

-- ── Section 2(6) — two versions ─────────────────────────────────────────────
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary, change_note)
VALUES
  ('COS_ACT_2_6', 'MCA', 'Associate company — significant influence', 'Section 2(6)',
   '2014-04-01', '2018-02-08', 1,
   'Companies Act 2013, s.2(6) as enacted', 'provision', NULL,
   '"Associate company", in relation to another company, means a company in which that other '
   || 'company has a significant influence, but which is not a subsidiary company of the company '
   || 'having such influence, and includes a joint venture company. Explanation: "significant '
   || 'influence" means control of at least twenty per cent. of total share capital, or of '
   || 'business decisions under an agreement. The percentage is a statutory limb; influence '
   || 'under an agreement can apply independently of it.',
   'As enacted.'),
  ('COS_ACT_2_6', 'MCA', 'Associate company — significant influence', 'Section 2(6)',
   '2018-02-09', NULL, 2,
   'Companies Act 2013, s.2(6) as amended by the Companies (Amendment) Act 2017 '
   || '(in force 9 February 2018)', 'provision', NULL,
   '"Associate company", in relation to another company, means a company in which that other '
   || 'company has a significant influence, but which is not a subsidiary company of the company '
   || 'having such influence, and includes a joint venture company. Explanation: (a) "significant '
   || 'influence" means control of at least twenty per cent. of total voting power, or control '
   || 'of or participation in business decisions under an agreement; (b) "joint venture" means a '
   || 'joint arrangement whereby the parties that have joint control of the arrangement have '
   || 'rights to the net assets of the arrangement. The 20% voting-power limb is an indicator; '
   || 'agreement-based influence applies independently, and the accounting assessment (AS 23 / '
   || 'Ind AS 28) remains a separate, rebuttable judgment.',
   'Companies (Amendment) Act 2017: voting power replaces share capital; participation in '
   || 'business decisions; joint venture defined.')
ON CONFLICT (code, version_no) DO NOTHING;

UPDATE hsdg.authority_provision v1
   SET superseded_by_id = v2.id
  FROM hsdg.authority_provision v2
 WHERE v1.code = 'COS_ACT_2_6' AND v1.version_no = 1
   AND v2.code = 'COS_ACT_2_6' AND v2.version_no = 2
   AND v1.superseded_by_id IS NULL;

-- ── Rule 6 — version check (close the open-ended v1, then add v2 / v3) ──────
-- Remember the v1 row as it was so the down migration restores it exactly.
CREATE TABLE hsdg.group_audit_provision_backup (
  code         text PRIMARY KEY,
  effective_to date,
  summary      text,
  change_note  text
);
-- Migration bookkeeping only: no app access.
ALTER TABLE hsdg.group_audit_provision_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO hsdg.group_audit_provision_backup (code, effective_to, summary, change_note)
SELECT code, effective_to, summary, change_note
  FROM hsdg.authority_provision
 WHERE code = 'ACCT_RULE_6' AND version_no = 1
   AND NOT EXISTS (SELECT 1 FROM hsdg.authority_provision x
                    WHERE x.code = 'ACCT_RULE_6' AND x.version_no > 1)
ON CONFLICT (code) DO NOTHING;

UPDATE hsdg.authority_provision
   SET effective_to = '2014-10-13',
       summary = 'Consolidation of financial statements is made in accordance with Schedule III '
         || 'and the applicable accounting standards; a company covered by section 129(3) that is '
         || 'not required to prepare consolidated financial statements under the Accounting '
         || 'Standards complies by following the Schedule III provisions on consolidated '
         || 'financial statements. As notified, the rule carries no exemption for intermediate '
         || 'subsidiaries.',
       change_note = 'As notified (Companies (Accounts) Rules 2014).'
 WHERE code = 'ACCT_RULE_6' AND version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.group_audit_provision_backup b WHERE b.code = 'ACCT_RULE_6');

INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary, change_note)
SELECT 'ACCT_RULE_6', 'MCA', p.title, 'Rule 6', s.effective_from, s.effective_to, s.version_no,
       s.source_reference, 'provision', NULL, s.summary, s.change_note
  FROM hsdg.authority_provision p
  CROSS JOIN (VALUES
    (2, DATE '2014-10-14', DATE '2016-07-26',
     'Companies (Accounts) Rules 2014, Rule 6, as amended by the Companies (Accounts) Amendment '
     || 'Rules 2014 (14 October 2014)',
     'Consolidation follows Schedule III and the applicable accounting standards. Proviso: the '
     || 'rule does not apply to the preparation of consolidated financial statements by an '
     || 'intermediate wholly-owned subsidiary, other than a wholly-owned subsidiary whose '
     || 'immediate parent is a company incorporated outside India.',
     'Intermediate wholly-owned subsidiary proviso inserted.'),
    (3, DATE '2016-07-27', NULL::date,
     'Companies (Accounts) Rules 2014, Rule 6, as amended by the Companies (Accounts) Amendment '
     || 'Rules 2016 (G.S.R. 742(E), 27 July 2016)',
     'Consolidation follows Schedule III and the applicable accounting standards. Exemption — a '
     || 'company need not prepare consolidated financial statements only if ALL of these hold: '
     || '(i) it is a wholly-owned subsidiary, or a partially-owned subsidiary of another company '
     || 'whose other members, including those not otherwise entitled to vote, have been '
     || 'intimated in writing (proof of delivery retained) and do not object to the company not '
     || 'presenting consolidated financial statements; (ii) its securities are not listed and are '
     || 'not in the process of listing on any stock exchange, in or outside India; and (iii) its '
     || 'ultimate or any intermediate holding company files consolidated financial statements '
     || 'with the Registrar that comply with the applicable accounting standards. The conditions '
     || 'are cumulative; silence of a member is not consent unless the rule says so.',
     'Exemption substituted: cumulative ownership / no-objection, listing and parent-filing '
     || 'conditions.')
  ) AS s(version_no, effective_from, effective_to, source_reference, summary, change_note)
 WHERE p.code = 'ACCT_RULE_6' AND p.version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.group_audit_provision_backup b WHERE b.code = 'ACCT_RULE_6')
ON CONFLICT (code, version_no) DO NOTHING;

UPDATE hsdg.authority_provision v
   SET superseded_by_id = n.id
  FROM hsdg.authority_provision n
 WHERE v.code = 'ACCT_RULE_6' AND n.code = 'ACCT_RULE_6'
   AND n.version_no = v.version_no + 1
   AND v.superseded_by_id IS NULL;

-- ── Section 143(8) branch audit — Rule 12 ───────────────────────────────────
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, effective_to, version_no,
   source_reference, reference_kind, source_url, summary)
VALUES
  ('AUDIT_RULE_12', 'MCA', 'Manner of audit of accounts of branch office of company', 'Rule 12',
   '2014-04-01', NULL, 1,
   'Companies (Audit and Auditors) Rules 2014, Rule 12', 'provision', NULL,
   'For section 143(8), the duties and powers of the company''s auditor with reference to the '
   || 'audit of the branch, and of the branch auditor, are those in section 143(1) to (4). The '
   || 'branch auditor submits the branch audit report to the company''s auditor, and the '
   || 'reporting of fraud under section 143(12) extends to the branch auditor to the extent it '
   || 'relates to the branch.')
ON CONFLICT (code, version_no) DO NOTHING;

-- ── Viewer summaries (only where none is held) ──────────────────────────────
UPDATE hsdg.authority_provision SET summary = s.summary
  FROM (VALUES
    ('COS_ACT_129_3',
     'Where a company has one or more subsidiaries or associate companies, it must, in addition '
     || 'to its own financial statements, prepare consolidated financial statements of the '
     || 'company and of all the subsidiaries and associate companies in the same form and manner '
     || 'as its own, and lay them before the annual general meeting with its own financial '
     || 'statements. "Subsidiary" includes associate company and joint venture for this purpose.'),
    ('COS_ACT_143_8',
     'Where a company has a branch office, its accounts are audited by the company''s auditor or '
     || 'by another person qualified for appointment as auditor of the company and appointed '
     || 'under section 139; a branch outside India may be audited by an accountant duly qualified '
     || 'under the laws of that country. The branch auditor prepares a report on the branch '
     || 'accounts and sends it to the company''s auditor, who deals with it in the company''s '
     || 'audit report as considered necessary.'),
    ('SA_600',
     'The current Indian Standard on Auditing on using the work of another auditor (effective '
     || 'for audits of financial statements for periods beginning on or after 1 April 2002): the '
     || 'principal auditor considers whether its own participation is sufficient to act as '
     || 'principal auditor, the professional competence of the other auditor, communicates the '
     || 'requirements the other auditor must follow, and obtains sufficient appropriate evidence '
     || 'that the other auditor''s work is adequate for its purposes. IAASB ISA 600 (Revised) is '
     || 'not applied unless ICAI adopts it for the engagement period.'),
    ('AS_21',
     'Consolidated financial statements under Accounting Standards: control is ownership, '
     || 'directly or indirectly through subsidiaries, of more than one-half of the voting power '
     || 'of an enterprise, or control of the composition of its board of directors (or governing '
     || 'body) so as to obtain economic benefits from its activities. Covers uniform accounting '
     || 'policies, reporting dates, elimination of intra-group balances and transactions, '
     || 'goodwill / capital reserve and minority interests.'),
    ('AS_23',
     'Accounting for investments in associates in consolidated financial statements (equity '
     || 'method). Significant influence is presumed where the investor holds, directly or '
     || 'indirectly, 20% or more of the voting power, unless it can be clearly demonstrated that '
     || 'this is not the case; below 20% it is presumed absent unless clearly demonstrated.'),
    ('AS_27',
     'Financial reporting of interests in joint ventures — jointly controlled operations, '
     || 'jointly controlled assets and jointly controlled entities; joint control exists only '
     || 'under a contractual arrangement. Jointly controlled entities are proportionately '
     || 'consolidated in consolidated financial statements.'),
    ('INDAS_110',
     'Consolidated financial statements under Ind AS: an investor controls an investee when it '
     || 'has power over it, exposure or rights to variable returns from its involvement, and the '
     || 'ability to use its power to affect those returns. Control is a principle-based '
     || 'assessment — no ownership percentage is a complete test.'),
    ('INDAS_111',
     'Joint arrangements: joint control is the contractually agreed sharing of control, '
     || 'requiring unanimous consent for decisions about the relevant activities. A joint '
     || 'operator recognises its assets, liabilities, revenue and expenses; a joint venturer '
     || 'accounts for its interest using the equity method (Ind AS 28).'),
    ('INDAS_28',
     'Investments in associates and joint ventures (equity method). Significant influence is '
     || 'presumed where the entity holds, directly or indirectly, 20% or more of the voting power, '
     || 'unless it can be clearly demonstrated otherwise; the presumption is rebuttable both ways.')
  ) AS s(code, summary)
 WHERE hsdg.authority_provision.code = s.code
   AND hsdg.authority_provision.summary IS NULL
   AND hsdg.authority_provision.effective_to IS NULL;

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- ── 02.6 references (spec §23; resolved through the library, period-correct) ─
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.authority_reference_link (context_key, anchor, label, provision_code, sort_order) VALUES
  ('02.6', 'section_129_3',  'View Section 129(3)',                     'COS_ACT_129_3', 10),
  ('02.6', 'section_2_6',    'View Section 2(6)',                       'COS_ACT_2_6',   20),
  ('02.6', 'rule_6',         'View Rule 6',                             'ACCT_RULE_6',   30),
  ('02.6', 'as_21',          'View AS 21',                              'AS_21',         40),
  ('02.6', 'as_23',          'View AS 23',                              'AS_23',         50),
  ('02.6', 'as_27',          'View AS 27',                              'AS_27',         60),
  ('02.6', 'ind_as_110',     'View Ind AS 110',                         'INDAS_110',     70),
  ('02.6', 'ind_as_111',     'View Ind AS 111',                         'INDAS_111',     80),
  ('02.6', 'ind_as_28',      'View Ind AS 28',                          'INDAS_28',      90),
  ('02.6', 'sa_600',         'View SA 600',                             'SA_600',       100),
  ('02.6', 'section_143_8',  'View Section 143(8)',                     'COS_ACT_143_8', 110),
  ('02.6', 'audit_rule_12',  'View applicable Audit and Auditors Rules', 'AUDIT_RULE_12', 120)
ON CONFLICT (context_key, anchor) DO NOTHING;
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.authority_reference_link NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.authority_reference_link WHERE context_key = '02.6';
ALTER TABLE hsdg.authority_reference_link FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

-- Anything citing a removed provision version falls back (Rule 6 → v1) or away.
UPDATE hsdg.audit_rule_version t SET authority_provision_id = f.id
  FROM hsdg.authority_provision p, hsdg.authority_provision f
 WHERE t.authority_provision_id = p.id AND p.code = 'ACCT_RULE_6' AND p.version_no > 1
   AND f.code = 'ACCT_RULE_6' AND f.version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.group_audit_provision_backup b WHERE b.code = 'ACCT_RULE_6');
UPDATE hsdg.audit_framework_subassessment t SET authority_provision_id = f.id
  FROM hsdg.authority_provision p, hsdg.authority_provision f
 WHERE t.authority_provision_id = p.id AND p.code = 'ACCT_RULE_6' AND p.version_no > 1
   AND f.code = 'ACCT_RULE_6' AND f.version_no = 1
   AND EXISTS (SELECT 1 FROM hsdg.group_audit_provision_backup b WHERE b.code = 'ACCT_RULE_6');
UPDATE hsdg.audit_rule_version SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision WHERE code IN ('COS_ACT_2_6','AUDIT_RULE_12'));
UPDATE hsdg.audit_framework_subassessment SET authority_provision_id = NULL
 WHERE authority_provision_id IN (
   SELECT id FROM hsdg.authority_provision WHERE code IN ('COS_ACT_2_6','AUDIT_RULE_12'));

UPDATE hsdg.authority_provision SET superseded_by_id = NULL
 WHERE code IN ('COS_ACT_2_6','AUDIT_RULE_12')
    OR (code = 'ACCT_RULE_6'
        AND EXISTS (SELECT 1 FROM hsdg.group_audit_provision_backup b WHERE b.code = 'ACCT_RULE_6'));
DELETE FROM hsdg.authority_provision WHERE code IN ('COS_ACT_2_6','AUDIT_RULE_12');
DELETE FROM hsdg.authority_provision
 WHERE code = 'ACCT_RULE_6' AND version_no > 1
   AND EXISTS (SELECT 1 FROM hsdg.group_audit_provision_backup b WHERE b.code = 'ACCT_RULE_6');
UPDATE hsdg.authority_provision p
   SET effective_to = b.effective_to, summary = b.summary, change_note = b.change_note
  FROM hsdg.group_audit_provision_backup b
 WHERE p.code = b.code AND p.version_no = 1;
DROP TABLE IF EXISTS hsdg.group_audit_provision_backup;

ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
-- The viewer summaries added above are content only and stay (harmless on re-up).
