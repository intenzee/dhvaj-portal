-- ─────────────────────────────────────────────────────────────────────────
-- CM-9 · merge_entities carries the fee period (CM-4)
--
-- Merging two clients folds the dropped client's compliance year into the
-- kept one's, taking the dropped fee when the kept year has none. The fee's
-- period (and who confirmed it) now comes along with it, so a ₹5,000 monthly
-- fee never lands as ₹5,000 a year. Same function otherwise; down restores it.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.merge_entities(p_keep uuid, p_drop uuid, p_take jsonb DEFAULT '{}')
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

  -- Both locked in id order, so A→B and B→A at once wait instead of deadlocking.
  PERFORM 1 FROM entities WHERE id IN (p_keep, p_drop) ORDER BY id FOR UPDATE;
  SELECT * INTO k FROM entities WHERE id = p_keep;
  SELECT * INTO d FROM entities WHERE id = p_drop;
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
     AND status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn')
   ORDER BY created_at, id LIMIT 1;
  SELECT id INTO cd FROM engagements
   WHERE entity_id = p_drop AND kind = 'compliance'
     AND status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn')
   ORDER BY created_at, id LIMIT 1;
  IF ck IS NOT NULL AND cd IS NOT NULL THEN
    -- Years: one row per FY on the keeper's; streams and registrations unite.
    UPDATE compliance_engagement_years ky
       SET streams = ARRAY(SELECT DISTINCT s FROM unnest(ky.streams || dy.streams) s ORDER BY s),
           stream_registrations = dy.stream_registrations || ky.stream_registrations,
           budget_hours = dy.budget_hours || ky.budget_hours,
           fee_amount = COALESCE(ky.fee_amount, dy.fee_amount),
           -- CM-9: the period travels with the amount it describes.
           fee_period = CASE WHEN ky.fee_amount IS NULL THEN dy.fee_period ELSE ky.fee_period END,
           fee_period_set_by = CASE WHEN ky.fee_amount IS NULL THEN dy.fee_period_set_by
                                    ELSE ky.fee_period_set_by END,
           fee_period_set_at = CASE WHEN ky.fee_amount IS NULL THEN dy.fee_period_set_at
                                    ELSE ky.fee_period_set_at END,
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
    IF hsdg.merge_line_clashes(eng.id, p_keep) THEN
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
  IF n > 0 THEN
    stayed := stayed || jsonb_build_array(jsonb_build_object(
      'kind', 'invoices', 'count', n,
      'reason', 'Billed on an engagement that stays on the archived client.'));
  END IF;

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

-- Down Migration

CREATE OR REPLACE FUNCTION hsdg.merge_entities(p_keep uuid, p_drop uuid, p_take jsonb DEFAULT '{}')
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

  -- Both locked in id order, so A→B and B→A at once wait instead of deadlocking.
  PERFORM 1 FROM entities WHERE id IN (p_keep, p_drop) ORDER BY id FOR UPDATE;
  SELECT * INTO k FROM entities WHERE id = p_keep;
  SELECT * INTO d FROM entities WHERE id = p_drop;
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
     AND status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn')
   ORDER BY created_at, id LIMIT 1;
  SELECT id INTO cd FROM engagements
   WHERE entity_id = p_drop AND kind = 'compliance'
     AND status NOT IN ('closed', 'merged', 'cancelled', 'declined', 'withdrawn')
   ORDER BY created_at, id LIMIT 1;
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
    IF hsdg.merge_line_clashes(eng.id, p_keep) THEN
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
  IF n > 0 THEN
    stayed := stayed || jsonb_build_array(jsonb_build_object(
      'kind', 'invoices', 'count', n,
      'reason', 'Billed on an engagement that stays on the archived client.'));
  END IF;

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
