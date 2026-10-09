-- Up Migration
-- 02.2 Rules Library (Section 02.2 spec §2–§4, §8, §10–§13, §16). Every limit,
-- phase date, base date, exception and route below is DATA the 02.2 engine
-- resolves for the audit period — none of it lives in code.
--
--   • The Rule 4 roadmap as separate PHASE rules, so the engine reports the
--     exact phase that fired ("₹600 cr resolves through the ₹500 cr Phase I
--     rule"): corporate Phase I (≥ ₹500 cr, periods from 1-Apr-2016), Phase II
--     listed / in process (any net worth) and unlisted (≥ ₹250 cr) from
--     1-Apr-2017; NBFC Phase I (≥ ₹500 cr) from 1-Apr-2018, Phase II listed and
--     unlisted (≥ ₹250 cr) from 1-Apr-2019. `condition.measurementBaseDate` is
--     the Rule 4 net-worth measurement date (31-Mar-2014 / 31-Mar-2016) and
--     `firstMeetsAppliesFrom` the "first meets at a year end → next year" rule.
--   • The SME exchange / ITP exception, voluntary adoption, group relationship
--     rules (corporate and NBFC) and the specialised routes (bank, insurance,
--     other regulated entity) — so the §8 branch and §12 proviso are data too.
--   • SMC ceilings corrected to their Rules: ₹50 cr / ₹10 cr under the 2006
--     Rules up to 31-Mar-2021, ₹250 cr / ₹50 cr under the 2021 Rules after.
--   • The old single-threshold rules FRF_INDAS_NETWORTH(_NBFC) are retired
--     (kept for the conclusions that froze them, no longer resolved).
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
-- The provision join must see the library rows (FORCE RLS hides them from the migrator).
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('FRF_INDAS_CORP_P1',          'financial_reporting_framework', 'corporate_p1',          'net_worth',          '>=', 'inr',     'standalone_audited_fs'),
  ('FRF_INDAS_CORP_LISTED_P2',   'financial_reporting_framework', 'corporate_listed_p2',   'listed',             '==', 'boolean', NULL),
  ('FRF_INDAS_CORP_UNLISTED_P2', 'financial_reporting_framework', 'corporate_unlisted_p2', 'net_worth',          '>=', 'inr',     'standalone_audited_fs'),
  ('FRF_INDAS_NBFC_P1',          'financial_reporting_framework', 'nbfc_p1',               'net_worth',          '>=', 'inr',     'standalone_audited_fs'),
  ('FRF_INDAS_NBFC_LISTED_P2',   'financial_reporting_framework', 'nbfc_listed_p2',        'listed',             '==', 'boolean', NULL),
  ('FRF_INDAS_NBFC_UNLISTED_P2', 'financial_reporting_framework', 'nbfc_unlisted_p2',      'net_worth',          '>=', 'inr',     'standalone_audited_fs'),
  ('FRF_INDAS_SME_EXCEPTION',    'financial_reporting_framework', 'sme_itp',               'listing_exception',  '==', 'boolean', NULL),
  ('FRF_INDAS_VOLUNTARY',        'financial_reporting_framework', NULL,                    'voluntary_adoption', '==', 'boolean', NULL),
  ('FRF_INDAS_GROUP_CORP',       'financial_reporting_framework', 'corporate',             'group_relationship', '==', 'boolean', NULL),
  ('FRF_INDAS_GROUP_NBFC',       'financial_reporting_framework', 'nbfc',                  'group_relationship', '==', 'boolean', NULL),
  ('FRF_ROUTE_BANK',             'financial_reporting_framework', 'bank',                  'entity_route',       '==', 'boolean', NULL),
  ('FRF_ROUTE_INSURANCE',        'financial_reporting_framework', 'insurance',             'entity_route',       '==', 'boolean', NULL),
  ('FRF_ROUTE_OTHER_REGULATOR',  'financial_reporting_framework', 'other_regulator',       'entity_route',       '==', 'boolean', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome,
   authority_provision_id, condition, notes)
SELECT r.id, 1, v.eff::date, NULL, v.threshold, v.outcome, p.id, v.cond::jsonb, v.notes
FROM (VALUES
  ('FRF_INDAS_CORP_P1',          '2016-04-01', 5000000000::numeric, 'ind_as', 'INDAS_RULE_4',
     '{"measurementBaseDate":"2014-03-31","firstMeetsAppliesFrom":"next_year"}',
     'Rule 4(1)(ii): net worth ≥ ₹500 cr — periods beginning on or after 1 April 2016.'),
  ('FRF_INDAS_CORP_LISTED_P2',   '2017-04-01', 1::numeric,          'ind_as', 'INDAS_RULE_4',
     '{"measurementBaseDate":"2016-03-31"}',
     'Rule 4(1)(iii)(a): listed / in process of listing, net worth < ₹500 cr — periods from 1 April 2017.'),
  ('FRF_INDAS_CORP_UNLISTED_P2', '2017-04-01', 2500000000::numeric, 'ind_as', 'INDAS_RULE_4',
     '{"measurementBaseDate":"2016-03-31","firstMeetsAppliesFrom":"next_year"}',
     'Rule 4(1)(iii)(b): unlisted, net worth ≥ ₹250 cr and < ₹500 cr — periods from 1 April 2017.'),
  ('FRF_INDAS_NBFC_P1',          '2018-04-01', 5000000000::numeric, 'ind_as', 'INDAS_RULE_4_2A',
     '{"measurementBaseDate":"2016-03-31","firstMeetsAppliesFrom":"next_year"}',
     'Rule 4(1)(iv)(a): NBFC net worth ≥ ₹500 cr — periods from 1 April 2018.'),
  ('FRF_INDAS_NBFC_LISTED_P2',   '2019-04-01', 1::numeric,          'ind_as', 'INDAS_RULE_4_2A',
     '{"measurementBaseDate":"2016-03-31"}',
     'Rule 4(1)(iv)(b)(A): listed / in-process NBFC, net worth < ₹500 cr — periods from 1 April 2019.'),
  ('FRF_INDAS_NBFC_UNLISTED_P2', '2019-04-01', 2500000000::numeric, 'ind_as', 'INDAS_RULE_4_2A',
     '{"measurementBaseDate":"2016-03-31","firstMeetsAppliesFrom":"next_year"}',
     'Rule 4(1)(iv)(b)(B): unlisted NBFC, net worth ≥ ₹250 cr and < ₹500 cr — periods from 1 April 2019.'),
  ('FRF_INDAS_SME_EXCEPTION',    '2015-04-01', 1::numeric, 'exempt_mandatory', 'INDAS_RULE_4_PROVISO', NULL,
     'Proviso to Rule 4(1): SME exchange / ITP companies are outside the mandatory roadmap.'),
  ('FRF_INDAS_VOLUNTARY',        '2015-04-01', 1::numeric, 'ind_as', 'INDAS_RULE_4_1_I', NULL,
     'Rule 4(1)(i): voluntary adoption for periods beginning on or after 1 April 2015.'),
  ('FRF_INDAS_GROUP_CORP',       '2016-04-01', 1::numeric, 'ind_as', 'INDAS_RULE_4', NULL,
     'Rule 4(1)(ii)(c)/(iii)(c): holding, subsidiary, JV and associate companies of covered companies.'),
  ('FRF_INDAS_GROUP_NBFC',       '2018-04-01', 1::numeric, 'ind_as', 'INDAS_RULE_4_2A', NULL,
     'Rule 4(1)(iv)(c): holding, subsidiary, JV and associate companies of covered NBFCs.'),
  ('FRF_ROUTE_BANK',             '2015-04-01', 1::numeric, 'specialised_framework', 'INDAS_RULE_4', NULL,
     'Banking companies follow the RBI-directed specialised framework; the ordinary roadmap is not applied.'),
  ('FRF_ROUTE_INSURANCE',        '2015-04-01', 1::numeric, 'specialised_framework', 'INDAS_RULE_4', NULL,
     'Insurance companies follow the IRDAI-directed specialised framework; the ordinary roadmap is not applied.'),
  ('FRF_ROUTE_OTHER_REGULATOR',  '2015-04-01', 1::numeric, 'professional_review_required', NULL, NULL,
     'Other regulated entities: route to the methodology team for a professional framework review.')
) AS v(rule_code, eff, threshold, outcome, prov_code, cond, notes)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = v.prov_code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- SMC ceilings: version 1 becomes the 2006 Rules (to 31-Mar-2021), version 2 the 2021 Rules.
UPDATE hsdg.audit_rule_version v
   SET effective_from = DATE '2006-12-07',
       effective_to   = DATE '2021-03-31',
       threshold      = x.threshold,
       authority_provision_id = (SELECT id FROM hsdg.authority_provision WHERE code = 'AS_RULES_2006_SMC'),
       notes = x.notes
  FROM hsdg.audit_rule r,
       (VALUES ('FRF_SMC_TURNOVER',   500000000::numeric, 'Companies (AS) Rules 2006: turnover ≤ ₹50 cr.'),
               ('FRF_SMC_BORROWINGS', 100000000::numeric, 'Companies (AS) Rules 2006: borrowings ≤ ₹10 cr.')) AS x(code, threshold, notes)
 WHERE r.id = v.audit_rule_id AND r.code = x.code AND v.version = 1;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id, notes)
