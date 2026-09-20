-- ─────────────────────────────────────────────────────────────────────────
-- 0058 · Statutory Audit — 02.5 Internal Financial Controls / ICFR  (Guide §9.5)
--
-- No new table: 02.5 reuses the shared hsdg.audit_framework_subassessment table
-- (migration 0055 / 1763500000000) with sub_section_key '02.5', area_key 'ifc'.
-- This migration only adds the reference data the 02.5 engine resolves so NO
-- statutory number lives in code (guide §1, §4):
--
--   • The Section 143(3)(i) private-company ICFR-reporting exemption limits, each
--     an effective-dated rule under area 'ifc' citing COS_ACT_143_3_I, both using
--     the STRICT `<` operator (turnover exactly ₹50cr / borrowings exactly ₹25cr
--     do NOT qualify for the exemption):
--       - ICFR_EXEMPT_TURNOVER   : turnover < ₹50cr
--       - ICFR_EXEMPT_BORROWINGS : peak aggregate covered borrowings < ₹25cr
--                                  (banks + FIs + ANY body corporate, at any point)
--     Effective 2016-04-01 (the MCA private-company exemption), so a period before
--     that resolves NO rule and the engine returns Further Assessment for a private
--     company (a public company still applies).
--
-- The COS_ACT_143_3_I provision (effective 2015-04-01) was already seeded in
-- 1763000000000 and is cited period-correct by the service via resolveProvisionOn.
-- Amounts in rupees (one crore = 1e7). Reversible: the down migration removes the
-- seeded rules (the subassessment table is owned by 0055).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('ICFR_EXEMPT_TURNOVER',   'ifc', NULL, 'turnover',   '<', 'inr', 'balance_sheet_date'),
  ('ICFR_EXEMPT_BORROWINGS', 'ifc', NULL, 'borrowings', '<', 'inr', 'at_any_point_in_year')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, v.outcome, p.id
FROM (VALUES
  -- §143(3)(i) private-company exemption monetary limits (both required, strict `<`).
  ('ICFR_EXEMPT_TURNOVER',   1, '2016-04-01', NULL, 500000000::numeric, 'exempt_condition'),
  ('ICFR_EXEMPT_BORROWINGS', 1, '2016-04-01', NULL, 250000000::numeric, 'exempt_condition')
) AS v(rule_code, ver, eff, eff_to, threshold, outcome)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = 'COS_ACT_143_3_I'
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Down Migration

DELETE FROM hsdg.audit_rule WHERE code IN ('ICFR_EXEMPT_TURNOVER', 'ICFR_EXEMPT_BORROWINGS');
