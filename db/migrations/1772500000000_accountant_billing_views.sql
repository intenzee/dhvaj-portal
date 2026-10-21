-- ─────────────────────────────────────────────────────────────────────────
-- Accountant · billing views (spec docs/accountant-hr-roles-spec.md §3, §7.3).
--
-- The Accountant (hsdg.ctx_is_finance(), phase 0) bills every client but must
-- never see the client master, the engagement or its work. Phase 0 opened the
-- billing tables to them through ctx_can_bill; this migration gives them the
-- names and billing facts those rows point at, and nothing more:
--
--   entity_billing_profiles     the client as billing needs it: name, PAN,
--                               GSTIN, billing address, billing contact.
--   engagement_billing_headers  the engagement header: code, service, year,
--                               status, partner and manager.
--   employee_names              id → name, for "issued by" and the like.
--   billable_time_entries       billable time by person: hours, never the
--                               note or the task.
--   client_tans                 each client's TAN, to match TDS credits.
--
-- Each view is security_invoker: for anyone who is not finance it is a plain
-- query under their own row-level security, so partners, managers and the
-- engagement team see exactly the rows they see today. For finance callers the
-- invoker branch is empty and a SECURITY DEFINER function supplies the rows,
-- filtered by ctx_can_bill.
--
-- Why not an owner-run view over the tables: the tables FORCE row-level
-- security, so the migrator would need a standing read policy, and several
-- migrator-owned SECURITY DEFINER functions rely on the caller's policies
-- (can_read_entity_compliance, entity_independence_facts,
-- set_initial_gst_scheme, reveal_client_credential) — a standing policy would
-- widen them for everyone. Instead the migrator gets read policies that only
-- hold while hsdg.billing_scope = 'on', and only the finance functions below
-- switch it on, for their own query, clearing it again before they return
-- (and on error). hsdg_app never gains a policy here, so no child table that
-- trusts "the parent is visible" opens up.
--
-- The four billing triggers that looked up the engagement as the caller now
-- read engagement_billing_headers, so an Accountant's draft gets its client.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- ── 1. The window: migrator reads, only while billing_scope is on ─────────
CREATE POLICY entities_billing_scope ON hsdg.entities
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.billing_scope', true) = 'on');
CREATE POLICY entity_registrations_billing_scope ON hsdg.entity_registrations
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.billing_scope', true) = 'on');
CREATE POLICY entity_addresses_billing_scope ON hsdg.entity_addresses
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.billing_scope', true) = 'on');
CREATE POLICY entity_contacts_billing_scope ON hsdg.entity_contacts
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.billing_scope', true) = 'on');
CREATE POLICY engagements_billing_scope ON hsdg.engagements
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.billing_scope', true) = 'on');
CREATE POLICY employees_billing_scope ON hsdg.employees
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.billing_scope', true) = 'on');
CREATE POLICY engagement_time_entries_billing_scope ON hsdg.engagement_time_entries
  FOR SELECT TO hsdg_migrator USING (current_setting('hsdg.billing_scope', true) = 'on');

