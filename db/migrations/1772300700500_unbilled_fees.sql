-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-206 · Unbilled fixed fees into a draft invoice.
--
-- fee_billings — one row per fixed-fee period put on an invoice: the
--                engagement's retainer for a month, quarter or year, or a
--                share of a compliance year's fee. The open row (released_at
--                null) is what stops the period being billed twice; it is
--                taken when the period goes on a draft, released when the
--                invoice is voided, and goes with the line if the line is
--                taken off the draft.
--
-- Time entries join in PS-302 (charge-out rates, billable and approved time).
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.fee_billings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id),
  client_entity_id       uuid NOT NULL REFERENCES hsdg.entities (id),
  -- 'retainer:2026-09', 'retainer:2026-27:Q2', 'year:<year id>:2026-27', …
  period_key             text NOT NULL CHECK (length(period_key) BETWEEN 1 AND 120),
  period_start           date NOT NULL,
  period_end             date NOT NULL,
  amount                 numeric(14,2) NOT NULL CHECK (amount > 0),
  billed_invoice_id      uuid NOT NULL REFERENCES hsdg.invoices (id),
  invoice_line_id        uuid NOT NULL REFERENCES hsdg.invoice_line_items (id) ON DELETE CASCADE,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  released_at            timestamptz,
  CONSTRAINT fee_billings_period CHECK (period_end >= period_start)
);
-- A period is on at most one live invoice.
CREATE UNIQUE INDEX fee_billings_once
  ON hsdg.fee_billings (engagement_id, period_key) WHERE released_at IS NULL;
CREATE INDEX fee_billings_invoice_idx ON hsdg.fee_billings (billed_invoice_id);

-- The line is on the invoice, the invoice is a draft of this engagement, and
-- the client is the invoice's.
CREATE OR REPLACE FUNCTION hsdg.fee_billing_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  inv record;
BEGIN
  SELECT i.engagement_id, i.client_entity_id, i.status INTO inv
    FROM hsdg.invoices i
    JOIN hsdg.invoice_line_items l ON l.invoice_id = i.id
   WHERE i.id = NEW.billed_invoice_id AND l.id = NEW.invoice_line_id;
  IF NOT FOUND OR inv.engagement_id <> NEW.engagement_id THEN
    RAISE EXCEPTION 'The fee line is not on this engagement''s invoice.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_billings_line';
  END IF;
  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'Fees go on a draft invoice only.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_billings_draft';
  END IF;
  NEW.client_entity_id := inv.client_entity_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fee_billings_guard
  BEFORE INSERT ON hsdg.fee_billings
  FOR EACH ROW EXECUTE FUNCTION hsdg.fee_billing_guard();

ALTER TABLE hsdg.fee_billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.fee_billings FORCE  ROW LEVEL SECURITY;
CREATE POLICY fee_billings_select ON hsdg.fee_billings
  FOR SELECT TO hsdg_app
  USING (hsdg.ctx_can_bill(client_entity_id) OR hsdg.is_engagement_member(engagement_id));
CREATE POLICY fee_billings_insert ON hsdg.fee_billings
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY fee_billings_owner ON hsdg.fee_billings
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.fee_billings TO hsdg_app;

-- Voided: its fee periods are unbilled again (SECURITY DEFINER, as PS-203's).
CREATE OR REPLACE FUNCTION hsdg.fee_billings_release() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  UPDATE hsdg.fee_billings SET released_at = now()
   WHERE billed_invoice_id = NEW.id AND released_at IS NULL;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invoices_release_fees
  AFTER UPDATE OF status ON hsdg.invoices
  FOR EACH ROW WHEN (NEW.status = 'void' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.fee_billings_release();

-- Down Migration

DROP TRIGGER IF EXISTS invoices_release_fees ON hsdg.invoices;
DROP FUNCTION IF EXISTS hsdg.fee_billings_release();
DROP TABLE IF EXISTS hsdg.fee_billings;
DROP FUNCTION IF EXISTS hsdg.fee_billing_guard();
