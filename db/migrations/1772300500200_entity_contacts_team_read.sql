-- ─────────────────────────────────────────────────────────────────────────
-- Client contacts for the engagement team (PS-002 follow-up).
--
-- entity_contacts were visible only to the client's home office and firm-wide
-- roles, so a member of an engagement team from another office could not see
-- the client's phone or e-mail — and could not chase the client on WhatsApp
-- from a filing they work on. Decision (16 Oct 2026): anyone on a team of one
-- of the client's engagements may READ its contacts. Writing stays with the
-- home office and firm-wide roles (entity_contacts_all is unchanged).
--
-- hsdg.ctx_on_entity_team(entity) is SECURITY DEFINER so the check reads
-- engagement_access without the engagements policies recursing.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE FUNCTION hsdg.ctx_on_entity_team(p_entity_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'hsdg', 'pg_temp'
AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM hsdg.engagements g
      JOIN hsdg.engagement_access a ON a.engagement_id = g.id
     WHERE g.entity_id = p_entity_id
       AND a.employee_id = hsdg.ctx_employee_id()
  )
$$;
REVOKE ALL ON FUNCTION hsdg.ctx_on_entity_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_on_entity_team(uuid) TO hsdg_app;

CREATE POLICY entity_contacts_team_read ON hsdg.entity_contacts
  FOR SELECT TO hsdg_app USING (hsdg.ctx_on_entity_team(entity_id));

-- Down Migration

DROP POLICY IF EXISTS entity_contacts_team_read ON hsdg.entity_contacts;
DROP FUNCTION IF EXISTS hsdg.ctx_on_entity_team(uuid);
