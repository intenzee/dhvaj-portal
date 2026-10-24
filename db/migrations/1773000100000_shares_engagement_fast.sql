-- ─────────────────────────────────────────────────────────────────────────
-- shares_engagement_with: start from the co-worker's engagements, not all of them.
--
-- The employees policy calls it for every co-worker outside the viewer's
-- office. It walked every engagement in the firm and ran is_engagement_member
-- (and the engagements policy, whose office test calls firm_check) on each
-- before asking whether the co-worker was on it: ~40 ms a call once a firm
-- has a few hundred engagements, and a join on employees inside a loop
-- (the CARO clause list joins it three times) paid that per row — seconds,
-- which is what timed the statutory-audit "from the file" e2e out.
--
-- Same answer, other order: the co-worker's engagements by index, then the
-- viewer's membership tested as a set (access rows, office links) with the
-- row-independent checks evaluated once. Still read through the engagements
-- policy, as before.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.shares_engagement_with(emp_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  WITH theirs AS (
    SELECT e.id FROM hsdg.engagements e
     WHERE e.id IN (SELECT x.id FROM hsdg.engagements x WHERE x.engagement_partner_id = emp_id
                    UNION
                    SELECT x.id FROM hsdg.engagements x WHERE x.engagement_manager_id = emp_id
                    UNION
                    SELECT t.engagement_id FROM hsdg.engagement_team t WHERE t.employee_id = emp_id)
  )
  SELECT hsdg.ctx_employee_id() IS NOT NULL AND (
    -- is_engagement_member, a branch at a time.
    (hsdg.ctx_is_business_firmwide() AND EXISTS (SELECT 1 FROM theirs))
    OR EXISTS (
      SELECT 1 FROM theirs x
        JOIN hsdg.engagement_access a ON a.engagement_id = x.id
       WHERE a.employee_id = hsdg.ctx_employee_id()
         AND (a.source <> 'creator' OR a.xact_id = pg_current_xact_id_if_assigned()))
    OR (hsdg.ctx_works_office_engagements() AND EXISTS (
      SELECT 1 FROM theirs x
        JOIN hsdg.engagement_offices o ON o.engagement_id = x.id
       WHERE o.office_id = hsdg.ctx_office_id()))
  )
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.shares_engagement_with(emp_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_employee_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM hsdg.engagements e
    WHERE hsdg.is_engagement_member(e.id)
      AND (e.engagement_partner_id = emp_id
           OR e.engagement_manager_id = emp_id
           OR EXISTS (SELECT 1 FROM hsdg.engagement_team t
                      WHERE t.engagement_id = e.id AND t.employee_id = emp_id))
  )
$$;
