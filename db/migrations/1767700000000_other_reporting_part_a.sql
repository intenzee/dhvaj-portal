-- ─────────────────────────────────────────────────────────────────────────
-- 02.7 Other Companies Act & Statutory Reporting — Track A (DHVAJ 02.7 spec v1.0)
-- Build split: docs/02-7-other-reporting-build-split.md
--
--   • Rules Library (spec §2, §19) — the numbers the 02.7 engine resolves by the
--     audit period; none lives in code:
--       REM_ONE_MDWTD_MANAGER     5  % of Section 198 net profit (one MD/WTD/Manager)
--       REM_MULTI_MDWTD_MANAGER  10  % aggregate (more than one)
--       REM_NONEXEC_WITH_MGMT     1  % aggregate (directors neither MD nor WTD, where
--                                     the company has an MD/WTD/Manager)
--       REM_NONEXEC_WITHOUT_MGMT  3  % aggregate (in any other case)
--       FRAUD_INITIAL_NOTICE_DAYS 2  days (Rule 13 — report to the Board / AC)
--       AUDIT_TRAIL_EFFECTIVE_DATE   version effective 2023-04-01 = Rule 11(g) in force
--                                     for FYs commencing on/after that date
--     (MGMT_REMUN_LIMIT 11%, FRAUD_CG_THRESHOLD ₹1cr, FRAUD_BOARD_REPLY_DAYS 45,
--      FRAUD_CG_FORWARD_DAYS 15 and AUDIT_TRAIL_RETENTION 8 are in 1764000000000.)
--   • SCHEDULE_V_CEILING — the Schedule V Part II Section II effective-capital
--     bands as a versioned CHILD table (hsdg.audit_rule_band) per legal version;
--     `condition` carries the top band's excess % and whether a special
--     resolution doubles the ceilings. Amounts are ₹ per managerial person per
--     annum. LEGAL CHECK: amendment dates/amounts to be confirmed against the
--     Gazette (MCA notifications of 12 Sep 2016 / 12 Sep 2018) before go-live.
--   • hsdg.audit_reporting_card — the team's work state per 02.7 requirement card
--     (spec §16). Separate from the 02.7 sub-assessment so a card can stay Work
--     Pending (and be worked) after the framework is confirmed (spec §20).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_band NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('REM_ONE_MDWTD_MANAGER',      'section_143', NULL, 'remuneration_one_executive_percent',      '<=', 'percent', 'section_198_net_profit'),
  ('REM_MULTI_MDWTD_MANAGER',    'section_143', NULL, 'remuneration_multi_executive_percent',    '<=', 'percent', 'section_198_net_profit'),
  ('REM_NONEXEC_WITH_MGMT',      'section_143', NULL, 'remuneration_nonexec_with_mgmt_percent',  '<=', 'percent', 'section_198_net_profit'),
  ('REM_NONEXEC_WITHOUT_MGMT',   'section_143', NULL, 'remuneration_nonexec_without_mgmt_percent','<=', 'percent', 'section_198_net_profit'),
  ('FRAUD_INITIAL_NOTICE_DAYS',  'section_143', NULL, 'fraud_initial_notice_days',               '<=', 'date',    NULL),
  ('AUDIT_TRAIL_EFFECTIVE_DATE', 'rule_11',     NULL, 'audit_trail_effective',                   '>=', 'date',    NULL),
  ('SCHEDULE_V_CEILING',         'section_143', NULL, 'schedule_v_ceiling',                      '<=', 'inr',     'effective_capital')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, condition,
   authority_provision_id, notes)
