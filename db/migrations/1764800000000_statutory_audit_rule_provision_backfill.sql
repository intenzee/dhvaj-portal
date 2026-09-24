-- ─────────────────────────────────────────────────────────────────────────
-- 0068 · Statutory Audit — backfill rule → authority-provision links
--
-- WHY: authority_provision is FORCE ROW LEVEL SECURITY from 1763000000000.
-- The rule-version seeds in 1763100 (Rules Library), 1763400 (02.1), 1763500
-- (02.2), 1763700 (02.4), 1763800 (02.5), 1763900 (02.6) and 1764000 (02.7)
-- resolve their citation with `LEFT JOIN hsdg.authority_provision` while that
-- table is still forced. The migrator has no request context, so the join sees
-- no rows and every authority_provision_id was stored NULL — silently. The
-- engines then cite no provision (e.g. 02.1 small-company status, CARO, ICFR).
-- 1764500 (03.3) already lifts FORCE around its seed and is unaffected.
--
-- Editing the applied migrations would not repair existing databases, so this
-- backfills the intended links (codes copied from those seeds). Idempotent:
-- only NULL links are filled; SCH_III_ROUNDING and FRF_SMC_* are NULL by design.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_rule          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision NO FORCE ROW LEVEL SECURITY;

UPDATE hsdg.audit_rule_version v
   SET authority_provision_id = p.id
  FROM (VALUES
    -- 1763100 Rules Library
    ('INDAS_NETWORTH',            'INDAS_RULE_4'),
    ('CARO_PVT_CAPITAL',          'CARO_2020'),
    ('CARO_PVT_BORROWINGS',       'CARO_2020'),
    ('CARO_PVT_REVENUE',          'CARO_2020'),
    ('IA_CAPITAL',                'COS_ACT_138'),
    ('IA_TURNOVER',               'COS_ACT_138'),
    ('IA_BORROWINGS',             'COS_ACT_138'),
    ('IA_DEPOSITS',               'COS_ACT_138'),
    ('SA204_CAPITAL',             'COS_ACT_204'),
    ('SA204_TURNOVER',            'COS_ACT_204'),
    ('CSR_NETWORTH',              'COS_ACT_135'),
    ('CSR_TURNOVER',              'COS_ACT_135'),
    ('CSR_NETPROFIT',             'COS_ACT_135'),
    -- 1763400 02.1 Small company §2(85)
    ('SMALL_CO_CAPITAL',          'COS_ACT_2_85'),
    ('SMALL_CO_TURNOVER',         'COS_ACT_2_85'),
    -- 1763500 02.2 Ind AS roadmap
    ('FRF_INDAS_NETWORTH',        'INDAS_RULE_4'),
    ('FRF_INDAS_NETWORTH_NBFC',   'INDAS_RULE_4'),
    -- 1763700 02.4 CARO 2020
    ('CARO_PVT_CAPITAL_RESERVES', 'CARO_2020'),
    -- 1763800 02.5 ICFR §143(3)(i)
    ('ICFR_EXEMPT_TURNOVER',      'COS_ACT_143_3_I'),
    ('ICFR_EXEMPT_BORROWINGS',    'COS_ACT_143_3_I'),
    -- 1763900 02.6 Consolidation
    ('CFS_CONTROL_OWNERSHIP',     'AS_21'),
    ('CFS_SIGNIFICANT_INFLUENCE', 'AS_23'),
    -- 1764000 02.7 Other reporting
    ('MGMT_REMUN_LIMIT',          'COS_ACT_197'),
    ('FRAUD_CG_THRESHOLD',        'COS_ACT_143_12'),
    ('FRAUD_BOARD_REPLY_DAYS',    'AUDIT_RULE_13'),
    ('FRAUD_CG_FORWARD_DAYS',     'AUDIT_RULE_13'),
    ('AUDIT_TRAIL_RETENTION',     'AUDIT_RULE_11G')
  ) AS m(rule_code, prov_code)
  JOIN hsdg.audit_rule r          ON r.code = m.rule_code
  JOIN hsdg.authority_provision p ON p.code = m.prov_code
 WHERE v.audit_rule_id = r.id
   AND v.authority_provision_id IS NULL;

-- Fail loudly rather than silently again if a mapped provision is missing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM hsdg.audit_rule_version v
      JOIN hsdg.audit_rule r ON r.id = v.audit_rule_id
     WHERE v.authority_provision_id IS NULL
       AND r.code IN ('SMALL_CO_CAPITAL','SMALL_CO_TURNOVER','CARO_PVT_CAPITAL_RESERVES',
                      'ICFR_EXEMPT_TURNOVER','ICFR_EXEMPT_BORROWINGS','FRF_INDAS_NETWORTH')
  ) THEN
    RAISE EXCEPTION 'rule → authority_provision backfill left a statutory rule uncited';
  END IF;
END $$;

ALTER TABLE hsdg.audit_rule          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.authority_provision FORCE ROW LEVEL SECURITY;

-- Down Migration

-- Data repair only: the links are the intended values, so nothing is reverted.
SELECT 1;
