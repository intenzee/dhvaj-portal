-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-205 · Credit notes and write-offs with approval.
--
-- Reducing a bill is a partner decision and leaves a trail:
--
-- credit_notes — a GST credit note against an issued invoice: taxable value
--                and the CGST/SGST or IGST worked as on the invoice (the API
--                uses gstSplit). Numbered CN/<YY-YY>/<seq> from billing_series
--                when approved, so the series has no gaps from rejections.
-- write_offs   — an amount the firm will not collect on an invoice.
--
-- Both are requested (billing.manage) and decided (billing.approve) by
-- someone else: a trigger refuses the requester's own decision. Only an
-- approved one reduces the invoice's balance — hsdg.settle_invoice (PS-202)
-- now counts approved credit notes and write-offs alongside receipts.
--
-- Notifications: write_off_pending (actionable) goes to the approvers when a
-- request is made (the API emits it) and clears itself once anyone decides
-- (SECURITY DEFINER trigger, as PS-102's notices). invoice_overdue is added
-- to the type list now for PS-203, so the list is rebuilt once.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. Notification types ──────────────────────────────────────────────────
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending','internal_sla_approaching',
   'internal_sla_overdue','statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue','client_commitment_overdue',
   'client_dependency_overdue','client_dependency_reminder','engagement_reopened',
   'ep_changed','high_risk_exception','document_uploaded','framework_reopened',
   'framework_work_impacted','planning_signal_alert','planning_partner_attention',
   'planning_strategy_reopened','planning_understanding_reassessment',
   'planning_understanding_challenge','planning_materiality_reassessment',
   'planning_materiality_challenge','planning_areas_review',
   'planning_areas_update_required','planning_scope_reassessment',
   'planning_scope_partner_action','task_review_requested','task_returned','filing_lodged',
   'time_adjustment_pending','notice_received','notice_reply_due','notice_hearing_due',
   'write_off_pending','invoice_overdue'));

-- ── 2. Credit notes and write-offs ─────────────────────────────────────────
CREATE TABLE hsdg.credit_notes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id              uuid NOT NULL REFERENCES hsdg.invoices (id),
  client_entity_id        uuid NOT NULL REFERENCES hsdg.entities (id),
  credit_note_number      text UNIQUE CHECK (length(credit_note_number) <= 16),
  financial_year          text,
  sequence_no             integer,
  credit_date             date,
  reason                  text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  taxable_value           numeric(14,2) NOT NULL CHECK (taxable_value > 0),
  gst_rate                numeric(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 28),
  cgst                    numeric(14,2) NOT NULL DEFAULT 0 CHECK (cgst >= 0),
  sgst                    numeric(14,2) NOT NULL DEFAULT 0 CHECK (sgst >= 0),
  igst                    numeric(14,2) NOT NULL DEFAULT 0 CHECK (igst >= 0),
  total                   numeric(14,2) GENERATED ALWAYS AS (taxable_value + cgst + sgst + igst) STORED,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'void')),
  requested_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at              timestamptz,
  decision_note           text CHECK (length(decision_note) <= 500),
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_notes_cgst_equals_sgst CHECK (cgst = sgst),
  CONSTRAINT credit_notes_approved_numbered
    CHECK (status NOT IN ('approved', 'void') OR credit_note_number IS NOT NULL),
  CONSTRAINT credit_notes_series_once UNIQUE (financial_year, sequence_no)
);
CREATE INDEX credit_notes_invoice_idx ON hsdg.credit_notes (invoice_id);
CREATE INDEX credit_notes_pending_idx ON hsdg.credit_notes (status) WHERE status = 'pending';
CREATE TRIGGER credit_notes_set_updated_at BEFORE UPDATE ON hsdg.credit_notes
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.write_offs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id              uuid NOT NULL REFERENCES hsdg.invoices (id),
  client_entity_id        uuid NOT NULL REFERENCES hsdg.entities (id),
  amount                  numeric(14,2) NOT NULL CHECK (amount > 0),
  reason                  text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_by_employee_id  uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  decided_at              timestamptz,
  decision_note           text CHECK (length(decision_note) <= 500),
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX write_offs_invoice_idx ON hsdg.write_offs (invoice_id);
CREATE INDEX write_offs_pending_idx ON hsdg.write_offs (status) WHERE status = 'pending';
CREATE TRIGGER write_offs_set_updated_at BEFORE UPDATE ON hsdg.write_offs
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── 3. Requests and decisions ──────────────────────────────────────────────
-- A request is against an issued or part-paid invoice of the same client.
CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_request_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE inv record;
BEGIN
  SELECT i.client_entity_id, i.status, i.invoice_number INTO inv
    FROM hsdg.invoices i WHERE i.id = NEW.invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0002';
  END IF;
  IF inv.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'Invoice % is %; only an issued, unpaid invoice can be reduced.',
      COALESCE(inv.invoice_number, 'draft'), inv.status USING ERRCODE = '22023';
  END IF;
  NEW.client_entity_id := inv.client_entity_id;
  NEW.status := 'pending';
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_notes_request_guard BEFORE INSERT ON hsdg.credit_notes
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_adjustment_request_guard();
CREATE TRIGGER write_offs_request_guard BEFORE INSERT ON hsdg.write_offs
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_adjustment_request_guard();

-- A decision is someone else's, once; the amounts are fixed after the request.
-- An approved credit note takes the next CN number of its financial year.
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
CREATE TRIGGER credit_notes_decision_guard
  BEFORE UPDATE OF status ON hsdg.credit_notes
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_adjustment_decision_guard();
CREATE TRIGGER write_offs_decision_guard
  BEFORE UPDATE OF status ON hsdg.write_offs
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_adjustment_decision_guard();

