-- ─────────────────────────────────────────────────────────────────────────
-- Tax audit applicability (Phase 3, F-2)
--
-- One decision per Compliance engagement year: what the calculator was told
-- (turnover, receipts, cash share, presumptive scheme …), what it worked out
-- (applicable, the s.44AB clause, the reason), and a partner's or manager's
-- override with its reason. The calendar takes the decision over the PAN
-- profile and the turnover default, and the firm's radar lists it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.tax_audit_applicability (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  financial_year         text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  inputs                 jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  computed_applicable    boolean NOT NULL,
  computed_clause        text CHECK (computed_clause IN
                           ('44AB(a)','44AB(b)','44AB(c)','44AB(d)','44AB(e)')),
  computed_reason        text NOT NULL CHECK (length(computed_reason) BETWEEN 1 AND 500),
  override_applicable    boolean,
  override_reason        text CHECK (length(btrim(override_reason)) BETWEEN 1 AND 500),
  decided_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at             timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  version                integer NOT NULL DEFAULT 1,
  CHECK ((override_applicable IS NULL) = (override_reason IS NULL)),
  CHECK (computed_applicable = (computed_clause IS NOT NULL)),
  UNIQUE (engagement_id, financial_year)
);
CREATE INDEX tax_audit_applicability_year_idx ON hsdg.tax_audit_applicability (financial_year);

GRANT SELECT, INSERT, UPDATE ON hsdg.tax_audit_applicability TO hsdg_app;
ALTER TABLE hsdg.tax_audit_applicability ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_audit_applicability FORCE ROW LEVEL SECURITY;

-- The team sees the decision; the engagement's partner or manager makes it.
CREATE POLICY tax_audit_applicability_select ON hsdg.tax_audit_applicability FOR SELECT TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY tax_audit_applicability_insert ON hsdg.tax_audit_applicability FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY tax_audit_applicability_update ON hsdg.tax_audit_applicability FOR UPDATE TO hsdg_app
  USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY purge_engagement ON hsdg.tax_audit_applicability TO hsdg_migrator
  USING (current_setting('hsdg.purging', true) = 'on')
  WITH CHECK (current_setting('hsdg.purging', true) = 'on');
CREATE POLICY erase_person ON hsdg.tax_audit_applicability TO hsdg_migrator
  USING (current_setting('hsdg.erasing_person', true) = 'on')
  WITH CHECK (current_setting('hsdg.erasing_person', true) = 'on');

CREATE TRIGGER tax_audit_applicability_set_updated_at BEFORE UPDATE ON hsdg.tax_audit_applicability
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Down Migration

DROP TABLE hsdg.tax_audit_applicability;
