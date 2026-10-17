-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-206 · review fixes: setting a fee aside, and who bills.
--
-- fee_billings  — a period set aside says how: billed outside the app (the
--                 outside invoice's number and date kept), or not billed
--                 (a waiver, only once a partner approved it). Rows set aside
--                 before this keep a null kind.
-- fee_waivers   — "not billing this" is a request: someone with
--                 billing.approve other than the requester approves or rejects
--                 it, as a write-off. Until approved the periods stay unbilled.
--                 Approval sets them aside (SECURITY DEFINER trigger), so the
--                 approver needs no rights on the engagement itself.
-- Who bills an engagement (ctx_may_bill_engagement): its partner or manager,
--                 or a team member who may bill the client (ctx_can_bill: the
--                 managing partner, a partner or manager of the client's
--                 office). The unbilled list, the fee_billings ledger and
--                 invoice drafting now all ask this; fee milestones are seen
--                 by engagement members, which covers every biller.
-- fee_billing_guard and fee_billing_release_only get a fixed search_path.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Who bills an engagement ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hsdg.ctx_may_bill_engagement(p_engagement_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.is_engagement_lead(p_engagement_id)
      OR (hsdg.is_engagement_member(p_engagement_id) AND EXISTS (
            SELECT 1 FROM hsdg.engagements e
             WHERE e.id = p_engagement_id AND hsdg.ctx_can_bill(e.entity_id)));
$$;
REVOKE ALL ON FUNCTION hsdg.ctx_may_bill_engagement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.ctx_may_bill_engagement(uuid) TO hsdg_app;

DROP POLICY fee_billings_insert ON hsdg.fee_billings;
CREATE POLICY fee_billings_insert ON hsdg.fee_billings
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.ctx_may_bill_engagement(engagement_id));
DROP POLICY fee_billings_restore ON hsdg.fee_billings;
CREATE POLICY fee_billings_restore ON hsdg.fee_billings
  FOR UPDATE TO hsdg_app
  USING (billed_invoice_id IS NULL AND hsdg.ctx_may_bill_engagement(engagement_id))
  WITH CHECK (billed_invoice_id IS NULL AND hsdg.ctx_may_bill_engagement(engagement_id));

-- Drafting an invoice: beside the engagement lead's own policies.
CREATE POLICY invoices_insert_billing ON hsdg.invoices
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.ctx_may_bill_engagement(engagement_id));
CREATE POLICY invoice_line_items_insert_billing ON hsdg.invoice_line_items
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.ctx_may_bill_engagement(engagement_id));
CREATE POLICY invoice_line_items_update_billing ON hsdg.invoice_line_items
  FOR UPDATE TO hsdg_app USING (hsdg.ctx_may_bill_engagement(engagement_id))
  WITH CHECK (hsdg.ctx_may_bill_engagement(engagement_id));
CREATE POLICY invoice_line_items_delete_billing ON hsdg.invoice_line_items
  FOR DELETE TO hsdg_app USING (hsdg.ctx_may_bill_engagement(engagement_id));

-- ── 2. Waivers: "not billing this", decided by a partner ──────────────────
CREATE TABLE hsdg.fee_waivers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id            uuid NOT NULL REFERENCES hsdg.engagements (id),
  client_entity_id         uuid NOT NULL REFERENCES hsdg.entities (id),
  -- [{ key, label, periodStart, periodEnd, amount }], as the unbilled list had them.
  periods                  jsonb NOT NULL CHECK (jsonb_typeof(periods) = 'array'
                                                 AND jsonb_array_length(periods) BETWEEN 1 AND 60),
  amount                   numeric(14,2) NOT NULL CHECK (amount > 0),
  reason                   text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_by_employee_id   uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at               timestamptz,
  decision_note            text CHECK (length(decision_note) <= 500),
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fee_waivers_engagement_idx ON hsdg.fee_waivers (engagement_id);
CREATE INDEX fee_waivers_pending_idx ON hsdg.fee_waivers (status) WHERE status = 'pending';
CREATE TRIGGER fee_waivers_set_updated_at BEFORE UPDATE ON hsdg.fee_waivers
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

