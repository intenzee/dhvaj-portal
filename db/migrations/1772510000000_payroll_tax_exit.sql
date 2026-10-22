-- ─────────────────────────────────────────────────────────────────────────
-- Payroll tax and exit — phase 2b (docs/accountant-hr-roles-spec.md §4.8,
-- §7.6): tax declarations and proofs, TDS on salary (s.392 of the
-- Income-tax Act 2025), Form 138 (was 24Q) data, Form 130 Part B (was
-- Form 16), full and final, gratuity and bonus.
--
-- tax_declarations — a person's regime and declared amounts for a tax year.
--                    The person (or HR for them) fills it; HR locks it.
-- tax_proofs       — a proof against a head; the file is an HR vault
--                    document (kind 'tax_proof'). HR accepts (in full or in
--                    part) or rejects it — never their own.
-- exit_settlements — the full and final working for a leaver. HR prepares,
--                    the Managing Partner (or the alternate) approves, never
--                    the preparer; the approved settlement is paid in the
--                    run of its pay month.
-- payroll_inputs   — gains `source`: HR's own inputs ('hr'), the projected
--                    TDS a computed run writes ('tax') and statutory bonus
--                    ('bonus'). HR's input screen replaces only 'hr' rows.
--
-- Who sees: ctx_can_see_pay() (HR and the approvers), and the person their
-- own declaration, proofs and approved settlement.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── Monthly inputs: where each came from ─────────────────────────────────
ALTER TABLE hsdg.payroll_inputs
  ADD COLUMN source text NOT NULL DEFAULT 'hr' CHECK (source IN ('hr', 'tax', 'bonus'));
-- One projected TDS per person and month: recomputing replaces it.
CREATE UNIQUE INDEX payroll_inputs_one_projected_tds
  ON hsdg.payroll_inputs (month, employee_id) WHERE source = 'tax';

