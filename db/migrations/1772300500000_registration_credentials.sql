-- ─────────────────────────────────────────────────────────────────────────
-- ADR-0035 · Client portal credentials (GST logins)
--
-- registration_credentials — one encrypted login per (registration, portal).
-- The API encrypts (AES-256-GCM, key from CREDENTIALS_KEYS, never stored
-- here); this table holds only ciphertext, IV, tag, key version and a masked
-- user-name hint.
--
-- The application role cannot SELECT the ciphertext columns at all. The only
-- read path is hsdg.reveal_registration_credential(id) (SECURITY DEFINER),
-- which checks the caller may reveal (managing partner; a partner of the
-- client's home office; a member of a team on one of the client's
-- engagements), refuses past 60 reveals an hour, and writes
-- credential_access_log before returning.
--
-- credential.reveal / credential.manage are seeded for the business roles.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.registration_credentials (
  id                 uuid PRIMARY KEY,
  registration_id    uuid NOT NULL REFERENCES hsdg.entity_registrations (id) ON DELETE CASCADE,
  portal             text NOT NULL DEFAULT 'gst'
                       CHECK (portal IN ('gst','income_tax','traces','mca','eway_bill','einvoice')),
  username_hint      text NOT NULL CHECK (length(username_hint) BETWEEN 1 AND 40),
  ciphertext         bytea NOT NULL,
  iv                 bytea NOT NULL CHECK (length(iv) = 12),
  auth_tag           bytea NOT NULL CHECK (length(auth_tag) = 16),
  key_version        smallint NOT NULL CHECK (key_version > 0),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_credentials_one_per_portal UNIQUE (registration_id, portal)
);
CREATE TRIGGER registration_credentials_set_updated_at BEFORE UPDATE ON hsdg.registration_credentials
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Write-only for the app: every column but the ciphertext ones is readable.
REVOKE ALL ON hsdg.registration_credentials FROM PUBLIC;
REVOKE ALL ON hsdg.registration_credentials FROM hsdg_app;
GRANT INSERT, UPDATE, DELETE ON hsdg.registration_credentials TO hsdg_app;
GRANT SELECT (id, registration_id, portal, username_hint, key_version,
              created_by_user_id, updated_by_user_id, created_at, updated_at)
  ON hsdg.registration_credentials TO hsdg_app;

ALTER TABLE hsdg.registration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.registration_credentials FORCE  ROW LEVEL SECURITY;

-- Visible exactly when the registration (so the client) is visible.
CREATE POLICY registration_credentials_select ON hsdg.registration_credentials
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM hsdg.entity_registrations r WHERE r.id = registration_id)
  );

-- Set / change / remove: the managing partner, or a partner or manager of the
-- client's home office (the service also requires credential.manage).
CREATE OR REPLACE FUNCTION hsdg.ctx_can_manage_credentials(p_registration_id uuid)
RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_business_firmwide()
      OR (hsdg.ctx_role() IN ('partner', 'manager') AND EXISTS (
            SELECT 1 FROM hsdg.entity_registrations r
              JOIN hsdg.entities e ON e.id = r.entity_id
             WHERE r.id = p_registration_id AND e.home_office_id = hsdg.ctx_office_id()));
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_can_manage_credentials(uuid) TO hsdg_app;

CREATE POLICY registration_credentials_insert ON hsdg.registration_credentials
  FOR INSERT WITH CHECK (hsdg.ctx_can_manage_credentials(registration_id));
CREATE POLICY registration_credentials_update ON hsdg.registration_credentials
  FOR UPDATE USING (hsdg.ctx_can_manage_credentials(registration_id))
  WITH CHECK (hsdg.ctx_can_manage_credentials(registration_id));
CREATE POLICY registration_credentials_delete ON hsdg.registration_credentials
  FOR DELETE USING (hsdg.ctx_can_manage_credentials(registration_id));

