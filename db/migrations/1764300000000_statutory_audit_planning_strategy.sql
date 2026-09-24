-- ─────────────────────────────────────────────────────────────────────────
-- 0063 · Statutory Audit — 03.1 remaining sub-sections
--   (DHVAJ 03.1 §13.2–§13.3, §14–§16, §18, §20; docs/section-03-planning-build-spec.md)
--
-- Completes 03.1 on top of the Planning Signal Register (0062):
--   • audit_planning_intelligence.additional_scope_required — AS-02 as an
--     explicit No / Yes answer (the text alone cannot distinguish "not answered").
--   • audit_planning_intelligence.prior_year_reviewed — continuing audits with no
--     prior-year matters to carry must say so explicitly (§14, never silent).
--   • audit_planning_consideration — strategic TIMING / RESOURCE considerations
--     (§13.2–13.3). Generated from signals, assessed by the Manager, routed to
--     03.11 / 03.8. No dates and no staff names here (no duplication).
--   • audit_prior_year_matter — 03.1.6 prior-year intelligence (manual in v1),
--     each reassessed for the current year; may create/link a signal.
--   • audit_acceptance_carry_forward — 03.1.7: every unresolved/conditional
--     Section 01 acceptance matter (audit_matter section='acceptance') is
--     converted to a signal, linked to one, or concluded with a reason.
--   • audit_planning_discussion — 03.1.8 initial engagement-team planning
--     discussion, one structured record per shell.
--   • audit_planning_matter — §18 Planning Matter / Action register.
--
-- SECURITY — same engagement-child pattern as 0062: members SELECT, leads
-- (EP/manager) INSERT/UPDATE. ENABLE (not FORCE) RLS.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.audit_planning_intelligence
  ADD COLUMN additional_scope_required boolean,
  ADD COLUMN prior_year_reviewed       boolean NOT NULL DEFAULT false;

-- ── §13.2–13.3 Strategic timing / resource considerations ────────────────
CREATE TABLE hsdg.audit_planning_consideration (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  kind                   text NOT NULL CHECK (kind IN ('timing','resource')),
  -- Idempotency key for generated considerations; NULL for Manager-added ones.
  consideration_key      text CHECK (consideration_key IS NULL
                                     OR consideration_key ~ '^[a-z0-9_]{2,60}$'),
  label                  text NOT NULL CHECK (length(trim(label)) > 0),
  basis                  text,
  -- The signal that prompted this consideration (drives the rationale gate).
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  is_auto                boolean NOT NULL DEFAULT false,
  -- timing: relevant | not_relevant | further_assessment
  -- resource: likely_required | consider_in_03_8 | not_required
  assessment             text CHECK (assessment IS NULL OR assessment IN
                           ('relevant','not_relevant','further_assessment',
                            'likely_required','consider_in_03_8','not_required')),
  rationale              text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_planning_consideration_kind_assessment CHECK (
    assessment IS NULL
    OR (kind = 'timing' AND assessment IN ('relevant','not_relevant','further_assessment'))
    OR (kind = 'resource' AND assessment IN ('likely_required','consider_in_03_8','not_required'))
  )
);
CREATE UNIQUE INDEX audit_planning_consideration_key_uk
  ON hsdg.audit_planning_consideration (workflow_instance_id, consideration_key)
  WHERE consideration_key IS NOT NULL;
CREATE INDEX audit_planning_consideration_instance_idx
  ON hsdg.audit_planning_consideration (workflow_instance_id);
CREATE INDEX audit_planning_consideration_engagement_idx
  ON hsdg.audit_planning_consideration (engagement_id);
CREATE TRIGGER audit_planning_consideration_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_consideration
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 03.1.6 Prior-year intelligence ────────────────────────────────────────
CREATE TABLE hsdg.audit_prior_year_matter (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  matter_type            text NOT NULL CHECK (matter_type IN
                           ('modified_opinion','caro_exception','control_deficiency',
                            'unadjusted_misstatement','significant_risk','major_review_point',
                            'significant_estimate','partner_focus_area')),
  description            text NOT NULL CHECK (length(trim(description)) > 0),
  source_evidence        text,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  -- Current-year reassessment; NULL until the Manager reassesses (never rolled forward).
  assessment             text CHECK (assessment IS NULL OR assessment IN
                           ('still_relevant','changed','resolved','further_assessment')),
  assessment_note        text,
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, seq),
  CONSTRAINT audit_prior_year_matter_resolved_note CHECK (
    assessment IS DISTINCT FROM 'resolved'
    OR (assessment_note IS NOT NULL AND length(trim(assessment_note)) > 0)
  )
);
CREATE INDEX audit_prior_year_matter_instance_idx
  ON hsdg.audit_prior_year_matter (workflow_instance_id);
CREATE INDEX audit_prior_year_matter_engagement_idx
  ON hsdg.audit_prior_year_matter (engagement_id);
