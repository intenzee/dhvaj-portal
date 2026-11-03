-- ─────────────────────────────────────────────────────────────────────────
-- People: the partner picker, moving someone's work, deleting permanently
-- (B-2, B-3)
--
-- * hsdg.main_role(user): the one role that says what someone does — the
--   highest of Managing Partner, administrator, Partner, Manager, Senior and
--   Article they hold, in the security context's order. Grade
--   (employees.grade) stays a separate field.
-- * The Engagement Partner / Manager pickers (engagement_lead_candidates) list
--   active people only, and a partner-grade person only when their main role
--   is Partner or Managing Partner: an Article graded Partner by mistake is
--   not offered as an Engagement Partner.
-- * task_assignments: who moved a task from whom to whom, when and why (the
--   Phase 2 shape), and tasks.assigned_by_employee_id. Append-only.
-- * employees.former_name / deleted_at, and hsdg.erase_person: an
--   administrator deletes someone permanently. With no work history the record
--   and login go outright. With history the login, bank, PAN, salary, tax and
--   HR documents go; the record stays as "Name (former employee)" so every past
--   task, filing and sign-off still names them and no foreign key breaks.
--   hsdg.person_delete_check reports the blockers (open tasks, engagements they
--   lead, unpaid pay) and whether history exists; erase_person refuses while
--   any blocker stands.
--
-- erase_person runs as the owner. Most tables are FORCE RLS, so, as in
-- 1773000200000_purge_engagement, every RLS table gets a migrator-only policy
-- live only while hsdg.erasing_person = 'on', which the function sets after
-- checking the caller is an administrator and clears before returning.
--
-- Deleting the users row sets its references elsewhere to NULL, and that
-- update meets the payroll, tax and HR-document guards. Each guard lets
-- through an update whose only change is a reference to the login being
-- erased going to NULL (hsdg.erasing_login_refs) — checked against the login
-- named in hsdg.erasing_user really being gone, so it cannot be used to blank
-- the name of someone still here. Paid payroll lines lose their copy of the
-- bank account the same way (payroll_line_guard), only for an erased person.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── The partner picker ────────────────────────────────────────────────────

