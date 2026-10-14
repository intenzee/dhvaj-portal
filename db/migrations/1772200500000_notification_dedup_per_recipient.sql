-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow WF-302 · Notification de-duplication is per recipient
--
-- dedup_key was unique across ALL recipients, so an event addressed to several
-- people (an overdue client request → owner, stream lead and partner; an
-- overdue review layer → reviewer and leads) reached only the first of them:
-- the others hit ON CONFLICT and were dropped. A repeated scan must still never
-- spam, so the key stays unique — per recipient.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DROP INDEX IF EXISTS hsdg.notifications_dedup_key_uidx;
CREATE UNIQUE INDEX notifications_dedup_key_uidx
  ON hsdg.notifications (recipient_user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

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
  ON CONFLICT (recipient_user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING recipient_user_id INTO v_created_by;

  RETURN v_created_by; -- NULL when this recipient already had this dedup_key
END;
$$;

-- Down Migration

-- Back to one row per key: keep each key's first notification.
DELETE FROM hsdg.notifications n
 USING hsdg.notifications k
 WHERE n.dedup_key IS NOT NULL AND k.dedup_key = n.dedup_key
   AND (k.created_at, k.id) < (n.created_at, n.id);
DROP INDEX IF EXISTS hsdg.notifications_dedup_key_uidx;
CREATE UNIQUE INDEX notifications_dedup_key_uidx ON hsdg.notifications (dedup_key)
  WHERE dedup_key IS NOT NULL;

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
