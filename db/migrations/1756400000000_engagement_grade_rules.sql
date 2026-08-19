-- ─────────────────────────────────────────────────────────────────────────
-- 0010 · Engagement accountability grade rules
--
-- Checkpoint finding #1: nothing enforced that the accountable Engagement
-- Partner is actually a partner, or that the Engagement Manager is a manager.
-- A FK guarantees the id is an employee, but not their grade — so a senior or
-- article could hold partner accountability.
--
-- Enforced in the DATABASE (consistent with the RLS-in-the-database posture) via
-- a BEFORE INSERT/UPDATE trigger:
--   • engagement_partner_id → must be a partner-grade employee.
--   • engagement_manager_id → must be manager-grade or more senior.
-- The check runs only when the column is set and (on UPDATE) actually changed,
-- so routine updates (e.g. status transitions in Phase 6) pay no cost.
--
-- RLS interaction (same pattern as ADR-0008's engagement helpers): the trigger
-- must read grade regardless of the writer's scope — the superuser seed carries
-- no security context, and a firm-wide MP may assign a cross-office EP/manager.
-- So the check function is SECURITY DEFINER (runs as the migrator, the tables'
-- owner) over employees/grades set to ENABLE — not FORCE — row security. The
-- owner then bypasses RLS *inside the check function only*; the least-privilege
-- app role is never the owner and remains fully governed by the unchanged
-- employees_select / grades_read policies (proven by the RLS test-suite, which
-- still sees office-scoped/​fail-closed employee visibility as hsdg_app). The
-- migrator is used only for migrations, never at runtime, so dropping FORCE on
-- these two tables changes nothing about runtime access. It validates an
-- integrity rule, makes no access decision, and returns no data.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- Owner bypasses RLS inside the SECURITY DEFINER check (ENABLE, not FORCE). The
-- app role stays governed — its policies are untouched.
ALTER TABLE hsdg.employees NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.grades    NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION hsdg.enforce_engagement_grades() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  -- Engagement Partner must be a partner-grade employee.
  IF NEW.engagement_partner_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.engagement_partner_id IS DISTINCT FROM OLD.engagement_partner_id)
     AND NOT EXISTS (
       SELECT 1 FROM hsdg.employees e JOIN hsdg.grades g ON g.id = e.grade_id
       WHERE e.id = NEW.engagement_partner_id AND g.is_partner_grade
     ) THEN
    RAISE EXCEPTION 'Engagement Partner must be a partner-grade employee.';
  END IF;

  -- Engagement Manager must be manager-grade or more senior.
  IF NEW.engagement_manager_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.engagement_manager_id IS DISTINCT FROM OLD.engagement_manager_id)
     AND NOT EXISTS (
       SELECT 1 FROM hsdg.employees e JOIN hsdg.grades g ON g.id = e.grade_id
       WHERE e.id = NEW.engagement_manager_id
         AND g.rank >= (SELECT rank FROM hsdg.grades WHERE slug = 'manager')
     ) THEN
    RAISE EXCEPTION 'Engagement Manager must be a manager-grade (or more senior) employee.';
  END IF;

  RETURN NEW;
END;
$$;

-- Not directly callable; keep the app role's execute grant explicit and deny PUBLIC.
REVOKE EXECUTE ON FUNCTION hsdg.enforce_engagement_grades() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.enforce_engagement_grades() TO hsdg_app;

CREATE TRIGGER engagements_enforce_grades
  BEFORE INSERT OR UPDATE ON hsdg.engagements
  FOR EACH ROW EXECUTE FUNCTION hsdg.enforce_engagement_grades();

-- Down Migration

DROP TRIGGER IF EXISTS engagements_enforce_grades ON hsdg.engagements;
DROP FUNCTION IF EXISTS hsdg.enforce_engagement_grades();

ALTER TABLE hsdg.grades    FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.employees FORCE ROW LEVEL SECURITY;
