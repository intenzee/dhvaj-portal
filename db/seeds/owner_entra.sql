-- ─────────────────────────────────────────────────────────────────────────
-- Owner provisioning for Microsoft Entra SSO.
--
-- Creates the firm owner (deepak@dhvaj.in) with the highest access: both the
-- business firm-wide role (managing_partner) and the platform/admin role, plus
-- an employee + partner profile so they can also act as an Engagement Partner.
-- Entra sign-in matches on the token's email/UPN, so this email MUST equal the
-- user's Entra UPN (deepak@dhvaj.in).
--
-- Run as the PostgreSQL SUPERUSER (bypasses RLS). Idempotent.
--   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d hsdg -f db/seeds/owner_entra.sql
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO hsdg.users (email, display_name, primary_office_id, mfa_required)
SELECT 'deepak@dhvaj.in', 'Deepak Kumar', o.id, true
FROM hsdg.offices o WHERE o.code = 'NORTH'
ON CONFLICT (email) DO NOTHING;

-- Highest access: managing_partner (business firm-wide) + admin (platform).
INSERT INTO hsdg.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM hsdg.users u
JOIN hsdg.roles r ON r.slug IN ('managing_partner', 'admin')
WHERE u.email = 'deepak@dhvaj.in'::citext
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Employee record (partner grade) linked to the login, so the owner can be an EP.
INSERT INTO hsdg.employees
  (employee_code, full_name, user_id, grade_id, primary_office_id, employment_status, date_of_joining)
SELECT 'EMP000', 'Deepak Kumar', u.id, g.id, o.id, 'active', '2010-04-01'
FROM hsdg.grades g, hsdg.offices o
LEFT JOIN hsdg.users u ON u.email = 'deepak@dhvaj.in'::citext
WHERE g.slug = 'partner' AND o.code = 'NORTH'
ON CONFLICT (employee_code) DO NOTHING;

INSERT INTO hsdg.partner_profiles (employee_id, membership_no, partner_since)
SELECT e.id, 'ICAI-100000', '2010-04-01'
FROM hsdg.employees e WHERE e.employee_code = 'EMP000'
ON CONFLICT (employee_id) DO NOTHING;
