-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-204 · TDS on our fees against the firm's 26AS.
--
-- Clients deduct TDS from our fees (PS-202 books it on the receipt); the
-- credit is ours only once their TDS return puts it in the firm's 26AS.
--
-- firm_tds_import_batches — one imported file: the 26AS text export from
--                           TRACES (a whole financial year) or a Form 16A
--                           (one deductor, one quarter). Who, when, for which
--                           PAN and year.
-- firm_tds_credits        — its Part I rows: deductor TAN and name, section,
--                           transaction date, amount paid, TDS deposited, the
--                           booking status. A later file supersedes what it
--                           covers: a 26AS every row of its year, a Form 16A
--                           its deductor's quarter. Matching (in the API, on
--                           the fly) reads the rows not superseded.
-- tds_reminders           — a client asked to file or correct their TDS
--                           return for deductions missing from the 26AS, on
--                           the client-chase channels (PS-203's).
-- firm_settings           — tds_match_tolerance: how far, in rupees, a 26AS
--                           credit may differ from the TDS booked and still
--                           match (deductors round to the rupee).
--
-- A credit is seen by those who may bill the client whose TAN it carries
-- (hsdg.ctx_can_bill); a TAN on no client only by the managing partner.
-- billing.manage (import, remind) is enforced by the API.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings
  ADD COLUMN tds_match_tolerance numeric(10,2) NOT NULL DEFAULT 1.00
    CONSTRAINT firm_settings_tds_match_tolerance_range
    CHECK (tds_match_tolerance >= 0 AND tds_match_tolerance <= 1000);

CREATE TABLE hsdg.firm_tds_import_batches (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                  text NOT NULL CHECK (source IN ('26as_text', 'form16a_pdf')),
  file_name               text NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 400),
  file_sha256             text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  pan                     text CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  financial_year          text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  credits_count           integer NOT NULL CHECK (credits_count > 0),
  tds_total               numeric(14,2) NOT NULL CHECK (tds_total >= 0),
  -- Rows of earlier files this one replaced; null until it has been applied.
  superseded_count        integer CHECK (superseded_count >= 0),
  imported_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firm_tds_import_batches_year_idx
  ON hsdg.firm_tds_import_batches (financial_year, created_at DESC);

CREATE TABLE hsdg.firm_tds_credits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id        uuid NOT NULL REFERENCES hsdg.firm_tds_import_batches (id),
  deductor_tan           text NOT NULL CHECK (deductor_tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  deductor_name          text NOT NULL CHECK (length(trim(deductor_name)) BETWEEN 1 AND 300),
  section                text NOT NULL CHECK (length(trim(section)) BETWEEN 1 AND 20),
  transaction_date       date NOT NULL,
  amount_paid            numeric(14,2) NOT NULL CHECK (amount_paid >= 0),
  tax_deducted           numeric(14,2) NOT NULL CHECK (tax_deducted >= 0),
  tds_deposited          numeric(14,2) NOT NULL CHECK (tds_deposited >= 0),
  -- 26AS "Status of Booking": F final, P provisional, U unmatched, O overbooked.
  booking_status         text CHECK (booking_status ~ '^[A-Z]$'),
  booking_date           date,
  quarter                text NOT NULL CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  financial_year         text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  superseded_by_batch_id uuid REFERENCES hsdg.firm_tds_import_batches (id),
  CONSTRAINT firm_tds_credits_not_self_superseded
    CHECK (superseded_by_batch_id IS DISTINCT FROM import_batch_id)
);
CREATE INDEX firm_tds_credits_active_idx ON hsdg.firm_tds_credits (financial_year, deductor_tan)
  WHERE superseded_by_batch_id IS NULL;
CREATE INDEX firm_tds_credits_batch_idx ON hsdg.firm_tds_credits (import_batch_id);

CREATE TABLE hsdg.tds_reminders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_entity_id    uuid NOT NULL REFERENCES hsdg.entities (id),
  financial_year      text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  quarter             text CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  channel             text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'copy')),
  receipt_ids         uuid[] NOT NULL CHECK (cardinality(receipt_ids) > 0),
  tds_amount          numeric(14,2) NOT NULL CHECK (tds_amount > 0),
  sent_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tds_reminders_client_idx
  ON hsdg.tds_reminders (client_entity_id, financial_year, created_at DESC);

