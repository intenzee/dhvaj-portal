-- ─────────────────────────────────────────────────────────────────────────
-- 0037 · Broaden statutory-rule coverage across the catalogue (§4/§6–§15)
--
-- 0035 seeded the core recurring obligations; this extends coverage to the rest
-- of the RECURRING statutory components (period- or FY-anchored). Event-driven
-- obligations (notices, appeals, refunds, e-invoice, withholding, registration
-- renewals keyed to a per-licence expiry) are intentionally NOT seeded here —
-- they need an event/trigger date at generation, not a recurring rule.
--
-- Due-date logic (same conventions as 0035): monthly/quarterly filings are
-- period_end + N (the Nth of the following month); annual/FY items are fy_end +
-- month offset; advance tax is a fixed calendar date (first instalment 15 Jun).
-- Idempotent (ON CONFLICT DO NOTHING); RLS FORCE dropped for the seed, restored.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_rules          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                   NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.compliance_rules
  (code, name, description, service_id, category, due_date_category, due_date_source)
SELECT v.code, v.name, NULL, s.id, v.category, v.due_cat, v.due_src
FROM (VALUES
  ('TCS_COLLECTION_MONTHLY',  'TCS — monthly deposit',                  'TCS_COMPLIANCE',   'tds',        'STATUTORY_FIXED', 'LAW_RULE'),
  ('TCS_STATEMENT_QUARTERLY', 'TCS — quarterly statement (27EQ)',       'TCS_COMPLIANCE',   'tds',        'STATUTORY_RULE',  'LAW_RULE'),
  ('TDS_CERTIFICATES_QTR',    'TDS — certificates (Form 16A)',          'TDS_COMPLIANCE',   'tds',        'STATUTORY_RULE',  'LAW_RULE'),
  ('LABOUR_RETURNS_QTR',      'Labour — periodic returns / challans',   'LABOUR_COMPLIANCE','other',      'STATUTORY_RULE',  'LAW_RULE'),
  ('DIR3_KYC_ANNUAL',         'Director KYC (DIR-3 KYC)',               'ROC_ANNUAL',       'roc',        'STATUTORY_RULE',  'LAW_RULE'),
  ('GSTR9C_ANNUAL',           'GSTR-9C — annual reconciliation',        'GST_ANNUAL',       'gst',        'STATUTORY_RULE',  'LAW_RULE'),
  ('GST_LUT_ANNUAL',          'LUT — annual letter of undertaking',     'GST_REGISTRATION', 'gst',        'STATUTORY_RULE',  'LAW_RULE'),
  ('ADVANCE_TAX_Q1',          'Advance Tax — first instalment (15 Jun)','ADVANCE_TAX',      'income_tax', 'STATUTORY_RULE',  'LAW_RULE')
) AS v(code, name, service_code, category, due_cat, due_src)
LEFT JOIN hsdg.services s ON s.code = v.service_code
ON CONFLICT (code) DO NOTHING;

-- Self-heal: a prior down soft-retires (is_active=false) any rule an instance
-- still references, so re-applying up must re-activate them (see 0035).
UPDATE hsdg.compliance_rules SET is_active = true
WHERE code IN ('TCS_COLLECTION_MONTHLY','TCS_STATEMENT_QUARTERLY','TDS_CERTIFICATES_QTR',
               'LABOUR_RETURNS_QTR','DIR3_KYC_ANNUAL','GSTR9C_ANNUAL','GST_LUT_ANNUAL','ADVANCE_TAX_Q1')
  AND is_active = false;

INSERT INTO hsdg.compliance_rule_versions
  (compliance_rule_id, version, effective_from, calculation_basis,
   offset_months, offset_days, fixed_month, fixed_day, working_day_adjustment,
   internal_sla_offset_days)
SELECT cr.id, 1, DATE '2015-04-01', v.basis, v.off_m, v.off_d, v.fx_m, v.fx_d, 'next', v.sla
FROM (VALUES
  ('TCS_COLLECTION_MONTHLY',  'period_end', 0, 7,  NULL::int, NULL::int, 2),
  ('TCS_STATEMENT_QUARTERLY', 'period_end', 0, 15, NULL::int, NULL::int, 5),
  ('TDS_CERTIFICATES_QTR',    'period_end', 0, 46, NULL::int, NULL::int, 5),
  ('LABOUR_RETURNS_QTR',      'period_end', 0, 15, NULL::int, NULL::int, 3),
  ('DIR3_KYC_ANNUAL',         'fy_end',     6, 0,  NULL::int, NULL::int, 15),
  ('GSTR9C_ANNUAL',           'fy_end',     9, 0,  NULL::int, NULL::int, 15),
  ('GST_LUT_ANNUAL',          'fy_end',     0, 0,  NULL::int, NULL::int, 10),
  ('ADVANCE_TAX_Q1',          'fixed_date', 0, 0,  6,         15,        7)
) AS v(code, basis, off_m, off_d, fx_m, fx_d, sla)
JOIN hsdg.compliance_rules cr ON cr.code = v.code
ON CONFLICT (compliance_rule_id, version) DO NOTHING;

-- Link each component to its rule (TA_REPORT reuses the existing tax-audit rule).
UPDATE hsdg.service_components sc
SET compliance_rule_id = cr.id
FROM (VALUES
  ('TCS_COLLECTION',  'TCS_COLLECTION_MONTHLY'),
  ('TCS_STATEMENT',   'TCS_STATEMENT_QUARTERLY'),
  ('TDS_CERTIFICATES','TDS_CERTIFICATES_QTR'),
  ('LC_RETURNS',      'LABOUR_RETURNS_QTR'),
  ('ROC_KYC',         'DIR3_KYC_ANNUAL'),
  ('GSTR9C',          'GSTR9C_ANNUAL'),
  ('GSTR_LUT',        'GST_LUT_ANNUAL'),
  ('AT_INSTALMENTS',  'ADVANCE_TAX_Q1'),
  ('TA_REPORT',       'TAX_AUDIT_44AB')
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
ALTER TABLE hsdg.compliance_instances      NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.service_components SET compliance_rule_id = NULL
WHERE code IN ('TCS_COLLECTION','TCS_STATEMENT','TDS_CERTIFICATES','LC_RETURNS',
               'ROC_KYC','GSTR9C','GSTR_LUT','AT_INSTALMENTS');
-- TA_REPORT keeps pointing at TAX_AUDIT_44AB (seeded by 0035), so leave it.

UPDATE hsdg.compliance_rules cr SET is_active = false
WHERE cr.code IN ('TCS_COLLECTION_MONTHLY','TCS_STATEMENT_QUARTERLY','TDS_CERTIFICATES_QTR',
                  'LABOUR_RETURNS_QTR','DIR3_KYC_ANNUAL','GSTR9C_ANNUAL','GST_LUT_ANNUAL','ADVANCE_TAX_Q1')
  AND EXISTS (SELECT 1 FROM hsdg.compliance_instances ci WHERE ci.compliance_rule_id = cr.id);

DELETE FROM hsdg.compliance_rules cr
WHERE cr.code IN ('TCS_COLLECTION_MONTHLY','TCS_STATEMENT_QUARTERLY','TDS_CERTIFICATES_QTR',
                  'LABOUR_RETURNS_QTR','DIR3_KYC_ANNUAL','GSTR9C_ANNUAL','GST_LUT_ANNUAL','ADVANCE_TAX_Q1')
  AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_instances ci WHERE ci.compliance_rule_id = cr.id);

ALTER TABLE hsdg.compliance_rules          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances      FORCE ROW LEVEL SECURITY;
