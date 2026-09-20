-- ─────────────────────────────────────────────────────────────────────────
-- 0057 · Statutory Audit — 02.4 CARO 2020 applicability  (Guide §9.4)
--
-- No new table: 02.4 reuses the shared hsdg.audit_framework_subassessment table
-- (migration 0055 / 1763500000000) with sub_section_key '02.4', area_key 'caro'.
-- This migration only adds the reference data the 02.4 engine resolves so NO
-- statutory number lives in code (guide §1, §4):
--
--   • The CARO 2020 private-company cumulative-exemption limits, each an
--     effective-dated rule under area 'caro' citing CARO_2020:
--       - CARO_PVT_CAPITAL_RESERVES : paid-up capital + reserves ≤ ₹1cr (BS date)
--       - CARO_PVT_BORROWINGS       : aggregate bank/FI borrowings ≤ ₹1cr
--                                     (peak at ANY point in the year — not year-end)
--       - CARO_PVT_REVENUE          : total revenue ≤ ₹10cr (CARO basis)
--     All effective 2021-04-01 (CARO 2020 applies FY 2021-22 onward), so a period
--     before that resolves NO rule and the engine returns Further Assessment.
--
-- The CARO_2020 provision (effective 2021-04-01) was already seeded in
-- 1763000000000 and is cited period-correct by the service via resolveProvisionOn.
-- Amounts in rupees (one crore = 1e7). Reversible: the down migration removes the
-- seeded rules (the subassessment table is owned by 0055).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- entity_class NULL: the engine only consults these inside the private-company
-- branch, and a class-agnostic rule resolves whether or not a class is passed.
INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('CARO_PVT_CAPITAL_RESERVES', 'caro', NULL, 'capital_and_reserves', '<=', 'inr', 'balance_sheet_date'),
  ('CARO_PVT_BORROWINGS',       'caro', NULL, 'borrowings',           '<=', 'inr', 'at_any_point_in_year'),
  ('CARO_PVT_REVENUE',          'caro', NULL, 'revenue',              '<=', 'inr', 'caro_measurement_basis')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, v.outcome, p.id
FROM (VALUES
  -- CARO 2020 private-company cumulative-exemption limits (all effective FY 2021-22).
  ('CARO_PVT_CAPITAL_RESERVES', 1, '2021-04-01', NULL, 10000000::numeric,  'exempt_condition'),
  ('CARO_PVT_BORROWINGS',       1, '2021-04-01', NULL, 10000000::numeric,  'exempt_condition'),
  ('CARO_PVT_REVENUE',          1, '2021-04-01', NULL, 100000000::numeric, 'exempt_condition')
) AS v(rule_code, ver, eff, eff_to, threshold, outcome)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = 'CARO_2020'
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Down Migration

DELETE FROM hsdg.audit_rule WHERE code IN
  ('CARO_PVT_CAPITAL_RESERVES', 'CARO_PVT_BORROWINGS', 'CARO_PVT_REVENUE');
