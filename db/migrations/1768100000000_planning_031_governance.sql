-- ─────────────────────────────────────────────────────────────────────────
-- 03.1 Planning Intelligence — governance & dynamics (DHVAJ 03.1 §19, §20,
-- §23, §24; Track B of the 03.1 gap build).
--
--   • §23 permissions — Article/Senior (engagement team members) may add
--     factual information and evidence and PROPOSE signals; only the EP /
--     Engagement Manager assess, establish strategy and complete. RLS is
--     widened just enough for the team's rows (a proposal must be the
--     member's own and unassessed); the API enforces the per-role matrix.
--   • audit_planning_attention — one governance row per Planning Signal /
--     Area of Focus: when the Manager was alerted to a new Enhanced /
--     Immediate signal (§19) and when an Immediate Partner Attention item was
--     surfaced to the EP, plus the EP's acknowledge / challenge and the
--     Manager's response (§10, §20 "surfaced to the EP").
--   • audit_planning_evidence — SharePoint-backed evidence links (§24) on
--     signals, PI-01 changes, prior-year matters, acceptance matters and the
--     team discussion; the legacy single document_id columns are backfilled.
--   • audit_planning_intelligence_revision — controlled revision of 03.1
--     after Planning approval (03.12): v1.0 → v1.1 with a frozen baseline.
--   • notifications gain the three 03.1 types.
--
-- RLS: ENABLE (not FORCE) like every 03.x table; members SELECT.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── §23 proposals by the engagement team ──────────────────────────────────
ALTER TABLE hsdg.audit_planning_signal
  ADD COLUMN proposed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN proposed_at timestamptz;

DROP POLICY audit_planning_signal_insert ON hsdg.audit_planning_signal;
CREATE POLICY audit_planning_signal_insert ON hsdg.audit_planning_signal
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND proposed_by_employee_id = hsdg.ctx_employee_id()
        AND manager_assessment IS NULL)
  );

-- PI-01 factual information (what changed / date / source) — team may record.
DROP POLICY audit_planning_change_insert ON hsdg.audit_planning_change;
CREATE POLICY audit_planning_change_insert ON hsdg.audit_planning_change
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
DROP POLICY audit_planning_change_update ON hsdg.audit_planning_change;
CREATE POLICY audit_planning_change_update ON hsdg.audit_planning_change
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- Controlled manual prior-year matter with source evidence (§14) — team may add.
DROP POLICY audit_prior_year_matter_insert ON hsdg.audit_prior_year_matter;
CREATE POLICY audit_prior_year_matter_insert ON hsdg.audit_prior_year_matter
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- An action's owner progresses it (status / resolution).
DROP POLICY audit_planning_matter_update ON hsdg.audit_planning_matter;
CREATE POLICY audit_planning_matter_update ON hsdg.audit_planning_matter
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND owner_employee_id = hsdg.ctx_employee_id())
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND owner_employee_id = hsdg.ctx_employee_id())
  );

