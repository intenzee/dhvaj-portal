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

-- ── Employees (Phase 2) ───────────────────────────────────────────────────
-- Grade differs from security role on purpose (e.g. the Admin user holds a
-- Manager grade). Some employees have no login (articles). Split across offices
-- to exercise RLS scoping.
INSERT INTO hsdg.employees
  (employee_code, full_name, user_id, grade_id, primary_office_id, employment_status, date_of_joining)
SELECT v.code, v.full_name, u.id, g.id, o.id, v.status, v.doj::date
FROM (VALUES
  ('EMP001', 'Managing Partner', 'mp@hsdg.in',        'partner', 'NORTH', 'active', '2010-04-01'),
  ('EMP002', 'Firm Admin',       'admin@hsdg.in',     'manager', 'NORTH', 'active', '2015-06-01'),
  ('EMP003', 'Partner A',        'partner.a@hsdg.in', 'partner', 'NORTH', 'active', '2012-07-01'),
  ('EMP004', 'Partner B',        'partner.b@hsdg.in', 'partner', 'SOUTH', 'active', '2013-09-01'),
  ('EMP005', 'Manager X',        'manager.x@hsdg.in', 'manager', 'NORTH', 'active', '2018-01-15'),
  ('EMP006', 'Senior Y',         'senior.y@hsdg.in',  'senior',  'SOUTH', 'active', '2020-08-01'),
  ('EMP007', 'Article North',    NULL,                'article', 'NORTH', 'active', '2023-05-01'),
  ('EMP008', 'Article South',    NULL,                'article', 'SOUTH', 'active', '2023-05-01')
) AS v(code, full_name, email, grade_slug, office_code, status, doj)
JOIN hsdg.grades g ON g.slug = v.grade_slug
JOIN hsdg.offices o ON o.code = v.office_code
LEFT JOIN hsdg.users u ON u.email = v.email::citext
ON CONFLICT (employee_code) DO NOTHING;

-- Reporting lines (org structure only — no access is derived from these).
UPDATE hsdg.employees e SET reports_to_id = m.id
FROM hsdg.employees m
WHERE e.reports_to_id IS NULL
  AND (e.employee_code, m.employee_code) IN (
    ('EMP002', 'EMP001'),  -- Admin      -> Managing Partner
    ('EMP003', 'EMP001'),  -- Partner A  -> Managing Partner
    ('EMP004', 'EMP001'),  -- Partner B  -> Managing Partner
    ('EMP005', 'EMP003'),  -- Manager X  -> Partner A
    ('EMP006', 'EMP004'),  -- Senior Y   -> Partner B
    ('EMP007', 'EMP005'),  -- Article N  -> Manager X
    ('EMP008', 'EMP006')   -- Article S  -> Senior Y
  );

-- Partner profiles.
INSERT INTO hsdg.partner_profiles (employee_id, membership_no, partner_since)
SELECT e.id, v.membership_no, v.partner_since::date
FROM (VALUES
  ('EMP001', 'ICAI-100001', '2010-04-01'),
  ('EMP003', 'ICAI-100003', '2012-07-01'),
  ('EMP004', 'ICAI-100004', '2013-09-01')
) AS v(code, membership_no, partner_since)
JOIN hsdg.employees e ON e.employee_code = v.code
ON CONFLICT (employee_id) DO NOTHING;
