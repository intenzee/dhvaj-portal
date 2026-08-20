-- ─────────────────────────────────────────────────────────────────────────
-- 0017 · Notifications
--
-- A per-recipient notification framework (§ Phase 11). Each row is addressed to
-- ONE recipient user, carries a typed event and optional engagement/object
-- context, and tracks that user's read state. The in-app "portal" channel is
-- the row itself; email/Teams are pluggable external channels dispatched by the
-- application, never from the database.
--
-- Write path is deliberately narrow: the application (hsdg_app) may READ and
-- UPDATE its OWN notifications, but CANNOT insert directly — there is no INSERT
-- policy. Every notification is created through the SECURITY DEFINER
-- hsdg.emit_notification() function, so recipients are always resolved by
-- business logic (never from client input) and the sender's own RLS context is
-- irrelevant to whom a notification can be addressed. The function also resolves
-- the recipient EMPLOYEE → its linked user, and de-duplicates on an optional
-- dedup_key so a repeated date-driven scan never spams.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES hsdg.users (id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN
                      ('task_assigned','review_pending','ep_signoff_pending',
                       'internal_sla_approaching','internal_sla_overdue',
                       'statutory_deadline_approaching','client_dependency_reminder',
                       'engagement_reopened','ep_changed','high_risk_exception')),
  title             text NOT NULL CHECK (length(trim(title)) > 0),
  body              text,
  -- Context for deep-linking (not used for RLS — notifications are recipient-scoped).
  engagement_id     uuid REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  object_type       text,
  object_id         uuid,
  status            text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','dismissed')),
  read_at           timestamptz,
  -- Idempotency key for date-driven emissions (NULL for always-emit events).
  dedup_key         text,
  correlation_id    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_read_has_stamp CHECK (status <> 'read' OR read_at IS NOT NULL)
);
CREATE INDEX notifications_recipient_idx ON hsdg.notifications (recipient_user_id, created_at DESC);
-- "My unread" is the hot read.
CREATE INDEX notifications_recipient_unread_idx ON hsdg.notifications (recipient_user_id)
  WHERE status = 'unread';
-- De-dup key is unique when present, so a repeated scan is a no-op.
CREATE UNIQUE INDEX notifications_dedup_key_uidx ON hsdg.notifications (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- ── Emission function (the ONLY write path) ────────────────────────────────
-- Owned by the migrator; runs SECURITY DEFINER so it can insert regardless of
-- the caller's RLS context (the table runs ENABLE — not FORCE — RLS, so the
-- owner bypasses policies). Resolves the recipient employee → its linked user.
-- Returns the RECIPIENT USER ID when a new notification was created, or NULL when
-- nothing was created (the employee has no login, or the dedup_key already
-- fired) — the caller uses this both as the "was it newly created" signal and to
-- fan the notification out to external channels. SET search_path guards against
-- search-path hijacking.
CREATE OR REPLACE FUNCTION hsdg.emit_notification(
  p_recipient_employee_id uuid,
  p_type                  text,
  p_title                 text,
  p_body                  text,
  p_engagement_id         uuid,
  p_object_type           text,
  p_object_id             uuid,
  p_dedup_key             text,
  p_correlation_id        text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_user_id    uuid;
  v_created_by uuid;
BEGIN
  IF p_recipient_employee_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT user_id INTO v_user_id FROM hsdg.employees WHERE id = p_recipient_employee_id;
  IF v_user_id IS NULL THEN
    RETURN NULL; -- employee has no login; nothing to notify
  END IF;

  INSERT INTO hsdg.notifications
    (recipient_user_id, type, title, body, engagement_id, object_type, object_id,
     dedup_key, correlation_id)
  VALUES
    (v_user_id, p_type, p_title, p_body, p_engagement_id, p_object_type, p_object_id,
     p_dedup_key, p_correlation_id)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING recipient_user_id INTO v_created_by;

  RETURN v_created_by; -- NULL when the dedup_key already existed
END;
$$;

REVOKE EXECUTE ON FUNCTION
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text) TO hsdg_app;

-- ── Permissions ────────────────────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('notification.read', 'View and manage your own notifications'),
  ('notification.scan', 'Trigger the date-driven notification sweep (operator/worker)');

-- notification.read: every authenticated role sees its own inbox.
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'notification.read';

-- notification.scan: the firm-wide operator identity a scheduled worker runs as.
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'notification.scan'
WHERE r.slug = 'managing_partner';

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── Row Level Security ─────────────────────────────────────────────────────
-- ENABLE (not FORCE) so the migrator-owned emit function bypasses policies. The
-- app role (hsdg_app, not the owner) is still fully subject to them: a user sees
-- and updates only their OWN notifications, and cannot INSERT at all (no policy).
ALTER TABLE hsdg.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select ON hsdg.notifications
  FOR SELECT USING (recipient_user_id = hsdg.ctx_user_id());
CREATE POLICY notifications_update ON hsdg.notifications
  FOR UPDATE USING (recipient_user_id = hsdg.ctx_user_id())
  WITH CHECK (recipient_user_id = hsdg.ctx_user_id());

-- Down Migration

DROP POLICY IF EXISTS notifications_update ON hsdg.notifications;
DROP POLICY IF EXISTS notifications_select ON hsdg.notifications;

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug IN ('notification.read','notification.scan'));
DELETE FROM hsdg.permissions WHERE slug IN ('notification.read','notification.scan');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text);

DROP TABLE IF EXISTS hsdg.notifications CASCADE;
