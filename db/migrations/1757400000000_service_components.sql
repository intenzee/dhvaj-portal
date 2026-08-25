-- ─────────────────────────────────────────────────────────────────────────
-- 0020 · Service Components & Component Configuration
--
-- The layer the "Service Configuration & Engagement Creation" specification
-- calls Component / Component Configuration (spec §11–§13, §16, §24, §35–§36).
-- It sits BETWEEN the service catalogue and the compliance/work instances:
--
--   SERVICE  →  COMPONENT (catalogue)  →  COMPONENT CONFIGURATION (per client)
--
-- Two objects, mirroring the compliance engine's split of firm-wide CONFIG from
-- engagement-scoped operational data:
--
--   A. service_components      — the catalogue. Which scopes/obligations are
--      available under a service, their default applicability (mandatory /
--      recommended / optional) and default frequency, and an optional link to
--      the compliance rule that governs the component's statutory deadline.
--      Firm-wide config, like `services`: any authenticated context reads;
--      only firm-wide (MP/admin) writes.
--
--   B. engagement_components   — the client-specific CONFIGURATION of a selected
--      component on one engagement: the professional applicability decision
--      (mandatory / applicable / optional / pending_review / not_applicable),
--      frequency, owner/reviewer, EP-review flag, config lifecycle status, and
--      the compliance rule VERSION snapshotted at activation (§19 "load
--      templates" — a later rule change never rewrites an active config).
--      Engagement-scoped, governed by the same is_engagement_member / _lead
--      helpers as the review and compliance engines (members read, leads write).
--
-- Additive by design: it hangs off the engagement's existing single service
-- (engagement.service_id), so no existing engagement, test, or policy changes.
-- Duplication prevention (§16, §35) is a partial unique index: at most one LIVE
-- configuration per (engagement, component) — cancelled/superseded rows do not
-- count, so a component can be removed and re-added while history is preserved.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── A. Service components (the catalogue) ─────────────────────────────────

CREATE TABLE hsdg.service_components (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            uuid NOT NULL REFERENCES hsdg.services (id) ON DELETE RESTRICT,
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,50}$'),
  name                  text NOT NULL,
  description           text,
  -- Where the discovery engine starts before the professional confirms scope.
  default_applicability text NOT NULL DEFAULT 'optional'
                          CHECK (default_applicability IN ('mandatory','recommended','optional')),
  default_frequency     text NOT NULL DEFAULT 'as_required'
                          CHECK (default_frequency IN
                            ('one_time','monthly','quarterly','half_yearly','annual','as_required')),
  -- A component that IS a statutory obligation links its rule, so discovery can
  -- preview the deadline and configuration can bind the effective rule version.
  compliance_rule_id    uuid REFERENCES hsdg.compliance_rules (id) ON DELETE SET NULL,
  display_order         integer NOT NULL DEFAULT 0,
  is_active             boolean NOT NULL DEFAULT true,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_components_service_idx ON hsdg.service_components (service_id);
CREATE INDEX service_components_rule_idx ON hsdg.service_components (compliance_rule_id);
CREATE TRIGGER service_components_set_updated_at BEFORE UPDATE ON hsdg.service_components
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── B. Engagement components (client-specific configuration) ──────────────

CREATE TABLE hsdg.engagement_components (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  service_component_id  uuid NOT NULL REFERENCES hsdg.service_components (id) ON DELETE RESTRICT,
  -- The professional applicability determination for THIS engagement (§11 output
  -- categories). Discovery proposes; the user confirms/overrides where authorised.
  applicability_status  text NOT NULL DEFAULT 'applicable'
                          CHECK (applicability_status IN
                            ('mandatory','applicable','optional','pending_review','not_applicable')),
  applicability_reason  text,
  frequency             text NOT NULL DEFAULT 'as_required'
                          CHECK (frequency IN
                            ('one_time','monthly','quarterly','half_yearly','annual','as_required')),
  owner_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewer_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ep_review_required    boolean NOT NULL DEFAULT false,
  -- Configuration lifecycle (spec §23, pragmatic subset).
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN
                            ('draft','active','on_hold','completed','cancelled','superseded')),
  start_date            date,
  end_date              date,
  notes                 text,
  -- The effective compliance rule VERSION bound at activation (§19). NULL until
  -- an activation binds it, and only for components that link a compliance rule.
  compliance_rule_version_id uuid REFERENCES hsdg.compliance_rule_versions (id) ON DELETE RESTRICT,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_components_dates CHECK (
    end_date IS NULL OR start_date IS NULL OR end_date >= start_date
  )
);
CREATE INDEX engagement_components_engagement_idx ON hsdg.engagement_components (engagement_id);
CREATE INDEX engagement_components_component_idx ON hsdg.engagement_components (service_component_id);
CREATE INDEX engagement_components_owner_idx ON hsdg.engagement_components (owner_employee_id);
CREATE INDEX engagement_components_status_idx ON hsdg.engagement_components (status);
CREATE TRIGGER engagement_components_set_updated_at BEFORE UPDATE ON hsdg.engagement_components
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Duplication prevention (§16, §35): at most one LIVE configuration per
-- (engagement, component). Cancelled/superseded rows are excluded, so a removed
-- component can be re-added and prior configurations remain as history.
CREATE UNIQUE INDEX engagement_components_live_unique
  ON hsdg.engagement_components (engagement_id, service_component_id)
  WHERE status NOT IN ('cancelled', 'superseded');

