-- ─────────────────────────────────────────────────────────────────────────
-- 0031 · Statutory-deadline-overdue notification type (spec §24)
--
-- The Phase 11 notification sweep flags an internal-SLA date as overdue but has
-- no notification for a STATUTORY deadline that has actually passed — only for
-- one approaching. The §24 escalation ladder (Overdue → owner + manager,
-- Critical overdue → engagement partner / firm) needs a statutory-overdue event,
-- so widen the notifications.type CHECK to admit it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception'));

-- Down Migration

ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception'));
