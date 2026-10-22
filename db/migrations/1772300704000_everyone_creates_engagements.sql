-- ─────────────────────────────────────────────────────────────────────────
-- Everyone creates engagements.
--
-- The managing partner (22 Oct 2026): "give permission to everyone to create
-- engagement". Until now only engagement.manage (MP, partner, manager) could
-- create one, and RLS let the row in only when the creator named themselves
-- as the Engagement Partner or Manager — a senior or article who set up a job
-- for a partner was refused.
--
-- engagement.create      — new permission, held by every staff role (managing
--                          partner, partner, manager, senior, article). Not the
--                          platform admin, who holds no engagement permission
--                          at all (role separation). engagement.manage is
--                          unchanged: running an engagement stays with its leads.
-- engagements.created_by_employee_id
--                        — who set the engagement up (defaults to the caller).
--                          engagements_insert_creator admits a row the caller
--                          creates as themselves, whoever the EP / manager are
--                          (alongside engagements_insert, which is unchanged).
--                          The EP check, the grade trigger and the acceptance
--                          rules are untouched.
-- engagement_access 'creator'
--                        — the creating transaction (xact_id). The rest of the
--                          create reads the new row (identity, kind and
--                          independence triggers) and writes under lead-only
--                          policies (primary service and entity lines, streams,
--                          years in scope, the calendar, independence outcomes,
--                          the statutory-audit shell, the creator's team row).
--                          is_engagement_lead / is_engagement_member, and
--                          engagements_select_creating, count the creator as a
--                          lead INSIDE THAT TRANSACTION ONLY (xact id match).
--                          Once it commits the creator is an ordinary team
--                          member: the API adds them to the team so they can
--                          open what they made, and the EP or manager may
--                          remove them like anyone else.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Permission ────────────────────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('engagement.create', 'Create an engagement (it starts with the partner and manager named on it)')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'engagement.create'
 WHERE r.slug IN ('managing_partner', 'partner', 'manager', 'senior', 'article')
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── Who created the engagement ────────────────────────────────────────────
ALTER TABLE hsdg.engagements
  ADD COLUMN created_by_employee_id uuid
    DEFAULT hsdg.ctx_employee_id()
    REFERENCES hsdg.employees (id) ON DELETE SET NULL;

-- Alongside engagements_insert (EP / manager / firm-wide), not instead of it.
CREATE POLICY engagements_insert_creator ON hsdg.engagements FOR INSERT
  WITH CHECK (hsdg.ctx_employee_id() IS NOT NULL
              AND created_by_employee_id = hsdg.ctx_employee_id());

-- ── The creating transaction ──────────────────────────────────────────────
ALTER TABLE hsdg.engagement_access
  DROP CONSTRAINT engagement_access_source_check,
  ADD CONSTRAINT engagement_access_source_check
    CHECK (source IN ('partner','manager','team','creator')),
  ADD COLUMN xact_id xid8,
  ADD CONSTRAINT engagement_access_creator_xact
    CHECK ((source = 'creator') = (xact_id IS NOT NULL));

CREATE FUNCTION hsdg.engagement_access_from_creator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
BEGIN
  IF NEW.created_by_employee_id IS NOT NULL THEN
    INSERT INTO hsdg.engagement_access (engagement_id, employee_id, source, xact_id)
    VALUES (NEW.id, NEW.created_by_employee_id, 'creator', pg_current_xact_id());
  END IF;
  RETURN NULL;
END;
$$;

-- Named to fire right after engagements_access and before the primary
-- service / entity triggers, whose inserts need the creator to be a lead.
CREATE TRIGGER engagements_access_creator
  AFTER INSERT ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_access_from_creator();

-- A 'creator' row counts only in its own transaction.
-- pg_current_xact_id_if_assigned() is NULL until the transaction writes, so a
-- read never matches one.
CREATE OR REPLACE FUNCTION hsdg.is_engagement_lead(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_access a
          WHERE a.engagement_id = eng_id
            AND a.employee_id = hsdg.ctx_employee_id()
            AND (a.source IN ('partner','manager')
                 OR (a.source = 'creator' AND a.xact_id = pg_current_xact_id_if_assigned()))
        ))
$function$;

CREATE OR REPLACE FUNCTION hsdg.is_engagement_member(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_access a
          WHERE a.engagement_id = eng_id
            AND a.employee_id = hsdg.ctx_employee_id()
            AND (a.source <> 'creator' OR a.xact_id = pg_current_xact_id_if_assigned())
        ))
$function$;

-- Team contacts (1772300500200): a creator reads them as a team member.
CREATE OR REPLACE FUNCTION hsdg.ctx_on_entity_team(p_entity_id uuid)
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
       AND a.source <> 'creator'
  )
$$;

-- The create's own reads of the new row (the identity / kind / independence
-- triggers, the statutory-audit shell, the detail it returns), alongside
-- engagements_select. The cheap column test comes first.
CREATE FUNCTION hsdg.ctx_is_creating_engagement(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT pg_current_xact_id_if_assigned() IS NOT NULL
     AND hsdg.ctx_employee_id() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM hsdg.engagement_access a
        WHERE a.engagement_id = eng_id
          AND a.employee_id = hsdg.ctx_employee_id()
          AND a.source = 'creator'
          AND a.xact_id = pg_current_xact_id_if_assigned())
$function$;
REVOKE ALL ON FUNCTION hsdg.ctx_is_creating_engagement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_is_creating_engagement(uuid) TO hsdg_app;

CREATE POLICY engagements_select_creating ON hsdg.engagements FOR SELECT
  USING (created_by_employee_id = hsdg.ctx_employee_id()
         AND hsdg.ctx_is_creating_engagement(id));

-- Down Migration

DROP POLICY IF EXISTS engagements_select_creating ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.ctx_is_creating_engagement(uuid);

CREATE OR REPLACE FUNCTION hsdg.ctx_on_entity_team(p_entity_id uuid)
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

CREATE OR REPLACE FUNCTION hsdg.is_engagement_lead(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_access a
          WHERE a.engagement_id = eng_id
            AND a.employee_id = hsdg.ctx_employee_id()
            AND a.source IN ('partner','manager')
        ))
$function$;

CREATE OR REPLACE FUNCTION hsdg.is_engagement_member(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_access a
          WHERE a.engagement_id = eng_id
            AND a.employee_id = hsdg.ctx_employee_id()
        ))
$function$;

DROP TRIGGER IF EXISTS engagements_access_creator ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.engagement_access_from_creator();

-- engagement_access is owner-only (policy engagement_access_owner), so the
-- migrator deletes the creator rows directly.
DELETE FROM hsdg.engagement_access WHERE source = 'creator';
ALTER TABLE hsdg.engagement_access
  DROP CONSTRAINT engagement_access_creator_xact,
  DROP COLUMN xact_id,
  DROP CONSTRAINT engagement_access_source_check,
  ADD CONSTRAINT engagement_access_source_check
    CHECK (source IN ('partner','manager','team'));

DROP POLICY IF EXISTS engagements_insert_creator ON hsdg.engagements;
ALTER TABLE hsdg.engagements DROP COLUMN IF EXISTS created_by_employee_id;

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'engagement.create');
DELETE FROM hsdg.permissions WHERE slug = 'engagement.create';
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
