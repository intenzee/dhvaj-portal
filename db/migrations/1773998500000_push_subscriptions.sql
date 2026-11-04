-- ─────────────────────────────────────────────────────────────────────────
-- Web Push subscriptions: quick-task alerts on a closed browser or a phone
--
-- Each browser (or installed app) a person turns alerts on in leaves one
-- subscription: the push service's endpoint and the keys to encrypt for it.
-- A person sees and removes only their own. Sending to someone else goes
-- through push_targets, which answers only for a quick task the caller is on
-- with that person — so no one can read another's endpoints at large.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  -- One row per browser: signing in as someone else on it moves the row.
  endpoint     text NOT NULL UNIQUE
                 CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 1000),
  p256dh       text NOT NULL CHECK (length(p256dh) BETWEEN 20 AND 200),
  auth         text NOT NULL CHECK (length(auth) BETWEEN 8 AND 100),
  user_agent   text CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_employee_idx ON hsdg.push_subscriptions (employee_id);

REVOKE ALL ON hsdg.push_subscriptions FROM hsdg_app;
GRANT SELECT, DELETE ON hsdg.push_subscriptions TO hsdg_app;

ALTER TABLE hsdg.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.push_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_own_select ON hsdg.push_subscriptions
  FOR SELECT TO hsdg_app USING (employee_id = hsdg.ctx_employee_id());
CREATE POLICY push_subscriptions_own_delete ON hsdg.push_subscriptions
  FOR DELETE TO hsdg_app USING (employee_id = hsdg.ctx_employee_id());

-- The owner (the functions below) works on rows only while push_owner says so.
CREATE POLICY push_subscriptions_owner ON hsdg.push_subscriptions
  FOR ALL TO hsdg_migrator
  USING (current_setting('hsdg.push_owner', true) = 'on')
  WITH CHECK (current_setting('hsdg.push_owner', true) = 'on');

/** Saves this browser's subscription for the signed-in employee (moving it from anyone else). */
CREATE FUNCTION hsdg.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  me uuid := hsdg.ctx_employee_id();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'push_subscribe needs a signed-in employee' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('hsdg.push_owner', 'on', true);
  INSERT INTO hsdg.push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
  VALUES (me, p_endpoint, p_p256dh, p_auth, p_user_agent)
  ON CONFLICT (endpoint) DO UPDATE
    SET employee_id = EXCLUDED.employee_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent, last_seen_at = now();
  PERFORM set_config('hsdg.push_owner', '', true);
END $$;

/**
 * Where to push a quick task's alert to: the devices of the other person on
 * that task. Answers only when the caller is on the task and `p_to` is the
 * other person on it.
 */
CREATE FUNCTION hsdg.push_targets(p_task_id uuid, p_to uuid)
  RETURNS TABLE (endpoint text, p256dh text, auth text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  me uuid := hsdg.ctx_employee_id();
BEGIN
  IF me IS NULL OR p_to IS NULL OR p_to = me THEN RETURN; END IF;
  -- quick_tasks is read under the caller's own policy (they are on it).
  IF NOT EXISTS (SELECT 1 FROM hsdg.quick_tasks q
                  WHERE q.id = p_task_id
                    AND ((q.assigned_by_employee_id = me AND q.assigned_to_employee_id = p_to)
                      OR (q.assigned_to_employee_id = me AND q.assigned_by_employee_id = p_to))) THEN
    RETURN;
  END IF;
  PERFORM set_config('hsdg.push_owner', 'on', true);
  RETURN QUERY SELECT s.endpoint, s.p256dh, s.auth
                 FROM hsdg.push_subscriptions s WHERE s.employee_id = p_to;
  PERFORM set_config('hsdg.push_owner', '', true);
END $$;

/** Forgets an endpoint the push service says is gone (404/410), whoever's it was. */
CREATE FUNCTION hsdg.push_forget(p_endpoint text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF hsdg.ctx_employee_id() IS NULL THEN RETURN; END IF;
  PERFORM set_config('hsdg.push_owner', 'on', true);
  DELETE FROM hsdg.push_subscriptions WHERE endpoint = p_endpoint;
  PERFORM set_config('hsdg.push_owner', '', true);
END $$;

REVOKE ALL ON FUNCTION hsdg.push_subscribe(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hsdg.push_targets(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hsdg.push_forget(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.push_subscribe(text, text, text, text) TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.push_targets(uuid, uuid) TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.push_forget(text) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.push_forget(text);
DROP FUNCTION IF EXISTS hsdg.push_targets(uuid, uuid);
DROP FUNCTION IF EXISTS hsdg.push_subscribe(text, text, text, text);
DROP TABLE IF EXISTS hsdg.push_subscriptions;
