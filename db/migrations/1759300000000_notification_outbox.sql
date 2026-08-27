-- ─────────────────────────────────────────────────────────────────────────
-- 0039 · Notification delivery outbox (durable external delivery)
--
-- External channels (email/Teams) were delivered inline and best-effort — a
-- transient outage silently dropped the message. This adds the transactional
-- outbox pattern: on emit, a delivery row is enqueued ATOMICALLY with the portal
-- notification (via a SECURITY DEFINER function, like emit_notification), and a
-- scheduled worker drains pending rows through the channel with retry/backoff.
-- Delivery is now at-least-once and survives a channel outage or a restart.
--
-- RLS: ENABLE (not FORCE) so the migrator-owned enqueue function bypasses
-- policies; the app role is subject to them. The drain worker runs as the
-- firm-wide operator (managing partner), so reads/updates are firm-wide scoped.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.notification_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES hsdg.users (id) ON DELETE CASCADE,
  channel           text NOT NULL CHECK (channel IN ('email', 'teams')),
  type              text NOT NULL,
  title             text NOT NULL,
  body              text,
  engagement_id     uuid REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'failed')),
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  CONSTRAINT notification_deliveries_sent_has_ts CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);
-- The drain query: due pending rows, oldest first.
CREATE INDEX notification_deliveries_due_idx
  ON hsdg.notification_deliveries (next_attempt_at)
  WHERE status = 'pending';

-- Enqueue one pending delivery. SECURITY DEFINER so any emit context can enqueue
-- inside its own transaction, regardless of RLS (mirrors emit_notification).
CREATE OR REPLACE FUNCTION hsdg.enqueue_delivery(
  p_recipient_user_id uuid,
  p_channel           text,
  p_type              text,
  p_title             text,
  p_body              text,
  p_engagement_id     uuid
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO hsdg.notification_deliveries
    (recipient_user_id, channel, type, title, body, engagement_id)
  VALUES
    (p_recipient_user_id, p_channel, p_type, p_title, p_body, p_engagement_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION hsdg.enqueue_delivery(uuid, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.enqueue_delivery(uuid, text, text, text, text, uuid) TO hsdg_app;

-- Append-only for the app role: it enqueues only through the function, and the
-- drain worker updates status. No direct INSERT/DELETE.
REVOKE INSERT, DELETE ON hsdg.notification_deliveries FROM hsdg_app;

-- ENABLE (not FORCE): the owner-run enqueue function bypasses policies; the drain
-- worker (managing partner / firm-wide) reads and updates.
ALTER TABLE hsdg.notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_deliveries_select ON hsdg.notification_deliveries
  FOR SELECT USING (hsdg.ctx_is_firmwide());
CREATE POLICY notification_deliveries_update ON hsdg.notification_deliveries
  FOR UPDATE USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- Down Migration

DROP POLICY IF EXISTS notification_deliveries_update ON hsdg.notification_deliveries;
DROP POLICY IF EXISTS notification_deliveries_select ON hsdg.notification_deliveries;
DROP FUNCTION IF EXISTS hsdg.enqueue_delivery(uuid, text, text, text, text, uuid);
DROP TABLE IF EXISTS hsdg.notification_deliveries CASCADE;