-- ── Partner attention + Manager alerts (§10, §19, §20) ────────────────────
CREATE TABLE hsdg.audit_planning_attention (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  signal_id              uuid UNIQUE REFERENCES hsdg.audit_planning_signal (id) ON DELETE CASCADE,
  focus_id               uuid UNIQUE REFERENCES hsdg.audit_area_of_focus (id) ON DELETE CASCADE,
  -- §19: the Manager was told a new Enhanced / Immediate signal entered the register.
  manager_alerted_at     timestamptz,
  -- §20: when this Immediate Partner Attention item reached the EP's queue.
  partner_surfaced_at    timestamptz,
  partner_status         text CHECK (partner_status IS NULL OR partner_status IN
                           ('surfaced','acknowledged','challenged','responded')),
  -- The EP raised / flagged it (Partner signal, Partner focus area, flag).
  raised_by_partner      boolean NOT NULL DEFAULT false,
  partner_note           text,
  challenge              text,
  challenged_at          timestamptz,
  manager_response       text,
  responded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  responded_at           timestamptz,
  reviewed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_planning_attention_one_target CHECK (
    (signal_id IS NOT NULL)::int + (focus_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT audit_planning_attention_challenge_text CHECK (
    partner_status IS DISTINCT FROM 'challenged'
    OR (challenge IS NOT NULL AND length(trim(challenge)) > 0)
  )
);
CREATE INDEX audit_planning_attention_instance_idx
  ON hsdg.audit_planning_attention (workflow_instance_id);
CREATE INDEX audit_planning_attention_engagement_idx
  ON hsdg.audit_planning_attention (engagement_id);
CREATE TRIGGER audit_planning_attention_set_updated_at
  BEFORE UPDATE ON hsdg.audit_planning_attention
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_planning_attention ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_attention_select ON hsdg.audit_planning_attention
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
-- Any member's change can surface an item (e.g. a Senior's IPA proposal); who
-- may acknowledge / challenge / respond is enforced by the API.
CREATE POLICY audit_planning_attention_insert ON hsdg.audit_planning_attention
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_attention_update ON hsdg.audit_planning_attention
  FOR UPDATE USING (hsdg.is_engagement_member(engagement_id))
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- ── SharePoint evidence (§24) ─────────────────────────────────────────────
CREATE TABLE hsdg.audit_planning_evidence (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  target_type            text NOT NULL CHECK (target_type IN
                           ('signal','change','prior_year','acceptance','discussion')),
  -- The signal / change / prior-year matter / acceptance audit_matter / discussion.
  target_id              uuid NOT NULL,
  document_id            uuid NOT NULL REFERENCES hsdg.documents (id) ON DELETE CASCADE,
  linked_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  linked_at              timestamptz NOT NULL DEFAULT now(),
  removed_at             timestamptz,
  removed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX audit_planning_evidence_live_uk
  ON hsdg.audit_planning_evidence (target_type, target_id, document_id)
  WHERE removed_at IS NULL;
CREATE INDEX audit_planning_evidence_instance_idx
  ON hsdg.audit_planning_evidence (workflow_instance_id);
CREATE INDEX audit_planning_evidence_engagement_idx
  ON hsdg.audit_planning_evidence (engagement_id);

ALTER TABLE hsdg.audit_planning_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_evidence_select ON hsdg.audit_planning_evidence
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_evidence_insert ON hsdg.audit_planning_evidence
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND linked_by_employee_id = hsdg.ctx_employee_id())
  );
CREATE POLICY audit_planning_evidence_update ON hsdg.audit_planning_evidence
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (hsdg.is_engagement_member(engagement_id)
        AND linked_by_employee_id = hsdg.ctx_employee_id())
  )
  WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- The single document already on a signal / change / prior-year matter is the
-- first evidence link (never a copy).
INSERT INTO hsdg.audit_planning_evidence
  (workflow_instance_id, engagement_id, target_type, target_id, document_id, linked_at)
SELECT workflow_instance_id, engagement_id, 'signal', id, document_id, updated_at
  FROM hsdg.audit_planning_signal WHERE document_id IS NOT NULL
UNION ALL
SELECT workflow_instance_id, engagement_id, 'change', id, document_id, updated_at
  FROM hsdg.audit_planning_change WHERE document_id IS NOT NULL
UNION ALL
SELECT workflow_instance_id, engagement_id, 'prior_year', id, document_id, updated_at
  FROM hsdg.audit_prior_year_matter WHERE document_id IS NOT NULL;

-- A document set through the legacy single document_id column (API callers)
-- becomes an evidence link too, so the evidence list is the one place to look.
-- Runs as the invoker: the link is attributed to the acting employee.
CREATE OR REPLACE FUNCTION hsdg.audit_planning_legacy_evidence() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
    INSERT INTO hsdg.audit_planning_evidence
      (workflow_instance_id, engagement_id, target_type, target_id, document_id,
       linked_by_employee_id)
    VALUES (NEW.workflow_instance_id, NEW.engagement_id, TG_ARGV[0], NEW.id, NEW.document_id,
            hsdg.ctx_employee_id())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_planning_signal_legacy_evidence
  AFTER INSERT OR UPDATE OF document_id ON hsdg.audit_planning_signal
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_planning_legacy_evidence('signal');
CREATE TRIGGER audit_planning_change_legacy_evidence
  AFTER INSERT OR UPDATE OF document_id ON hsdg.audit_planning_change
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_planning_legacy_evidence('change');
CREATE TRIGGER audit_prior_year_matter_legacy_evidence
  AFTER INSERT OR UPDATE OF document_id ON hsdg.audit_prior_year_matter
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_planning_legacy_evidence('prior_year');

-- ── Controlled revision after Planning approval (§19) ─────────────────────
ALTER TABLE hsdg.audit_planning_intelligence
  ADD COLUMN version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1);