SELECT r.id, v.ver, v.eff::date, v.eff_to::date, v.threshold, v.outcome, v.cond::jsonb, p.id, v.notes
FROM (VALUES
  ('REM_ONE_MDWTD_MANAGER',      1, '2014-04-01', NULL, 5::numeric,  'ceiling',  NULL, 'COS_ACT_197',
     'Section 197(1) first proviso (i) — one MD/WTD/Manager, without the special-resolution route.'),
  ('REM_MULTI_MDWTD_MANAGER',    1, '2014-04-01', NULL, 10::numeric, 'ceiling',  NULL, 'COS_ACT_197',
     'Section 197(1) first proviso (i) — more than one MD/WTD/Manager, aggregate.'),
  ('REM_NONEXEC_WITH_MGMT',      1, '2014-04-01', NULL, 1::numeric,  'ceiling',  NULL, 'COS_ACT_197',
     'Section 197(1) first proviso (ii)(A) — directors neither MD nor WTD, company has an MD/WTD/Manager.'),
  ('REM_NONEXEC_WITHOUT_MGMT',   1, '2014-04-01', NULL, 3::numeric,  'ceiling',  NULL, 'COS_ACT_197',
     'Section 197(1) first proviso (ii)(B) — directors neither MD nor WTD, in any other case.'),
  ('FRAUD_INITIAL_NOTICE_DAYS',  1, '2014-04-01', NULL, 2::numeric,  'deadline', NULL, 'AUDIT_RULE_13',
     'Rule 13(1)(a) — report to the Board / Audit Committee immediately, not later than 2 days of knowledge.'),
  ('AUDIT_TRAIL_EFFECTIVE_DATE', 1, '2023-04-01', NULL, NULL,        'in_force', NULL, 'AUDIT_RULE_11G',
     'Rule 11(g) auditor reporting applies for financial years commencing on or after 1 April 2023.'),
  ('SCHEDULE_V_CEILING',         1, '2014-04-01', '2016-09-11', NULL, 'band_table',
     '{"excess_percent": 0.01, "doubled_by_special_resolution": false}', 'SCH_V',
     'Schedule V Part II Section II as enacted (2014). LEGAL CHECK before go-live.'),
  ('SCHEDULE_V_CEILING',         2, '2016-09-12', NULL, NULL,         'band_table',
     '{"excess_percent": 0.01, "doubled_by_special_resolution": true}', 'SCH_V',
     'Schedule V Part II Section II as amended (MCA 12 Sep 2016; CG approval removed 12 Sep 2018). LEGAL CHECK before go-live.')
) AS v(rule_code, ver, eff, eff_to, threshold, outcome, cond, prov_code, notes)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = v.prov_code AND p.effective_to IS NULL
ON CONFLICT (audit_rule_id, version) DO NOTHING;

-- Schedule V bands (₹ per managerial person per annum; effective capital in ₹).
INSERT INTO hsdg.audit_rule_band (audit_rule_version_id, lower, upper, ceiling_value, label, sort_order)
SELECT rv.id, b.lower, b.upper, b.ceiling, b.label, b.sort
FROM (VALUES
  (1, NULL::numeric, 50000000::numeric,   3000000::numeric,  'Negative or less than ₹5 crore', 1),
  (1, 50000000,      1000000000,          4200000,           '₹5 crore and above but less than ₹100 crore', 2),
  (1, 1000000000,    2500000000,          6000000,           '₹100 crore and above but less than ₹250 crore', 3),
  (1, 2500000000,    NULL,                6000000,           '₹250 crore and above (plus 0.01% of the excess over ₹250 crore)', 4),
  (2, NULL::numeric, 50000000::numeric,   6000000::numeric,  'Negative or less than ₹5 crore', 1),
  (2, 50000000,      1000000000,          8400000,           '₹5 crore and above but less than ₹100 crore', 2),
  (2, 1000000000,    2500000000,          12000000,          '₹100 crore and above but less than ₹250 crore', 3),
  (2, 2500000000,    NULL,                12000000,          '₹250 crore and above (plus 0.01% of the excess over ₹250 crore)', 4)
) AS b(ver, lower, upper, ceiling, label, sort)
JOIN hsdg.audit_rule r ON r.code = 'SCHEDULE_V_CEILING'
JOIN hsdg.audit_rule_version rv ON rv.audit_rule_id = r.id AND rv.version = b.ver
WHERE NOT EXISTS (SELECT 1 FROM hsdg.audit_rule_band x WHERE x.audit_rule_version_id = rv.id);

