-- ─────────────────────────────────────────────────────────────────────────
-- 0032 · Calculation methods — period-start basis + working-day offsets (§4)
--
-- Closes the remaining gaps in the §4 calculation-method set:
--   • PERIOD_START_PLUS_DAYS — a new `period_start` basis (start-anchored
--     deadlines), alongside the existing period_end.
--   • WORKING_DAYS vs CALENDAR_DAYS — `offset_working_days`: when true, the
--     day offset is counted in WORKING days (skipping weekends + holidays)
--     rather than calendar days.
-- (EVENT_DATE_MINUS_DAYS is already expressible via a negative offset_days;
--  FIXED_DATE via the fixed_date basis; MANUAL via the manual override path.)
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_rule_versions
  DROP CONSTRAINT compliance_rule_versions_calculation_basis_check;
ALTER TABLE hsdg.compliance_rule_versions
  ADD CONSTRAINT compliance_rule_versions_calculation_basis_check
  CHECK (calculation_basis IN
    ('fy_end','period_end','period_start','month_end','fixed_date','event_date'));

ALTER TABLE hsdg.compliance_rule_versions
  ADD COLUMN offset_working_days boolean NOT NULL DEFAULT false;

-- Down Migration

ALTER TABLE hsdg.compliance_rule_versions DROP COLUMN IF EXISTS offset_working_days;
ALTER TABLE hsdg.compliance_rule_versions
  DROP CONSTRAINT compliance_rule_versions_calculation_basis_check;
ALTER TABLE hsdg.compliance_rule_versions
  ADD CONSTRAINT compliance_rule_versions_calculation_basis_check
  CHECK (calculation_basis IN
    ('fy_end','period_end','month_end','fixed_date','event_date'));
