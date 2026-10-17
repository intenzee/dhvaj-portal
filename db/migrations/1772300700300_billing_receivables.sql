-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-203 · Receivables ageing and payment reminders.
--
-- invoice_reminders — every payment reminder sent to a client about an
--                     invoice: by a biller from the invoice (e-mail, a WhatsApp
--                     link, or text to copy — the client-chase channels), or
--                     by the scan's optional automatic e-mail.
-- firm_settings     — invoice_reminder_days (days after due for the automatic
--                     e-mails) and auto_invoice_reminders, off until the
--                     partners turn it on.
--
-- invoice_overdue (raised by the scan at 15, 30 and 60 days past due) clears
-- itself when the invoice is paid in full or voided: a SECURITY DEFINER
-- trigger, as PS-205's.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.firm_settings
  ADD COLUMN invoice_reminder_days integer[] NOT NULL DEFAULT '{7,15,30}'
    CONSTRAINT firm_settings_invoice_reminder_days_range
    CHECK (cardinality(invoice_reminder_days) <= 6
           AND 1 <= ALL (invoice_reminder_days) AND 365 >= ALL (invoice_reminder_days)),
  ADD COLUMN auto_invoice_reminders boolean NOT NULL DEFAULT false;

CREATE TABLE hsdg.invoice_reminders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid NOT NULL REFERENCES hsdg.invoices (id),
  client_entity_id    uuid NOT NULL REFERENCES hsdg.entities (id),
  engagement_id       uuid NOT NULL REFERENCES hsdg.engagements (id),
  channel             text NOT NULL CHECK (channel IN ('email', 'whatsapp', 'copy')),
  -- The scan's e-mail at one of invoice_reminder_days; null when sent by hand.
  auto_at_days        integer CHECK (auto_at_days IS NULL OR auto_at_days > 0),
  days_past_due       integer,
  sent_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_reminders_auto_by_email CHECK (auto_at_days IS NULL OR channel = 'email')
);
CREATE INDEX invoice_reminders_invoice_idx ON hsdg.invoice_reminders (invoice_id, created_at DESC);
-- One automatic e-mail per invoice per threshold, however often the scan runs.
CREATE UNIQUE INDEX invoice_reminders_auto_once
  ON hsdg.invoice_reminders (invoice_id, auto_at_days) WHERE auto_at_days IS NOT NULL;

ALTER TABLE hsdg.invoice_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoice_reminders FORCE  ROW LEVEL SECURITY;
CREATE POLICY invoice_reminders_billing ON hsdg.invoice_reminders
  TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY invoice_reminders_owner ON hsdg.invoice_reminders
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.invoice_reminders TO hsdg_app;

-- Paid in full or voided: the "invoice overdue" nudges are done.
CREATE OR REPLACE FUNCTION hsdg.invoice_overdue_resolved() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM hsdg.resolve_notifications('invoice', ARRAY[NEW.id], ARRAY['invoice_overdue']);
  RETURN NULL;
END;
$$;
CREATE TRIGGER invoices_overdue_resolved
  AFTER UPDATE OF status ON hsdg.invoices
  FOR EACH ROW WHEN (NEW.status IN ('paid', 'void') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.invoice_overdue_resolved();

-- Down Migration

DROP TRIGGER IF EXISTS invoices_overdue_resolved ON hsdg.invoices;
DROP FUNCTION IF EXISTS hsdg.invoice_overdue_resolved();
DROP TABLE IF EXISTS hsdg.invoice_reminders;
ALTER TABLE hsdg.firm_settings
  DROP COLUMN IF EXISTS auto_invoice_reminders,
  DROP COLUMN IF EXISTS invoice_reminder_days;