-- FRAUD_CG_THRESHOLD by legal version: before the Companies (Audit and Auditors)
-- Amendment Rules, 2015 (in force 14 Dec 2015) every reportable fraud went to the
-- Central Government — modelled as a ₹0 threshold with the `>=` operator; the
-- ₹1 crore route applies from that date (v2).
UPDATE hsdg.audit_rule_version v
   SET effective_to = '2015-12-13', threshold = 0,
       notes = 'Rule 13 as enacted — every reportable fraud to the Central Government (₹0 threshold).'
  FROM hsdg.audit_rule r
 WHERE v.audit_rule_id = r.id AND r.code = 'FRAUD_CG_THRESHOLD' AND v.version = 1
   AND v.effective_to IS NULL;
INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, authority_provision_id, notes)
SELECT r.id, 2, '2015-12-14', NULL, 10000000, 'cg_route', p.id,
       'Section 143(12) / Rule 13 as amended 14 Dec 2015 — ₹1 crore or above to the Central Government; below it to the Audit Committee / Board.'
  FROM hsdg.audit_rule r
  LEFT JOIN hsdg.authority_provision p ON p.code = 'COS_ACT_143_12' AND p.effective_to IS NULL
 WHERE r.code = 'FRAUD_CG_THRESHOLD'
ON CONFLICT (audit_rule_id, version) DO NOTHING;

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_band FORCE ROW LEVEL SECURITY;

CREATE TABLE hsdg.audit_reporting_card (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id    uuid NOT NULL
                            REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  card_key                text NOT NULL CHECK (card_key ~ '^[a-z0-9_]{2,60}$'),
  work_status             text NOT NULL DEFAULT 'not_started'
                            CHECK (work_status IN ('not_started','work_pending','in_progress','complete','not_required')),
  -- A team override of the system reporting status (NULL = follow the system).
  reporting_status        text CHECK (reporting_status IS NULL OR reporting_status IN
                            ('not_determined','unmodified_expected','modified_wording_expected',
                             'not_applicable','cross_reference')),
  proposed_conclusion     text,
  exceptions              integer NOT NULL DEFAULT 0 CHECK (exceptions >= 0),
  exception_note          text,
  source_workpaper        text,
  reviewed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewed_at             timestamptz,
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_reporting_card_key UNIQUE (workflow_instance_id, card_key),
  -- An exception count needs a note saying what it is.
  CONSTRAINT audit_reporting_card_exception_note CHECK (
    exceptions = 0 OR (exception_note IS NOT NULL AND length(trim(exception_note)) > 0)
  ),
  CONSTRAINT audit_reporting_card_review CHECK (
    (reviewed_at IS NULL) = (reviewed_by_employee_id IS NULL)
  )
);
CREATE INDEX audit_reporting_card_engagement_idx ON hsdg.audit_reporting_card (engagement_id);
CREATE TRIGGER audit_reporting_card_set_updated_at
  BEFORE UPDATE ON hsdg.audit_reporting_card
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE DELETE ON hsdg.audit_reporting_card FROM hsdg_app;
ALTER TABLE hsdg.audit_reporting_card ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_reporting_card_select ON hsdg.audit_reporting_card
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_reporting_card_insert ON hsdg.audit_reporting_card
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_reporting_card_update ON hsdg.audit_reporting_card
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration
DROP TABLE IF EXISTS hsdg.audit_reporting_card CASCADE;

ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_band NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.audit_rule
 WHERE code IN ('REM_ONE_MDWTD_MANAGER','REM_MULTI_MDWTD_MANAGER','REM_NONEXEC_WITH_MGMT',
                'REM_NONEXEC_WITHOUT_MGMT','FRAUD_INITIAL_NOTICE_DAYS','AUDIT_TRAIL_EFFECTIVE_DATE',
                'SCHEDULE_V_CEILING');
DELETE FROM hsdg.audit_rule_version v USING hsdg.audit_rule r
 WHERE v.audit_rule_id = r.id AND r.code = 'FRAUD_CG_THRESHOLD' AND v.version = 2;
UPDATE hsdg.audit_rule_version v
   SET effective_to = NULL, threshold = 10000000, notes = NULL
  FROM hsdg.audit_rule r
 WHERE v.audit_rule_id = r.id AND r.code = 'FRAUD_CG_THRESHOLD' AND v.version = 1;
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_band FORCE ROW LEVEL SECURITY;
