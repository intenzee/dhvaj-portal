-- ─────────────────────────────────────────────────────────────────────────
-- 0003 · Identity hardening
--
-- Two small integrity improvements from the Phase-1 review:
--  1. Remove the unused `user.read.all` permission. Firm-wide visibility is
--     decided by RLS from the user's ROLE, so the permission was dead.
--  2. Guarantee the reserved `system` context role can never be seeded as an
--     assignable role (belt-and-braces around the auth-bootstrap invariant).
--
-- Note the FORCE toggle: reference tables run with FORCE ROW LEVEL SECURITY, so
-- even the owning migrator is subject to policy. To adjust seeded reference data
-- in a migration we briefly drop FORCE, make the change, then restore it. (This
-- is the standard pattern for reference-data migrations on FORCE-RLS tables.)
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.roles
  ADD CONSTRAINT roles_slug_not_reserved CHECK (slug <> 'system');

ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'user.read.all');
DELETE FROM hsdg.permissions WHERE slug = 'user.read.all';

ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description)
  VALUES ('user.read.all', 'View users firm-wide')
  ON CONFLICT (slug) DO NOTHING;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM hsdg.roles r
JOIN hsdg.permissions p ON p.slug = 'user.read.all'
WHERE r.slug = 'managing_partner'
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

ALTER TABLE hsdg.roles DROP CONSTRAINT IF EXISTS roles_slug_not_reserved;