-- ── Declarations ─────────────────────────────────────────────────────────
CREATE TABLE hsdg.tax_declarations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  -- The year it starts in: 2026 is tax year 2026-27.
  tax_year            integer NOT NULL CHECK (tax_year BETWEEN 2020 AND 2100),
  regime              text NOT NULL DEFAULT 'new' CHECK (regime IN ('new', 'old')),
  amounts             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(amounts) = 'object'),
  -- A joiner's salary and TDS with the earlier employer this year.
  previous_employment jsonb CHECK (previous_employment IS NULL
                                   OR jsonb_typeof(previous_employment) = 'object'),
  submitted_at        timestamptz,
  locked_at           timestamptz,
  locked_by_user_id   uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  updated_by_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_declarations_once UNIQUE (employee_id, tax_year)
);
CREATE TRIGGER tax_declarations_set_updated_at BEFORE UPDATE ON hsdg.tax_declarations
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- A locked declaration changes only when HR unlocks it; only HR locks.
CREATE OR REPLACE FUNCTION hsdg.tax_declaration_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  meta text[] := ARRAY['locked_at', 'locked_by_user_id', 'updated_by_user_id', 'version',
                       'updated_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.locked_at IS NOT NULL AND NOT hsdg.ctx_is_people_ops() THEN
      RAISE EXCEPTION 'Only HR locks a declaration.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.tax_year <> OLD.tax_year THEN
      RAISE EXCEPTION 'A declaration stays with its person and year.' USING ERRCODE = '22023';
    END IF;
    -- CBDT: the regime told to the employer holds for the year once salary
    -- has been taxed on it; the person chooses again in their return. HR may
    -- correct one recorded wrongly.
    IF NEW.regime <> OLD.regime AND NOT hsdg.ctx_is_people_ops() AND EXISTS (
         SELECT 1 FROM hsdg.payroll_lines l JOIN hsdg.payroll_runs r ON r.id = l.run_id
          WHERE l.employee_id = NEW.employee_id AND l.kind = 'salary'
            AND r.status IN ('approved', 'paid', 'locked')
            AND l.month BETWEEN make_date(NEW.tax_year, 4, 1) AND make_date(NEW.tax_year + 1, 3, 1))
    THEN
      RAISE EXCEPTION 'Your regime for this year is fixed once salary has been taxed on it; you can choose again in your income-tax return. Ask HR if it was recorded wrongly.'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
      IF NOT hsdg.ctx_is_people_ops() THEN
        RAISE EXCEPTION 'Only HR locks or unlocks a declaration.' USING ERRCODE = '42501';
      END IF;
    ELSIF OLD.locked_at IS NOT NULL
       AND (to_jsonb(NEW) - meta) IS DISTINCT FROM (to_jsonb(OLD) - meta) THEN
      RAISE EXCEPTION 'This declaration is locked; ask HR to unlock it.' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.locked_by_user_id := CASE WHEN NEW.locked_at IS NULL THEN NULL
                                WHEN TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL
                                  THEN OLD.locked_by_user_id
                                ELSE hsdg.ctx_user_id() END;
  NEW.updated_by_user_id := hsdg.ctx_user_id();
  RETURN NEW;
END;
$$;
CREATE TRIGGER tax_declarations_guard BEFORE INSERT OR UPDATE ON hsdg.tax_declarations
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_declaration_guard();

ALTER TABLE hsdg.tax_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_declarations FORCE  ROW LEVEL SECURITY;
CREATE POLICY tax_declarations_read ON hsdg.tax_declarations
  FOR SELECT TO hsdg_app USING (hsdg.ctx_can_see_pay());
CREATE POLICY tax_declarations_hr ON hsdg.tax_declarations
  TO hsdg_app USING (hsdg.ctx_is_people_ops()) WITH CHECK (hsdg.ctx_is_people_ops());
CREATE POLICY tax_declarations_own ON hsdg.tax_declarations
  TO hsdg_app USING (employee_id = hsdg.ctx_employee_id())
  WITH CHECK (employee_id = hsdg.ctx_employee_id());
CREATE POLICY tax_declarations_owner ON hsdg.tax_declarations
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.tax_declarations TO hsdg_app;

-- ── Proofs ───────────────────────────────────────────────────────────────
CREATE TABLE hsdg.tax_proofs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  declaration_id       uuid NOT NULL REFERENCES hsdg.tax_declarations (id) ON DELETE CASCADE,
  employee_id          uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  head                 text NOT NULL CHECK (head IN ('rent', 'lta', 'section80C', 'section80CCD1B',
                                                     'section80DSelf', 'section80DParents',
                                                     'homeLoanInterest', 'section80E',
                                                     'section80G', 'section80TTA')),
  amount               numeric(14,2) NOT NULL CHECK (amount > 0),
  -- The file, in the HR vault (hsdg.hr_documents, kind 'tax_proof'). No
  -- foreign key: the vault's table comes in a later migration.
  hr_document_id       uuid NOT NULL UNIQUE,
  filename             text NOT NULL CHECK (length(filename) BETWEEN 1 AND 400),
  status               text NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('submitted', 'accepted', 'rejected')),
  accepted_amount      numeric(14,2) CHECK (accepted_amount >= 0),
  reason               text CHECK (length(reason) <= 500),
  submitted_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  decided_by_user_id   uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_proofs_accepted_amount CHECK (
    (status = 'accepted') = (accepted_amount IS NOT NULL) AND (accepted_amount IS NULL OR accepted_amount <= amount))
);
CREATE INDEX tax_proofs_declaration_idx ON hsdg.tax_proofs (declaration_id);

