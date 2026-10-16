-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-201 · GST-correct invoices and a billing permission.
--
-- The firm's own invoices become valid tax invoices (CGST rule 46):
--
-- firm_settings  — the firm's GSTIN and state, the default SAC, the invoice
--                  prefix and payment terms (Billing → Settings).
-- invoices       — the client (copied from the engagement), the client's GSTIN,
--                  place of supply, reverse charge, the CGST/SGST/IGST split,
--                  the amount in words, and who issued or voided it and why.
--                  A draft has NO number: hsdg.issue_invoice assigns
--                  <prefix>/<YY-YY>/<seq> at issue from billing_series under a
--                  row lock, so each financial year's numbers have no gaps and
--                  no duplicates (a rolled-back issue rolls the counter back).
--                  The year is shortened because rule 46 caps the number at 16
--                  characters. Once issued, the number, amounts and tax facts
--                  are frozen; voiding keeps the number (void, never delete).
-- invoice_line_items — SAC, taxable value and GST rate per line.
--
-- Billing scope: besides the engagement leads, the managing partner and the
-- partners and managers of the client's home office may see and update a
-- client's invoices (ctx_can_bill). Permissions billing.manage (issue) and
-- billing.approve (void an issued invoice) are enforced by the API.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. The firm on the invoice ─────────────────────────────────────────────
ALTER TABLE hsdg.firm_settings
  ADD COLUMN gstin text
    CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  ADD COLUMN state_code text CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  ADD COLUMN sac_default text NOT NULL DEFAULT '998221' CHECK (sac_default ~ '^[0-9]{4,8}$'),
  ADD COLUMN invoice_prefix text NOT NULL DEFAULT 'INV' CHECK (invoice_prefix ~ '^[A-Z0-9]{1,5}$'),
  ADD COLUMN invoice_terms_days integer NOT NULL DEFAULT 15
    CHECK (invoice_terms_days BETWEEN 0 AND 365),
  ADD CONSTRAINT firm_settings_gstin_state
    CHECK (gstin IS NULL OR state_code = left(gstin, 2));

