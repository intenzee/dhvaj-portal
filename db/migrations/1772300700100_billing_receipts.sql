-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-202 · Receipts, part payments and TDS on our fees.
--
-- Clients pay part, late, and net of TDS (s.194J). A receipt records what
-- reached the bank (net) and what the client deducted (TDS); together, the
-- gross settles invoices:
--
-- receipts            — one payment from a client: date, mode, reference,
--                       gross, TDS (and its section), net = gross − TDS.
--                       Posted, or reversed with a reason; never deleted.
-- receipt_allocations — how much of a receipt goes to which invoice. One
--                       receipt may pay several invoices and an invoice may
--                       take several receipts; what is not allocated stays on
--                       the receipt as an advance.
-- invoices            — status gains partially_paid, and amount_settled
--                       holds what posted receipts cover. hsdg.settle_invoice
--                       recomputes both from the allocations whenever they or
--                       a receipt's status change, under the invoice's row
--                       lock, so the status cannot drift and two receipts
--                       cannot over-pay one invoice. PS-205 adds approved
--                       credit notes to the same function.
--
-- Scope: the people who may bill the client (hsdg.ctx_can_bill, PS-201).
-- billing.manage (record) and billing.approve (reverse) are enforced by the API.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Invoices: part payment ──────────────────────────────────────────────
ALTER TABLE hsdg.invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE hsdg.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void'));
ALTER TABLE hsdg.invoices
  ADD COLUMN amount_settled numeric(14,2) NOT NULL DEFAULT 0
    CONSTRAINT invoices_settled_within_total CHECK (amount_settled >= 0 AND amount_settled <= total);

-- ── 2. Receipts ────────────────────────────────────────────────────────────
CREATE TABLE hsdg.receipts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_entity_id        uuid NOT NULL REFERENCES hsdg.entities (id),
  received_on             date NOT NULL,
  mode                    text NOT NULL
                            CHECK (mode IN ('bank', 'upi', 'cheque', 'cash', 'adjustment')),
  reference               text CHECK (length(reference) <= 200),
  gross_amount            numeric(14,2) NOT NULL CHECK (gross_amount > 0),
  tds_amount              numeric(14,2) NOT NULL DEFAULT 0
                            CHECK (tds_amount >= 0 AND tds_amount < gross_amount),
  tds_section             text CHECK (tds_section IN ('194J', '194C', 'other')),
  net_amount              numeric(14,2) GENERATED ALWAYS AS (gross_amount - tds_amount) STORED,
  bank_account            text CHECK (length(bank_account) <= 100),
  status                  text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversed_reason         text CHECK (length(reversed_reason) <= 500),
  reversed_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  reversed_at             timestamptz,
  recorded_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipts_tds_has_section CHECK (tds_amount = 0 OR tds_section IS NOT NULL),
  CONSTRAINT receipts_reversal_has_reason
    CHECK (status = 'posted' OR (reversed_reason IS NOT NULL AND reversed_at IS NOT NULL))
);
CREATE INDEX receipts_client_idx ON hsdg.receipts (client_entity_id, received_on);
CREATE TRIGGER receipts_set_updated_at BEFORE UPDATE ON hsdg.receipts
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.receipt_allocations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES hsdg.receipts (id),
  invoice_id uuid NOT NULL REFERENCES hsdg.invoices (id),
  amount     numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_allocations_once UNIQUE (receipt_id, invoice_id)
);
CREATE INDEX receipt_allocations_invoice_idx ON hsdg.receipt_allocations (invoice_id);