-- ── 2. Client billing profile ────────────────────────────────────────────
-- The columns, under whoever runs it. Contact and address picks match what
-- billing used before (receivables' CLIENT_EMAIL_SQL, client-chase's phone,
-- the invoice's place-of-supply fallback).
CREATE VIEW hsdg.entity_billing_profile_rows WITH (security_invoker = true) AS
  SELECT e.id, e.entity_code, e.legal_name, e.display_name, e.pan, e.home_office_id, e.status,
         g.gstin, COALESCE(g.n, 0)::int AS gstin_count,
         NULLIF(concat_ws(', ', a.line1, NULLIF(a.line2, ''), NULLIF(a.city, ''),
                          NULLIF(concat_ws(' ', NULLIF(a.state, ''), a.pincode), '')), '')
           AS billing_address,
         a.line1 AS address_line1, a.line2 AS address_line2, a.city AS address_city,
         a.state AS address_state, a.pincode AS address_pincode, a.country AS address_country,
         s.states AS address_states,
         ce.full_name AS contact_name, ce.email::text AS contact_email, cp.phone AS contact_phone
    FROM hsdg.entities e
    LEFT JOIN LATERAL (
      SELECT count(*) AS n,
             CASE WHEN count(*) = 1 THEN min(r.registration_number) END AS gstin
        FROM hsdg.entity_registrations r
       WHERE r.entity_id = e.id AND r.registration_type = 'gstin' AND r.status = 'active'
         AND r.registration_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$') g ON true
    LEFT JOIN LATERAL (
      SELECT x.line1, x.line2, x.city, x.state, x.pincode, x.country
        FROM hsdg.entity_addresses x
       WHERE x.entity_id = e.id
       ORDER BY CASE x.address_type WHEN 'registered' THEN 0 WHEN 'business' THEN 1 ELSE 2 END,
                x.is_primary DESC, x.created_at
       LIMIT 1) a ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(x.state ORDER BY
               CASE x.address_type WHEN 'registered' THEN 0 WHEN 'business' THEN 1 ELSE 2 END,
               x.is_primary DESC, x.created_at) AS states
        FROM hsdg.entity_addresses x
       WHERE x.entity_id = e.id AND x.country = 'IN' AND x.state IS NOT NULL) s ON true
    LEFT JOIN LATERAL (
      SELECT c.full_name, c.email FROM hsdg.entity_contacts c
       WHERE c.entity_id = e.id AND c.email IS NOT NULL
       ORDER BY c.is_primary DESC, c.created_at LIMIT 1) ce ON true
    LEFT JOIN LATERAL (
      SELECT c.phone FROM hsdg.entity_contacts c
       WHERE c.entity_id = e.id AND NULLIF(trim(c.phone), '') IS NOT NULL
       ORDER BY c.is_primary DESC, c.created_at LIMIT 1) cp ON true;
REVOKE ALL ON hsdg.entity_billing_profile_rows FROM PUBLIC;
GRANT SELECT ON hsdg.entity_billing_profile_rows TO hsdg_app;

-- Finance: every client it may bill. Owner-run, inside the window.
CREATE FUNCTION hsdg.finance_entity_billing_profiles()
  RETURNS SETOF hsdg.entity_billing_profile_rows
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_is_finance() THEN
    RETURN;
  END IF;
  PERFORM set_config('hsdg.billing_scope', 'on', true);
  RETURN QUERY SELECT p.* FROM hsdg.entity_billing_profile_rows p WHERE hsdg.ctx_can_bill(p.id);
  PERFORM set_config('hsdg.billing_scope', '', true);
  RETURN;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('hsdg.billing_scope', '', true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.finance_entity_billing_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.finance_entity_billing_profiles() TO hsdg_app;

CREATE VIEW hsdg.entity_billing_profiles WITH (security_invoker = true, security_barrier = true) AS
  SELECT p.* FROM hsdg.entity_billing_profile_rows p WHERE NOT hsdg.ctx_is_finance()
  UNION ALL
  SELECT f.* FROM hsdg.finance_entity_billing_profiles() f;
REVOKE ALL ON hsdg.entity_billing_profiles FROM PUBLIC;
GRANT SELECT ON hsdg.entity_billing_profiles TO hsdg_app;

-- ── 3. Engagement header (commercial view) ───────────────────────────────
CREATE VIEW hsdg.engagement_billing_header_rows WITH (security_invoker = true) AS
  SELECT g.id, g.engagement_code, g.entity_id, g.service_id, sv.name AS service_name,
         g.financial_year, g.period_label, g.office_id, g.status, g.kind, g.currency,
         g.billing_model, g.planned_start_date,
         g.engagement_partner_id, ep.full_name AS engagement_partner_name,
         g.engagement_manager_id, em.full_name AS engagement_manager_name
    FROM hsdg.engagements g
    LEFT JOIN hsdg.services sv ON sv.id = g.service_id
    LEFT JOIN hsdg.employees ep ON ep.id = g.engagement_partner_id
    LEFT JOIN hsdg.employees em ON em.id = g.engagement_manager_id;
REVOKE ALL ON hsdg.engagement_billing_header_rows FROM PUBLIC;
GRANT SELECT ON hsdg.engagement_billing_header_rows TO hsdg_app;

CREATE FUNCTION hsdg.finance_engagement_billing_headers()
  RETURNS SETOF hsdg.engagement_billing_header_rows
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_is_finance() THEN
    RETURN;
  END IF;
  PERFORM set_config('hsdg.billing_scope', 'on', true);
  RETURN QUERY
    SELECT h.* FROM hsdg.engagement_billing_header_rows h WHERE hsdg.ctx_can_bill(h.entity_id);
  PERFORM set_config('hsdg.billing_scope', '', true);
  RETURN;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('hsdg.billing_scope', '', true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.finance_engagement_billing_headers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.finance_engagement_billing_headers() TO hsdg_app;

CREATE VIEW hsdg.engagement_billing_headers WITH (security_invoker = true, security_barrier = true) AS
  SELECT h.* FROM hsdg.engagement_billing_header_rows h WHERE NOT hsdg.ctx_is_finance()
  UNION ALL
  SELECT f.* FROM hsdg.finance_engagement_billing_headers() f;
REVOKE ALL ON hsdg.engagement_billing_headers FROM PUBLIC;
GRANT SELECT ON hsdg.engagement_billing_headers TO hsdg_app;

-- ── 4. Names only ────────────────────────────────────────────────────────
CREATE FUNCTION hsdg.finance_employee_names()
  RETURNS TABLE (id uuid, full_name text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_is_finance() THEN
    RETURN;
  END IF;
  PERFORM set_config('hsdg.billing_scope', 'on', true);
  RETURN QUERY SELECT e.id, e.full_name FROM hsdg.employees e;
  PERFORM set_config('hsdg.billing_scope', '', true);
  RETURN;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('hsdg.billing_scope', '', true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.finance_employee_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.finance_employee_names() TO hsdg_app;

CREATE VIEW hsdg.employee_names WITH (security_invoker = true, security_barrier = true) AS
  SELECT e.id, e.full_name FROM hsdg.employees e WHERE NOT hsdg.ctx_is_finance()
  UNION ALL
  SELECT f.id, f.full_name FROM hsdg.finance_employee_names() f;
REVOKE ALL ON hsdg.employee_names FROM PUBLIC;
GRANT SELECT ON hsdg.employee_names TO hsdg_app;

-- ── 5. Billable time, without the work ───────────────────────────────────
-- Keyed by the ORIGINAL entry (an approved correction stands in for it), as
-- bill-from-time lists it. Finance gets no note and no task.
CREATE VIEW hsdg.billable_time_entry_rows WITH (security_invoker = true) AS
  SELECT COALESCE(te.adjusts_entry_id, te.id) AS entry_id, te.engagement_id, te.employee_id,
         te.started_at, te.ended_at, te.duration_seconds, te.engagement_service_id, te.category,
         te.is_billable, te.task_id, COALESCE(te.note, o.note) AS note,
         EXISTS (SELECT 1 FROM hsdg.engagement_time_entries a
                  WHERE a.adjusts_entry_id = COALESCE(te.adjusts_entry_id, te.id)
                    AND a.adjustment_status = 'pending') AS pending
    FROM hsdg.effective_time_entries te
    JOIN hsdg.engagement_time_entries o ON o.id = COALESCE(te.adjusts_entry_id, te.id);
REVOKE ALL ON hsdg.billable_time_entry_rows FROM PUBLIC;
GRANT SELECT ON hsdg.billable_time_entry_rows TO hsdg_app;

CREATE FUNCTION hsdg.finance_billable_time_entries()
  RETURNS SETOF hsdg.billable_time_entry_rows
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_is_finance() THEN
    RETURN;
  END IF;
  PERFORM set_config('hsdg.billing_scope', 'on', true);
  RETURN QUERY
    SELECT t.entry_id, t.engagement_id, t.employee_id, t.started_at, t.ended_at,
           t.duration_seconds, t.engagement_service_id, t.category, t.is_billable,
           NULL::uuid AS task_id, NULL::text AS note, t.pending
      FROM hsdg.billable_time_entry_rows t
      JOIN hsdg.engagements g ON g.id = t.engagement_id
     WHERE t.is_billable AND hsdg.ctx_can_bill(g.entity_id);
  PERFORM set_config('hsdg.billing_scope', '', true);
  RETURN;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('hsdg.billing_scope', '', true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.finance_billable_time_entries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.finance_billable_time_entries() TO hsdg_app;

CREATE VIEW hsdg.billable_time_entries WITH (security_invoker = true, security_barrier = true) AS
  SELECT t.* FROM hsdg.billable_time_entry_rows t WHERE NOT hsdg.ctx_is_finance()
  UNION ALL
  SELECT f.* FROM hsdg.finance_billable_time_entries() f;
REVOKE ALL ON hsdg.billable_time_entries FROM PUBLIC;
GRANT SELECT ON hsdg.billable_time_entries TO hsdg_app;

-- ── 6. Clients' TANs (who deducts the TDS on a receipt) ───────────────────
CREATE VIEW hsdg.client_tan_rows WITH (security_invoker = true) AS
  SELECT r.id, r.entity_id, upper(replace(r.registration_number, ' ', '')) AS tan, r.status,
         r.created_at
    FROM hsdg.entity_registrations r
   WHERE r.registration_type = 'tan';
REVOKE ALL ON hsdg.client_tan_rows FROM PUBLIC;
GRANT SELECT ON hsdg.client_tan_rows TO hsdg_app;

CREATE FUNCTION hsdg.finance_client_tans()
  RETURNS SETOF hsdg.client_tan_rows
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT hsdg.ctx_is_finance() THEN
    RETURN;
  END IF;
  PERFORM set_config('hsdg.billing_scope', 'on', true);
  RETURN QUERY SELECT t.* FROM hsdg.client_tan_rows t WHERE hsdg.ctx_can_bill(t.entity_id);
  PERFORM set_config('hsdg.billing_scope', '', true);
  RETURN;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('hsdg.billing_scope', '', true);
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.finance_client_tans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.finance_client_tans() TO hsdg_app;

CREATE VIEW hsdg.client_tans WITH (security_invoker = true, security_barrier = true) AS
  SELECT t.* FROM hsdg.client_tan_rows t WHERE NOT hsdg.ctx_is_finance()
  UNION ALL
  SELECT f.* FROM hsdg.finance_client_tans() f;
REVOKE ALL ON hsdg.client_tans FROM PUBLIC;
GRANT SELECT ON hsdg.client_tans TO hsdg_app;

-- ── 7. What the fee is: the retainer and each year's fee ─────────────────
-- Read only, for the unbilled list and the commercial view. No policy and no
-- function reads "visible through these" to open anything else.
CREATE POLICY engagement_commercial_select_finance ON hsdg.engagement_commercial
  FOR SELECT TO hsdg_app USING (hsdg.ctx_is_finance());
CREATE POLICY compliance_engagement_years_select_finance ON hsdg.compliance_engagement_years
  FOR SELECT TO hsdg_app USING (hsdg.ctx_is_finance());

-- ── 8. Billing triggers find the engagement through the header view ──────
CREATE OR REPLACE FUNCTION hsdg.invoice_set_client() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  SELECT h.entity_id INTO NEW.client_entity_id
    FROM hsdg.engagement_billing_headers h WHERE h.id = NEW.engagement_id;
  RETURN NEW;
END;
$$;

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
    SELECT h.entity_id INTO NEW.client_entity_id
      FROM hsdg.engagement_billing_headers h WHERE h.id = NEW.engagement_id;
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

CREATE OR REPLACE FUNCTION hsdg.fee_waiver_request_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  SELECT h.entity_id INTO NEW.client_entity_id
    FROM hsdg.engagement_billing_headers h WHERE h.id = NEW.engagement_id;
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

-- The entry as billing sees it: the original row's facts, for finance through
-- the window (no note, no task — only what the guard checks).
CREATE FUNCTION hsdg.time_entry_billing_facts(p_entry_id uuid)
  RETURNS TABLE (engagement_id uuid, is_billable boolean, ended_at timestamptz,
                 adjusts_entry_id uuid, pending boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_finance boolean := hsdg.ctx_is_finance();
BEGIN
  IF v_finance THEN
    PERFORM set_config('hsdg.billing_scope', 'on', true);
  END IF;
  RETURN QUERY
    SELECT t.engagement_id, t.is_billable, t.ended_at, t.adjusts_entry_id,
           EXISTS (SELECT 1 FROM hsdg.engagement_time_entries a
                    WHERE a.adjusts_entry_id = t.id AND a.adjustment_status = 'pending')
      FROM hsdg.engagement_time_entries t
      JOIN hsdg.engagements g ON g.id = t.engagement_id
     WHERE t.id = p_entry_id AND (NOT v_finance OR hsdg.ctx_can_bill(g.entity_id));
  IF v_finance THEN
    PERFORM set_config('hsdg.billing_scope', '', true);
  END IF;
  RETURN;
EXCEPTION WHEN OTHERS THEN
  IF v_finance THEN
    PERFORM set_config('hsdg.billing_scope', '', true);
  END IF;
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION hsdg.time_entry_billing_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.time_entry_billing_facts(uuid) TO hsdg_app;

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
  -- Finance reads the entry through the window; everyone else as before.
  IF hsdg.ctx_is_finance() THEN
    SELECT f.engagement_id, f.is_billable, f.ended_at, f.adjusts_entry_id, f.pending INTO te
      FROM hsdg.time_entry_billing_facts(NEW.time_entry_id) f;
  ELSE
    SELECT t.engagement_id, t.is_billable, t.ended_at, t.adjusts_entry_id,
           EXISTS (SELECT 1 FROM hsdg.engagement_time_entries a
                    WHERE a.adjusts_entry_id = t.id AND a.adjustment_status = 'pending') AS pending
      INTO te
      FROM hsdg.engagement_time_entries t WHERE t.id = NEW.time_entry_id;
  END IF;
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

-- ── 9. Asking a partner to issue an ad-hoc invoice ─────────────────────────
-- An invoice with a line that no agreed fee or billable time stands behind
-- needs billing.approve to issue (spec §3.5, decision 9.3). Whoever lacks it
-- asks; the request closes when the invoice is issued, voided or withdrawn.
CREATE TABLE hsdg.invoice_issue_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES hsdg.invoices (id) ON DELETE CASCADE,
  engagement_id uuid NOT NULL,
  client_entity_id uuid NOT NULL,
  requested_by_employee_id uuid REFERENCES hsdg.employees (id),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_reason text CHECK (closed_reason IN ('issued', 'void', 'withdrawn')),
  CONSTRAINT invoice_issue_requests_closed CHECK ((closed_at IS NULL) = (closed_reason IS NULL))
);
CREATE UNIQUE INDEX invoice_issue_requests_open
  ON hsdg.invoice_issue_requests (invoice_id) WHERE closed_at IS NULL;
CREATE INDEX invoice_issue_requests_client ON hsdg.invoice_issue_requests (client_entity_id);

-- The engagement and client always come from the invoice.
CREATE FUNCTION hsdg.invoice_issue_request_fill() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  SELECT i.engagement_id, i.client_entity_id INTO NEW.engagement_id, NEW.client_entity_id
    FROM hsdg.invoices i WHERE i.id = NEW.invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_issue_requests_fill
  BEFORE INSERT ON hsdg.invoice_issue_requests
  FOR EACH ROW EXECUTE FUNCTION hsdg.invoice_issue_request_fill();

ALTER TABLE hsdg.invoice_issue_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.invoice_issue_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_issue_requests_billing ON hsdg.invoice_issue_requests
  FOR ALL TO hsdg_app
  USING (hsdg.ctx_can_bill(client_entity_id))
  WITH CHECK (hsdg.ctx_can_bill(client_entity_id));
CREATE POLICY invoice_issue_requests_owner ON hsdg.invoice_issue_requests
  FOR ALL TO hsdg_migrator USING (true) WITH CHECK (true);
REVOKE ALL ON hsdg.invoice_issue_requests FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON hsdg.invoice_issue_requests TO hsdg_app;

-- ── 10. Drafting from time, like drafting from fees ───────────────────────
-- time_billings took only the engagement lead; fee_billings and fee_waivers
-- take whoever may bill the engagement (ctx_may_bill_engagement, which
-- includes finance). Time now matches.
CREATE POLICY time_billings_insert_billing ON hsdg.time_billings
  FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_may_bill_engagement(engagement_id));

-- Down Migration

DROP POLICY IF EXISTS time_billings_insert_billing ON hsdg.time_billings;
DROP TABLE IF EXISTS hsdg.invoice_issue_requests;
DROP FUNCTION IF EXISTS hsdg.invoice_issue_request_fill();

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
DROP FUNCTION IF EXISTS hsdg.time_entry_billing_facts(uuid);

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

CREATE OR REPLACE FUNCTION hsdg.invoice_set_client() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  SELECT e.entity_id INTO NEW.client_entity_id FROM hsdg.engagements e WHERE e.id = NEW.engagement_id;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS compliance_engagement_years_select_finance ON hsdg.compliance_engagement_years;
DROP POLICY IF EXISTS engagement_commercial_select_finance ON hsdg.engagement_commercial;

DROP VIEW IF EXISTS hsdg.client_tans;
DROP FUNCTION IF EXISTS hsdg.finance_client_tans();
DROP VIEW IF EXISTS hsdg.client_tan_rows;
DROP VIEW IF EXISTS hsdg.billable_time_entries;
DROP FUNCTION IF EXISTS hsdg.finance_billable_time_entries();
DROP VIEW IF EXISTS hsdg.billable_time_entry_rows;
DROP VIEW IF EXISTS hsdg.employee_names;
DROP FUNCTION IF EXISTS hsdg.finance_employee_names();
DROP VIEW IF EXISTS hsdg.engagement_billing_headers;
DROP FUNCTION IF EXISTS hsdg.finance_engagement_billing_headers();
DROP VIEW IF EXISTS hsdg.engagement_billing_header_rows;
DROP VIEW IF EXISTS hsdg.entity_billing_profiles;
DROP FUNCTION IF EXISTS hsdg.finance_entity_billing_profiles();
DROP VIEW IF EXISTS hsdg.entity_billing_profile_rows;

DROP POLICY IF EXISTS engagement_time_entries_billing_scope ON hsdg.engagement_time_entries;
DROP POLICY IF EXISTS employees_billing_scope ON hsdg.employees;
DROP POLICY IF EXISTS engagements_billing_scope ON hsdg.engagements;
DROP POLICY IF EXISTS entity_contacts_billing_scope ON hsdg.entity_contacts;
DROP POLICY IF EXISTS entity_addresses_billing_scope ON hsdg.entity_addresses;
DROP POLICY IF EXISTS entity_registrations_billing_scope ON hsdg.entity_registrations;
DROP POLICY IF EXISTS entities_billing_scope ON hsdg.entities;