-- ── Who sees a credit ──────────────────────────────────────────────────────
-- Those who may bill the client registered under the deductor's TAN.
-- SECURITY DEFINER so the lookup reads every registration; ctx_can_bill
-- still answers for the caller.
CREATE OR REPLACE FUNCTION hsdg.ctx_sees_tds_tan(p_tan text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_business_firmwide() OR EXISTS (
    SELECT 1 FROM hsdg.entity_registrations r
     WHERE r.registration_type = 'tan'
       AND upper(replace(r.registration_number, ' ', '')) = p_tan
       AND hsdg.ctx_can_bill(r.entity_id));
$$;
REVOKE EXECUTE ON FUNCTION hsdg.ctx_sees_tds_tan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_sees_tds_tan(text) TO hsdg_app;

ALTER TABLE hsdg.firm_tds_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.firm_tds_import_batches FORCE  ROW LEVEL SECURITY;
CREATE POLICY firm_tds_import_batches_select ON hsdg.firm_tds_import_batches
  FOR SELECT TO hsdg_app USING (hsdg.ctx_employee_id() IS NOT NULL);
CREATE POLICY firm_tds_import_batches_insert ON hsdg.firm_tds_import_batches
  FOR INSERT TO hsdg_app
  WITH CHECK (imported_by_employee_id = hsdg.ctx_employee_id() AND superseded_count IS NULL);
CREATE POLICY firm_tds_import_batches_owner ON hsdg.firm_tds_import_batches
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.firm_tds_import_batches TO hsdg_app;

ALTER TABLE hsdg.firm_tds_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.firm_tds_credits FORCE  ROW LEVEL SECURITY;
CREATE POLICY firm_tds_credits_select ON hsdg.firm_tds_credits
  FOR SELECT TO hsdg_app USING (hsdg.ctx_sees_tds_tan(deductor_tan));
-- Only into a batch of the caller's that has not been applied yet.
CREATE POLICY firm_tds_credits_insert ON hsdg.firm_tds_credits
  FOR INSERT TO hsdg_app WITH CHECK (
    superseded_by_batch_id IS NULL AND EXISTS (
      SELECT 1 FROM hsdg.firm_tds_import_batches b
       WHERE b.id = import_batch_id
         AND b.imported_by_employee_id = hsdg.ctx_employee_id()
         AND b.superseded_count IS NULL));
CREATE POLICY firm_tds_credits_owner ON hsdg.firm_tds_credits
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.firm_tds_credits TO hsdg_app;

ALTER TABLE hsdg.tds_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.tds_reminders FORCE  ROW LEVEL SECURITY;
CREATE POLICY tds_reminders_billing ON hsdg.tds_reminders
  TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY tds_reminders_owner ON hsdg.tds_reminders
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.tds_reminders TO hsdg_app;

-- ── Applying a file ────────────────────────────────────────────────────────
-- The new file's rows replace the earlier ones it covers — a 26AS every row
-- of its year, a Form 16A its deductors' quarters — including rows the
-- importer cannot see (another office's clients), hence SECURITY DEFINER.
-- Once per batch, by its importer; the caller holds the year's lock.
CREATE OR REPLACE FUNCTION hsdg.apply_tds_import(p_batch_id uuid) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  b record;
  n integer;
BEGIN
  SELECT * INTO b FROM hsdg.firm_tds_import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND OR b.imported_by_employee_id IS DISTINCT FROM hsdg.ctx_employee_id() THEN
    RAISE EXCEPTION 'Import not found.' USING ERRCODE = 'P0002';
  END IF;
  IF b.superseded_count IS NOT NULL THEN
    RAISE EXCEPTION 'This import has already been applied.' USING ERRCODE = '22023';
  END IF;
  IF b.source = '26as_text' THEN
    UPDATE hsdg.firm_tds_credits c
       SET superseded_by_batch_id = p_batch_id
     WHERE c.financial_year = b.financial_year
       AND c.import_batch_id <> p_batch_id
       AND c.superseded_by_batch_id IS NULL;
  ELSE
    UPDATE hsdg.firm_tds_credits c
       SET superseded_by_batch_id = p_batch_id
     WHERE c.financial_year = b.financial_year
       AND c.import_batch_id <> p_batch_id
       AND c.superseded_by_batch_id IS NULL
       AND (c.deductor_tan, c.quarter) IN (
             SELECT n.deductor_tan, n.quarter FROM hsdg.firm_tds_credits n
              WHERE n.import_batch_id = p_batch_id);
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE hsdg.firm_tds_import_batches SET superseded_count = n WHERE id = p_batch_id;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION hsdg.apply_tds_import(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.apply_tds_import(uuid) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.apply_tds_import(uuid);
DROP TABLE IF EXISTS hsdg.tds_reminders;
DROP TABLE IF EXISTS hsdg.firm_tds_credits;
DROP TABLE IF EXISTS hsdg.firm_tds_import_batches;
DROP FUNCTION IF EXISTS hsdg.ctx_sees_tds_tan(text);
ALTER TABLE hsdg.firm_settings DROP COLUMN IF EXISTS tds_match_tolerance;
