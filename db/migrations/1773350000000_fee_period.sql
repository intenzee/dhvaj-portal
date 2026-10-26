-- ─────────────────────────────────────────────────────────────────────────
-- CM-4 · A frequency beside every fee
--
-- The fee typed on a compliance year was always read as a yearly amount:
-- someone typing ₹5,000 meaning "per month" got ₹5,000 a year. Each year now
-- says what period its fee is for. Every existing row becomes 'annual', which
-- is exactly how it is billed today, so no invoice amount changes on deploy.
-- fee_period_set_by / _at stay null on those rows until a person saves the
-- fee with its period, so the CM-9 data check can list unconfirmed fees.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.compliance_engagement_years
  ADD COLUMN fee_period text NOT NULL DEFAULT 'annual'
    CONSTRAINT compliance_engagement_years_fee_period_check
    CHECK (fee_period IN ('monthly', 'quarterly', 'half_yearly', 'annual', 'one_time')),
  ADD COLUMN fee_period_set_by uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN fee_period_set_at timestamptz;

COMMENT ON COLUMN hsdg.compliance_engagement_years.fee_period IS
  'CM-4: the period fee_amount is for. The year''s value is fee_amount × periods in a year.';

-- Down Migration

ALTER TABLE hsdg.compliance_engagement_years
  DROP COLUMN IF EXISTS fee_period_set_at,
  DROP COLUMN IF EXISTS fee_period_set_by,
  DROP COLUMN IF EXISTS fee_period;
