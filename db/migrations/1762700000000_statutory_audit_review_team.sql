-- ─────────────────────────────────────────────────────────────────────────
-- 0047 · Statutory Audit — Review (first-class) + Team allocation  (SA-7 · §24, §25)
--
-- Two layers land together:
--
--   • REVIEW is first-class (§37). A review note is a reviewer's comment on a
--     specific professional object — a procedure/workpaper, an audit area or a
--     piece of evidence (§344) — that requires a preparer RESPONSE and, finally,
--     a reviewer CLEARANCE. Each note retains author, timestamp, status,
--     response and clearance (§344); the full mutation trail lives in the §32
--     immutable event log. An OPEN BLOCKING note prevents configured completion
--     (§29 — consumed by SA-8). The pending-review QUEUE and the four headline
--     counts (§25) are DERIVED from procedure/area state, never stored.
--
--   • TEAM combines responsibility, workload and time (§37). audit_team_allocations
--     holds the PLANNED hours per person on the file (§21 Team & Responsibility
--     Allocation). ACTUAL hours are aggregated live from the existing
--     hsdg.engagement_time_entries mechanism (§24 — "no separate Time tab"), and
--     work-item counts / reviewer flags are derived from SA-5 procedures + areas.
--
-- CHANGES:
--   • audit_review_notes — one review note per row. Polymorphic anchor
--     (target_type + target_id) to a procedure / work area / evidence; the
--     service validates the target is on the same engagement (a polymorphic FK
--     is not expressible). status open→responded→cleared; is_blocking drives the
--     §29 completion gate. review_level (manager|partner) is stamped from the
--     reviewer at raise time.
--   • audit_team_allocations — planned hours + responsibility per person per
--     audit file (one row per person; UNIQUE).
--
-- SECURITY — engagement child data, same assignment-based access as the shell
-- and the SA-2..SA-6 tables: members SELECT, only leads (EP/manager)
-- INSERT/UPDATE/DELETE. ENABLE (not FORCE) RLS so the migrator-owned SECURITY
-- DEFINER helpers bypass; hsdg_app is never the owner. No new permission slug
-- (endpoints reuse engagement.read / engagement.manage; RLS gates).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Review notes (§25, §344) ───────────────────────────────────────────────
CREATE TABLE hsdg.audit_review_notes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id     uuid NOT NULL
                             REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- The professional object under review (§344). Polymorphic: the service checks
  -- the target row is on the same engagement — no single FK can express this.
  target_type              text NOT NULL CHECK (target_type IN ('procedure','work_area','evidence')),
  target_id                uuid NOT NULL,
  -- Two-tier review model (§24, §25); stamped from the reviewer at raise time.
  review_level             text NOT NULL DEFAULT 'manager' CHECK (review_level IN ('manager','partner')),
  -- The reviewer's comment requiring response/clearance (§156).
  body                     text NOT NULL CHECK (length(trim(body)) > 0),
  -- open → responded → cleared (§344).
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','cleared')),
  -- A blocking open note prevents configured completion (§29, feeds SA-8).
  is_blocking              boolean NOT NULL DEFAULT false,
  raised_by_employee_id    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  -- The preparer's response, once given (§344).
  response                 text,
  responded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  responded_at             timestamptz,
  cleared_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  cleared_at               timestamptz,
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- A responded note carries the preparer's response; a cleared note records who
  -- cleared it and when (§344 — retain response and clearance). A reviewer may
  -- clear a note directly (no preparer response required), so `cleared` does not
  -- imply a response.
  CONSTRAINT review_note_response_shape CHECK (
    status <> 'responded' OR (response IS NOT NULL AND length(trim(response)) > 0 AND responded_at IS NOT NULL)
  ),
  CONSTRAINT review_note_cleared_shape CHECK (
    status <> 'cleared' OR (cleared_by_employee_id IS NOT NULL AND cleared_at IS NOT NULL)
  )
);
CREATE INDEX audit_review_notes_instance_idx ON hsdg.audit_review_notes (workflow_instance_id);
CREATE INDEX audit_review_notes_engagement_idx ON hsdg.audit_review_notes (engagement_id);
CREATE INDEX audit_review_notes_target_idx ON hsdg.audit_review_notes (target_type, target_id);
CREATE INDEX audit_review_notes_status_idx ON hsdg.audit_review_notes (status);
CREATE TRIGGER audit_review_notes_set_updated_at
  BEFORE UPDATE ON hsdg.audit_review_notes
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_review_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_review_notes_select ON hsdg.audit_review_notes
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_review_notes_insert ON hsdg.audit_review_notes
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_review_notes_update ON hsdg.audit_review_notes
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_review_notes_delete ON hsdg.audit_review_notes
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- ── Team allocation — planned hours per person (§21, §24) ──────────────────
CREATE TABLE hsdg.audit_team_allocations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id  uuid NOT NULL
                          REFERENCES hsdg.service_workflow_instances (id) ON DELETE CASCADE,
  engagement_id         uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  -- Planned effort for this person on this audit file (§21 Team & Responsibility).
  planned_hours         numeric(8,2) NOT NULL DEFAULT 0 CHECK (planned_hours >= 0),
  -- Free-text responsibility, e.g. "Revenue & Receivables lead".
  responsibility        text,
  version               integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- One allocation row per person per audit file.
  UNIQUE (workflow_instance_id, employee_id)
);
CREATE INDEX audit_team_allocations_instance_idx ON hsdg.audit_team_allocations (workflow_instance_id);
CREATE INDEX audit_team_allocations_engagement_idx ON hsdg.audit_team_allocations (engagement_id);
CREATE INDEX audit_team_allocations_employee_idx ON hsdg.audit_team_allocations (employee_id);
CREATE TRIGGER audit_team_allocations_set_updated_at
  BEFORE UPDATE ON hsdg.audit_team_allocations
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.audit_team_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_team_allocations_select ON hsdg.audit_team_allocations
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY audit_team_allocations_insert ON hsdg.audit_team_allocations
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_team_allocations_update ON hsdg.audit_team_allocations
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY audit_team_allocations_delete ON hsdg.audit_team_allocations
  FOR DELETE USING (hsdg.is_engagement_lead(engagement_id));

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_team_allocations CASCADE;
DROP TABLE IF EXISTS hsdg.audit_review_notes CASCADE;
