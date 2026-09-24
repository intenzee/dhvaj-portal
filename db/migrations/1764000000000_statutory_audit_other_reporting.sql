-- ─────────────────────────────────────────────────────────────────────────
-- 0060 · Statutory Audit — 02.7 Other Companies Act & Statutory Reporting (§9.7)
--
-- No new table: 02.7 reuses the shared hsdg.audit_framework_subassessment table
-- (migration 0055 / 1763500000000) with sub_section_key '02.7', area_key
-- 'other_regulatory'. This migration only adds the reference data the 02.7 engine
-- resolves so NO statutory number/date lives in code (guide §1, §4):
--
--   • MGMT_REMUN_LIMIT  — the §197 overall managerial-remuneration ceiling as a
--     % of Section 198 net profit (11%).  area 'section_143'.
--   • FRAUD_CG_THRESHOLD — the §143(12) amount at/above which the Central
--     Government route applies (₹1cr).  area 'section_143'.
--   • FRAUD_BOARD_REPLY_DAYS / FRAUD_CG_FORWARD_DAYS — the Rule 13 deadline
--     offsets (45 days to seek the Board/AC reply; 15 days to forward to the CG).
--   • AUDIT_TRAIL_RETENTION — the Sec 128(5) preservation period (8 years) for
--     the Rule 11(g) audit trail.  area 'rule_11'.
--
-- Rule 11(g)'s effective date is the AUDIT_RULE_11G provision's (FY 2023-24),
-- resolved period-correct by the service. The §197(16), §198, §143(12), Schedule
-- V and Rule 13 provisions were already seeded in 1763000000000. Durations use
-- unit 'date' (a count of days/years in `threshold`). Reversible below.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
-- The methodology seed below writes firm-wide library tables that are FORCE
-- RLS; lift FORCE for the migrator (no request context) and restore it after,
-- as catalogue_templates (1760200000000) does.
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;


INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('MGMT_REMUN_LIMIT',       'section_143', NULL, 'managerial_remuneration_percent', '<=', 'percent', 'section_198_net_profit'),
  ('FRAUD_CG_THRESHOLD',     'section_143', NULL, 'fraud_reporting_threshold',       '>=', 'inr',     NULL),
  ('FRAUD_BOARD_REPLY_DAYS', 'section_143', NULL, 'board_reply_days',                '<=', 'date',    NULL),
  ('FRAUD_CG_FORWARD_DAYS',  'section_143', NULL, 'cg_forward_days',                 '<=', 'date',    NULL),
  ('AUDIT_TRAIL_RETENTION',  'rule_11',     NULL, 'retention_years',                 '>=', 'date',    NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, v.outcome, p.id
FROM (VALUES
  ('MGMT_REMUN_LIMIT',       1, '2014-04-01', NULL, 11::numeric,       'ceiling',   'COS_ACT_197'),
  ('FRAUD_CG_THRESHOLD',     1, '2014-04-01', NULL, 10000000::numeric, 'cg_route',  'COS_ACT_143_12'),
  ('FRAUD_BOARD_REPLY_DAYS', 1, '2014-04-01', NULL, 45::numeric,       'deadline',  'AUDIT_RULE_13'),
  ('FRAUD_CG_FORWARD_DAYS',  1, '2014-04-01', NULL, 15::numeric,       'deadline',  'AUDIT_RULE_13'),
  ('AUDIT_TRAIL_RETENTION',  1, '2014-04-01', NULL, 8::numeric,        'retention', 'AUDIT_RULE_11G')
) AS v(rule_code, ver, eff, eff_to, threshold, outcome, prov_code)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = v.prov_code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Restore FORCE RLS on the library tables (see top of Up).
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Down Migration

DELETE FROM hsdg.audit_rule WHERE code IN
  ('MGMT_REMUN_LIMIT', 'FRAUD_CG_THRESHOLD', 'FRAUD_BOARD_REPLY_DAYS', 'FRAUD_CG_FORWARD_DAYS', 'AUDIT_TRAIL_RETENTION');
