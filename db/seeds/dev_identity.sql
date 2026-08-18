-- ─────────────────────────────────────────────────────────────────────────
-- Development / test seed: sample offices and users for the identity model.
--
-- Run as the PostgreSQL SUPERUSER (provisioning), which bypasses RLS — the
-- application role can never seed protected tables. Idempotent.
--
--   npm run db:seed:dev
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO hsdg.offices (code, name) VALUES
  ('NORTH', 'North Office'),
  ('SOUTH', 'South Office')
ON CONFLICT (code) DO NOTHING;

-- Users. Partners are deliberately split across offices to demonstrate
-- office-scoped RLS (a North partner must not see a South user).
INSERT INTO hsdg.users (email, display_name, primary_office_id, mfa_required)
SELECT v.email, v.display_name, o.id, v.mfa_required
FROM (VALUES
  ('mp@hsdg.in',       'Managing Partner', 'NORTH', true),
  ('admin@hsdg.in',    'Firm Admin',       'NORTH', true),
  ('partner.a@hsdg.in','Partner A',        'NORTH', true),
  ('partner.b@hsdg.in','Partner B',        'SOUTH', true),
  ('manager.x@hsdg.in','Manager X',        'NORTH', false),
  ('senior.y@hsdg.in', 'Senior Y',         'SOUTH', false)
) AS v(email, display_name, office_code, mfa_required)
JOIN hsdg.offices o ON o.code = v.office_code
ON CONFLICT (email) DO NOTHING;

-- Role assignments.
INSERT INTO hsdg.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
  ('mp@hsdg.in',        'managing_partner'),
  ('admin@hsdg.in',     'admin'),
  ('partner.a@hsdg.in', 'partner'),
  ('partner.b@hsdg.in', 'partner'),
  ('manager.x@hsdg.in', 'manager'),
  ('senior.y@hsdg.in',  'senior')
) AS v(email, role_slug)
JOIN hsdg.users u ON u.email = v.email::citext
JOIN hsdg.roles r ON r.slug = v.role_slug
ON CONFLICT (user_id, role_id) DO NOTHING;