-- ── Who revealed what, written only by the reveal function ────────────────
CREATE TABLE hsdg.credential_access_log (
  id              bigserial PRIMARY KEY,
  credential_id   uuid NOT NULL REFERENCES hsdg.registration_credentials (id) ON DELETE CASCADE,
  registration_id uuid NOT NULL,
  user_id         uuid NOT NULL,
  role            text NOT NULL,
  revealed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credential_access_log_credential_idx
  ON hsdg.credential_access_log (credential_id, revealed_at DESC);
CREATE INDEX credential_access_log_user_idx ON hsdg.credential_access_log (user_id, revealed_at);

REVOKE ALL ON hsdg.credential_access_log FROM PUBLIC;
REVOKE ALL ON hsdg.credential_access_log FROM hsdg_app;
GRANT SELECT ON hsdg.credential_access_log TO hsdg_app;
ALTER TABLE hsdg.credential_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.credential_access_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY credential_access_log_owner ON hsdg.credential_access_log
  TO hsdg_migrator USING (true) WITH CHECK (true);
-- Partners read the log of the clients they can see.
CREATE POLICY credential_access_log_select ON hsdg.credential_access_log
  FOR SELECT TO hsdg_app USING (
    hsdg.ctx_role() IN ('managing_partner', 'partner')
    AND EXISTS (SELECT 1 FROM hsdg.registration_credentials c WHERE c.id = credential_id)
  );

-- ── The one read path for the ciphertext ──────────────────────────────────
CREATE OR REPLACE FUNCTION hsdg.reveal_registration_credential(p_id uuid)
RETURNS TABLE (
  ciphertext      bytea,
  iv              bytea,
  auth_tag        bytea,
  key_version     smallint,
  registration_id uuid,
  portal          text
)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_entity uuid;
  v_office uuid;
  v_reg    uuid;
BEGIN
  IF hsdg.ctx_user_id() IS NULL THEN
    RAISE EXCEPTION 'credential_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Read through the caller's row-level security (the policies apply to the
  -- owner too and evaluate the caller's context): an unseen client is "not found".
  SELECT r.entity_id, e.home_office_id, c.registration_id
    INTO v_entity, v_office, v_reg
    FROM hsdg.registration_credentials c
    JOIN hsdg.entity_registrations r ON r.id = c.registration_id
    JOIN hsdg.entities e ON e.id = r.entity_id
   WHERE c.id = p_id;
  IF NOT FOUND THEN
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
  INSERT INTO hsdg.credential_access_log (credential_id, registration_id, user_id, role)
  VALUES (p_id, v_reg, hsdg.ctx_user_id(), hsdg.ctx_role());
  RETURN QUERY
    SELECT c.ciphertext, c.iv, c.auth_tag, c.key_version, c.registration_id, c.portal
      FROM hsdg.registration_credentials c WHERE c.id = p_id;
END
$$;
REVOKE EXECUTE ON FUNCTION hsdg.reveal_registration_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.reveal_registration_credential(uuid) TO hsdg_app;

-- ── Permissions ───────────────────────────────────────────────────────────
ALTER TABLE hsdg.roles            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO hsdg.permissions (slug, description) VALUES
  ('credential.reveal', 'Show a client''s saved portal login'),
  ('credential.manage', 'Add, change, remove or import clients'' portal logins')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'credential.reveal'
 WHERE r.slug IN ('managing_partner', 'partner', 'manager', 'senior', 'article')
ON CONFLICT DO NOTHING;
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM hsdg.roles r
  JOIN hsdg.permissions p ON p.slug = 'credential.manage'
 WHERE r.slug IN ('managing_partner', 'partner', 'manager')
ON CONFLICT DO NOTHING;
ALTER TABLE hsdg.roles            FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE hsdg.permissions      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.role_permissions
  WHERE permission_id IN (SELECT id FROM hsdg.permissions
                           WHERE slug IN ('credential.reveal', 'credential.manage'));
DELETE FROM hsdg.permissions WHERE slug IN ('credential.reveal', 'credential.manage');
ALTER TABLE hsdg.permissions      FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS hsdg.reveal_registration_credential(uuid);
DROP TABLE IF EXISTS hsdg.credential_access_log;
DROP TABLE IF EXISTS hsdg.registration_credentials;
DROP FUNCTION IF EXISTS hsdg.ctx_can_manage_credentials(uuid);