CREATE FUNCTION hsdg.main_role(p_user uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT r.slug FROM hsdg.user_roles ur JOIN hsdg.roles r ON r.id = ur.role_id
   WHERE ur.user_id = p_user
     AND r.slug IN ('managing_partner', 'admin', 'partner', 'manager', 'senior', 'article')
   ORDER BY array_position(
     ARRAY['managing_partner', 'admin', 'partner', 'manager', 'senior', 'article'], r.slug)
   LIMIT 1
$$;
COMMENT ON FUNCTION hsdg.main_role(uuid) IS
  'The one role that says what someone does: the highest professional role held (B-2).';

ALTER TABLE hsdg.employees
  ADD COLUMN former_name text,
  ADD COLUMN deleted_at timestamptz;
COMMENT ON COLUMN hsdg.employees.former_name IS
  'The name before a permanent delete; full_name then reads "Name (former employee)".';
COMMENT ON COLUMN hsdg.employees.deleted_at IS
  'Set when an administrator deleted the person permanently but past work names them.';

CREATE OR REPLACE FUNCTION hsdg.engagement_lead_candidates()
 RETURNS TABLE(id uuid, full_name text, grade_slug text, grade_name text, is_partner_grade boolean, office_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT e.id, e.full_name, g.slug, g.name, g.is_partner_grade, o.code
  FROM hsdg.employees e
  JOIN hsdg.grades g ON g.id = e.grade_id
  JOIN hsdg.offices o ON o.id = e.primary_office_id
  WHERE hsdg.ctx_role() IS NOT NULL
    AND e.employment_status = 'active'
    AND e.deleted_at IS NULL
    -- A deactivated login (a leaver, or a trial account) takes them off the list.
    AND NOT EXISTS (SELECT 1 FROM hsdg.users u WHERE u.id = e.user_id AND NOT u.is_active)
    AND g.rank >= (SELECT rank FROM hsdg.grades WHERE slug = 'manager')
    -- A partner by grade leads only when their main role is a partner's too.
    AND (NOT g.is_partner_grade
         OR hsdg.main_role(e.user_id) IN ('partner', 'managing_partner'))
  ORDER BY g.rank DESC, e.full_name
$function$;

-- ── Moving work ───────────────────────────────────────────────────────────

ALTER TABLE hsdg.tasks
  ADD COLUMN assigned_by_employee_id uuid REFERENCES hsdg.employees(id) ON DELETE SET NULL;

CREATE TABLE hsdg.task_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid NOT NULL REFERENCES hsdg.tasks(id) ON DELETE CASCADE,
  -- 'assignee': who does it; 'reviewer': who reviews it.
  kind             text NOT NULL DEFAULT 'assignee' CHECK (kind IN ('assignee', 'reviewer')),
  from_employee_id uuid REFERENCES hsdg.employees(id) ON DELETE SET NULL,
  to_employee_id   uuid REFERENCES hsdg.employees(id) ON DELETE SET NULL,
  by_employee_id   uuid REFERENCES hsdg.employees(id) ON DELETE SET NULL,
  at               timestamptz NOT NULL DEFAULT now(),
  reason           text CHECK (reason IS NULL OR length(btrim(reason)) > 0)
);
CREATE INDEX task_assignments_task_idx ON hsdg.task_assignments (task_id, at DESC);
CREATE INDEX task_assignments_from_idx ON hsdg.task_assignments (from_employee_id);
CREATE INDEX task_assignments_to_idx ON hsdg.task_assignments (to_employee_id);

-- History: written once, never changed.
REVOKE UPDATE, DELETE ON hsdg.task_assignments FROM hsdg_app;
ALTER TABLE hsdg.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.task_assignments FORCE ROW LEVEL SECURITY;
-- Whoever sees the task sees how it moved (tasks' own RLS decides).
CREATE POLICY task_assignments_select ON hsdg.task_assignments FOR SELECT
  USING (EXISTS (SELECT 1 FROM hsdg.tasks t WHERE t.id = task_id));
CREATE POLICY task_assignments_insert ON hsdg.task_assignments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.tasks t WHERE t.id = task_id));

-- ── Deleting permanently ─────────────────────────────────────────────────

-- A baseline's author stays a foreign key like every other "by": the delete
-- blanks it rather than being refused by it.
ALTER TABLE hsdg.workflow_baselines ALTER COLUMN saved_by_user_id DROP NOT NULL;
ALTER TABLE hsdg.workflow_baselines DROP CONSTRAINT workflow_baselines_saved_by_user_id_fkey;
ALTER TABLE hsdg.workflow_baselines ADD CONSTRAINT workflow_baselines_saved_by_user_id_fkey
  FOREIGN KEY (saved_by_user_id) REFERENCES hsdg.users(id) ON DELETE SET NULL;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'hsdg'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  LOOP
    EXECUTE format(
      'CREATE POLICY erase_person ON hsdg.%I TO hsdg_migrator '
      'USING (current_setting(''hsdg.erasing_person'', true) = ''on'') '
      'WITH CHECK (current_setting(''hsdg.erasing_person'', true) = ''on'')', t);
  END LOOP;
END $$;

-- The login being erased is visible to the owner only by name, so the check
-- below can tell "gone" from "not visible".
CREATE POLICY users_erasing_check ON hsdg.users FOR SELECT TO hsdg_migrator
  USING (id::text = current_setting('hsdg.erasing_user', true));

-- True when every column that changed went from the login being erased to
-- NULL, and that login no longer exists: the foreign keys' own SET NULL.
CREATE FUNCTION hsdg.erasing_login_refs(p_old jsonb, p_new jsonb) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT COALESCE(current_setting('hsdg.erasing_user', true), '') <> ''
     AND NOT EXISTS (SELECT 1 FROM hsdg.users u
                      WHERE u.id::text = current_setting('hsdg.erasing_user', true))
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p_new) n JOIN jsonb_each(p_old) o USING (key)
        WHERE n.value IS DISTINCT FROM o.value
          AND NOT (n.value = 'null'::jsonb
                   AND o.value = to_jsonb(current_setting('hsdg.erasing_user', true))))
