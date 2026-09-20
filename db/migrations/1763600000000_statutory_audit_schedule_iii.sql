-- ─────────────────────────────────────────────────────────────────────────
-- 0056 · Statutory Audit — 02.3 Schedule III presentation framework  (Guide §9.3)
--
-- No new table: 02.3 reuses the shared hsdg.audit_framework_subassessment table
-- (migration 0055 / 1763500000000) with sub_section_key '02.3', area_key
-- 'schedule_iii'. This migration only adds the reference data the 02.3 engine
-- resolves so NO statutory number lives in code (guide §1, §4):
--
--   • SCH_III_ROUNDING — the Schedule III General-Instructions rounding turnover
--     band. Turnover below the band → round to hundreds/thousands/lakhs/millions;
--     at or above → lakhs/millions/crores. Effective-dated so a future change to
--     the band affects future periods only. The Schedule III Division provisions
--     (SCH_III_DIV_I/II/III) were already seeded in 1763000000000 and are cited
--     period-correct by the service via resolveProvisionOn.
--   • COS_ACT_2_40 — Section 2(40) proviso, the authority for the cash-flow
--     statement exemption (OPC / small / dormant), cited in the 02.3 detail.
--
-- Amounts in rupees (one crore = 1e7). Reversible: the down migration removes the
-- seeded rule and provision (the subassessment table is owned by 0055).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Section 2(40) proviso — cash-flow statement exemption authority (§5) ─────
INSERT INTO hsdg.authority_provision
  (code, authority, title, provision_number, effective_from, source_reference)
VALUES
  ('COS_ACT_2_40', 'MCA', 'Financial statement — cash flow statement exemption', 'Section 2(40)',
   '2014-04-01', 'Companies Act 2013, s.2(40) proviso')
ON CONFLICT (code) DO NOTHING;

-- ── Schedule III rounding turnover band into the Audit Rules Library (§4, §9.3) ─
-- The rounding units are presentation labels (in code); only the band THRESHOLD
-- is statutory, so it lives here. One version effective from the Schedule III
-- commencement; a later amendment would be a NEW effective-dated version.
INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('SCH_III_ROUNDING', 'schedule_iii', NULL, 'turnover', '>=', 'inr', 'balance_sheet_date')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, v.outcome, NULL
FROM (VALUES
  -- Rounding band split: turnover ≥ ₹100cr → higher (lakhs/millions/crores) band.
  ('SCH_III_ROUNDING', 1, '2014-04-01', NULL, 1000000000::numeric, 'higher_band')
) AS v(rule_code, ver, eff, eff_to, threshold, outcome)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Down Migration

DELETE FROM hsdg.audit_rule WHERE code = 'SCH_III_ROUNDING';
DELETE FROM hsdg.authority_provision WHERE code = 'COS_ACT_2_40';