-- ── 2. Invoices as tax invoices ────────────────────────────────────────────
ALTER TABLE hsdg.invoices
  ALTER COLUMN invoice_number DROP DEFAULT,
  ALTER COLUMN invoice_number DROP NOT NULL,
  ADD COLUMN client_entity_id uuid REFERENCES hsdg.entities (id) ON DELETE RESTRICT,
  ADD COLUMN client_gstin text
    CHECK (client_gstin IS NULL OR client_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  ADD COLUMN place_of_supply_state text
    CHECK (place_of_supply_state IS NULL OR place_of_supply_state ~ '^[0-9]{2}$'),
  ADD COLUMN is_reverse_charge boolean NOT NULL DEFAULT false,
  ADD COLUMN cgst numeric(14,2) NOT NULL DEFAULT 0 CHECK (cgst >= 0),
  ADD COLUMN sgst numeric(14,2) NOT NULL DEFAULT 0 CHECK (sgst >= 0),
  ADD COLUMN igst numeric(14,2) NOT NULL DEFAULT 0 CHECK (igst >= 0),
  ADD COLUMN amount_in_words text,
  ADD COLUMN financial_year text CHECK (financial_year IS NULL OR financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  ADD COLUMN sequence_no integer CHECK (sequence_no IS NULL OR sequence_no > 0),
  ADD COLUMN issued_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN issued_at timestamptz,
  ADD COLUMN voided_reason text,
  ADD COLUMN voided_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN pdf_storage_reference text,
  ADD CONSTRAINT invoices_number_length
    CHECK (invoice_number IS NULL OR length(invoice_number) <= 16),
  ADD CONSTRAINT invoices_issued_has_number
    CHECK (status IN ('draft', 'void') OR invoice_number IS NOT NULL),
  ADD CONSTRAINT invoices_gst_split
    CHECK (is_reverse_charge OR cgst + sgst + igst = 0 OR cgst + sgst + igst = tax_amount),
  ADD CONSTRAINT invoices_cgst_equals_sgst CHECK (cgst = sgst),
  ADD CONSTRAINT invoices_void_has_reason
    CHECK (voided_at IS NULL OR length(trim(coalesce(voided_reason, ''))) > 0);

CREATE UNIQUE INDEX invoices_fy_sequence_uniq ON hsdg.invoices (financial_year, sequence_no)
  WHERE sequence_no IS NOT NULL;
CREATE INDEX invoices_client_idx ON hsdg.invoices (client_entity_id);

ALTER TABLE hsdg.invoice_line_items
  ADD COLUMN sac_code text CHECK (sac_code IS NULL OR sac_code ~ '^[0-9]{4,8}$'),
  ADD COLUMN taxable_value numeric(14,2) NOT NULL
    GENERATED ALWAYS AS (round(quantity * unit_amount, 2)) STORED,
  ADD COLUMN gst_rate numeric(5,2) NOT NULL DEFAULT 18 CHECK (gst_rate BETWEEN 0 AND 28);

-- Existing rows: the client from the engagement; drafts give up the number
-- the old default handed out (only an issued invoice carries one now).
ALTER TABLE hsdg.invoices    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.invoices i SET client_entity_id = e.entity_id
  FROM hsdg.engagements e WHERE e.id = i.engagement_id;
UPDATE hsdg.invoices SET invoice_number = NULL WHERE status = 'draft';
ALTER TABLE hsdg.invoices    FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagements FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoices ALTER COLUMN client_entity_id SET NOT NULL;

-- The client always follows the engagement (never set by hand).
CREATE OR REPLACE FUNCTION hsdg.invoice_set_client() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  SELECT e.entity_id INTO NEW.client_entity_id FROM hsdg.engagements e WHERE e.id = NEW.engagement_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_set_client BEFORE INSERT OR UPDATE OF engagement_id, client_entity_id
  ON hsdg.invoices FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_set_client();

-- An issued invoice is a tax document: its number, amounts and tax facts are
-- frozen. Status, the void trail and the PDF reference may still move.
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
CREATE TRIGGER invoices_guard_issued BEFORE UPDATE ON hsdg.invoices
  FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_guard_issued();

-- Lines change only while the invoice is a draft. (A cascade from a deleted
-- invoice finds no parent and passes.)
CREATE OR REPLACE FUNCTION hsdg.invoice_line_guard_draft() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT i.status INTO st FROM hsdg.invoices i WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice''s lines can change; this invoice is %.', st
      USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER invoice_line_items_guard_draft BEFORE INSERT OR UPDATE OR DELETE
  ON hsdg.invoice_line_items FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_line_guard_draft();

-- ── 3. Who may bill a client ───────────────────────────────────────────────
-- The managing partner, or a partner or manager of the client's home office.
CREATE OR REPLACE FUNCTION hsdg.ctx_can_bill(p_entity_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_business_firmwide()
      OR (hsdg.ctx_role() IN ('partner', 'manager') AND EXISTS (
            SELECT 1 FROM hsdg.entities e
             WHERE e.id = p_entity_id AND e.home_office_id = hsdg.ctx_office_id()));
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_can_bill(uuid) TO hsdg_app;

CREATE POLICY invoices_select_billing ON hsdg.invoices
  FOR SELECT TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY invoices_update_billing ON hsdg.invoices
  FOR UPDATE TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY invoice_line_items_select_billing ON hsdg.invoice_line_items
  FOR SELECT TO hsdg_app USING (EXISTS (
    SELECT 1 FROM hsdg.invoices i
     WHERE i.id = invoice_id AND hsdg.ctx_can_bill(i.client_entity_id)));
-- The owner-run SECURITY DEFINER issue function below.
CREATE POLICY invoices_owner ON hsdg.invoices
  TO hsdg_migrator USING (true) WITH CHECK (true);

-- ── 4. Gap-free numbers per financial year ─────────────────────────────────
CREATE TABLE hsdg.billing_series (
  kind           text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  financial_year text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  last_seq       integer NOT NULL CHECK (last_seq > 0),
  PRIMARY KEY (kind, financial_year)
);
REVOKE ALL ON hsdg.billing_series FROM PUBLIC;
REVOKE ALL ON hsdg.billing_series FROM hsdg_app;

-- The next number in a series. The upsert holds the series row's lock until
-- the caller's transaction ends, so concurrent issues queue, and a rolled-back
-- issue gives its number back. Internal: only the issue functions call it.
CREATE OR REPLACE FUNCTION hsdg.next_billing_seq(p_kind text, p_fy text) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  INSERT INTO hsdg.billing_series AS s (kind, financial_year, last_seq)
  VALUES (p_kind, p_fy, 1)
  ON CONFLICT (kind, financial_year) DO UPDATE SET last_seq = s.last_seq + 1
  RETURNING last_seq;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.next_billing_seq(text, text) FROM PUBLIC;

-- '2026-10-16' → '2026-27' (April starts the year).
CREATE OR REPLACE FUNCTION hsdg.financial_year_of(p_date date) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = hsdg, pg_temp AS $$
  SELECT y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0')
    FROM (SELECT CASE WHEN extract(month FROM p_date) >= 4
                      THEN extract(year FROM p_date)::int
                      ELSE extract(year FROM p_date)::int - 1 END AS y) t;
$$;
GRANT EXECUTE ON FUNCTION hsdg.financial_year_of(date) TO hsdg_app;

-- <prefix>/<YY-YY>/<seq>, e.g. INV/26-27/0001. Internal.
CREATE OR REPLACE FUNCTION hsdg.next_invoice_number(p_fy text, OUT number text, OUT seq integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE v_prefix text;
BEGIN
  SELECT f.invoice_prefix INTO v_prefix FROM hsdg.firm_settings f LIMIT 1;
  seq := hsdg.next_billing_seq('invoice', p_fy);
  number := COALESCE(v_prefix, 'INV') || '/' || substr(p_fy, 3) || '/'
            || lpad(seq::text, greatest(4, length(seq::text)), '0');
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.next_invoice_number(text) FROM PUBLIC;

-- Issue a draft: check the caller may bill it, lock it, number it, date it.
-- The API has already written the GST split and amount in words on the draft
-- in the same transaction.
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

-- ── 5. Permissions ─────────────────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('billing.manage', 'Draft, issue and chase the firm''s invoices; record receipts'),
  ('billing.approve', 'Void an issued invoice; approve credit notes and write-offs')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'billing.manage'
 WHERE r.slug IN ('managing_partner', 'partner', 'manager')
ON CONFLICT DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'billing.approve'
 WHERE r.slug IN ('managing_partner', 'partner')
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions
                           WHERE slug IN ('billing.manage', 'billing.approve'));
DELETE FROM hsdg.permissions WHERE slug IN ('billing.manage', 'billing.approve');
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS hsdg.issue_invoice(uuid, date);
DROP FUNCTION IF EXISTS hsdg.next_invoice_number(text);
DROP FUNCTION IF EXISTS hsdg.financial_year_of(date);
DROP FUNCTION IF EXISTS hsdg.next_billing_seq(text, text);
DROP TABLE IF EXISTS hsdg.billing_series;

DROP POLICY IF EXISTS invoices_owner ON hsdg.invoices;
DROP POLICY IF EXISTS invoice_line_items_select_billing ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoices_update_billing ON hsdg.invoices;
DROP POLICY IF EXISTS invoices_select_billing ON hsdg.invoices;
DROP FUNCTION IF EXISTS hsdg.ctx_can_bill(uuid);

DROP TRIGGER IF EXISTS invoice_line_items_guard_draft ON hsdg.invoice_line_items;
DROP FUNCTION IF EXISTS hsdg.invoice_line_guard_draft();
DROP TRIGGER IF EXISTS invoices_guard_issued ON hsdg.invoices;
DROP FUNCTION IF EXISTS hsdg.invoice_guard_issued();
DROP TRIGGER IF EXISTS invoices_set_client ON hsdg.invoices;
DROP FUNCTION IF EXISTS hsdg.invoice_set_client();

ALTER TABLE hsdg.invoice_line_items
  DROP COLUMN IF EXISTS gst_rate,
  DROP COLUMN IF EXISTS taxable_value,
  DROP COLUMN IF EXISTS sac_code;

-- Drafts get a number of the old kind back so it can be NOT NULL again.
ALTER TABLE hsdg.invoices NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.invoices
   SET invoice_number = 'INV-' || to_char(now(), 'YYYY') || '-'
                        || lpad(nextval('hsdg.invoice_number_seq')::text, 5, '0')
 WHERE invoice_number IS NULL;
ALTER TABLE hsdg.invoices FORCE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS hsdg.invoices_client_idx;
DROP INDEX IF EXISTS hsdg.invoices_fy_sequence_uniq;
ALTER TABLE hsdg.invoices
  DROP CONSTRAINT IF EXISTS invoices_void_has_reason,
  DROP CONSTRAINT IF EXISTS invoices_cgst_equals_sgst,
  DROP CONSTRAINT IF EXISTS invoices_gst_split,
  DROP CONSTRAINT IF EXISTS invoices_issued_has_number,
  DROP CONSTRAINT IF EXISTS invoices_number_length,
  DROP COLUMN IF EXISTS pdf_storage_reference,
  DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS voided_by_employee_id,
  DROP COLUMN IF EXISTS voided_reason,
  DROP COLUMN IF EXISTS issued_at,
  DROP COLUMN IF EXISTS issued_by_employee_id,
  DROP COLUMN IF EXISTS sequence_no,
  DROP COLUMN IF EXISTS financial_year,
  DROP COLUMN IF EXISTS amount_in_words,
  DROP COLUMN IF EXISTS igst,
  DROP COLUMN IF EXISTS sgst,
  DROP COLUMN IF EXISTS cgst,
  DROP COLUMN IF EXISTS is_reverse_charge,
  DROP COLUMN IF EXISTS place_of_supply_state,
  DROP COLUMN IF EXISTS client_gstin,
  DROP COLUMN IF EXISTS client_entity_id,
  ALTER COLUMN invoice_number SET NOT NULL,
  ALTER COLUMN invoice_number SET DEFAULT
    ('INV-' || to_char(now(), 'YYYY') || '-' ||
     lpad(nextval('hsdg.invoice_number_seq')::text, 5, '0'));

ALTER TABLE hsdg.firm_settings
  DROP CONSTRAINT IF EXISTS firm_settings_gstin_state,
  DROP COLUMN IF EXISTS invoice_terms_days,
  DROP COLUMN IF EXISTS invoice_prefix,
  DROP COLUMN IF EXISTS sac_default,
  DROP COLUMN IF EXISTS state_code,
  DROP COLUMN IF EXISTS gstin;
