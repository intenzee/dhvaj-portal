-- ─────────────────────────────────────────────────────────────────────────
-- Merging two clients that are one
--
-- The firm's workbook named one company twice — "3Aces Technologies - Firm"
-- and "3Aces Technologies Private Limited", same PAN — so the portal held two
-- clients, and the second could not take its GSTIN (unique firm-wide). A
-- person now merges them: one client is kept, the other is archived with
-- merged_into_id pointing at the keeper, and everything the archived one held
-- moves across in one transaction —
--
--   • registrations, contacts, addresses, profiles, logins, return marks,
--     notices, relationships and sub-clients (duplicates of what the keeper
--     already has are dropped, the keeper's copy wins; a login keeps the
--     newer of the two);
--   • engagements, with their billing: an invoice's client follows its
--     engagement, receipts and TDS follow the invoices they settle. Issued
--     invoices and posted receipts are frozen — the guards below let exactly
--     one column, the client, change, and only inside merge_entities;
--   • both open Compliance engagements become one: the archived client's
--     filings, tasks, documents, years and team fold into the keeper's, and
--     the emptied one is marked merged (as the restructure did per year).
--   An engagement whose line would duplicate one the keeper has (the same
--   service for the same year) stays on the archived client, and the merge
--   says so; a filing the keeper already has stays on the merged engagement.
--
-- Two different PANs are two legal entities and are never merged.
--
-- merge_entities runs as the schema owner and sees every row while it runs:
-- each RLS table gets a <table>_client_merge policy for the owner, live only
-- while hsdg.merging_clients is 'on' for its transaction (the
-- registration_holder pattern, made table-wide because the triggers a move
-- fires read across the schema). The API checks entity.manage and that the
-- caller sees both clients before calling it.
--
-- Also: entity_duplicate_dismissals ("these two are not the same client"),
-- and client_holding — which client holds a PAN or registration, across offices.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.entities
  ADD COLUMN merged_into_id uuid REFERENCES hsdg.entities (id) ON DELETE RESTRICT,
  ADD COLUMN merged_at timestamptz,
  ADD CONSTRAINT entities_merged_shape CHECK (
    (merged_into_id IS NULL) = (merged_at IS NULL)
    AND (merged_into_id IS NULL OR (merged_into_id <> id AND status = 'archived'))
  );
CREATE INDEX entities_merged_into_idx ON hsdg.entities (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- True only inside merge_entities: the owner, with the flag set for its transaction.
CREATE FUNCTION hsdg.merging_clients() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT current_user = 'hsdg_migrator'
     AND COALESCE(current_setting('hsdg.merging_clients', true), '') = 'on'
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'hsdg'::regnamespace AND c.relkind IN ('r', 'p')
              AND c.relrowsecurity
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON hsdg.%I FOR ALL TO hsdg_migrator '
      'USING (hsdg.merging_clients()) WITH CHECK (hsdg.merging_clients())',
      t || '_client_merge', t);
  END LOOP;
END $$;

-- ── Frozen billing rows: the client may follow a merge, nothing else ─────
CREATE OR REPLACE FUNCTION hsdg.merge_moves_only_client(p_new jsonb, p_old jsonb)
  RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT hsdg.merging_clients()
     AND (p_new - ARRAY['client_entity_id', 'updated_at'])
         = (p_old - ARRAY['client_entity_id', 'updated_at'])
$$;

CREATE OR REPLACE FUNCTION hsdg.receipt_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF hsdg.merge_moves_only_client(to_jsonb(NEW), to_jsonb(OLD)) THEN
    RETURN NEW;
  END IF;
  IF (NEW.client_entity_id, NEW.received_on, NEW.mode, NEW.reference, NEW.gross_amount,
      NEW.tds_amount, NEW.tds_section, NEW.bank_account, NEW.recorded_by_employee_id)
     IS DISTINCT FROM
     (OLD.client_entity_id, OLD.received_on, OLD.mode, OLD.reference, OLD.gross_amount,
      OLD.tds_amount, OLD.tds_section, OLD.bank_account, OLD.recorded_by_employee_id) THEN
    RAISE EXCEPTION 'A posted receipt cannot be changed; reverse it and record it again.'
      USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'This receipt is already reversed.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_frozen() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_moving text[] := ARRAY['status', 'decided_by_employee_id', 'decided_at', 'decision_note',
                           'version', 'updated_at', 'credit_note_number', 'financial_year',
                           'sequence_no', 'credit_date', 'total', 'void_reason',
                           'voided_by_employee_id', 'voided_at', 'pdf_storage_reference'];
  v_void text[] := ARRAY['void_reason', 'voided_by_employee_id', 'voided_at'];
