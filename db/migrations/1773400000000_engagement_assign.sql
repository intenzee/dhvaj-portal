-- ─────────────────────────────────────────────────────────────────────────
-- Who changes an engagement's people
--
-- engagement.assign: change the Engagement Partner, the manager and the team,
-- at any stage. The Managing Partner and the administrator hold it; everyone
-- else sees the people and cannot change them. The API routes check it, and
-- the leads' RLS stays as it is because creating an engagement and giving a
-- task to a colleague still write the team.
--
-- The administrator had no engagement access, so this also gives them
-- engagement.read and enough RLS to use the permission: every engagement, its
-- client's row and its team. Not its work: tasks, filings, documents and time
-- stay behind is_engagement_member. They write only under
-- hsdg.changing_people, which the API sets for these changes alone, so an
-- administrator who is also a manager gains no lifecycle power over other
-- people's engagements.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.roles NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description)
VALUES ('engagement.assign', 'Change an engagement''s partner, manager and team');

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'engagement.assign'
 WHERE r.slug IN ('managing_partner', 'admin');

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p ON p.slug = 'engagement.read'
 WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions FORCE ROW LEVEL SECURITY;

CREATE FUNCTION hsdg.ctx_changing_people() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_has_role('admin')
     AND current_setting('hsdg.changing_people', true) = 'on'
$$;

-- Each check sits in a sub-select so it runs once a query. As a bare call it
-- runs per row and costs every user's read of these tables, not just the
-- administrator's: 2 ms became 118 ms over 470 engagements.
CREATE POLICY engagements_select_admin ON hsdg.engagements FOR SELECT
  USING ((SELECT hsdg.ctx_has_role('admin')));
CREATE POLICY engagements_update_admin ON hsdg.engagements FOR UPDATE
  USING ((SELECT hsdg.ctx_changing_people())) WITH CHECK ((SELECT hsdg.ctx_changing_people()));

CREATE POLICY entities_select_admin ON hsdg.entities FOR SELECT
  USING ((SELECT hsdg.ctx_has_role('admin')));

CREATE POLICY engagement_team_select_admin ON hsdg.engagement_team FOR SELECT
  USING ((SELECT hsdg.ctx_has_role('admin')));
CREATE POLICY engagement_team_insert_admin ON hsdg.engagement_team FOR INSERT
  WITH CHECK ((SELECT hsdg.ctx_changing_people()));
CREATE POLICY engagement_team_delete_admin ON hsdg.engagement_team FOR DELETE
  USING ((SELECT hsdg.ctx_changing_people()));

-- Down Migration

DROP POLICY IF EXISTS engagement_team_delete_admin ON hsdg.engagement_team;
DROP POLICY IF EXISTS engagement_team_insert_admin ON hsdg.engagement_team;
DROP POLICY IF EXISTS engagement_team_select_admin ON hsdg.engagement_team;
DROP POLICY IF EXISTS entities_select_admin ON hsdg.entities;
DROP POLICY IF EXISTS engagements_update_admin ON hsdg.engagements;
DROP POLICY IF EXISTS engagements_select_admin ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.ctx_changing_people();

ALTER TABLE hsdg.permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.roles NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.role_permissions
 WHERE role_id = (SELECT id FROM hsdg.roles WHERE slug = 'admin')
   AND permission_id = (SELECT id FROM hsdg.permissions WHERE slug = 'engagement.read');
DELETE FROM hsdg.role_permissions
 WHERE permission_id = (SELECT id FROM hsdg.permissions WHERE slug = 'engagement.assign');
DELETE FROM hsdg.permissions WHERE slug = 'engagement.assign';

ALTER TABLE hsdg.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions FORCE ROW LEVEL SECURITY;
