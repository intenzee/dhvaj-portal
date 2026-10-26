-- ─────────────────────────────────────────────────────────────────────────
-- CM-8 · Client teams
--
-- A client team is a named group: one overseeing partner and any number of
-- associates. A client has at most one team (D5); a team serves many clients.
-- The team pre-fills each new engagement for its clients. Always "client
-- team" in the UI, so it is not taken for the per-engagement team.
--
-- Access (D6): being on a client's team lets someone see that client, even an
-- article kept to their own engagements — one more leg of entities_select.
-- The helper takes the team id (not the entity id) so the policy never reads
-- hsdg.entities from inside itself.
--
-- Every signed-in staff member reads teams and members; writes go through
-- the API's team.manage check (D9: managing partner, partners and admin).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        citext NOT NULL CHECK (length(btrim(name::text)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  office_id   uuid REFERENCES hsdg.offices (id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_by  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX teams_name_live_key ON hsdg.teams (name) WHERE archived_at IS NULL;

CREATE TABLE hsdg.team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES hsdg.teams (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  -- A CHECK list, so more roles (a manager, say) can be added later.
  team_role   text NOT NULL CHECK (team_role IN ('overseeing_partner', 'associate')),
  added_by    uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_members_unique UNIQUE (team_id, employee_id)
);
CREATE UNIQUE INDEX team_members_one_overseer ON hsdg.team_members (team_id)
  WHERE team_role = 'overseeing_partner';
CREATE INDEX team_members_employee_idx ON hsdg.team_members (employee_id);

ALTER TABLE hsdg.entities
  ADD COLUMN team_id uuid REFERENCES hsdg.teams (id) ON DELETE SET NULL;
CREATE INDEX entities_team_idx ON hsdg.entities (team_id) WHERE team_id IS NOT NULL;

REVOKE ALL ON hsdg.teams, hsdg.team_members FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.teams, hsdg.team_members TO hsdg_app;

ALTER TABLE hsdg.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.teams FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.team_members FORCE ROW LEVEL SECURITY;

-- The owner reads them inside the definer helpers below.
CREATE POLICY teams_owner_select ON hsdg.teams FOR SELECT TO hsdg_migrator USING (true);
CREATE POLICY team_members_owner_select ON hsdg.team_members
  FOR SELECT TO hsdg_migrator USING (true);
-- Any signed-in staff member; the API checks team.manage before a write.
CREATE POLICY teams_staff ON hsdg.teams FOR ALL TO hsdg_app
  USING (hsdg.ctx_role() IS NOT NULL) WITH CHECK (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY team_members_staff ON hsdg.team_members FOR ALL TO hsdg_app
  USING (hsdg.ctx_role() IS NOT NULL) WITH CHECK (hsdg.ctx_role() IS NOT NULL);

-- Is the caller on this (live) client team?
CREATE FUNCTION hsdg.is_on_client_team(p_team_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT p_team_id IS NOT NULL AND hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM hsdg.team_members m
      JOIN hsdg.teams t ON t.id = m.team_id
     WHERE m.team_id = p_team_id
       AND m.employee_id = hsdg.ctx_employee_id()
       AND t.archived_at IS NULL)
$$;
REVOKE ALL ON FUNCTION hsdg.is_on_client_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.is_on_client_team(uuid) TO hsdg_app;

DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_business_firmwide()
  OR (home_office_id = hsdg.ctx_office_id() AND hsdg.ctx_sees_office_clients())
  OR hsdg.can_access_entity_via_engagement(id)
  OR hsdg.is_on_client_team(team_id)
);

-- The people a team can hold, firm-wide but narrow (like
-- engagement_lead_candidates): id, name, grade and office, and whether they
-- are still with the firm — so a team page names a member from another office
-- and warns about a leaver. No login, pay or reporting line.
CREATE FUNCTION hsdg.team_people()
RETURNS TABLE (
  id uuid,
  full_name text,
  grade_slug text,
  grade_name text,
  is_partner_grade boolean,
  office_code text,
  is_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT e.id, e.full_name, g.slug, g.name, g.is_partner_grade, o.code,
         e.employment_status <> 'exited'
           AND NOT EXISTS (SELECT 1 FROM hsdg.users u WHERE u.id = e.user_id AND NOT u.is_active)
    FROM hsdg.employees e
    JOIN hsdg.grades g ON g.id = e.grade_id
    JOIN hsdg.offices o ON o.id = e.primary_office_id
   WHERE hsdg.ctx_role() IS NOT NULL
   ORDER BY g.rank DESC, e.full_name
$$;
REVOKE ALL ON FUNCTION hsdg.team_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.team_people() TO hsdg_app;

-- A client's team as Client 360 and the clients list show it: id, name and
-- the overseeing partner's name (who may sit in another office).
CREATE FUNCTION hsdg.client_team_ref(p_team_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT jsonb_build_object(
           'id', t.id, 'name', t.name::text,
           'overseeingPartner', (
             SELECT jsonb_build_object('id', e.id, 'fullName', e.full_name)
               FROM hsdg.team_members m JOIN hsdg.employees e ON e.id = m.employee_id
              WHERE m.team_id = t.id AND m.team_role = 'overseeing_partner'))
    FROM hsdg.teams t
   WHERE t.id = p_team_id AND hsdg.ctx_role() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION hsdg.client_team_ref(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.client_team_ref(uuid) TO hsdg_app;

-- ── Permissions (D9) ─────────────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('team.manage', 'Create and change client teams, and assign them to clients'),
  ('team.read', 'See client teams, their people and their clients')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'team.manage'
 WHERE r.slug IN ('managing_partner', 'partner', 'admin')
ON CONFLICT DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'team.read'
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions rp USING hsdg.permissions p
 WHERE rp.permission_id = p.id AND p.slug IN ('team.manage', 'team.read');
DELETE FROM hsdg.permissions WHERE slug IN ('team.manage', 'team.read');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS hsdg.client_team_ref(uuid);
DROP FUNCTION IF EXISTS hsdg.team_people();

DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_business_firmwide()
  OR (home_office_id = hsdg.ctx_office_id() AND hsdg.ctx_sees_office_clients())
  OR hsdg.can_access_entity_via_engagement(id)
);
DROP FUNCTION IF EXISTS hsdg.is_on_client_team(uuid);

DROP INDEX IF EXISTS hsdg.entities_team_idx;
ALTER TABLE hsdg.entities DROP COLUMN IF EXISTS team_id;
DROP TABLE IF EXISTS hsdg.team_members;
DROP TABLE IF EXISTS hsdg.teams;