BEGIN
  IF hsdg.merge_moves_only_client(to_jsonb(NEW), to_jsonb(OLD)) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - v_moving) IS DISTINCT FROM (to_jsonb(OLD) - v_moving) THEN
    RAISE EXCEPTION 'A request cannot be changed; reject it and raise another.'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT jsonb_object_agg(k, to_jsonb(NEW)->k) FROM unnest(v_void) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD)->k) FROM unnest(v_void) k)
     AND NOT (OLD.status = 'approved' AND NEW.status = 'void') THEN
    RAISE EXCEPTION 'A credit note''s void is recorded when it is voided.' USING ERRCODE = '22023';
  END IF;
  IF (to_jsonb(OLD)->>'pdf_storage_reference') IS NOT NULL
     AND (to_jsonb(NEW)->>'pdf_storage_reference') IS DISTINCT FROM (to_jsonb(OLD)->>'pdf_storage_reference') THEN
    RAISE EXCEPTION 'A credit note''s PDF is kept as it was issued.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hsdg.fee_billing_release_only() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF hsdg.merge_moves_only_client(to_jsonb(NEW), to_jsonb(OLD)) THEN
    RETURN NEW;
  END IF;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
     OR (to_jsonb(NEW) - 'released_at') <> (to_jsonb(OLD) - 'released_at') THEN
    RAISE EXCEPTION 'A fee billing can only be released, once.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'fee_billings_release_only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hsdg.time_billing_release_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF hsdg.merge_moves_only_client(to_jsonb(NEW), to_jsonb(OLD)) THEN
    RETURN NEW;
  END IF;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
     OR (to_jsonb(NEW) - 'released_at') <> (to_jsonb(OLD) - 'released_at') THEN
    RAISE EXCEPTION 'A time billing can only be released, once.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'time_billings_release_only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hsdg.fee_waiver_decision_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF hsdg.merge_moves_only_client(to_jsonb(NEW), to_jsonb(OLD)) THEN
    RETURN NEW;
  END IF;
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

CREATE OR REPLACE FUNCTION hsdg.billing_reversal_request_frozen() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF hsdg.merge_moves_only_client(to_jsonb(NEW), to_jsonb(OLD)) THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %.', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.kind, NEW.invoice_id, NEW.receipt_id, NEW.client_entity_id, NEW.engagement_id,
      NEW.amount, NEW.reason, NEW.requested_by_employee_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.kind, OLD.invoice_id, OLD.receipt_id, OLD.client_entity_id, OLD.engagement_id,
      OLD.amount, OLD.reason, OLD.requested_by_employee_id, OLD.created_at) THEN
    RAISE EXCEPTION 'A request cannot be changed, only decided or withdrawn.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── "These two are not the same client" ──────────────────────────────────
CREATE TABLE hsdg.entity_duplicate_dismissals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_a_id          uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  entity_b_id          uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  dismissed_by_user_id uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  note                 text CHECK (note IS NULL OR length(note) <= 500),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_duplicate_dismissals_ordered CHECK (entity_a_id < entity_b_id),
  CONSTRAINT entity_duplicate_dismissals_unique UNIQUE (entity_a_id, entity_b_id)
);
CREATE INDEX entity_duplicate_dismissals_b_idx ON hsdg.entity_duplicate_dismissals (entity_b_id);
REVOKE ALL ON hsdg.entity_duplicate_dismissals FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON hsdg.entity_duplicate_dismissals TO hsdg_app;
ALTER TABLE hsdg.entity_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.entity_duplicate_dismissals FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_duplicate_dismissals_owner ON hsdg.entity_duplicate_dismissals
  TO hsdg_migrator USING (true) WITH CHECK (true);
-- Whoever sees both clients sees, records and withdraws the dismissal
-- (entities' own policies decide what "sees" means).
CREATE POLICY entity_duplicate_dismissals_rw ON hsdg.entity_duplicate_dismissals
  FOR ALL TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_a_id)
         AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_b_id))
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_a_id)
              AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_b_id));

-- ── Which client holds a PAN / GSTIN / TAN / CIN, across offices ──────────
-- registration_holder names the client; the merge popup also needs its code,
-- and the same answer for a PAN. Only id, code and name are returned, and
-- only to a signed-in user.
CREATE POLICY entities_pan_holder_select ON hsdg.entities
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.finding_pan_holder', true) = 'on');

