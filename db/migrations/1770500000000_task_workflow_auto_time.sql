-- ─────────────────────────────────────────────────────────────────────────
-- Engagement Restructure · Change 3 — task workflow and automatic time
--
-- Time stops being something people log and becomes something the system
-- records from task status. A clock runs for a person only while a task
-- assigned to them is In progress, or while they review a task they opened for
-- review. Nobody presses Start/Stop on a timer; they move the task.
--
--   tasks                   + engagement_service_id (its stream), reviewer,
--                             work_type; status gains paused and in_review.
--   task_events             one row per status change (written by a trigger, so
--                             EVERY path — transition endpoints, the legacy
--                             PATCH status, the idle closer — is captured).
--                             Feeds Activity and the time engine.
--   engagement_time_entries + task link, stream, entry_kind (work/review/other),
--                             source (auto/manual), category, heartbeat,
--                             adjustment chain (an adjustment is a NEW row that
--                             points at the original — never an overwrite),
--                             approval; stopped_reason expanded to the Change 3
--                             vocabulary.
--   client_dependencies     + stream / filing / task / period-section links, and
--                             a member may raise one (Waiting on client, slot
--                             request) — receiving/closing stays lead-only.
--   engagement_notes        existing notes become pinned comments in Activity
--                             (backfill recorded so Down can undo it exactly).
--   notifications           + task_review_requested, task_returned,
--                             filing_lodged, time_adjustment_pending.
--
-- The one_running_timer_per_employee index stays: a person has one clock.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Tasks ──────────────────────────────────────────────────────────────
ALTER TABLE hsdg.tasks
  ADD COLUMN engagement_service_id uuid REFERENCES hsdg.engagement_services (id) ON DELETE SET NULL,
  ADD COLUMN reviewer_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN work_type             text CHECK (work_type IN
                                     ('filing','notice','appeal','refund','registration','advisory','other')),
  -- When the current review was opened (Start review) — null when no review is running.
  ADD COLUMN review_started_at     timestamptz,
  ADD COLUMN sent_for_review_at    timestamptz;

ALTER TABLE hsdg.tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE hsdg.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN
  ('todo','in_progress','paused','blocked','in_review','done','cancelled'));

CREATE INDEX tasks_engagement_service_idx ON hsdg.tasks (engagement_service_id)
  WHERE engagement_service_id IS NOT NULL;
CREATE INDEX tasks_reviewer_idx ON hsdg.tasks (reviewer_employee_id)
  WHERE reviewer_employee_id IS NOT NULL;

-- Tasks generated from a filing are 'filing' work.
ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.tasks SET work_type = 'filing'
 WHERE source_compliance_instance_id IS NOT NULL AND work_type IS NULL;
ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;

-- The reviewer may move a task they review (Start review / Approve / Return).
DROP POLICY tasks_update ON hsdg.tasks;
CREATE POLICY tasks_update ON hsdg.tasks
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR assigned_to_employee_id = hsdg.ctx_employee_id()
    OR reviewer_employee_id = hsdg.ctx_employee_id()
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR assigned_to_employee_id = hsdg.ctx_employee_id()
    OR reviewer_employee_id = hsdg.ctx_employee_id()
  );

-- ── 2. Task events (append-only status history) ───────────────────────────
CREATE TABLE hsdg.task_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid NOT NULL REFERENCES hsdg.tasks (id) ON DELETE CASCADE,
  -- Denormalised for RLS and for the Activity view.
  engagement_id     uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  from_status       text,
  to_status         text NOT NULL,
  -- NULL = the system (idle / day-end closer).
  actor_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON hsdg.task_events (task_id, created_at);
CREATE INDEX task_events_engagement_idx ON hsdg.task_events (engagement_id, created_at DESC);

ALTER TABLE hsdg.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY task_events_select ON hsdg.task_events
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
-- Written only by the trigger below, in the transaction of the task change (the
-- writer already passed the tasks UPDATE/INSERT policy, so is a member).
CREATE POLICY task_events_insert ON hsdg.task_events
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));
REVOKE UPDATE, DELETE ON hsdg.task_events FROM hsdg_app;

