-- ─────────────────────────────────────────────────────────────────────────
-- 0040 · Engagement Time Tracking  (ADR-0034)
--
-- A MANUAL stopwatch per person per engagement. A team member clicks "Start
-- working" and the portal records a running time entry; they click "Stop" (or
-- close the engagement) to end it. Work often happens OUTSIDE the portal (other
-- sites/tools), so the timer NEVER auto-stops on inactivity — only an explicit
-- stop, or the engagement reaching a terminal state, closes it.
--
-- INVARIANT — one running timer per person, firm-wide. A person can physically
-- work on only one thing at a time, so at most one entry with ended_at IS NULL
-- may exist per employee. Enforced by a partial UNIQUE index (a clean 409 at
-- the service layer), not application logic.
--
-- SECURITY MODEL — this is engagement child data, so it rides the SAME
-- assignment-based access as hsdg.engagements (see 1756200000000_engagements):
--   • any engagement MEMBER can SEE the engagement's time (team transparency);
--   • you may only INSERT your OWN running entry, on an engagement you are on;
--   • you may STOP/edit your OWN entry — or, as the EP/manager (lead) or a
--     firm-wide role, stop a subordinate's runaway timer;
--   • only firm-wide may DELETE (corrections stay a governance action).
-- We reuse the migrator-owned SECURITY DEFINER helpers hsdg.is_engagement_member
-- / hsdg.is_engagement_lead, so the table runs ENABLE (not FORCE) RLS exactly
-- like engagement_team — the helpers bypass RLS internally to avoid recursion,
-- and the least-privilege app role is never the owner.
--
-- No new permission slug: the endpoints reuse engagement.read (RLS does the real
-- gating), and the firm-wide report reuses report.read.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.engagement_time_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id    uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  -- The person doing the work (NOT necessarily the EP/manager).
  employee_id      uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  started_at       timestamptz NOT NULL DEFAULT now(),
  -- NULL === the timer is still running.
  ended_at         timestamptz,
  -- Materialised on stop so reporting never has to recompute closed entries;
  -- NULL while running (the UI/report computes live elapsed for running ones).
  duration_seconds integer,
  -- What they were working on (optional; often an off-portal site/task).
  note             text,
  -- 'manual' when the person stopped it; 'engagement_closed' when the terminal-
  -- state safety net force-stopped it. NULL while running.
  stopped_reason   text CHECK (stopped_reason IN ('manual', 'engagement_closed')),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entry_ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- A running entry has no duration/stop reason; a stopped one has both.
  CONSTRAINT time_entry_running_shape CHECK (
    (ended_at IS NULL  AND duration_seconds IS NULL AND stopped_reason IS NULL)
    OR
    (ended_at IS NOT NULL AND duration_seconds IS NOT NULL AND stopped_reason IS NOT NULL)
  )
);

CREATE INDEX time_entries_engagement_idx ON hsdg.engagement_time_entries (engagement_id);
CREATE INDEX time_entries_employee_idx   ON hsdg.engagement_time_entries (employee_id);
-- Fast lookup of "the caller's running timer" and the one-timer invariant.
CREATE UNIQUE INDEX one_running_timer_per_employee
  ON hsdg.engagement_time_entries (employee_id) WHERE ended_at IS NULL;

CREATE TRIGGER engagement_time_entries_set_updated_at BEFORE UPDATE ON hsdg.engagement_time_entries
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Row Level Security ─────────────────────────────────────────────────────
-- ENABLE (not FORCE) so the migrator-owned SECURITY DEFINER membership helpers
-- bypass and avoid policy recursion; hsdg_app is never the owner, so it stays
-- governed.
ALTER TABLE hsdg.engagement_time_entries ENABLE ROW LEVEL SECURITY;

-- Any engagement member sees the engagement's time (firm-wide via the helper).
CREATE POLICY time_entries_select ON hsdg.engagement_time_entries
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));

-- Start only your OWN timer, only on an engagement you belong to.
CREATE POLICY time_entries_insert ON hsdg.engagement_time_entries
  FOR INSERT WITH CHECK (
    hsdg.is_engagement_member(engagement_id)
    AND employee_id = hsdg.ctx_employee_id()
  );

-- Stop/annotate your own entry; a lead (EP/manager) or firm-wide may stop a
-- subordinate's runaway timer. The engagement is immutable on an entry, so both
-- USING and WITH CHECK gate on ownership/lead only.
CREATE POLICY time_entries_update ON hsdg.engagement_time_entries
  FOR UPDATE USING (
    employee_id = hsdg.ctx_employee_id() OR hsdg.is_engagement_lead(engagement_id)
  )
  WITH CHECK (
    employee_id = hsdg.ctx_employee_id() OR hsdg.is_engagement_lead(engagement_id)
  );

-- Corrections/removals are a firm-wide governance action only.
CREATE POLICY time_entries_delete ON hsdg.engagement_time_entries
  FOR DELETE USING (hsdg.ctx_is_firmwide());

-- Down Migration

DROP TABLE IF EXISTS hsdg.engagement_time_entries CASCADE;
