-- ─────────────────────────────────────────────────────────────────────────
-- 0059 · Statutory Audit — 02.6 Consolidation / Group Audit Framework  (Guide §9.6)
--
-- No new table: 02.6 reuses the shared hsdg.audit_framework_subassessment table
-- (migration 0055 / 1763500000000) with sub_section_key '02.6', area_key 'cfs'.
-- This migration only adds the reference data the 02.6 engine resolves so NO
-- statutory number lives in code (guide §1, §4):
--
--   • The two ownership PRESUMPTIONS (percentages are inputs, never the whole
--     test — the engine still honours captured control judgments and rebuttals):
--       - CFS_CONTROL_OWNERSHIP           : ownership > 50%  (AS 21 control presumption)
--       - CFS_SIGNIFICANT_INFLUENCE       : ownership >= 20% (AS 23 / Ind AS 28 presumption)
--     Effective 2014-04-01; historical versions freeze by audit period.
--
-- The §129(3), Rule 6, AS 21/23/27 and Ind AS 110/28/111 provisions were already
-- seeded in 1763000000000 (COS_ACT_129_3, ACCT_RULE_6, AS_21, AS_23, AS_27,
-- INDAS_110, INDAS_28, INDAS_111); the service cites §129(3) period-correct via
-- resolveProvisionOn. Percentages in whole numbers. Reversible: the down migration
-- removes the seeded rules (the subassessment table is owned by 0055).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('CFS_CONTROL_OWNERSHIP',     'cfs', NULL, 'control_ownership',              '>',  'percent', NULL),
  ('CFS_SIGNIFICANT_INFLUENCE', 'cfs', NULL, 'significant_influence_ownership', '>=', 'percent', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, v.outcome, p.id
FROM (VALUES
  -- Rebuttable ownership presumptions (the engine treats these as inputs only).
  ('CFS_CONTROL_OWNERSHIP',     1, '2014-04-01', NULL, 50::numeric, 'control_presumption',              'AS_21'),
  ('CFS_SIGNIFICANT_INFLUENCE', 1, '2014-04-01', NULL, 20::numeric, 'significant_influence_presumption', 'AS_23')
) AS v(rule_code, ver, eff, eff_to, threshold, outcome, prov_code)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = v.prov_code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Down Migration

DELETE FROM hsdg.audit_rule WHERE code IN ('CFS_CONTROL_OWNERSHIP', 'CFS_SIGNIFICANT_INFLUENCE');
