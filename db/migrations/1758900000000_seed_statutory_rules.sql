-- ─────────────────────────────────────────────────────────────────────────
-- 0035 · Seed statutory compliance rules + versions, linked to the catalogue
--
-- The catalogue classified HOW each obligation's deadline is generated (§2), but
-- no migration ever seeded an actual RULE — so the vast majority of statutory
-- components had no effective rule and could not compute a date. This seeds the
-- recurring statutory obligations with real Indian due-date logic and links each
-- to its catalogue component, so generating an instance yields a real statutory
-- deadline out of the box.
--
-- Due-date logic (calc engine §4). For monthly/quarterly filings the deadline is
-- "Nth of the month FOLLOWING the period", which equals period_end + N calendar
-- days (the last day of a month + N always lands on the Nth of the next month):
--   GSTR-1 11th · GSTR-3B 20th · CMP-08 18th · TDS deposit 7th · PF/ESI 15th.
-- Annual/audit deadlines are anchored to FY end (31 March) + a month offset:
--   Tax audit 30 Sep (+6) · ITR 31 Jul (+4) · AOC-4 ~31 Oct (+7) · MGT-7 ~30 Nov
--   (+8) · GSTR-9 31 Dec (+9). working_day_adjustment='next' pushes a deadline
-- landing on a weekend/holiday to the next working day. These are sensible firm
-- defaults (versioned §10) — a new effective-dated version supersedes any of
-- them without touching history.
--
-- Idempotent: rules and versions are keyed by their UNIQUE codes / (rule,version)
-- (ON CONFLICT DO NOTHING); the component link is a plain keyed UPDATE.
-- RLS: the migrator carries no role context, so FORCE would block the reads and
-- writes on these firm-wide config tables — drop FORCE, seed, restore (0007/0020).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_rules          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                   NO FORCE ROW LEVEL SECURITY;

-- ── A. The rules (firm-wide config; optional link to the owning service) ──
INSERT INTO hsdg.compliance_rules
  (code, name, description, service_id, category, due_date_category, due_date_source)
SELECT v.code, v.name, NULL, s.id, v.category, v.due_cat, v.due_src
FROM (VALUES
  ('GSTR1_MONTHLY',          'GSTR-1 (Outward Supplies) — monthly filing', 'GST_MONTHLY',      'gst',        'STATUTORY_FIXED', 'LAW_RULE'),
  ('GSTR3B_MONTHLY',         'GSTR-3B (Summary) — monthly filing',         'GST_MONTHLY',      'gst',        'STATUTORY_FIXED', 'LAW_RULE'),
  ('CMP08_QUARTERLY',        'CMP-08 — composition quarterly statement',   'GST_MONTHLY',      'gst',        'STATUTORY_FIXED', 'LAW_RULE'),
  ('GSTR9_ANNUAL',           'GSTR-9 — annual return',                     'GST_ANNUAL',       'gst',        'STATUTORY_RULE',  'LAW_RULE'),
  ('TDS_PAYMENT_MONTHLY',    'TDS — monthly deposit',                      'TDS_COMPLIANCE',   'tds',        'STATUTORY_FIXED', 'LAW_RULE'),
  ('TDS_STATEMENT_QUARTERLY','TDS — quarterly statement',                  'TDS_COMPLIANCE',   'tds',        'STATUTORY_FIXED', 'LAW_RULE'),
  ('PF_MONTHLY',             'Provident Fund — monthly payment',           'LABOUR_COMPLIANCE','other',      'STATUTORY_FIXED', 'LAW_RULE'),
  ('ESI_MONTHLY',            'ESI — monthly payment',                      'LABOUR_COMPLIANCE','other',      'STATUTORY_FIXED', 'LAW_RULE'),
  ('PT_MONTHLY',             'Professional Tax — monthly payment',         'LABOUR_COMPLIANCE','other',      'STATUTORY_RULE',  'LAW_RULE'),
  ('ITR_FILING_DUE',         'Income Tax Return — filing due date',        'ITR_FILING',       'income_tax', 'STATUTORY_RULE',  'LAW_RULE'),
  ('TAX_AUDIT_44AB',         'Tax Audit (u/s 44AB) — report filing',       'TAX_AUDIT',        'audit',      'STATUTORY_RULE',  'LAW_RULE'),
  ('ROC_AOC4_DUE',           'AOC-4 — financial statements filing',        'ROC_ANNUAL',       'roc',        'STATUTORY_RULE',  'LAW_RULE'),
  ('ROC_MGT7_DUE',           'MGT-7 — annual return filing',               'ROC_ANNUAL',       'roc',        'STATUTORY_RULE',  'LAW_RULE')
) AS v(code, name, service_code, category, due_cat, due_src)
LEFT JOIN hsdg.services s ON s.code = v.service_code
ON CONFLICT (code) DO NOTHING;

-- Assert the seed state: these are firm-managed statutory rules and must be
-- active. A prior down soft-retires (is_active=false) any rule an instance still
-- references rather than deleting it (§10), so re-applying up must re-activate
-- them — otherwise a down→up cycle would leave a used rule inert.
UPDATE hsdg.compliance_rules SET is_active = true WHERE code IN (
  'GSTR1_MONTHLY','GSTR3B_MONTHLY','CMP08_QUARTERLY','GSTR9_ANNUAL',
  'TDS_PAYMENT_MONTHLY','TDS_STATEMENT_QUARTERLY','PF_MONTHLY','ESI_MONTHLY',
  'PT_MONTHLY','ITR_FILING_DUE','TAX_AUDIT_44AB','ROC_AOC4_DUE','ROC_MGT7_DUE'
) AND is_active = false;

