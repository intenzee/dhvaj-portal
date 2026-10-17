-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-206 · the gaps: fees not billed here, and milestone
-- and event fees.
--
-- fee_billings               — a period can now be set aside without an
--                              invoice ("billed outside the app", "not
--                              billing this"): no invoice or line, a reason.
--                              The open row keeps it off the unbilled list;
--                              restoring it (released_at) puts it back.
-- engagement_fee_milestones  — a fee the engagement bills on a milestone or
--                              an event: what, how much, from when. Due on
--                              that date, it joins the unbilled list.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.fee_billings
  ALTER COLUMN billed_invoice_id DROP NOT NULL,
  ALTER COLUMN invoice_line_id DROP NOT NULL,
  -- What the list called the period, kept for the set-aside list.
  ADD COLUMN label text CHECK (label IS NULL OR length(label) BETWEEN 1 AND 300),
  ADD COLUMN skip_reason text CHECK (skip_reason IS NULL OR length(trim(skip_reason)) BETWEEN 3 AND 500),
  ADD CONSTRAINT fee_billings_invoice_or_reason CHECK (
    (billed_invoice_id IS NULL) = (invoice_line_id IS NULL)
    AND (billed_invoice_id IS NULL) = (skip_reason IS NOT NULL));

CREATE OR REPLACE FUNCTION hsdg.fee_billing_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  inv record;
BEGIN
  IF NEW.billed_invoice_id IS NULL THEN
    SELECT e.entity_id INTO NEW.client_entity_id FROM hsdg.engagements e WHERE e.id = NEW.engagement_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Engagement not found.' USING ERRCODE = 'P0002';
    END IF;
    RETURN NEW;
  END IF;
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

-- Only released, and only once; the rest of the row is history.
CREATE OR REPLACE FUNCTION hsdg.fee_billing_release_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
     OR (to_jsonb(NEW) - 'released_at') <> (to_jsonb(OLD) - 'released_at') THEN
    RAISE EXCEPTION 'A fee billing can only be released, once.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_billings_release_only';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fee_billings_release_only
  BEFORE UPDATE ON hsdg.fee_billings
  FOR EACH ROW EXECUTE FUNCTION hsdg.fee_billing_release_only();

-- A lead restores a period set aside; invoice rows are released by voiding.
CREATE POLICY fee_billings_restore ON hsdg.fee_billings
  FOR UPDATE TO hsdg_app
  USING (billed_invoice_id IS NULL AND hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (billed_invoice_id IS NULL AND hsdg.is_engagement_lead(engagement_id));
GRANT UPDATE (released_at) ON hsdg.fee_billings TO hsdg_app;

CREATE TABLE hsdg.engagement_fee_milestones (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id),
  kind                     text NOT NULL CHECK (kind IN ('milestone', 'event')),
  description              text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 300),
  amount                   numeric(14,2) NOT NULL CHECK (amount > 0),
  due_on                   date NOT NULL,
  created_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  cancelled_at             timestamptz,
  cancelled_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL
);
CREATE INDEX engagement_fee_milestones_engagement_idx
  ON hsdg.engagement_fee_milestones (engagement_id, due_on);

ALTER TABLE hsdg.engagement_fee_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.engagement_fee_milestones FORCE  ROW LEVEL SECURITY;
CREATE POLICY engagement_fee_milestones_select ON hsdg.engagement_fee_milestones
  FOR SELECT TO hsdg_app USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY engagement_fee_milestones_insert ON hsdg.engagement_fee_milestones
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_fee_milestones_update ON hsdg.engagement_fee_milestones
  FOR UPDATE TO hsdg_app USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY engagement_fee_milestones_owner ON hsdg.engagement_fee_milestones
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.engagement_fee_milestones TO hsdg_app;
GRANT UPDATE (cancelled_at, cancelled_by_employee_id) ON hsdg.engagement_fee_milestones TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.engagement_fee_milestones;
REVOKE UPDATE (released_at) ON hsdg.fee_billings FROM hsdg_app;
DROP POLICY IF EXISTS fee_billings_restore ON hsdg.fee_billings;
DROP TRIGGER IF EXISTS fee_billings_release_only ON hsdg.fee_billings;
DROP FUNCTION IF EXISTS hsdg.fee_billing_release_only();
ALTER TABLE hsdg.fee_billings DISABLE TRIGGER USER;
DELETE FROM hsdg.fee_billings WHERE billed_invoice_id IS NULL;
ALTER TABLE hsdg.fee_billings ENABLE TRIGGER USER;
ALTER TABLE hsdg.fee_billings
  DROP CONSTRAINT IF EXISTS fee_billings_invoice_or_reason,
  DROP COLUMN IF EXISTS skip_reason,
  DROP COLUMN IF EXISTS label,
  ALTER COLUMN invoice_line_id SET NOT NULL,
  ALTER COLUMN billed_invoice_id SET NOT NULL;
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
