-- ─────────────────────────────────────────────────────────────────────────
-- Engagement restructure — existing data (spec "Migration of existing data").
--
--   1. Kind backfill               done by 1770000000000 (engagements.kind)
--   2. Split mixed engagements      a Statutory Audit carrying a stream service
--      (ITR_FILING locally) keeps the audit — the audit file keys on its id —
--      and the stream line moves to the client's Compliance engagement
--      (created if none) with its compliance instances, the tasks generated
--      from them, and those tasks' documents. Manual tasks stay and are listed
--      for a manager to re-home.
--   3. Merge per-FY Compliance engagements into one standing engagement per
--      client: the oldest open one survives, the others become `merged`
--      (merged_into_id; their codes stay searchable as aliases). Each former FY
--      becomes a compliance_engagement_years row.
--   4. Time entries and invoices are not moved; reports follow merged_into_id.
--   5. Running timers are closed at cut-over (stopped_reason 'manual').
--   + one open Compliance engagement per client, enforced from here on.
--
-- Every change is written to hsdg.engagement_restructure_moves first: the dry
-- run (scripts/engagement-restructure-report.ts) runs this Up section inside a
-- transaction it rolls back and writes the log as CSV for a partner to sign
-- off; the Down section replays the log backwards.
--
-- Lines are never re-filed across financial years: engagement_services is
-- unique on (entity, service, FY, period label) and takes its FY from the
-- engagement, so a merged engagement keeps its own lines and the survivor gets
-- one line per stream (the live STREAM_* service) for the instances moved in.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.engagement_restructure_moves (
  id                 bigserial PRIMARY KEY,
  step               text NOT NULL CHECK (step IN ('split','merge','year','timer','review')),
  -- the table the row lives in; 'engagements' rows created here have action 'created'
  object_type        text NOT NULL,
  object_id          uuid NOT NULL,
  action             text NOT NULL CHECK (action IN
                       ('created','moved','merged','cancelled','closed','deleted','left')),
  from_engagement_id uuid,
  to_engagement_id   uuid,
  -- the row's columns before the change (what Down restores)
  prior              jsonb NOT NULL DEFAULT '{}'::jsonb,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagement_restructure_moves_from_idx
  ON hsdg.engagement_restructure_moves (from_engagement_id);

REVOKE ALL ON hsdg.engagement_restructure_moves FROM PUBLIC;
GRANT SELECT ON hsdg.engagement_restructure_moves TO hsdg_app;
ALTER TABLE hsdg.engagement_restructure_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_restructure_moves FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_restructure_moves_read ON hsdg.engagement_restructure_moves
  FOR SELECT USING (hsdg.ctx_is_firmwide());

-- A merged engagement is terminal like a declined one: a prospect merged
-- before anyone was made its partner needs none.
ALTER TABLE hsdg.engagements DROP CONSTRAINT engagements_ep_required_when_accepted;
ALTER TABLE hsdg.engagements ADD CONSTRAINT engagements_ep_required_when_accepted CHECK (
  status IN ('prospect','pending_acceptance','declined','withdrawn','cancelled','merged')
  OR engagement_partner_id IS NOT NULL);

ALTER TABLE hsdg.engagements                   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_entities           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_team               NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_components         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.component_instances           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_notes              NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_workflow_instances    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_deadlines NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_overrides NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks                         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_dependencies             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.documents                     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.document_versions             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_time_entries       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entities                      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_restructure_moves  NO FORCE ROW LEVEL SECURITY;

-- Move compliance instances (with their deadlines and overrides, the tasks
-- generated from them, those tasks' dependencies and documents) to another
-- engagement and line (NULL when the instance's stream is unknown), logging
-- each row.
CREATE FUNCTION hsdg.restructure_move_instances(
  p_step text, inst uuid[], to_eng uuid, to_line uuid
) RETURNS void LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE
  moved_tasks uuid[];
  dup uuid[];
BEGIN
  IF COALESCE(cardinality(inst), 0) = 0 THEN
    RETURN;
  END IF;

  -- Per-year engagements of one client each carried their own copy of a
  -- filing. A copy the standing engagement already has — or a later copy
  -- within this batch (the earliest stays) — would break the filing's
  -- uniqueness there, so it is left where it is for a person to resolve.
  WITH ranked AS (
    SELECT i.id, i.engagement_id, i.compliance_rule_id, i.reference_date,
           i.registration_id, i.period_key,
           row_number() OVER (PARTITION BY i.compliance_rule_id, i.reference_date
                              ORDER BY i.created_at, i.id) AS rn_ref,
           row_number() OVER (PARTITION BY i.compliance_rule_id, i.registration_id, i.period_key
                              ORDER BY i.created_at, i.id) AS rn_period
      FROM compliance_instances i WHERE i.id = ANY (inst)
  )
  SELECT COALESCE(array_agg(r.id), '{}') INTO dup
    FROM ranked r
   WHERE (r.reference_date IS NOT NULL AND (r.rn_ref > 1 OR EXISTS (
            SELECT 1 FROM compliance_instances o
             WHERE o.engagement_id = to_eng AND NOT (o.id = ANY (inst))
               AND o.compliance_rule_id = r.compliance_rule_id
               AND o.reference_date = r.reference_date)))
      OR (r.period_key IS NOT NULL AND (r.rn_period > 1 OR EXISTS (
            SELECT 1 FROM compliance_instances o
             WHERE o.engagement_id = to_eng AND NOT (o.id = ANY (inst))
               AND o.compliance_rule_id = r.compliance_rule_id
               AND o.registration_id IS NOT DISTINCT FROM r.registration_id
               AND o.period_key = r.period_key)));
  IF cardinality(dup) > 0 THEN
    INSERT INTO engagement_restructure_moves
           (step, object_type, object_id, action, from_engagement_id, to_engagement_id, note)
    SELECT 'review', 'compliance_instances', id, 'left', engagement_id, to_eng,
           'Duplicate of a filing already on the standing engagement — left on the '
           || CASE p_step WHEN 'merge' THEN 'merged' ELSE 'original' END || ' one.'
      FROM compliance_instances WHERE id = ANY (dup);
    SELECT COALESCE(array_agg(x), '{}') INTO inst
      FROM unnest(inst) AS x WHERE NOT (x = ANY (dup));
    IF cardinality(inst) = 0 THEN
      RETURN;
    END IF;
  END IF;
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
  SELECT p_step, 'compliance_instances', id, 'moved', engagement_id, to_eng,
         jsonb_build_object('engagement_id', engagement_id, 'engagement_service_id', engagement_service_id)
    FROM compliance_instances WHERE id = ANY (inst);
  UPDATE compliance_instances SET engagement_id = to_eng, engagement_service_id = to_line
   WHERE id = ANY (inst);

  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
  SELECT p_step, 'compliance_instance_deadlines', id, 'moved', engagement_id, to_eng,
         jsonb_build_object('engagement_id', engagement_id)
    FROM compliance_instance_deadlines WHERE compliance_instance_id = ANY (inst);
  UPDATE compliance_instance_deadlines SET engagement_id = to_eng
   WHERE compliance_instance_id = ANY (inst);
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
  SELECT p_step, 'compliance_instance_overrides', id, 'moved', engagement_id, to_eng,
         jsonb_build_object('engagement_id', engagement_id)
    FROM compliance_instance_overrides WHERE compliance_instance_id = ANY (inst);
  UPDATE compliance_instance_overrides SET engagement_id = to_eng
   WHERE compliance_instance_id = ANY (inst);

  SELECT COALESCE(array_agg(id), '{}') INTO moved_tasks
    FROM tasks WHERE source_compliance_instance_id = ANY (inst);
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
  SELECT p_step, 'tasks', id, 'moved', engagement_id, to_eng,
         jsonb_build_object('engagement_id', engagement_id)
    FROM tasks WHERE id = ANY (moved_tasks);
  UPDATE tasks SET engagement_id = to_eng WHERE id = ANY (moved_tasks);

  -- A dependency between two moved tasks moves with them; one that would now
  -- span two engagements is removed (and restored by Down).
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior, note)
  SELECT p_step, 'task_dependencies', d.id,
         CASE WHEN d.task_id = ANY (moved_tasks) AND d.depends_on_task_id = ANY (moved_tasks)
              THEN 'moved' ELSE 'deleted' END,
         d.engagement_id, to_eng, to_jsonb(d),
         CASE WHEN NOT (d.task_id = ANY (moved_tasks) AND d.depends_on_task_id = ANY (moved_tasks))
              THEN 'Dependency between a moved and a staying task removed.' END
    FROM task_dependencies d
   WHERE d.task_id = ANY (moved_tasks) OR d.depends_on_task_id = ANY (moved_tasks);
  DELETE FROM task_dependencies d
   WHERE (d.task_id = ANY (moved_tasks)) <> (d.depends_on_task_id = ANY (moved_tasks));
  UPDATE task_dependencies SET engagement_id = to_eng
   WHERE task_id = ANY (moved_tasks) AND depends_on_task_id = ANY (moved_tasks);

  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
  SELECT p_step, 'documents', id, 'moved', engagement_id, to_eng,
         jsonb_build_object('engagement_id', engagement_id)
    FROM documents WHERE task_id = ANY (moved_tasks) AND engagement_id <> to_eng;
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
  SELECT p_step, 'document_versions', v.id, 'moved', v.engagement_id, to_eng,
         jsonb_build_object('engagement_id', v.engagement_id)
    FROM document_versions v JOIN documents d ON d.id = v.document_id
   WHERE d.task_id = ANY (moved_tasks) AND v.engagement_id <> to_eng;
  UPDATE document_versions v SET engagement_id = to_eng
    FROM documents d
   WHERE d.id = v.document_id AND d.task_id = ANY (moved_tasks) AND v.engagement_id <> to_eng;
  UPDATE documents SET engagement_id = to_eng
   WHERE task_id = ANY (moved_tasks) AND engagement_id <> to_eng;
END;
$$;

-- The engagement's live line for a stream (fold-aware), adding the stream
-- service's line when it has none.
CREATE FUNCTION hsdg.restructure_stream_line(p_step text, eng uuid, p_stream text)
RETURNS uuid LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE
  line uuid;
BEGIN
  SELECT es.id INTO line
    FROM engagement_services es JOIN services s ON s.id = es.service_id
   WHERE es.engagement_id = eng AND es.status <> 'cancelled' AND s.stream = p_stream
   ORDER BY es.is_primary DESC, es.created_at
   LIMIT 1;
  IF line IS NOT NULL THEN
    RETURN line;
  END IF;
  INSERT INTO engagement_services
         (engagement_id, service_id, office_id, lead_employee_id, is_primary, status)
  SELECT e.id, s.id, e.office_id, e.engagement_partner_id, false,
         engagement_service_status_from(e.status)
    FROM engagements e
    JOIN services s ON s.stream = p_stream AND s.folded_into_service_id IS NULL
   WHERE e.id = eng
  RETURNING id INTO line;
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, to_engagement_id, note)
  VALUES (p_step, 'engagement_services', line, 'created', eng,
          'Stream line added for the work moved in.');
  RETURN line;
END;
$$;

-- An instance's stream: its line's service, else its rule's service (folded
-- services carry their stream).
CREATE FUNCTION hsdg.restructure_instance_stream(ci_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT COALESCE(ls.stream, rs.stream)
    FROM compliance_instances ci
    LEFT JOIN engagement_services es ON es.id = ci.engagement_service_id
    LEFT JOIN services ls ON ls.id = es.service_id
    LEFT JOIN compliance_rules ru ON ru.id = ci.compliance_rule_id
    LEFT JOIN services rs ON rs.id = ru.service_id
   WHERE ci.id = ci_id
$$;

-- FY start year of today (Indian FY: April–March).
CREATE FUNCTION hsdg.restructure_current_fy_start() RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata') - interval '3 months')::int
$$;

CREATE TEMP TABLE restructure_year_sources (
  engagement_id  uuid NOT NULL,
  financial_year text NOT NULL,
  stream         text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  terminal constant text[] := ARRAY['closed','merged','cancelled','declined','withdrawn'];
  r record;
  g record;
  m uuid;
  cr uuid;
  target uuid;
  survivor uuid;
BEGIN
  PERFORM set_config('search_path', 'hsdg, public', true);
  -- ── 2. Split: stream lines off open Statutory Audit engagements ─────────
  FOR r IN
    SELECT es.id AS line_id, e.id AS sa_id, e.entity_id, e.financial_year, e.office_id,
           e.engagement_partner_id, e.engagement_manager_id, e.status, e.accepted_at,
           s.code, s.stream
      FROM engagement_services es
      JOIN engagements e ON e.id = es.engagement_id
      JOIN services s ON s.id = es.service_id
     WHERE e.kind = 'statutory_audit' AND s.code <> 'STAT_AUDIT' AND es.status <> 'cancelled'
     ORDER BY e.created_at, es.created_at
  LOOP
    IF r.stream IS NULL OR r.status = ANY (terminal) THEN
      INSERT INTO engagement_restructure_moves
             (step, object_type, object_id, action, from_engagement_id, note)
      VALUES ('review', 'engagement_services', r.line_id, 'left', r.sa_id,
              CASE WHEN r.stream IS NULL
                   THEN r.code || ' is not a stream service — re-home it to an assignment by hand.'
                   ELSE r.code || ' on a ' || r.status || ' Statutory Audit — left in place.' END);
      CONTINUE;
    END IF;

    SELECT id INTO cr FROM engagements
     WHERE entity_id = r.entity_id AND kind = 'compliance' AND status <> ALL (terminal)
     ORDER BY (status = 'completed'), created_at
     LIMIT 1;
    IF cr IS NULL THEN
      INSERT INTO engagements
             (entity_id, service_id, financial_year, period_label, office_id,
              engagement_partner_id, engagement_manager_id, status, accepted_at,
              engagement_type, kind)
      SELECT r.entity_id, s.id, r.financial_year, 'FY', r.office_id,
             r.engagement_partner_id, r.engagement_manager_id,
             CASE WHEN r.status = 'completed' THEN 'active' ELSE r.status END, r.accepted_at,
             'recurring_compliance', 'compliance'
        FROM services s
       WHERE s.stream = r.stream AND s.folded_into_service_id IS NULL
      RETURNING id INTO cr;
      INSERT INTO engagement_restructure_moves
             (step, object_type, object_id, action, from_engagement_id, to_engagement_id, note)
      VALUES ('split', 'engagements', cr, 'created', r.sa_id, cr,
              'Compliance engagement created for the work split off the Statutory Audit.');
      INSERT INTO engagement_team (engagement_id, employee_id, role_on_engagement)
      SELECT cr, t.employee_id, t.role_on_engagement
        FROM engagement_team t WHERE t.engagement_id = r.sa_id
      ON CONFLICT (engagement_id, employee_id) DO NOTHING;
    END IF;

    target := restructure_stream_line('split', cr, r.stream);
    -- The line's instances, and unlined ones whose rule is this stream's.
    PERFORM restructure_move_instances('split', ARRAY(
      SELECT ci.id FROM compliance_instances ci
       WHERE ci.engagement_service_id = r.line_id
          OR (ci.engagement_id = r.sa_id AND ci.engagement_service_id IS NULL
              AND restructure_instance_stream(ci.id) = r.stream)), cr, target);
    INSERT INTO engagement_restructure_moves
           (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
    SELECT 'split', 'engagement_services', es.id, 'cancelled', r.sa_id, cr,
           jsonb_build_object('status', es.status)
      FROM engagement_services es WHERE es.id = r.line_id;
    UPDATE engagement_services SET status = 'cancelled' WHERE id = r.line_id;
    INSERT INTO restructure_year_sources VALUES (cr, r.financial_year, r.stream);

    -- Manual tasks (no compliance instance) stay on the audit; list them.
    INSERT INTO engagement_restructure_moves
           (step, object_type, object_id, action, from_engagement_id, to_engagement_id, note)
    SELECT 'review', 'tasks', t.id, 'left', r.sa_id, cr,
           'Manual task on a split Statutory Audit — a manager re-homes it if it is ' ||
           r.code || ' work.'
      FROM tasks t
     WHERE t.engagement_id = r.sa_id AND t.source_compliance_instance_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM engagement_restructure_moves x
                        WHERE x.object_type = 'tasks' AND x.object_id = t.id);
  END LOOP;

  -- ── 3. Merge: one standing Compliance engagement per client ────────────
  FOR g IN
    SELECT entity_id,
           array_agg(id ORDER BY (status = 'completed'), created_at) AS ids
      FROM engagements
     WHERE kind = 'compliance' AND status <> ALL (terminal)
     GROUP BY entity_id
    HAVING count(*) > 1
  LOOP
    survivor := g.ids[1];
    FOREACH m IN ARRAY g.ids[2:] LOOP
      FOR r IN
        SELECT restructure_instance_stream(ci.id) AS stream, array_agg(ci.id) AS ids
          FROM compliance_instances ci WHERE ci.engagement_id = m
         GROUP BY 1
      LOOP
        target := CASE WHEN r.stream IS NULL THEN NULL
                       ELSE restructure_stream_line('merge', survivor, r.stream) END;
        PERFORM restructure_move_instances('merge', r.ids, survivor, target);
      END LOOP;
      INSERT INTO restructure_year_sources
      SELECT survivor, e.financial_year, s.stream
        FROM engagements e
        JOIN engagement_services es ON es.engagement_id = e.id AND es.status <> 'cancelled'
        JOIN services s ON s.id = es.service_id AND s.stream IS NOT NULL
       WHERE e.id = m;

      -- Its partner, manager and team keep access to the work moved in.
      WITH people AS (
        SELECT employee_id, role_on_engagement FROM engagement_team WHERE engagement_id = m
        UNION
        SELECT engagement_manager_id, 'member' FROM engagements
         WHERE id = m AND engagement_manager_id IS NOT NULL
        UNION
        SELECT engagement_partner_id, 'reviewer' FROM engagements
         WHERE id = m AND engagement_partner_id IS NOT NULL
      ), added AS (
        INSERT INTO engagement_team (engagement_id, employee_id, role_on_engagement)
        SELECT DISTINCT ON (p.employee_id) survivor, p.employee_id, p.role_on_engagement
          FROM people p
          JOIN engagements s ON s.id = survivor
         WHERE p.employee_id IS DISTINCT FROM s.engagement_partner_id
           AND p.employee_id IS DISTINCT FROM s.engagement_manager_id
        ON CONFLICT (engagement_id, employee_id) DO NOTHING
        RETURNING id
      )
      INSERT INTO engagement_restructure_moves
             (step, object_type, object_id, action, from_engagement_id, to_engagement_id)
      SELECT 'merge', 'engagement_team', id, 'created', m, survivor FROM added;

      INSERT INTO engagement_restructure_moves
             (step, object_type, object_id, action, from_engagement_id, to_engagement_id, prior)
      SELECT 'merge', 'engagements', e.id, 'merged', e.id, survivor,
             jsonb_build_object('status', e.status)
        FROM engagements e WHERE e.id = m;
      UPDATE engagements SET status = 'merged', merged_into_id = survivor WHERE id = m;

      INSERT INTO engagement_restructure_moves
             (step, object_type, object_id, action, from_engagement_id, to_engagement_id, note)
      SELECT 'review', 'tasks', t.id, 'left', m, survivor,
             'Manual task on a merged Compliance engagement — reachable through the survivor.'
        FROM tasks t
       WHERE t.engagement_id = m AND t.source_compliance_instance_id IS NULL
         AND t.status NOT IN ('done', 'cancelled');
    END LOOP;
  END LOOP;

  -- ── Years in scope: each open Compliance engagement's own FY and streams,
  --    plus the FYs merged or split into it. ─────────────────────────────
  INSERT INTO restructure_year_sources
  SELECT e.id, e.financial_year, s.stream
    FROM engagements e
    JOIN engagement_services es ON es.engagement_id = e.id AND es.status <> 'cancelled'
    JOIN services s ON s.id = es.service_id
   WHERE e.kind = 'compliance' AND e.status <> ALL (terminal) AND s.stream IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM engagement_restructure_moves x
                      WHERE x.object_type = 'engagement_services' AND x.object_id = es.id
                        AND x.action = 'created');

  -- Years before last FY are closed: their filings are done outside the
  -- portal, and an open year would generate a backlog of overdue items.
  WITH ins AS (
    INSERT INTO compliance_engagement_years (engagement_id, financial_year, streams, status, closed_at)
    SELECT engagement_id, financial_year, array_agg(DISTINCT stream ORDER BY stream),
           CASE WHEN left(financial_year, 4)::int >= restructure_current_fy_start() - 1
                THEN 'open' ELSE 'closed' END,
           CASE WHEN left(financial_year, 4)::int >= restructure_current_fy_start() - 1
                THEN NULL ELSE now() END
      FROM restructure_year_sources
     GROUP BY engagement_id, financial_year
    ON CONFLICT (engagement_id, financial_year) DO NOTHING
    RETURNING id, engagement_id, financial_year, status
  )
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, to_engagement_id, note)
  SELECT 'year', 'compliance_engagement_years', id, 'created', engagement_id,
         'FY ' || financial_year || ' (' || status || ')'
    FROM ins;

  -- ── 5. Close running timers at cut-over ─────────────────────────────────
  INSERT INTO engagement_restructure_moves
         (step, object_type, object_id, action, from_engagement_id, prior)
  SELECT 'timer', 'engagement_time_entries', id, 'closed', engagement_id,
         jsonb_build_object('started_at', started_at)
    FROM engagement_time_entries WHERE ended_at IS NULL;
  UPDATE engagement_time_entries
     SET ended_at = greatest(now(), started_at),
         duration_seconds = greatest(0, extract(epoch FROM now() - started_at))::int,
         stopped_reason = 'manual'
   WHERE ended_at IS NULL;
