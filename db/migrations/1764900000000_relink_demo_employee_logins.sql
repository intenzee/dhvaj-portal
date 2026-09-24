-- ─────────────────────────────────────────────────────────────────────────
-- 0069 · Re-link demo employees to their @dhvaj.in logins
--
-- WHY: the Dhvaj rebrand (b823617) moved the seeded persona logins from
-- @hsdg.in to @dhvaj.in. A database first seeded before the rebrand and then
-- re-seeded with dev_identity.sql ends up with BOTH sets of users: the new
-- @dhvaj.in users get their roles, but `employees` is guarded by
-- ON CONFLICT (employee_code) DO NOTHING, so every employee stays linked to the
-- old @hsdg.in user. Signing in as partner.a@dhvaj.in then yields a principal
-- with no employee_id, and RLS (EP / manager / team membership is matched on
-- employee_id) hides every engagement from everyone but the Managing Partner.
--
-- Editing the seed would not repair such a database, so this moves each
-- employee's user link from `<name>@hsdg.in` to `<name>@dhvaj.in` when that
-- counterpart exists and is not already linked, then deactivates the orphaned
-- @hsdg.in login. Idempotent, and a no-op on any database without the
-- duplicate pair (fresh deploys, local dev, real firm data).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DO $$
DECLARE
  emp_forced  boolean;
  user_forced boolean;
BEGIN
  -- The migrator has no request context, so FORCE'd RLS would hide every row
  -- (compare 1764800000000). Lift it for this statement only, then restore.
  SELECT relforcerowsecurity INTO emp_forced  FROM pg_class WHERE oid = 'hsdg.employees'::regclass;
  SELECT relforcerowsecurity INTO user_forced FROM pg_class WHERE oid = 'hsdg.users'::regclass;
  ALTER TABLE hsdg.employees NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE hsdg.users     NO FORCE ROW LEVEL SECURITY;

  -- user_id is UNIQUE: clear the old link and set the new one in one statement
  -- per row (the new user is guaranteed unlinked by the NOT EXISTS below).
  UPDATE hsdg.employees e
     SET user_id = new_u.id
    FROM hsdg.users old_u
    JOIN hsdg.users new_u
      ON new_u.email = (split_part(old_u.email::text, '@', 1) || '@dhvaj.in')::citext
   WHERE e.user_id = old_u.id
     AND old_u.email::text ILIKE '%@hsdg.in'
     AND NOT EXISTS (SELECT 1 FROM hsdg.employees x WHERE x.user_id = new_u.id);

  -- Retire the @hsdg.in login once its @dhvaj.in counterpart has taken over.
  UPDATE hsdg.users old_u
     SET is_active = false
   WHERE old_u.email::text ILIKE '%@hsdg.in'
     AND old_u.is_active
     AND EXISTS (
       SELECT 1 FROM hsdg.users new_u
        WHERE new_u.email = (split_part(old_u.email::text, '@', 1) || '@dhvaj.in')::citext)
     AND NOT EXISTS (SELECT 1 FROM hsdg.employees x WHERE x.user_id = old_u.id);

  IF emp_forced  THEN ALTER TABLE hsdg.employees FORCE ROW LEVEL SECURITY; END IF;
  IF user_forced THEN ALTER TABLE hsdg.users     FORCE ROW LEVEL SECURITY; END IF;
END $$;

-- Down Migration

-- Data repair only; the previous links pointed at superseded logins and are
-- not restored.
