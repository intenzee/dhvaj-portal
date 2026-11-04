-- Up Migration
--
-- Quick invoices (Phase 4).
--
-- firm_settings              — the firm on its invoice PDF in full: PAN, phone,
--                              website, bank account (name, bank, number, IFSC,
--                              branch), UPI and a logo (PNG / JPEG, ≤ 500 KB).
-- invoice_line_items         — engagement_service_id: which of the engagement's
--                              services a line bills (informational, no FK — the
--                              lines of an issued invoice never change).
-- invoice_sends              — every time an invoice went to the client: e-mail
--                              (outbox), a WhatsApp link, or "open in mail app".
-- invoice_share_links        — a signed, expiring link to the invoice PDF that
--                              the e-mail / WhatsApp text carries. Only the
--                              token's SHA-256 is kept; the public read is a
--                              SECURITY DEFINER function.
-- recurring_invoice_schedules — one per engagement service: amount, GST %, day
--                              of the month and a mode: active (issued as is
--                              every month), manual (a draft each month to
--                              change and issue) or paused (nothing).

ALTER TABLE hsdg.firm_settings
  ADD COLUMN pan                  text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  ADD COLUMN phone                text CHECK (phone IS NULL OR length(phone) <= 40),
  ADD COLUMN website              text CHECK (website IS NULL OR length(website) <= 200),
  ADD COLUMN bank_account_name    text CHECK (bank_account_name IS NULL OR length(bank_account_name) <= 200),
  ADD COLUMN bank_name            text CHECK (bank_name IS NULL OR length(bank_name) <= 200),
  ADD COLUMN bank_account_number  text CHECK (bank_account_number IS NULL OR bank_account_number ~ '^[0-9A-Z]{6,20}$'),
  ADD COLUMN bank_ifsc            text CHECK (bank_ifsc IS NULL OR bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  ADD COLUMN bank_branch          text CHECK (bank_branch IS NULL OR length(bank_branch) <= 200),
  ADD COLUMN upi_id               text CHECK (upi_id IS NULL OR upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$'),
  ADD COLUMN logo                 bytea CHECK (logo IS NULL OR octet_length(logo) <= 512000),
  ADD COLUMN logo_content_type    text CHECK (logo_content_type IS NULL OR logo_content_type IN ('image/png', 'image/jpeg')),
  ADD CONSTRAINT firm_settings_logo_typed CHECK ((logo IS NULL) = (logo_content_type IS NULL));
GRANT SELECT (pan, phone, website, bank_account_name, bank_name, bank_account_number, bank_ifsc,
              bank_branch, upi_id, logo, logo_content_type) ON hsdg.firm_settings TO hsdg_app;
GRANT UPDATE (pan, phone, website, bank_account_name, bank_name, bank_account_number, bank_ifsc,
              bank_branch, upi_id, logo, logo_content_type) ON hsdg.firm_settings TO hsdg_app;

ALTER TABLE hsdg.invoice_line_items ADD COLUMN engagement_service_id uuid;
CREATE INDEX invoice_line_items_service_idx
  ON hsdg.invoice_line_items (engagement_service_id) WHERE engagement_service_id IS NOT NULL;

-- ── Sends ──────────────────────────────────────────────────────────────────
CREATE TABLE hsdg.invoice_sends (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           uuid NOT NULL REFERENCES hsdg.invoices (id) ON DELETE CASCADE,
  channel              text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'mail_app')),
  recipient            text CHECK (recipient IS NULL OR length(recipient) <= 320),
  sent_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  automatic            boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_sends_invoice_idx ON hsdg.invoice_sends (invoice_id, created_at DESC);
ALTER TABLE hsdg.invoice_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoice_sends FORCE  ROW LEVEL SECURITY;
-- Whoever sees the invoice sees (and logs) its sends.
CREATE POLICY invoice_sends_visible ON hsdg.invoice_sends TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.invoices i WHERE i.id = invoice_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.invoices i WHERE i.id = invoice_id));
CREATE POLICY invoice_sends_owner ON hsdg.invoice_sends
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.invoice_sends TO hsdg_app;

-- ── Share links ────────────────────────────────────────────────────────────
CREATE TABLE hsdg.invoice_share_links (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id              uuid NOT NULL REFERENCES hsdg.invoices (id) ON DELETE CASCADE,
  token_hash              text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at              timestamptz NOT NULL,
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  opened_count            integer NOT NULL DEFAULT 0,
  last_opened_at          timestamptz
);
CREATE INDEX invoice_share_links_invoice_idx ON hsdg.invoice_share_links (invoice_id);
ALTER TABLE hsdg.invoice_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoice_share_links FORCE  ROW LEVEL SECURITY;
CREATE POLICY invoice_share_links_visible ON hsdg.invoice_share_links TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.invoices i WHERE i.id = invoice_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.invoices i WHERE i.id = invoice_id));
CREATE POLICY invoice_share_links_owner ON hsdg.invoice_share_links
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.invoice_share_links TO hsdg_app;

