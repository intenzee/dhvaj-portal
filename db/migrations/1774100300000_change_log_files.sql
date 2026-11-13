-- ─────────────────────────────────────────────────────────────────────────
-- Change log: files added to a client's engagement
--
--   · hsdg.document_versions: every file uploaded — a new document (version 1)
--     or a new version of one — whichever path made it: the documents screen,
--     a filing or the audit file (they all upload a document and link it), or
--     the client through an upload link. Labelled with the file name; the
--     engagement (and so the client) come from the row. The storage key and
--     checksum are left out.
--   · hsdg.documents: edits only — renamed, reclassified, archived, deleted,
--     restored. Its insert is the same upload as its first version, so it is
--     not logged twice; the version pointer, extracted text, search vector and
--     Microsoft 365 sync columns are bookkeeping, not changes.
--   · hsdg.log_change(): labels a row by its file name, or its title, when it
--     has none of the earlier labels.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE OR REPLACE FUNCTION hsdg.log_change() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE
  o    jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n    jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r    jsonb := COALESCE(n, o);
  skip text[] := ARRAY['version', 'created_at', 'updated_at', 'ciphertext', 'iv', 'auth_tag',
                       'key_version', 'created_by_user_id', 'updated_by_user_id']
                 || TG_ARGV::text[];
  diff jsonb := '{}'::jsonb;
  k    text;
  ent  uuid;
  eng  uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      CONTINUE WHEN k = ANY (skip);
      IF (o -> k) IS DISTINCT FROM (n -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO diff
      FROM jsonb_each(r)
     WHERE key <> ALL (skip) AND value <> 'null'::jsonb AND key <> 'id';
  END IF;

  eng := CASE WHEN TG_TABLE_NAME = 'engagements' THEN (r ->> 'id')::uuid
              ELSE (r ->> 'engagement_id')::uuid END;
  ent := CASE WHEN TG_TABLE_NAME = 'entities' THEN (r ->> 'id')::uuid
              ELSE COALESCE((r ->> 'entity_id')::uuid, (r ->> 'from_entity_id')::uuid) END;
  IF ent IS NULL AND eng IS NOT NULL THEN
    SELECT e.entity_id INTO ent FROM hsdg.engagements e WHERE e.id = eng;
  END IF;

  INSERT INTO hsdg.change_log
    (actor_user_id, actor_role, table_name, row_id, op, entity_id, engagement_id, label, changes)
  VALUES (
    hsdg.ctx_user_id(), hsdg.ctx_role(), TG_TABLE_NAME,
    COALESCE(r ->> 'id', r ->> 'engagement_id'), lower(TG_OP), ent, eng,
    COALESCE(r ->> 'registration_number', r ->> 'legal_name', r ->> 'engagement_code',
             r ->> 'full_name', r ->> 'label',
             CASE WHEN TG_TABLE_NAME = 'client_credentials'
                  THEN concat_ws(' · ', r ->> 'portal', r ->> 'account', r ->> 'username_hint') END,
             r ->> 'description', r ->> 'financial_year', r ->> 'role_on_engagement',
             r ->> 'attribute_code', r ->> 'line1', r ->> 'exchange',
             r ->> 'filename', r ->> 'title'),
    diff);
  RETURN NULL;
END $$;

CREATE TRIGGER document_versions_change_log
  AFTER INSERT OR UPDATE OR DELETE ON hsdg.document_versions
  FOR EACH ROW EXECUTE FUNCTION hsdg.log_change('storage_reference', 'checksum_sha256', 'uploaded_at');

CREATE TRIGGER documents_change_log
  AFTER UPDATE OR DELETE ON hsdg.documents
  FOR EACH ROW EXECUTE FUNCTION hsdg.log_change(
    'current_version_id', 'current_version_no', 'extracted_text', 'extracted_fields',
    'extracted_at', 'ocr_status', 'documents_fts', 'm365_drive_id', 'm365_live_item_id',
    'm365_synced_ctag', 'edit_locked', 'edit_locked_reason');

-- Down Migration

DROP TRIGGER IF EXISTS documents_change_log ON hsdg.documents;
DROP TRIGGER IF EXISTS document_versions_change_log ON hsdg.document_versions;

CREATE OR REPLACE FUNCTION hsdg.log_change() RETURNS trigger
  LANGUAGE plpgsql SET search_path = hsdg, pg_temp AS $$
DECLARE
  o    jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n    jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  r    jsonb := COALESCE(n, o);
  skip text[] := ARRAY['version', 'created_at', 'updated_at', 'ciphertext', 'iv', 'auth_tag',
                       'key_version', 'created_by_user_id', 'updated_by_user_id']
                 || TG_ARGV::text[];
  diff jsonb := '{}'::jsonb;
  k    text;
  ent  uuid;
  eng  uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      CONTINUE WHEN k = ANY (skip);
      IF (o -> k) IS DISTINCT FROM (n -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO diff
      FROM jsonb_each(r)
     WHERE key <> ALL (skip) AND value <> 'null'::jsonb AND key <> 'id';
  END IF;

  eng := CASE WHEN TG_TABLE_NAME = 'engagements' THEN (r ->> 'id')::uuid
              ELSE (r ->> 'engagement_id')::uuid END;
  ent := CASE WHEN TG_TABLE_NAME = 'entities' THEN (r ->> 'id')::uuid
              ELSE COALESCE((r ->> 'entity_id')::uuid, (r ->> 'from_entity_id')::uuid) END;
  IF ent IS NULL AND eng IS NOT NULL THEN
    SELECT e.entity_id INTO ent FROM hsdg.engagements e WHERE e.id = eng;
  END IF;

  INSERT INTO hsdg.change_log
    (actor_user_id, actor_role, table_name, row_id, op, entity_id, engagement_id, label, changes)
  VALUES (
    hsdg.ctx_user_id(), hsdg.ctx_role(), TG_TABLE_NAME,
    COALESCE(r ->> 'id', r ->> 'engagement_id'), lower(TG_OP), ent, eng,
    COALESCE(r ->> 'registration_number', r ->> 'legal_name', r ->> 'engagement_code',
             r ->> 'full_name', r ->> 'label',
             CASE WHEN TG_TABLE_NAME = 'client_credentials'
                  THEN concat_ws(' · ', r ->> 'portal', r ->> 'account', r ->> 'username_hint') END,
             r ->> 'description', r ->> 'financial_year', r ->> 'role_on_engagement',
             r ->> 'attribute_code', r ->> 'line1', r ->> 'exchange'),
    diff);
  RETURN NULL;
END $$;
