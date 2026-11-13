-- ─────────────────────────────────────────────────────────────────────────
-- Invoices: the firm's own numbers, editing an issued invoice, deleting one
--
-- 1. NUMBERS. The firm numbers invoices <FY start><FY end>/<month>/<serial>,
--    the serial restarting every month: 202627/11/07 is November 2026's
--    seventh invoice of FY 2026-27 (12 characters, within rule 46's 16). The
--    series lives in billing_series under kind 'invoice_month', keyed by the
--    issue month ('2026-11') in its financial_year column. The number, not
--    (financial_year, sequence_no), is now what is unique. Invoices issued
--    before keep their INV/26-27/0001 numbers.
--
-- 2. EDITING AN ISSUED INVOICE. An issued invoice stays frozen except while
--    the API revises it: it sets hsdg.revising_invoice to the invoice's id for
--    its transaction, after checking that no money is received or credited
--    against it and that its month is not in a filed GSTR-1. Its number,
--    financial year, serial and date never change; the API re-renders the
--    PDF. revised_at / revision_count record it.
--
-- 3. DELETING. A deleted invoice is voided and hidden (deleted_at): an issued
--    number is never reused, so the GSTR-1 document series still shows it as
--    cancelled. A deleted draft simply disappears from the lists.
--
-- 4. NO GST WITHOUT A GSTIN. Until the firm's GSTIN is set no GST is charged,
--    yet lines were stored at 18% — the invoice then showed a rate it did not
--    charge. Lines of invoices that charged no GST (and are not reverse
--    charge) are set to 0%; the API stores 0% from now on until the GSTIN is
--    set.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Monthly numbers ────────────────────────────────────────────────────
ALTER TABLE hsdg.billing_series DROP CONSTRAINT billing_series_kind_check;
ALTER TABLE hsdg.billing_series ADD CONSTRAINT billing_series_kind_check
  CHECK (kind IN ('invoice', 'credit_note', 'invoice_month'));
COMMENT ON COLUMN hsdg.billing_series.financial_year IS
  'The series key: the financial year (2026-27), or the issue month (2026-11) for invoice_month.';

-- '2026-11-16', serial 7 → '202627/11/07'.
CREATE OR REPLACE FUNCTION hsdg.next_invoice_number_on(
  p_issue_date date, OUT number text, OUT seq integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE v_fy text := hsdg.financial_year_of(p_issue_date);
BEGIN
  seq := hsdg.next_billing_seq('invoice_month', to_char(p_issue_date, 'YYYY-MM'));
  number := left(v_fy, 4) || right(v_fy, 2) || '/' || to_char(p_issue_date, 'MM') || '/'
            || lpad(seq::text, greatest(2, length(seq::text)), '0');
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.next_invoice_number_on(date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION hsdg.issue_invoice(p_invoice_id uuid, p_issue_date date)
RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  inv hsdg.invoices%ROWTYPE;
  v_number text;
  v_seq integer;
  v_terms integer;
BEGIN
  SELECT * INTO inv FROM hsdg.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (hsdg.is_engagement_lead(inv.engagement_id) OR hsdg.ctx_can_bill(inv.client_entity_id)) THEN
    RAISE EXCEPTION 'Not permitted to issue this invoice.' USING ERRCODE = '42501';
  END IF;
  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice can be issued; this invoice is %.', inv.status
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hsdg.invoice_line_items li WHERE li.invoice_id = inv.id) THEN
    RAISE EXCEPTION 'Cannot issue an invoice with no line items.' USING ERRCODE = '22023';
  END IF;
  SELECT n.number, n.seq INTO v_number, v_seq FROM hsdg.next_invoice_number_on(p_issue_date) n;
  SELECT f.invoice_terms_days INTO v_terms FROM hsdg.firm_settings f LIMIT 1;
  UPDATE hsdg.invoices
     SET status = 'issued',
         invoice_number = v_number,
         financial_year = hsdg.financial_year_of(p_issue_date),
         sequence_no = v_seq,
         issue_date = p_issue_date,
         due_date = COALESCE(due_date, p_issue_date + COALESCE(v_terms, 15)),
         issued_by_employee_id = hsdg.ctx_employee_id(),
         issued_at = now(),
         version = version + 1
   WHERE id = inv.id;
  RETURN v_number;
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.issue_invoice(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.issue_invoice(uuid, date) TO hsdg_app;

DROP INDEX hsdg.invoices_fy_sequence_uniq;
CREATE UNIQUE INDEX invoices_number_uniq ON hsdg.invoices (invoice_number)
  WHERE invoice_number IS NOT NULL;

-- ── 2 + 3. Revising and deleting ──────────────────────────────────────────
ALTER TABLE hsdg.invoices
  ADD COLUMN revised_at timestamptz,
  ADD COLUMN revision_count integer NOT NULL DEFAULT 0 CHECK (revision_count >= 0),
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD CONSTRAINT invoices_deleted_is_void CHECK (deleted_at IS NULL OR status = 'void');

-- True while the API revises this invoice in the current transaction.
CREATE OR REPLACE FUNCTION hsdg.invoice_revising(p_invoice_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT current_setting('hsdg.revising_invoice', true) = p_invoice_id::text;
$$;
GRANT EXECUTE ON FUNCTION hsdg.invoice_revising(uuid) TO hsdg_app;

CREATE OR REPLACE FUNCTION hsdg.invoice_guard_issued() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.invoice_number, NEW.financial_year, NEW.sequence_no, NEW.issue_date
     ) IS DISTINCT FROM (
       OLD.invoice_number, OLD.financial_year, OLD.sequence_no, OLD.issue_date
     ) THEN
    RAISE EXCEPTION 'An issued invoice keeps its number and date.' USING ERRCODE = '22023';
  END IF;
  IF OLD.status <> 'draft' AND NOT hsdg.invoice_revising(OLD.id) AND (
       NEW.subtotal, NEW.tax_amount, NEW.cgst, NEW.sgst, NEW.igst, NEW.currency,
       NEW.client_gstin, NEW.place_of_supply_state, NEW.is_reverse_charge, NEW.amount_in_words
     ) IS DISTINCT FROM (
       OLD.subtotal, OLD.tax_amount, OLD.cgst, OLD.sgst, OLD.igst, OLD.currency,
       OLD.client_gstin, OLD.place_of_supply_state, OLD.is_reverse_charge, OLD.amount_in_words
     ) THEN
    RAISE EXCEPTION 'An issued invoice cannot be changed; edit it from the invoice, or void it.'
      USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'A void invoice stays void.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- An issued invoice's lines stay locked except while the API revises it, or
-- while an engagement is purged (as before).
CREATE OR REPLACE FUNCTION hsdg.invoice_line_guard_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('hsdg.purging', true) = 'on'
     AND current_user <> 'hsdg_app' THEN
    RETURN OLD;
  END IF;
  SELECT i.status INTO st FROM hsdg.invoices i WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft'
     AND NOT (st IN ('issued', 'partially_paid')
              AND hsdg.invoice_revising(COALESCE(NEW.invoice_id, OLD.invoice_id))) THEN
    RAISE EXCEPTION 'Only a draft invoice''s lines can change; this invoice is %.', st
      USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 4. No GST shown where none was charged ────────────────────────────────
DO $$
DECLARE
  t text;
  forced text[] := '{}';
  inv uuid;
BEGIN
  FOREACH t IN ARRAY ARRAY['hsdg.invoices', 'hsdg.invoice_line_items'] LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      forced := forced || t;
      EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;

  FOR inv IN
    SELECT i.id FROM hsdg.invoices i
     WHERE NOT i.is_reverse_charge AND i.tax_amount = 0 AND i.cgst + i.sgst + i.igst = 0
       AND EXISTS (SELECT 1 FROM hsdg.invoice_line_items l
                    WHERE l.invoice_id = i.id AND l.gst_rate <> 0)
  LOOP
    PERFORM set_config('hsdg.revising_invoice', inv::text, true);
    UPDATE hsdg.invoice_line_items SET gst_rate = 0 WHERE invoice_id = inv AND gst_rate <> 0;
  END LOOP;
  PERFORM set_config('hsdg.revising_invoice', '', true);

  FOREACH t IN ARRAY forced LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.invoice_line_guard_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('hsdg.purging', true) = 'on'
     AND current_user <> 'hsdg_app' THEN
    RETURN OLD;
  END IF;
  SELECT i.status INTO st FROM hsdg.invoices i WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice''s lines can change; this invoice is %.', st
      USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION hsdg.invoice_guard_issued() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.invoice_number, NEW.financial_year, NEW.sequence_no, NEW.issue_date,
       NEW.subtotal, NEW.tax_amount, NEW.cgst, NEW.sgst, NEW.igst, NEW.currency,
       NEW.client_gstin, NEW.place_of_supply_state, NEW.is_reverse_charge, NEW.amount_in_words
     ) IS DISTINCT FROM (
       OLD.invoice_number, OLD.financial_year, OLD.sequence_no, OLD.issue_date,
       OLD.subtotal, OLD.tax_amount, OLD.cgst, OLD.sgst, OLD.igst, OLD.currency,
       OLD.client_gstin, OLD.place_of_supply_state, OLD.is_reverse_charge, OLD.amount_in_words
     ) THEN
    RAISE EXCEPTION 'An issued invoice cannot be changed; void it or raise a credit note.'
      USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'A void invoice stays void.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS hsdg.invoice_revising(uuid);
ALTER TABLE hsdg.invoices
  DROP CONSTRAINT IF EXISTS invoices_deleted_is_void,
  DROP COLUMN IF EXISTS deleted_by_employee_id,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS revision_count,
  DROP COLUMN IF EXISTS revised_at;

DROP INDEX IF EXISTS hsdg.invoices_number_uniq;
CREATE UNIQUE INDEX invoices_fy_sequence_uniq ON hsdg.invoices (financial_year, sequence_no)
  WHERE sequence_no IS NOT NULL
    AND invoice_number NOT LIKE '______/__/%';

CREATE OR REPLACE FUNCTION hsdg.issue_invoice(p_invoice_id uuid, p_issue_date date)
RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  inv hsdg.invoices%ROWTYPE;
  v_fy text;
  v_number text;
  v_seq integer;
  v_terms integer;
BEGIN
  SELECT * INTO inv FROM hsdg.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (hsdg.is_engagement_lead(inv.engagement_id) OR hsdg.ctx_can_bill(inv.client_entity_id)) THEN
    RAISE EXCEPTION 'Not permitted to issue this invoice.' USING ERRCODE = '42501';
  END IF;
  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice can be issued; this invoice is %.', inv.status
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hsdg.invoice_line_items li WHERE li.invoice_id = inv.id) THEN
    RAISE EXCEPTION 'Cannot issue an invoice with no line items.' USING ERRCODE = '22023';
  END IF;
  v_fy := hsdg.financial_year_of(p_issue_date);
  SELECT n.number, n.seq INTO v_number, v_seq FROM hsdg.next_invoice_number(v_fy) n;
  SELECT f.invoice_terms_days INTO v_terms FROM hsdg.firm_settings f LIMIT 1;
  UPDATE hsdg.invoices
     SET status = 'issued',
         invoice_number = v_number,
         financial_year = v_fy,
         sequence_no = v_seq,
         issue_date = p_issue_date,
         due_date = COALESCE(due_date, p_issue_date + COALESCE(v_terms, 15)),
         issued_by_employee_id = hsdg.ctx_employee_id(),
         issued_at = now(),
         version = version + 1
   WHERE id = inv.id;
  RETURN v_number;
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.issue_invoice(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.issue_invoice(uuid, date) TO hsdg_app;

DROP FUNCTION IF EXISTS hsdg.next_invoice_number_on(date);
DELETE FROM hsdg.billing_series WHERE kind = 'invoice_month';
ALTER TABLE hsdg.billing_series DROP CONSTRAINT billing_series_kind_check;
ALTER TABLE hsdg.billing_series ADD CONSTRAINT billing_series_kind_check
  CHECK (kind IN ('invoice', 'credit_note'));
COMMENT ON COLUMN hsdg.billing_series.financial_year IS NULL;