CREATE OR REPLACE FUNCTION hsdg.tax_proof_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM hsdg.tax_declarations d
                    WHERE d.id = NEW.declaration_id AND d.employee_id = NEW.employee_id) THEN
      RAISE EXCEPTION 'The proof must be for the person''s own declaration.' USING ERRCODE = '22023';
    END IF;
    NEW.status := 'submitted';
    NEW.accepted_amount := NULL;
    NEW.reason := NULL;
    NEW.submitted_by_user_id := hsdg.ctx_user_id();
    NEW.decided_by_user_id := NULL;
    NEW.decided_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'submitted' THEN
    RAISE EXCEPTION 'This proof is already %.', OLD.status USING ERRCODE = '22023';
  END IF;
  IF NOT hsdg.ctx_is_people_ops() THEN
    RAISE EXCEPTION 'HR verifies proofs.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM hsdg.employees e
              WHERE e.id = OLD.employee_id AND e.user_id = hsdg.ctx_user_id()) THEN
    RAISE EXCEPTION 'Someone else in HR verifies your own proofs.' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'accepted_amount', 'reason', 'decided_by_user_id', 'decided_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'accepted_amount', 'reason', 'decided_by_user_id', 'decided_at']) THEN
    RAISE EXCEPTION 'A proof cannot be changed; upload another.' USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'rejected' AND (NEW.reason IS NULL OR length(btrim(NEW.reason)) = 0) THEN
    RAISE EXCEPTION 'Say why the proof is rejected.' USING ERRCODE = '22023';
  END IF;
  NEW.decided_by_user_id := hsdg.ctx_user_id();
  NEW.decided_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER tax_proofs_guard BEFORE INSERT OR UPDATE ON hsdg.tax_proofs
  FOR EACH ROW EXECUTE FUNCTION hsdg.tax_proof_guard();

ALTER TABLE hsdg.tax_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tax_proofs FORCE  ROW LEVEL SECURITY;
CREATE POLICY tax_proofs_read ON hsdg.tax_proofs
  FOR SELECT TO hsdg_app USING (hsdg.ctx_can_see_pay());
CREATE POLICY tax_proofs_hr ON hsdg.tax_proofs
  TO hsdg_app USING (hsdg.ctx_is_people_ops()) WITH CHECK (hsdg.ctx_is_people_ops());
CREATE POLICY tax_proofs_own_read ON hsdg.tax_proofs
  FOR SELECT TO hsdg_app USING (employee_id = hsdg.ctx_employee_id());
CREATE POLICY tax_proofs_own_insert ON hsdg.tax_proofs
  FOR INSERT TO hsdg_app WITH CHECK (employee_id = hsdg.ctx_employee_id());
CREATE POLICY tax_proofs_owner ON hsdg.tax_proofs
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.tax_proofs TO hsdg_app;

