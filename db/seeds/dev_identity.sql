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

-- ── Client entities (Phase 3) ─────────────────────────────────────────────
-- Split across offices to exercise RLS scoping (a North user must not see a
-- South client). entity_code is auto-generated (ENT#####).
INSERT INTO hsdg.entities
  (legal_name, display_name, entity_type_id, pan, home_office_id, status, incorporation_date,
   annual_turnover)
SELECT v.legal_name, v.display_name, et.id, v.pan, o.id, v.status, v.incorp::date, v.turnover
FROM (VALUES
  -- annual_turnover (₹) drives threshold-based applicability (§17). Bharat sits
  -- above every seeded threshold; Deepak (individual) sits below them all.
  ('Acme Manufacturing Pvt Ltd', 'Acme',    'private_limited', 'AAACA1234A', 'NORTH', 'active', '2015-04-10', 150000000::bigint),
  ('Bharat Textiles LLP',        'Bharat',  'llp',             'AABCB5678B', 'NORTH', 'active', '2018-07-01', 80000000::bigint),
  ('Coastal Foods Pvt Ltd',      'Coastal', 'private_limited', 'AACCC9012C', 'SOUTH', 'active', '2016-01-20', 30000000::bigint),
  ('Deepak Rao',                 'Deepak',  'individual',      'AADPD3456D', 'SOUTH', 'active', NULL,         500000::bigint)
) AS v(legal_name, display_name, type_slug, pan, office_code, status, incorp, turnover)
JOIN hsdg.entity_types et ON et.slug = v.type_slug
JOIN hsdg.offices o ON o.code = v.office_code
ON CONFLICT (pan) WHERE pan IS NOT NULL DO NOTHING;

INSERT INTO hsdg.entity_registrations (entity_id, registration_type, registration_number, state_code, status)
SELECT e.id, v.rtype, v.rnum, v.state, 'active'
FROM (VALUES
  ('AAACA1234A', 'gstin', '27AAACA1234A1Z5', '27'),
  ('AAACA1234A', 'cin',   'U17110MH2015PTC123456', NULL),
  ('AABCB5678B', 'llpin', 'AAB-5678', NULL),
  -- Bharat is a GST-registered LLP: the component-discovery fixtures run
  -- GST_MONTHLY engagements against it and expect GSTR-1/3B (which require a
  -- gstin) to be mandatory. Without this the discovery test cannot pass.
  ('AABCB5678B', 'gstin', '27AABCB5678B1Z4', '27'),
  ('AACCC9012C', 'gstin', '29AACCC9012C1Z8', '29')
) AS v(pan, rtype, rnum, state)
JOIN hsdg.entities e ON e.pan = v.pan
ON CONFLICT (registration_type, registration_number) DO NOTHING;

INSERT INTO hsdg.entity_contacts (entity_id, full_name, designation, email, is_primary, is_signatory)
SELECT e.id, v.name, v.desig, v.email::citext, v.is_primary, v.is_sig
FROM (VALUES
  ('AAACA1234A', 'Ramesh Gupta', 'Director', 'ramesh@acme.example',    true,  true),
  ('AACCC9012C', 'Sunita Nair',  'CFO',      'sunita@coastal.example', true,  false)
) AS v(pan, name, desig, email, is_primary, is_sig)
JOIN hsdg.entities e ON e.pan = v.pan
WHERE NOT EXISTS (
  SELECT 1 FROM hsdg.entity_contacts ec WHERE ec.entity_id = e.id AND ec.full_name = v.name
);

-- ── Engagements (Phase 5) ─────────────────────────────────────────────────
-- Acme (NORTH) statutory audit: EP Partner A, Manager X — team includes a
-- SOUTH senior, demonstrating shared resources across offices.
INSERT INTO hsdg.engagements
  (entity_id, service_id, financial_year, period_label, office_id,
   engagement_partner_id, engagement_manager_id, status, accepted_at)
SELECT e.id, s.id, v.fy, v.period, e.home_office_id, ep.id, mgr.id, v.status,
       CASE WHEN v.status NOT IN ('prospect', 'pending_acceptance') THEN now() END
FROM (VALUES
  ('AAACA1234A', 'STAT_AUDIT', '2024-25', 'FY',     'EMP003', 'EMP005', 'accepted'),
  ('AACCC9012C', 'GST_ANNUAL', '2024-25', 'Annual', 'EMP004', NULL,     'active')
) AS v(entity_pan, service_code, fy, period, ep_code, mgr_code, status)
JOIN hsdg.entities e ON e.pan = v.entity_pan::citext
JOIN hsdg.services s ON s.code = v.service_code
JOIN hsdg.employees ep ON ep.employee_code = v.ep_code
LEFT JOIN hsdg.employees mgr ON mgr.employee_code = v.mgr_code
-- Idempotency guard (§5–§6 multi-entity dropped the old
-- (entity_id, service_id, financial_year, period_label) unique constraint in
-- favour of the engagement_entities join table, so ON CONFLICT can no longer
-- infer it). NOT EXISTS keeps the re-runnable seed schema-agnostic — mirrors
-- the entity_contacts guard above.
WHERE NOT EXISTS (
  SELECT 1 FROM hsdg.engagements ex
  WHERE ex.entity_id = e.id AND ex.service_id = s.id
    AND ex.financial_year = v.fy AND ex.period_label = v.period
);

INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
SELECT eng.id, emp.id, v.role
FROM (VALUES
  ('AAACA1234A', 'STAT_AUDIT', 'EMP006', 'in_charge'),  -- Senior Y (SOUTH) on Acme (NORTH)
  ('AAACA1234A', 'STAT_AUDIT', 'EMP007', 'member'),     -- Article North on Acme
  ('AACCC9012C', 'GST_ANNUAL', 'EMP008', 'member')      -- Article South on Coastal
) AS v(entity_pan, service_code, emp_code, role)
JOIN hsdg.entities e ON e.pan = v.entity_pan::citext
JOIN hsdg.services s ON s.code = v.service_code
JOIN hsdg.engagements eng
  ON eng.entity_id = e.id AND eng.service_id = s.id AND eng.financial_year = '2024-25'
JOIN hsdg.employees emp ON emp.employee_code = v.emp_code
ON CONFLICT (engagement_id, employee_id) DO NOTHING;
