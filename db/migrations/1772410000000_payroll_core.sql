-- ─────────────────────────────────────────────────────────────────────────
-- Payroll core — phase 2a (docs/accountant-hr-roles-spec.md §4.8, §7.6).
--
-- HR prepares the month; the Managing Partner (or the one alternate) approves;
-- HR enters the bank reference once the transfer is made; payslips are then
-- released. The Accountant reads run totals only, and records the statutory
-- challans. The portal never moves money.
--
-- Who sees pay: HR, the approvers and the person themself — never the
-- Administrator, though firm-wide (ctx_can_see_pay is not ctx_is_firmwide).
-- The run's rules live here, not only in the API: transitions, preparer ≠
-- approver, and a paid run frozen even to direct SQL as hsdg_app.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Who approves, who sees ───────────────────────────────────────────────
-- The Managing Partner approves; one alternate may be named (decision 9.10).
CREATE TABLE hsdg.payroll_approvers (
  user_id            uuid PRIMARY KEY REFERENCES hsdg.users (id) ON DELETE CASCADE,
  added_by_user_id   uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION hsdg.ctx_may_approve_pay() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_has_role('managing_partner')
      OR EXISTS (SELECT 1 FROM hsdg.payroll_approvers a WHERE a.user_id = hsdg.ctx_user_id());
$$;
REVOKE ALL ON FUNCTION hsdg.ctx_may_approve_pay() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_may_approve_pay() TO hsdg_app;

-- The only predicate on pay tables (§7.6).
CREATE OR REPLACE FUNCTION hsdg.ctx_can_see_pay() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_people_ops() OR hsdg.ctx_may_approve_pay();
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_can_see_pay() TO hsdg_app;

ALTER TABLE hsdg.payroll_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.payroll_approvers FORCE  ROW LEVEL SECURITY;
CREATE POLICY payroll_approvers_read ON hsdg.payroll_approvers
  FOR SELECT TO hsdg_app USING (hsdg.ctx_can_see_pay());
CREATE POLICY payroll_approvers_mp ON hsdg.payroll_approvers
  FOR ALL TO hsdg_app USING (hsdg.ctx_has_role('managing_partner'))
  WITH CHECK (hsdg.ctx_has_role('managing_partner'));
CREATE POLICY payroll_approvers_owner ON hsdg.payroll_approvers
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON hsdg.payroll_approvers TO hsdg_app;

-- ── Statutory settings, dated ────────────────────────────────────────────
-- `rules` is the engine's PaySettings plus ptSlabsByOffice and
-- stipendMinimumByOffice (office code → value). HR confirms them each April.
CREATE TABLE hsdg.pay_settings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from       date NOT NULL UNIQUE,
  rules                jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  confirmed_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hsdg.pay_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.pay_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY pay_settings_read ON hsdg.pay_settings
  FOR SELECT TO hsdg_app USING (hsdg.ctx_can_see_pay() OR hsdg.ctx_is_finance());
CREATE POLICY pay_settings_write ON hsdg.pay_settings
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.ctx_can_see_pay());
CREATE POLICY pay_settings_owner ON hsdg.pay_settings
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.pay_settings TO hsdg_app;

-- ── Salary structures (effective-dated; approved by someone else) ────────
CREATE TABLE hsdg.salary_structures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  effective_from      date NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('salary', 'stipend')),
  ctc                 numeric(14,2) NOT NULL CHECK (ctc >= 0),
  components          jsonb NOT NULL CHECK (jsonb_typeof(components) = 'array'
                                            AND jsonb_array_length(components) > 0),
  pf_applicable       boolean NOT NULL DEFAULT true,
  esi_applicable      boolean NOT NULL DEFAULT true,
  pt_applicable       boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed', 'approved', 'rejected')),
  note                text CHECK (length(note) <= 500),
  proposed_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  approved_at         timestamptz,
  decision_note       text CHECK (length(decision_note) <= 500),
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- One approved structure per person per date.
CREATE UNIQUE INDEX salary_structures_one_approved
  ON hsdg.salary_structures (employee_id, effective_from) WHERE status = 'approved';
