-- ─────────────────────────────────────────────────────────────────────────
-- 0009 · Security role separation — business firm-wide vs administrative firm-wide
--        (+ SECURITY DEFINER helper execute-privilege hardening)
--
-- Phase 0–5 checkpoint finding. ctx_is_firmwide() treated
-- system / managing_partner / admin identically, so a TECHNICAL/PLATFORM admin
-- had automatic firm-wide read+write over ALL professional/client/engagement
-- data. The firm requires a clean separation of authority:
--
--   MANAGING_PARTNER  = business firm-wide authority (all client/engagement work)
--   ADMIN (platform)  = technical administration ONLY (users, offices, HR,
--                       service-catalogue config, audit READ) — never client work
--
-- Approach (no architecture change — still RLS-in-the-database, assignment-based):
--   1. Add ctx_is_business_firmwide() (managing_partner only) and repoint ONLY
--      the professional-data policies (entities + children, engagements + the
--      is_engagement_lead helper chain) to it.
--   2. Administrative/identity/config/audit policies keep ctx_is_firmwide()
--      (still system/MP/admin) — admin's legitimate surface is unchanged.
--   3. Strip entity.*/engagement.* permissions from the admin role, so the
--      endpoints are blocked at the API layer too (defence in depth).
--   4. Harden the SECURITY DEFINER helpers: REVOKE EXECUTE FROM PUBLIC, GRANT to
--      the app role explicitly (they were reachable only because PUBLIC lacks
--      USAGE on schema hsdg; this closes the latent grant regardless).
--
-- 'system' (the auth-bootstrap context) is deliberately NOT business-firm-wide:
-- it only ever reads identity tables, never client/engagement data.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. New predicate: business (professional-data) firm-wide authority ─────
CREATE OR REPLACE FUNCTION hsdg.ctx_is_business_firmwide() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_role() = 'managing_partner'
$$;

COMMENT ON FUNCTION hsdg.ctx_is_firmwide() IS
  'Administrative firm-wide authority (system/managing_partner/admin): identity, HR, offices, service-catalogue config, audit read. For client/engagement data use ctx_is_business_firmwide().';
COMMENT ON FUNCTION hsdg.ctx_is_business_firmwide() IS
  'Business firm-wide authority (managing_partner only): all client and engagement data. Platform admin is intentionally excluded.';

-- ── 2a. Repoint professional-data policies: engagements + lead helper ──────
-- is_engagement_lead is the root of the helper chain (is_engagement_member →
-- can_access_entity_via_engagement / shares_engagement_with), so repointing its
-- firm-wide check flows through the whole chain: platform admin loses
-- engagement-derived visibility of clients and co-workers too.
CREATE OR REPLACE FUNCTION hsdg.is_engagement_lead(eng_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagements e
          WHERE e.id = eng_id
            AND (e.engagement_partner_id = hsdg.ctx_employee_id()
                 OR e.engagement_manager_id = hsdg.ctx_employee_id())
        ))
$$;

DROP POLICY engagements_select ON hsdg.engagements;
CREATE POLICY engagements_select ON hsdg.engagements FOR SELECT USING (
  hsdg.ctx_is_business_firmwide()
  OR (hsdg.ctx_employee_id() IS NOT NULL AND (
        engagement_partner_id = hsdg.ctx_employee_id()
        OR engagement_manager_id = hsdg.ctx_employee_id()))
  OR EXISTS (SELECT 1 FROM hsdg.engagement_team t
             WHERE t.engagement_id = engagements.id AND t.employee_id = hsdg.ctx_employee_id())
);
DROP POLICY engagements_insert ON hsdg.engagements;
CREATE POLICY engagements_insert ON hsdg.engagements FOR INSERT WITH CHECK (
  hsdg.ctx_is_business_firmwide()
  OR (hsdg.ctx_employee_id() IS NOT NULL AND (
        engagement_partner_id = hsdg.ctx_employee_id()
        OR engagement_manager_id = hsdg.ctx_employee_id()))
);
DROP POLICY engagements_update ON hsdg.engagements;
CREATE POLICY engagements_update ON hsdg.engagements FOR UPDATE
  USING (hsdg.is_engagement_lead(id))
  WITH CHECK (
    hsdg.ctx_is_business_firmwide()
    OR (hsdg.ctx_employee_id() IS NOT NULL AND (
          engagement_partner_id = hsdg.ctx_employee_id()
          OR engagement_manager_id = hsdg.ctx_employee_id()))
  );
