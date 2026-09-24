-- ─────────────────────────────────────────────────────────────────────────
-- 0064 · Statutory Audit — 03.2 Business Understanding & Preliminary Analytics
--   (DHVAJ 03.2 spec; docs/section-03-planning-build-spec.md §5.2)
--
-- TABLES:
--   • audit_business_understanding — one 03.2 record per shell: industry
--     analytics profile, BA-01 conclusion, generated conclusion summary, status.
--   • audit_understanding_section — 03.2.1–03.2.6, one row per sub-section:
--     "has anything changed?" + structured answers (field keys defined in
--     @hsdg/contracts UNDERSTANDING_SECTION_DEFS) + reviewed flag.
--   • audit_financial_dataset — 03.2.7 header (period, currency, units, sources).
--   • audit_financial_custom_metric — Manager-added metrics (custom_<slug>).
--   • audit_financial_value — one figure per (metric, period). CANONICAL metric
--     ids so a future TB module fills the same rows. NO TB import in v1. Every
--     figure records its source, preparer and timestamp (§21).
--   • audit_analytics_exception — 03.2.9 Investigation Cards, one per engine
--     rule_key (idempotent). A figure change re-snapshots `values` and flags an
--     assessed card for reassessment; a rule that stops flagging is kept.
--   • audit_planning_expectation — §14 expectation vs actual (planning only).
--
-- Analytical findings become Planning Signals in the SAME register as 03.1
-- (audit_planning_signal, source 'analytics'). No separate risk register.
--
-- SECURITY — engagement child data, same pattern as 0062/0063: members SELECT,
-- leads (EP/manager) INSERT/UPDATE/DELETE. ENABLE (not FORCE) RLS.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_business_understanding (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL UNIQUE
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'not_started' CHECK (status IN
                           ('not_started','in_progress','complete')),
  industry_profile       text NOT NULL DEFAULT 'generic' CHECK (industry_profile IN
                           ('generic','manufacturing','trading','services','construction',
                            'nbfc','section8')),
  ba01                   text CHECK (ba01 IS NULL OR ba01 IN ('yes_complete','no_further_work')),
  conclusion_summary     text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_business_understanding_engagement_idx
  ON hsdg.audit_business_understanding (engagement_id);
CREATE TRIGGER audit_business_understanding_set_updated_at
  BEFORE UPDATE ON hsdg.audit_business_understanding
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_understanding_section (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  section_key            text NOT NULL CHECK (section_key IN
                           ('business_model','governance','industry','systems','objectives',
                            'performance')),
  anything_changed       text CHECK (anything_changed IS NULL OR anything_changed IN ('yes','no')),
  answers                jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed               boolean NOT NULL DEFAULT false,
  reviewed_at            timestamptz,
  reviewed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, section_key)
);
CREATE INDEX audit_understanding_section_engagement_idx
  ON hsdg.audit_understanding_section (engagement_id);
CREATE TRIGGER audit_understanding_section_set_updated_at
  BEFORE UPDATE ON hsdg.audit_understanding_section
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_financial_dataset (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL UNIQUE
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  period_end             date,
  py_period_end          date,
  currency               text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  units                  text CHECK (units IS NULL OR units IN
                           ('inr','inr_thousand','inr_lakh','inr_crore','other')),
  py_units               text CHECK (py_units IS NULL OR py_units IN
                           ('inr','inr_thousand','inr_lakh','inr_crore','other')),
  cy_source              text,
  py_source              text,
  data_status            text CHECK (data_status IS NULL OR data_status IN
                           ('draft','final','management_accounts')),
  source_date            date,
  prepared_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_financial_dataset_engagement_idx
  ON hsdg.audit_financial_dataset (engagement_id);
CREATE TRIGGER audit_financial_dataset_set_updated_at
  BEFORE UPDATE ON hsdg.audit_financial_dataset
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_financial_custom_metric (
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  metric_key             text NOT NULL CHECK (metric_key ~ '^custom_[a-z0-9_]{1,50}$'),
  label                  text NOT NULL CHECK (length(trim(label)) > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_instance_id, metric_key)
);

CREATE TABLE hsdg.audit_financial_value (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  metric_key             text NOT NULL CHECK (metric_key ~ '^[a-z0-9_]{2,60}$'),
  period                 text NOT NULL CHECK (period IN ('cy','py')),
  amount                 numeric(20,2) NOT NULL,
  source_type            text NOT NULL CHECK (source_type IN
                           ('management_accounts','draft_fs','audited_py_fs','other')),
  source_ref             text,
  note                   text,
  entered_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  entered_at             timestamptz NOT NULL DEFAULT now(),
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, metric_key, period)
);
CREATE INDEX audit_financial_value_engagement_idx
  ON hsdg.audit_financial_value (engagement_id);
