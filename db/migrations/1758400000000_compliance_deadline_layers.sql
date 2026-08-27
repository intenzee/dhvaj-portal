-- ─────────────────────────────────────────────────────────────────────────
-- 0030 · Compliance deadline layers (spec §16 — one component, many deadlines)
--
-- The spec is explicit that a single component/obligation can carry MULTIPLE
-- deadline layers, each surfaced as its OWN calendar event:
--
--   GSTR-1 → statutory filing (STATUTORY_FIXED) · HSDG preparation (HSDG_RECURRING)
--            · manager review (HSDG_MILESTONE) · EP review (HSDG_MILESTONE)
--   Tax Audit → PBC complete · fieldwork complete · manager/EP review · filing
--
-- The compliance_instance already carries the two anchor clocks (statutory +
-- internal SLA). This table holds the ADDITIONAL milestone layers hanging off an
-- obligation: preparation targets and review/stage gates. Each layer is its own
-- event — its own frozen due-date CATEGORY (§2), date, owner and status — so the
-- calendar can surface them separately (see the flattened events endpoint).
--
-- Engagement-scoped operational data: members read, leads write (the same
-- is_engagement_member/_lead helpers as compliance_instances and the review
-- engine). Deleting the parent obligation cascades its layers.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.compliance_instance_deadlines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_instance_id   uuid NOT NULL REFERENCES hsdg.compliance_instances (id) ON DELETE CASCADE,
  -- Denormalised for RLS scoping (mirrors compliance_instance_overrides).
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  layer_type               text NOT NULL CHECK (layer_type IN
                             ('hsdg_preparation','manager_review','ep_review',
                              'pbc_complete','fieldwork_complete','custom')),
  label                    text NOT NULL CHECK (length(trim(label)) > 0),
  -- The frozen due-date category (§2) this layer is generated under.
  due_date_category        text NOT NULL CHECK (due_date_category IN
                             ('STATUTORY_FIXED','STATUTORY_RULE','STATUTORY_EVENT','GOVT_EXTENSION',
                              'HSDG_RECURRING','HSDG_MILESTONE','CLIENT_COMMITTED','TASK_DEADLINE',
                              'EVENT_SLA','NO_FIXED_DATE')),
  due_date                 date NOT NULL,
  owner_employee_id        uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','completed','waived')),
  completed_at             timestamptz,
  completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  notes                    text,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_deadlines_completed CHECK (
    status <> 'completed' OR completed_at IS NOT NULL
  )
);
CREATE INDEX compliance_deadlines_instance_idx
  ON hsdg.compliance_instance_deadlines (compliance_instance_id);
CREATE INDEX compliance_deadlines_engagement_idx
  ON hsdg.compliance_instance_deadlines (engagement_id);
CREATE INDEX compliance_deadlines_open_due_idx
  ON hsdg.compliance_instance_deadlines (due_date) WHERE status = 'open';
-- At most one of each STANDARD layer per obligation; 'custom' can repeat.
CREATE UNIQUE INDEX compliance_deadlines_standard_unique
  ON hsdg.compliance_instance_deadlines (compliance_instance_id, layer_type)
  WHERE layer_type <> 'custom';
CREATE TRIGGER compliance_deadlines_set_updated_at BEFORE UPDATE
  ON hsdg.compliance_instance_deadlines
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Append-only-ish: keep the completion history honest (no silent edits of the
-- clock outside the service's versioned update path is not enforced here, but
-- deletes are allowed for leads to remove a mis-added layer before completion).

-- ── Row Level Security: engagement-scoped (members read, leads write) ──────
ALTER TABLE hsdg.compliance_instance_deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_deadlines FORCE  ROW LEVEL SECURITY;
CREATE POLICY compliance_deadlines_select ON hsdg.compliance_instance_deadlines
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY compliance_deadlines_insert ON hsdg.compliance_instance_deadlines
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY compliance_deadlines_update ON hsdg.compliance_instance_deadlines
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY compliance_deadlines_delete ON hsdg.compliance_instance_deadlines
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS compliance_deadlines_delete ON hsdg.compliance_instance_deadlines;
DROP POLICY IF EXISTS compliance_deadlines_update ON hsdg.compliance_instance_deadlines;
DROP POLICY IF EXISTS compliance_deadlines_insert ON hsdg.compliance_instance_deadlines;
DROP POLICY IF EXISTS compliance_deadlines_select ON hsdg.compliance_instance_deadlines;
DROP TABLE IF EXISTS hsdg.compliance_instance_deadlines CASCADE;
