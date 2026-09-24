-- ─────────────────────────────────────────────────────────────────────────
-- 0050 · Authority / Provision Library  (Implementation Guide §5)
--
-- Foundational subsystem #2. The single versioned store of legal provisions,
-- standards and guidance notes behind every `View Provision / View Standard /
-- View Guidance` action. NO external URL is embedded in a UI component — the
-- web renders an in-portal viewer that resolves a `code` here BY ENGAGEMENT
-- PERIOD (a historical engagement opens the version in force then).
--
-- Superseding appends a NEW row and closes the old one's `effective_to` +
-- `superseded_by_id`; a provision is never mutated in place beyond that.
--
-- SECURITY — firm-wide methodology reference data owned by the catalogue,
-- exactly like catalogue_templates (1760200000000): everyone with a role may
-- SELECT; only firm-wide admins (ctx_is_firmwide) may write. FORCE RLS so the
-- app role is always gated; hsdg_app is never the owner. DELETE stays revoked
-- (provisions are audit reference — superseded, never deleted).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.authority_provision (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,60}$'),
  authority                 text NOT NULL CHECK (authority IN ('MCA','ICAI','SEBI','RBI','IRDAI','other')),
  title                     text NOT NULL CHECK (length(trim(title)) > 0),
  provision_number          text NOT NULL CHECK (length(trim(provision_number)) > 0),
  effective_from            date NOT NULL,
  effective_to              date,
  source_reference          text,
  superseded_by_id          uuid REFERENCES hsdg.authority_provision (id) ON DELETE SET NULL,
  methodology_version_scope text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authority_provision_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX authority_provision_code_idx ON hsdg.authority_provision (code);
