-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- Reporting tree in RLS (C-2) and tasks.started_at (C-5)
--
-- Who sees what follows employees.reports_to_id:
--
--   role      clients/engagements          tasks                         people
--   Admin/MP  all                          all                           all
--   Partner   EP, plus any their tree      own and everyone under them   their tree
--             works on
--   Manager   EM or team, plus any their   own plus their Seniors' and   their tree
--             tree works on                Articles'
--   Senior    team engagements             own plus those they gave      their Articles
--   Article   team engagements             own only                      themselves
--
-- "Their tree works on" = someone in their tree is on the engagement (EP, EM
-- or team: hsdg.engagement_access). Holding a task is covered too, since the
-- API only assigns a task to someone on the engagement.
--
-- * hsdg.subtree_of(emp): emp and everyone who reports to them, at any depth.
--   UNION (not UNION ALL) makes it end on a reports_to loop.
-- * hsdg.ctx_subtree(): the acting person's tree. The API computes it once per
--   request into the transaction setting hsdg.subtree (withRlsContext), so a
--   policy reads a setting, not a recursive query per row. Without the setting
--   (psql, jobs) it is computed. Policies call it as (SELECT hsdg.ctx_subtree())
--   so the planner runs it once per statement.
-- * hsdg.tree_engagement_ids(): the engagements the acting Partner's /
--   Manager's tree is on (engagements_select_tree), and the same test inline
--   in is_engagement_member so the engagement's contents follow.
-- * Tasks, strict firms (task_assignee_only on): an Article no longer sees the
--   whole engagement's tasks, only theirs; easy mode keeps the member view.
--   The tree reach is added in both modes.
-- * Tasks UPDATE for Partner / Manager / Senior when the assignee is in their
--   tree (Move a task: Manager their reports, Senior their Articles). A Senior
--   only sees the tasks they gave, so that is what they can move.
-- * tasks.started_at: set on the first Start (C-5, My Work).
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION hsdg.subtree_of(p_employee uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  WITH RECURSIVE tree(id) AS (
    SELECT p_employee WHERE p_employee IS NOT NULL
    UNION
    SELECT e.id FROM hsdg.employees e JOIN tree ON e.reports_to_id = tree.id
  )
  SELECT COALESCE(array_agg(id), '{}') FROM tree
$$;

CREATE FUNCTION hsdg.ctx_subtree()
RETURNS uuid[]
LANGUAGE sql STABLE
AS $$
  SELECT CASE
           WHEN NULLIF(current_setting('hsdg.subtree', true), '') IS NOT NULL
             THEN current_setting('hsdg.subtree', true)::uuid[]
           ELSE hsdg.subtree_of(hsdg.ctx_employee_id())
         END
$$;

-- Is emp in the acting person's tree? For a test made once per row inside an
-- owner-run helper (is_engagement_member), where (SELECT ctx_subtree()) would
-- be re-parsed on every call: a uuid's text sits in the setting's text or it
-- does not (a 36-character uuid cannot span a comma). Inlined, never parsed.
CREATE FUNCTION hsdg.ctx_in_subtree(p_employee uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT strpos(COALESCE(NULLIF(current_setting('hsdg.subtree', true), ''),
                         hsdg.subtree_of(hsdg.ctx_employee_id())::text),
                p_employee::text) > 0
$$;

-- The engagements someone in a Partner's / Manager's tree is on; empty for
-- everyone else. Policies use it as `id IN (SELECT hsdg.tree_engagement_ids())`
-- — one hashed list per query, not a call per row.
CREATE FUNCTION hsdg.tree_engagement_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  SELECT DISTINCT a.engagement_id FROM hsdg.engagement_access a
   WHERE hsdg.ctx_role() IN ('partner', 'manager')
     AND a.source <> 'creator'
     AND a.employee_id = ANY (hsdg.ctx_subtree())
$$;

REVOKE ALL ON FUNCTION hsdg.subtree_of(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hsdg.tree_engagement_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.subtree_of(uuid) TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.ctx_subtree() TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.ctx_in_subtree(uuid) TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.tree_engagement_ids() TO hsdg_app;

-- ── Engagements: the tree's engagements ─────────────────────────────────
-- is_engagement_member gates the engagement's contents (tasks in easy mode,
-- documents, filings…), so a Partner / Manager who sees the engagement sees
-- what is in it.
CREATE OR REPLACE FUNCTION hsdg.is_engagement_member(eng_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_access a
          WHERE a.engagement_id = eng_id
            AND a.employee_id = hsdg.ctx_employee_id()
            AND (a.source <> 'creator' OR a.xact_id = pg_current_xact_id_if_assigned())
        ))
     OR hsdg.ctx_office_member_of(eng_id)
     OR (hsdg.ctx_role() IN ('partner', 'manager') AND EXISTS (
          SELECT 1 FROM hsdg.engagement_access a
          WHERE a.engagement_id = eng_id
            AND a.source <> 'creator'
            AND hsdg.ctx_in_subtree(a.employee_id)
        ))
$$;

-- TO hsdg_app: the reach is what the app shows. The owner-run helpers that
-- read engagements once per row (shares_engagement_with…) keep their old,
-- cheaper view.
CREATE POLICY engagements_select_tree ON hsdg.engagements FOR SELECT TO hsdg_app
  USING (hsdg.ctx_role() IN ('partner', 'manager')
         AND id IN (SELECT hsdg.tree_engagement_ids()));

-- ── People: your tree ───────────────────────────────────────────────────
CREATE POLICY employees_select_tree ON hsdg.employees FOR SELECT
  USING (id = ANY ((SELECT hsdg.ctx_subtree())::uuid[]));

-- ── Tasks: yours, the ones you gave, your tree's ────────────────────────
DROP POLICY tasks_select ON hsdg.tasks;
CREATE POLICY tasks_select ON hsdg.tasks FOR SELECT
  USING (
    hsdg.is_engagement_lead(engagement_id)
    OR (NOT hsdg.firm_check('task_assignee_only') AND hsdg.is_engagement_member(engagement_id))
    OR assigned_to_employee_id = hsdg.ctx_employee_id()
    OR reviewer_employee_id = hsdg.ctx_employee_id()
    OR assigned_by_employee_id = hsdg.ctx_employee_id()
    OR (hsdg.ctx_role() IN ('partner', 'manager')
        AND (assigned_to_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[])
             OR reviewer_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[])))
    -- A stream lead sees what they may assign (tasks_update_stream_lead).
    OR (source_compliance_instance_id IS NOT NULL
        AND hsdg.can_assign_as_stream_lead(source_compliance_instance_id))
    -- A lodged filing's task, so whoever lodges can close it (tasks_update_lodged).
    OR (source_compliance_instance_id IS NOT NULL
        AND hsdg.is_engagement_member(engagement_id)
        AND EXISTS (SELECT 1 FROM hsdg.filing_records fr
                     WHERE fr.compliance_instance_id = source_compliance_instance_id
                       AND fr.undone_at IS NULL))
  );