CREATE TRIGGER audit_prior_year_matter_set_updated_at
  BEFORE UPDATE ON hsdg.audit_prior_year_matter
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 03.1.7 Acceptance matters carried forward ─────────────────────────────
CREATE TABLE hsdg.audit_acceptance_carry_forward (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  matter_id              uuid NOT NULL UNIQUE REFERENCES hsdg.audit_matter (id) ON DELETE CASCADE,
  action                 text NOT NULL CHECK (action IN
                           ('create_signal','link_signal','no_implication')),
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  reason                 text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_acceptance_carry_forward_reason CHECK (
    action <> 'no_implication' OR (reason IS NOT NULL AND length(trim(reason)) > 0)
  )
);
CREATE INDEX audit_acceptance_carry_forward_instance_idx
  ON hsdg.audit_acceptance_carry_forward (workflow_instance_id);
CREATE INDEX audit_acceptance_carry_forward_engagement_idx
  ON hsdg.audit_acceptance_carry_forward (engagement_id);
CREATE TRIGGER audit_acceptance_carry_forward_set_updated_at
  BEFORE UPDATE ON hsdg.audit_acceptance_carry_forward
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 03.1.8 Initial engagement-team planning discussion (one per shell) ────
CREATE TABLE hsdg.audit_planning_discussion (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL UNIQUE
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  discussion_date        date,
  participant_employee_ids uuid[] NOT NULL DEFAULT '{}',
  signal_ids             uuid[] NOT NULL DEFAULT '{}',
  focus_ids              uuid[] NOT NULL DEFAULT '{}',
  additional_matters     text,
  skepticism_areas       text,
  observations           text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_planning_discussion_engagement_idx
  ON hsdg.audit_planning_discussion (engagement_id);
CREATE TRIGGER audit_planning_discussion_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_discussion
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── §18 Planning Matter / Action register ─────────────────────────────────
CREATE TABLE hsdg.audit_planning_matter (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  seq                    integer NOT NULL,
  origin                 text NOT NULL CHECK (origin IN ('signal','focus_area','discussion')),
  signal_id              uuid REFERENCES hsdg.audit_planning_signal (id) ON DELETE SET NULL,
  focus_id               uuid REFERENCES hsdg.audit_area_of_focus (id) ON DELETE SET NULL,
  title                  text NOT NULL CHECK (length(trim(title)) > 0),
  category               text NOT NULL CHECK (category IN
                           ('scope','information','timing','resource','reporting',
                            'technology','component','specialist','other')),
  owner_employee_id      uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  due_date               date,
  partner_attention      boolean NOT NULL DEFAULT false,
  affected_module        text CHECK (affected_module IS NULL OR affected_module IN
                           ('03.2','03.3','03.4','03.5','03.6','03.7','03.8','03.9',
                            '03.10','03.11')),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN
                           ('open','in_progress','resolved','carried_forward')),
  resolution             text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, seq),
  CONSTRAINT audit_planning_matter_resolution CHECK (
    status <> 'resolved' OR (resolution IS NOT NULL AND length(trim(resolution)) > 0)
  )
);
CREATE INDEX audit_planning_matter_instance_idx
  ON hsdg.audit_planning_matter (workflow_instance_id);
CREATE INDEX audit_planning_matter_engagement_idx
  ON hsdg.audit_planning_matter (engagement_id);
CREATE TRIGGER audit_planning_matter_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_matter
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security (mirrors 0062) ─────────────────────────────────────
ALTER TABLE hsdg.audit_planning_consideration ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_consideration_select ON hsdg.audit_planning_consideration
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_consideration_insert ON hsdg.audit_planning_consideration
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_consideration_update ON hsdg.audit_planning_consideration
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_prior_year_matter ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_prior_year_matter_select ON hsdg.audit_prior_year_matter
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_prior_year_matter_insert ON hsdg.audit_prior_year_matter
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_prior_year_matter_update ON hsdg.audit_prior_year_matter
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_acceptance_carry_forward ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_acceptance_carry_forward_select ON hsdg.audit_acceptance_carry_forward
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_acceptance_carry_forward_insert ON hsdg.audit_acceptance_carry_forward
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_acceptance_carry_forward_update ON hsdg.audit_acceptance_carry_forward
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_planning_discussion ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_discussion_select ON hsdg.audit_planning_discussion
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_discussion_insert ON hsdg.audit_planning_discussion
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_discussion_update ON hsdg.audit_planning_discussion
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_planning_matter ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_matter_select ON hsdg.audit_planning_matter
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_matter_insert ON hsdg.audit_planning_matter
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_matter_update ON hsdg.audit_planning_matter
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_planning_matter CASCADE;
DROP TABLE IF EXISTS hsdg.audit_planning_discussion CASCADE;
DROP TABLE IF EXISTS hsdg.audit_acceptance_carry_forward CASCADE;
DROP TABLE IF EXISTS hsdg.audit_prior_year_matter CASCADE;
DROP TABLE IF EXISTS hsdg.audit_planning_consideration CASCADE;
ALTER TABLE hsdg.audit_planning_intelligence
  DROP COLUMN IF EXISTS prior_year_reviewed,
  DROP COLUMN IF EXISTS additional_scope_required;
