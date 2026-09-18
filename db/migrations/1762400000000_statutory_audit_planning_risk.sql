-- ─────────────────────────────────────────────────────────────────────────
-- 0044 · Statutory Audit — Planning (Phase 03) + Risk (Phase 04)  (SA-4 · §21, §22)
--
-- Planning consumes the approved framework and determines strategy, materiality,
-- risks, areas, responses, resources, PBC and timing (§21). Approving Planning
-- freezes it and UNLOCKS Risk (§7 progressive unlock). Risk is the §22 register.
--
-- TABLES:
--   • audit_planning_items — one row per planning sub-area per shell (16 seeded),
--     carrying the §8/§31 professional state and the planning narrative.
--   • audit_materiality — one structured materiality record per shell (overall /
--     performance / clearly-trivial + benchmark + basis), optimistic-locked.
--   • audit_planning_approvals — the planning approval, versioned + immutable
--     (jsonb snapshot of item states + materiality); marks Phase 03 complete.
--   • audit_risks — the §22 risk register (source, FS area, assertion, rating,
--     significant/fraud flags, response, owner, reviewer, status, conclusion).
--
-- SEEDING: the 16 planning sub-areas are seeded for every EXISTING shell here and
-- (idempotently, ON CONFLICT) for new shells at provision time. Materiality is
-- created on first edit. Risks are created by the team (no seed).
--
-- IDEMPOTENCY: UNIQUE (workflow_instance_id, item_key) for planning items and
-- UNIQUE (workflow_instance_id) for materiality; approvals versioned UNIQUE
-- (workflow_instance_id, version). Risk refs are unique per shell.
--
-- SECURITY — engagement child data, same assignment-based access as the shell:
-- members SELECT, only leads (EP/manager) INSERT/UPDATE/DELETE. ENABLE (not
-- FORCE) RLS so the migrator-owned SECURITY DEFINER helpers bypass; hsdg_app is
-- never the owner. No new permission slug (endpoints reuse engagement.read /
-- engagement.manage; RLS gates).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Planning sub-areas (one per area per shell) ───────────────────────────
CREATE TABLE hsdg.audit_planning_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  item_key              text NOT NULL CHECK (item_key ~ '^[a-z0-9_]{2,60}$'),
  title                 text NOT NULL CHECK (length(trim(title)) > 0),
  state                 text NOT NULL DEFAULT 'not_started' CHECK (state IN
                          ('not_started','in_progress','complete','needs_attention')),
  narrative             text,
  updated_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  content_updated_at    timestamptz,
  sort_order            integer NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, item_key)
);
CREATE INDEX audit_planning_items_instance_idx
  ON hsdg.audit_planning_items (workflow_instance_id);
CREATE INDEX audit_planning_items_engagement_idx
  ON hsdg.audit_planning_items (engagement_id);
CREATE TRIGGER audit_planning_items_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_items
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Materiality (one record per shell) ────────────────────────────────────
CREATE TABLE hsdg.audit_materiality (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL UNIQUE
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  overall_materiality      numeric(18,2) CHECK (overall_materiality IS NULL OR overall_materiality >= 0),
  performance_materiality  numeric(18,2) CHECK (performance_materiality IS NULL OR performance_materiality >= 0),
  clearly_trivial_threshold numeric(18,2) CHECK (clearly_trivial_threshold IS NULL OR clearly_trivial_threshold >= 0),
  benchmark                text,
  basis                    text,
  decided_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at               timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_materiality_engagement_idx
  ON hsdg.audit_materiality (engagement_id);
CREATE TRIGGER audit_materiality_set_updated_at
  BEFORE UPDATE ON hsdg.audit_materiality
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Planning approvals (versioned, immutable) ─────────────────────────────
CREATE TABLE hsdg.audit_planning_approvals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version                integer NOT NULL,
  memo                   text,
  -- Immutable snapshot { items:[{itemKey,state}], materiality:{...} } (§30).
  snapshot               jsonb NOT NULL,
  approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  approved_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, version)
);
CREATE INDEX audit_planning_approvals_instance_idx
  ON hsdg.audit_planning_approvals (workflow_instance_id);
CREATE INDEX audit_planning_approvals_engagement_idx
  ON hsdg.audit_planning_approvals (engagement_id);