-- The service passes a reason / system flag through transaction-local settings:
--   hsdg.task_event_reason  — free text (e.g. 'task_switched', a return note)
--   hsdg.task_event_system  — 'on' when the scheduler (not a person) moved it
CREATE OR REPLACE FUNCTION hsdg.record_task_event() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO hsdg.task_events (task_id, engagement_id, from_status, to_status, actor_employee_id, reason)
    VALUES (
      NEW.id, NEW.engagement_id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status,
      CASE WHEN current_setting('hsdg.task_event_system', true) = 'on' THEN NULL
           ELSE hsdg.ctx_employee_id() END,
      NULLIF(current_setting('hsdg.task_event_reason', true), '')
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tasks_record_event
  AFTER INSERT OR UPDATE OF status ON hsdg.tasks
  FOR EACH ROW EXECUTE FUNCTION hsdg.record_task_event();

-- ── 3. Automatic time ─────────────────────────────────────────────────────
ALTER TABLE hsdg.engagement_time_entries
  ADD COLUMN task_id               uuid REFERENCES hsdg.tasks (id) ON DELETE SET NULL,
  ADD COLUMN engagement_service_id uuid REFERENCES hsdg.engagement_services (id) ON DELETE SET NULL,
  ADD COLUMN entry_kind            text NOT NULL DEFAULT 'work'
                                     CHECK (entry_kind IN ('work','review','other')),
  ADD COLUMN source                text NOT NULL DEFAULT 'manual'
                                     CHECK (source IN ('auto','manual')),
  -- 'Add other time' categories (client call, meeting, travel…); null for task time.
  ADD COLUMN category              text CHECK (category IN
                                     ('client_call','client_meeting','internal_meeting','travel',
                                      'training','admin','other')),
  ADD COLUMN is_billable           boolean NOT NULL DEFAULT true,
  ADD COLUMN last_heartbeat_at     timestamptz,
  -- Adjustment chain: a correction is a new row pointing at the entry it corrects.
  ADD COLUMN adjusts_entry_id      uuid REFERENCES hsdg.engagement_time_entries (id) ON DELETE RESTRICT,
  ADD COLUMN adjustment_reason     text,
  ADD COLUMN adjustment_status     text CHECK (adjustment_status IN ('pending','approved','rejected')),
  ADD COLUMN approved_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN approved_at           timestamptz,
  ADD CONSTRAINT time_entry_other_has_category CHECK (entry_kind <> 'other' OR category IS NOT NULL),
  ADD CONSTRAINT time_entry_adjustment_shape CHECK (
    (adjusts_entry_id IS NULL AND adjustment_status IS NULL AND adjustment_reason IS NULL)
    OR (adjusts_entry_id IS NOT NULL AND adjustment_status IS NOT NULL
        AND length(trim(coalesce(adjustment_reason, ''))) > 0 AND ended_at IS NOT NULL)
  ),
  ADD CONSTRAINT time_entry_approved_shape CHECK (
    adjustment_status IS DISTINCT FROM 'approved' OR approved_at IS NOT NULL
  );

ALTER TABLE hsdg.engagement_time_entries DROP CONSTRAINT engagement_time_entries_stopped_reason_check;
ALTER TABLE hsdg.engagement_time_entries ADD CONSTRAINT engagement_time_entries_stopped_reason_check
  CHECK (stopped_reason IN
    ('manual','engagement_closed','task_switched','paused','blocked','submitted_for_review',
     'review_approved','review_returned','task_done','task_cancelled','idle','day_end','signed_out'));

CREATE INDEX time_entries_task_idx ON hsdg.engagement_time_entries (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX time_entries_adjusts_idx ON hsdg.engagement_time_entries (adjusts_entry_id)
  WHERE adjusts_entry_id IS NOT NULL;
-- The stale closer scans running auto entries every 5 minutes.
CREATE INDEX time_entries_running_auto_idx ON hsdg.engagement_time_entries (last_heartbeat_at)
  WHERE ended_at IS NULL AND source = 'auto';
CREATE INDEX time_entries_pending_adjustment_idx ON hsdg.engagement_time_entries (engagement_id)
  WHERE adjustment_status = 'pending';

-- Effective time: what reports count. An original entry is replaced by its
-- latest APPROVED adjustment; pending/rejected adjustments count for nothing
-- (the original stands until the manager approves). security_invoker so the
-- base table's RLS applies to the reader.
CREATE VIEW hsdg.effective_time_entries WITH (security_invoker = true) AS
SELECT te.*
FROM hsdg.engagement_time_entries te
WHERE te.adjusts_entry_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM hsdg.engagement_time_entries a
    WHERE a.adjusts_entry_id = te.id AND a.adjustment_status = 'approved')
UNION ALL
SELECT a.*
FROM hsdg.engagement_time_entries a
WHERE a.adjustment_status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM hsdg.engagement_time_entries b
    WHERE b.adjusts_entry_id = a.adjusts_entry_id AND b.adjustment_status = 'approved'
      AND (b.approved_at, b.id) > (a.approved_at, a.id));