CREATE INDEX salary_structures_employee_idx ON hsdg.salary_structures (employee_id, effective_from);
CREATE TRIGGER salary_structures_set_updated_at BEFORE UPDATE ON hsdg.salary_structures
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE OR REPLACE FUNCTION hsdg.salary_structure_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'proposed';
    NEW.proposed_by_user_id := hsdg.ctx_user_id();
    NEW.approved_by_user_id := NULL;
    NEW.approved_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'This structure is already %; propose a revision instead.', OLD.status
      USING ERRCODE = '22023';
  END IF;
  IF NEW.status IN ('approved', 'rejected') THEN
    IF NOT hsdg.ctx_may_approve_pay() THEN
      RAISE EXCEPTION 'Only the Managing Partner or the named alternate approves pay.'
        USING ERRCODE = '42501';
    END IF;
    IF hsdg.ctx_user_id() IS NOT DISTINCT FROM OLD.proposed_by_user_id THEN
      RAISE EXCEPTION 'Someone other than the proposer must approve it.' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by_user_id := hsdg.ctx_user_id();
    NEW.approved_at := now();
  ELSIF NEW.status <> 'proposed' THEN
    RAISE EXCEPTION 'Not a structure status: %', NEW.status USING ERRCODE = '22023';
  ELSE
    -- A proposal is edited by the people who prepare pay; the proposer is who last changed it.
    NEW.proposed_by_user_id := hsdg.ctx_user_id();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER salary_structures_guard BEFORE INSERT OR UPDATE ON hsdg.salary_structures
  FOR EACH ROW EXECUTE FUNCTION hsdg.salary_structure_guard();

ALTER TABLE hsdg.salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.salary_structures FORCE  ROW LEVEL SECURITY;
CREATE POLICY salary_structures_pay ON hsdg.salary_structures
  TO hsdg_app USING (hsdg.ctx_can_see_pay()) WITH CHECK (hsdg.ctx_can_see_pay());
CREATE POLICY salary_structures_own ON hsdg.salary_structures
  FOR SELECT TO hsdg_app
  USING (status = 'approved' AND employee_id = hsdg.ctx_employee_id());
CREATE POLICY salary_structures_owner ON hsdg.salary_structures
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.salary_structures TO hsdg_app;

-- ── Bank and statutory numbers ───────────────────────────────────────────
-- Account and PAN sealed with the credential key (ADR-0035), bound to the row.
CREATE TABLE hsdg.employee_pay_details (
  employee_id         uuid PRIMARY KEY REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  account_holder      text CHECK (length(btrim(account_holder)) BETWEEN 1 AND 200),
  account_ciphertext  bytea,
  account_iv          bytea,
  account_auth_tag    bytea,
  account_key_version integer,
  account_last4       text CHECK (account_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  ifsc                text CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name           text CHECK (length(bank_name) <= 120),
  pan_ciphertext      bytea,
  pan_iv              bytea,
  pan_auth_tag        bytea,
  pan_key_version     integer,
  pan_last4           text CHECK (pan_last4 ~ '^[0-9A-Z]{4}$'),
  uan                 text CHECK (uan ~ '^[0-9]{12}$'),
  esi_number          text CHECK (esi_number ~ '^[0-9]{10,17}$'),
  aadhaar_last4       text CHECK (aadhaar_last4 ~ '^[0-9]{4}$'),
  -- When the account last changed: the run flags it for the approver.
  bank_changed_at     timestamptz,
  updated_by_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_pay_details_account_sealed CHECK (
    (account_ciphertext IS NULL) = (account_iv IS NULL)
    AND (account_ciphertext IS NULL) = (account_auth_tag IS NULL)),
  CONSTRAINT employee_pay_details_pan_sealed CHECK (
    (pan_ciphertext IS NULL) = (pan_iv IS NULL) AND (pan_ciphertext IS NULL) = (pan_auth_tag IS NULL))
);
CREATE TRIGGER employee_pay_details_set_updated_at BEFORE UPDATE ON hsdg.employee_pay_details
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();
ALTER TABLE hsdg.employee_pay_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.employee_pay_details FORCE  ROW LEVEL SECURITY;
-- Writes are HR's; an approver reads them.
CREATE POLICY employee_pay_details_read ON hsdg.employee_pay_details
  FOR SELECT TO hsdg_app
  USING (hsdg.ctx_can_see_pay() OR employee_id = hsdg.ctx_employee_id());
CREATE POLICY employee_pay_details_hr ON hsdg.employee_pay_details
  TO hsdg_app USING (hsdg.ctx_is_people_ops()) WITH CHECK (hsdg.ctx_is_people_ops());
CREATE POLICY employee_pay_details_owner ON hsdg.employee_pay_details
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.employee_pay_details TO hsdg_app;

-- A person asks to change where salary goes; HR (not the person) verifies it.
CREATE TABLE hsdg.bank_change_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  account_holder      text NOT NULL CHECK (length(btrim(account_holder)) BETWEEN 1 AND 200),
  account_ciphertext  bytea NOT NULL,
  account_iv          bytea NOT NULL,
  account_auth_tag    bytea NOT NULL,
  account_key_version integer NOT NULL,
  account_last4       text NOT NULL,
  ifsc                text NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name           text CHECK (length(bank_name) <= 120),
  status              text NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'verified', 'rejected')),
  requested_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  decided_by_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  decided_at          timestamptz,
  reason              text CHECK (length(reason) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bank_change_requests_one_open
  ON hsdg.bank_change_requests (employee_id) WHERE status = 'requested';

CREATE OR REPLACE FUNCTION hsdg.bank_change_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'requested';
    NEW.requested_by_user_id := hsdg.ctx_user_id();
    NEW.decided_by_user_id := NULL;
    NEW.decided_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'requested' OR NEW.status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'This request is already %.', OLD.status USING ERRCODE = '22023';
  END IF;
  IF hsdg.ctx_user_id() IS NOT DISTINCT FROM OLD.requested_by_user_id
     OR EXISTS (SELECT 1 FROM hsdg.employees e
                 WHERE e.id = OLD.employee_id AND e.user_id = hsdg.ctx_user_id()) THEN
    RAISE EXCEPTION 'Someone else must verify a change to your own bank account.'
      USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'decided_by_user_id', 'decided_at', 'reason'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'decided_by_user_id', 'decided_at', 'reason']) THEN
    RAISE EXCEPTION 'A request cannot be changed; reject it and ask again.' USING ERRCODE = '22023';
  END IF;
  NEW.decided_by_user_id := hsdg.ctx_user_id();
  NEW.decided_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER bank_change_requests_guard BEFORE INSERT OR UPDATE ON hsdg.bank_change_requests
  FOR EACH ROW EXECUTE FUNCTION hsdg.bank_change_guard();

