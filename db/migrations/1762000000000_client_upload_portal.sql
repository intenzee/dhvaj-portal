-- ─────────────────────────────────────────────────────────────────────────
-- 0046 · Client upload portal (secure magic-link)
--
-- Lets a firm member hand a client a tokenised, expiring, UPLOAD-ONLY link for a
-- specific client dependency (PBC request). The client opens a public page (no
-- login) and drops files, which land as client_shared documents on the right
-- engagement, attached to that dependency — no account, no browse access.
--
--   client_upload_links — one magic link per (engagement, client dependency).
--     Only a SHA-256 HASH of the token is stored (the raw token is shown to the
--     creator once and never persisted). A link expires, can be revoked, and can
--     cap the number of uploads.
--   documents.client_dependency_id — attaches an uploaded file to the PBC request
--     (same engagement; ON DELETE SET NULL keeps evidence if the request is removed).
--
-- SECURITY — the public path has NO authenticated principal, so the TOKEN is the
-- authorisation. A single SECURITY DEFINER writer (`hsdg.create_client_document`)
-- is the whole trust boundary: it validates the token (hash match, not expired,
-- not revoked, under cap) BEFORE any write, pins the engagement/dependency from
-- the link (never from client input), and elevates the RLS context only for its
-- own two scoped inserts. Everything else (browse, read, delete) stays behind the
-- normal authenticated RLS. This is security-sensitive: run a security review and
-- keep CLIENT_UPLOAD_ENABLED off until it passes.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.documents
  ADD COLUMN client_dependency_id uuid
    REFERENCES hsdg.client_dependencies (id) ON DELETE SET NULL;
CREATE INDEX documents_client_dependency_id_idx ON hsdg.documents (client_dependency_id)
  WHERE client_dependency_id IS NOT NULL;
COMMENT ON COLUMN hsdg.documents.client_dependency_id IS
  'Client dependency (PBC request) this document was uploaded against, if via the client portal.';

CREATE TABLE hsdg.client_upload_links (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id          uuid NOT NULL REFERENCES hsdg.engagements (id) ON DELETE CASCADE,
  client_dependency_id   uuid NOT NULL REFERENCES hsdg.client_dependencies (id) ON DELETE CASCADE,
  -- SHA-256 hex of the raw token; the raw token is never stored.
  token_hash             text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by_employee_id uuid REFERENCES hsdg.employees (id) ON DELETE SET NULL,
  expires_at             timestamptz NOT NULL,
  max_uploads            integer CHECK (max_uploads IS NULL OR max_uploads > 0),
  uploads_used           integer NOT NULL DEFAULT 0,
  revoked_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_upload_links_id_engagement_key UNIQUE (id, engagement_id)
);
CREATE INDEX client_upload_links_engagement_idx ON hsdg.client_upload_links (engagement_id);
CREATE INDEX client_upload_links_dependency_idx ON hsdg.client_upload_links (client_dependency_id);
CREATE TRIGGER client_upload_links_set_updated_at BEFORE UPDATE ON hsdg.client_upload_links
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- RLS: engagement-scoped for staff (members read, leads write). The PUBLIC path
-- never touches this table directly — it goes through the SECURITY DEFINER
-- functions below, which run as the owner and validate the token themselves.
ALTER TABLE hsdg.client_upload_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.client_upload_links FORCE  ROW LEVEL SECURITY;
CREATE POLICY client_upload_links_select ON hsdg.client_upload_links
  FOR SELECT USING (hsdg.is_engagement_member(engagement_id));
CREATE POLICY client_upload_links_insert ON hsdg.client_upload_links
  FOR INSERT WITH CHECK (hsdg.is_engagement_lead(engagement_id));
CREATE POLICY client_upload_links_update ON hsdg.client_upload_links
  FOR UPDATE USING (hsdg.is_engagement_lead(engagement_id))
  WITH CHECK (hsdg.is_engagement_lead(engagement_id));

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
  SELECT * INTO l FROM hsdg.client_upload_links WHERE token_hash = p_token_hash;
  IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at <= now() THEN
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
  SELECT * INTO l FROM hsdg.client_upload_links
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at <= now()
     OR (l.max_uploads IS NOT NULL AND l.uploads_used >= l.max_uploads) THEN
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

  RETURN v_doc_id;
END $$;

REVOKE EXECUTE ON FUNCTION hsdg.client_upload_link_info(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  hsdg.create_client_document(text, text, text, text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.client_upload_link_info(text) TO hsdg_app;
GRANT EXECUTE ON FUNCTION
  hsdg.create_client_document(text, text, text, text, bigint, text, text) TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS
  hsdg.create_client_document(text, text, text, text, bigint, text, text);
DROP FUNCTION IF EXISTS hsdg.client_upload_link_info(text);

DROP POLICY IF EXISTS client_upload_links_update ON hsdg.client_upload_links;
DROP POLICY IF EXISTS client_upload_links_insert ON hsdg.client_upload_links;
DROP POLICY IF EXISTS client_upload_links_select ON hsdg.client_upload_links;
DROP TABLE IF EXISTS hsdg.client_upload_links CASCADE;

DROP INDEX IF EXISTS hsdg.documents_client_dependency_id_idx;
ALTER TABLE hsdg.documents DROP COLUMN IF EXISTS client_dependency_id;
