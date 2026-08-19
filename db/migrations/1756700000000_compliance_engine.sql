-- ─────────────────────────────────────────────────────────────────────────
-- 0013 · Compliance Engine
--
-- Concept D from ADR-0011 (compliance state), kept separate from lifecycle,
-- workflow, and review. Turns configurable, effective-dated statutory rules
-- into per-engagement compliance instances that SNAPSHOT the rule version used
-- to calculate them — so changing a future rule never rewrites history.
--
-- CORE PRINCIPLES (brief §10):
--   • No hard-coded statutory dates — rules are data, effective-dated + versioned.
--   • Calculation bases: fy_end / period_end / month_end / fixed_date / event_date,
--     with month/day offsets, conditional applicability, and working-day adjustment.
--   • Every instance stores compliance_rule_version_id (the version used).
--   • Changing a FUTURE rule version must NOT touch existing instances — instances
--     are snapshots, never recomputed. Rule VERSIONS are append-only (UPDATE/DELETE
--     revoked), so a referenced calculation can never be silently rewritten.
--   • Two separate clocks: STATUTORY DEADLINE and HSDG INTERNAL SLA.
--   • Overrides require a new date, actor, timestamp, reason, evidence, audit event.
--
-- Rules/versions/holidays are firm-wide administrative CONFIG (like the service
-- catalogue — managed via the API by MP/admin, `ctx_is_firmwide`). Instances and
-- overrides are engagement-scoped operational data (members read, leads write).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Compliance rules (the stable identity) ─────────────────────────────
CREATE TABLE hsdg.compliance_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{2,50}$'),
  name        text NOT NULL,
  description text,
  -- Optional link to the service this obligation attaches to (NULL = general).
  service_id  uuid REFERENCES hsdg.services (id) ON DELETE RESTRICT,
  category    text NOT NULL DEFAULT 'other'
                CHECK (category IN ('income_tax','gst','tds','roc','audit','other')),
  is_active   boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_rules_service_idx ON hsdg.compliance_rules (service_id);
