-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-205 (follow-up) · voiding a credit note, its PDF, and
-- what settles an invoice told apart.
--
-- credit_notes  — an approved credit note may be voided: a partner
--                 (billing.approve, enforced by the API) other than the
--                 person who asked for it, with a reason. The void keeps
--                 the CN number (the series stays gap-free; a number is
--                 never reused), keeps the approval trail, and releases the
--                 balance through hsdg.settle_invoice as before. It is
--                 refused once the GST return covering the note's date is
--                 filed (firm_settings.gst_filed_through): the note is then
--                 on the GSTN and is undone by a debit note or an amendment
--                 in a later return, not by a void here.
--                 pdf_storage_reference keeps the note's PDF, written when
--                 it is approved (as an issued invoice's is).
-- firm_settings — gst_filed_through: the last day of the latest period whose
--                 GSTR-1 the firm has filed; null until a partner sets it.
-- invoices      — amount_received / amount_credited / amount_written_off:
--                 the three parts of amount_settled, kept by the same
--                 settle_invoice under the invoice's row lock, so whoever
--                 sees an invoice sees the parts that add up to its
--                 settlement (they always sum to amount_settled).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE hsdg.credit_notes
  ADD COLUMN void_reason text CHECK (length(void_reason) <= 500),
  ADD COLUMN voided_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN pdf_storage_reference text;

-- No void could be made before this (no API); give any made by hand a reason.
ALTER TABLE hsdg.credit_notes NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.credit_notes
   SET void_reason = 'Voided before reasons were recorded.', voided_at = updated_at
 WHERE status = 'void' AND (void_reason IS NULL OR voided_at IS NULL);
ALTER TABLE hsdg.credit_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.credit_notes
  ADD CONSTRAINT credit_notes_void_has_reason
    CHECK (status <> 'void' OR (length(btrim(void_reason)) > 0 AND voided_at IS NOT NULL));

ALTER TABLE hsdg.firm_settings ADD COLUMN gst_filed_through date;

ALTER TABLE hsdg.invoices
  ADD COLUMN amount_received numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_received >= 0),
  ADD COLUMN amount_credited numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_credited >= 0),
  ADD COLUMN amount_written_off numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_written_off >= 0);

-- The parts of what is settled today, from the rows settle_invoice reads.
ALTER TABLE hsdg.invoices            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.receipts            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.receipt_allocations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.credit_notes        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.write_offs          NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.invoices i
   SET amount_received = COALESCE((SELECT sum(a.amount)
                                     FROM hsdg.receipt_allocations a
                                     JOIN hsdg.receipts r ON r.id = a.receipt_id
                                    WHERE a.invoice_id = i.id AND r.status = 'posted'), 0),
       amount_credited = COALESCE((SELECT sum(c.total) FROM hsdg.credit_notes c
                                    WHERE c.invoice_id = i.id AND c.status = 'approved'), 0),
       amount_written_off = COALESCE((SELECT sum(w.amount) FROM hsdg.write_offs w
                                       WHERE w.invoice_id = i.id AND w.status = 'approved'), 0)
 WHERE i.amount_settled > 0;
ALTER TABLE hsdg.invoices            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.receipts            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.receipt_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.credit_notes        FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.write_offs          FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoices
  ADD CONSTRAINT invoices_settled_parts
    CHECK (amount_received + amount_credited + amount_written_off = amount_settled);

