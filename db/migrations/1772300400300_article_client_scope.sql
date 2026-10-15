-- ─────────────────────────────────────────────────────────────────────────
-- Staff Workflow · Questions for the partners — "which clients does an article
-- see?" (firm_settings.article_client_scope).
--
--   'office'      — as before: every client of their office, plus any client
--                   of an engagement they are on.
--   'engagements' — only clients of engagements they are a member of.
--
-- Done in RLS, so every list, read and search of clients follows it: the
-- "same office" leg of entities_select (and of the legacy clients and
-- entity_groups lists) no longer applies to such an article. The
-- entity_* detail tables check their entity through hsdg.entities under the
-- caller's RLS, so they follow without a change. Engagements were already
-- membership-only. Other roles are unaffected.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- Whether the caller sees their office's clients. Invoker rights: firm_settings
-- is readable by every signed-in role, and a migrator-owned definer reading
-- entities reads firm_settings as its owner (ENABLE, not FORCE).
CREATE OR REPLACE FUNCTION hsdg.ctx_sees_office_clients() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_role() IS DISTINCT FROM 'article'
      OR COALESCE((SELECT f.article_client_scope FROM hsdg.firm_settings f LIMIT 1),
                  'office') = 'office'
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_sees_office_clients() TO hsdg_app;

DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_business_firmwide()
  OR (home_office_id = hsdg.ctx_office_id() AND hsdg.ctx_sees_office_clients())
  OR hsdg.can_access_entity_via_engagement(id)
);

-- The legacy client and group lists: an article kept to their engagements sees
-- the ones holding a client they can see.
DROP POLICY clients_select ON hsdg.clients;
CREATE POLICY clients_select ON hsdg.clients FOR SELECT USING (
  hsdg.ctx_is_firmwide()
  OR (home_office_id = hsdg.ctx_office_id() AND hsdg.ctx_sees_office_clients())
  OR (NOT hsdg.ctx_sees_office_clients()
      AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.client_id = clients.id))
);

DROP POLICY entity_groups_select ON hsdg.entity_groups;
CREATE POLICY entity_groups_select ON hsdg.entity_groups FOR SELECT USING (
  hsdg.ctx_is_firmwide()
  OR (home_office_id = hsdg.ctx_office_id() AND hsdg.ctx_sees_office_clients())
  OR (NOT hsdg.ctx_sees_office_clients()
      AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.group_id = entity_groups.id))
);

-- Down Migration

DROP POLICY entity_groups_select ON hsdg.entity_groups;
CREATE POLICY entity_groups_select ON hsdg.entity_groups FOR SELECT USING (
  hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id()
);
DROP POLICY clients_select ON hsdg.clients;
CREATE POLICY clients_select ON hsdg.clients FOR SELECT USING (
  hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id()
);
DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_business_firmwide()
  OR home_office_id = hsdg.ctx_office_id()
  OR hsdg.can_access_entity_via_engagement(id)
);
DROP FUNCTION IF EXISTS hsdg.ctx_sees_office_clients();