$$;

DO $$
DECLARE
  fn text;
  def text;
  fixed text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['salary_structure_guard', 'bank_change_guard', 'payroll_run_guard',
                            'payroll_input_guard', 'tax_declaration_guard', 'tax_proof_guard',
                            'exit_settlement_guard', 'hr_documents_immutable']
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p WHERE p.pronamespace = 'hsdg'::regnamespace AND p.proname = fn;
    fixed := regexp_replace(def, E'\nBEGIN\n',
      E'\nBEGIN\n  -- erase_person: a login''s references going to NULL as it is deleted.\n'
      || E'  IF TG_OP = ''UPDATE'' AND hsdg.erasing_login_refs(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;\n');
    IF def IS NULL OR fixed = def THEN
      RAISE EXCEPTION 'hsdg.%: no BEGIN line to guard', fn;
    END IF;
    EXECUTE fixed;
  END LOOP;
END $$;

-- An erased person's paid lines keep their amounts (the books) but not the
-- bank account copied onto them.
CREATE OR REPLACE FUNCTION hsdg.payroll_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
DECLARE
  st text;
  release text[] := ARRAY['released_at', 'paid_at', 'bank_reference'];
  bank text[] := ARRAY['account_holder', 'account_ciphertext', 'account_iv', 'account_auth_tag',
                       'account_key_version', 'account_last4', 'ifsc'];
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('hsdg.erasing_person', true) = 'on'
     AND EXISTS (SELECT 1 FROM hsdg.employees e WHERE e.id = NEW.employee_id AND e.deleted_at IS NOT NULL)
     AND (to_jsonb(NEW) - bank) IS NOT DISTINCT FROM (to_jsonb(OLD) - bank)
     AND NEW.account_ciphertext IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.status INTO st FROM hsdg.payroll_runs r
   WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  IF st IS NULL THEN
    -- The run is being deleted with its lines (ON DELETE CASCADE).
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF st IN ('draft', 'computed') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND st = 'paid' AND OLD.released_at IS NULL
     AND (to_jsonb(NEW) - release) IS NOT DISTINCT FROM (to_jsonb(OLD) - release) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The run is %; its lines cannot be changed.', st USING ERRCODE = '22023';
END;
$function$;