END;
$$;

DROP FUNCTION hsdg.restructure_current_fy_start();
DROP FUNCTION hsdg.restructure_instance_stream(uuid);
DROP FUNCTION hsdg.restructure_stream_line(text, uuid, text);
DROP FUNCTION hsdg.restructure_move_instances(text, uuid[], uuid, uuid);

-- One open Compliance engagement per client, from here on.
CREATE UNIQUE INDEX engagements_one_open_compliance ON hsdg.engagements (entity_id)
  WHERE kind = 'compliance'
    AND status NOT IN ('closed','merged','cancelled','declined','withdrawn');

ALTER TABLE hsdg.engagements                   FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services           FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_entities           FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_team               FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_components         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.component_instances           FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_notes              FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.service_workflow_instances    FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_deadlines FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years   FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks                         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_dependencies             FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.documents                     FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.document_versions             FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_time_entries       FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entities                      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_restructure_moves  FORCE ROW LEVEL SECURITY;

-- Down Migration

DROP INDEX IF EXISTS hsdg.engagements_one_open_compliance;

ALTER TABLE hsdg.engagements                   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_entities           NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_team               NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_components         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_independence_facts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_independence_checks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_lifecycle_history  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances          NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_deadlines NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_overrides NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks                         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_dependencies             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.documents                     NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.document_versions             NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_time_entries       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_restructure_moves  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoices                      NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  mv record;
BEGIN
  IF to_regclass('hsdg.engagement_restructure_moves') IS NULL THEN
    RETURN;
  END IF;
  -- Undo newest first; a task is restored before the dependencies that
  -- check it, and created rows go last (after everything moved off them).
  FOR mv IN
    SELECT * FROM hsdg.engagement_restructure_moves
     WHERE action IN ('moved','merged','cancelled','closed','deleted')
     ORDER BY (object_type = 'task_dependencies'), id DESC
  LOOP
    IF mv.action = 'deleted' THEN
      EXECUTE format(
        'INSERT INTO hsdg.%I SELECT * FROM jsonb_populate_record(NULL::hsdg.%I, $1)',
        mv.object_type, mv.object_type) USING mv.prior;
    ELSIF mv.object_type = 'task_dependencies' THEN
      UPDATE hsdg.task_dependencies SET engagement_id = (mv.prior->>'engagement_id')::uuid
       WHERE id = mv.object_id;
    ELSIF mv.object_type = 'compliance_instances' THEN
      UPDATE hsdg.compliance_instances
         SET engagement_id = (mv.prior->>'engagement_id')::uuid,
             engagement_service_id = (mv.prior->>'engagement_service_id')::uuid
       WHERE id = mv.object_id;
    ELSIF mv.object_type = 'engagement_services' THEN
      UPDATE hsdg.engagement_services SET status = mv.prior->>'status' WHERE id = mv.object_id;
    ELSIF mv.object_type = 'engagements' THEN
      UPDATE hsdg.engagements SET status = mv.prior->>'status', merged_into_id = NULL
       WHERE id = mv.object_id;
    ELSIF mv.object_type = 'engagement_time_entries' THEN
      UPDATE hsdg.engagement_time_entries
         SET ended_at = NULL, duration_seconds = NULL, stopped_reason = NULL
       WHERE id = mv.object_id
         AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_time_entries r
                          WHERE r.employee_id = engagement_time_entries.employee_id
                            AND r.ended_at IS NULL);
    ELSE
      EXECUTE format('UPDATE hsdg.%I SET engagement_id = $1 WHERE id = $2', mv.object_type)
        USING (mv.prior->>'engagement_id')::uuid, mv.object_id;
    END IF;
  END LOOP;

  -- Rows this migration created: years, stream lines, team members, and the
  -- Compliance engagements made for split work (with what hangs off them).
  DELETE FROM hsdg.compliance_engagement_years y USING hsdg.engagement_restructure_moves lg
   WHERE lg.object_type = 'compliance_engagement_years' AND lg.object_id = y.id;
  DELETE FROM hsdg.engagement_team t USING hsdg.engagement_restructure_moves lg
   WHERE lg.object_type = 'engagement_team' AND lg.object_id = t.id;
  DELETE FROM hsdg.engagement_services es USING hsdg.engagement_restructure_moves lg
   WHERE lg.object_type = 'engagement_services' AND lg.action = 'created' AND lg.object_id = es.id
     AND NOT EXISTS (SELECT 1 FROM hsdg.compliance_instances ci WHERE ci.engagement_service_id = es.id);
  FOR mv IN
    SELECT object_id FROM hsdg.engagement_restructure_moves
     WHERE object_type = 'engagements' AND action = 'created'
  LOOP
    IF NOT EXISTS (SELECT 1 FROM hsdg.compliance_instances WHERE engagement_id = mv.object_id)
       AND NOT EXISTS (SELECT 1 FROM hsdg.tasks WHERE engagement_id = mv.object_id)
       AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_time_entries WHERE engagement_id = mv.object_id)
       AND NOT EXISTS (SELECT 1 FROM hsdg.invoices WHERE engagement_id = mv.object_id) THEN
      DELETE FROM hsdg.compliance_engagement_years WHERE engagement_id = mv.object_id;
      DELETE FROM hsdg.engagement_independence_checks WHERE engagement_id = mv.object_id;
      DELETE FROM hsdg.engagement_lifecycle_history WHERE engagement_id = mv.object_id;
      DELETE FROM hsdg.engagement_team WHERE engagement_id = mv.object_id;
      DELETE FROM hsdg.engagement_components WHERE engagement_id = mv.object_id;
      DELETE FROM hsdg.engagement_services WHERE engagement_id = mv.object_id;
      DELETE FROM hsdg.engagement_entities WHERE engagement_id = mv.object_id;
      DELETE FROM hsdg.engagements WHERE id = mv.object_id;
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE hsdg.engagements                   FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services           FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_entities           FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_team               FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_components         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_independence_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_independence_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_lifecycle_history  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_deadlines FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instance_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_engagement_years   FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks                         FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_dependencies             FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.documents                     FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.document_versions             FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_time_entries       FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.services                      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_restructure_moves  FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoices                      FORCE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS hsdg.engagement_restructure_moves;

ALTER TABLE hsdg.engagements DROP CONSTRAINT engagements_ep_required_when_accepted;
ALTER TABLE hsdg.engagements ADD CONSTRAINT engagements_ep_required_when_accepted CHECK (
  status IN ('prospect','pending_acceptance','declined','withdrawn','cancelled')
  OR engagement_partner_id IS NOT NULL);