-- Belt-and-braces: a component must belong to the service of its engagement.
-- A plain trigger suffices — services and service_components are firm-wide
-- readable to any authenticated context, so there is no cross-office gap to
-- bridge (mirrors enforce_engagement_workflow_state in 0011).
CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_component_service() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM hsdg.service_components sc
    JOIN hsdg.engagements e ON e.service_id = sc.service_id
    WHERE sc.id = NEW.service_component_id AND e.id = NEW.engagement_id
  ) THEN
    RAISE EXCEPTION 'service_component must belong to the engagement''s service.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_components_enforce_service
  BEFORE INSERT OR UPDATE OF service_component_id, engagement_id ON hsdg.engagement_components
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_component_service();

-- ── Seed the catalogue (before FORCE RLS; mirrors the services seed) ──────
-- Aligned to the spec examples (§14 GST, §15 Tax Audit). compliance_rule_id is
-- resolved by LEFT JOIN, so a component links its rule only where one already
-- exists (none are seeded by migrations — an MP creates and links them later),
-- otherwise it stays NULL and discovery simply shows no deadline preview.
--
-- The seed READS hsdg.services (and hsdg.compliance_rules), both of which run
-- FORCE ROW LEVEL SECURITY. The migrator carries no `hsdg.role` context, so
-- under FORCE those SELECTs would see zero rows and the JOIN would insert
-- nothing. Same reference-data pattern as migrations 0009/0013: drop FORCE on
-- the tables we read from, seed, then restore FORCE.
ALTER TABLE hsdg.services         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.service_components
  (service_id, code, name, description, default_applicability, default_frequency,
   compliance_rule_id, display_order)