-- ── B. One effective-dated version per rule (calc §4) ─────────────────────
INSERT INTO hsdg.compliance_rule_versions
  (compliance_rule_id, version, effective_from, calculation_basis,
   offset_months, offset_days, working_day_adjustment, internal_sla_offset_days)
SELECT cr.id, 1, DATE '2015-04-01', v.basis, v.off_m, v.off_d, 'next', v.sla
FROM (VALUES
  ('GSTR1_MONTHLY',          'period_end', 0, 11, 3),
  ('GSTR3B_MONTHLY',         'period_end', 0, 20, 3),
  ('CMP08_QUARTERLY',        'period_end', 0, 18, 3),
  ('GSTR9_ANNUAL',           'fy_end',     9, 0,  15),
  ('TDS_PAYMENT_MONTHLY',    'period_end', 0, 7,  2),
  ('TDS_STATEMENT_QUARTERLY','period_end', 0, 31, 5),
  ('PF_MONTHLY',             'period_end', 0, 15, 3),
  ('ESI_MONTHLY',            'period_end', 0, 15, 3),
  ('PT_MONTHLY',             'period_end', 0, 21, 3),
  ('ITR_FILING_DUE',         'fy_end',     4, 0,  15),
  ('TAX_AUDIT_44AB',         'fy_end',     6, 0,  15),
  ('ROC_AOC4_DUE',           'fy_end',     7, 0,  15),
  ('ROC_MGT7_DUE',           'fy_end',     8, 0,  15)
) AS v(code, basis, off_m, off_d, sla)
JOIN hsdg.compliance_rules cr ON cr.code = v.code
ON CONFLICT (compliance_rule_id, version) DO NOTHING;

-- ── C. Link each statutory component to its rule ──────────────────────────
UPDATE hsdg.service_components sc
SET compliance_rule_id = cr.id
FROM (VALUES
  ('GSTR1',        'GSTR1_MONTHLY'),
  ('GSTR3B',       'GSTR3B_MONTHLY'),
  ('CMP08',        'CMP08_QUARTERLY'),
  ('GSTR9',        'GSTR9_ANNUAL'),
  ('TDS_PAYMENT',  'TDS_PAYMENT_MONTHLY'),
  ('TDS_STATEMENT','TDS_STATEMENT_QUARTERLY'),
  ('LC_PF',        'PF_MONTHLY'),
  ('LC_ESI',       'ESI_MONTHLY'),
  ('LC_PT',        'PT_MONTHLY'),
  ('ITR_FILE',     'ITR_FILING_DUE'),
  ('TA_FILING',    'TAX_AUDIT_44AB'),
  ('ROC_AOC4',     'ROC_AOC4_DUE'),
  ('ROC_MGT7',     'ROC_MGT7_DUE')
) AS m(component_code, rule_code)
JOIN hsdg.compliance_rules cr ON cr.code = m.rule_code
WHERE sc.code = m.component_code;

ALTER TABLE hsdg.compliance_rules          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                   FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.compliance_rules          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         NO FORCE ROW LEVEL SECURITY;
-- The migrator has no role context, so the referenced-instance guard below must
-- read compliance_instances with FORCE dropped — otherwise RLS hides the very
-- rows the FK protects, the guard misjudges, and the DELETE hits RESTRICT.
ALTER TABLE hsdg.compliance_instances      NO FORCE ROW LEVEL SECURITY;

-- Unlink components first (FK is ON DELETE SET NULL, but be explicit).
UPDATE hsdg.service_components SET compliance_rule_id = NULL
WHERE code IN ('GSTR1','GSTR3B','CMP08','GSTR9','TDS_PAYMENT','TDS_STATEMENT',
               'LC_PF','LC_ESI','LC_PT','ITR_FILE','TA_FILING','ROC_AOC4','ROC_MGT7');

-- A rule that has already generated instances CANNOT be deleted — the instance
-- retains its rule/version (§10, ON DELETE RESTRICT). So the down is resilient:
-- delete only the rules nothing references (versions cascade), and soft-retire
-- (is_active=false) any that an instance still points at, rather than failing.
WITH seeded AS (
  SELECT id FROM hsdg.compliance_rules WHERE code IN (
    'GSTR1_MONTHLY','GSTR3B_MONTHLY','CMP08_QUARTERLY','GSTR9_ANNUAL',
    'TDS_PAYMENT_MONTHLY','TDS_STATEMENT_QUARTERLY','PF_MONTHLY','ESI_MONTHLY',
    'PT_MONTHLY','ITR_FILING_DUE','TAX_AUDIT_44AB','ROC_AOC4_DUE','ROC_MGT7_DUE'
  )
)
UPDATE hsdg.compliance_rules cr SET is_active = false
FROM seeded
WHERE cr.id = seeded.id
  AND EXISTS (SELECT 1 FROM hsdg.compliance_instances ci WHERE ci.compliance_rule_id = cr.id);

DELETE FROM hsdg.compliance_rules cr
WHERE cr.code IN (
    'GSTR1_MONTHLY','GSTR3B_MONTHLY','CMP08_QUARTERLY','GSTR9_ANNUAL',
    'TDS_PAYMENT_MONTHLY','TDS_STATEMENT_QUARTERLY','PF_MONTHLY','ESI_MONTHLY',
    'PT_MONTHLY','ITR_FILING_DUE','TAX_AUDIT_44AB','ROC_AOC4_DUE','ROC_MGT7_DUE'
  )
  AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_instances ci WHERE ci.compliance_rule_id = cr.id);

ALTER TABLE hsdg.compliance_rules          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances      FORCE ROW LEVEL SECURITY;