ALTER TABLE hsdg.bank_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.bank_change_requests FORCE  ROW LEVEL SECURITY;
CREATE POLICY bank_change_requests_hr ON hsdg.bank_change_requests
  TO hsdg_app USING (hsdg.ctx_is_people_ops()) WITH CHECK (hsdg.ctx_is_people_ops());
CREATE POLICY bank_change_requests_read ON hsdg.bank_change_requests
  FOR SELECT TO hsdg_app USING (hsdg.ctx_may_approve_pay());
CREATE POLICY bank_change_requests_own_read ON hsdg.bank_change_requests
  FOR SELECT TO hsdg_app USING (employee_id = hsdg.ctx_employee_id());
CREATE POLICY bank_change_requests_own_insert ON hsdg.bank_change_requests
  FOR INSERT TO hsdg_app WITH CHECK (employee_id = hsdg.ctx_employee_id());
CREATE POLICY bank_change_requests_owner ON hsdg.bank_change_requests
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.bank_change_requests TO hsdg_app;

-- ── Runs and lines ───────────────────────────────────────────────────────
CREATE TABLE hsdg.payroll_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month                date NOT NULL CHECK (extract(day FROM month) = 1),
  kind                 text NOT NULL CHECK (kind IN ('salary', 'stipend')),
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'computed', 'submitted', 'approved', 'paid', 'locked')),
  people               integer NOT NULL DEFAULT 0,
  gross                numeric(14,2) NOT NULL DEFAULT 0,
  reimbursements       numeric(14,2) NOT NULL DEFAULT 0,
  deductions           numeric(14,2) NOT NULL DEFAULT 0,
  employer_cost        numeric(14,2) NOT NULL DEFAULT 0,
  net                  numeric(14,2) NOT NULL DEFAULT 0,
  -- Totals by component: what the Accountant books from (no person in it).
  totals               jsonb NOT NULL DEFAULT '{}'::jsonb,
  prepared_by_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  computed_at          timestamptz,
  submitted_at         timestamptz,
  approved_by_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  approved_at          timestamptz,
  returned_reason      text CHECK (length(returned_reason) <= 500),
  bank_reference       text CHECK (length(btrim(bank_reference)) BETWEEN 1 AND 100),
  paid_at              timestamptz,
  payslips_released_at timestamptz,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_once UNIQUE (month, kind),
  CONSTRAINT payroll_runs_paid_has_reference CHECK (status NOT IN ('paid', 'locked') OR bank_reference IS NOT NULL)
);
CREATE TRIGGER payroll_runs_set_updated_at BEFORE UPDATE ON hsdg.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE OR REPLACE FUNCTION hsdg.payroll_run_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  allowed text[];
  frozen  text[] := ARRAY['status', 'version', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('draft', 'computed') THEN
      RAISE EXCEPTION 'A % run cannot be deleted.', OLD.status USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    NEW.prepared_by_user_id := hsdg.ctx_user_id();
    NEW.approved_by_user_id := NULL;
    NEW.approved_at := NULL;
    NEW.paid_at := NULL;
    NEW.payslips_released_at := NULL;
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'draft'     THEN ARRAY['draft', 'computed']
    WHEN 'computed'  THEN ARRAY['computed', 'submitted', 'draft']
    WHEN 'submitted' THEN ARRAY['submitted', 'approved', 'computed']
    WHEN 'approved'  THEN ARRAY['approved', 'paid']
    WHEN 'paid'      THEN ARRAY['paid', 'locked']
    ELSE ARRAY['locked'] END;
  IF NOT NEW.status = ANY (allowed) THEN
    RAISE EXCEPTION 'A % run cannot become %.', OLD.status, NEW.status USING ERRCODE = '22023';
  END IF;

  -- After submission the figures are fixed; only the step's own fields move.
  IF OLD.status IN ('submitted', 'approved', 'paid', 'locked') THEN
    frozen := frozen || CASE
      WHEN OLD.status = 'submitted' THEN
        ARRAY['approved_by_user_id', 'approved_at', 'returned_reason', 'submitted_at']
      WHEN OLD.status = 'approved' THEN ARRAY['bank_reference', 'paid_at']
      WHEN OLD.status = 'paid' THEN ARRAY['payslips_released_at']
      ELSE ARRAY[]::text[] END;
    IF (to_jsonb(NEW) - frozen) IS DISTINCT FROM (to_jsonb(OLD) - frozen) THEN
      RAISE EXCEPTION 'A % run cannot be changed; correct it in next month''s run.', OLD.status
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF OLD.status = 'paid' AND OLD.payslips_released_at IS NOT NULL
     AND NEW.payslips_released_at IS DISTINCT FROM OLD.payslips_released_at THEN
    RAISE EXCEPTION 'Payslips are already released.' USING ERRCODE = '22023';
  END IF;

  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('draft', 'computed') THEN
      NEW.prepared_by_user_id := hsdg.ctx_user_id();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'computed' AND OLD.status = 'draft' THEN
    NEW.prepared_by_user_id := hsdg.ctx_user_id();
    NEW.computed_at := now();
  ELSIF NEW.status = 'submitted' THEN
    IF NOT hsdg.ctx_is_people_ops() THEN
      RAISE EXCEPTION 'HR submits the run.' USING ERRCODE = '42501';
    END IF;
    NEW.submitted_at := now();
    NEW.returned_reason := NULL;
  ELSIF NEW.status = 'approved' OR (OLD.status = 'submitted' AND NEW.status = 'computed') THEN
    IF NOT hsdg.ctx_may_approve_pay() THEN
      RAISE EXCEPTION 'Only the Managing Partner or the named alternate approves a run.'
        USING ERRCODE = '42501';
    END IF;
    IF hsdg.ctx_user_id() IS NOT DISTINCT FROM OLD.prepared_by_user_id THEN
      RAISE EXCEPTION 'The person who prepared the run cannot approve it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'approved' THEN
      NEW.approved_by_user_id := hsdg.ctx_user_id();
      NEW.approved_at := now();
    ELSIF NEW.returned_reason IS NULL OR length(btrim(NEW.returned_reason)) = 0 THEN
      RAISE EXCEPTION 'Say why the run is sent back.' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.status = 'paid' THEN
    IF NOT hsdg.ctx_is_people_ops() THEN
      RAISE EXCEPTION 'HR marks the run paid.' USING ERRCODE = '42501';
    END IF;
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_runs_guard BEFORE INSERT OR UPDATE OR DELETE ON hsdg.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION hsdg.payroll_run_guard();

ALTER TABLE hsdg.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.payroll_runs FORCE  ROW LEVEL SECURITY;
CREATE POLICY payroll_runs_pay ON hsdg.payroll_runs
  TO hsdg_app USING (hsdg.ctx_can_see_pay()) WITH CHECK (hsdg.ctx_can_see_pay());
-- The Accountant reads the run header and its totals — no line, no person.
CREATE POLICY payroll_runs_finance ON hsdg.payroll_runs
  FOR SELECT TO hsdg_app USING (hsdg.ctx_is_finance());
CREATE POLICY payroll_runs_owner ON hsdg.payroll_runs
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.payroll_runs TO hsdg_app;

CREATE TABLE hsdg.payroll_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES hsdg.payroll_runs (id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  structure_id        uuid NOT NULL REFERENCES hsdg.salary_structures (id) ON DELETE RESTRICT,
  -- As they were at the run: the register never changes when the master does.
  month               date NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('salary', 'stipend')),
  employee_code       text NOT NULL,
  full_name           text NOT NULL,
  inputs              jsonb NOT NULL,
  line                jsonb NOT NULL,
  gross               numeric(14,2) NOT NULL,
  deductions          numeric(14,2) NOT NULL,
  net                 numeric(14,2) NOT NULL,
  employer_cost       numeric(14,2) NOT NULL,
  account_holder      text,
  account_ciphertext  bytea,
  account_iv          bytea,
  account_auth_tag    bytea,
  account_key_version integer,
  account_last4       text,
  ifsc                text,
  bank_changed        boolean NOT NULL DEFAULT false,
  released_at         timestamptz,
  paid_at             timestamptz,
  bank_reference      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_lines_once UNIQUE (run_id, employee_id)
);
CREATE INDEX payroll_lines_employee_idx ON hsdg.payroll_lines (employee_id, month);

