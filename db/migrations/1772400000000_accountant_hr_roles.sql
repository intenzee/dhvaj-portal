-- ─────────────────────────────────────────────────────────────────────────
-- Accountant and HR roles — phase 0 (docs/accountant-hr-roles-spec.md §7).
--
-- 1. Two desk roles, `accountant` and `hr`, and the permissions they and the
--    payroll work need.
-- 2. Every role a user holds now reaches the database as `hsdg.roles` (the
--    single `hsdg.role` stays the highest one). The desk roles rank below
--    every professional role, so they act only through ctx_has_role(): a
--    Senior + Accountant keeps the Senior's client work AND gets the billing.
-- 3. The Accountant bills every client: ctx_can_bill / ctx_may_bill_engagement
--    and the two finance lists that don't go through them.
-- 4. HR keeps the employee master and onboards logins — but only for people
--    who hold nothing above Manager, never their own (the ceiling is in the
--    API too; this is the database's copy of it).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Roles and permissions ─────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.roles (slug, name, description) VALUES
  ('accountant', 'Accountant', 'The firm''s accounts executive: invoices, receipts, collections, TDS credits and booking payroll. No client work.'),
  ('hr', 'HR', 'People operations: the employee master, logins up to Manager, attendance and payroll.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('fee.agree', 'Agree a fee with a client: add or cancel fee milestones'),
  ('entity.read_billing', 'See a client''s billing profile only (name, PAN, GSTIN, address, billing contact)'),
  ('engagement.read_commercial', 'See an engagement''s header, fee schedule and billable hours — not its work'),
  ('user.onboard', 'Create logins, set passwords and deactivate — for Article, Senior and Manager only'),
  ('report.read_people', 'Workload and hours reports without client or engagement names'),
  ('time.read_attendance', 'Per-person daily hours by kind, without client or engagement names'),
  ('payroll.prepare', 'Propose salaries, run monthly payroll, produce the bank file and payslips'),
  ('payroll.read', 'See everyone''s pay, payslips, registers and bank and statutory details'),
  ('payroll.approve', 'Approve a payroll run, a salary revision or a full and final settlement'),
  ('payroll.read_summary', 'See paid payroll runs'' totals by head, for the books'),
  ('payroll.read_own', 'See one''s own payslips, salary structure and tax; request a bank change')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM (VALUES
    ('accountant', 'billing.manage'),
    ('accountant', 'entity.read_billing'),
    ('accountant', 'engagement.read_commercial'),
    ('accountant', 'notification.read'),
    ('accountant', 'office.read'),
    ('accountant', 'payroll.read_summary'),
    ('hr', 'employee.read'),
    ('hr', 'employee.manage'),
    ('hr', 'user.read'),
    ('hr', 'user.onboard'),
    ('hr', 'office.read'),
    ('hr', 'report.read_people'),
    ('hr', 'time.read_attendance'),
    ('hr', 'payroll.prepare'),
    ('hr', 'payroll.read'),
    ('hr', 'notification.read'),
    ('partner', 'fee.agree'),
    ('managing_partner', 'fee.agree'),
    ('managing_partner', 'entity.read_billing'),
    ('managing_partner', 'engagement.read_commercial'),
    ('managing_partner', 'report.read_people'),
    ('managing_partner', 'time.read_attendance'),
    ('managing_partner', 'payroll.read'),
    ('managing_partner', 'payroll.approve'),
    ('managing_partner', 'payroll.read_summary')
  ) AS g(role_slug, perm_slug)
  JOIN hsdg.roles r ON r.slug = g.role_slug
  JOIN hsdg.permissions p ON p.slug = g.perm_slug
ON CONFLICT DO NOTHING;

-- Everyone sees their own pay.
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'payroll.read_own'
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- ── 2. Every role held ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hsdg.ctx_roles() RETURNS text[]
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_to_array(NULLIF(current_setting('hsdg.roles', true), ''), ','), '{}'::text[])
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_roles() TO hsdg_app;

CREATE OR REPLACE FUNCTION hsdg.ctx_has_role(p_role text) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT p_role = ANY (hsdg.ctx_roles())
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_has_role(text) TO hsdg_app;

-- The Accountant: the firm's billing, every client.
CREATE OR REPLACE FUNCTION hsdg.ctx_is_finance() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_has_role('accountant')
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_is_finance() TO hsdg_app;

-- HR: the employee master, every office.
CREATE OR REPLACE FUNCTION hsdg.ctx_is_people_ops() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_has_role('hr')
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_is_people_ops() TO hsdg_app;

-- ── 3. The Accountant bills every client ─────────────────────────────────
CREATE OR REPLACE FUNCTION hsdg.ctx_can_bill(p_entity_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_business_firmwide()
      OR hsdg.ctx_is_finance()
      OR (hsdg.ctx_role() IN ('partner', 'manager') AND EXISTS (
            SELECT 1 FROM hsdg.entities e
             WHERE e.id = p_entity_id AND e.home_office_id = hsdg.ctx_office_id()));
$$;

CREATE OR REPLACE FUNCTION hsdg.ctx_may_bill_engagement(p_engagement_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.is_engagement_lead(p_engagement_id)
      -- No engagements lookup for the Accountant: inside this definer it would
      -- still run under the caller's RLS, which hides engagements from them.
      -- The engagement foreign keys reject an id that doesn't exist.
      OR hsdg.ctx_is_finance()
      OR (hsdg.is_engagement_member(p_engagement_id) AND EXISTS (
            SELECT 1 FROM hsdg.engagements e
             WHERE e.id = p_engagement_id AND hsdg.ctx_can_bill(e.entity_id)));
$$;

-- Agreed fees are what the Accountant bills from (read only; agreeing one
-- stays with the engagement lead, and fee.agree in the API).
CREATE POLICY engagement_fee_milestones_select_finance ON hsdg.engagement_fee_milestones
  FOR SELECT TO hsdg_app USING (hsdg.ctx_is_finance());

DROP POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches;
CREATE POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches
  FOR SELECT TO hsdg_app USING (
    hsdg.ctx_is_business_firmwide()
    OR hsdg.ctx_is_finance()
    OR imported_by_employee_id = hsdg.ctx_employee_id()
    OR hsdg.ctx_role() IN ('partner', 'manager', 'admin'));

-- ── 4. HR: the employee master and onboarding ───────────────────────────
-- The roles HR may give (contracts ONBOARD_ASSIGNABLE_ROLES).
CREATE OR REPLACE FUNCTION hsdg.onboard_assignable_role(p_role_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM hsdg.roles r
                  WHERE r.id = p_role_id AND r.slug IN ('article', 'senior', 'manager'));
$$;
REVOKE ALL ON FUNCTION hsdg.onboard_assignable_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.onboard_assignable_role(uuid) TO hsdg_app;

-- The migrator reads every user's roles inside the definer function below.
-- Checked 2026-10-21: the only other definer function reading user_roles,
-- billing_approvers_firmwide, already switches to the system role, so this
-- policy widens nothing that exists.
CREATE POLICY user_roles_owner ON hsdg.user_roles
  TO hsdg_migrator USING (true) WITH CHECK (true);

-- True when HR may manage this user: someone else, holding no role above
-- Manager (a user with no roles yet — a joiner — qualifies).
CREATE OR REPLACE FUNCTION hsdg.ctx_may_onboard_user(p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_people_ops()
     AND p_user_id IS DISTINCT FROM hsdg.ctx_user_id()
     AND NOT EXISTS (
       SELECT 1 FROM hsdg.user_roles ur JOIN hsdg.roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user_id AND r.slug NOT IN ('article', 'senior', 'manager'));
$$;
REVOKE ALL ON FUNCTION hsdg.ctx_may_onboard_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_may_onboard_user(uuid) TO hsdg_app;

CREATE POLICY employees_select_people_ops ON hsdg.employees
  FOR SELECT USING (hsdg.ctx_is_people_ops());
CREATE POLICY employees_insert_people_ops ON hsdg.employees
  FOR INSERT WITH CHECK (hsdg.ctx_is_people_ops());
CREATE POLICY employees_update_people_ops ON hsdg.employees
  FOR UPDATE USING (hsdg.ctx_is_people_ops()) WITH CHECK (hsdg.ctx_is_people_ops());

CREATE POLICY partner_profiles_people_ops ON hsdg.partner_profiles
  USING (hsdg.ctx_is_people_ops()) WITH CHECK (hsdg.ctx_is_people_ops());

CREATE POLICY users_select_people_ops ON hsdg.users
  FOR SELECT USING (hsdg.ctx_is_people_ops());
CREATE POLICY users_insert_people_ops ON hsdg.users
  FOR INSERT WITH CHECK (hsdg.ctx_is_people_ops());
CREATE POLICY users_update_people_ops ON hsdg.users
  FOR UPDATE USING (hsdg.ctx_may_onboard_user(id)) WITH CHECK (hsdg.ctx_may_onboard_user(id));

CREATE POLICY user_roles_select_people_ops ON hsdg.user_roles
  FOR SELECT USING (hsdg.ctx_is_people_ops());
CREATE POLICY user_roles_insert_people_ops ON hsdg.user_roles
  FOR INSERT WITH CHECK (hsdg.ctx_may_onboard_user(user_id) AND hsdg.onboard_assignable_role(role_id));
CREATE POLICY user_roles_delete_people_ops ON hsdg.user_roles
  FOR DELETE USING (hsdg.ctx_may_onboard_user(user_id) AND hsdg.onboard_assignable_role(role_id));

-- ── 5. Desk roles see no client master ──────────────────────────────────
-- The client master opens to anyone in the client's office (only Articles are
-- singled out). A user whose highest role is a desk role holds no professional
-- role, so they get none of it — read or write. A Senior + Accountant is ranked
-- Senior and is untouched. Billing reads the client names it needs through
-- definer views (owner hsdg_migrator), which this policy does not reach.
CREATE OR REPLACE FUNCTION hsdg.ctx_is_desk_only() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_role() IN ('accountant', 'hr')
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_is_desk_only() TO hsdg_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entities', 'clients', 'entity_groups', 'entity_addresses',
      'entity_business_activities', 'entity_contacts', 'entity_financial_profiles',
      'entity_listings', 'entity_registrations', 'entity_regulatory_attributes',
      'entity_relationships'] LOOP
    EXECUTE format('CREATE POLICY %I ON hsdg.%I AS RESTRICTIVE TO hsdg_app
                      USING (NOT hsdg.ctx_is_desk_only()) WITH CHECK (NOT hsdg.ctx_is_desk_only())',
                   t || '_no_desk', t);
  END LOOP;
END $$;

-- Down Migration

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.user_roles       NO FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hsdg.user_roles ur JOIN hsdg.roles r ON r.id = ur.role_id
              WHERE r.slug IN ('accountant', 'hr')) THEN
    RAISE EXCEPTION 'Users still hold the accountant or hr role; remove those roles first.';
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entities', 'clients', 'entity_groups', 'entity_addresses',
      'entity_business_activities', 'entity_contacts', 'entity_financial_profiles',
      'entity_listings', 'entity_registrations', 'entity_regulatory_attributes',
      'entity_relationships'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON hsdg.%I', t || '_no_desk', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS hsdg.ctx_is_desk_only();

DROP POLICY IF EXISTS user_roles_delete_people_ops ON hsdg.user_roles;
DROP POLICY IF EXISTS user_roles_insert_people_ops ON hsdg.user_roles;
DROP POLICY IF EXISTS user_roles_select_people_ops ON hsdg.user_roles;
DROP POLICY IF EXISTS users_update_people_ops ON hsdg.users;
DROP POLICY IF EXISTS users_insert_people_ops ON hsdg.users;
DROP POLICY IF EXISTS users_select_people_ops ON hsdg.users;
DROP POLICY IF EXISTS partner_profiles_people_ops ON hsdg.partner_profiles;
DROP POLICY IF EXISTS employees_update_people_ops ON hsdg.employees;
DROP POLICY IF EXISTS employees_insert_people_ops ON hsdg.employees;
DROP POLICY IF EXISTS employees_select_people_ops ON hsdg.employees;
DROP FUNCTION IF EXISTS hsdg.ctx_may_onboard_user(uuid);
DROP POLICY IF EXISTS user_roles_owner ON hsdg.user_roles;
DROP FUNCTION IF EXISTS hsdg.onboard_assignable_role(uuid);

DROP POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches;
CREATE POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches
  FOR SELECT TO hsdg_app USING (
    hsdg.ctx_is_business_firmwide()
    OR imported_by_employee_id = hsdg.ctx_employee_id()
    OR hsdg.ctx_role() IN ('partner', 'manager', 'admin'));
DROP POLICY IF EXISTS engagement_fee_milestones_select_finance ON hsdg.engagement_fee_milestones;

CREATE OR REPLACE FUNCTION hsdg.ctx_may_bill_engagement(p_engagement_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.is_engagement_lead(p_engagement_id)
      OR (hsdg.is_engagement_member(p_engagement_id) AND EXISTS (
            SELECT 1 FROM hsdg.engagements e
             WHERE e.id = p_engagement_id AND hsdg.ctx_can_bill(e.entity_id)));
$$;
CREATE OR REPLACE FUNCTION hsdg.ctx_can_bill(p_entity_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_business_firmwide()
      OR (hsdg.ctx_role() IN ('partner', 'manager') AND EXISTS (
            SELECT 1 FROM hsdg.entities e
             WHERE e.id = p_entity_id AND e.home_office_id = hsdg.ctx_office_id()));
$$;

DROP FUNCTION IF EXISTS hsdg.ctx_is_people_ops();
DROP FUNCTION IF EXISTS hsdg.ctx_is_finance();
DROP FUNCTION IF EXISTS hsdg.ctx_has_role(text);
DROP FUNCTION IF EXISTS hsdg.ctx_roles();

ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions rp USING hsdg.permissions p
 WHERE rp.permission_id = p.id AND p.slug IN (
   'fee.agree', 'entity.read_billing', 'engagement.read_commercial', 'user.onboard',
   'report.read_people', 'time.read_attendance', 'payroll.prepare', 'payroll.read',
   'payroll.approve', 'payroll.read_summary', 'payroll.read_own');
DELETE FROM hsdg.role_permissions rp USING hsdg.roles r
 WHERE rp.role_id = r.id AND r.slug IN ('accountant', 'hr');
DELETE FROM hsdg.permissions WHERE slug IN (
  'fee.agree', 'entity.read_billing', 'engagement.read_commercial', 'user.onboard',
  'report.read_people', 'time.read_attendance', 'payroll.prepare', 'payroll.read',
  'payroll.approve', 'payroll.read_summary', 'payroll.read_own');
DELETE FROM hsdg.roles WHERE slug IN ('accountant', 'hr');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.user_roles       FORCE ROW LEVEL SECURITY;