CREATE INDEX authority_provision_authority_idx ON hsdg.authority_provision (authority);
CREATE TRIGGER authority_provision_set_updated_at
  BEFORE UPDATE ON hsdg.authority_provision
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (firm-wide reference data; mirrors catalogue_templates) ──
REVOKE DELETE ON hsdg.authority_provision FROM hsdg_app;
ALTER TABLE hsdg.authority_provision ENABLE ROW LEVEL SECURITY;
CREATE POLICY authority_provision_read ON hsdg.authority_provision
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY authority_provision_write ON hsdg.authority_provision
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- ── Seed (guide §5): the provisions the Section 01 & 02 engines cite. ─────────
-- Companies Act 2013 provisions commence 2014-04-01; CARO 2020 applies FY
-- 2021-22 (01-Apr-2021); Rule 11(g) audit trail applies FY commencing on/after
-- 01-Apr-2023; Ind AS Rules Rule 4 commences 01-Apr-2015. Codes are stable
-- machine keys; the resolver keys on (code, effective period).
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, source_reference)
VALUES
  ('COS_ACT_2_85',   'MCA', 'Small company definition',                         'Section 2(85)',    '2014-04-01', 'Companies Act 2013, s.2(85)'),
  ('COS_ACT_2_41',   'MCA', 'Financial year',                                   'Section 2(41)',    '2014-04-01', 'Companies Act 2013, s.2(41)'),
  ('COS_ACT_129_3',  'MCA', 'Consolidated financial statements',                'Section 129(3)',   '2014-04-01', 'Companies Act 2013, s.129(3)'),
  ('COS_ACT_135',    'MCA', 'Corporate social responsibility',                  'Section 135',      '2014-04-01', 'Companies Act 2013, s.135'),
  ('COS_ACT_138',    'MCA', 'Internal audit',                                   'Section 138',      '2014-04-01', 'Companies Act 2013, s.138 r/w Rule 13'),
  ('COS_ACT_143_3',  'MCA', 'Auditor''s report — matters to be stated',         'Section 143(3)',   '2014-04-01', 'Companies Act 2013, s.143(3)'),
  ('COS_ACT_143_3_I','MCA', 'Adequacy of internal financial controls reporting','Section 143(3)(i)','2015-04-01', 'Companies Act 2013, s.143(3)(i)'),
  ('COS_ACT_143_8',  'MCA', 'Branch audit',                                     'Section 143(8)',   '2014-04-01', 'Companies Act 2013, s.143(8)'),
  ('COS_ACT_143_12', 'MCA', 'Reporting of fraud by auditor',                    'Section 143(12)',  '2014-04-01', 'Companies Act 2013, s.143(12) r/w Rule 13'),
  ('COS_ACT_148',    'MCA', 'Cost records and cost audit',                      'Section 148',      '2014-04-01', 'Companies Act 2013, s.148'),
  ('COS_ACT_164_2',  'MCA', 'Disqualification of directors',                    'Section 164(2)',   '2014-04-01', 'Companies Act 2013, s.164(2)'),
  ('COS_ACT_197',    'MCA', 'Managerial remuneration',                          'Section 197',      '2014-04-01', 'Companies Act 2013, s.197'),
  ('COS_ACT_197_16', 'MCA', 'Auditor comment on managerial remuneration',       'Section 197(16)',  '2014-04-01', 'Companies Act 2013, s.197(16)'),
  ('COS_ACT_198',    'MCA', 'Calculation of profits',                           'Section 198',      '2014-04-01', 'Companies Act 2013, s.198'),
  ('COS_ACT_204',    'MCA', 'Secretarial audit',                                'Section 204',      '2014-04-01', 'Companies Act 2013, s.204 r/w Rule 9'),
  ('SCH_III_DIV_I',  'MCA', 'Schedule III Division I (AS)',                      'Schedule III Div I',   '2014-04-01', 'Companies Act 2013, Schedule III Division I'),
  ('SCH_III_DIV_II', 'MCA', 'Schedule III Division II (Ind AS)',                 'Schedule III Div II',  '2015-04-01', 'Companies Act 2013, Schedule III Division II'),
  ('SCH_III_DIV_III','MCA', 'Schedule III Division III (Ind AS NBFC)',           'Schedule III Div III', '2018-10-11', 'Companies Act 2013, Schedule III Division III'),
  ('SCH_V',          'MCA', 'Schedule V — remuneration ceilings',               'Schedule V',       '2014-04-01', 'Companies Act 2013, Schedule V'),
  ('INDAS_RULE_4',   'MCA', 'Ind AS applicability roadmap',                     'Rule 4',           '2015-04-01', 'Companies (Indian Accounting Standards) Rules 2015, Rule 4'),
  ('ACCT_RULE_6',    'MCA', 'CFS exemption for intermediate wholly/partly-owned','Rule 6',          '2014-04-01', 'Companies (Accounts) Rules 2014, Rule 6'),
  ('AUDIT_RULE_11',  'MCA', 'Other matters to be included in auditor''s report','Rule 11',          '2014-04-01', 'Companies (Audit and Auditors) Rules 2014, Rule 11'),
  ('AUDIT_RULE_11G', 'MCA', 'Audit trail (edit log) reporting',                 'Rule 11(g)',       '2023-04-01', 'Companies (Audit and Auditors) Rules 2014, Rule 11(g)'),
  ('AUDIT_RULE_13',  'MCA', 'Reporting of fraud — manner and timelines',        'Rule 13',          '2014-04-01', 'Companies (Audit and Auditors) Rules 2014, Rule 13'),
  ('CARO_2020',      'MCA', 'Companies (Auditor''s Report) Order 2020',         'CARO 2020',        '2021-04-01', 'CARO 2020 (applicable FY 2021-22 onward)'),
  ('SA_299',         'ICAI','Joint audit of financial statements',              'SA 299',           '2018-04-01', 'ICAI Standard on Auditing 299 (Revised)'),
  ('SA_402',         'ICAI','Audit considerations — service organisation',      'SA 402',           '2010-04-01', 'ICAI Standard on Auditing 402'),
  ('SA_510',         'ICAI','Initial audit engagements — opening balances',     'SA 510',           '2010-04-01', 'ICAI Standard on Auditing 510'),
  ('SA_600',         'ICAI','Using the work of another auditor',                'SA 600',           '2002-04-01', 'ICAI Standard on Auditing 600'),
  ('INDAS_101',      'ICAI','First-time adoption of Ind AS',                    'Ind AS 101',       '2015-04-01', 'Ind AS 101'),
  ('INDAS_28',       'ICAI','Investments in associates and joint ventures',     'Ind AS 28',        '2015-04-01', 'Ind AS 28'),
  ('INDAS_110',      'ICAI','Consolidated financial statements',                'Ind AS 110',       '2015-04-01', 'Ind AS 110'),
  ('INDAS_111',      'ICAI','Joint arrangements',                               'Ind AS 111',       '2015-04-01', 'Ind AS 111'),
  ('AS_21',          'ICAI','Consolidated financial statements (AS)',           'AS 21',            '2001-04-01', 'AS 21'),
  ('AS_23',          'ICAI','Accounting for investments in associates (AS)',    'AS 23',            '2002-04-01', 'AS 23'),
  ('AS_27',          'ICAI','Financial reporting of interests in JVs (AS)',     'AS 27',            '2002-04-01', 'AS 27')
ON CONFLICT (code) DO NOTHING;

-- FORCE RLS only AFTER the seed: under FORCE even the owning migrator (no
-- request context) is policy-gated, so a seed placed after it is rejected.
-- Same ordering as catalogue_templates (1760200000000).
ALTER TABLE hsdg.authority_provision FORCE  ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS hsdg.authority_provision CASCADE;