-- The public read: a token's invoice, if the link is live and the invoice
-- issued (not void). Counts the open. The only path in for an unsigned caller.
CREATE OR REPLACE FUNCTION hsdg.invoice_share_link_open(p_token_hash text, p_count boolean)
  RETURNS TABLE (
    valid boolean, invoice_number text, issue_date date, due_date date, total numeric,
    balance numeric, status text, firm_name text, client_name text, pdf_storage_reference text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE v_link hsdg.invoice_share_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM hsdg.invoice_share_links l
   WHERE l.token_hash = p_token_hash AND l.expires_at > now();
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::date, NULL::date, NULL::numeric, NULL::numeric,
                        NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF p_count THEN
    UPDATE hsdg.invoice_share_links SET opened_count = opened_count + 1, last_opened_at = now()
     WHERE id = v_link.id;
  END IF;
  -- The client's name: entities is FORCE RLS; the billing-scope read (as the
  -- billing views use) for this statement only.
  PERFORM set_config('hsdg.billing_scope', 'on', true);
  RETURN QUERY
    SELECT i.status NOT IN ('draft', 'void') AND i.pdf_storage_reference IS NOT NULL,
           i.invoice_number, i.issue_date, i.due_date, i.total, i.total - i.amount_settled,
           i.status, (SELECT f.firm_name FROM hsdg.firm_settings f LIMIT 1), e.legal_name,
           CASE WHEN i.status NOT IN ('draft', 'void') THEN i.pdf_storage_reference END
      FROM hsdg.invoices i
      LEFT JOIN hsdg.entities e ON e.id = i.client_entity_id
     WHERE i.id = v_link.invoice_id;
  PERFORM set_config('hsdg.billing_scope', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.invoice_share_link_open(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.invoice_share_link_open(text, boolean) TO hsdg_app;

-- ── Recurring schedules ────────────────────────────────────────────────────
CREATE TABLE hsdg.recurring_invoice_schedules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id           uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  engagement_service_id   uuid NOT NULL UNIQUE REFERENCES hsdg.engagement_services (id) ON DELETE CASCADE,
  description             text CHECK (description IS NULL OR length(trim(description)) BETWEEN 1 AND 300),
  amount                  numeric(14, 2) NOT NULL CHECK (amount > 0),
  gst_rate                numeric(5, 2) NOT NULL DEFAULT 18 CHECK (gst_rate IN (0, 5, 12, 18, 28)),
  day_of_month            smallint NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  mode                    text NOT NULL DEFAULT 'active' CHECK (mode IN ('active', 'manual', 'paused')),
  next_run_on             date NOT NULL,
  last_run_on             date,
  last_invoice_id         uuid REFERENCES hsdg.invoices (id) ON DELETE SET NULL,
  last_error              text,
  created_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  updated_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recurring_invoice_schedules_due_idx
  ON hsdg.recurring_invoice_schedules (next_run_on) WHERE mode <> 'paused';
CREATE INDEX recurring_invoice_schedules_engagement_idx
  ON hsdg.recurring_invoice_schedules (engagement_id);
ALTER TABLE hsdg.recurring_invoice_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.recurring_invoice_schedules FORCE  ROW LEVEL SECURITY;
-- Whoever sees the engagement's invoices: members read; leads and billing
-- staff (the invoice write policies) set them — the API asks the permission.
CREATE POLICY recurring_invoice_schedules_read ON hsdg.recurring_invoice_schedules
  FOR SELECT TO hsdg_app
  USING (hsdg.is_engagement_member(engagement_id)
         OR hsdg.ctx_can_bill((SELECT e.entity_id FROM hsdg.engagements e WHERE e.id = engagement_id)));
CREATE POLICY recurring_invoice_schedules_write ON hsdg.recurring_invoice_schedules
  TO hsdg_app
  USING (hsdg.is_engagement_lead(engagement_id)
         OR hsdg.ctx_can_bill((SELECT e.entity_id FROM hsdg.engagements e WHERE e.id = engagement_id)))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id)
         OR hsdg.ctx_can_bill((SELECT e.entity_id FROM hsdg.engagements e WHERE e.id = engagement_id)));
CREATE POLICY recurring_invoice_schedules_owner ON hsdg.recurring_invoice_schedules
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.recurring_invoice_schedules TO hsdg_app;

-- Down Migration
DROP TABLE IF EXISTS hsdg.recurring_invoice_schedules;
DROP FUNCTION IF EXISTS hsdg.invoice_share_link_open(text, boolean);
DROP TABLE IF EXISTS hsdg.invoice_share_links;
DROP TABLE IF EXISTS hsdg.invoice_sends;
DROP INDEX IF EXISTS hsdg.invoice_line_items_service_idx;
ALTER TABLE hsdg.invoice_line_items DROP COLUMN IF EXISTS engagement_service_id;
ALTER TABLE hsdg.firm_settings
  DROP CONSTRAINT IF EXISTS firm_settings_logo_typed,
  DROP COLUMN IF EXISTS logo_content_type,
  DROP COLUMN IF EXISTS logo,
  DROP COLUMN IF EXISTS upi_id,
  DROP COLUMN IF EXISTS bank_branch,
  DROP COLUMN IF EXISTS bank_ifsc,
  DROP COLUMN IF EXISTS bank_account_number,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS bank_account_name,
  DROP COLUMN IF EXISTS website,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS pan;