ALTER TABLE hsdg.fee_billings
  ADD COLUMN skip_kind text CHECK (skip_kind IN ('billed_outside', 'not_billing')),
  ADD COLUMN external_invoice_number text
    CHECK (external_invoice_number IS NULL OR length(btrim(external_invoice_number)) BETWEEN 1 AND 40),
  ADD COLUMN external_invoice_date date,
  ADD COLUMN waiver_id uuid REFERENCES hsdg.fee_waivers (id),
  ADD CONSTRAINT fee_billings_skip_kind CHECK (
    (skip_kind IS NULL OR skip_reason IS NOT NULL)
    AND (skip_kind IS DISTINCT FROM 'billed_outside'
         OR (external_invoice_number IS NOT NULL AND external_invoice_date IS NOT NULL))
    AND ((skip_kind = 'not_billing') = (waiver_id IS NOT NULL)));

-- A new set-aside says how; the client follows the engagement or the invoice.
CREATE OR REPLACE FUNCTION hsdg.fee_billing_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE
  inv record;
BEGIN
  IF NEW.billed_invoice_id IS NULL THEN
    IF NEW.skip_kind IS NULL THEN
      RAISE EXCEPTION 'Say how the fee is set aside: billed outside the app, or not billed.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_billings_skip_kind';
    END IF;
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

CREATE OR REPLACE FUNCTION hsdg.fee_billing_release_only() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
     OR (to_jsonb(NEW) - 'released_at') <> (to_jsonb(OLD) - 'released_at') THEN
    RAISE EXCEPTION 'A fee billing can only be released, once.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_billings_release_only';
  END IF;
  RETURN NEW;
END;
$$;

-- A request is for the engagement's client, pending, and asks for no period
-- another pending request already has.
CREATE OR REPLACE FUNCTION hsdg.fee_waiver_request_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  SELECT e.entity_id INTO NEW.client_entity_id FROM hsdg.engagements e WHERE e.id = NEW.engagement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Engagement not found.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hsdg.fee_waivers w, jsonb_array_elements(w.periods) p
     WHERE w.engagement_id = NEW.engagement_id AND w.status = 'pending'
       AND p->>'key' IN (SELECT q->>'key' FROM jsonb_array_elements(NEW.periods) q)) THEN
    RAISE EXCEPTION 'A waiver of one of these periods is already waiting for a partner.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_waivers_once';
  END IF;
  NEW.status := 'pending';
  RETURN NEW;
END;
$$;
CREATE TRIGGER fee_waivers_request_guard BEFORE INSERT ON hsdg.fee_waivers
  FOR EACH ROW EXECUTE FUNCTION hsdg.fee_waiver_request_guard();

-- A decision is someone else's, once; nothing else about a request changes.
CREATE OR REPLACE FUNCTION hsdg.fee_waiver_decision_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'decided_by_employee_id', 'decided_at', 'decision_note',
                            'version', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'decided_by_employee_id', 'decided_at', 'decision_note',
                            'version', 'updated_at']) THEN
    RAISE EXCEPTION 'A request cannot be changed; reject it and raise another.'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')) THEN
      RAISE EXCEPTION 'This request is already %.', OLD.status USING ERRCODE = '22023';
    END IF;
    IF NEW.decided_by_employee_id IS NOT DISTINCT FROM OLD.requested_by_employee_id THEN
      RAISE EXCEPTION 'Someone other than the requester must decide it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fee_waivers_decision_guard BEFORE UPDATE ON hsdg.fee_waivers
  FOR EACH ROW EXECUTE FUNCTION hsdg.fee_waiver_decision_guard();

