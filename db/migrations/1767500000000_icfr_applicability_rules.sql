-- ─────────────────────────────────────────────────────────────────────────
-- Statutory Audit — 02.5 ICFR reporting applicability rules (DHVAJ 02.5 spec v1.1 §3–§9)
--
-- Every condition of the Section 143(3)(i) private-company exemption becomes a
-- versioned Rules Library entry, so the engine holds no statutory logic:
--
--   • ICFR_OPC_ROUTE            — OPC route: exempt when the entity is an OPC
--                                 (1 == 1) AND the filing condition is met.
--   • ICFR_SMALL_COMPANY_ROUTE  — small-company route: exempt when 02.1 concludes
--                                 small company AND the filing condition is met.
--   • ICFR_FILING_CONDITION     — no default in filing financial statements (s137)
--                                 or the annual return (s92): defaults counted,
--                                 exempt only when == 0. Unknown is never "no default".
--   • ICFR_PRIVATE_MONETARY_JOIN — how the turnover and borrowing limits combine
--                                 (spec v1.1: both required → "and"). Held as rule
--                                 data so a future notification can change it.
--
-- The two monetary limits gain their measurement data:
--   • ICFR_EXEMPT_TURNOVER  — measured from the latest audited financial
--     statements (default: preceding financial year), never a current-year
--     provisional figure.
--   • ICFR_EXEMPT_BORROWINGS — aggregate borrowings from banks, financial
--     institutions and any body corporate at any point in the year; "other"
--     sources excluded; year-end-only data is insufficient.
--
-- All effective 2016-04-01 (the MCA private-company exemption), citing
-- COS_ACT_143_3_I; 02.5 Track B (1767550000000+) repoints authority to the
-- MCA exemption notification once it seeds that provision.
--
-- audit_rule / audit_rule_version are FORCE RLS firm-wide tables: lift FORCE
-- for the migrator and restore it after.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('ICFR_OPC_ROUTE',             'ifc', NULL, 'opc_route',           '==', 'boolean', 'entity_status'),
  ('ICFR_SMALL_COMPANY_ROUTE',   'ifc', NULL, 'small_company_route', '==', 'boolean', 'entity_status'),
  ('ICFR_FILING_CONDITION',      'ifc', NULL, 'filing_condition',    '==', 'boolean', 'relevant_period'),
  ('ICFR_PRIVATE_MONETARY_JOIN', 'ifc', NULL, 'monetary_join',       '==', 'boolean', 'entity_status')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome,
   authority_provision_id, guidance_reference, condition)
SELECT r.id, 1, '2016-04-01'::date, NULL, v.threshold, v.outcome, p.id, v.guidance, v.cond_text::jsonb
  FROM (VALUES
    ('ICFR_OPC_ROUTE', 1::numeric, 'exempt_route',
     'MCA notification G.S.R. 583(E) (13 June 2017) — exemption for a One Person Company, subject to the filing condition',
     '{"measure":"is_opc","source":"02.1","requiresFilingCondition":true}'),
    ('ICFR_SMALL_COMPANY_ROUTE', 1::numeric, 'exempt_route',
     'MCA notification G.S.R. 583(E) (13 June 2017) — exemption for a small company (Section 2(85)), subject to the filing condition',
     '{"measure":"is_small_company","source":"02.1","requiresFilingCondition":true}'),
    ('ICFR_FILING_CONDITION', 0::numeric, 'exempt_condition',
     'MCA notification G.S.R. 583(E) — no default in filing financial statements under Section 137 or the annual return under Section 92',
     '{"measure":"filing_defaults","sections":["137","92"],"forms":{"137":"AOC-4","92":"MGT-7"},"unknownIsNotNoDefault":true}'),
    ('ICFR_PRIVATE_MONETARY_JOIN', 1::numeric, 'exempt_condition',
     'MCA notification G.S.R. 583(E) as amended — turnover and borrowing limits for private companies',
     '{"join":"and","conditions":["ICFR_EXEMPT_TURNOVER","ICFR_EXEMPT_BORROWINGS"],"requiresFilingCondition":true}')
  ) AS v(rule_code, threshold, outcome, guidance, cond_text)
  JOIN hsdg.audit_rule r ON r.code = v.rule_code
  LEFT JOIN hsdg.authority_provision p ON p.code = 'COS_ACT_143_3_I' AND p.effective_to IS NULL
ON CONFLICT (audit_rule_id, version) DO NOTHING;

UPDATE hsdg.audit_rule SET measurement_basis = 'latest_audited_fs' WHERE code = 'ICFR_EXEMPT_TURNOVER';

UPDATE hsdg.audit_rule_version v
   SET guidance_reference = COALESCE(v.guidance_reference, c.guidance),
       condition = COALESCE(v.condition, c.cond_text::jsonb)
  FROM hsdg.audit_rule r
  JOIN (VALUES
    ('ICFR_EXEMPT_TURNOVER',
     'MCA notification G.S.R. 583(E) — turnover as per the latest audited financial statements',
     '{"measure":"turnover","source":"latest_audited_financial_statements","period":"preceding_financial_year","provisionalNotAccepted":true}'),
    ('ICFR_EXEMPT_BORROWINGS',
     'MCA notification G.S.R. 583(E) — aggregate borrowings from banks, financial institutions or any body corporate at any point of time during the financial year',
     '{"measure":"aggregate_borrowings","aggregate":true,"test":"at_any_point_in_year","sources":["bank","financial_institution","body_corporate"],"excludes":["other"],"yearEndOnlyInsufficient":true}')
  ) AS c(code, guidance, cond_text) ON c.code = r.code
 WHERE v.audit_rule_id = r.id;

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.audit_rule_version v
   SET condition = NULL, guidance_reference = NULL
  FROM hsdg.audit_rule r
 WHERE v.audit_rule_id = r.id
   AND r.code IN ('ICFR_EXEMPT_TURNOVER','ICFR_EXEMPT_BORROWINGS');

UPDATE hsdg.audit_rule SET measurement_basis = 'balance_sheet_date' WHERE code = 'ICFR_EXEMPT_TURNOVER';

DELETE FROM hsdg.audit_rule
 WHERE code IN ('ICFR_OPC_ROUTE','ICFR_SMALL_COMPANY_ROUTE','ICFR_FILING_CONDITION','ICFR_PRIVATE_MONETARY_JOIN');

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