-- Lines change only while the run is a draft or computed; on release they get
-- the payment facts and nothing else.
CREATE OR REPLACE FUNCTION hsdg.payroll_line_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
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
$$;
CREATE TRIGGER payroll_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON hsdg.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION hsdg.payroll_line_guard();

ALTER TABLE hsdg.payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.payroll_lines FORCE  ROW LEVEL SECURITY;
CREATE POLICY payroll_lines_pay ON hsdg.payroll_lines
  TO hsdg_app USING (hsdg.ctx_can_see_pay()) WITH CHECK (hsdg.ctx_can_see_pay());
-- A person reads their own line once the payslip is released.
CREATE POLICY payroll_lines_own ON hsdg.payroll_lines
  FOR SELECT TO hsdg_app
  USING (released_at IS NOT NULL AND employee_id = hsdg.ctx_employee_id());
CREATE POLICY payroll_lines_owner ON hsdg.payroll_lines
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.payroll_lines TO hsdg_app;

-- ── Monthly inputs (HR) ──────────────────────────────────────────────────
CREATE TABLE hsdg.payroll_inputs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month              date NOT NULL CHECK (extract(day FROM month) = 1),
  employee_id        uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('loss_of_pay_days', 'arrears', 'incentive', 'bonus',
                                                   'reimbursement', 'advance_recovery',
                                                   'other_deduction', 'tds')),
  amount             numeric(14,2) NOT NULL CHECK (amount >= 0),
  note               text CHECK (length(note) <= 300),
  created_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_inputs_whole_days CHECK (kind <> 'loss_of_pay_days' OR amount = trunc(amount))
);
CREATE INDEX payroll_inputs_month_idx ON hsdg.payroll_inputs (month, employee_id);
CREATE UNIQUE INDEX payroll_inputs_one_lop
  ON hsdg.payroll_inputs (month, employee_id) WHERE kind = 'loss_of_pay_days';

