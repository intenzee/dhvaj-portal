-- ─────────────────────────────────────────────────────────────────────────
-- 0040 · Client-facing delivery (§24 "PBC overdue → client + owner")
--
-- Clients are not portal users, so §24's client-facing routing cannot be a
-- notification row. Instead, the delivery outbox is extended to address an
-- external CLIENT EMAIL (the entity's primary contact) alongside the existing
-- internal user recipients — delivered through the same channel + drain worker.
-- The sweep enqueues a client delivery when a client dependency (PBC) passes its
-- escalation date, in addition to the internal owner/EP notification.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- A delivery now targets EITHER an internal user OR an external client email.
ALTER TABLE hsdg.notification_deliveries ALTER COLUMN recipient_user_id DROP NOT NULL;
ALTER TABLE hsdg.notification_deliveries ADD COLUMN recipient_email citext;
ALTER TABLE hsdg.notification_deliveries ADD CONSTRAINT notification_deliveries_one_recipient
  CHECK (num_nonnulls(recipient_user_id, recipient_email) = 1);

-- Enqueue a client-addressed delivery (external email). SECURITY DEFINER, same
-- as enqueue_delivery, so the sweep can enqueue inside its transaction.
CREATE OR REPLACE FUNCTION hsdg.enqueue_client_delivery(
  p_recipient_email text,
  p_channel         text,
  p_type            text,
  p_title           text,
  p_body            text,
  p_engagement_id   uuid
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_recipient_email IS NULL OR length(trim(p_recipient_email)) = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO hsdg.notification_deliveries
    (recipient_email, channel, type, title, body, engagement_id)
  VALUES
    (p_recipient_email, p_channel, p_type, p_title, p_body, p_engagement_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION hsdg.enqueue_client_delivery(text, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.enqueue_client_delivery(text, text, text, text, text, uuid) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.enqueue_client_delivery(text, text, text, text, text, uuid);
ALTER TABLE hsdg.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_one_recipient;
ALTER TABLE hsdg.notification_deliveries DROP COLUMN IF EXISTS recipient_email;
-- Restore NOT NULL (safe: every row created before this down had a user recipient).
ALTER TABLE hsdg.notification_deliveries ALTER COLUMN recipient_user_id SET NOT NULL;
