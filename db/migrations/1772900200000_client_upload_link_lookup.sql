-- ─────────────────────────────────────────────────────────────────────────
-- Client upload links open again
--
-- Every link a client opened said "This upload link is invalid or has
-- expired." The public path has no signed-in user; its two SECURITY DEFINER
-- functions (1762000000000_client_upload_portal) run as the owner, but
-- client_upload_links, client_dependencies, engagements and entities are
-- FORCE RLS, so the owner is held to the caller's policies — which, with no
-- user, match nothing. The token lookup found no link and answered invalid.
--
-- Each table the functions read or write gets a migrator-only policy that is
-- live only while hsdg.client_upload = 'on' — which the functions set after
-- hashing the caller's token and clear before returning, as the other
-- definer functions do (1772600000000_people_desk). The token is still the
-- whole authorisation: the link is found by its hash, then checked for
-- expiry, revocation and its upload cap before anything is written.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE POLICY client_upload_links_client_upload_select ON hsdg.client_upload_links
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.client_upload', true) = 'on');
CREATE POLICY client_upload_links_client_upload_update ON hsdg.client_upload_links
  FOR UPDATE TO hsdg_migrator
  USING (current_setting('hsdg.client_upload', true) = 'on')
  WITH CHECK (current_setting('hsdg.client_upload', true) = 'on');
CREATE POLICY client_dependencies_client_upload_select ON hsdg.client_dependencies
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.client_upload', true) = 'on');
CREATE POLICY engagements_client_upload_select ON hsdg.engagements
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.client_upload', true) = 'on');
CREATE POLICY entities_client_upload_select ON hsdg.entities
  FOR SELECT TO hsdg_migrator
  USING (current_setting('hsdg.client_upload', true) = 'on');

-- ── Public read: minimal info to render the upload page ────────────────────
CREATE OR REPLACE FUNCTION hsdg.client_upload_link_info(p_token_hash text)
  RETURNS TABLE (
    valid            boolean,
    engagement_id    uuid,
    requested_info   text,
    outstanding_items text,
    entity_name      text,
    engagement_code  text,
    expires_at       timestamptz,
    uploads_remaining integer
  )
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  l hsdg.client_upload_links;
BEGIN
  PERFORM set_config('hsdg.client_upload', 'on', true);
  SELECT * INTO l FROM hsdg.client_upload_links WHERE token_hash = p_token_hash;
  IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at <= now() THEN
    PERFORM set_config('hsdg.client_upload', '', true);
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT true, l.engagement_id, cd.requested_info, cd.outstanding_items, ent.legal_name,
           eng.engagement_code, l.expires_at,
           CASE WHEN l.max_uploads IS NULL THEN NULL ELSE l.max_uploads - l.uploads_used END
      FROM hsdg.client_dependencies cd
      JOIN hsdg.engagements eng ON eng.id = cd.engagement_id
      LEFT JOIN hsdg.entities ent ON ent.id = eng.entity_id
     WHERE cd.id = l.client_dependency_id;
  PERFORM set_config('hsdg.client_upload', '', true);
END $$;

-- ── Public write: the ONLY way a token turns into a stored document ────────
CREATE OR REPLACE FUNCTION hsdg.create_client_document(
  p_token_hash       text,
  p_title            text,
  p_filename         text,
  p_content_type     text,
  p_size             bigint,
  p_checksum         text,
  p_storage_reference text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  l           hsdg.client_upload_links;
  v_doc_id    uuid;
  v_version_id uuid;
BEGIN
  -- 1. Validate the token (the whole authorisation for this public write).
  PERFORM set_config('hsdg.client_upload', 'on', true);
  SELECT * INTO l FROM hsdg.client_upload_links
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at <= now()
     OR (l.max_uploads IS NOT NULL AND l.uploads_used >= l.max_uploads) THEN
    PERFORM set_config('hsdg.client_upload', '', true);
    RAISE EXCEPTION 'invalid_or_expired_link' USING ERRCODE = 'check_violation';
  END IF;

  -- 2. Elevate the RLS context ONLY for the two scoped inserts below. The token
  --    is already validated and the engagement is pinned from the link, so this
  --    is a controlled, minimal elevation (business-firm-wide = managing_partner).
  PERFORM set_config('hsdg.role', 'managing_partner', true);

  -- 3. Insert the document + its first version, attached to the link's engagement
  --    and dependency. No staff actor; classified client_shared.
  v_doc_id := gen_random_uuid();
  INSERT INTO hsdg.documents
    (id, engagement_id, title, document_type, classification, sensitivity,
     created_by_employee_id, client_dependency_id, ocr_status)
  VALUES
    (v_doc_id, l.engagement_id, p_title, 'evidence', 'client_shared', 'normal',
     NULL, l.client_dependency_id, 'pending');

  INSERT INTO hsdg.document_versions
    (document_id, engagement_id, version_no, filename, content_type, size_bytes,
     checksum_sha256, storage_reference, note, uploaded_by_employee_id)
  VALUES
    (v_doc_id, l.engagement_id, 1, p_filename, p_content_type, p_size,
     p_checksum, p_storage_reference, 'Uploaded by client via secure link', NULL)
  RETURNING id INTO v_version_id;

  UPDATE hsdg.documents SET current_version_id = v_version_id, current_version_no = 1
    WHERE id = v_doc_id;

  -- 4. Count the upload against the link's cap.
  UPDATE hsdg.client_upload_links
    SET uploads_used = uploads_used + 1 WHERE id = l.id;

  PERFORM set_config('hsdg.client_upload', '', true);
  RETURN v_doc_id;
END $$;

-- Down Migration

DROP POLICY IF EXISTS entities_client_upload_select ON hsdg.entities;
DROP POLICY IF EXISTS engagements_client_upload_select ON hsdg.engagements;
DROP POLICY IF EXISTS client_dependencies_client_upload_select ON hsdg.client_dependencies;
DROP POLICY IF EXISTS client_upload_links_client_upload_update ON hsdg.client_upload_links;
DROP POLICY IF EXISTS client_upload_links_client_upload_select ON hsdg.client_upload_links;
-- The functions keep their new bodies: without the policies they behave as before.
