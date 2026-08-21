-- ─────────────────────────────────────────────────────────────────────────
-- 0018 · Administration — office.manage permission
--
-- Phase 13 adds the Administration UI and its write endpoints. User creation,
-- updates and role assignment already have a permission (`user.manage`) and RLS
-- write policies (migration 0002: users_insert/update, user_roles_write, all
-- firm-wide-gated). Office writes have an RLS policy (offices_write, firm-wide)
-- but no dedicated permission yet — the app layer gated only `office.read`.
--
-- This migration adds the missing `office.manage` permission and grants it to
-- the firm-wide roles (managing_partner, admin), matching who RLS already lets
-- write offices. Defence in depth: the API guard AND the database policy must
-- both agree before an office row can change.
--
-- Reference-data change on FORCE-RLS tables: briefly drop FORCE, mutate, restore
-- (the standard pattern from migration 0003).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- `roles` is joined below to resolve role ids; under FORCE RLS the context-less
-- migrator sees zero roles, so drop FORCE on every table we read/write here
-- (the standard reference-data pattern from migration 0003), then restore it.
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description)
  VALUES ('office.manage', 'Create and modify offices')
  ON CONFLICT (slug) DO NOTHING;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM hsdg.roles r
JOIN hsdg.permissions p ON p.slug = 'office.manage'
WHERE r.slug IN ('managing_partner', 'admin')
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'office.manage');
DELETE FROM hsdg.permissions WHERE slug = 'office.manage';

ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
