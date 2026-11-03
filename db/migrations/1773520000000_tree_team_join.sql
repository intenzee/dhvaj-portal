-- Up Migration
-- Phase 2, C-6 — Move all open work, down the reporting tree.
--
-- A Partner / Manager / Senior may move the open work of someone below them to
-- someone else in their tree (POST /people/admin/move-work). The receiver
-- joins the team of each engagement the work sits on, so they can see it. Today
-- only the engagement's lead (or, in easy mode, a member) may add to a team;
-- this lets the tree lead add a person from their own tree as a plain member,
-- and only on an engagement where their tree already holds open work.
-- tasks_update_tree (1773500000000) already scopes the task moves themselves.

CREATE POLICY engagement_team_insert_tree ON hsdg.engagement_team
  FOR INSERT TO hsdg_app
  WITH CHECK (
    role_on_engagement = 'member'
    AND hsdg.ctx_role() IN ('partner', 'manager', 'senior')
    AND employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[])
    AND EXISTS (
      SELECT 1 FROM hsdg.tasks t
       WHERE t.engagement_id = engagement_team.engagement_id
         AND t.status NOT IN ('done', 'cancelled')
         AND (t.assigned_to_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[])
              OR t.reviewer_employee_id = ANY ((SELECT hsdg.ctx_subtree())::uuid[]))
    )
  );

-- Down Migration
DROP POLICY IF EXISTS engagement_team_insert_tree ON hsdg.engagement_team;
