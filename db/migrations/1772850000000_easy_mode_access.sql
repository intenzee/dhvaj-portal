-- ─────────────────────────────────────────────────────────────────────────
-- Easy mode, Track B — who may work on an engagement (Sections 2, 4, 5).
--
-- The managing partner (23 Oct 2026): too many restrictions; let people work
-- freely now and turn the checks back on as the firm gets used to the portal.
-- Every relaxation below sits behind a firm check (hsdg.firm_check, from
-- 1772800000000_firm_strict_checks). A check that is ON keeps the old rule.
--
-- team_only_access          OFF → staff (partner, manager, senior, article)
--                           of the engagement's office count as its members:
--                           they see it and do the work on it. Office and
--                           firm separation stay — another office's work is
--                           still closed, and an article whose firm keeps
--                           articles to their assigned clients
--                           (article_client_scope) is still kept to them.
--                           is_engagement_lead does not change: running the
--                           engagement stays with its partner and manager.
-- task_assignee_only        OFF → any member may add a task and move or edit
--                           one, not only its assignee, reviewer or a lead.
-- task_assign_team_only     OFF → a member may put someone from the office on
--                           the team (as a plain member), so a task can go to
--                           anyone in the office.
-- engagement_partner_required
--                           OFF → an accepted engagement may have no partner
--                           yet. The CHECK becomes a trigger that asks the
--                           firm check; it raises under the same constraint
--                           name, so the API's message for it is unchanged.
--
-- engagement_offices is the office of each engagement, kept by trigger like
-- engagement_access (1770460000000), so is_engagement_member can ask for it
-- without going back through engagements_select (the RLS cycle that table
-- was made to break).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── The engagement's office, past RLS ─────────────────────────────────────
CREATE TABLE hsdg.engagement_offices (
  engagement_id uuid PRIMARY KEY REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  office_id     uuid NOT NULL
);
CREATE INDEX engagement_offices_office_idx ON hsdg.engagement_offices (office_id);

REVOKE ALL ON hsdg.engagement_offices FROM PUBLIC;
REVOKE ALL ON hsdg.engagement_offices FROM hsdg_app;
ALTER TABLE hsdg.engagement_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_offices FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_offices_owner ON hsdg.engagement_offices
  TO hsdg_migrator USING (true) WITH CHECK (true);

CREATE FUNCTION hsdg.engagement_offices_from_engagement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
BEGIN
  INSERT INTO hsdg.engagement_offices (engagement_id, office_id)
  VALUES (NEW.id, NEW.office_id)
  ON CONFLICT (engagement_id) DO UPDATE SET office_id = EXCLUDED.office_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER engagements_office_fact
  AFTER INSERT OR UPDATE OF office_id ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.engagement_offices_from_engagement();

ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.engagement_offices (engagement_id, office_id)
SELECT id, office_id FROM hsdg.engagements;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;

-- ── Office staff as members ───────────────────────────────────────────────
-- Whether the caller is office staff who may work on their office's
-- engagements today (the firm check is off). Cheap: settings and GUCs only.
CREATE FUNCTION hsdg.ctx_works_office_engagements()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.ctx_employee_id() IS NOT NULL
     AND hsdg.ctx_office_id() IS NOT NULL
     AND (hsdg.ctx_role() IN ('partner', 'manager', 'senior', 'article')
          OR hsdg.ctx_roles() && ARRAY['partner', 'manager', 'senior', 'article'])
     AND hsdg.ctx_sees_office_clients()
     AND NOT hsdg.firm_check('team_only_access')
$function$;
REVOKE ALL ON FUNCTION hsdg.ctx_works_office_engagements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_works_office_engagements() TO hsdg_app;

-- The engagement is in the caller's office and they may work on it.
CREATE FUNCTION hsdg.ctx_office_member_of(eng_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT hsdg.ctx_works_office_engagements()
     AND EXISTS (SELECT 1 FROM hsdg.engagement_offices o
                  WHERE o.engagement_id = eng_id
                    AND o.office_id = hsdg.ctx_office_id())
$function$;
REVOKE ALL ON FUNCTION hsdg.ctx_office_member_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_office_member_of(uuid) TO hsdg_app;

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
     OR hsdg.ctx_office_member_of(eng_id)
$function$;

-- The engagement row itself: its own column, no helper round trip.
CREATE POLICY engagements_select_office ON hsdg.engagements FOR SELECT
  USING (office_id = hsdg.ctx_office_id() AND hsdg.ctx_works_office_engagements());

-- ── Tasks: any member works them ──────────────────────────────────────────
CREATE POLICY tasks_insert_member ON hsdg.tasks FOR INSERT
  WITH CHECK (NOT hsdg.firm_check('task_assignee_only')
              AND hsdg.is_engagement_member(engagement_id));
CREATE POLICY tasks_update_member ON hsdg.tasks FOR UPDATE
  USING (NOT hsdg.firm_check('task_assignee_only')
         AND hsdg.is_engagement_member(engagement_id))
  WITH CHECK (NOT hsdg.firm_check('task_assignee_only')
              AND hsdg.is_engagement_member(engagement_id));

-- ── Team: a member adds an office colleague as a plain member ─────────────
CREATE POLICY engagement_team_insert_member ON hsdg.engagement_team FOR INSERT
  WITH CHECK (NOT hsdg.firm_check('task_assign_team_only')
              AND role_on_engagement = 'member'
              AND hsdg.is_engagement_member(engagement_id));

-- ── An accepted engagement's partner, behind its check ───────────────────
ALTER TABLE hsdg.engagements DROP CONSTRAINT engagements_ep_required_when_accepted;

CREATE FUNCTION hsdg.enforce_engagement_partner_required() RETURNS trigger
LANGUAGE plpgsql
SET search_path = hsdg, pg_temp
AS $$
BEGIN
  IF NEW.engagement_partner_id IS NULL
     AND NEW.status NOT IN ('prospect','pending_acceptance','declined','withdrawn','cancelled','merged')
     AND hsdg.firm_check('engagement_partner_required') THEN
    RAISE EXCEPTION 'An accepted engagement needs an Engagement Partner.'
      USING ERRCODE = 'check_violation',
            TABLE = 'engagements',
            CONSTRAINT = 'engagements_ep_required_when_accepted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagements_enforce_partner_required
  BEFORE INSERT OR UPDATE OF engagement_partner_id, status ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_partner_required();

-- Down Migration

DROP TRIGGER IF EXISTS engagements_enforce_partner_required ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.enforce_engagement_partner_required();
-- Engagements accepted without a partner while the check was off stay as
-- they are; the restored rule binds new writes only.
ALTER TABLE hsdg.engagements
  ADD CONSTRAINT engagements_ep_required_when_accepted
  CHECK (status IN ('prospect','pending_acceptance','declined','withdrawn','cancelled','merged')
         OR engagement_partner_id IS NOT NULL) NOT VALID;

DROP POLICY IF EXISTS engagement_team_insert_member ON hsdg.engagement_team;
DROP POLICY IF EXISTS tasks_update_member ON hsdg.tasks;
DROP POLICY IF EXISTS tasks_insert_member ON hsdg.tasks;
DROP POLICY IF EXISTS engagements_select_office ON hsdg.engagements;

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

DROP FUNCTION IF EXISTS hsdg.ctx_office_member_of(uuid);
DROP FUNCTION IF EXISTS hsdg.ctx_works_office_engagements();
DROP TRIGGER IF EXISTS engagements_office_fact ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.engagement_offices_from_engagement();
DROP TABLE IF EXISTS hsdg.engagement_offices;