CREATE TRIGGER audit_financial_value_set_updated_at
  BEFORE UPDATE ON hsdg.audit_financial_value
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_analytics_exception (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  rule_key               text NOT NULL CHECK (rule_key ~ '^[a-z0-9_]{2,80}$'),
  methodology_version    text NOT NULL,
  observation            text NOT NULL,
  why_flagged            text NOT NULL,
  suggested_attention    text NOT NULL CHECK (suggested_attention IN
                           ('standard','enhanced','immediate_partner')),
  values                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  management_explanation text,
  explanation_by         text,
  explanation_date       date,
  evidence               text,
  assessment             text CHECK (assessment IS NULL OR assessment IN
                           ('reasonable','partially_supported','not_supported',
                            'further_information_required','not_relevant')),
  affected_areas         text[] NOT NULL DEFAULT '{}',
  signal_decision        text CHECK (signal_decision IS NULL OR signal_decision IN
                           ('create','link','none')),
  no_signal_rationale    text,
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  due_date               date,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN
                           ('open','awaiting_information','assessed')),
  needs_reassessment     boolean NOT NULL DEFAULT false,
  no_longer_flagged      boolean NOT NULL DEFAULT false,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, rule_key),
  UNIQUE (workflow_instance_id, seq),
  CONSTRAINT audit_analytics_exception_further_owner CHECK (
    assessment IS DISTINCT FROM 'further_information_required' OR owner_employee_id IS NOT NULL
  )
);
CREATE INDEX audit_analytics_exception_engagement_idx
  ON hsdg.audit_analytics_exception (engagement_id);
CREATE TRIGGER audit_analytics_exception_set_updated_at
  BEFORE UPDATE ON hsdg.audit_analytics_exception
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_planning_expectation (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  metric_key             text NOT NULL CHECK (metric_key ~ '^[a-z0-9_]{2,60}$'),
  expectation_type       text NOT NULL CHECK (expectation_type IN ('amount','range','direction')),
  expected_amount        numeric(20,2),
  expected_low           numeric(20,2),
  expected_high          numeric(20,2),
  expected_direction     text CHECK (expected_direction IS NULL OR expected_direction IN
                           ('increase','decrease','stable')),
  tolerance_pct          numeric(6,2) CHECK (tolerance_pct IS NULL OR tolerance_pct >= 0),
  basis                  text NOT NULL CHECK (basis IN
                           ('budget','prior_trend','operational_driver','management_forecast','other')),
  basis_note             text,
  requires_investigation boolean,
  conclusion             text CHECK (conclusion IS NULL OR conclusion IN
                           ('normal','explain','planning_signal')),
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_planning_expectation_shape CHECK (
    (expectation_type = 'amount' AND expected_amount IS NOT NULL)
    OR (expectation_type = 'range' AND expected_low IS NOT NULL AND expected_high IS NOT NULL
        AND expected_low <= expected_high)
    OR (expectation_type = 'direction' AND expected_direction IS NOT NULL)
  )
);
CREATE INDEX audit_planning_expectation_instance_idx
  ON hsdg.audit_planning_expectation (workflow_instance_id);
CREATE INDEX audit_planning_expectation_engagement_idx
  ON hsdg.audit_planning_expectation (engagement_id);
CREATE TRIGGER audit_planning_expectation_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_expectation
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Seed one 03.2 record per existing statutory-audit shell (new shells get-or-create).
INSERT INTO hsdg.audit_business_understanding (workflow_instance_id, engagement_id)
SELECT wi.id, wi.engagement_id
  FROM hsdg.service_workflow_instances wi
 WHERE wi.workflow_key = 'statutory_audit'
ON CONFLICT (workflow_instance_id) DO NOTHING;

-- ── Row Level Security ────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_business_understanding','audit_understanding_section',
                           'audit_financial_dataset','audit_financial_custom_metric',
                           'audit_financial_value','audit_analytics_exception',
                           'audit_planning_expectation']
  LOOP
    EXECUTE format('ALTER TABLE hsdg.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR SELECT USING (hsdg.is_engagement_member(engagement_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id)) WITH CHECK (hsdg.is_engagement_lead(engagement_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON hsdg.%I FOR DELETE USING (hsdg.is_engagement_lead(engagement_id))', t || '_delete', t);
  END LOOP;
END $$;

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_planning_expectation CASCADE;
DROP TABLE IF EXISTS hsdg.audit_analytics_exception CASCADE;
DROP TABLE IF EXISTS hsdg.audit_financial_value CASCADE;
DROP TABLE IF EXISTS hsdg.audit_financial_custom_metric CASCADE;
DROP TABLE IF EXISTS hsdg.audit_financial_dataset CASCADE;
DROP TABLE IF EXISTS hsdg.audit_understanding_section CASCADE;
DROP TABLE IF EXISTS hsdg.audit_business_understanding CASCADE;
