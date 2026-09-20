-- ─────────────────────────────────────────────────────────────────────────
-- 0053 · Statutory Audit — Section 01 Engagement & Acceptance  (Guide §8)
--
-- Turns the stub `acceptance` phase into a real 8-segment workflow (§8.3):
-- compact Yes/No/NA dashboards whose adverse answers raise Acceptance Matters
-- (through the ONE Matters engine, section = 'acceptance' — 1763200000000), and
-- an Engagement Partner approval (FINAL-02) that unlocks Section 02.
--
-- THREE TABLES:
--   • audit_acceptance_segments  — one row per segment per shell (8 segments),
--     carrying professional state. Seeded per shell by provisioning (idempotent,
--     self-healing on read), mirroring the framework-assessment seed.
--   • audit_acceptance_answers   — one Yes/No/NA answer per question per segment,
--     with narrative-on-exception and an optional evidence document link (§16).
--   • audit_acceptance_approvals — the versioned partner approval; each approval
--     snapshots the answers + conclusion to jsonb so history is never rewritten.
--
-- SECURITY — engagement child data, same assignment-based access as the shell
-- (1762100000000): members SELECT, only leads (EP/manager) INSERT/UPDATE. ENABLE
-- (not FORCE) RLS so migrator-owned SECURITY DEFINER helpers bypass.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.audit_acceptance_segments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id   uuid NOT NULL
                           REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  segment_key            text NOT NULL CHECK (segment_key ~ '^[a-z0-9_]{2,40}$'),
  title                  text NOT NULL CHECK (length(trim(title)) > 0),
  state                  text NOT NULL DEFAULT 'not_started' CHECK (state IN
                           ('not_started','in_progress','complete','not_applicable')),
  read_only              boolean NOT NULL DEFAULT false,
  decided_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at             timestamptz,
  sort_order             integer NOT NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, segment_key)
);
CREATE INDEX audit_acceptance_segments_instance_idx
  ON hsdg.audit_acceptance_segments (workflow_instance_id);
CREATE INDEX audit_acceptance_segments_engagement_idx
  ON hsdg.audit_acceptance_segments (engagement_id);
CREATE TRIGGER audit_acceptance_segments_set_updated_at
  BEFORE UPDATE ON hsdg.audit_acceptance_segments
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_acceptance_answers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id             uuid NOT NULL
                           REFERENCES hsdg.audit_acceptance_segments (id) ON DELETE CASCADE,
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  question_key           text NOT NULL CHECK (question_key ~ '^[a-z0-9_]{2,60}$'),
  answer                 text CHECK (answer IS NULL OR answer IN ('yes','no','na')),
  narrative              text,
  document_id            uuid REFERENCES hsdg.documents (id) ON DELETE SET NULL,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segment_id, question_key)
);
CREATE INDEX audit_acceptance_answers_segment_idx
  ON hsdg.audit_acceptance_answers (segment_id);
CREATE INDEX audit_acceptance_answers_engagement_idx
  ON hsdg.audit_acceptance_answers (engagement_id);
CREATE TRIGGER audit_acceptance_answers_set_updated_at
  BEFORE UPDATE ON hsdg.audit_acceptance_answers
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.audit_acceptance_approvals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id    uuid NOT NULL
                            REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  version                 integer NOT NULL,
  conclusion              text NOT NULL CHECK (conclusion IN
                            ('accept','accept_with_conditions','decline')),
  memo                    text,
  snapshot                jsonb NOT NULL,
  approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  approved_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_instance_id, version)
);
CREATE INDEX audit_acceptance_approvals_instance_idx
  ON hsdg.audit_acceptance_approvals (workflow_instance_id);
CREATE INDEX audit_acceptance_approvals_engagement_idx
  ON hsdg.audit_acceptance_approvals (engagement_id);

-- ── Row Level Security (mirrors audit_framework_assessments) ───────────────
ALTER TABLE hsdg.audit_acceptance_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_acceptance_segments_select ON hsdg.audit_acceptance_segments
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_acceptance_segments_insert ON hsdg.audit_acceptance_segments
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_acceptance_segments_update ON hsdg.audit_acceptance_segments
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_acceptance_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_acceptance_answers_select ON hsdg.audit_acceptance_answers
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_acceptance_answers_insert ON hsdg.audit_acceptance_answers
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_acceptance_answers_update ON hsdg.audit_acceptance_answers
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

ALTER TABLE hsdg.audit_acceptance_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_acceptance_approvals_select ON hsdg.audit_acceptance_approvals
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_acceptance_approvals_insert ON hsdg.audit_acceptance_approvals
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_acceptance_approvals CASCADE;
DROP TABLE IF EXISTS hsdg.audit_acceptance_answers CASCADE;
DROP TABLE IF EXISTS hsdg.audit_acceptance_segments CASCADE;