-- Approved: its periods are set aside as not billed. Either way the
-- approvers' "to approve" notifications clear.
CREATE OR REPLACE FUNCTION hsdg.fee_waiver_decided() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    BEGIN
      INSERT INTO hsdg.fee_billings
        (engagement_id, client_entity_id, period_key, period_start, period_end, amount, label,
         skip_reason, skip_kind, waiver_id, created_by_employee_id)
      SELECT NEW.engagement_id, NEW.client_entity_id, p.key, p."periodStart", p."periodEnd",
             p.amount, p.label, NEW.reason, 'not_billing', NEW.id, NEW.requested_by_employee_id
        FROM jsonb_to_recordset(NEW.periods)
             AS p(key text, label text, "periodStart" date, "periodEnd" date, amount numeric);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'A period of this waiver has since been billed or set aside; reject it.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_waivers_taken';
    END;
  END IF;
  PERFORM hsdg.resolve_notifications('fee_waiver', ARRAY[NEW.id], ARRAY['write_off_pending']);
  RETURN NULL;
END;
$$;
CREATE TRIGGER fee_waivers_decided AFTER UPDATE OF status ON hsdg.fee_waivers
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
  EXECUTE FUNCTION hsdg.fee_waiver_decided();

-- The client's billers ask; its partners (billing.approve, asked by the API) decide.
ALTER TABLE hsdg.fee_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.fee_waivers FORCE  ROW LEVEL SECURITY;
CREATE POLICY fee_waivers_select ON hsdg.fee_waivers
  FOR SELECT TO hsdg_app
  USING (hsdg.ctx_can_bill(client_entity_id) OR hsdg.ctx_may_bill_engagement(engagement_id));
CREATE POLICY fee_waivers_insert ON hsdg.fee_waivers
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.ctx_may_bill_engagement(engagement_id));
CREATE POLICY fee_waivers_decide ON hsdg.fee_waivers
  FOR UPDATE TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY fee_waivers_owner ON hsdg.fee_waivers
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON hsdg.fee_waivers TO hsdg_app;
GRANT UPDATE (status, decided_by_employee_id, decided_at, decision_note, version)
  ON hsdg.fee_waivers TO hsdg_app;

-- Down Migration

ALTER TABLE hsdg.fee_billings DISABLE TRIGGER USER;
DELETE FROM hsdg.fee_billings WHERE waiver_id IS NOT NULL;
ALTER TABLE hsdg.fee_billings ENABLE TRIGGER USER;
ALTER TABLE hsdg.fee_billings
  DROP CONSTRAINT IF EXISTS fee_billings_skip_kind,
  DROP COLUMN IF EXISTS waiver_id,
  DROP COLUMN IF EXISTS external_invoice_date,
  DROP COLUMN IF EXISTS external_invoice_number,
  DROP COLUMN IF EXISTS skip_kind;
DROP TABLE IF EXISTS hsdg.fee_waivers;
DROP FUNCTION IF EXISTS hsdg.fee_waiver_decided();
DROP FUNCTION IF EXISTS hsdg.fee_waiver_decision_guard();
DROP FUNCTION IF EXISTS hsdg.fee_waiver_request_guard();

DROP POLICY IF EXISTS invoice_line_items_delete_billing ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoice_line_items_update_billing ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoice_line_items_insert_billing ON hsdg.invoice_line_items;
DROP POLICY IF EXISTS invoices_insert_billing ON hsdg.invoices;
DROP POLICY fee_billings_restore ON hsdg.fee_billings;
CREATE POLICY fee_billings_restore ON hsdg.fee_billings
  FOR UPDATE TO hsdg_app
  USING (billed_invoice_id IS NULL AND hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (billed_invoice_id IS NULL AND hsdg.is_engagement_lead(engagement_id));
DROP POLICY fee_billings_insert ON hsdg.fee_billings;
CREATE POLICY fee_billings_insert ON hsdg.fee_billings
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.is_engagement_lead(engagement_id));
DROP FUNCTION IF EXISTS hsdg.ctx_may_bill_engagement(uuid);

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
