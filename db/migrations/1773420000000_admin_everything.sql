-- ─────────────────────────────────────────────────────────────────────────
-- The administrator sees and does everything (B-1)
--
-- This reverses the "platform admin sees no client data" rule of
-- 1756300000000_role_separation at the firm's request:
--
-- * Every permission is given to the `admin` role, and a permission added
--   later reaches it too (trigger), so the administrator never falls behind.
-- * hsdg.ctx_is_business_firmwide() is true for an administrator as well as
--   the Managing Partner. Every client and engagement policy, and the helper
--   chain under is_engagement_lead, follows from it.
-- * The checks that named the Managing Partner alone (people reads, pay
--   approval, internal due dates, five policies) take the administrator too,
--   and the refusals say so.
--
-- An administrator is anyone whose effective role is admin or who holds the
-- `admin` role among others (ctx_has_role), so a Managing Partner + admin is both.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.roles NO FORCE ROW LEVEL SECURITY;

INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r CROSS JOIN hsdg.permissions p
 WHERE r.slug = 'admin'
ON CONFLICT DO NOTHING;

ALTER TABLE hsdg.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions FORCE ROW LEVEL SECURITY;

-- Runs as the migrator (definer) because the inserting migration may not hold
-- RLS rights on role_permissions.
CREATE FUNCTION hsdg.permission_to_admin() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  INSERT INTO hsdg.role_permissions (role_id, permission_id)
  SELECT r.id, NEW.id FROM hsdg.roles r WHERE r.slug = 'admin'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER permissions_to_admin
  AFTER INSERT ON hsdg.permissions
  FOR EACH ROW EXECUTE FUNCTION hsdg.permission_to_admin();

CREATE OR REPLACE FUNCTION hsdg.ctx_is_business_firmwide() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_role() IN ('managing_partner', 'admin') OR hsdg.ctx_has_role('admin')
$$;
COMMENT ON FUNCTION hsdg.ctx_is_business_firmwide() IS
  'Business firm-wide authority (the Managing Partner and the administrator): all client and engagement data.';

CREATE OR REPLACE FUNCTION hsdg.ctx_reads_people() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_people_ops() OR hsdg.ctx_role() IN ('managing_partner', 'admin')
      OR hsdg.ctx_has_role('admin')
$$;

CREATE OR REPLACE FUNCTION hsdg.ctx_may_approve_pay() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_has_role('managing_partner') OR hsdg.ctx_has_role('admin')
      OR hsdg.ctx_role() = 'admin'
      OR EXISTS (SELECT 1 FROM hsdg.payroll_approvers a WHERE a.user_id = hsdg.ctx_user_id());
$$;

-- The refusals behind those checks name the administrator too, and the
-- internal due dates take them. Each function is rewritten from its current
-- definition, one exact phrase at a time; a phrase that is not there stops the
-- migration rather than leaving a refusal that names the wrong people.
DO $$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('employee_history', 'Only HR or the Managing Partner', 'Only HR, the Managing Partner or an administrator'),
      ('leaver_reassign_partners', 'Only HR or the Managing Partner', 'Only HR, the Managing Partner or an administrator'),
      ('people_login_flags', 'Only HR or the Managing Partner', 'Only HR, the Managing Partner or an administrator'),
      ('people_workload', 'Only HR or the Managing Partner', 'Only HR, the Managing Partner or an administrator'),
      ('payroll_run_guard', 'Only the Managing Partner or the named alternate', 'Only the Managing Partner, an administrator or the named alternate'),
      ('salary_structure_guard', 'Only the Managing Partner or the named alternate', 'Only the Managing Partner, an administrator or the named alternate'),
      ('exit_settlement_guard', 'Only the Managing Partner or the named alternate', 'Only the Managing Partner, an administrator or the named alternate'),
      ('set_internal_due_days', 'NOT IN (''managing_partner'', ''partner'')', 'NOT IN (''managing_partner'', ''partner'', ''admin'')'),
      ('set_internal_due_days', 'Only a partner may', 'Only a partner or an administrator may')
    ) AS t(fn, old_text, new_text)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'hsdg' AND p.proname = r.fn;
    IF def IS NULL OR position(r.old_text IN def) = 0 THEN
      RAISE EXCEPTION 'hsdg.%: "%" not found', r.fn, r.old_text;
    END IF;
    EXECUTE replace(def, r.old_text, r.new_text);
  END LOOP;
