-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-302 — cost rates, realisation and profitability.
--
--   · rate_cards: per grade, a cost rate and a charge-out rate per hour,
--     in force from a day (a later row for the grade supersedes it from its
--     own day). employee_rates: optional per-person overrides, same shape.
--   · Both are readable and writable only by holders of practice.finance
--     (Managing Partner, partners), RLS on the caller's roles; a manager
--     cannot see a rate, in the API or the database.
--   · firm_settings gains the working calendar the utilisation column uses:
--     the working weekdays (ISO 1 = Monday) and the hours in a working day.
--     compliance_holidays already holds the holidays.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Permission practice.finance ─────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('practice.finance', 'See and set cost and charge-out rates; see realisation and margins')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'practice.finance'
 WHERE r.slug IN ('managing_partner', 'partner')
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Whether one of the caller's roles holds practice.finance. Definer: the
-- role tables are FORCE RLS; this reads only the caller's own roles.
CREATE OR REPLACE FUNCTION hsdg.ctx_has_practice_finance() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM hsdg.role_permissions rp
      JOIN hsdg.roles r ON r.id = rp.role_id
      JOIN hsdg.permissions p ON p.id = rp.permission_id
     WHERE p.slug = 'practice.finance' AND r.slug = ANY (hsdg.ctx_roles()))
$$;
REVOKE ALL ON FUNCTION hsdg.ctx_has_practice_finance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_has_practice_finance() TO hsdg_app;

-- hsdg.financial_year_of(date) (billing) gives the FY a day falls in, like '2025-26'.

-- ── Rate cards ──────────────────────────────────────────────────────────
CREATE TABLE hsdg.rate_cards (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id                 uuid NOT NULL REFERENCES hsdg.grades (id) ON DELETE CASCADE,
  financial_year           text NOT NULL,
  cost_rate_per_hour       numeric(12, 2) NOT NULL CHECK (cost_rate_per_hour >= 0),
  charge_out_rate_per_hour numeric(12, 2) NOT NULL CHECK (charge_out_rate_per_hour >= 0),
  effective_from           date NOT NULL,
  created_by               uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_cards_fy CHECK (financial_year = hsdg.financial_year_of(effective_from)),
  CONSTRAINT rate_cards_one_per_day UNIQUE (grade_id, effective_from)
);
CREATE INDEX rate_cards_grade_idx ON hsdg.rate_cards (grade_id, effective_from DESC);

CREATE TABLE hsdg.employee_rates (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id              uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  cost_rate_per_hour       numeric(12, 2) NOT NULL CHECK (cost_rate_per_hour >= 0),
  charge_out_rate_per_hour numeric(12, 2) NOT NULL CHECK (charge_out_rate_per_hour >= 0),
  effective_from           date NOT NULL,
  note                     text CHECK (note IS NULL OR length(note) <= 300),
  created_by               uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_rates_one_per_day UNIQUE (employee_id, effective_from)
);
CREATE INDEX employee_rates_employee_idx ON hsdg.employee_rates (employee_id, effective_from DESC);

CREATE TRIGGER rate_cards_updated_at BEFORE UPDATE ON hsdg.rate_cards
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
CREATE TRIGGER employee_rates_updated_at BEFORE UPDATE ON hsdg.employee_rates
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

REVOKE ALL ON hsdg.rate_cards, hsdg.employee_rates FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.rate_cards, hsdg.employee_rates TO hsdg_app;

ALTER TABLE hsdg.rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.rate_cards FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.employee_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.employee_rates FORCE  ROW LEVEL SECURITY;

CREATE POLICY rate_cards_owner ON hsdg.rate_cards
  TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY rate_cards_finance ON hsdg.rate_cards
  TO hsdg_app USING (hsdg.ctx_has_practice_finance())
  WITH CHECK (hsdg.ctx_has_practice_finance());
CREATE POLICY employee_rates_owner ON hsdg.employee_rates
  TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY employee_rates_finance ON hsdg.employee_rates
  TO hsdg_app USING (hsdg.ctx_has_practice_finance())
  WITH CHECK (hsdg.ctx_has_practice_finance());

-- ── The working calendar (utilisation: available hours) ─────────────────
ALTER TABLE hsdg.firm_settings
  ADD COLUMN working_weekdays smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}'
    CHECK (cardinality(working_weekdays) BETWEEN 1 AND 7
           AND working_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  ADD COLUMN working_hours_per_day numeric(4, 2) NOT NULL DEFAULT 8
    CHECK (working_hours_per_day > 0 AND working_hours_per_day <= 24);

-- Down Migration

ALTER TABLE hsdg.firm_settings
  DROP COLUMN IF EXISTS working_hours_per_day,
  DROP COLUMN IF EXISTS working_weekdays;
DROP TABLE IF EXISTS hsdg.employee_rates;
DROP TABLE IF EXISTS hsdg.rate_cards;
DROP FUNCTION IF EXISTS hsdg.ctx_has_practice_finance();

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'practice.finance');
DELETE FROM hsdg.permissions WHERE slug = 'practice.finance';
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
