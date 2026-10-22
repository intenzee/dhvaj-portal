-- ─────────────────────────────────────────────────────────────────────────
-- Accountant role · maker–checker for voids and reversals
-- (docs/accountant-hr-roles-spec.md §3.5).
--
-- Voiding an issued invoice and reversing a receipt need billing.approve. The
-- Accountant (billing.manage only) *asks*; a partner other than the one who
-- asked *approves* — the void or reversal then happens, under the partner's
-- name — or rejects. The request is the record of who asked, why, and who
-- decided; every step is also in the audit log.
--
-- billing_reversal_requests  one row per ask: an invoice to void or a receipt
--                            to reverse, the reason, the decision. One open
--                            ask per invoice / receipt.
--
-- Seen and written by whoever may bill the client (ctx_can_bill — the
-- Accountant, the Managing Partner, the client's home-office partners and
-- managers), like the invoice issue requests. The database refuses a
-- decision by the person who asked.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.billing_reversal_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                     text NOT NULL CHECK (kind IN ('invoice_void', 'receipt_reversal')),
  invoice_id               uuid REFERENCES hsdg.invoices (id) ON DELETE CASCADE,
  receipt_id               uuid REFERENCES hsdg.receipts (id) ON DELETE CASCADE,
  -- Filled from the invoice or receipt (trigger); never from the caller.
  client_entity_id         uuid NOT NULL,
  engagement_id            uuid,
  amount                   numeric(14,2) NOT NULL,
  reason                   text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  requested_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at               timestamptz,
  decision_note            text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_reversal_requests_target CHECK (
    (kind = 'invoice_void' AND invoice_id IS NOT NULL AND receipt_id IS NULL)
    OR (kind = 'receipt_reversal' AND receipt_id IS NOT NULL AND invoice_id IS NULL)),
  CONSTRAINT billing_reversal_requests_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
  -- Maker–checker: whoever asked never approves or rejects it.
  CONSTRAINT billing_reversal_requests_checker CHECK (
    status NOT IN ('approved', 'rejected')
    OR decided_by_employee_id IS NULL
    OR requested_by_employee_id IS NULL
    OR decided_by_employee_id <> requested_by_employee_id)
);
CREATE UNIQUE INDEX billing_reversal_requests_open_invoice
  ON hsdg.billing_reversal_requests (invoice_id) WHERE status = 'pending' AND invoice_id IS NOT NULL;
CREATE UNIQUE INDEX billing_reversal_requests_open_receipt
  ON hsdg.billing_reversal_requests (receipt_id) WHERE status = 'pending' AND receipt_id IS NOT NULL;
CREATE INDEX billing_reversal_requests_client ON hsdg.billing_reversal_requests (client_entity_id);
CREATE INDEX billing_reversal_requests_status ON hsdg.billing_reversal_requests (status, created_at DESC);

-- The client, engagement and amount always come from the invoice or receipt,
-- read under the caller's row-level security: an invoice they cannot bill is
-- "not found".
CREATE FUNCTION hsdg.billing_reversal_request_fill() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.kind = 'invoice_void' THEN
    SELECT i.client_entity_id, i.engagement_id, i.total
      INTO NEW.client_entity_id, NEW.engagement_id, NEW.amount
      FROM hsdg.invoices i WHERE i.id = NEW.invoice_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT r.client_entity_id, NULL::uuid, r.gross_amount
      INTO NEW.client_entity_id, NEW.engagement_id, NEW.amount
      FROM hsdg.receipts r WHERE r.id = NEW.receipt_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Receipt not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_reversal_requests_fill
  BEFORE INSERT ON hsdg.billing_reversal_requests
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_reversal_request_fill();

-- What was asked stays as asked: only the decision columns move.
CREATE FUNCTION hsdg.billing_reversal_request_frozen() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %.', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.kind, NEW.invoice_id, NEW.receipt_id, NEW.client_entity_id, NEW.engagement_id,
      NEW.amount, NEW.reason, NEW.requested_by_employee_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.kind, OLD.invoice_id, OLD.receipt_id, OLD.client_entity_id, OLD.engagement_id,
      OLD.amount, OLD.reason, OLD.requested_by_employee_id, OLD.created_at) THEN
    RAISE EXCEPTION 'A request cannot be changed, only decided or withdrawn.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER billing_reversal_requests_frozen
  BEFORE UPDATE ON hsdg.billing_reversal_requests
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_reversal_request_frozen();

-- A decided or withdrawn request clears the approvers' "to approve" notice.
CREATE FUNCTION hsdg.billing_reversal_request_closed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM hsdg.resolve_notifications('billing_reversal_request', ARRAY[NEW.id],
                                     ARRAY['write_off_pending']);
  RETURN NULL;
END;
$$;
CREATE TRIGGER billing_reversal_requests_closed AFTER UPDATE OF status ON hsdg.billing_reversal_requests
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
  EXECUTE FUNCTION hsdg.billing_reversal_request_closed();

ALTER TABLE hsdg.billing_reversal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.billing_reversal_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_reversal_requests_billing ON hsdg.billing_reversal_requests
  FOR ALL TO hsdg_app
  USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY billing_reversal_requests_owner ON hsdg.billing_reversal_requests
  FOR ALL TO hsdg_migrator USING (true) WITH CHECK (true);
REVOKE ALL ON hsdg.billing_reversal_requests FROM PUBLIC;
-- A request is a record: no deletes.
GRANT SELECT, INSERT, UPDATE ON hsdg.billing_reversal_requests TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.billing_reversal_requests;
DROP FUNCTION IF EXISTS hsdg.billing_reversal_request_closed();
DROP FUNCTION IF EXISTS hsdg.billing_reversal_request_frozen();
DROP FUNCTION IF EXISTS hsdg.billing_reversal_request_fill();
