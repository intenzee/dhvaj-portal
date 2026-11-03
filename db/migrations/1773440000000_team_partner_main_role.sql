-- ─────────────────────────────────────────────────────────────────────────
-- A client team's overseeing partner follows the Engagement Partner rule
--
-- engagement_lead_candidates (1773430000000_people_admin) offers a
-- partner-grade person as an Engagement Partner only when their main role is
-- Partner or Managing Partner. team_people() still said "partner" from the
-- grade alone, so an Article graded Partner by mistake could oversee a client
-- team. It now applies the same rule, and a person deleted permanently counts
-- as no longer with the firm.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.team_people()
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
  SELECT e.id, e.full_name, g.slug, g.name,
         g.is_partner_grade AND hsdg.main_role(e.user_id) IN ('partner', 'managing_partner'),
         o.code,
         e.employment_status <> 'exited'
           AND e.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM hsdg.users u WHERE u.id = e.user_id AND NOT u.is_active)
    FROM hsdg.employees e
    JOIN hsdg.grades g ON g.id = e.grade_id
    JOIN hsdg.offices o ON o.id = e.primary_office_id
   WHERE hsdg.ctx_role() IS NOT NULL
   ORDER BY g.rank DESC, e.full_name
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.team_people()
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