CREATE TRIGGER compliance_rules_set_updated_at BEFORE UPDATE ON hsdg.compliance_rules
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 2. Rule versions (effective-dated; append-only calculation snapshots) ──
CREATE TABLE hsdg.compliance_rule_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_rule_id    uuid NOT NULL REFERENCES hsdg.compliance_rules (id) ON DELETE CASCADE,
  version               integer NOT NULL,
  -- This version governs reference dates on or after effective_from (until the
  -- next version's effective_from, or effective_to when set).
  effective_from        date NOT NULL,
  effective_to          date,
  calculation_basis     text NOT NULL CHECK (calculation_basis IN
                          ('fy_end','period_end','month_end','fixed_date','event_date')),
  offset_months         integer NOT NULL DEFAULT 0,
  offset_days           integer NOT NULL DEFAULT 0,
  -- For fixed_date basis: the recurring statutory date (e.g. 31 Oct → 10, 31).
  fixed_month           integer CHECK (fixed_month BETWEEN 1 AND 12),
  fixed_day             integer CHECK (fixed_day BETWEEN 1 AND 31),
  working_day_adjustment text NOT NULL DEFAULT 'next'
                          CHECK (working_day_adjustment IN ('none','next','previous')),
  -- Internal SLA = statutory deadline − this many days (the firm's buffer),
  -- adjusted to a working day. The two clocks stay distinct (§10).
  internal_sla_offset_days integer NOT NULL DEFAULT 0 CHECK (internal_sla_offset_days >= 0),
  -- Configurable conditional applicability, evaluated against context supplied at
  -- generation time (e.g. {"field":"turnover","op":">","value":10000000}).
  condition             jsonb,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_rule_versions_unique UNIQUE (compliance_rule_id, version),
  CONSTRAINT compliance_rule_versions_effective_unique UNIQUE (compliance_rule_id, effective_from),
  CONSTRAINT compliance_rule_versions_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- fixed_date basis needs the recurring month/day; other bases must not carry it.
  CONSTRAINT compliance_rule_versions_fixed CHECK (
    (calculation_basis = 'fixed_date' AND fixed_month IS NOT NULL AND fixed_day IS NOT NULL)
    OR (calculation_basis <> 'fixed_date' AND fixed_month IS NULL AND fixed_day IS NULL)
  )
);
CREATE INDEX compliance_rule_versions_rule_idx
  ON hsdg.compliance_rule_versions (compliance_rule_id, effective_from DESC);

-- ── 3. Holidays (working-day adjustment consults these + weekends) ─────────
CREATE TABLE hsdg.compliance_holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Compliance instances (per-engagement snapshots) ────────────────────
CREATE TABLE hsdg.compliance_instances (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id             uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  compliance_rule_id        uuid NOT NULL REFERENCES hsdg.compliance_rules (id) ON DELETE RESTRICT,
  -- THE VERSION USED — the snapshot pointer (§10). Immutable for the instance.
  compliance_rule_version_id uuid NOT NULL REFERENCES hsdg.compliance_rule_versions (id) ON DELETE RESTRICT,
  -- The basis date the calculation started from (FY end, period end, event, …).
  reference_date            date NOT NULL,
  -- STATUTORY clock: computed snapshot + optional manual override.
  statutory_deadline        date NOT NULL,
  statutory_deadline_override date,
  -- INTERNAL SLA clock (separate): computed snapshot + optional manual override.
  internal_sla_date         date NOT NULL,
  internal_sla_override     date,
  status                    text NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','completed','waived')),
  completed_at              timestamptz,
  completed_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  notes                     text,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  -- One obligation per engagement + rule + period (reference date).
  CONSTRAINT compliance_instances_unique UNIQUE (engagement_id, compliance_rule_id, reference_date),
  CONSTRAINT compliance_instances_completed CHECK (
    status <> 'completed' OR completed_at IS NOT NULL
  )
);
CREATE INDEX compliance_instances_engagement_idx ON hsdg.compliance_instances (engagement_id);
CREATE INDEX compliance_instances_rule_idx ON hsdg.compliance_instances (compliance_rule_id);
CREATE INDEX compliance_instances_open_deadline_idx
  ON hsdg.compliance_instances (statutory_deadline) WHERE status = 'open';
CREATE TRIGGER compliance_instances_set_updated_at BEFORE UPDATE ON hsdg.compliance_instances
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 5. Override history (append-only; each override is a governed event) ───
CREATE TABLE hsdg.compliance_instance_overrides (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_instance_id uuid NOT NULL REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  -- Denormalised for RLS scoping (mirrors engagement_review_points).
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  clock                  text NOT NULL CHECK (clock IN ('statutory','internal_sla')),
  previous_date          date,
  new_date               date NOT NULL,
  reason                 text NOT NULL CHECK (length(trim(reason)) > 0),
  evidence_reference     text,
  actor_user_id          uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  actor_role             text,
  correlation_id         text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compliance_instance_overrides_instance_idx
  ON hsdg.compliance_instance_overrides (compliance_instance_id, created_at DESC);

-- ── 6. Permissions ────────────────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('compliance.read',   'View compliance rules and instances'),
  ('compliance.manage', 'Configure compliance rules and manage engagement compliance');

-- compliance.read: all staff (rules + holiday calendar are firm-wide reference).
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'compliance.read';
-- compliance.manage: firm-wide statutory CONFIG authority only (MP + platform
-- admin), like service.manage. Per-engagement compliance (generate/override/
-- complete) is gated by engagement.manage + the engagement-lead RLS floor
-- instead, so the platform admin — which holds no engagement access — cannot
-- touch client compliance data.
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'compliance.manage'
WHERE r.slug IN ('managing_partner', 'admin');

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── 7. Privileges: rule versions + override log are append-only evidence ───
REVOKE UPDATE, DELETE ON hsdg.compliance_rule_versions        FROM hsdg_app;
REVOKE DELETE          ON hsdg.compliance_rules                FROM hsdg_app;
REVOKE UPDATE, DELETE ON hsdg.compliance_instance_overrides   FROM hsdg_app;
REVOKE DELETE          ON hsdg.compliance_instances            FROM hsdg_app;

-- ── 8. Row Level Security ──────────────────────────────────────────────────
-- Rules / versions / holidays: firm-wide config. Any authenticated context
-- reads; only firm-wide (system/MP/admin) writes. Fail-closed.
ALTER TABLE hsdg.compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_rules_read ON hsdg.compliance_rules
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY compliance_rules_write ON hsdg.compliance_rules
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

ALTER TABLE hsdg.compliance_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_rule_versions_read ON hsdg.compliance_rule_versions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY compliance_rule_versions_insert ON hsdg.compliance_rule_versions
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());

ALTER TABLE hsdg.compliance_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_holidays FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_holidays_read ON hsdg.compliance_holidays
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY compliance_holidays_write ON hsdg.compliance_holidays
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- Instances / overrides: engagement-scoped (members read, leads write) — the
-- same is_engagement_member/lead helpers used by the review engine.
ALTER TABLE hsdg.compliance_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_instances_select ON hsdg.compliance_instances
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY compliance_instances_insert ON hsdg.compliance_instances
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY compliance_instances_update ON hsdg.compliance_instances
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.compliance_instance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_overrides FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_instance_overrides_select ON hsdg.compliance_instance_overrides
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY compliance_instance_overrides_insert ON hsdg.compliance_instance_overrides
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS compliance_instance_overrides_insert ON hsdg.compliance_instance_overrides;
DROP POLICY IF EXISTS compliance_instance_overrides_select ON hsdg.compliance_instance_overrides;
DROP POLICY IF EXISTS compliance_instances_update ON hsdg.compliance_instances;
DROP POLICY IF EXISTS compliance_instances_insert ON hsdg.compliance_instances;
DROP POLICY IF EXISTS compliance_instances_select ON hsdg.compliance_instances;
DROP POLICY IF EXISTS compliance_holidays_write ON hsdg.compliance_holidays;
DROP POLICY IF EXISTS compliance_holidays_read ON hsdg.compliance_holidays;
DROP POLICY IF EXISTS compliance_rule_versions_insert ON hsdg.compliance_rule_versions;
DROP POLICY IF EXISTS compliance_rule_versions_read ON hsdg.compliance_rule_versions;
DROP POLICY IF EXISTS compliance_rules_write ON hsdg.compliance_rules;
DROP POLICY IF EXISTS compliance_rules_read ON hsdg.compliance_rules;

DROP TABLE IF EXISTS hsdg.compliance_instance_overrides CASCADE;
DROP TABLE IF EXISTS hsdg.compliance_instances CASCADE;
DROP TABLE IF EXISTS hsdg.compliance_holidays CASCADE;
DROP TABLE IF EXISTS hsdg.compliance_rule_versions CASCADE;
DROP TABLE IF EXISTS hsdg.compliance_rules CASCADE;

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug IN ('compliance.read','compliance.manage'));
DELETE FROM hsdg.permissions WHERE slug IN ('compliance.read','compliance.manage');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