SELECT r.id, 2, DATE '2021-04-01', NULL, x.threshold, 'smc',
       (SELECT id FROM hsdg.authority_provision WHERE code = 'AS_RULES_2021_SMC'), x.notes
  FROM hsdg.audit_rule r
  JOIN (VALUES ('FRF_SMC_TURNOVER',   2500000000::numeric, 'Companies (AS) Rules 2021: turnover ≤ ₹250 cr (excluding other income).'),
               ('FRF_SMC_BORROWINGS',  500000000::numeric, 'Companies (AS) Rules 2021: borrowings ≤ ₹50 cr incl. public deposits.')) AS x(code, threshold, notes)
    ON x.code = r.code
ON CONFLICT (audit_rule_id, version) DO NOTHING;

UPDATE hsdg.audit_rule SET is_active = false
 WHERE code IN ('FRF_INDAS_NETWORTH','FRF_INDAS_NETWORTH_NBFC');

ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.audit_rule SET is_active = true
 WHERE code IN ('FRF_INDAS_NETWORTH','FRF_INDAS_NETWORTH_NBFC');

DELETE FROM hsdg.audit_rule_version v USING hsdg.audit_rule r
 WHERE r.id = v.audit_rule_id AND r.code IN ('FRF_SMC_TURNOVER','FRF_SMC_BORROWINGS') AND v.version = 2;
UPDATE hsdg.audit_rule_version v
   SET effective_from = DATE '2014-04-01', effective_to = NULL, threshold = x.threshold,
       authority_provision_id = NULL, notes = NULL
  FROM hsdg.audit_rule r,
       (VALUES ('FRF_SMC_TURNOVER', 2500000000::numeric), ('FRF_SMC_BORROWINGS', 500000000::numeric)) AS x(code, threshold)
 WHERE r.id = v.audit_rule_id AND r.code = x.code AND v.version = 1;

DELETE FROM hsdg.audit_rule WHERE code IN
  ('FRF_INDAS_CORP_P1','FRF_INDAS_CORP_LISTED_P2','FRF_INDAS_CORP_UNLISTED_P2',
   'FRF_INDAS_NBFC_P1','FRF_INDAS_NBFC_LISTED_P2','FRF_INDAS_NBFC_UNLISTED_P2',
   'FRF_INDAS_SME_EXCEPTION','FRF_INDAS_VOLUNTARY','FRF_INDAS_GROUP_CORP','FRF_INDAS_GROUP_NBFC',
   'FRF_ROUTE_BANK','FRF_ROUTE_INSURANCE','FRF_ROUTE_OTHER_REGULATOR');

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