CREATE FUNCTION hsdg.client_holding(p_type text, p_value text)
  RETURNS TABLE (entity_id uuid, entity_code text, legal_name text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF hsdg.ctx_user_id() IS NULL THEN RETURN; END IF;
  PERFORM set_config('hsdg.finding_pan_holder', 'on', true);
  PERFORM set_config('hsdg.finding_registration_holder', 'on', true);
  IF p_type = 'pan' THEN
    RETURN QUERY
      SELECT e.id, e.entity_code, e.legal_name FROM hsdg.entities e
       WHERE e.pan = upper(btrim(p_value))
       ORDER BY (e.merged_into_id IS NULL) DESC LIMIT 1;
  ELSE
    RETURN QUERY
      SELECT e.id, e.entity_code, e.legal_name
        FROM hsdg.entity_registrations r JOIN hsdg.entities e ON e.id = r.entity_id
       WHERE r.registration_type = p_type AND r.registration_number = p_value
       LIMIT 1;
  END IF;
  PERFORM set_config('hsdg.finding_pan_holder', '', true);
  PERFORM set_config('hsdg.finding_registration_holder', '', true);
END $$;
REVOKE ALL ON FUNCTION hsdg.client_holding(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.client_holding(text, text) TO hsdg_app;

-- ── The merge ────────────────────────────────────────────────────────────
-- p_take: the archived client's values to keep, by column ("legal_name": true).
-- Any column the keeper has empty takes the archived client's value anyway.
-- Returns what moved, what stayed and why, for the API to report.
CREATE FUNCTION hsdg.merge_entities(p_keep uuid, p_drop uuid, p_take jsonb DEFAULT '{}')
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  k entities%ROWTYPE;
  d entities%ROWTYPE;
  takeable text[] := ARRAY['legal_name', 'display_name', 'trade_name', 'short_name',
    'entity_type_id', 'incorporation_date', 'legal_status', 'home_office_id', 'roc',
    'authorised_capital', 'paid_up_capital', 'llp_contribution', 'annual_turnover',
    'business_description', 'client_id', 'group_id', 'country_of_incorporation',
    'listing_status', 'current_accounting_framework'];
  col text;
  sets text[] := '{}';
  v_pan text;
  ck uuid;       -- the keeper's open Compliance engagement
  cd uuid;       -- the archived client's
  eng record;
  stayed jsonb := '[]';
  moved_engagements int := 0;
  folded jsonb := NULL;
  left_filings int := 0;
  inst uuid[];
  moved_tasks uuid[];
  n int;
  counts jsonb := '{}';
BEGIN
  IF hsdg.ctx_user_id() IS NULL THEN
    RAISE EXCEPTION 'merge_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'Choose two different clients to merge.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('hsdg.merging_clients', 'on', true);

  SELECT * INTO k FROM entities WHERE id = p_keep FOR UPDATE;
  SELECT * INTO d FROM entities WHERE id = p_drop FOR UPDATE;
  IF k.id IS NULL OR d.id IS NULL THEN
    RAISE EXCEPTION 'Client not found.' USING ERRCODE = 'P0002';
  END IF;
  IF k.merged_into_id IS NOT NULL OR d.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'One of these clients was already merged into another.' USING ERRCODE = '22023';
  END IF;
  IF k.pan IS NOT NULL AND d.pan IS NOT NULL AND k.pan <> d.pan THEN
    RAISE EXCEPTION 'Different PANs (% and %) are two legal entities; they cannot be merged.',
      k.pan, d.pan USING ERRCODE = '22023';
  END IF;

  -- ── The keeper's own fields ──
  v_pan := COALESCE(k.pan, d.pan);
  UPDATE entities SET pan = NULL WHERE id = p_drop AND pan IS NOT NULL;
  FOREACH col IN ARRAY takeable LOOP
    IF COALESCE((p_take ->> col)::boolean, false) THEN
      sets := sets || format('%1$I = d.%1$I', col);
    ELSE
      sets := sets || format('%1$I = COALESCE(k.%1$I, d.%1$I)', col);
    END IF;
  END LOOP;
  EXECUTE format(
    'UPDATE entities k SET %s, pan = $3,
            act_manufacturing = k.act_manufacturing OR d.act_manufacturing,
            act_trading = k.act_trading OR d.act_trading,
            act_services = k.act_services OR d.act_services,
            act_import = k.act_import OR d.act_import,
            act_export = k.act_export OR d.act_export,
            act_ecommerce = k.act_ecommerce OR d.act_ecommerce,
            act_regulated = k.act_regulated OR d.act_regulated,
            status = CASE WHEN k.status IN (''draft'', ''prospect'') AND d.status = ''active''
                          THEN ''active'' ELSE k.status END,
            version = k.version + 1
       FROM entities d WHERE k.id = $1 AND d.id = $2',
    array_to_string(sets, ', '))
  USING p_keep, p_drop, v_pan;
  -- The keeper's parent cannot be the client it absorbs.
  UPDATE entities SET parent_entity_id = d.parent_entity_id
   WHERE id = p_keep AND parent_entity_id = p_drop;
  UPDATE entities SET parent_entity_id = NULL WHERE id = p_keep AND parent_entity_id = p_keep;

  -- ── What the client holds ──
  UPDATE entity_registrations SET entity_id = p_keep WHERE entity_id = p_drop;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('registrations', n);

  UPDATE entity_contacts c SET is_primary = false
   WHERE c.entity_id = p_drop AND c.is_primary
     AND EXISTS (SELECT 1 FROM entity_contacts o WHERE o.entity_id = p_keep AND o.is_primary);
  UPDATE entity_contacts SET entity_id = p_keep WHERE entity_id = p_drop;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('contacts', n);

  UPDATE entity_addresses a SET is_primary = false
   WHERE a.entity_id = p_drop AND a.is_primary
     AND EXISTS (SELECT 1 FROM entity_addresses o
                  WHERE o.entity_id = p_keep AND o.is_primary AND o.address_type = a.address_type);
  UPDATE entity_addresses SET entity_id = p_keep WHERE entity_id = p_drop;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('addresses', n);

  DELETE FROM entity_relationships r
   WHERE (r.from_entity_id = p_drop AND r.to_entity_id = p_keep)
      OR (r.from_entity_id = p_keep AND r.to_entity_id = p_drop);
  DELETE FROM entity_relationships r
   WHERE r.from_entity_id = p_drop AND EXISTS (
     SELECT 1 FROM entity_relationships o WHERE o.from_entity_id = p_keep
        AND o.to_entity_id = r.to_entity_id AND o.relationship_type = r.relationship_type);
  DELETE FROM entity_relationships r
   WHERE r.to_entity_id = p_drop AND EXISTS (
     SELECT 1 FROM entity_relationships o WHERE o.to_entity_id = p_keep
        AND o.from_entity_id = r.from_entity_id AND o.relationship_type = r.relationship_type);
  UPDATE entity_relationships SET from_entity_id = p_keep WHERE from_entity_id = p_drop;
  UPDATE entity_relationships SET to_entity_id = p_keep WHERE to_entity_id = p_drop;

  UPDATE entity_financial_profiles f SET is_current = false
   WHERE f.entity_id = p_drop AND f.is_current
     AND EXISTS (SELECT 1 FROM entity_financial_profiles o
                  WHERE o.entity_id = p_keep AND o.is_current AND o.financial_year = f.financial_year);
  UPDATE entity_financial_profiles SET entity_id = p_keep WHERE entity_id = p_drop;

  DELETE FROM entity_business_activities a
   WHERE a.entity_id = p_drop AND EXISTS (
     SELECT 1 FROM entity_business_activities o WHERE o.entity_id = p_keep AND o.industry_id = a.industry_id);
  UPDATE entity_business_activities a SET is_primary = false
   WHERE a.entity_id = p_drop AND a.is_primary
     AND EXISTS (SELECT 1 FROM entity_business_activities o WHERE o.entity_id = p_keep AND o.is_primary);
  UPDATE entity_business_activities SET entity_id = p_keep WHERE entity_id = p_drop;

  DELETE FROM entity_listings l
   WHERE l.entity_id = p_drop AND EXISTS (
     SELECT 1 FROM entity_listings o WHERE o.entity_id = p_keep
        AND o.exchange = l.exchange AND o.security_type = l.security_type);
  UPDATE entity_listings SET entity_id = p_keep WHERE entity_id = p_drop;

  UPDATE entity_regulatory_attributes SET entity_id = p_keep WHERE entity_id = p_drop;

  DELETE FROM registration_compliance_profiles p
   WHERE p.entity_id = p_drop AND EXISTS (
     SELECT 1 FROM registration_compliance_profiles o WHERE o.entity_id = p_keep
        AND o.scope = p.scope AND o.registration_id IS NOT DISTINCT FROM p.registration_id
        AND o.effective_from IS NOT DISTINCT FROM p.effective_from);
  UPDATE registration_compliance_profiles SET entity_id = p_keep WHERE entity_id = p_drop;

  -- A login for the same portal and registration on both: the newer stays.
  DELETE FROM client_credentials c
   USING client_credentials o
   WHERE c.entity_id IN (p_keep, p_drop) AND o.entity_id IN (p_keep, p_drop)
     AND c.entity_id <> o.entity_id
     AND c.portal = o.portal AND c.account = o.account
     AND COALESCE(c.registration_id::text, c.state_code, '') = COALESCE(o.registration_id::text, o.state_code, '')
     AND (c.updated_at, c.id) < (o.updated_at, o.id);
  UPDATE client_credentials SET entity_id = p_keep WHERE entity_id = p_drop;
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('logins', n);
  UPDATE credential_access_log SET entity_id = p_keep WHERE entity_id = p_drop;

  DELETE FROM client_return_marks m
   WHERE m.entity_id = p_drop AND EXISTS (
     SELECT 1 FROM client_return_marks o WHERE o.entity_id = p_keep
        AND COALESCE(o.registration_id::text, o.state_code, '') = COALESCE(m.registration_id::text, m.state_code, '')
        AND o.return_form = m.return_form AND o.period_key = m.period_key);
  UPDATE client_return_marks SET entity_id = p_keep WHERE entity_id = p_drop;

  -- A notice the keeper already holds under the same reference stays put.
  SELECT count(*) INTO n FROM notices x
   WHERE x.entity_id = p_drop AND EXISTS (
     SELECT 1 FROM notices o WHERE o.entity_id = p_keep AND o.notice_type_id = x.notice_type_id
        AND upper(btrim(o.reference_no)) = upper(btrim(x.reference_no)));
  IF n > 0 THEN
    stayed := stayed || jsonb_build_array(jsonb_build_object(
      'kind', 'notices', 'count', n,
      'reason', 'The kept client already has a notice with the same reference.'));
  END IF;
  UPDATE notices x SET entity_id = p_keep
   WHERE x.entity_id = p_drop AND NOT EXISTS (
     SELECT 1 FROM notices o WHERE o.entity_id = p_keep AND o.notice_type_id = x.notice_type_id
        AND upper(btrim(o.reference_no)) = upper(btrim(x.reference_no)));
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('notices', n);

  UPDATE entities SET parent_entity_id = p_keep WHERE parent_entity_id = p_drop AND id <> p_keep;

  -- ── The two Compliance engagements become one ──
  SELECT id INTO ck FROM engagements
   WHERE entity_id = p_keep AND kind = 'compliance'
     AND status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn');
  SELECT id INTO cd FROM engagements
   WHERE entity_id = p_drop AND kind = 'compliance'
     AND status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn');
  IF ck IS NOT NULL AND cd IS NOT NULL THEN
    -- Years: one row per FY on the keeper's; streams and registrations unite.
    UPDATE compliance_engagement_years ky
       SET streams = ARRAY(SELECT DISTINCT s FROM unnest(ky.streams || dy.streams) s ORDER BY s),
           stream_registrations = dy.stream_registrations || ky.stream_registrations,
           budget_hours = dy.budget_hours || ky.budget_hours,
           fee_amount = COALESCE(ky.fee_amount, dy.fee_amount),
           billing_model = COALESCE(ky.billing_model, dy.billing_model),
           engagement_letter_ref = COALESCE(ky.engagement_letter_ref, dy.engagement_letter_ref),
           engagement_letter_date = COALESCE(ky.engagement_letter_date, dy.engagement_letter_date),
           s144_approval_ref = COALESCE(ky.s144_approval_ref, dy.s144_approval_ref),
           status = CASE WHEN 'open' IN (ky.status, dy.status) THEN 'open' ELSE 'closed' END,
           closed_at = CASE WHEN 'open' IN (ky.status, dy.status) THEN NULL
                            ELSE GREATEST(ky.closed_at, dy.closed_at) END,
           version = ky.version + 1
      FROM compliance_engagement_years dy
     WHERE ky.engagement_id = ck AND dy.engagement_id = cd
       AND dy.financial_year = ky.financial_year;
    DELETE FROM compliance_engagement_years dy
     WHERE dy.engagement_id = cd AND EXISTS (
       SELECT 1 FROM compliance_engagement_years ky
        WHERE ky.engagement_id = ck AND ky.financial_year = dy.financial_year);
    UPDATE compliance_engagement_years SET engagement_id = ck WHERE engagement_id = cd;

    -- A line on the keeper's for every stream the archived one worked.
    INSERT INTO engagement_services
           (engagement_id, service_id, office_id, lead_employee_id, is_primary, status)
    SELECT DISTINCT ON (s.stream) ck, live.id, e.office_id, e.engagement_partner_id, false,
           engagement_service_status_from(e.status)
      FROM engagement_services es
      JOIN services s ON s.id = es.service_id AND s.stream IS NOT NULL
      JOIN services live ON live.stream = s.stream AND live.folded_into_service_id IS NULL
      JOIN engagements e ON e.id = ck
     WHERE es.engagement_id = cd AND es.status <> 'cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM engagement_services o JOIN services os ON os.id = o.service_id
          WHERE o.engagement_id = ck AND o.status <> 'cancelled' AND os.stream = s.stream);

    -- Filings: the ones the keeper's lacks move, with what hangs off them.
    SELECT COALESCE(array_agg(i.id), '{}') INTO inst
      FROM compliance_instances i
     WHERE i.engagement_id = cd
       AND NOT (i.reference_date IS NOT NULL AND EXISTS (
             SELECT 1 FROM compliance_instances o WHERE o.engagement_id = ck
                AND o.compliance_rule_id = i.compliance_rule_id AND o.reference_date = i.reference_date))
       AND NOT (i.period_key IS NOT NULL AND EXISTS (
             SELECT 1 FROM compliance_instances o WHERE o.engagement_id = ck
                AND o.compliance_rule_id = i.compliance_rule_id
                AND o.registration_id IS NOT DISTINCT FROM i.registration_id
                AND o.period_key = i.period_key));
    SELECT count(*) INTO left_filings FROM compliance_instances
     WHERE engagement_id = cd AND NOT (id = ANY (inst));
    UPDATE compliance_instances i
       SET engagement_id = ck,
           engagement_service_id = (
             SELECT o.id FROM engagement_services o JOIN services os ON os.id = o.service_id
              WHERE o.engagement_id = ck AND o.status <> 'cancelled'
                AND os.stream = COALESCE(
                  (SELECT ls.stream FROM engagement_services l JOIN services ls ON ls.id = l.service_id
                    WHERE l.id = i.engagement_service_id),
                  (SELECT rs.stream FROM compliance_rules ru JOIN services rs ON rs.id = ru.service_id
                    WHERE ru.id = i.compliance_rule_id))
              ORDER BY o.is_primary DESC, o.created_at LIMIT 1)
     WHERE i.id = ANY (inst);
    UPDATE compliance_instance_deadlines SET engagement_id = ck WHERE compliance_instance_id = ANY (inst);
    UPDATE compliance_instance_overrides SET engagement_id = ck WHERE compliance_instance_id = ANY (inst);
    UPDATE instance_checklist_items SET engagement_id = ck WHERE compliance_instance_id = ANY (inst);
    UPDATE instance_figures SET engagement_id = ck WHERE compliance_instance_id = ANY (inst);
    UPDATE filing_records SET engagement_id = ck WHERE compliance_instance_id = ANY (inst);
    UPDATE filing_corrections SET engagement_id = ck WHERE compliance_instance_id = ANY (inst);
    UPDATE client_reminders SET engagement_id = ck WHERE compliance_instance_id = ANY (inst);
    UPDATE client_dependencies SET engagement_id = ck
     WHERE compliance_instance_id = ANY (inst) AND engagement_component_id IS NULL;

    -- Tasks of the moved filings and those of no filing (the work in hand)
    -- move; a dependency that would span the two engagements goes.
    SELECT COALESCE(array_agg(t.id), '{}') INTO moved_tasks FROM tasks t
     WHERE t.engagement_id = cd
       AND (t.source_compliance_instance_id IS NULL OR t.source_compliance_instance_id = ANY (inst));
    DELETE FROM task_dependencies dd
     WHERE dd.engagement_id = cd
       AND (dd.task_id = ANY (moved_tasks)) <> (dd.depends_on_task_id = ANY (moved_tasks));
    UPDATE tasks SET engagement_id = ck WHERE id = ANY (moved_tasks);
    UPDATE task_dependencies SET engagement_id = ck
     WHERE task_id = ANY (moved_tasks) AND depends_on_task_id = ANY (moved_tasks);
    UPDATE document_versions v SET engagement_id = ck
      FROM documents doc
     WHERE doc.id = v.document_id AND doc.engagement_id = cd
       AND (doc.task_id = ANY (moved_tasks) OR doc.compliance_instance_id = ANY (inst)
            OR (doc.task_id IS NULL AND doc.compliance_instance_id IS NULL));
    UPDATE documents SET engagement_id = ck
     WHERE engagement_id = cd
       AND (task_id = ANY (moved_tasks) OR compliance_instance_id = ANY (inst)
            OR (task_id IS NULL AND compliance_instance_id IS NULL));

    UPDATE compliance_events SET engagement_id = ck WHERE engagement_id = cd;
    INSERT INTO engagement_team (engagement_id, employee_id, role_on_engagement)
    SELECT ck, t.employee_id, t.role_on_engagement FROM engagement_team t
     WHERE t.engagement_id = cd
       AND NOT EXISTS (SELECT 1 FROM engagement_team o WHERE o.engagement_id = ck AND o.employee_id = t.employee_id);

    -- The emptied one is merged; its lines end so it can follow the client.
    UPDATE engagement_services SET status = 'cancelled' WHERE engagement_id = cd AND status <> 'cancelled';
    UPDATE engagements SET status = 'merged', merged_into_id = ck WHERE id = cd;
    folded := jsonb_build_object(
      'from', (SELECT engagement_code FROM engagements WHERE id = cd),
      'into', (SELECT engagement_code FROM engagements WHERE id = ck),
      'filings', cardinality(inst), 'tasks', cardinality(moved_tasks),
      'filingsLeft', left_filings);
  END IF;

  -- ── Engagements follow the client, unless a line would duplicate one ──
  FOR eng IN
    SELECT e.id, e.engagement_code, e.status FROM engagements e WHERE e.entity_id = p_drop ORDER BY e.created_at
  LOOP
    IF EXISTS (
      SELECT 1 FROM engagement_services l
        JOIN engagements e ON e.id = l.engagement_id
        JOIN engagement_services o
          ON o.entity_id = p_keep AND o.status <> 'cancelled' AND o.service_id = l.service_id
         AND o.financial_year IS NOT DISTINCT FROM e.financial_year
         AND o.period_label IS NOT DISTINCT FROM e.period_label
       WHERE l.engagement_id = eng.id AND l.status <> 'cancelled') THEN
      stayed := stayed || jsonb_build_array(jsonb_build_object(
        'kind', 'engagement', 'code', eng.engagement_code,
        'reason', 'The kept client already has the same service for the same year.'));
      CONTINUE;
    END IF;
    UPDATE engagements SET entity_id = p_keep WHERE id = eng.id;
    UPDATE engagement_entities SET entity_id = p_keep
     WHERE engagement_id = eng.id AND entity_id = p_drop
       AND NOT EXISTS (SELECT 1 FROM engagement_entities o WHERE o.engagement_id = eng.id AND o.entity_id = p_keep);
    UPDATE engagement_independence_facts SET entity_id = p_keep WHERE engagement_id = eng.id AND entity_id = p_drop;
    moved_engagements := moved_engagements + 1;
  END LOOP;
  -- The archived client as a member of someone else's group engagement.
  DELETE FROM engagement_entities x
   WHERE x.entity_id = p_drop AND NOT x.is_primary AND EXISTS (
     SELECT 1 FROM engagement_entities o WHERE o.engagement_id = x.engagement_id AND o.entity_id = p_keep);
  UPDATE engagement_entities SET entity_id = p_keep WHERE entity_id = p_drop AND NOT is_primary;

  -- ── Billing follows: by engagement, by invoice, and receipts by what they settle ──
  UPDATE invoices i SET client_entity_id = e.entity_id
    FROM engagements e WHERE e.id = i.engagement_id AND i.client_entity_id = p_drop AND e.entity_id = p_keep;
  UPDATE fee_billings x SET client_entity_id = p_keep
    FROM engagements e WHERE e.id = x.engagement_id AND x.client_entity_id = p_drop AND e.entity_id = p_keep;
  UPDATE time_billings x SET client_entity_id = p_keep
    FROM engagements e WHERE e.id = x.engagement_id AND x.client_entity_id = p_drop AND e.entity_id = p_keep;
  UPDATE fee_waivers x SET client_entity_id = p_keep
    FROM engagements e WHERE e.id = x.engagement_id AND x.client_entity_id = p_drop AND e.entity_id = p_keep;
  UPDATE invoice_issue_requests x SET client_entity_id = p_keep
    FROM engagements e WHERE e.id = x.engagement_id AND x.client_entity_id = p_drop AND e.entity_id = p_keep;
  UPDATE invoice_reminders x SET client_entity_id = i.client_entity_id
    FROM invoices i WHERE i.id = x.invoice_id AND x.client_entity_id = p_drop AND i.client_entity_id = p_keep;
  UPDATE credit_notes x SET client_entity_id = p_keep
    FROM invoices i WHERE i.id = x.invoice_id AND x.client_entity_id = p_drop AND i.client_entity_id = p_keep;
  UPDATE write_offs x SET client_entity_id = p_keep
    FROM invoices i WHERE i.id = x.invoice_id AND x.client_entity_id = p_drop AND i.client_entity_id = p_keep;
  UPDATE receipts r SET client_entity_id = p_keep
   WHERE r.client_entity_id = p_drop AND NOT EXISTS (
     SELECT 1 FROM receipt_allocations a JOIN invoices i ON i.id = a.invoice_id
      WHERE a.receipt_id = r.id AND i.client_entity_id = p_drop);
  GET DIAGNOSTICS n = ROW_COUNT; counts := counts || jsonb_build_object('receipts', n);
  UPDATE billing_reversal_requests x SET client_entity_id = p_keep
   WHERE x.client_entity_id = p_drop
     AND (x.invoice_id IS NULL OR EXISTS (SELECT 1 FROM invoices i WHERE i.id = x.invoice_id AND i.client_entity_id = p_keep))
     AND (x.receipt_id IS NULL OR EXISTS (SELECT 1 FROM receipts r WHERE r.id = x.receipt_id AND r.client_entity_id = p_keep));
  UPDATE tds_reminders x SET client_entity_id = p_keep
   WHERE x.client_entity_id = p_drop AND NOT EXISTS (
     SELECT 1 FROM receipts r WHERE r.id = ANY (x.receipt_ids) AND r.client_entity_id = p_drop);
  SELECT count(*) INTO n FROM invoices WHERE client_entity_id = p_drop;
  counts := counts || jsonb_build_object('invoicesLeft', n);

  -- ── The archived client ──
  DELETE FROM entity_duplicate_dismissals
   WHERE (entity_a_id, entity_b_id) = (LEAST(p_keep, p_drop), GREATEST(p_keep, p_drop));
  UPDATE entities
     SET status = 'archived', merged_into_id = p_keep, merged_at = now(),
         client_id = (SELECT client_id FROM entities WHERE id = p_keep),
         group_id = (SELECT group_id FROM entities WHERE id = p_keep),
         parent_entity_id = NULL,
         version = version + 1
   WHERE id = p_drop;

  PERFORM set_config('hsdg.merging_clients', '', true);
  RETURN jsonb_build_object(
    'keptId', p_keep, 'archivedId', p_drop,
    'movedEngagements', moved_engagements,
    'folded', folded,
    'counts', counts,
    'stayed', stayed);
END $$;
REVOKE ALL ON FUNCTION hsdg.merge_entities(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.merge_entities(uuid, uuid, jsonb) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.merge_entities(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS hsdg.client_holding(text, text);
DROP POLICY IF EXISTS entities_pan_holder_select ON hsdg.entities;
DROP TABLE IF EXISTS hsdg.entity_duplicate_dismissals;

CREATE OR REPLACE FUNCTION hsdg.receipt_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.client_entity_id, NEW.received_on, NEW.mode, NEW.reference, NEW.gross_amount,
      NEW.tds_amount, NEW.tds_section, NEW.bank_account, NEW.recorded_by_employee_id)
     IS DISTINCT FROM
     (OLD.client_entity_id, OLD.received_on, OLD.mode, OLD.reference, OLD.gross_amount,
      OLD.tds_amount, OLD.tds_section, OLD.bank_account, OLD.recorded_by_employee_id) THEN
    RAISE EXCEPTION 'A posted receipt cannot be changed; reverse it and record it again.'
      USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'This receipt is already reversed.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hsdg.billing_adjustment_frozen() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_moving text[] := ARRAY['status', 'decided_by_employee_id', 'decided_at', 'decision_note',
                           'version', 'updated_at', 'credit_note_number', 'financial_year',
                           'sequence_no', 'credit_date', 'total', 'void_reason',
                           'voided_by_employee_id', 'voided_at', 'pdf_storage_reference'];
  v_void text[] := ARRAY['void_reason', 'voided_by_employee_id', 'voided_at'];
BEGIN
  IF (to_jsonb(NEW) - v_moving) IS DISTINCT FROM (to_jsonb(OLD) - v_moving) THEN
    RAISE EXCEPTION 'A request cannot be changed; reject it and raise another.'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT jsonb_object_agg(k, to_jsonb(NEW)->k) FROM unnest(v_void) k)
     IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD)->k) FROM unnest(v_void) k)
     AND NOT (OLD.status = 'approved' AND NEW.status = 'void') THEN
    RAISE EXCEPTION 'A credit note''s void is recorded when it is voided.' USING ERRCODE = '22023';
  END IF;
  IF (to_jsonb(OLD)->>'pdf_storage_reference') IS NOT NULL
     AND (to_jsonb(NEW)->>'pdf_storage_reference') IS DISTINCT FROM (to_jsonb(OLD)->>'pdf_storage_reference') THEN
    RAISE EXCEPTION 'A credit note''s PDF is kept as it was issued.' USING ERRCODE = '22023';
  END IF;
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