-- A person files a proof into the HR vault, which they cannot otherwise
-- write to: only their own, only kind 'tax_proof'. HR may file for anyone.
CREATE OR REPLACE FUNCTION hsdg.file_tax_proof_document(
  p_id uuid, p_employee_id uuid, p_title text, p_filename text, p_content_type text,
  p_size_bytes bigint, p_checksum text, p_reference text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT (hsdg.ctx_is_people_ops() OR p_employee_id = hsdg.ctx_employee_id()) THEN
    RAISE EXCEPTION 'You may file proofs only for yourself.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO hsdg.hr_documents
    (id, employee_id, kind, title, filename, content_type, size_bytes, checksum_sha256,
     storage_reference, uploaded_by_user_id)
  VALUES (p_id, p_employee_id, 'tax_proof', p_title, p_filename, p_content_type, p_size_bytes,
          p_checksum, p_reference, hsdg.ctx_user_id());
END;
$$;
REVOKE ALL ON FUNCTION hsdg.file_tax_proof_document(uuid, uuid, text, text, text, bigint, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.file_tax_proof_document(uuid, uuid, text, text, text, bigint, text, text)
  TO hsdg_app;

-- ── Full and final ───────────────────────────────────────────────────────
CREATE TABLE hsdg.exit_settlements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          uuid NOT NULL REFERENCES hsdg.employees (id) ON DELETE RESTRICT,
  exit_date            date NOT NULL,
  -- The run that pays it (the exit month, or the next open one).
  pay_month            date NOT NULL CHECK (extract(day FROM pay_month) = 1),
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'submitted', 'approved')),
  input                jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  working              jsonb NOT NULL CHECK (jsonb_typeof(working) = 'object'),
  gross                numeric(14,2) NOT NULL DEFAULT 0,
  deductions           numeric(14,2) NOT NULL DEFAULT 0,
  net                  numeric(14,2) NOT NULL DEFAULT 0,
  prepared_by_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  submitted_at         timestamptz,
  approved_by_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  approved_at          timestamptz,
  returned_reason      text CHECK (length(returned_reason) <= 500),
  run_id               uuid REFERENCES hsdg.payroll_runs (id) ON DELETE SET NULL,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exit_settlements_once UNIQUE (employee_id, exit_date)
);
CREATE INDEX exit_settlements_pay_month_idx ON hsdg.exit_settlements (pay_month) WHERE status = 'approved';
CREATE TRIGGER exit_settlements_set_updated_at BEFORE UPDATE ON hsdg.exit_settlements
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Draft → Submitted → Approved; Submitted → Draft (sent back, or withdrawn).
-- Approved needs an approver who is neither the preparer nor the leaver; once
-- approved only the paying run may be recorded.
CREATE OR REPLACE FUNCTION hsdg.exit_settlement_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  is_leaver boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft settlement can be deleted; this one is %.', OLD.status USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'draft';
    NEW.prepared_by_user_id := hsdg.ctx_user_id();
    NEW.approved_by_user_id := NULL;
    NEW.approved_at := NULL;
    NEW.submitted_at := NULL;
    NEW.run_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'A settlement stays with its person.' USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'approved' THEN
    IF NEW.status <> 'approved'
       OR (to_jsonb(NEW) - ARRAY['run_id', 'version', 'updated_at'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['run_id', 'version', 'updated_at']) THEN
      RAISE EXCEPTION 'An approved settlement cannot be changed.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.run_id IS DISTINCT FROM OLD.run_id THEN
    RAISE EXCEPTION 'Only an approved settlement is paid.' USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'A draft settlement is submitted before it is approved.' USING ERRCODE = '22023';
    END IF;
    IF NOT hsdg.ctx_is_people_ops() THEN
      RAISE EXCEPTION 'HR prepares the full and final.' USING ERRCODE = '42501';
    END IF;
    NEW.prepared_by_user_id := hsdg.ctx_user_id();
    IF NEW.status = 'submitted' THEN
      NEW.submitted_at := now();
      NEW.returned_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Submitted: the figures are fixed.
  IF (to_jsonb(NEW) - ARRAY['status', 'approved_by_user_id', 'approved_at', 'returned_reason',
                            'version', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'approved_by_user_id', 'approved_at', 'returned_reason',
                            'version', 'updated_at']) THEN
    RAISE EXCEPTION 'A submitted settlement cannot be changed; send it back first.'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'submitted' THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'draft' THEN
    IF hsdg.ctx_may_approve_pay() AND hsdg.ctx_user_id() IS DISTINCT FROM OLD.prepared_by_user_id THEN
      IF NEW.returned_reason IS NULL OR length(btrim(NEW.returned_reason)) = 0 THEN
        RAISE EXCEPTION 'Say why the settlement is sent back.' USING ERRCODE = '22023';
      END IF;
    ELSIF NOT hsdg.ctx_is_people_ops() THEN
      RAISE EXCEPTION 'Only HR withdraws a settlement.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- Approved.
  IF NOT hsdg.ctx_may_approve_pay() THEN
    RAISE EXCEPTION 'Only the Managing Partner or the named alternate approves a full and final.'
      USING ERRCODE = '42501';
  END IF;
  IF hsdg.ctx_user_id() IS NOT DISTINCT FROM OLD.prepared_by_user_id THEN
    RAISE EXCEPTION 'The person who prepared the settlement cannot approve it.' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (SELECT 1 FROM hsdg.employees e
                  WHERE e.id = OLD.employee_id AND e.user_id = hsdg.ctx_user_id())
    INTO is_leaver;
  IF is_leaver THEN
    RAISE EXCEPTION 'You cannot approve your own full and final.' USING ERRCODE = '42501';
  END IF;
  NEW.approved_by_user_id := hsdg.ctx_user_id();
  NEW.approved_at := now();
  NEW.returned_reason := NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER exit_settlements_guard BEFORE INSERT OR UPDATE OR DELETE ON hsdg.exit_settlements
  FOR EACH ROW EXECUTE FUNCTION hsdg.exit_settlement_guard();

ALTER TABLE hsdg.exit_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.exit_settlements FORCE  ROW LEVEL SECURITY;
CREATE POLICY exit_settlements_pay ON hsdg.exit_settlements
  TO hsdg_app USING (hsdg.ctx_can_see_pay()) WITH CHECK (hsdg.ctx_can_see_pay());
-- The leaver reads their own statement once approved.
CREATE POLICY exit_settlements_own ON hsdg.exit_settlements
  FOR SELECT TO hsdg_app USING (status = 'approved' AND employee_id = hsdg.ctx_employee_id());
CREATE POLICY exit_settlements_owner ON hsdg.exit_settlements
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.exit_settlements TO hsdg_app;

-- ── Seeded tax, gratuity, leave and bonus rules (HR confirms each April) ──
UPDATE hsdg.pay_settings SET rules = rules || jsonb_build_object('tax', $json$
{
  "new": {"slabs": [{"upTo": "400000", "rate": "0"}, {"upTo": "800000", "rate": "5"},
                    {"upTo": "1200000", "rate": "10"}, {"upTo": "1600000", "rate": "15"},
                    {"upTo": "2000000", "rate": "20"}, {"upTo": "2400000", "rate": "25"},
                    {"upTo": null, "rate": "30"}],
          "standardDeduction": "75000", "rebateLimit": "1200000", "rebateMax": "60000"},
  "old": {"slabs": [{"upTo": "250000", "rate": "0"}, {"upTo": "500000", "rate": "5"},
                    {"upTo": "1000000", "rate": "20"}, {"upTo": null, "rate": "30"}],
          "standardDeduction": "50000", "rebateLimit": "500000", "rebateMax": "12500"},
  "cessRate": "4",
  "surcharge": [{"above": "5000000", "rate": "10"}, {"above": "10000000", "rate": "15"},
                {"above": "20000000", "rate": "25"}, {"above": "50000000", "rate": "37"}],
  "newRegimeSurchargeMax": "25",
  "caps": {"section80C": "150000", "section80CCD1B": "50000", "section80DSelf": "25000",
           "section80DSelfSenior": "50000", "section80DParents": "25000",
           "section80DParentsSenior": "50000", "homeLoanInterest": "200000",
           "section80TTA": "10000"},
  "hraMetroRate": "50", "hraOtherRate": "40",
  "gratuityExemption": "2000000", "leaveEncashmentExemption": "2500000",
  "gratuity": {"minYears": 5, "daysPerYear": 15, "divisor": 26, "cap": "2000000"},
  "leaveEncashment": {"basis": "basic", "divisor": 30},
  "bonus": {"eligibilityCeiling": "21000", "calculationCeiling": "7000",
            "minRate": "8.33", "maxRate": "20"}
}
$json$::jsonb)
 WHERE effective_from = '2026-04-01' AND NOT rules ? 'tax';

-- Down Migration

UPDATE hsdg.pay_settings SET rules = rules - 'tax';
DROP TABLE IF EXISTS hsdg.exit_settlements;
DROP FUNCTION IF EXISTS hsdg.exit_settlement_guard();
DROP FUNCTION IF EXISTS hsdg.file_tax_proof_document(uuid, uuid, text, text, text, bigint, text, text);
DROP TABLE IF EXISTS hsdg.tax_proofs;
DROP FUNCTION IF EXISTS hsdg.tax_proof_guard();
DROP TABLE IF EXISTS hsdg.tax_declarations;
DROP FUNCTION IF EXISTS hsdg.tax_declaration_guard();
DROP INDEX IF EXISTS hsdg.payroll_inputs_one_projected_tds;
DELETE FROM hsdg.payroll_inputs WHERE source <> 'hr';
ALTER TABLE hsdg.payroll_inputs DROP COLUMN IF EXISTS source;
