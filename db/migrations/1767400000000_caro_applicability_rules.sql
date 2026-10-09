-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — 02.4 CARO 2020 applicability rules (DHVAJ 02.4 spec §3, §7, §21)
--
--   • CARO_PVT_PUBLIC_GROUP — the fourth cumulative private-company condition
--     (not a holding or subsidiary company of a public company) as a versioned
--     rule: measured 1 = relationship exists / 0 = none, exempt when == 0, over
--     the relevant period. Effective FY 2021-22 like the three limits.
--   • The three CARO limit versions gain their measurement data (spec §3:
--     included/excluded items + guidance reference) in `condition` /
--     `guidance_reference`, so the engine and the screen show exactly what was
--     measured: capital + reserves components at the balance-sheet date;
--     borrowings aggregated across banks/FIs at any point in the year; total
--     revenue incl. other income and discontinuing operations.
--   • The legacy CARO_PVT_CAPITAL rule (paid-up capital only — the pre-02.4
--     shortcut) is deactivated: the CARO test is capital + reserves & surplus.
--     Its versions stay for history (append-only).
--
-- audit_rule / audit_rule_version are FORCE RLS firm-wide tables: lift FORCE
-- for the migrator and restore it after.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis)
VALUES ('CARO_PVT_PUBLIC_GROUP', 'caro', NULL, 'public_group_relationship', '==', 'boolean', 'relevant_period')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome,
   authority_provision_id, guidance_reference, condition)
SELECT r.id, 1, '2021-04-01'::date, NULL, 0::numeric, 'exempt_condition', p.id,
       'ICAI Guidance Note on CARO 2020 (Revised 2022) — applicability, paragraph 1(2)(v)',
       '{"measure":"public_group_relationship","includes":["holding_company_of_public_company","subsidiary_company_of_public_company"],"period":"relevant_period"}'::jsonb
  FROM hsdg.audit_rule r
  LEFT JOIN hsdg.authority_provision p ON p.code = 'CARO_2020' AND p.effective_to IS NULL
 WHERE r.code = 'CARO_PVT_PUBLIC_GROUP'
ON CONFLICT (audit_rule_id, version) DO NOTHING;

UPDATE hsdg.audit_rule_version v
   SET guidance_reference = COALESCE(v.guidance_reference,
         'ICAI Guidance Note on CARO 2020 (Revised 2022) — applicability, paragraph 1(2)(v)'),
       condition = COALESCE(v.condition, c.cond_text::jsonb)
  FROM hsdg.audit_rule r
  JOIN (VALUES
    ('CARO_PVT_CAPITAL_RESERVES',
     '{"measure":"capital_and_reserves","includes":["paid_up_capital","reserves_and_surplus"],"measuredAt":"balance_sheet_date"}'),
    ('CARO_PVT_BORROWINGS',
     '{"measure":"borrowings","aggregate":true,"lenders":["bank","financial_institution"],"includes":["short_term","long_term","secured","unsecured","fluctuating_facilities"],"test":"at_any_point_in_year","yearEndOnlyInsufficient":true}'),
    ('CARO_PVT_REVENUE',
     '{"measure":"total_revenue","includes":["revenue_from_operations","other_income","discontinuing_operations"],"period":"financial_year"}')
  ) AS c(code, cond_text) ON c.code = r.code
 WHERE v.audit_rule_id = r.id;

UPDATE hsdg.audit_rule SET is_active = false WHERE code = 'CARO_PVT_CAPITAL';

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.audit_rule SET is_active = true WHERE code = 'CARO_PVT_CAPITAL';

UPDATE hsdg.audit_rule_version v
   SET condition = NULL, guidance_reference = NULL
  FROM hsdg.audit_rule r
 WHERE v.audit_rule_id = r.id
   AND r.code IN ('CARO_PVT_CAPITAL_RESERVES','CARO_PVT_BORROWINGS','CARO_PVT_REVENUE');

DELETE FROM hsdg.audit_rule WHERE code = 'CARO_PVT_PUBLIC_GROUP';

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