DROP POLICY engagements_delete ON hsdg.engagements;
CREATE POLICY engagements_delete ON hsdg.engagements FOR DELETE USING (
  hsdg.ctx_is_business_firmwide()
);

-- ── 2b. Repoint professional-data policies: entities + children ────────────
DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_business_firmwide()
  OR home_office_id = hsdg.ctx_office_id()
  OR hsdg.can_access_entity_via_engagement(id)
);
DROP POLICY entities_insert ON hsdg.entities;
CREATE POLICY entities_insert ON hsdg.entities FOR INSERT WITH CHECK (
  hsdg.ctx_is_business_firmwide()
  OR home_office_id = hsdg.ctx_office_id()
);
DROP POLICY entities_update ON hsdg.entities;
CREATE POLICY entities_update ON hsdg.entities FOR UPDATE USING (
  hsdg.ctx_is_business_firmwide()
  OR home_office_id = hsdg.ctx_office_id()
) WITH CHECK (
  hsdg.ctx_is_business_firmwide()
  OR home_office_id = hsdg.ctx_office_id()
);
DROP POLICY entities_delete ON hsdg.entities;
CREATE POLICY entities_delete ON hsdg.entities FOR DELETE USING (
  hsdg.ctx_is_business_firmwide()
);

DROP POLICY entity_registrations_all ON hsdg.entity_registrations;
CREATE POLICY entity_registrations_all ON hsdg.entity_registrations FOR ALL USING (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_registrations.entity_id
          AND (hsdg.ctx_is_business_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
) WITH CHECK (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_registrations.entity_id
          AND (hsdg.ctx_is_business_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
);
DROP POLICY entity_contacts_all ON hsdg.entity_contacts;
CREATE POLICY entity_contacts_all ON hsdg.entity_contacts FOR ALL USING (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_contacts.entity_id
          AND (hsdg.ctx_is_business_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
) WITH CHECK (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_contacts.entity_id
          AND (hsdg.ctx_is_business_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
);

-- ── 3. Strip business permissions from the platform admin role ─────────────
-- Reference tables run FORCE RLS; drop FORCE to read/delete as the context-less
-- migrator, then restore (standard reference-data migration pattern).
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.role_permissions rp
USING hsdg.roles r, hsdg.permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id
  AND r.slug = 'admin'
  AND p.slug IN ('entity.read', 'entity.manage', 'engagement.read', 'engagement.manage');

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── 4. Harden SECURITY DEFINER helpers: no PUBLIC execute ──────────────────
-- These run as the owner (bypassing RLS inside) to break policy recursion.
-- Remove the latent PUBLIC execute grant and grant the app role explicitly.
REVOKE EXECUTE ON FUNCTION hsdg.is_engagement_lead(uuid)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION hsdg.is_engagement_member(uuid)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION hsdg.can_access_entity_via_engagement(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION hsdg.shares_engagement_with(uuid)          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.is_engagement_lead(uuid)               TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.is_engagement_member(uuid)            TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.can_access_entity_via_engagement(uuid) TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.shares_engagement_with(uuid)          TO hsdg_app;

-- Down Migration

-- ── Reverse 4: restore PUBLIC execute on the helpers ───────────────────────
GRANT EXECUTE ON FUNCTION hsdg.is_engagement_lead(uuid)               TO PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.is_engagement_member(uuid)            TO PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.can_access_entity_via_engagement(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.shares_engagement_with(uuid)          TO PUBLIC;

-- ── Reverse 3: restore admin's business permissions ────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p
  ON p.slug IN ('entity.read', 'entity.manage', 'engagement.read', 'engagement.manage')
WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── Reverse 2b: restore entity policies to ctx_is_firmwide() ───────────────
DROP POLICY entity_contacts_all ON hsdg.entity_contacts;
CREATE POLICY entity_contacts_all ON hsdg.entity_contacts FOR ALL USING (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_contacts.entity_id
          AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
) WITH CHECK (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_contacts.entity_id
          AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
);
DROP POLICY entity_registrations_all ON hsdg.entity_registrations;
CREATE POLICY entity_registrations_all ON hsdg.entity_registrations FOR ALL USING (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_registrations.entity_id
          AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
) WITH CHECK (
  EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_registrations.entity_id
          AND (hsdg.ctx_is_firmwide() OR e.home_office_id = hsdg.ctx_office_id()))
);
DROP POLICY entities_delete ON hsdg.entities;
CREATE POLICY entities_delete ON hsdg.entities FOR DELETE USING (hsdg.ctx_is_firmwide());
DROP POLICY entities_update ON hsdg.entities;
CREATE POLICY entities_update ON hsdg.entities FOR UPDATE USING (
  hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id()
) WITH CHECK (
  hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id()
);
DROP POLICY entities_insert ON hsdg.entities;
CREATE POLICY entities_insert ON hsdg.entities FOR INSERT WITH CHECK (
  hsdg.ctx_is_firmwide() OR home_office_id = hsdg.ctx_office_id()
);
DROP POLICY entities_select ON hsdg.entities;
CREATE POLICY entities_select ON hsdg.entities FOR SELECT USING (
  hsdg.ctx_is_firmwide()
  OR home_office_id = hsdg.ctx_office_id()
  OR hsdg.can_access_entity_via_engagement(id)
);

-- ── Reverse 2a: restore engagement policies + lead helper ──────────────────
DROP POLICY engagements_delete ON hsdg.engagements;
CREATE POLICY engagements_delete ON hsdg.engagements FOR DELETE USING (hsdg.ctx_is_firmwide());
DROP POLICY engagements_update ON hsdg.engagements;
CREATE POLICY engagements_update ON hsdg.engagements FOR UPDATE
  USING (hsdg.is_engagement_lead(id))
  WITH CHECK (
    hsdg.ctx_is_firmwide()
    OR (hsdg.ctx_employee_id() IS NOT NULL AND (
          engagement_partner_id = hsdg.ctx_employee_id()
          OR engagement_manager_id = hsdg.ctx_employee_id()))
  );
DROP POLICY engagements_insert ON hsdg.engagements;
CREATE POLICY engagements_insert ON hsdg.engagements FOR INSERT WITH CHECK (
  hsdg.ctx_is_firmwide()
  OR (hsdg.ctx_employee_id() IS NOT NULL AND (
        engagement_partner_id = hsdg.ctx_employee_id()
        OR engagement_manager_id = hsdg.ctx_employee_id()))
);
DROP POLICY engagements_select ON hsdg.engagements;
CREATE POLICY engagements_select ON hsdg.engagements FOR SELECT USING (
  hsdg.ctx_is_firmwide()
  OR (hsdg.ctx_employee_id() IS NOT NULL AND (
        engagement_partner_id = hsdg.ctx_employee_id()
        OR engagement_manager_id = hsdg.ctx_employee_id()))
  OR EXISTS (SELECT 1 FROM hsdg.engagement_team t
             WHERE t.engagement_id = engagements.id AND t.employee_id = hsdg.ctx_employee_id())
);

CREATE OR REPLACE FUNCTION hsdg.is_engagement_lead(eng_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagements e
          WHERE e.id = eng_id
            AND (e.engagement_partner_id = hsdg.ctx_employee_id()
                 OR e.engagement_manager_id = hsdg.ctx_employee_id())
        ))
$$;

-- ── Reverse 1 ──────────────────────────────────────────────────────────────
COMMENT ON FUNCTION hsdg.ctx_is_firmwide() IS NULL;
DROP FUNCTION IF EXISTS hsdg.ctx_is_business_firmwide();
