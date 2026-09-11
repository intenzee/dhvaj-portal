-- ─────────────────────────────────────────────────────────────────────────
-- 0044 · "Document uploaded" notification type
--
-- Lets the portal notify the right reviewer when a document is filed, and powers
-- the "docs awaiting my review" inbox. Widens the notifications.type CHECK to
-- admit the new event (same pattern as 0031 escalation notifications). Delivery
-- to email/Teams rides the existing outbox automatically.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception',
   'document_uploaded'));

-- Down Migration

ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue',
   'client_commitment_overdue','client_dependency_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception'));