CREATE TABLE hsdg.audit_planning_intelligence_revision (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  from_version_no        integer NOT NULL,
  to_version_no          integer NOT NULL CHECK (to_version_no = from_version_no + 1),
  reason                 text NOT NULL CHECK (length(trim(reason)) > 0),
  -- The Planning approval (03.12) in force when 03.1 was reopened.
  approval_id            uuid REFERENCES hsdg.audit_planning_approvals (id) ON DELETE SET NULL,
  -- Frozen 03.1 baseline: record, signals, focus areas, changes, considerations,
  -- prior-year / acceptance matters, discussion and planning matters.
  baseline               jsonb NOT NULL,
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  opened_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  opened_at              timestamptz NOT NULL DEFAULT now(),
  completed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  completed_at           timestamptz,
  UNIQUE (workflow_instance_id, to_version_no)
);
CREATE UNIQUE INDEX audit_planning_intelligence_revision_open_uk
  ON hsdg.audit_planning_intelligence_revision (workflow_instance_id)
  WHERE status = 'open';
CREATE INDEX audit_planning_intelligence_revision_engagement_idx
  ON hsdg.audit_planning_intelligence_revision (engagement_id);

-- The frozen baseline is never rewritten; only the close-out fields move.
CREATE OR REPLACE FUNCTION hsdg.audit_planning_revision_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.baseline IS DISTINCT FROM OLD.baseline
     OR NEW.from_version_no <> OLD.from_version_no
     OR NEW.to_version_no <> OLD.to_version_no
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.approval_id IS DISTINCT FROM OLD.approval_id THEN
    RAISE EXCEPTION 'The 03.1 revision baseline is immutable.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_planning_intelligence_revision_immutable
  BEFORE UPDATE ON hsdg.audit_planning_intelligence_revision
  FOR EACH ROW EXECUTE FUNCTION hsdg.audit_planning_revision_immutable();

ALTER TABLE hsdg.audit_planning_intelligence_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_planning_intelligence_revision_select
  ON hsdg.audit_planning_intelligence_revision
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_planning_intelligence_revision_insert
  ON hsdg.audit_planning_intelligence_revision
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_planning_intelligence_revision_update
  ON hsdg.audit_planning_intelligence_revision
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- ── Notifications (§19 / §10 / revision) ──────────────────────────────────
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception',
   'document_uploaded',
   'framework_reopened','framework_work_impacted',
   'planning_signal_alert','planning_partner_attention','planning_strategy_reopened'));

-- Down Migration

DELETE FROM hsdg.notifications
 WHERE type IN ('planning_signal_alert','planning_partner_attention','planning_strategy_reopened');
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception',
   'document_uploaded',
   'framework_reopened','framework_work_impacted'));

DROP TABLE IF EXISTS hsdg.audit_planning_intelligence_revision CASCADE;
DROP FUNCTION IF EXISTS hsdg.audit_planning_revision_immutable();
ALTER TABLE hsdg.audit_planning_intelligence DROP COLUMN IF EXISTS version_no;
DROP TRIGGER IF EXISTS audit_prior_year_matter_legacy_evidence ON hsdg.audit_prior_year_matter;
DROP TRIGGER IF EXISTS audit_planning_change_legacy_evidence ON hsdg.audit_planning_change;
DROP TRIGGER IF EXISTS audit_planning_signal_legacy_evidence ON hsdg.audit_planning_signal;
DROP FUNCTION IF EXISTS hsdg.audit_planning_legacy_evidence();
DROP TABLE IF EXISTS hsdg.audit_planning_evidence CASCADE;
DROP TABLE IF EXISTS hsdg.audit_planning_attention CASCADE;

DROP POLICY audit_planning_matter_update ON hsdg.audit_planning_matter;
CREATE POLICY audit_planning_matter_update ON hsdg.audit_planning_matter
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP POLICY audit_prior_year_matter_insert ON hsdg.audit_prior_year_matter;
CREATE POLICY audit_prior_year_matter_insert ON hsdg.audit_prior_year_matter
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP POLICY audit_planning_change_update ON hsdg.audit_planning_change;
CREATE POLICY audit_planning_change_update ON hsdg.audit_planning_change
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP POLICY audit_planning_change_insert ON hsdg.audit_planning_change;
CREATE POLICY audit_planning_change_insert ON hsdg.audit_planning_change
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP POLICY audit_planning_signal_insert ON hsdg.audit_planning_signal;
CREATE POLICY audit_planning_signal_insert ON hsdg.audit_planning_signal
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
-- Proposed rows would violate the restored lead-only policy only for new
-- writes; existing rows stay. Drop the proposal columns last.
ALTER TABLE hsdg.audit_planning_signal
  DROP COLUMN IF EXISTS proposed_at,
  DROP COLUMN IF EXISTS proposed_by_employee_id;