-- Whether past work names the person: any row pointing at them, other than
-- their own personal records (which a delete removes), client-team
-- membership, review grants and people reporting to them.
CREATE FUNCTION hsdg.employee_has_history(p_employee uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  r record;
  hit boolean;
BEGIN
  IF current_setting('hsdg.erasing_person', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'employee_has_history is for erase_person and person_delete_check.'
      USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'hsdg.employees'::regclass
       AND c.conrelid::regclass::text NOT IN (
         'hsdg.employees', 'hsdg.partner_profiles', 'hsdg.employee_pay_details',
         'hsdg.bank_change_requests', 'hsdg.hr_documents', 'hsdg.tax_declarations',
         'hsdg.tax_proofs', 'hsdg.salary_structures', 'hsdg.payroll_inputs',
         'hsdg.team_members', 'hsdg.audit_area_review_permission')
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', r.tbl, r.col)
      INTO hit USING p_employee;
    IF hit THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

-- What stands in the way of deleting someone, and whether history exists.
CREATE FUNCTION hsdg.person_delete_check(p_employee uuid)
  RETURNS TABLE (open_tasks integer, led_engagements integer, unpaid_payroll integer, has_history boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator can delete a person permanently.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('hsdg.erasing_person', 'on', true);
  RETURN QUERY SELECT
    (SELECT count(*)::int FROM tasks t
      WHERE (t.assigned_to_employee_id = p_employee OR t.reviewer_employee_id = p_employee)
        AND t.status NOT IN ('done', 'cancelled')),
    (SELECT count(*)::int FROM engagements e
      WHERE (e.engagement_partner_id = p_employee OR e.engagement_manager_id = p_employee)
        AND e.status NOT IN ('completed', 'closed', 'declined', 'withdrawn', 'cancelled', 'merged')),
    (SELECT count(*)::int FROM payroll_lines l JOIN payroll_runs pr ON pr.id = l.run_id
      WHERE l.employee_id = p_employee AND pr.status NOT IN ('paid', 'locked'))
    + (SELECT count(*)::int FROM exit_settlements x
        LEFT JOIN payroll_runs pr ON pr.id = x.run_id
       WHERE x.employee_id = p_employee
         AND (x.status <> 'approved' OR pr.status IS NULL OR pr.status NOT IN ('paid', 'locked'))),
    hsdg.employee_has_history(p_employee);
  PERFORM set_config('hsdg.erasing_person', '', true);
END $$;

CREATE FUNCTION hsdg.erase_person(p_employee uuid)
  RETURNS TABLE (outcome text, storage_refs text[])
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  e        employees%ROWTYPE;
  chk      record;
  history  boolean;
  refs     text[];
  result   text;
BEGIN
  IF NOT hsdg.ctx_has_role('admin') THEN
    RAISE EXCEPTION 'Only an administrator can delete a person permanently.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO chk FROM hsdg.person_delete_check(p_employee);
  IF chk.open_tasks > 0 OR chk.led_engagements > 0 OR chk.unpaid_payroll > 0 THEN
    RAISE EXCEPTION 'Clear what stands in the way first: % open task(s), % engagement(s) they lead, % unpaid pay item(s).',
      chk.open_tasks, chk.led_engagements, chk.unpaid_payroll
      USING ERRCODE = '55000';
  END IF;
  history := chk.has_history;

  PERFORM set_config('hsdg.erasing_person', 'on', true);
  -- Nothing here is undoable: keep the undo log out of it.
  PERFORM set_config('hsdg.change_set', '', true);

  SELECT * INTO e FROM employees WHERE id = p_employee AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('hsdg.erasing_person', '', true);
    RETURN;
  END IF;

  SELECT array_agg(d.storage_reference) INTO refs FROM hr_documents d WHERE d.employee_id = p_employee;

  -- Personal records, whichever way it goes.
  DELETE FROM tax_proofs WHERE employee_id = p_employee;
  DELETE FROM tax_declarations WHERE employee_id = p_employee;
  DELETE FROM bank_change_requests WHERE employee_id = p_employee;
  DELETE FROM employee_pay_details WHERE employee_id = p_employee;
  DELETE FROM hr_documents WHERE employee_id = p_employee;
  -- A salary structure a paid line was worked out from stays with that line.
  DELETE FROM salary_structures s
   WHERE s.employee_id = p_employee
     AND NOT EXISTS (SELECT 1 FROM payroll_lines l WHERE l.structure_id = s.id);

  IF history THEN
    UPDATE employees
       SET former_name = full_name,
           full_name = full_name || ' (former employee)',
           deleted_at = now(),
           user_id = NULL,
           reports_to_id = NULL,
           employment_status = 'exited',
           date_of_exit = COALESCE(date_of_exit, GREATEST(current_date, date_of_joining)),
           version = version + 1
     WHERE id = p_employee;
    UPDATE employees SET reports_to_id = NULL WHERE reports_to_id = p_employee;
    UPDATE payroll_lines
       SET account_holder = NULL, account_ciphertext = NULL, account_iv = NULL,
           account_auth_tag = NULL, account_key_version = NULL, account_last4 = NULL, ifsc = NULL
     WHERE employee_id = p_employee AND account_ciphertext IS NOT NULL;
    result := 'erased';
  ELSE
    DELETE FROM employees WHERE id = p_employee;
    result := 'removed';
  END IF;

  IF e.user_id IS NOT NULL THEN
    PERFORM set_config('hsdg.erasing_user', e.user_id::text, true);
    DELETE FROM users WHERE id = e.user_id;
    PERFORM set_config('hsdg.erasing_user', '', true);
  END IF;

  PERFORM set_config('hsdg.erasing_person', '', true);
  RETURN QUERY SELECT result, COALESCE(refs, '{}'::text[]);
END $$;

REVOKE ALL ON FUNCTION hsdg.employee_has_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.main_role(uuid) TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.person_delete_check(uuid) TO hsdg_app;
GRANT EXECUTE ON FUNCTION hsdg.erase_person(uuid) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.erase_person(uuid);
DROP FUNCTION IF EXISTS hsdg.person_delete_check(uuid);
DROP FUNCTION IF EXISTS hsdg.employee_has_history(uuid);

CREATE OR REPLACE FUNCTION hsdg.payroll_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
DECLARE
  st text;
  release text[] := ARRAY['released_at', 'paid_at', 'bank_reference'];
BEGIN
  SELECT r.status INTO st FROM hsdg.payroll_runs r
   WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  IF st IS NULL THEN
    -- The run is being deleted with its lines (ON DELETE CASCADE).
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF st IN ('draft', 'computed') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND st = 'paid' AND OLD.released_at IS NULL
     AND (to_jsonb(NEW) - release) IS NOT DISTINCT FROM (to_jsonb(OLD) - release) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The run is %; its lines cannot be changed.', st USING ERRCODE = '22023';
END;
$function$;

DO $$
DECLARE
  fn text;
  def text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['salary_structure_guard', 'bank_change_guard', 'payroll_run_guard',
                            'payroll_input_guard', 'tax_declaration_guard', 'tax_proof_guard',
                            'exit_settlement_guard', 'hr_documents_immutable']
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p WHERE p.pronamespace = 'hsdg'::regnamespace AND p.proname = fn;
    EXECUTE replace(replace(def,
      E'  -- erase_person: a login''s references going to NULL as it is deleted.\n', ''),
      E'  IF TG_OP = ''UPDATE'' AND hsdg.erasing_login_refs(to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF;\n', '');
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS hsdg.erasing_login_refs(jsonb, jsonb);
DROP POLICY IF EXISTS users_erasing_check ON hsdg.users;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_policy p ON p.polrelid = c.oid
     WHERE c.relnamespace = 'hsdg'::regnamespace AND p.polname = 'erase_person'
  LOOP
    EXECUTE format('DROP POLICY erase_person ON hsdg.%I', t);
  END LOOP;
END $$;

-- Baselines whose author was deleted cannot take the NOT NULL back.
DELETE FROM hsdg.workflow_baselines WHERE saved_by_user_id IS NULL;
ALTER TABLE hsdg.workflow_baselines DROP CONSTRAINT workflow_baselines_saved_by_user_id_fkey;
ALTER TABLE hsdg.workflow_baselines ADD CONSTRAINT workflow_baselines_saved_by_user_id_fkey
  FOREIGN KEY (saved_by_user_id) REFERENCES hsdg.users(id);
ALTER TABLE hsdg.workflow_baselines ALTER COLUMN saved_by_user_id SET NOT NULL;

DROP TABLE IF EXISTS hsdg.task_assignments;
ALTER TABLE hsdg.tasks DROP COLUMN IF EXISTS assigned_by_employee_id;

CREATE OR REPLACE FUNCTION hsdg.engagement_lead_candidates()
 RETURNS TABLE(id uuid, full_name text, grade_slug text, grade_name text, is_partner_grade boolean, office_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hsdg', 'pg_temp'
AS $function$
  SELECT e.id, e.full_name, g.slug, g.name, g.is_partner_grade, o.code
  FROM hsdg.employees e
  JOIN hsdg.grades g ON g.id = e.grade_id
  JOIN hsdg.offices o ON o.id = e.primary_office_id
  WHERE hsdg.ctx_role() IS NOT NULL
    AND e.employment_status <> 'exited'
    -- A deactivated login (a leaver, or a trial account) takes them off the list.
    AND NOT EXISTS (SELECT 1 FROM hsdg.users u WHERE u.id = e.user_id AND NOT u.is_active)
    AND g.rank >= (SELECT rank FROM hsdg.grades WHERE slug = 'manager')
  ORDER BY g.rank DESC, e.full_name
$function$;

ALTER TABLE hsdg.employees DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS former_name;
DROP FUNCTION IF EXISTS hsdg.main_role(uuid);