GRANT SELECT ON hsdg.effective_time_entries TO hsdg_app;

-- ── 4. Client dependencies follow the work ────────────────────────────────
ALTER TABLE hsdg.client_dependencies
  ADD COLUMN engagement_service_id  uuid REFERENCES hsdg.engagement_services (id) ON DELETE SET NULL,
  ADD COLUMN compliance_instance_id uuid REFERENCES hsdg.compliance_instances (id) ON DELETE SET NULL,
  ADD COLUMN task_id                uuid REFERENCES hsdg.tasks (id) ON DELETE SET NULL,
  ADD COLUMN period_section         text CHECK (period_section IN ('outward','inward','summary','annual')),
  ADD COLUMN slot_code              text CHECK (slot_code ~ '^[A-Z0-9_]{2,40}$');
CREATE INDEX client_dependencies_instance_idx ON hsdg.client_dependencies (compliance_instance_id)
  WHERE compliance_instance_id IS NOT NULL;
CREATE INDEX client_dependencies_task_idx ON hsdg.client_dependencies (task_id)
  WHERE task_id IS NOT NULL;

-- A member raises "waiting on client" (task Waiting on client, slot Request from
-- client); receiving / waiving / closing stays with the leads.
DROP POLICY client_dependencies_insert ON hsdg.client_dependencies;
CREATE POLICY client_dependencies_insert ON hsdg.client_dependencies
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- The member who raised a slot request also issues its secure upload link.
DROP POLICY client_upload_links_insert ON hsdg.client_upload_links;
CREATE POLICY client_upload_links_insert ON hsdg.client_upload_links
  FOR INSERT WITH CHECK (hsdg.is_engagement_member(engagement_id));

-- ── 5. Notes → pinned comments ────────────────────────────────────────────
CREATE TABLE hsdg.engagement_notes_pin_backfill (note_id uuid PRIMARY KEY);
ALTER TABLE hsdg.engagement_notes NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.engagement_notes_pin_backfill (note_id)
  SELECT id FROM hsdg.engagement_notes WHERE NOT is_pinned;
UPDATE hsdg.engagement_notes SET is_pinned = true
  WHERE id IN (SELECT note_id FROM hsdg.engagement_notes_pin_backfill);
ALTER TABLE hsdg.engagement_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hsdg.engagement_notes_pin_backfill FROM hsdg_app;

-- ── 6. Notification types ─────────────────────────────────────────────────
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
   'planning_signal_alert','planning_partner_attention','planning_strategy_reopened',
   'planning_understanding_reassessment','planning_understanding_challenge',
   'planning_materiality_reassessment','planning_materiality_challenge',
   'planning_scope_reassessment','planning_scope_partner_action',
   'planning_areas_review','planning_areas_update_required',
   'task_review_requested','task_returned','filing_lodged','time_adjustment_pending'));

-- Down Migration

DELETE FROM hsdg.notifications
  WHERE type IN ('task_review_requested','task_returned','filing_lodged','time_adjustment_pending');
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
   'planning_signal_alert','planning_partner_attention','planning_strategy_reopened',
   'planning_understanding_reassessment','planning_understanding_challenge',
   'planning_materiality_reassessment','planning_materiality_challenge',
   'planning_scope_reassessment','planning_scope_partner_action',
   'planning_areas_review','planning_areas_update_required'));

ALTER TABLE hsdg.engagement_notes NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.engagement_notes SET is_pinned = false
  WHERE id IN (SELECT note_id FROM hsdg.engagement_notes_pin_backfill);
