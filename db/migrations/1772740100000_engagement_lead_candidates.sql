-- ─────────────────────────────────────────────────────────────────────────
-- Engagement Partner / Manager can be picked from any office
--
-- employees_select limits a non-firm-wide caller to their own office, so a
-- partner or senior in SOUTH setting up an engagement could not name a NORTH
-- partner as its EP. The insert itself already allows it (engagements_insert_
-- creator, and enforce_engagement_grades is SECURITY DEFINER); only the
-- picker's read was scoped.
--
-- hsdg.engagement_lead_candidates() is that read, firm-wide but narrow: the
-- employees who can lead an engagement (manager grade or above, not exited,
-- login not deactivated)
-- and only what a picker shows — id, name, grade, office. No login, pay,
-- reporting line or partner details. Any signed-in principal may call it;
-- the API gates it on engagement.create.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE FUNCTION hsdg.engagement_lead_candidates()
RETURNS TABLE (
  id uuid,
  full_name text,
  grade_slug text,
  grade_name text,
  is_partner_grade boolean,
  office_code text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = hsdg, pg_temp
AS $$
  SELECT e.id, e.full_name, g.slug, g.name, g.is_partner_grade, o.code
  FROM hsdg.employees e
  JOIN hsdg.grades g ON g.id = e.grade_id
  JOIN hsdg.offices o ON o.id = e.primary_office_id
  WHERE hsdg.ctx_role() IS NOT NULL
    AND e.employment_status <> 'exited'
    -- A deactivated login (a leaver, or a trial account) takes them off the list.
    AND NOT EXISTS (SELECT 1 FROM hsdg.users u WHERE u.id = e.user_id AND NOT u.is_active)
    AND g.rank >= (SELECT rank FROM hsdg.grades WHERE slug = 'manager')
  ORDER BY g.rank DESC, e.full_name
$$;
REVOKE ALL ON FUNCTION hsdg.engagement_lead_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.engagement_lead_candidates() TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.engagement_lead_candidates();
