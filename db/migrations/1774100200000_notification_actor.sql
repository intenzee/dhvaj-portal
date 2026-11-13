-- ─────────────────────────────────────────────────────────────────────────
-- Notifications: never for what you did yourself
--
--   · hsdg.notifications.actor_user_id: the person whose action raised it
--     (NULL for date-driven sweeps — a deadline is nobody's action).
--   · hsdg.emit_notification(…, p_actor_user_id): the eleven-argument form
--     records the actor and creates nothing for the actor themselves, so
--     assigning a task, a set of work or a quick task, or answering a chat,
--     never lands in your own "Needs action". The ten- and nine-argument forms
--     stay for their callers (no actor).
--   · Back-fill: the rows already raised by their own recipient that can be
--     told — a quick task or a set of work given by the person it reached —
--     carry that actor, so the read side keeps them out of "Needs action".
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.notifications
  ADD COLUMN actor_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION hsdg.emit_notification(
  p_recipient_employee_id uuid,
  p_type                  text,
  p_title                 text,
  p_body                  text,
  p_engagement_id         uuid,
  p_object_type           text,
  p_object_id             uuid,
  p_dedup_key             text,
  p_correlation_id        text,
  p_link                  jsonb,
  p_actor_user_id         uuid
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
  IF p_actor_user_id IS NOT NULL AND v_user_id = p_actor_user_id THEN
    RETURN NULL; -- your own action never asks you to act
  END IF;

  INSERT INTO hsdg.notifications
    (recipient_user_id, type, title, body, engagement_id, object_type, object_id,
     dedup_key, correlation_id, link, actor_user_id)
  VALUES
    (v_user_id, p_type, p_title, p_body, p_engagement_id, p_object_type, p_object_id,
     p_dedup_key, p_correlation_id, p_link, p_actor_user_id)
  ON CONFLICT (recipient_user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING recipient_user_id INTO v_created_by;

  RETURN v_created_by;
END;
$$;
REVOKE EXECUTE ON FUNCTION
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text, jsonb, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text, jsonb, uuid)
  TO hsdg_app;

-- The rows already there that their own recipient raised.
UPDATE hsdg.notifications n
   SET actor_user_id = n.recipient_user_id
  FROM hsdg.quick_tasks q
  JOIN hsdg.employees e ON e.id = q.assigned_by_employee_id
 WHERE n.object_type = 'quick_task' AND n.object_id = q.id
   AND n.type = 'quick_task_assigned'
   AND e.user_id = n.recipient_user_id;

UPDATE hsdg.notifications n
   SET actor_user_id = n.recipient_user_id
  FROM hsdg.work_sets w
  JOIN hsdg.employees e ON e.id = w.created_by_employee_id
 WHERE n.object_type = 'work_set' AND n.object_id = w.id
   AND n.type = 'work_set_assigned'
   AND e.user_id = n.recipient_user_id;

-- Down Migration

DROP FUNCTION IF EXISTS
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text, jsonb, uuid);
ALTER TABLE hsdg.notifications DROP COLUMN IF EXISTS actor_user_id;
