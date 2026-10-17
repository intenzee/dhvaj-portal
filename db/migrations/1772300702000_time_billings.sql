-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-206 (fix) · time billed once.
--
-- "Bill from time" drafted invoice lines from billable hours but never marked
-- the hours billed, so the same time could go on a second invoice.
--
-- time_billings — one row per time entry put on an invoice line: the entry
--                 (always the original; an approved correction keeps its
--                 original's billing), the seconds and the hourly rate billed.
--                 The open row (released_at null) is what stops the entry
--                 being billed twice; it is taken when the entry goes on a
--                 draft, released when the invoice is voided, and goes with
--                 the line if the line is taken off the draft — the same
--                 rules as fee_billings (PS-206).
--
-- Charge-out rates per grade or person are PS-302; the rate here is the one
-- typed in on the draft.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.time_billings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id),
  client_entity_id       uuid NOT NULL REFERENCES hsdg.entities (id),
  time_entry_id          uuid NOT NULL REFERENCES hsdg.engagement_time_entries (id),
  seconds                integer NOT NULL CHECK (seconds > 0),
  rate_per_hour          numeric(14,2) NOT NULL CHECK (rate_per_hour > 0),
  billed_invoice_id      uuid NOT NULL REFERENCES hsdg.invoices (id),
  invoice_line_id        uuid NOT NULL REFERENCES hsdg.invoice_line_items (id) ON DELETE CASCADE,
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  released_at            timestamptz
);
-- An entry is on at most one live invoice.
CREATE UNIQUE INDEX time_billings_once
  ON hsdg.time_billings (time_entry_id) WHERE released_at IS NULL;
CREATE INDEX time_billings_invoice_idx ON hsdg.time_billings (billed_invoice_id);
CREATE INDEX time_billings_line_idx ON hsdg.time_billings (invoice_line_id);
CREATE INDEX time_billings_engagement_idx ON hsdg.time_billings (engagement_id) WHERE released_at IS NULL;

-- The line is on a draft of this engagement; the entry is this engagement's
-- billable, stopped, original time with no correction waiting.
CREATE OR REPLACE FUNCTION hsdg.time_billing_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  inv record;
  te  record;
BEGIN
  SELECT i.engagement_id, i.client_entity_id, i.status INTO inv
    FROM hsdg.invoices i
    JOIN hsdg.invoice_line_items l ON l.invoice_id = i.id
   WHERE i.id = NEW.billed_invoice_id AND l.id = NEW.invoice_line_id;
  IF NOT FOUND OR inv.engagement_id <> NEW.engagement_id THEN
    RAISE EXCEPTION 'The time line is not on this engagement''s invoice.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_billings_line';
  END IF;
  IF inv.status <> 'draft' THEN
    RAISE EXCEPTION 'Time goes on a draft invoice only.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_billings_draft';
  END IF;
  SELECT t.engagement_id, t.is_billable, t.ended_at, t.adjusts_entry_id,
         EXISTS (SELECT 1 FROM hsdg.engagement_time_entries a
                  WHERE a.adjusts_entry_id = t.id AND a.adjustment_status = 'pending') AS pending
    INTO te
    FROM hsdg.engagement_time_entries t
   WHERE t.id = NEW.time_entry_id;
  IF NOT FOUND OR te.engagement_id <> NEW.engagement_id OR te.adjusts_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'The time entry is not this engagement''s.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_billings_entry';
  END IF;
  IF NOT te.is_billable OR te.ended_at IS NULL OR te.pending THEN
    RAISE EXCEPTION 'Only stopped, billable time with no correction waiting is billed.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_billings_billable';
  END IF;
  NEW.client_entity_id := inv.client_entity_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER time_billings_guard
  BEFORE INSERT ON hsdg.time_billings
  FOR EACH ROW EXECUTE FUNCTION hsdg.time_billing_guard();

-- Only released, and only once; the rest of the row is history.
CREATE OR REPLACE FUNCTION hsdg.time_billing_release_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
     OR (to_jsonb(NEW) - 'released_at') <> (to_jsonb(OLD) - 'released_at') THEN
    RAISE EXCEPTION 'A time billing can only be released, once.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_billings_release_only';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER time_billings_release_only
  BEFORE UPDATE ON hsdg.time_billings
  FOR EACH ROW EXECUTE FUNCTION hsdg.time_billing_release_only();

ALTER TABLE hsdg.time_billings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.time_billings FORCE  ROW LEVEL SECURITY;
CREATE POLICY time_billings_select ON hsdg.time_billings
  FOR SELECT TO hsdg_app
  USING (hsdg.ctx_can_bill(client_entity_id) OR hsdg.is_engagement_member(engagement_id));
CREATE POLICY time_billings_insert ON hsdg.time_billings
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY time_billings_owner ON hsdg.time_billings
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.time_billings TO hsdg_app;

-- Voided: its time is unbilled again (SECURITY DEFINER, as fee_billings').
CREATE OR REPLACE FUNCTION hsdg.time_billings_release() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  UPDATE hsdg.time_billings SET released_at = now()
   WHERE billed_invoice_id = NEW.id AND released_at IS NULL;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invoices_release_time
  AFTER UPDATE OF status ON hsdg.invoices
  FOR EACH ROW WHEN (NEW.status = 'void' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.time_billings_release();

-- Down Migration

DROP TRIGGER IF EXISTS invoices_release_time ON hsdg.invoices;
DROP FUNCTION IF EXISTS hsdg.time_billings_release();
DROP TABLE IF EXISTS hsdg.time_billings;
DROP FUNCTION IF EXISTS hsdg.time_billing_release_only();
DROP FUNCTION IF EXISTS hsdg.time_billing_guard();