SELECT s.id, v.code, v.name, v.description, v.applicability, v.frequency, cr.id, v.display_order
FROM (VALUES
  -- GST Monthly Return (GSTR-3B service) — §14
  ('GST_MONTHLY', 'GSTR1',        'GSTR-1 (Outward Supplies)',      'Monthly statement of outward supplies.',             'mandatory',   'monthly',     'GSTR1_MONTHLY',  10),
  ('GST_MONTHLY', 'GSTR3B',       'GSTR-3B (Summary Return)',       'Monthly summary return and tax payment.',            'mandatory',   'monthly',     'GSTR3B_MONTHLY', 20),
  ('GST_MONTHLY', 'ITC_RECON',    'ITC Reconciliation',             'Reconcile input tax credit against GSTR-2B.',        'recommended', 'monthly',     NULL,             30),
  -- GST Annual Return
  ('GST_ANNUAL',  'GSTR9',        'GSTR-9 (Annual Return)',         'Annual consolidated GST return.',                    'mandatory',   'annual',      'GSTR9_ANNUAL',   10),
  ('GST_ANNUAL',  'GSTR9C',       'GSTR-9C (Reconciliation)',       'Annual reconciliation statement where applicable.',  'recommended', 'annual',      NULL,             20),
  -- Tax Audit (u/s 44AB) — §15
  ('TAX_AUDIT',   'TA_PLANNING',  'Audit Planning',                 'Scoping, risk assessment and planning.',             'mandatory',   'one_time',    NULL,             10),
  ('TAX_AUDIT',   'TA_PROCEDURES','Audit Procedures',               'Substantive procedures and documentation.',          'mandatory',   'one_time',    NULL,             20),
  ('TAX_AUDIT',   'TA_REPORT',    'Form 3CA/3CB & 3CD',             'Preparation of the tax-audit report and annexure.',  'mandatory',   'one_time',    NULL,             30),
  ('TAX_AUDIT',   'TA_FILING',    'Report Filing',                  'Upload and filing of the tax-audit report.',         'mandatory',   'one_time',    'TAX_AUDIT_44AB', 40),
  -- Statutory Audit
  ('STAT_AUDIT',  'SA_PLANNING',  'Audit Planning',                 'Engagement planning and materiality.',               'mandatory',   'one_time',    NULL,             10),
  ('STAT_AUDIT',  'SA_FIELDWORK', 'Fieldwork',                      'Substantive and controls testing.',                  'mandatory',   'one_time',    NULL,             20),
  ('STAT_AUDIT',  'SA_REPORT',    'Audit Report',                   'Preparation and issue of the auditor''s report.',    'mandatory',   'one_time',    NULL,             30),
  -- Income Tax Return
  ('ITR_FILING',  'ITR_PREP',     'Return Preparation',             'Computation and preparation of the return.',         'mandatory',   'annual',      NULL,             10),
  ('ITR_FILING',  'ITR_FILE',     'Return Filing',                  'E-filing and verification of the return.',           'mandatory',   'annual',      'ITR_FILING_DUE', 20),
  -- Book-keeping — §38
  ('BOOKKEEPING', 'BK_CLOSE',     'Monthly Book Closure',           'Monthly close of the books of account.',             'mandatory',   'monthly',     NULL,             10),
  ('BOOKKEEPING', 'BK_MIS',       'MIS Reporting',                  'Periodic management-information reporting.',         'optional',    'monthly',     NULL,             20),
  -- ROC Annual Filing
  ('ROC_ANNUAL',  'ROC_AOC4',     'AOC-4 (Financials)',             'Filing of financial statements.',                    'mandatory',   'annual',      NULL,             10),
  ('ROC_ANNUAL',  'ROC_MGT7',     'MGT-7 (Annual Return)',          'Filing of the annual return.',                       'mandatory',   'annual',      NULL,             20)
) AS v(service_code, code, name, description, applicability, frequency, rule_code, display_order)
JOIN hsdg.services s ON s.code = v.service_code
LEFT JOIN hsdg.compliance_rules cr ON cr.code = v.rule_code;

-- Restore FORCE now the seed reads are done.
ALTER TABLE hsdg.services         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;

-- ── Privileges: engagement configs preserve history (§24/§25) ─────────────
-- Removal is a soft transition to 'cancelled', never a DELETE — so the app role
-- may not hard-delete a configuration (its instances/history stay intact).
REVOKE DELETE ON hsdg.engagement_components FROM hsdg_app;

-- ── Row Level Security ─────────────────────────────────────────────────────

-- A. Catalogue: firm-wide config. Any authenticated context reads; only
-- firm-wide (MP/admin, via service.manage) writes. Fail-closed. (Mirrors
-- services_read / services_write in 0007.)
ALTER TABLE hsdg.service_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_components FORCE  ROW LEVEL SECURITY;
CREATE POLICY service_components_read ON hsdg.service_components
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY service_components_write ON hsdg.service_components
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- B. Engagement configuration: engagement-scoped. Members read; leads write —
-- the same is_engagement_member / is_engagement_lead helpers as the review and
-- compliance engines, so the platform admin (no engagement access) never
-- touches a client's component configuration.
ALTER TABLE hsdg.engagement_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_components FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_components_select ON hsdg.engagement_components
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_components_insert ON hsdg.engagement_components
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_components_update ON hsdg.engagement_components
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS engagement_components_update ON hsdg.engagement_components;
DROP POLICY IF EXISTS engagement_components_insert ON hsdg.engagement_components;
DROP POLICY IF EXISTS engagement_components_select ON hsdg.engagement_components;
DROP POLICY IF EXISTS service_components_write ON hsdg.service_components;
DROP POLICY IF EXISTS service_components_read ON hsdg.service_components;

DROP TRIGGER IF EXISTS engagement_components_enforce_service ON hsdg.engagement_components;
DROP FUNCTION IF EXISTS hsdg.enforce_engagement_component_service();

DROP TABLE IF EXISTS hsdg.engagement_components CASCADE;
DROP TABLE IF EXISTS hsdg.service_components CASCADE;