CREATE OR REPLACE FUNCTION hsdg.billing_reversal_request_frozen() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %.', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.kind, NEW.invoice_id, NEW.receipt_id, NEW.client_entity_id, NEW.engagement_id,
      NEW.amount, NEW.reason, NEW.requested_by_employee_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.kind, OLD.invoice_id, OLD.receipt_id, OLD.client_entity_id, OLD.engagement_id,
      OLD.amount, OLD.reason, OLD.requested_by_employee_id, OLD.created_at) THEN
    RAISE EXCEPTION 'A request cannot be changed, only decided or withdrawn.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS hsdg.merge_moves_only_client(jsonb, jsonb);

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT pol.polname, c.relname FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
            WHERE c.relnamespace = 'hsdg'::regnamespace AND pol.polname = c.relname || '_client_merge'
  LOOP
    EXECUTE format('DROP POLICY %I ON hsdg.%I', p.polname, p.relname);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS hsdg.merging_clients();

-- A merged client's work is on its keeper; the archived row stays archived.
ALTER TABLE hsdg.entities NO FORCE ROW LEVEL SECURITY;
UPDATE hsdg.entities SET merged_into_id = NULL, merged_at = NULL WHERE merged_into_id IS NOT NULL;
ALTER TABLE hsdg.entities FORCE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS hsdg.entities_merged_into_idx;
ALTER TABLE hsdg.entities
  DROP CONSTRAINT IF EXISTS entities_merged_shape,
  DROP COLUMN IF EXISTS merged_at,
  DROP COLUMN IF EXISTS merged_into_id;
