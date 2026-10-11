-- ─────────────────────────────────────────────────────────────────────────
-- 02.7 Other Companies Act & Statutory Reporting — Section 196 appointment
-- checks (DHVAJ 02.7 spec §2: "Section 196 … included only where relevant to
-- the remuneration / appointment workpaper").
--
--   MGR_TERM_MAX_YEARS   5  years — §196(2): an MD / WTD / Manager is appointed
--                                    for a term not exceeding five years at a time
--   MGR_MIN_AGE         21  years — §196(3)(a): no person below 21 years
--   MGR_AGE_SR_TRIGGER  70  years — §196(3)(a) proviso: a person who has attained
--                                    70 may be appointed only by special resolution
--
-- Runs after 1767750000000 (Track B), which seeds the COS_ACT_196 provision the
-- versions cite. The unit column has no "years" value; like AUDIT_TRAIL_RETENTION
-- and the FRAUD_*_DAYS counts the period lengths use 'date'.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.audit_rule (code, area_key, entity_class, criterion, operator, unit, measurement_basis) VALUES
  ('MGR_TERM_MAX_YEARS', 'section_143', NULL, 'managerial_term_max_years', '<=', 'date', 'appointment_term'),
  ('MGR_MIN_AGE',        'section_143', NULL, 'managerial_min_age',        '>=', 'date', 'age_at_appointment'),
  ('MGR_AGE_SR_TRIGGER', 'section_143', NULL, 'managerial_age_sr_trigger', '>=', 'date', 'age_at_appointment')
ON CONFLICT (code) DO NOTHING;

INSERT INTO hsdg.audit_rule_version
  (audit_rule_id, version, effective_from, effective_to, threshold, outcome, condition,
   authority_provision_id, notes)
SELECT r.id, v.ver, v.eff::date, NULL, v.threshold, v.outcome, NULL, p.id, v.notes
FROM (VALUES
  ('MGR_TERM_MAX_YEARS', 1, '2014-04-01', 5::numeric,  'ceiling',
     'Section 196(2) — term of an MD / WTD / Manager not exceeding five years at a time.'),
  ('MGR_MIN_AGE',        1, '2014-04-01', 21::numeric, 'floor',
     'Section 196(3)(a) — no person below the age of 21 years.'),
  ('MGR_AGE_SR_TRIGGER', 1, '2014-04-01', 70::numeric, 'special_resolution',
     'Section 196(3)(a) proviso — a person who has attained 70 only by special resolution.')
) AS v(rule_code, ver, eff, threshold, outcome, notes)
JOIN hsdg.audit_rule r ON r.code = v.rule_code
LEFT JOIN hsdg.authority_provision p ON p.code = 'COS_ACT_196' AND p.effective_to IS NULL
ON CONFLICT (audit_rule_id, version) DO NOTHING;

ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_rule_version FORCE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE hsdg.audit_rule NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.audit_rule WHERE code IN ('MGR_TERM_MAX_YEARS','MGR_MIN_AGE','MGR_AGE_SR_TRIGGER');
ALTER TABLE hsdg.audit_rule FORCE ROW LEVEL SECURITY;
