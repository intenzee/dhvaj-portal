-- ─────────────────────────────────────────────────────────────────────────
-- 0021 · Component Instances (recurring work generation)
--
-- The operational output of a configured component (spec §21–§22, §36
-- `component_instances`). A recurring component (e.g. GSTR-1, monthly) generates
-- one instance per period of the engagement's financial year; a one-time
-- component generates a single instance. Generation is IDEMPOTENT — a unique
-- key on (engagement_component, period) means re-running never duplicates, and
-- extends the set as new periods come into range (§21 "extend automatically …
-- without creating duplicates").
--
-- The engagement is scoped to ONE financial year, so the period set is naturally
-- bounded by that FY (12 months / 4 quarters / 2 halves / 1 year) — no infinite
-- horizon. Multi-year recurrence is a successor engagement per FY (the existing
-- predecessor_engagement_id chain), each generating its own year's instances.
--
-- Each instance snapshots the compliance rule VERSION used to compute its
-- deadline (where the component links a rule), mirroring compliance_instances —
-- so a later rule change never rewrites an existing instance. Two clocks
-- (statutory + internal SLA) are carried, both nullable (a component need not be
-- a statutory obligation). Engagement-scoped RLS (members read, leads write).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.component_instances (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_component_id   uuid NOT NULL REFERENCES hsdg.engagement_components (id) ON DELETE CASCADE,
  -- Denormalised for RLS scoping (mirrors compliance_instance_overrides).
  engagement_id             uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- Stable period identity, e.g. '2026-04' (monthly), '2026-27-Q1', '2026-27'.
  period_key                text NOT NULL CHECK (length(trim(period_key)) > 0),
  period_label              text NOT NULL,
  period_start              date NOT NULL,
  period_end                date NOT NULL,
  -- Deadlines: nullable (a component need not be a statutory obligation). When
  -- the component links a compliance rule, these are the computed snapshot.
  statutory_deadline        date,
  internal_sla_date         date,
  -- THE VERSION USED — the snapshot pointer, immutable for the instance.
  compliance_rule_version_id uuid REFERENCES hsdg.compliance_rule_versions (id) ON DELETE RESTRICT,
  status                    text NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled','active','completed','waived','cancelled')),
  completed_at              timestamptz,
  completed_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  notes                     text,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT component_instances_period CHECK (period_end >= period_start),
  CONSTRAINT component_instances_completed CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  -- No duplicate period per component (§21/§35).
  CONSTRAINT component_instances_unique UNIQUE (engagement_component_id, period_key)
);
CREATE INDEX component_instances_component_idx ON hsdg.component_instances (engagement_component_id);
CREATE INDEX component_instances_engagement_idx ON hsdg.component_instances (engagement_id);
CREATE INDEX component_instances_status_idx ON hsdg.component_instances (status);
CREATE INDEX component_instances_open_deadline_idx
  ON hsdg.component_instances (statutory_deadline)
  WHERE status IN ('scheduled', 'active') AND statutory_deadline IS NOT NULL;
CREATE TRIGGER component_instances_set_updated_at BEFORE UPDATE ON hsdg.component_instances
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Instances are operational history — completed/filed work is not hard-deleted
-- (§25); removal is a soft transition to 'cancelled'.
REVOKE DELETE ON hsdg.component_instances FROM hsdg_app;

-- ── Row Level Security (engagement-scoped: members read, leads write) ─────
ALTER TABLE hsdg.component_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.component_instances FORCE  ROW LEVEL SECURITY;
CREATE POLICY component_instances_select ON hsdg.component_instances
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY component_instances_insert ON hsdg.component_instances
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY component_instances_update ON hsdg.component_instances
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS component_instances_update ON hsdg.component_instances;
DROP POLICY IF EXISTS component_instances_insert ON hsdg.component_instances;
DROP POLICY IF EXISTS component_instances_select ON hsdg.component_instances;
DROP TABLE IF EXISTS hsdg.component_instances CASCADE;