CREATE POLICY tasks_update_tree ON hsdg.tasks FOR UPDATE
  USING (hsdg.ctx_role() IN ('partner', 'manager', 'senior')
         AND assigned_to_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[]))
  WITH CHECK (hsdg.ctx_role() IN ('partner', 'manager', 'senior')
              AND assigned_to_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[]));

-- ── My Work: when the doing started ─────────────────────────────────────
ALTER TABLE hsdg.tasks ADD COLUMN started_at timestamptz;
COMMENT ON COLUMN hsdg.tasks.started_at IS 'When the task was first started (Start on My Work).';

-- Down Migration

ALTER TABLE hsdg.tasks DROP COLUMN IF EXISTS started_at;

DROP POLICY IF EXISTS tasks_update_tree ON hsdg.tasks;
DROP POLICY IF EXISTS tasks_select ON hsdg.tasks;
CREATE POLICY tasks_select ON hsdg.tasks FOR SELECT
  USING (hsdg.is_engagement_member(engagement_id));

DROP POLICY IF EXISTS employees_select_tree ON hsdg.employees;
DROP POLICY IF EXISTS engagements_select_tree ON hsdg.engagements;

CREATE OR REPLACE FUNCTION hsdg.is_engagement_member(eng_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_access a
          WHERE a.engagement_id = eng_id
            AND a.employee_id = hsdg.ctx_employee_id()
            AND (a.source <> 'creator' OR a.xact_id = pg_current_xact_id_if_assigned())
        ))
     OR hsdg.ctx_office_member_of(eng_id)
$$;

DROP FUNCTION IF EXISTS hsdg.tree_engagement_ids();
DROP FUNCTION IF EXISTS hsdg.ctx_in_subtree(uuid);
DROP FUNCTION IF EXISTS hsdg.ctx_subtree();
DROP FUNCTION IF EXISTS hsdg.subtree_of(uuid);
