-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · How we measure it — the practice session.
--
-- "Run a short session with two seniors and one manager doing their real
-- Monday list, and count clicks against the baseline." For the chosen people
-- and an exact time window (e.g. today 10:00–11:00), per person: sessions,
-- steps from sign-in to the first filing (median), pages moved to, row opens
-- and how many landed on the exact item. SECURITY DEFINER (telemetry rows are
-- read only in aggregate); people are those the CALLER can see (hsdg.users is
-- FORCE RLS). Steps count as in telemetry_measures: a redirect is not a step.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.telemetry_practice(
  p_from     timestamptz,
  p_to       timestamptz,
  p_user_ids uuid[]
) RETURNS TABLE (
  user_id              uuid,
  sessions             integer,
  sessions_with_filing integer,
  steps_median         numeric,
  routes               integer,
  row_opens            integer,
  exact_row_opens      integer
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  WITH people AS (
    SELECT u.id FROM hsdg.users u WHERE u.id = ANY (p_user_ids)
  ),
  ev AS (
    SELECT e.user_id, e.session_id, e.kind, e.occurred_at, e.id,
           (e.params && ARRAY['part','task','request','open']) AS exact
      FROM hsdg.telemetry_events e
     WHERE e.occurred_at >= p_from AND e.occurred_at < p_to
       AND e.user_id IN (SELECT id FROM people)
  ),
  pages AS (
    SELECT user_id, session_id, exact,
           sum((kind = 'route')::int) OVER (PARTITION BY user_id, session_id
                                            ORDER BY occurred_at, id) AS n
      FROM ev WHERE kind IN ('route','redirect')
  ),
  per_session AS (
    SELECT user_id, session_id, min(greatest(n, 1)) FILTER (WHERE exact) - 1 AS steps
      FROM pages GROUP BY user_id, session_id
  )
  SELECT p.id,
         (SELECT count(*) FROM per_session s WHERE s.user_id = p.id)::integer,
         (SELECT count(*) FROM per_session s WHERE s.user_id = p.id AND s.steps IS NOT NULL)::integer,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.steps)
            FROM per_session s WHERE s.user_id = p.id AND s.steps IS NOT NULL)::numeric,
         (SELECT count(*) FROM ev WHERE ev.user_id = p.id AND kind = 'route')::integer,
         (SELECT count(*) FROM ev WHERE ev.user_id = p.id AND kind = 'row_open')::integer,
         (SELECT count(*) FROM ev WHERE ev.user_id = p.id AND kind = 'row_open' AND exact)::integer
    FROM people p;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.telemetry_practice(timestamptz, timestamptz, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.telemetry_practice(timestamptz, timestamptz, uuid[]) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.telemetry_practice(timestamptz, timestamptz, uuid[]);
