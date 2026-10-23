-- ─────────────────────────────────────────────────────────────────────────
-- Delete an engagement permanently (administrator only)
--
-- An engagement opened by mistake can be removed outright: the engagement
-- and everything recorded under it — tasks, documents, filings, time,
-- invoices, credit notes, audit working papers, its audit trail and its
-- notifications — with nothing left behind. Engagements merged into it go
-- with it. Receipts stay (they are the client's money); their allocations to
-- the deleted invoices are removed, so the money shows as unallocated.
--
-- hsdg.purge_engagement runs as the owner. Most tables are FORCE RLS, so the
-- owner is held to the caller's policies; every RLS table gets a
-- migrator-only policy that is live only while hsdg.purging = 'on' — which
-- the function sets after checking the caller is an administrator and clears
-- before returning, as the other definer functions do
-- (1772900200000_client_upload_link_lookup). The foreign keys' own cascades
-- already run past RLS; the function deletes by hand only what a cascade
-- would refuse:
--   · rows that point at the engagement or its invoices without a cascade
--     (billing links, reminders, allocations, write-offs, credit notes);
--   · RESTRICT links inside the engagement (compliance instances and
--     components under a service line, filings and memos holding one of its
--     documents, time adjustments) — deleted first, so the cascade never
--     meets them out of order;
--   · rows that name the engagement or its records without a foreign key
--     (audit events, notifications, restructure moves).
-- An issued invoice's lines are otherwise locked; the line guard lets them
-- go while purging.
--
-- Returns the storage references of the files that belonged to it (document
-- versions, invoice and credit-note PDFs) so the API can remove the bytes
-- once the delete has committed.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'hsdg'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  LOOP
    EXECUTE format(
      'CREATE POLICY purge_engagement ON hsdg.%I TO hsdg_migrator '
      'USING (current_setting(''hsdg.purging'', true) = ''on'') '
      'WITH CHECK (current_setting(''hsdg.purging'', true) = ''on'')', t);
  END LOOP;
END $$;

-- An issued invoice's lines stay locked, except while an engagement is purged.
CREATE OR REPLACE FUNCTION hsdg.invoice_line_guard_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('hsdg.purging', true) = 'on' THEN
    RETURN OLD;
  END IF;
  SELECT i.status INTO st FROM hsdg.invoices i WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice''s lines can change; this invoice is %.', st
      USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION hsdg.purge_engagement(p_engagement_id uuid) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  eng   uuid[];
  docs  uuid[];
  inv   uuid[];
  objs  uuid[];
  more  uuid[];
  refs  text[];
  t     text;
BEGIN
  IF NOT (hsdg.ctx_role() = 'admin' OR 'admin' = ANY (hsdg.ctx_roles())) THEN
    RAISE EXCEPTION 'Only an administrator can delete an engagement permanently.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('hsdg.purging', 'on', true);
  -- Nothing here is undoable: keep the undo log out of it.
  PERFORM set_config('hsdg.change_set', '', true);

  -- The engagement and every engagement merged into it, deepest first.
  WITH RECURSIVE tree(id, depth) AS (
    SELECT e.id, 0 FROM engagements e WHERE e.id = p_engagement_id
    UNION ALL
    SELECT e.id, tree.depth + 1 FROM engagements e JOIN tree ON e.merged_into_id = tree.id
  )
  SELECT array_agg(id ORDER BY depth DESC) INTO eng FROM tree;
  IF eng IS NULL THEN
    PERFORM set_config('hsdg.purging', '', true);
    RETURN NULL;
  END IF;

  SELECT array_agg(id) INTO docs FROM documents WHERE engagement_id = ANY (eng);
  SELECT array_agg(id) INTO inv FROM invoices WHERE engagement_id = ANY (eng);
  docs := COALESCE(docs, '{}');
  inv := COALESCE(inv, '{}');

  SELECT array_agg(r) INTO refs FROM (
    SELECT storage_reference AS r FROM document_versions WHERE document_id = ANY (docs)
    UNION ALL SELECT pdf_storage_reference FROM invoices WHERE id = ANY (inv)
    UNION ALL SELECT pdf_storage_reference FROM credit_notes WHERE invoice_id = ANY (inv)
  ) s WHERE r IS NOT NULL;

  -- Every record filed directly under it, for the audit trail and notifications.
  objs := eng;
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.columns k
        ON k.table_schema = c.table_schema AND k.table_name = c.table_name
       AND k.column_name = 'id' AND k.data_type = 'uuid'
      JOIN pg_class r ON r.relname = c.table_name AND r.relnamespace = 'hsdg'::regnamespace
     WHERE c.table_schema = 'hsdg' AND c.column_name = 'engagement_id' AND r.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('SELECT array_agg(id) FROM hsdg.%I WHERE engagement_id = ANY ($1)', t)
      INTO more USING eng;
    objs := objs || COALESCE(more, '{}');
  END LOOP;

  -- Billing that points at it or its invoices without a cascade.
  DELETE FROM receipt_allocations WHERE invoice_id = ANY (inv);
  DELETE FROM write_offs WHERE invoice_id = ANY (inv);
  DELETE FROM credit_notes WHERE invoice_id = ANY (inv);
  DELETE FROM invoice_reminders WHERE invoice_id = ANY (inv) OR engagement_id = ANY (eng);
  DELETE FROM fee_billings WHERE billed_invoice_id = ANY (inv) OR engagement_id = ANY (eng);
  DELETE FROM time_billings WHERE billed_invoice_id = ANY (inv) OR engagement_id = ANY (eng);
  DELETE FROM fee_waivers WHERE engagement_id = ANY (eng);
  DELETE FROM engagement_fee_milestones WHERE engagement_id = ANY (eng);
  DELETE FROM invoices WHERE id = ANY (inv);

  -- RESTRICT links inside it, before the cascade reaches them.
  DELETE FROM filing_records WHERE ack_document_id = ANY (docs);
  DELETE FROM audit_framework_memo WHERE document_id = ANY (docs);
  DELETE FROM compliance_instances WHERE engagement_service_id IN
    (SELECT id FROM engagement_services WHERE engagement_id = ANY (eng));
  DELETE FROM engagement_components WHERE engagement_service_id IN
    (SELECT id FROM engagement_services WHERE engagement_id = ANY (eng));
  DELETE FROM engagement_time_entries
   WHERE engagement_id = ANY (eng) AND adjusts_entry_id IS NOT NULL;

  -- What names it without a foreign key.
  DELETE FROM audit_events
   WHERE object_id = ANY (objs::text[])
      OR (after_state ->> 'engagementId') = ANY (eng::text[])
      OR (before_state ->> 'engagementId') = ANY (eng::text[]);
  DELETE FROM notifications WHERE object_id = ANY (objs);
  DELETE FROM engagement_restructure_moves
   WHERE from_engagement_id = ANY (eng) OR to_engagement_id = ANY (eng) OR object_id = ANY (eng);

  -- One at a time, merged ones first: merged_into_id is RESTRICT.
  FOR i IN 1 .. array_length(eng, 1) LOOP
    DELETE FROM engagements WHERE id = eng[i];
  END LOOP;

  PERFORM set_config('hsdg.purging', '', true);
  RETURN COALESCE(refs, '{}');
END;
$$;

REVOKE ALL ON FUNCTION hsdg.purge_engagement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.purge_engagement(uuid) TO hsdg_app;

-- What a purge would remove, found by the engagement's code — an administrator
-- is not on engagements, so RLS would show them none.
CREATE FUNCTION hsdg.purge_engagement_preview(p_code text)
RETURNS TABLE (
  id uuid, engagement_code text, client_name text, status text, financial_year text,
  documents int, tasks int, filings int, time_entries int, invoices int, issued_invoices int,
  merged int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NOT (hsdg.ctx_role() = 'admin' OR 'admin' = ANY (hsdg.ctx_roles())) THEN
    RAISE EXCEPTION 'Only an administrator can delete an engagement permanently.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('hsdg.purging', 'on', true);
  RETURN QUERY
    SELECT e.id, e.engagement_code, COALESCE(n.display_name, n.legal_name), e.status, e.financial_year,
           (SELECT count(*)::int FROM documents d WHERE d.engagement_id = e.id),
           (SELECT count(*)::int FROM tasks t WHERE t.engagement_id = e.id),
           (SELECT count(*)::int FROM filing_records f WHERE f.engagement_id = e.id),
           (SELECT count(*)::int FROM engagement_time_entries te WHERE te.engagement_id = e.id),
           (SELECT count(*)::int FROM invoices i WHERE i.engagement_id = e.id),
           (SELECT count(*)::int FROM invoices i WHERE i.engagement_id = e.id AND i.status <> 'draft'),
           (SELECT count(*)::int FROM engagements m WHERE m.merged_into_id = e.id)
      FROM engagements e
      JOIN entities n ON n.id = e.entity_id
     WHERE upper(e.engagement_code) = upper(btrim(p_code));
  PERFORM set_config('hsdg.purging', '', true);
END;
$$;

REVOKE ALL ON FUNCTION hsdg.purge_engagement_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.purge_engagement_preview(text) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.purge_engagement_preview(text);
DROP FUNCTION IF EXISTS hsdg.purge_engagement(uuid);

CREATE OR REPLACE FUNCTION hsdg.invoice_line_guard_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT i.status INTO st FROM hsdg.invoices i WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice''s lines can change; this invoice is %.', st
      USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT p.polrelid::regclass::text FROM pg_policy p
     WHERE p.polname = 'purge_engagement'
       AND p.polrelid::regclass::text LIKE 'hsdg.%'
  LOOP
    EXECUTE format('DROP POLICY purge_engagement ON %s', t);
  END LOOP;
END $$;
