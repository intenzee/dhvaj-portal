-- ─────────────────────────────────────────────────────────────────────────
-- 0033 · §24 escalation ladder — the remaining notification types
--
-- The Phase 11 sweep covered internal-SLA and statutory overdue/approaching.
-- The §24 Status-and-Escalation table asks for finer routing that the earlier
-- set could not express:
--   • Due Today          → owner/reviewer (distinct from "approaching")
--   • PBC overdue        → client + owner   (a client dependency past its
--                          escalation date)
--   • Client-commitment  → owner/manager    (a CLIENT_COMMITTED obligation
--     overdue                                overdue — not a statutory breach)
--   • Review overdue     → reviewer + escalation (a manager/EP review deadline
--                          LAYER that has passed — layers carry their own owner)
-- Widen the notifications.type CHECK to admit the four new events.
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
   'engagement_reopened','ep_changed','high_risk_exception'));

-- Down Migration

ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending',
   'internal_sla_approaching','internal_sla_overdue',
   'statutory_deadline_approaching','statutory_deadline_overdue',
   'client_dependency_reminder',
   'engagement_reopened','ep_changed','high_risk_exception'));