END $$;

-- Policies that named the Managing Partner alone get an administrator
-- companion (permissive, so OR-ed with the original). Sub-select form: the
-- check runs once a query, not once a row.
CREATE POLICY credential_access_log_select_admin ON hsdg.credential_access_log
  FOR SELECT TO hsdg_app USING ((SELECT hsdg.ctx_has_role('admin')));
CREATE POLICY payroll_approvers_admin ON hsdg.payroll_approvers
  FOR ALL TO hsdg_app
  USING ((SELECT hsdg.ctx_has_role('admin'))) WITH CHECK ((SELECT hsdg.ctx_has_role('admin')));
CREATE POLICY statutory_payments_admin ON hsdg.statutory_payments
  FOR ALL TO hsdg_app
  USING ((SELECT hsdg.ctx_has_role('admin'))) WITH CHECK ((SELECT hsdg.ctx_has_role('admin')));
CREATE POLICY workflow_baselines_insert_admin ON hsdg.workflow_baselines
  FOR INSERT WITH CHECK (saved_by_user_id = (SELECT hsdg.ctx_user_id())
                         AND (SELECT hsdg.ctx_has_role('admin')));
CREATE POLICY workflow_measure_targets_update_admin ON hsdg.workflow_measure_targets
  FOR UPDATE USING ((SELECT hsdg.ctx_has_role('admin')))
  WITH CHECK ((SELECT hsdg.ctx_has_role('admin')));

-- Down Migration

DROP POLICY IF EXISTS workflow_measure_targets_update_admin ON hsdg.workflow_measure_targets;
DROP POLICY IF EXISTS workflow_baselines_insert_admin ON hsdg.workflow_baselines;
DROP POLICY IF EXISTS statutory_payments_admin ON hsdg.statutory_payments;
DROP POLICY IF EXISTS payroll_approvers_admin ON hsdg.payroll_approvers;
DROP POLICY IF EXISTS credential_access_log_select_admin ON hsdg.credential_access_log;

DO $$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('employee_history', 'Only HR, the Managing Partner or an administrator', 'Only HR or the Managing Partner'),
      ('leaver_reassign_partners', 'Only HR, the Managing Partner or an administrator', 'Only HR or the Managing Partner'),
      ('people_login_flags', 'Only HR, the Managing Partner or an administrator', 'Only HR or the Managing Partner'),
      ('people_workload', 'Only HR, the Managing Partner or an administrator', 'Only HR or the Managing Partner'),
      ('payroll_run_guard', 'Only the Managing Partner, an administrator or the named alternate', 'Only the Managing Partner or the named alternate'),
      ('salary_structure_guard', 'Only the Managing Partner, an administrator or the named alternate', 'Only the Managing Partner or the named alternate'),
      ('exit_settlement_guard', 'Only the Managing Partner, an administrator or the named alternate', 'Only the Managing Partner or the named alternate'),
      ('set_internal_due_days', 'NOT IN (''managing_partner'', ''partner'', ''admin'')', 'NOT IN (''managing_partner'', ''partner'')'),
      ('set_internal_due_days', 'Only a partner or an administrator may', 'Only a partner may')
    ) AS t(fn, old_text, new_text)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'hsdg' AND p.proname = r.fn;
    EXECUTE replace(def, r.old_text, r.new_text);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION hsdg.ctx_may_approve_pay() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_has_role('managing_partner')
      OR EXISTS (SELECT 1 FROM hsdg.payroll_approvers a WHERE a.user_id = hsdg.ctx_user_id());
$$;

CREATE OR REPLACE FUNCTION hsdg.ctx_reads_people() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_people_ops() OR hsdg.ctx_role() = 'managing_partner'
$$;

CREATE OR REPLACE FUNCTION hsdg.ctx_is_business_firmwide() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_role() = 'managing_partner'
$$;
COMMENT ON FUNCTION hsdg.ctx_is_business_firmwide() IS
  'Business firm-wide authority (managing_partner only): all client and engagement data. Platform admin is intentionally excluded.';

DROP TRIGGER IF EXISTS permissions_to_admin ON hsdg.permissions;
DROP FUNCTION IF EXISTS hsdg.permission_to_admin();

-- The permissions the administrator held before: those given by name in
-- earlier migrations cannot be told apart from these, so the Down leaves the
-- grants in place (they are only reachable through the API's permission checks,
-- which the code at that version did not offer the administrator).