-- Once a run with this person is submitted, their month's inputs are fixed.
CREATE OR REPLACE FUNCTION hsdg.payroll_input_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE r record;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF EXISTS (SELECT 1 FROM hsdg.payroll_lines l JOIN hsdg.payroll_runs pr ON pr.id = l.run_id
              WHERE l.employee_id = r.employee_id AND pr.month = r.month
                AND pr.status NOT IN ('draft', 'computed')) THEN
    RAISE EXCEPTION 'This month''s run is already submitted; enter it next month.'
      USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' THEN NEW.created_by_user_id := hsdg.ctx_user_id(); END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER payroll_inputs_guard BEFORE INSERT OR UPDATE OR DELETE ON hsdg.payroll_inputs
  FOR EACH ROW EXECUTE FUNCTION hsdg.payroll_input_guard();

ALTER TABLE hsdg.payroll_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.payroll_inputs FORCE  ROW LEVEL SECURITY;
CREATE POLICY payroll_inputs_hr ON hsdg.payroll_inputs
  TO hsdg_app USING (hsdg.ctx_is_people_ops()) WITH CHECK (hsdg.ctx_is_people_ops());
CREATE POLICY payroll_inputs_read ON hsdg.payroll_inputs
  FOR SELECT TO hsdg_app USING (hsdg.ctx_can_see_pay());
