-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · How we measure it — steps are the person's, not the app's.
--
-- A URL the app changes on its own (the sign-in landing redirect, a default
-- month or section filled in) is recorded as kind 'redirect'. It still counts
-- for reaching a filing, but it is not a step: steps from sign-in to the first
-- filing count only the pages the person moved to themselves.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.telemetry_events DROP CONSTRAINT telemetry_events_kind_check;
ALTER TABLE hsdg.telemetry_events ADD CONSTRAINT telemetry_events_kind_check
  CHECK (kind IN ('route','redirect','row_open'));

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
  pages AS (
    -- The n-th page the person moved to, as of each URL (a redirect keeps the
    -- step it followed).
    SELECT session_id, exact,
           sum((kind = 'route')::int) OVER (PARTITION BY session_id
                                            ORDER BY occurred_at, id) AS n
      FROM ev WHERE kind IN ('route','redirect')
  ),
  per_session AS (
    -- The landing page after sign-in is step 0, so the first filing on the
    -- n-th page is n − 1 steps away.
    SELECT session_id, min(greatest(n, 1)) FILTER (WHERE exact) - 1 AS steps
      FROM pages GROUP BY session_id
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

-- Down Migration

-- Redirects were pages before: keep them, as routes. (ENABLE-only RLS: the
-- migrator owns the table, so this update is not filtered.)
UPDATE hsdg.telemetry_events SET kind = 'route' WHERE kind = 'redirect';
ALTER TABLE hsdg.telemetry_events DROP CONSTRAINT telemetry_events_kind_check;
ALTER TABLE hsdg.telemetry_events ADD CONSTRAINT telemetry_events_kind_check
  CHECK (kind IN ('route','row_open'));

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