-- ── 3. Keeping invoices settled ────────────────────────────────────────────
-- What posted receipts cover, and the status that follows. Locks the invoice
-- so concurrent receipts queue; refuses to settle beyond the total. A draft or
-- void invoice keeps its status. Internal: the triggers below call it.
CREATE OR REPLACE FUNCTION hsdg.settle_invoice(p_invoice_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  inv record;
  v_settled numeric(14,2);
  v_status text;
BEGIN
  SELECT i.id, i.status, i.total, i.amount_settled, i.invoice_number INTO inv
    FROM hsdg.invoices i WHERE i.id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(sum(a.amount), 0) INTO v_settled
    FROM hsdg.receipt_allocations a
    JOIN hsdg.receipts r ON r.id = a.receipt_id
   WHERE a.invoice_id = p_invoice_id AND r.status = 'posted';
  IF v_settled > inv.total THEN
    RAISE EXCEPTION 'Invoice % would be over-paid: % allocated against a total of %.',
      COALESCE(inv.invoice_number, 'draft'), v_settled, inv.total
      USING ERRCODE = '22023';
  END IF;
  v_status := CASE
    WHEN inv.status IN ('draft', 'void') THEN inv.status
    -- Marked paid by hand before receipts existed: leave it.
    WHEN v_settled = 0 AND inv.status = 'paid' AND inv.amount_settled = 0 THEN 'paid'
    WHEN v_settled = 0 THEN 'issued'
    WHEN v_settled < inv.total THEN 'partially_paid'
    ELSE 'paid'
  END;
  IF (v_settled, v_status) IS DISTINCT FROM (inv.amount_settled, inv.status) THEN
    UPDATE hsdg.invoices
       SET amount_settled = v_settled, status = v_status, version = version + 1
     WHERE id = p_invoice_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.settle_invoice(uuid) FROM PUBLIC;

-- An allocation is against an issued (or part-paid) invoice of the receipt's
-- own client, from a posted receipt, and never beyond the receipt's gross.
CREATE OR REPLACE FUNCTION hsdg.receipt_allocation_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  rc record;
  inv record;
BEGIN
  SELECT r.client_entity_id, r.status, r.gross_amount INTO rc
    FROM hsdg.receipts r WHERE r.id = NEW.receipt_id FOR UPDATE;
  SELECT i.client_entity_id, i.status, i.invoice_number INTO inv
    FROM hsdg.invoices i WHERE i.id = NEW.invoice_id;
  IF rc.status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'Only a posted receipt can be allocated.' USING ERRCODE = '22023';
  END IF;
  IF inv.client_entity_id IS DISTINCT FROM rc.client_entity_id THEN
    RAISE EXCEPTION 'That invoice belongs to another client.' USING ERRCODE = '22023';
  END IF;
  IF inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'Invoice % is %; only an issued, unpaid invoice takes a receipt.',
      COALESCE(inv.invoice_number, 'draft'), inv.status USING ERRCODE = '22023';
  END IF;
  IF (SELECT COALESCE(sum(a.amount), 0) FROM hsdg.receipt_allocations a
       WHERE a.receipt_id = NEW.receipt_id) + NEW.amount > rc.gross_amount THEN
    RAISE EXCEPTION 'The allocations exceed the receipt''s gross of %.', rc.gross_amount
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER receipt_allocations_guard BEFORE INSERT ON hsdg.receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION hsdg.receipt_allocation_guard();

CREATE OR REPLACE FUNCTION hsdg.receipt_allocation_settle() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM hsdg.settle_invoice(NEW.invoice_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER receipt_allocations_settle AFTER INSERT ON hsdg.receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION hsdg.receipt_allocation_settle();

-- A receipt's facts are fixed once posted; it can only be reversed, once.
CREATE OR REPLACE FUNCTION hsdg.receipt_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.client_entity_id, NEW.received_on, NEW.mode, NEW.reference, NEW.gross_amount,
      NEW.tds_amount, NEW.tds_section, NEW.bank_account, NEW.recorded_by_employee_id)
     IS DISTINCT FROM
     (OLD.client_entity_id, OLD.received_on, OLD.mode, OLD.reference, OLD.gross_amount,
      OLD.tds_amount, OLD.tds_section, OLD.bank_account, OLD.recorded_by_employee_id) THEN
    RAISE EXCEPTION 'A posted receipt cannot be changed; reverse it and record it again.'
      USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'This receipt is already reversed.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER receipts_guard BEFORE UPDATE ON hsdg.receipts
  FOR EACH ROW EXECUTE FUNCTION hsdg.receipt_guard();

-- Reversing a receipt reopens what it paid.
CREATE OR REPLACE FUNCTION hsdg.receipt_status_settle() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE v_invoice uuid;
BEGIN
  FOR v_invoice IN
    SELECT a.invoice_id FROM hsdg.receipt_allocations a
     WHERE a.receipt_id = NEW.id ORDER BY a.invoice_id
  LOOP
    PERFORM hsdg.settle_invoice(v_invoice);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER receipts_status_settle AFTER UPDATE OF status ON hsdg.receipts
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.receipt_status_settle();

-- An invoice with money against it is not voided; reverse the receipts first.
CREATE OR REPLACE FUNCTION hsdg.invoice_guard_settled_void() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'void' AND OLD.status <> 'void' AND OLD.amount_settled > 0 THEN
    RAISE EXCEPTION 'Receipts are allocated to this invoice; reverse them before voiding it.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_guard_settled_void BEFORE UPDATE OF status ON hsdg.invoices
  FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_guard_settled_void();

-- ── 4. Row-level security ──────────────────────────────────────────────────
ALTER TABLE hsdg.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.receipts FORCE  ROW LEVEL SECURITY;
CREATE POLICY receipts_billing ON hsdg.receipts
  TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY receipts_owner ON hsdg.receipts
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.receipts TO hsdg_app;

ALTER TABLE hsdg.receipt_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.receipt_allocations FORCE  ROW LEVEL SECURITY;
-- Visible with the receipt (whose own policy scopes it to the client's billers).
CREATE POLICY receipt_allocations_select ON hsdg.receipt_allocations
  FOR SELECT TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.receipts r WHERE r.id = receipt_id));
CREATE POLICY receipt_allocations_insert ON hsdg.receipt_allocations
  FOR INSERT TO hsdg_app
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.receipts r WHERE r.id = receipt_id));
CREATE POLICY receipt_allocations_owner ON hsdg.receipt_allocations
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.receipt_allocations TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.receipt_allocations;
DROP TABLE IF EXISTS hsdg.receipts;
DROP TRIGGER IF EXISTS invoices_guard_settled_void ON hsdg.invoices;
DROP FUNCTION IF EXISTS hsdg.invoice_guard_settled_void();
DROP FUNCTION IF EXISTS hsdg.receipt_status_settle();
DROP FUNCTION IF EXISTS hsdg.receipt_guard();
DROP FUNCTION IF EXISTS hsdg.receipt_allocation_settle();
DROP FUNCTION IF EXISTS hsdg.receipt_allocation_guard();
DROP FUNCTION IF EXISTS hsdg.settle_invoice(uuid);

-- Part-paid invoices go back to issued (the pre-PS-202 statuses); the owner
-- policy invoices_owner (PS-201) lets the migrator update them.
UPDATE hsdg.invoices SET status = 'issued' WHERE status = 'partially_paid';
ALTER TABLE hsdg.invoices DROP COLUMN IF EXISTS amount_settled;
ALTER TABLE hsdg.invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE hsdg.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'issued', 'paid', 'void'));
