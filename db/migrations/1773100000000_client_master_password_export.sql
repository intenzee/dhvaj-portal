-- ─────────────────────────────────────────────────────────────────────────
-- ADR-0035 · The Client Master export, with the passwords
--
-- The Client Master workbook now carries each client's main logins on its
-- row. "Export with passwords" writes them in full, so the firm can read
-- and share its client logins from one file. Each login is opened under the
-- same rule as a single reveal (the managing partner, a partner of the
-- client's home office, the team on one of its engagements); the others stay
-- masked. Every login written is logged in credential_access_log, as
-- via = 'export', so who took which password out stays on record.
--
-- An export opens many logins at once, so its rows do not count towards the
-- 60-an-hour reveal limit; instead a person can export with passwords 5
-- times an hour.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.credential_access_log
  ADD COLUMN via text NOT NULL DEFAULT 'reveal' CHECK (via IN ('reveal', 'export'));

CREATE OR REPLACE FUNCTION hsdg.reveal_client_credential(p_id uuid)
RETURNS TABLE (
  ciphertext  bytea,
  iv          bytea,
  auth_tag    bytea,
  key_version smallint,
  entity_id   uuid,
  portal      text,
  account     text
)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_entity uuid;
  v_office uuid;
BEGIN
  IF hsdg.ctx_user_id() IS NULL THEN
    RAISE EXCEPTION 'credential_forbidden' USING ERRCODE = '42501';
  END IF;
  -- The client is read through the caller's row-level security (entities'
  -- policies evaluate the caller's context): an unseen client is "not found".
  SELECT c.entity_id INTO v_entity FROM hsdg.client_credentials c WHERE c.id = p_id;
  SELECT e.home_office_id INTO v_office FROM hsdg.entities e WHERE e.id = v_entity;
  IF NOT FOUND OR v_entity IS NULL THEN
    RAISE EXCEPTION 'credential_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (hsdg.ctx_is_business_firmwide()
          OR (hsdg.ctx_role() = 'partner' AND v_office = hsdg.ctx_office_id())
          OR hsdg.can_access_entity_via_engagement(v_entity)) THEN
    RAISE EXCEPTION 'credential_forbidden' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM hsdg.credential_access_log l
       WHERE l.user_id = hsdg.ctx_user_id() AND l.via = 'reveal'
         AND l.revealed_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'credential_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO hsdg.credential_access_log (credential_id, entity_id, user_id, role)
  VALUES (p_id, v_entity, hsdg.ctx_user_id(), hsdg.ctx_role());
  RETURN QUERY
    SELECT c.ciphertext, c.iv, c.auth_tag, c.key_version, c.entity_id, c.portal, c.account
      FROM hsdg.client_credentials c WHERE c.id = p_id;
END
$$;

-- Every login of a live client the caller may reveal, sealed, each logged.
CREATE OR REPLACE FUNCTION hsdg.export_client_credentials()
RETURNS TABLE (
  id          uuid,
  ciphertext  bytea,
  iv          bytea,
  auth_tag    bytea,
  key_version smallint,
  entity_id   uuid,
  portal      text,
  account     text
)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF hsdg.ctx_user_id() IS NULL THEN
    RAISE EXCEPTION 'credential_forbidden' USING ERRCODE = '42501';
  END IF;
  -- One export writes its rows at one now(): count the exports, not the rows.
  IF (SELECT count(DISTINCT l.revealed_at) FROM hsdg.credential_access_log l
       WHERE l.user_id = hsdg.ctx_user_id() AND l.via = 'export'
         AND l.revealed_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'credential_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
    WITH picked AS (
      -- The clients are read through the caller's row-level security.
      SELECT c.id AS cred_id, c.entity_id AS cred_entity
        FROM hsdg.client_credentials c
        JOIN hsdg.entities e ON e.id = c.entity_id
       WHERE e.status <> 'archived'
         AND (hsdg.ctx_is_business_firmwide()
              OR (hsdg.ctx_role() = 'partner' AND e.home_office_id = hsdg.ctx_office_id())
              OR hsdg.can_access_entity_via_engagement(e.id))
    ), logged AS (
      INSERT INTO hsdg.credential_access_log (credential_id, entity_id, user_id, role, via)
      SELECT p.cred_id, p.cred_entity, hsdg.ctx_user_id(), hsdg.ctx_role(), 'export'
        FROM picked p
      RETURNING credential_id
    )
    SELECT c.id, c.ciphertext, c.iv, c.auth_tag, c.key_version, c.entity_id, c.portal, c.account
      FROM hsdg.client_credentials c
      JOIN logged l ON l.credential_id = c.id;
END
$$;
REVOKE EXECUTE ON FUNCTION hsdg.export_client_credentials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.export_client_credentials() TO hsdg_app;

-- Down Migration

DROP FUNCTION IF EXISTS hsdg.export_client_credentials();
CREATE OR REPLACE FUNCTION hsdg.reveal_client_credential(p_id uuid)
RETURNS TABLE (
  ciphertext  bytea,
  iv          bytea,
  auth_tag    bytea,
  key_version smallint,
  entity_id   uuid,
  portal      text,
  account     text
)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_entity uuid;
  v_office uuid;
BEGIN
  IF hsdg.ctx_user_id() IS NULL THEN
    RAISE EXCEPTION 'credential_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT c.entity_id INTO v_entity FROM hsdg.client_credentials c WHERE c.id = p_id;
  SELECT e.home_office_id INTO v_office FROM hsdg.entities e WHERE e.id = v_entity;
  IF NOT FOUND OR v_entity IS NULL THEN
    RAISE EXCEPTION 'credential_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (hsdg.ctx_is_business_firmwide()
          OR (hsdg.ctx_role() = 'partner' AND v_office = hsdg.ctx_office_id())
          OR hsdg.can_access_entity_via_engagement(v_entity)) THEN
    RAISE EXCEPTION 'credential_forbidden' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM hsdg.credential_access_log l
       WHERE l.user_id = hsdg.ctx_user_id() AND l.revealed_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'credential_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO hsdg.credential_access_log (credential_id, entity_id, user_id, role)
  VALUES (p_id, v_entity, hsdg.ctx_user_id(), hsdg.ctx_role());
  RETURN QUERY
    SELECT c.ciphertext, c.iv, c.auth_tag, c.key_version, c.entity_id, c.portal, c.account
      FROM hsdg.client_credentials c WHERE c.id = p_id;
END
$$;
ALTER TABLE hsdg.credential_access_log DROP COLUMN via;
