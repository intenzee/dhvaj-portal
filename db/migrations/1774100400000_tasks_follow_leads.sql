-- ─────────────────────────────────────────────────────────────────────────
-- Open tasks follow the engagement's leads
--
-- WHY: a filing task is given at creation to its stream's lead, else the
-- engagement's Manager, else its Partner (hsdg.make_filing_tasks). Changing
-- any of those later left every open task with the old person, so the
-- outgoing lead kept showing as "Held by" in Assign work and Progress for
-- engagements they no longer had. Now, when a stream lead, the Manager or
-- the Partner changes, or someone leaves the team:
--   • an auto-created task no one has handed on follows the chain again
--     (stream lead → Manager → Partner, current employees only);
--   • a task a person gave someone stays with them while they still have a
--     part on the engagement (lead, Manager, Partner, team); once they have
--     none, it goes to the task's lead the same way.
-- A reviewer who has no part left is replaced by the Manager (else Partner),
-- never by the task's own holder. Done / cancelled tasks never move.
-- Existing tasks are repaired the same way.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- The owner reads and moves what this needs, for this purpose only.
CREATE POLICY tasks_follow_leads ON hsdg.tasks FOR ALL TO hsdg_migrator
  USING (current_setting('hsdg.leads_moving', true) = 'on')
  WITH CHECK (current_setting('hsdg.leads_moving', true) = 'on');
CREATE POLICY engagements_follow_leads ON hsdg.engagements FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.leads_moving', true) = 'on');
CREATE POLICY engagement_team_follow_leads ON hsdg.engagement_team FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.leads_moving', true) = 'on');
CREATE POLICY employees_follow_leads ON hsdg.employees FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.leads_moving', true) = 'on');

/**
 * Moves the engagement's open tasks held by any of p_outgoing (optionally only
 * those on one service line) to whoever should hold them now. Returns how many
 * moved.
 */