ALTER TABLE hsdg.engagement_notes FORCE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS hsdg.engagement_notes_pin_backfill;

DROP POLICY client_upload_links_insert ON hsdg.client_upload_links;
CREATE POLICY client_upload_links_insert ON hsdg.client_upload_links
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP POLICY client_dependencies_insert ON hsdg.client_dependencies;
CREATE POLICY client_dependencies_insert ON hsdg.client_dependencies
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP INDEX IF EXISTS hsdg.client_dependencies_task_idx;
DROP INDEX IF EXISTS hsdg.client_dependencies_instance_idx;
ALTER TABLE hsdg.client_dependencies
  DROP COLUMN IF EXISTS slot_code,
  DROP COLUMN IF EXISTS period_section,
  DROP COLUMN IF EXISTS task_id,
  DROP COLUMN IF EXISTS compliance_instance_id,
  DROP COLUMN IF EXISTS engagement_service_id;

DROP VIEW IF EXISTS hsdg.effective_time_entries;
-- Rows created by the new paths cannot survive the narrower shape.
ALTER TABLE hsdg.engagement_time_entries NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.engagement_time_entries WHERE adjusts_entry_id IS NOT NULL;
DELETE FROM hsdg.engagement_time_entries WHERE entry_kind = 'other';
UPDATE hsdg.engagement_time_entries SET stopped_reason = 'manual'
  WHERE stopped_reason NOT IN ('manual','engagement_closed');
ALTER TABLE hsdg.engagement_time_entries DROP CONSTRAINT engagement_time_entries_stopped_reason_check;
ALTER TABLE hsdg.engagement_time_entries ADD CONSTRAINT engagement_time_entries_stopped_reason_check
  CHECK (stopped_reason IN ('manual','engagement_closed'));
DROP INDEX IF EXISTS hsdg.time_entries_pending_adjustment_idx;
DROP INDEX IF EXISTS hsdg.time_entries_running_auto_idx;
DROP INDEX IF EXISTS hsdg.time_entries_adjusts_idx;
DROP INDEX IF EXISTS hsdg.time_entries_task_idx;
ALTER TABLE hsdg.engagement_time_entries
  DROP CONSTRAINT IF EXISTS time_entry_approved_shape,
  DROP CONSTRAINT IF EXISTS time_entry_adjustment_shape,
  DROP CONSTRAINT IF EXISTS time_entry_other_has_category,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by_employee_id,
  DROP COLUMN IF EXISTS adjustment_status,
  DROP COLUMN IF EXISTS adjustment_reason,
  DROP COLUMN IF EXISTS adjusts_entry_id,
  DROP COLUMN IF EXISTS last_heartbeat_at,
  DROP COLUMN IF EXISTS is_billable,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS entry_kind,
  DROP COLUMN IF EXISTS engagement_service_id,
  DROP COLUMN IF EXISTS task_id;

DROP TRIGGER IF EXISTS tasks_record_event ON hsdg.tasks;
DROP FUNCTION IF EXISTS hsdg.record_task_event();
DROP TABLE IF EXISTS hsdg.task_events CASCADE;

DROP POLICY tasks_update ON hsdg.tasks;
CREATE POLICY tasks_update ON hsdg.tasks
  FOR UPDATE USING (
    hsdg.is_engagement_lead(engagement_id)
    OR assigned_to_employee_id = hsdg.ctx_employee_id()
  )
  WITH CHECK (
    hsdg.is_engagement_lead(engagement_id)
    OR assigned_to_employee_id = hsdg.ctx_employee_id()
  );

ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.tasks SET status = 'todo' WHERE status = 'paused';
UPDATE hsdg.tasks SET status = 'in_progress' WHERE status = 'in_review';
ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE hsdg.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN
  ('todo','in_progress','blocked','done','cancelled'));
DROP INDEX IF EXISTS hsdg.tasks_reviewer_idx;
DROP INDEX IF EXISTS hsdg.tasks_engagement_service_idx;
ALTER TABLE hsdg.tasks
  DROP COLUMN IF EXISTS sent_for_review_at,
  DROP COLUMN IF EXISTS review_started_at,
  DROP COLUMN IF EXISTS work_type,
  DROP COLUMN IF EXISTS reviewer_employee_id,
  DROP COLUMN IF EXISTS engagement_service_id;
