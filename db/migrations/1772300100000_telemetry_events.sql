-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · How we measure it
--
-- telemetry_events — lightweight client events, no content: a route change or a
-- list row opened, as a normalised path (ids replaced), the NAMES of its query
-- parameters (never their values), the list it came from, and a per-tab
-- session id. Written by the signed-in user for themselves; nobody reads rows.
--
-- telemetry_measures — the cross-user aggregates the measures need and no app
-- role may compute row by row (SECURITY DEFINER; aggregates only):
--   • steps from sign-in to the first filing opened, per session (median);
--   • share of list rows opened that land on the exact item (section / task /
--     request / the filing drawer);
--   • unread actionable notifications per user, averaged over the days.
-- People are the active users the CALLER can see (hsdg.users is FORCE RLS), so
-- an office-scoped reader measures their office, like the other MIS reports.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.telemetry_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL DEFAULT hsdg.ctx_user_id() REFERENCES hsdg.users (id) ON DELETE CASCADE,
  session_id  text NOT NULL CHECK (session_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  kind        text NOT NULL CHECK (kind IN ('route','row_open')),
  path        text NOT NULL CHECK (length(path) BETWEEN 1 AND 200 AND path LIKE '/%'),
  params      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(params) <= 20),
  source      text CHECK (source ~ '^[a-z0-9_-]{1,40}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telemetry_events_occurred_idx ON hsdg.telemetry_events (occurred_at);
CREATE INDEX telemetry_events_session_idx ON hsdg.telemetry_events (session_id, occurred_at, id);

-- Insert only, as yourself. No SELECT/UPDATE/DELETE policy: rows are read only
-- in aggregate, through the function below — ENABLE (not FORCE) so that
-- migrator-owned function reads them as the owner.
ALTER TABLE hsdg.telemetry_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY telemetry_events_insert_own ON hsdg.telemetry_events
  FOR INSERT WITH CHECK (user_id = hsdg.ctx_user_id());

CREATE OR REPLACE FUNCTION hsdg.telemetry_measures(
  p_from        timestamptz,
  p_to          timestamptz,
  p_office_id   uuid,
  p_actionable  text[]
) RETURNS TABLE (
  sessions             integer,
  sessions_with_filing integer,
  steps_median         numeric,
  row_opens            integer,
  exact_row_opens      integer,
  users                integer,
  unread_per_user      numeric
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  WITH people AS (
    SELECT u.id FROM hsdg.users u
     WHERE u.is_active AND (p_office_id IS NULL OR u.primary_office_id = p_office_id)
  ),
  ev AS (
    SELECT e.session_id, e.kind, e.path, e.params, e.occurred_at, e.id,
           -- A filing opened: its section, its task, or the filing drawer.
           (e.params && ARRAY['part','task','request','open']) AS exact
      FROM hsdg.telemetry_events e
     WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
       AND e.user_id IN (SELECT id FROM people)
  ),
  routes AS (
    SELECT session_id, exact,
           row_number() OVER (PARTITION BY session_id ORDER BY occurred_at, id) AS n
      FROM ev WHERE kind = 'route'
  ),
  per_session AS (
    -- The landing page after sign-in is step 0, so the first filing on the
    -- n-th route is n − 1 steps away.
    SELECT session_id, min(n) FILTER (WHERE exact) - 1 AS steps
      FROM routes GROUP BY session_id
  ),
  days AS (
    SELECT d::date AS day
      FROM generate_series((p_from AT TIME ZONE 'Asia/Kolkata')::date,
                           ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Kolkata')::date,
                           interval '1 day') d
  ),
  unread AS (
    -- Unread at each day's end (IST): created by then, not read by then.
    SELECT p.id, d.day,
           (SELECT count(*) FROM hsdg.notifications n
             WHERE n.recipient_user_id = p.id AND n.type = ANY (p_actionable)
               AND n.status <> 'dismissed'
               AND n.created_at < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
               AND (n.read_at IS NULL
                    OR n.read_at >= ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))) AS c
      FROM people p CROSS JOIN days d
  )
  SELECT
    (SELECT count(*) FROM per_session)::integer,
    (SELECT count(*) FROM per_session WHERE steps IS NOT NULL)::integer,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY steps)
       FROM per_session WHERE steps IS NOT NULL)::numeric,
    (SELECT count(*) FROM ev WHERE kind = 'row_open')::integer,
    (SELECT count(*) FROM ev WHERE kind = 'row_open' AND exact)::integer,
    (SELECT count(*) FROM people)::integer,
    (SELECT round(avg(c), 2) FROM unread)::numeric;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.telemetry_measures(timestamptz, timestamptz, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.telemetry_measures(timestamptz, timestamptz, uuid, text[]) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.telemetry_measures(timestamptz, timestamptz, uuid, text[]);
DROP TABLE IF EXISTS hsdg.telemetry_events;
