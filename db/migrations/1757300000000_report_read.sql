-- ─────────────────────────────────────────────────────────────────────────
-- 0020 · Reports & MIS — report.read permission
--
-- Reports & MIS are management aggregations (engagement/compliance/utilisation).
-- Like every read in the system they are RLS-scoped — the numbers reflect only
-- what the caller can see (firm-wide for the MP, assignment-scoped otherwise) —
-- but they surface per-employee workload and cross-engagement rollups that are a
-- management concern, so they sit behind their own permission rather than the
-- all-staff `engagement.read`.
--
-- Granted to the management tier: Managing Partner, admin, partner, manager.
-- Seniors/articles keep their personal dashboard; they do not get firm MIS.
--
-- Reference-data change on FORCE-RLS tables: briefly drop FORCE on roles,
-- permissions and role_permissions (the migrator is context-less and would
-- otherwise see zero rows), mutate, then restore — the migration-0003 pattern.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.permissions (slug, description)
  VALUES ('report.read', 'View firm/management reports & MIS')
  ON CONFLICT (slug) DO NOTHING;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM hsdg.roles r
JOIN hsdg.permissions p ON p.slug = 'report.read'
WHERE r.slug IN ('managing_partner', 'admin', 'partner', 'manager')
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;

DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions WHERE slug = 'report.read');
DELETE FROM hsdg.permissions WHERE slug = 'report.read';

ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