CREATE POLICY payroll_inputs_owner ON hsdg.payroll_inputs
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.payroll_inputs TO hsdg_app;

-- ── Statutory deposits ───────────────────────────────────────────────────
-- HR prepares the working (from the runs); the Accountant pays and records the
-- challan (decision 9.10).
CREATE TABLE hsdg.statutory_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month               date NOT NULL CHECK (extract(day FROM month) = 1),
  kind                text NOT NULL CHECK (kind IN ('pf', 'esi', 'pt', 'tds')),
  amount              numeric(14,2) NOT NULL CHECK (amount >= 0),
  challan_number      text NOT NULL CHECK (length(btrim(challan_number)) BETWEEN 1 AND 60),
  paid_on             date NOT NULL,
  recorded_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statutory_payments_once UNIQUE (month, kind)
);
CREATE OR REPLACE FUNCTION hsdg.statutory_payment_stamp() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.recorded_by_user_id := hsdg.ctx_user_id();
  RETURN NEW;
END;
$$;
CREATE TRIGGER statutory_payments_stamp BEFORE INSERT OR UPDATE ON hsdg.statutory_payments
  FOR EACH ROW EXECUTE FUNCTION hsdg.statutory_payment_stamp();

ALTER TABLE hsdg.statutory_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.statutory_payments FORCE  ROW LEVEL SECURITY;
CREATE POLICY statutory_payments_read ON hsdg.statutory_payments
  FOR SELECT TO hsdg_app USING (hsdg.ctx_can_see_pay() OR hsdg.ctx_is_finance());
CREATE POLICY statutory_payments_record ON hsdg.statutory_payments
  TO hsdg_app USING (hsdg.ctx_is_finance() OR hsdg.ctx_has_role('managing_partner'))
  WITH CHECK (hsdg.ctx_is_finance() OR hsdg.ctx_has_role('managing_partner'));
CREATE POLICY statutory_payments_owner ON hsdg.statutory_payments
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.statutory_payments TO hsdg_app;

-- ── Seeded statutory defaults (§4.8 table; HR confirms each April) ───────
INSERT INTO hsdg.pay_settings (effective_from, rules) VALUES ('2026-04-01', $json$
{
  "pf": {"employeeRate": "12", "employerRate": "12", "epsRate": "8.33",
         "wageCeiling": "15000", "onFullWages": false},
  "esi": {"employeeRate": "0.75", "employerRate": "3.25", "grossThreshold": "21000"},
  "ptSlabs": [
    {"from": "0", "to": "7500", "amount": "0"},
    {"from": "7500.01", "to": "10000", "amount": "175"},
    {"from": "10000.01", "to": null, "amount": "200", "february": "300"}
  ],
  "ptSlabsByOffice": {},
  "stipendMinimumByOffice": {},
  "gratuityRate": "4.81",
  "labourCodeWages": true,
  "stipendDeductions": false
}
$json$::jsonb);

-- Down Migration

DROP TABLE IF EXISTS hsdg.statutory_payments;
DROP FUNCTION IF EXISTS hsdg.statutory_payment_stamp();
DROP TABLE IF EXISTS hsdg.payroll_inputs;
DROP FUNCTION IF EXISTS hsdg.payroll_input_guard();
DROP TABLE IF EXISTS hsdg.payroll_lines;
DROP FUNCTION IF EXISTS hsdg.payroll_line_guard();
DROP TABLE IF EXISTS hsdg.payroll_runs;
DROP FUNCTION IF EXISTS hsdg.payroll_run_guard();
DROP TABLE IF EXISTS hsdg.bank_change_requests;
DROP FUNCTION IF EXISTS hsdg.bank_change_guard();
DROP TABLE IF EXISTS hsdg.employee_pay_details;
DROP TABLE IF EXISTS hsdg.salary_structures;
DROP FUNCTION IF EXISTS hsdg.salary_structure_guard();
DROP TABLE IF EXISTS hsdg.pay_settings;
DROP TABLE IF EXISTS hsdg.payroll_approvers;
DROP FUNCTION IF EXISTS hsdg.ctx_can_see_pay();
DROP FUNCTION IF EXISTS hsdg.ctx_may_approve_pay();
