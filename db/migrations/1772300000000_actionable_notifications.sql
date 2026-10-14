-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow WF-305 · Fewer, actionable notifications
--
-- • Every notification stores the exact place it opens: `link` is a WorkItemRef
--   (engagement, filing, section, task, request), written at emission, so the
--   bell opens the filing's section rather than the engagement's front page.
-- • notification_preferences — per user, per type: an informational type goes
--   to the daily digest (the default), to the bell, or nowhere. Actionable types
--   always reach the bell; the classification lives in @hsdg/contracts.
-- • A notification that asked for an action is read once that action is done —
--   by anyone, by any path (web, phone, API): the review is decided, the request
--   received, the filing filed, the layer completed, the correction decided, the
--   engagement signed off. SECURITY DEFINER triggers: the person who acted is
--   often not the recipient. `resolved_at` tells "done" apart from "read".
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.notifications
  ADD COLUMN link        jsonb CHECK (link IS NULL OR jsonb_typeof(link) = 'object'),
  ADD COLUMN resolved_at timestamptz;

-- The digest reads a recipient's day by type.
CREATE INDEX notifications_recipient_type_idx
  ON hsdg.notifications (recipient_user_id, type, created_at DESC);

CREATE TABLE hsdg.notification_preferences (
  user_id    uuid NOT NULL REFERENCES hsdg.users (id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (length(type) BETWEEN 1 AND 80),
  delivery   text NOT NULL CHECK (delivery IN ('bell','digest','off')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);

-- A user reads and writes only their own preferences. ENABLE (not FORCE), like
-- hsdg.notifications: the migrator-owned digest function reads everyone's.
ALTER TABLE hsdg.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_own ON hsdg.notification_preferences
  FOR ALL USING (user_id = hsdg.ctx_user_id()) WITH CHECK (user_id = hsdg.ctx_user_id());

-- Emission with its link. The nine-argument form stays (the audit modules call it
-- directly); those rows carry no link and open their engagement.
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
  p_link                  jsonb
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
     dedup_key, correlation_id, link)
  VALUES
    (v_user_id, p_type, p_title, p_body, p_engagement_id, p_object_type, p_object_id,
     p_dedup_key, p_correlation_id, p_link)
  ON CONFLICT (recipient_user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING recipient_user_id INTO v_created_by;

  RETURN v_created_by; -- NULL when this recipient already had this dedup_key
END;
$$;
REVOKE EXECUTE ON FUNCTION
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text, jsonb) TO hsdg_app;

-- Mark every recipient's unread notifications of these types on these objects
-- read, as done. Internal: called by the triggers below only.
CREATE OR REPLACE FUNCTION hsdg.resolve_notifications(
  p_object_type text,
  p_object_ids  uuid[],
  p_types       text[]
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  UPDATE hsdg.notifications
     SET status = 'read', read_at = now(), resolved_at = now()
   WHERE status = 'unread'
     AND object_type = p_object_type
     AND object_id = ANY (p_object_ids)
     AND type = ANY (p_types);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.resolve_notifications(text, uuid[], text[]) FROM PUBLIC;

-- Tasks: a decided review clears "review requested"; sending it back for review
-- (or finishing it) clears "returned"; starting it clears "assigned".
CREATE OR REPLACE FUNCTION hsdg.resolve_task_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF OLD.status = 'in_review' AND NEW.status <> 'in_review' THEN
    PERFORM hsdg.resolve_notifications('task', ARRAY[NEW.id], ARRAY['task_review_requested']);
  END IF;
  IF NEW.status IN ('in_review','done','cancelled') THEN
    PERFORM hsdg.resolve_notifications('task', ARRAY[NEW.id], ARRAY['task_returned']);
  END IF;
  IF NEW.status <> 'todo' THEN
    PERFORM hsdg.resolve_notifications('task', ARRAY[NEW.id], ARRAY['task_assigned']);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER tasks_resolve_notifications
  AFTER UPDATE OF status ON hsdg.tasks
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.resolve_task_notifications();

-- Client requests: received, waived or cancelled clears the chase.
CREATE OR REPLACE FUNCTION hsdg.resolve_dependency_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.status IN ('received','waived','cancelled') THEN
    PERFORM hsdg.resolve_notifications('client_dependency', ARRAY[NEW.id],
      ARRAY['client_dependency_overdue','client_dependency_reminder']);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER client_dependencies_resolve_notifications
  AFTER UPDATE OF status ON hsdg.client_dependencies
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.resolve_dependency_notifications();

-- Filings: filed, completed, waived or not applicable clears its date alerts,
-- its layers' overdue alerts and its client chase.
CREATE OR REPLACE FUNCTION hsdg.resolve_filing_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.status IN ('completed','waived') OR NEW.workflow_status IN ('filed','not_applicable') THEN
    PERFORM hsdg.resolve_notifications('compliance_instance', ARRAY[NEW.id],
      ARRAY['internal_sla_approaching','internal_sla_overdue','statutory_deadline_approaching',
            'statutory_deadline_overdue','compliance_due_today','client_commitment_overdue',
            'client_dependency_reminder']);
    PERFORM hsdg.resolve_notifications('compliance_instance_deadline',
      ARRAY(SELECT d.id FROM hsdg.compliance_instance_deadlines d
             WHERE d.compliance_instance_id = NEW.id),
      ARRAY['deadline_layer_overdue']);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER compliance_instances_resolve_notifications
  AFTER UPDATE OF status, workflow_status ON hsdg.compliance_instances
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status
                     OR OLD.workflow_status IS DISTINCT FROM NEW.workflow_status)
  EXECUTE FUNCTION hsdg.resolve_filing_notifications();

-- A deadline layer completed or waived clears its overdue alert.
CREATE OR REPLACE FUNCTION hsdg.resolve_layer_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.status IN ('completed','waived') THEN
    PERFORM hsdg.resolve_notifications('compliance_instance_deadline', ARRAY[NEW.id],
      ARRAY['deadline_layer_overdue']);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER compliance_instance_deadlines_resolve_notifications
  AFTER UPDATE OF status ON hsdg.compliance_instance_deadlines
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.resolve_layer_notifications();

-- A time correction approved or rejected clears "to approve".
CREATE OR REPLACE FUNCTION hsdg.resolve_time_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.adjustment_status IN ('approved','rejected') THEN
    PERFORM hsdg.resolve_notifications('engagement_time_entry', ARRAY[NEW.id],
      ARRAY['time_adjustment_pending']);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER engagement_time_entries_resolve_notifications
  AFTER UPDATE OF adjustment_status ON hsdg.engagement_time_entries
  FOR EACH ROW WHEN (OLD.adjustment_status IS DISTINCT FROM NEW.adjustment_status)
  EXECUTE FUNCTION hsdg.resolve_time_notifications();

-- The engagement signed off clears "sign-off pending".
CREATE OR REPLACE FUNCTION hsdg.resolve_signoff_notifications() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM hsdg.resolve_notifications('engagement', ARRAY[NEW.engagement_id],
    ARRAY['ep_signoff_pending']);
  RETURN NULL;
END;
$$;
CREATE TRIGGER engagement_reviews_resolve_notifications
  AFTER INSERT ON hsdg.engagement_reviews
  FOR EACH ROW WHEN (NEW.outcome = 'signed_off')
  EXECUTE FUNCTION hsdg.resolve_signoff_notifications();

-- The daily digest by e-mail/Teams: one message per user per IST day listing that
-- day's unread informational notices of `p_types` they have not moved to the bell
-- or turned off. Once per day (notification_digest_runs), so a re-run is a no-op.
-- SECURITY DEFINER: it reads every recipient's inbox, which no app role may do.
CREATE TABLE hsdg.notification_digest_runs (
  day        date PRIMARY KEY,
  users      integer NOT NULL,
  ran_at     timestamptz NOT NULL DEFAULT now()
);
-- ENABLE with no policy: the app role cannot touch it; only the migrator-owned
-- definer function below (exempt, as the table's owner) reads and writes it.
ALTER TABLE hsdg.notification_digest_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION hsdg.enqueue_notification_digests(
  p_day      date,
  p_types    text[],
  p_channels text[]
) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  u       record;
  ch      text;
  v_users integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM hsdg.notification_digest_runs WHERE day = p_day) THEN
    RETURN 0;
  END IF;
  FOR u IN
    SELECT n.recipient_user_id AS user_id, count(*) AS total,
           string_agg('• ' || n.title, E'\n' ORDER BY n.created_at) AS lines
      FROM hsdg.notifications n
     WHERE n.status = 'unread'
       AND n.type = ANY (p_types)
       AND (n.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_day
       AND NOT EXISTS (SELECT 1 FROM hsdg.notification_preferences p
                        WHERE p.user_id = n.recipient_user_id AND p.type = n.type
                          AND p.delivery <> 'digest')
     GROUP BY n.recipient_user_id
  LOOP
    FOREACH ch IN ARRAY p_channels LOOP
      PERFORM hsdg.enqueue_delivery(u.user_id, ch, 'notification_digest',
        'Your daily digest — ' || u.total || ' update' || CASE WHEN u.total = 1 THEN '' ELSE 's' END,
        u.lines, NULL);
    END LOOP;
    v_users := v_users + 1;
  END LOOP;
  INSERT INTO hsdg.notification_digest_runs (day, users) VALUES (p_day, v_users);
  RETURN v_users;
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.enqueue_notification_digests(date, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.enqueue_notification_digests(date, text[], text[]) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.enqueue_notification_digests(date, text[], text[]);
DROP TABLE IF EXISTS hsdg.notification_digest_runs;

DROP TRIGGER IF EXISTS engagement_reviews_resolve_notifications ON hsdg.engagement_reviews;
DROP TRIGGER IF EXISTS engagement_time_entries_resolve_notifications ON hsdg.engagement_time_entries;
DROP TRIGGER IF EXISTS compliance_instance_deadlines_resolve_notifications
  ON hsdg.compliance_instance_deadlines;
DROP TRIGGER IF EXISTS compliance_instances_resolve_notifications ON hsdg.compliance_instances;
DROP TRIGGER IF EXISTS client_dependencies_resolve_notifications ON hsdg.client_dependencies;
DROP TRIGGER IF EXISTS tasks_resolve_notifications ON hsdg.tasks;
DROP FUNCTION IF EXISTS hsdg.resolve_signoff_notifications();
DROP FUNCTION IF EXISTS hsdg.resolve_time_notifications();
DROP FUNCTION IF EXISTS hsdg.resolve_layer_notifications();
DROP FUNCTION IF EXISTS hsdg.resolve_filing_notifications();
DROP FUNCTION IF EXISTS hsdg.resolve_dependency_notifications();
DROP FUNCTION IF EXISTS hsdg.resolve_task_notifications();
DROP FUNCTION IF EXISTS hsdg.resolve_notifications(text, uuid[], text[]);
DROP FUNCTION IF EXISTS
  hsdg.emit_notification(uuid, text, text, text, uuid, text, uuid, text, text, jsonb);
DROP TABLE IF EXISTS hsdg.notification_preferences;
DROP INDEX IF EXISTS hsdg.notifications_recipient_type_idx;
ALTER TABLE hsdg.notifications DROP COLUMN IF EXISTS resolved_at, DROP COLUMN IF EXISTS link;