-- (A credit note's total is generated, so NULL in NEW here; its parts are compared.)
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
CREATE TRIGGER credit_notes_frozen BEFORE UPDATE ON hsdg.credit_notes
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_adjustment_frozen();
CREATE TRIGGER write_offs_frozen BEFORE UPDATE ON hsdg.write_offs
  FOR EACH ROW EXECUTE FUNCTION hsdg.billing_adjustment_frozen();

-- A decision settles the invoice (only approved ones count) and clears the
-- approvers' "to approve" notifications.
CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_decided() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  PERFORM hsdg.settle_invoice(NEW.invoice_id);
  IF OLD.status = 'pending' THEN
    PERFORM hsdg.resolve_notifications(
      CASE TG_TABLE_NAME WHEN 'credit_notes' THEN 'credit_note' ELSE 'write_off' END,
      ARRAY[NEW.id], ARRAY['write_off_pending']);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER credit_notes_decided AFTER UPDATE OF status ON hsdg.credit_notes
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.billing_adjustment_decided();
CREATE TRIGGER write_offs_decided AFTER UPDATE OF status ON hsdg.write_offs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION hsdg.billing_adjustment_decided();

-- ── 4. Settlement counts approved credits and write-offs ───────────────────
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

-- ── 5. Who decides: the partners who bill the client ───────────────────────
-- Holders of billing.approve who may bill the client (as ctx_can_bill: the
-- managing partner firm-wide, a partner of the client's home office), for the
-- write_off_pending notification. Only for a client the caller bills, and
-- read through the caller's RLS: a manager sees the users of their own office,
-- which is the client's home office, so a managing partner seated elsewhere
-- is not notified (they still see the request on Today).
CREATE OR REPLACE FUNCTION hsdg.billing_approvers(p_entity_id uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT DISTINCT emp.id
    FROM hsdg.users u
    JOIN hsdg.user_roles ur ON ur.user_id = u.id
    JOIN hsdg.roles r ON r.id = ur.role_id
    JOIN hsdg.role_permissions rp ON rp.role_id = r.id
    JOIN hsdg.permissions p ON p.id = rp.permission_id AND p.slug = 'billing.approve'
    JOIN hsdg.employees emp ON emp.user_id = u.id
    JOIN hsdg.entities e ON e.id = p_entity_id
   WHERE u.is_active
     AND hsdg.ctx_can_bill(p_entity_id)
     AND (r.slug = 'managing_partner'
          OR (r.slug IN ('partner', 'manager') AND u.primary_office_id = e.home_office_id));
$$;
REVOKE EXECUTE ON FUNCTION hsdg.billing_approvers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.billing_approvers(uuid) TO hsdg_app;

-- ── 6. Row-level security: the client's billers ────────────────────────────
ALTER TABLE hsdg.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.credit_notes FORCE  ROW LEVEL SECURITY;
CREATE POLICY credit_notes_billing ON hsdg.credit_notes
  TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY credit_notes_owner ON hsdg.credit_notes
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.credit_notes TO hsdg_app;

ALTER TABLE hsdg.write_offs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.write_offs FORCE  ROW LEVEL SECURITY;
CREATE POLICY write_offs_billing ON hsdg.write_offs
  TO hsdg_app USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY write_offs_owner ON hsdg.write_offs
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON hsdg.write_offs TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.write_offs;
DROP TABLE IF EXISTS hsdg.credit_notes;
DROP FUNCTION IF EXISTS hsdg.billing_approvers(uuid);
DROP FUNCTION IF EXISTS hsdg.billing_adjustment_decided();
DROP FUNCTION IF EXISTS hsdg.billing_adjustment_frozen();
DROP FUNCTION IF EXISTS hsdg.billing_adjustment_decision_guard();
DROP FUNCTION IF EXISTS hsdg.billing_adjustment_request_guard();
DELETE FROM hsdg.billing_series WHERE kind = 'credit_note';

-- settle_invoice as PS-202 left it (receipts only).
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
  SELECT COALESCE(sum(a.amount), 0) INTO v_settled
    FROM hsdg.receipt_allocations a
    JOIN hsdg.receipts r ON r.id = a.receipt_id
   WHERE a.invoice_id = p_invoice_id AND r.status = 'posted';
  IF v_settled > inv.total THEN
    RAISE EXCEPTION 'Invoice % would be over-paid: % allocated against a total of %.',
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

DELETE FROM hsdg.notifications WHERE type IN ('write_off_pending', 'invoice_overdue');
ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('task_assigned','review_pending','ep_signoff_pending','internal_sla_approaching',
   'internal_sla_overdue','statutory_deadline_approaching','statutory_deadline_overdue',
   'compliance_due_today','deadline_layer_overdue','client_commitment_overdue',
   'client_dependency_overdue','client_dependency_reminder','engagement_reopened',
   'ep_changed','high_risk_exception','document_uploaded','framework_reopened',
   'framework_work_impacted','planning_signal_alert','planning_partner_attention',
   'planning_strategy_reopened','planning_understanding_reassessment',
   'planning_understanding_challenge','planning_materiality_reassessment',
   'planning_materiality_challenge','planning_areas_review',
   'planning_areas_update_required','planning_scope_reassessment',
   'planning_scope_partner_action','task_review_requested','task_returned','filing_lodged',
   'time_adjustment_pending','notice_received','notice_reply_due','notice_hearing_due'));
