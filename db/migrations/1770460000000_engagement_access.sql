-- ─────────────────────────────────────────────────────────────────────────
-- Engagement access facts — breaks the RLS cycle behind is_engagement_member.
--
-- engagements_select reads engagement_team; engagement_team_select calls
-- is_engagement_member, which calls is_engagement_lead, which reads
-- engagements — under engagements_select again. Every helper is owned by
-- hsdg_migrator, itself subject to FORCE ROW LEVEL SECURITY, so the cycle only
-- ended when the planner happened to test the partner / manager columns
-- before the policy. With other statistics it does not, and a team member who
-- is not the partner or manager hits "stack depth limit exceeded" on any read
-- that touches an engagement.
--
-- So who leads or sits on each engagement is kept in its own narrow table,
-- written by triggers from engagements (partner, manager) and engagement_team,
-- and read by the two helpers without going back through any policy.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.engagement_access (
  engagement_id uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL,
  source        text NOT NULL CHECK (source IN ('partner','manager','team')),
  PRIMARY KEY (engagement_id, employee_id, source)
);
CREATE INDEX engagement_access_employee_idx ON hsdg.engagement_access (employee_id);

REVOKE ALL ON hsdg.engagement_access FROM PUBLIC;
REVOKE ALL ON hsdg.engagement_access FROM hsdg_app;
ALTER TABLE hsdg.engagement_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_access FORCE  ROW LEVEL SECURITY;
-- Only the owner's functions below read or write it.
CREATE POLICY engagement_access_owner ON hsdg.engagement_access
  TO hsdg_migrator USING (true) WITH CHECK (true);

-- Trigger functions read only NEW / OLD, so running them as the owner exposes
-- nothing; a trigger function cannot be called directly.
CREATE FUNCTION hsdg.engagement_access_from_engagement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
BEGIN
  DELETE FROM hsdg.engagement_access
   WHERE engagement_id = NEW.id AND source IN ('partner','manager');
  INSERT INTO hsdg.engagement_access (engagement_id, employee_id, source)
  SELECT NEW.id, x.emp, x.src
    FROM (VALUES (NEW.engagement_partner_id, 'partner'),
                 (NEW.engagement_manager_id, 'manager')) AS x (emp, src)
   WHERE x.emp IS NOT NULL;
  RETURN NULL;
END;
$$;

CREATE FUNCTION hsdg.engagement_access_from_team() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM hsdg.engagement_access
     WHERE engagement_id = OLD.engagement_id AND employee_id = OLD.employee_id
       AND source = 'team';
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    INSERT INTO hsdg.engagement_access (engagement_id, employee_id, source)
    VALUES (NEW.engagement_id, NEW.employee_id, 'team')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER engagements_access
  AFTER INSERT OR UPDATE OF engagement_partner_id, engagement_manager_id
  ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_access_from_engagement();
CREATE TRIGGER engagement_team_access
  AFTER INSERT OR UPDATE OF engagement_id, employee_id OR DELETE
  ON hsdg.engagement_team
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_access_from_team();

-- Backfill, with RLS lifted so the migrator sees every row.
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_team NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.engagement_access (engagement_id, employee_id, source)
SELECT id, engagement_partner_id, 'partner' FROM hsdg.engagements
 WHERE engagement_partner_id IS NOT NULL
UNION
SELECT id, engagement_manager_id, 'manager' FROM hsdg.engagements
 WHERE engagement_manager_id IS NOT NULL
UNION
SELECT engagement_id, employee_id, 'team' FROM hsdg.engagement_team;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_team FORCE ROW LEVEL SECURITY;

-- Same answers as before, read from the facts.
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

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.is_engagement_lead(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.ctx_is_business_firmwide()
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagements e
          WHERE e.id = eng_id
            AND (e.engagement_partner_id = hsdg.ctx_employee_id()
                 OR e.engagement_manager_id = hsdg.ctx_employee_id())
        ))
$function$;

CREATE OR REPLACE FUNCTION hsdg.is_engagement_member(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.is_engagement_lead(eng_id)
     OR (hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
          SELECT 1 FROM hsdg.engagement_team t
          WHERE t.engagement_id = eng_id AND t.employee_id = hsdg.ctx_employee_id()
        ))
$function$;

DROP TRIGGER IF EXISTS engagement_team_access ON hsdg.engagement_team;
DROP TRIGGER IF EXISTS engagements_access ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.engagement_access_from_team();
DROP FUNCTION IF EXISTS hsdg.engagement_access_from_engagement();
DROP TABLE IF EXISTS hsdg.engagement_access;