-- ── Risk register (§22) ───────────────────────────────────────────────────
CREATE TABLE hsdg.audit_risks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  risk_ref              text NOT NULL CHECK (length(trim(risk_ref)) > 0),
  description           text NOT NULL CHECK (length(trim(description)) > 0),
  source                text NOT NULL CHECK (source IN
                          ('fraud','error','control_deficiency','analytical_review','inquiry',
                           'prior_year','industry','going_concern','related_party','estimate',
                           'regulatory','other')),
  fs_area               text,
  assertion             text CHECK (assertion IS NULL OR assertion IN
                          ('existence','occurrence','completeness','accuracy','valuation',
                           'rights_and_obligations','cutoff','classification',
                           'presentation_and_disclosure')),
  rating                text NOT NULL DEFAULT 'moderate' CHECK (rating IN
                          ('low','moderate','high','significant')),
  is_significant        boolean NOT NULL DEFAULT false,
  is_fraud_risk         boolean NOT NULL DEFAULT false,
  response              text,
  owner_employee_id     uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewer_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'identified' CHECK (status IN
                          ('identified','response_planned','in_progress','addressed','concluded')),
  conclusion            text,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, risk_ref)
);
CREATE INDEX audit_risks_instance_idx ON hsdg.audit_risks (workflow_instance_id);
CREATE INDEX audit_risks_engagement_idx ON hsdg.audit_risks (engagement_id);
CREATE TRIGGER audit_risks_set_updated_at
  BEFORE UPDATE ON hsdg.audit_risks
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Seed the 16 planning sub-areas for every EXISTING shell ───────────────
-- New shells are seeded at provision time (idempotent, ON CONFLICT DO NOTHING).
INSERT INTO hsdg.audit_planning_items
  (workflow_instance_id, engagement_id, item_key, title, sort_order)
SELECT wi.id, wi.engagement_id, seed.item_key, seed.title, seed.sort_order
  FROM hsdg.service_workflow_instances wi
  CROSS JOIN (VALUES
    ('audit_strategy', 'Audit Strategy', 1),
    ('engagement_understanding', 'Preliminary Engagement Understanding', 2),
    ('materiality', 'Materiality', 3),
    ('overall_audit_plan', 'Overall Audit Plan', 4),
    ('audit_approach', 'Audit Approach', 5),
    ('areas_and_assertions', 'Audit Areas & Assertions', 6),
    ('risk_to_response', 'Risk-to-Response Planning', 7),
    ('audit_programme', 'Audit Procedures / Audit Programme', 8),
    ('team_allocation', 'Team & Responsibility Allocation', 9),
    ('specialist_planning', 'Specialist / Expert Planning', 10),
    ('component_planning', 'Component / Branch Planning', 11),
    ('use_of_internal_audit', 'Use of Internal Audit Work', 12),
    ('pbc_strategy', 'PBC Strategy', 13),
    ('timeline_milestones', 'Timeline & Milestones', 14),
    ('communication_review_plan', 'Communication & Review Plan', 15),
    ('significant_matters', 'Significant Matters / Consultation Plan', 16)
  ) AS seed(item_key, title, sort_order)
  WHERE wi.workflow_key = 'statutory_audit'
ON CONFLICT (workflow_instance_id, item_key) DO NOTHING;

-- ── Row Level Security (mirrors service_workflow_instances) ────────────────
ALTER TABLE hsdg.audit_planning_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_items_select ON hsdg.audit_planning_items
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_items_insert ON hsdg.audit_planning_items
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_items_update ON hsdg.audit_planning_items
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_materiality ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_materiality_select ON hsdg.audit_materiality
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_materiality_insert ON hsdg.audit_materiality
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_materiality_update ON hsdg.audit_materiality
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_planning_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_approvals_select ON hsdg.audit_planning_approvals
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_approvals_insert ON hsdg.audit_planning_approvals
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_risks_select ON hsdg.audit_risks
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_risks_insert ON hsdg.audit_risks
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_risks_update ON hsdg.audit_risks
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_risks_delete ON hsdg.audit_risks
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_risks CASCADE;
DROP TABLE IF EXISTS hsdg.audit_planning_approvals CASCADE;
DROP TABLE IF EXISTS hsdg.audit_materiality CASCADE;
DROP TABLE IF EXISTS hsdg.audit_planning_items CASCADE;