-- ── 2. Settlement keeps the parts ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION hsdg.settle_invoice(p_invoice_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  inv record;
  v_received numeric(14,2);
  v_credited numeric(14,2);
  v_written_off numeric(14,2);
  v_settled numeric(14,2);
  v_status text;
BEGIN
  SELECT i.id, i.status, i.total, i.amount_settled, i.amount_received, i.amount_credited,
         i.amount_written_off, i.invoice_number INTO inv
    FROM hsdg.invoices i WHERE i.id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(sum(a.amount), 0) INTO v_received
    FROM hsdg.receipt_allocations a
    JOIN hsdg.receipts r ON r.id = a.receipt_id
   WHERE a.invoice_id = p_invoice_id AND r.status = 'posted';
  SELECT COALESCE(sum(c.total), 0) INTO v_credited
    FROM hsdg.credit_notes c WHERE c.invoice_id = p_invoice_id AND c.status = 'approved';
  SELECT COALESCE(sum(w.amount), 0) INTO v_written_off
    FROM hsdg.write_offs w WHERE w.invoice_id = p_invoice_id AND w.status = 'approved';
  v_settled := v_received + v_credited + v_written_off;
  IF v_settled > inv.total THEN
    RAISE EXCEPTION 'Invoice % would be over-settled: % received, credited or written off against a total of %.',
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
  IF (v_settled, v_status, v_received, v_credited, v_written_off)
     IS DISTINCT FROM
     (inv.amount_settled, inv.status, inv.amount_received, inv.amount_credited,
      inv.amount_written_off) THEN
    UPDATE hsdg.invoices
       SET amount_settled = v_settled, status = v_status, amount_received = v_received,
           amount_credited = v_credited, amount_written_off = v_written_off,
           version = version + 1
     WHERE id = p_invoice_id;
  END IF;
END;
$$;

-- ── 3. Deciding, and voiding an approved credit note ───────────────────────
CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_decision_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_seq integer;
  v_date date;
  v_invoice_status text;
  v_filed date;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Nothing to decide.' USING ERRCODE = '22023';
  END IF;
  IF NOT (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
     AND NOT (TG_TABLE_NAME = 'credit_notes' AND OLD.status = 'approved' AND NEW.status = 'void') THEN
    RAISE EXCEPTION 'This request is already %.', OLD.status USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'pending' AND NEW.decided_by_employee_id IS NOT DISTINCT FROM OLD.requested_by_employee_id THEN
    RAISE EXCEPTION 'Someone other than the requester must decide it.' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'credit_notes' AND OLD.status = 'pending' AND NEW.status = 'approved' THEN
    v_date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    NEW.credit_date := v_date;
    NEW.financial_year := hsdg.financial_year_of(v_date);
    v_seq := hsdg.next_billing_seq('credit_note', NEW.financial_year);
    NEW.sequence_no := v_seq;
    NEW.credit_note_number := 'CN/' || substr(NEW.financial_year, 3) || '/'
                              || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  END IF;
  -- A void: by someone other than the requester, with a reason, while the
  -- note's GST period is still open. It keeps its number and its approval.
  IF TG_TABLE_NAME = 'credit_notes' AND OLD.status = 'approved' AND NEW.status = 'void' THEN
    IF length(btrim(COALESCE(to_jsonb(NEW)->>'void_reason', ''))) = 0 THEN
      RAISE EXCEPTION 'Say why the credit note is void.' USING ERRCODE = '22023';
    END IF;
    IF (to_jsonb(NEW)->>'voided_by_employee_id')::uuid IS NOT DISTINCT FROM OLD.requested_by_employee_id THEN
      RAISE EXCEPTION 'Someone other than the requester must void it.' USING ERRCODE = '42501';
    END IF;
    SELECT i.status INTO v_invoice_status FROM hsdg.invoices i WHERE i.id = OLD.invoice_id;
    IF v_invoice_status = 'void' THEN
      RAISE EXCEPTION 'The invoice is void; its credit notes stay as they are.' USING ERRCODE = '22023';
    END IF;
    SELECT f.gst_filed_through INTO v_filed FROM hsdg.firm_settings f LIMIT 1;
    IF v_filed IS NOT NULL AND OLD.credit_date <= v_filed THEN
      RAISE EXCEPTION 'Credit note % is dated % and the GST return through % is filed, so it is on the GSTN. Raise a debit note or amend it in the next GSTR-1 instead of voiding it.',
        OLD.credit_note_number, to_char(OLD.credit_date, 'DD-MM-YYYY'), to_char(v_filed, 'DD-MM-YYYY')
        USING ERRCODE = '22023';
    END IF;
    NEW.credit_note_number := OLD.credit_note_number;
    NEW.financial_year := OLD.financial_year;
    NEW.sequence_no := OLD.sequence_no;
    NEW.credit_date := OLD.credit_date;
    NEW.decided_by_employee_id := OLD.decided_by_employee_id;
    NEW.decided_at := OLD.decided_at;
    NEW.decision_note := OLD.decision_note;
    NEW.voided_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- The amounts stay fixed; the void trail moves only with a void, and the PDF
-- reference is written once.
CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_frozen() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_moving text[] := ARRAY['status', 'decided_by_employee_id', 'decided_at', 'decision_note',
                           'version', 'updated_at', 'credit_note_number', 'financial_year',
                           'sequence_no', 'credit_date', 'total', 'void_reason',
                           'voided_by_employee_id', 'voided_at', 'pdf_storage_reference'];
  v_void text[] := ARRAY['void_reason', 'voided_by_employee_id', 'voided_at'];
BEGIN
  IF (to_jsonb(NEW) - v_moving) IS DISTINCT FROM (to_jsonb(OLD) - v_moving) THEN
    RAISE EXCEPTION 'A request cannot be changed; reject it and raise another.'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT jsonb_object_agg(k, to_jsonb(NEW)->k) FROM unnest(v_void) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD)->k) FROM unnest(v_void) k)
     AND NOT (OLD.status = 'approved' AND NEW.status = 'void') THEN
    RAISE EXCEPTION 'A credit note''s void is recorded when it is voided.' USING ERRCODE = '22023';
  END IF;
  IF (to_jsonb(OLD)->>'pdf_storage_reference') IS NOT NULL
     AND (to_jsonb(NEW)->>'pdf_storage_reference') IS DISTINCT FROM (to_jsonb(OLD)->>'pdf_storage_reference') THEN
    RAISE EXCEPTION 'A credit note''s PDF is kept as it was issued.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- Down Migration