CREATE FUNCTION hsdg.tasks_follow_leads(p_engagement_id uuid, p_outgoing uuid[],
                                        p_service_id uuid DEFAULT NULL,
                                        p_auto_only boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  was text := current_setting('hsdg.leads_moving', true);
  moved integer := 0;
BEGIN
  p_outgoing := array_remove(p_outgoing, NULL);
  IF coalesce(cardinality(p_outgoing), 0) = 0 THEN RETURN 0; END IF;
  PERFORM set_config('hsdg.leads_moving', 'on', true);

  WITH live AS (
    SELECT id FROM hsdg.employees
     WHERE employment_status <> 'exited' AND deleted_at IS NULL
  ),
  part AS (
    -- Everyone with a part on the engagement now.
    SELECT e.engagement_partner_id AS id FROM hsdg.engagements e WHERE e.id = p_engagement_id
    UNION SELECT e.engagement_manager_id FROM hsdg.engagements e WHERE e.id = p_engagement_id
    UNION SELECT es.lead_employee_id FROM hsdg.engagement_services es
           WHERE es.engagement_id = p_engagement_id AND es.status <> 'cancelled'
    UNION SELECT et.employee_id FROM hsdg.engagement_team et
           WHERE et.engagement_id = p_engagement_id
  ),
  cand AS (
    SELECT t.id, t.assigned_to_employee_id AS old_owner, owner.id AS new_owner,
           t.reviewer_employee_id AS old_reviewer,
           CASE
             WHEN t.reviewer_employee_id IS NULL THEN NULL
             WHEN t.reviewer_employee_id IN (SELECT id FROM part WHERE id IS NOT NULL)
                  AND t.reviewer_employee_id <> owner.id THEN t.reviewer_employee_id
             ELSE (SELECT o.id
                     FROM (VALUES (1, e.engagement_manager_id), (2, e.engagement_partner_id))
                          AS o(rank, id)
                    WHERE o.id IN (SELECT id FROM live) AND o.id <> owner.id
                    ORDER BY o.rank LIMIT 1)
           END AS new_reviewer
      FROM hsdg.tasks t
      JOIN hsdg.engagements e ON e.id = t.engagement_id
      LEFT JOIN hsdg.engagement_services es ON es.id = t.engagement_service_id
      LEFT JOIN LATERAL (
        SELECT o.id
          FROM (VALUES (1, es.lead_employee_id), (2, e.engagement_manager_id),
                       (3, e.engagement_partner_id)) AS o(rank, id)
         WHERE o.id IN (SELECT id FROM live)
         ORDER BY o.rank
         LIMIT 1
      ) owner ON true
     WHERE t.engagement_id = p_engagement_id
       AND t.status NOT IN ('done', 'cancelled')
       AND t.assigned_to_employee_id = ANY (p_outgoing)
       AND (p_service_id IS NULL OR t.engagement_service_id = p_service_id)
       AND owner.id IS NOT NULL
       AND owner.id <> t.assigned_to_employee_id
       AND (
         -- Never handed on by a person: it follows the chain.
         (t.auto_created AND t.assigned_by_employee_id IS NULL)
         -- Given by someone: only once the holder has no part left.
         OR (NOT p_auto_only
             AND t.assigned_to_employee_id NOT IN (SELECT id FROM part WHERE id IS NOT NULL))
       )
  ),
  done AS (
    UPDATE hsdg.tasks t
       SET assigned_to_employee_id = c.new_owner,
           reviewer_employee_id = c.new_reviewer,
           version = t.version + 1
      FROM cand c
     WHERE t.id = c.id
    RETURNING c.*
  ),
  history AS (
    -- How it moved, as a handover records it.
    INSERT INTO hsdg.task_assignments (task_id, kind, from_employee_id, to_employee_id,
                                       by_employee_id, reason)
    SELECT d.id, 'assignee', d.old_owner, d.new_owner, hsdg.ctx_employee_id(),
           'The engagement’s lead changed'
      FROM done d
    UNION ALL
    SELECT d.id, 'reviewer', d.old_reviewer, d.new_reviewer, hsdg.ctx_employee_id(),
           'The engagement’s lead changed'
      FROM done d WHERE d.new_reviewer IS DISTINCT FROM d.old_reviewer
    RETURNING 1
  )
  SELECT count(*) INTO moved FROM done;

  PERFORM set_config('hsdg.leads_moving', coalesce(was, ''), true);
  RETURN moved;
END $$;
REVOKE ALL ON FUNCTION hsdg.tasks_follow_leads(uuid, uuid[], uuid, boolean) FROM PUBLIC;

CREATE FUNCTION hsdg.tasks_follow_leads_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'engagements' THEN
    PERFORM hsdg.tasks_follow_leads(
      NEW.id,
      ARRAY[CASE WHEN NEW.engagement_manager_id IS DISTINCT FROM OLD.engagement_manager_id
                 THEN OLD.engagement_manager_id END,
            CASE WHEN NEW.engagement_partner_id IS DISTINCT FROM OLD.engagement_partner_id
                 THEN OLD.engagement_partner_id END]);
  ELSIF TG_TABLE_NAME = 'engagement_services' THEN
    -- The line's tasks held by its old lead, or by the Manager / Partner they
    -- fell back to while it had none.
    PERFORM hsdg.tasks_follow_leads(
      NEW.engagement_id,
      ARRAY[OLD.lead_employee_id,
            (SELECT e.engagement_manager_id FROM hsdg.engagements e WHERE e.id = NEW.engagement_id),
            (SELECT e.engagement_partner_id FROM hsdg.engagements e WHERE e.id = NEW.engagement_id)],
      NEW.id);
  ELSIF TG_TABLE_NAME = 'engagement_team' THEN
    PERFORM hsdg.tasks_follow_leads(OLD.engagement_id, ARRAY[OLD.employee_id]);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER engagements_tasks_follow_leads
  AFTER UPDATE OF engagement_manager_id, engagement_partner_id ON hsdg.engagements
  FOR EACH ROW
  WHEN (NEW.engagement_manager_id IS DISTINCT FROM OLD.engagement_manager_id
        OR NEW.engagement_partner_id IS DISTINCT FROM OLD.engagement_partner_id)
  EXECUTE FUNCTION hsdg.tasks_follow_leads_trigger();
CREATE TRIGGER engagement_services_tasks_follow_leads
  AFTER UPDATE OF lead_employee_id ON hsdg.engagement_services
  FOR EACH ROW WHEN (NEW.lead_employee_id IS DISTINCT FROM OLD.lead_employee_id)
  EXECUTE FUNCTION hsdg.tasks_follow_leads_trigger();
CREATE TRIGGER engagement_team_tasks_follow_leads
  AFTER DELETE ON hsdg.engagement_team
  FOR EACH ROW EXECUTE FUNCTION hsdg.tasks_follow_leads_trigger();

-- Repair: every auto-created open task no one handed on that is still with
-- someone the chain no longer names. Tasks a person gave are left alone.
DO $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('hsdg.leads_moving', 'on', true);
  FOR r IN
    SELECT t.engagement_id, array_agg(DISTINCT t.assigned_to_employee_id) AS holders
      FROM hsdg.tasks t
     WHERE t.status NOT IN ('done', 'cancelled') AND t.assigned_to_employee_id IS NOT NULL
     GROUP BY t.engagement_id
  LOOP
    PERFORM hsdg.tasks_follow_leads(r.engagement_id, r.holders, NULL, true);
  END LOOP;
  PERFORM set_config('hsdg.leads_moving', '', true);
END $$;

-- Down Migration

DROP TRIGGER IF EXISTS engagement_team_tasks_follow_leads ON hsdg.engagement_team;
DROP TRIGGER IF EXISTS engagement_services_tasks_follow_leads ON hsdg.engagement_services;
DROP TRIGGER IF EXISTS engagements_tasks_follow_leads ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.tasks_follow_leads_trigger();
DROP FUNCTION IF EXISTS hsdg.tasks_follow_leads(uuid, uuid[], uuid, boolean);
DROP POLICY IF EXISTS employees_follow_leads ON hsdg.employees;
DROP POLICY IF EXISTS engagement_team_follow_leads ON hsdg.engagement_team;
DROP POLICY IF EXISTS engagements_follow_leads ON hsdg.engagements;
DROP POLICY IF EXISTS tasks_follow_leads ON hsdg.tasks;
