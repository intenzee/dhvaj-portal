-- ─────────────────────────────────────────────────────────────────────────
-- Every filing has a task (Phase 2, C-1)
--
-- When the calendar builds a filing it also makes its task, "Prepare GSTR-1 ·
-- Oct 2026", due on the internal date (an override first). The first owner is
-- the stream lead, else the engagement's Manager, else its Engagement Partner,
-- skipping anyone who has left. Filings already filed or not applicable get
-- none, and a filing that already has a task keeps it (tasks_one_per_source_instance).
--
-- tasks.auto_created marks the calendar's tasks. One still untouched (to do,
-- never handed on) does not count as work on its filing: a stream taken out of
-- scope still retires the filing, and the task follows it. A filing marked not
-- applicable cancels its untouched task, reopening it restores the task, a
-- filing marked filed without a lodge closes it (a lodge closes its task
-- itself), and a new internal date moves its due date (unless someone changed
-- that by hand). Creating a task for a filing takes over its untouched one.
--
-- The backfill makes tasks for every open filing already on the portal.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.tasks ADD COLUMN auto_created boolean NOT NULL DEFAULT false;

-- 'Oct 2026', 'Q3 2026-27', 'Jul–Dec 2026', 'FY 2026-27' (periodKeyLabel in
-- packages/contracts); an event's or a legacy filing's date stands in for a key.
CREATE FUNCTION hsdg.filing_period_label(p_period_key text, p_reference_date date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_period_key IS NULL OR p_period_key LIKE 'EVT:%' THEN
      CASE WHEN p_period_key IS NULL THEN to_char(p_reference_date, 'Mon YYYY')
           ELSE to_char(p_reference_date, 'FMDD Mon YYYY') END
    WHEN p_period_key ~ '^\d{4}-\d{2}$'
         AND right(p_period_key, 2)::int <> (left(p_period_key, 4)::int + 1) % 100 THEN
      to_char(to_date(p_period_key || '-01', 'YYYY-MM-DD'), 'Mon YYYY')
    WHEN split_part(p_period_key, ':', 2) = 'DIN' THEN
      'FY ' || split_part(p_period_key, ':', 1) || ' · DIN ' || split_part(p_period_key, ':', 3)
    WHEN split_part(p_period_key, ':', 2) = 'CH2' THEN
      'Jul–Dec ' || left(p_period_key, 4)
    WHEN split_part(p_period_key, ':', 2) = 'CH1' THEN
      'Jan–Jun ' || (left(p_period_key, 4)::int + 1)
    WHEN split_part(p_period_key, ':', 2) <> '' THEN
      split_part(p_period_key, ':', 2) || ' ' || split_part(p_period_key, ':', 1)
    ELSE 'FY ' || p_period_key
  END
$$;

-- Makes the task of each open filing in p_ids that has none; returns how many.
-- Runs with the caller's rights: the calendar is built by the engagement's leads.
CREATE FUNCTION hsdg.make_filing_tasks(p_ids uuid[]) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  made integer;
  was_system text := current_setting('hsdg.task_event_system', true);
  was_reason text := current_setting('hsdg.task_event_reason', true);
BEGIN
  IF coalesce(cardinality(p_ids), 0) = 0 THEN RETURN 0; END IF;
  PERFORM set_config('hsdg.task_event_system', 'on', true);
  PERFORM set_config('hsdg.task_event_reason', 'calendar', true);
  INSERT INTO hsdg.tasks
    (engagement_id, title, assigned_to_employee_id, due_date, engagement_service_id,
     work_type, source_compliance_instance_id, auto_created)
  SELECT ci.engagement_id,
         'Prepare ' || coalesce(nullif(ci.form_label, ''), nullif(v.form_label, ''), r.name)
           || ' · ' || hsdg.filing_period_label(ci.period_key, ci.reference_date),
         owner.id,
         coalesce(ci.internal_sla_override, ci.internal_sla_date),
         ci.engagement_service_id,
         'filing', ci.id, true
    FROM hsdg.compliance_instances ci
    JOIN hsdg.engagements e ON e.id = ci.engagement_id
    JOIN hsdg.compliance_rules r ON r.id = ci.compliance_rule_id
    LEFT JOIN hsdg.compliance_rule_versions v ON v.id = ci.compliance_rule_version_id
    LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
    LEFT JOIN LATERAL (
      SELECT o.id
        FROM (VALUES (1, es.lead_employee_id), (2, e.engagement_manager_id),
                     (3, e.engagement_partner_id)) AS o(rank, id)
        JOIN hsdg.employees em ON em.id = o.id
       WHERE em.employment_status <> 'exited' AND em.deleted_at IS NULL
       ORDER BY o.rank
       LIMIT 1
    ) owner ON true
   WHERE ci.id = ANY(p_ids)
     AND ci.status = 'open'
     AND ci.workflow_status NOT IN ('filed', 'not_applicable')
  ON CONFLICT (source_compliance_instance_id) WHERE source_compliance_instance_id IS NOT NULL
  DO NOTHING;
  GET DIAGNOSTICS made = ROW_COUNT;
  PERFORM set_config('hsdg.task_event_system', coalesce(was_system, ''), true);
  PERFORM set_config('hsdg.task_event_reason', coalesce(was_reason, ''), true);
  RETURN made;
END $$;

-- The calendar's untouched task follows its filing.
CREATE FUNCTION hsdg.filing_tasks_follow_filing() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  was_reason text := current_setting('hsdg.task_event_reason', true);
BEGIN
  -- A new internal date moves the task's due date, unless someone set it by hand.
  IF coalesce(NEW.internal_sla_override, NEW.internal_sla_date)
       IS DISTINCT FROM coalesce(OLD.internal_sla_override, OLD.internal_sla_date) THEN
    UPDATE hsdg.tasks SET due_date = coalesce(NEW.internal_sla_override, NEW.internal_sla_date),
                          version = version + 1
     WHERE source_compliance_instance_id = NEW.id AND auto_created
       AND status NOT IN ('done', 'cancelled')
       AND due_date IS NOT DISTINCT FROM coalesce(OLD.internal_sla_override, OLD.internal_sla_date);
  END IF;
  IF NEW.workflow_status IS NOT DISTINCT FROM OLD.workflow_status THEN
    RETURN NULL;
  ELSIF NEW.workflow_status = 'not_applicable' THEN
    PERFORM set_config('hsdg.task_event_reason', 'filing_not_applicable', true);
    UPDATE hsdg.tasks SET status = 'cancelled', version = version + 1
     WHERE source_compliance_instance_id = NEW.id AND auto_created
       AND status = 'todo' AND assigned_by_employee_id IS NULL;
  ELSIF NEW.workflow_status = 'filed'
        -- Lodging closes the filing's task itself, as its approval or completion.
        AND NOT EXISTS (SELECT 1 FROM hsdg.filing_records fr
                         WHERE fr.compliance_instance_id = NEW.id AND fr.undone_at IS NULL) THEN
    PERFORM set_config('hsdg.task_event_reason', 'filing_filed', true);
    UPDATE hsdg.tasks
       SET status = 'done', completed_at = now(),
           completed_by_employee_id = hsdg.ctx_employee_id(), version = version + 1
     WHERE source_compliance_instance_id = NEW.id AND auto_created
       AND status = 'todo' AND assigned_by_employee_id IS NULL;
  ELSIF OLD.workflow_status = 'not_applicable' AND NEW.workflow_status = 'not_started'
        AND NEW.status = 'open' THEN
    PERFORM set_config('hsdg.task_event_reason', 'filing_reopened', true);
    UPDATE hsdg.tasks t SET status = 'todo', version = t.version + 1
     WHERE t.source_compliance_instance_id = NEW.id AND t.auto_created AND t.status = 'cancelled'
       AND (SELECT ev.reason FROM hsdg.task_events ev
             WHERE ev.task_id = t.id ORDER BY ev.created_at DESC LIMIT 1) = 'filing_not_applicable';
    PERFORM hsdg.make_filing_tasks(ARRAY[NEW.id]);
  END IF;
  PERFORM set_config('hsdg.task_event_reason', coalesce(was_reason, ''), true);
  RETURN NULL;
END $$;

CREATE TRIGGER compliance_instances_filing_tasks
  AFTER UPDATE OF workflow_status, internal_sla_date, internal_sla_override
  ON hsdg.compliance_instances
  FOR EACH ROW WHEN (OLD.workflow_status IS DISTINCT FROM NEW.workflow_status
                     OR OLD.internal_sla_date IS DISTINCT FROM NEW.internal_sla_date
                     OR OLD.internal_sla_override IS DISTINCT FROM NEW.internal_sla_override)
  EXECUTE FUNCTION hsdg.filing_tasks_follow_filing();

-- Backfill. A to-do task leaves its filing's derived status as it was, so the
-- filing refresh is held off while the tasks go in.
ALTER TABLE hsdg.tasks DISABLE TRIGGER tasks_refresh_filing;
ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;

SELECT hsdg.make_filing_tasks(array_agg(ci.id))
  FROM hsdg.compliance_instances ci
  JOIN hsdg.engagements e ON e.id = ci.engagement_id
 WHERE ci.status = 'open'
   AND ci.workflow_status NOT IN ('filed', 'not_applicable')
   AND e.status NOT IN ('completed', 'closed', 'declined', 'withdrawn', 'cancelled', 'merged');

ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_services FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rule_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.compliance_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_events FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks ENABLE TRIGGER tasks_refresh_filing;

-- Down Migration

DROP TRIGGER compliance_instances_filing_tasks ON hsdg.compliance_instances;
DROP FUNCTION hsdg.filing_tasks_follow_filing();
DROP FUNCTION hsdg.make_filing_tasks(uuid[]);
DROP FUNCTION hsdg.filing_period_label(text, date);

-- The calendar's tasks nobody touched go; any worked on stay as ordinary tasks.
ALTER TABLE hsdg.tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_time_entries NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.tasks t
 WHERE t.auto_created AND t.status IN ('todo', 'cancelled') AND t.assigned_by_employee_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_time_entries te WHERE te.task_id = t.id);
ALTER TABLE hsdg.engagement_time_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.tasks DROP COLUMN auto_created;