-- As PS-205 left them.
CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_frozen() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'decided_by_employee_id', 'decided_at', 'decision_note',
                            'version', 'updated_at', 'credit_note_number', 'financial_year',
                            'sequence_no', 'credit_date', 'total'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'decided_by_employee_id', 'decided_at', 'decision_note',
                            'version', 'updated_at', 'credit_note_number', 'financial_year',
                            'sequence_no', 'credit_date', 'total']) THEN
    RAISE EXCEPTION 'A request cannot be changed; reject it and raise another.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_decision_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_seq integer;
  v_date date;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Nothing to decide.' USING ERRCODE = '22023';
  END IF;
  IF NOT (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
     AND NOT (TG_TABLE_NAME = 'credit_notes' AND OLD.status = 'approved' AND NEW.status = 'void') THEN
    RAISE EXCEPTION 'This request is already %.', OLD.status USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'pending' AND NEW.decided_by_employee_id IS NOT DISTINCT FROM OLD.requested_by_employee_id THEN
    RAISE EXCEPTION 'Someone other than the requester must decide it.' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'credit_notes' AND OLD.status = 'pending' AND NEW.status = 'approved' THEN
    v_date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    NEW.credit_date := v_date;
    NEW.financial_year := hsdg.financial_year_of(v_date);
    v_seq := hsdg.next_billing_seq('credit_note', NEW.financial_year);
    NEW.sequence_no := v_seq;
    NEW.credit_note_number := 'CN/' || substr(NEW.financial_year, 3) || '/'
                              || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  END IF;
  RETURN NEW;
END;
$$;

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
  SELECT COALESCE((SELECT sum(a.amount)
                      FROM hsdg.receipt_allocations a
                      JOIN hsdg.receipts r ON r.id = a.receipt_id
                     WHERE a.invoice_id = p_invoice_id AND r.status = 'posted'), 0)
       + COALESCE((SELECT sum(c.total) FROM hsdg.credit_notes c
                    WHERE c.invoice_id = p_invoice_id AND c.status = 'approved'), 0)
       + COALESCE((SELECT sum(w.amount) FROM hsdg.write_offs w
                    WHERE w.invoice_id = p_invoice_id AND w.status = 'approved'), 0)
    INTO v_settled;
  IF v_settled > inv.total THEN
    RAISE EXCEPTION 'Invoice % would be over-settled: % received, credited or written off against a total of %.',
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

ALTER TABLE hsdg.invoices DROP CONSTRAINT IF EXISTS invoices_settled_parts;
ALTER TABLE hsdg.invoices
  DROP COLUMN IF EXISTS amount_written_off,
  DROP COLUMN IF EXISTS amount_credited,
  DROP COLUMN IF EXISTS amount_received;
ALTER TABLE hsdg.firm_settings DROP COLUMN IF EXISTS gst_filed_through;
-- Voids made since stay void (the PS-205 schema allows them); their trail goes.
ALTER TABLE hsdg.credit_notes DROP CONSTRAINT IF EXISTS credit_notes_void_has_reason;
ALTER TABLE hsdg.credit_notes
  DROP COLUMN IF EXISTS pdf_storage_reference,
  DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS voided_by_employee_id,
  DROP COLUMN IF EXISTS void_reason;
