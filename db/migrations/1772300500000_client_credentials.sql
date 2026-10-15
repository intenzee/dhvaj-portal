-- ─────────────────────────────────────────────────────────────────────────
-- ADR-0035 · Client portal credentials
--
-- client_credentials — a client's encrypted portal logins: the GST login of
-- each GSTIN, the income-tax login of its PAN and TAN, and its TRACES
-- deductor / taxpayer logins. The API encrypts (AES-256-GCM, key from
-- CREDENTIALS_KEYS, never stored here); this table holds only ciphertext,
-- IV, tag, key version and a masked user-name hint.
--
-- A login belongs to the client. registration_id ties it to the GSTIN or
-- TAN it is for; a GST login can wait without one ("Name (Delhi)" in the
-- firm's sheet, GSTIN not known yet) holding its state, and is attached by
-- trigger when a GSTIN of that state is added. The GST return frequency read
-- with it (pending_gst_scheme) then becomes the GSTIN's compliance profile.
--
-- The application role cannot SELECT the ciphertext columns at all. The only
-- read path is hsdg.reveal_client_credential(id) (SECURITY DEFINER), which
-- checks the caller may reveal (managing partner; a partner of the client's
-- home office; a member of a team on one of the client's engagements),
-- refuses past 60 reveals an hour, and writes credential_access_log first.
--
-- credential.reveal / credential.manage are seeded for the business roles.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.client_credentials (
  id                 uuid PRIMARY KEY,
  entity_id          uuid NOT NULL REFERENCES hsdg.entities (id) ON DELETE CASCADE,
  registration_id    uuid REFERENCES hsdg.entity_registrations (id) ON DELETE SET NULL,
  portal             text NOT NULL
                       CHECK (portal IN ('gst','income_tax','traces','mca','eway_bill','einvoice')),
  -- Which login on that portal: the client's own (main), its TAN's
  -- income-tax login, or a TRACES deductor / taxpayer login.
  account            text NOT NULL DEFAULT 'main'
                       CHECK (account IN ('main','tan','deductor','taxpayer')),
  -- The GST state a login without its GSTIN is for.
  state_code         text CHECK (state_code ~ '^[0-9]{2}$'),
  -- Monthly (regular) or quarterly (qrmp) from the sheet, until the GSTIN comes.
  pending_gst_scheme text CHECK (pending_gst_scheme IN ('regular','qrmp')),
  username_hint      text NOT NULL CHECK (length(username_hint) BETWEEN 1 AND 40),
  ciphertext         bytea NOT NULL,
  iv                 bytea NOT NULL CHECK (length(iv) = 12),
  auth_tag           bytea NOT NULL CHECK (length(auth_tag) = 16),
  key_version        smallint NOT NULL CHECK (key_version > 0),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_credentials_pending_gst CHECK (
    pending_gst_scheme IS NULL OR (portal = 'gst' AND registration_id IS NULL))
);
-- One login per client, portal and account — per registration, or per state
-- while it waits for one.
CREATE UNIQUE INDEX client_credentials_one_per_target ON hsdg.client_credentials
  (entity_id, portal, account, COALESCE(registration_id::text, state_code, ''));
CREATE INDEX client_credentials_registration_idx ON hsdg.client_credentials (registration_id);
CREATE TRIGGER client_credentials_set_updated_at BEFORE UPDATE ON hsdg.client_credentials
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- Write-only for the app: every column but the ciphertext ones is readable.
REVOKE ALL ON hsdg.client_credentials FROM PUBLIC;
REVOKE ALL ON hsdg.client_credentials FROM hsdg_app;
GRANT INSERT, UPDATE, DELETE ON hsdg.client_credentials TO hsdg_app;
GRANT SELECT (id, entity_id, registration_id, portal, account, state_code, pending_gst_scheme,
              username_hint, key_version, created_by_user_id, updated_by_user_id,
              created_at, updated_at)
  ON hsdg.client_credentials TO hsdg_app;

ALTER TABLE hsdg.client_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.client_credentials FORCE  ROW LEVEL SECURITY;

-- The owner-run SECURITY DEFINER functions below (reveal, attach).
CREATE POLICY client_credentials_owner ON hsdg.client_credentials
  TO hsdg_migrator USING (true) WITH CHECK (true);

-- Visible exactly when the client is visible.
CREATE POLICY client_credentials_select ON hsdg.client_credentials
  FOR SELECT TO hsdg_app USING (
    EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_id)
  );

-- Set / change / remove: the managing partner, or a partner or manager of the
-- client's home office (the service also requires credential.manage).
CREATE OR REPLACE FUNCTION hsdg.ctx_can_manage_credentials(p_entity_id uuid)
RETURNS boolean
  LANGUAGE sql STABLE SET search_path = hsdg, pg_temp AS $$
  SELECT hsdg.ctx_is_business_firmwide()
      OR (hsdg.ctx_role() IN ('partner', 'manager') AND EXISTS (
            SELECT 1 FROM hsdg.entities e
             WHERE e.id = p_entity_id AND e.home_office_id = hsdg.ctx_office_id()));
$$;
GRANT EXECUTE ON FUNCTION hsdg.ctx_can_manage_credentials(uuid) TO hsdg_app;

CREATE POLICY client_credentials_insert ON hsdg.client_credentials
  FOR INSERT TO hsdg_app WITH CHECK (hsdg.ctx_can_manage_credentials(entity_id));
CREATE POLICY client_credentials_update ON hsdg.client_credentials
  FOR UPDATE TO hsdg_app USING (hsdg.ctx_can_manage_credentials(entity_id))
  WITH CHECK (hsdg.ctx_can_manage_credentials(entity_id));
CREATE POLICY client_credentials_delete ON hsdg.client_credentials
  FOR DELETE TO hsdg_app USING (hsdg.ctx_can_manage_credentials(entity_id));

-- ── Who revealed what, written only by the reveal function ────────────────
CREATE TABLE hsdg.credential_access_log (
  id            bigserial PRIMARY KEY,
  credential_id uuid NOT NULL REFERENCES hsdg.client_credentials (id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  role          text NOT NULL,
  revealed_at   timestamptz NOT NULL DEFAULT now()
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
    AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = entity_id)
  );

-- ── The one read path for the ciphertext ──────────────────────────────────
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
REVOKE EXECUTE ON FUNCTION hsdg.reveal_client_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.reveal_client_credential(uuid) TO hsdg_app;

-- ── A GSTIN's first GST scheme, from the firm's sheet ─────────────────────
-- The definer paths below write the first compliance profile of a new GSTIN
-- even when the client has no engagement yet (the normal write policy needs
-- a lead of an open engagement). They never change an existing profile.
CREATE POLICY registration_compliance_profiles_owner_read ON hsdg.registration_compliance_profiles
  FOR SELECT TO hsdg_migrator USING (true);
CREATE POLICY registration_compliance_profiles_owner_insert ON hsdg.registration_compliance_profiles
  FOR INSERT TO hsdg_migrator WITH CHECK (true);

-- Internal: not callable by the app. Returns the scheme already on the
-- GSTIN, or NULL when it set this one.
CREATE OR REPLACE FUNCTION hsdg.seed_gst_scheme(
  p_entity_id uuid, p_registration_id uuid, p_state_code text, p_scheme text)
RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_existing text;
BEGIN
  SELECT COALESCE(p.gst_scheme, 'regular') INTO v_existing
    FROM hsdg.registration_compliance_profiles p
   WHERE p.registration_id = p_registration_id AND p.scope = 'gstin'
   ORDER BY p.effective_from DESC LIMIT 1;
  IF FOUND THEN RETURN v_existing; END IF;
  INSERT INTO hsdg.registration_compliance_profiles
    (entity_id, registration_id, scope, effective_from, gst_scheme, qrmp_category,
     created_by_employee_id)
  VALUES (p_entity_id, p_registration_id, 'gstin',
          -- From the start of the current financial year.
          make_date(extract(year FROM current_date - interval '3 months')::int, 4, 1),
          p_scheme,
          CASE WHEN p_scheme <> 'qrmp' THEN NULL
               WHEN p_state_code = ANY (ARRAY['22','23','24','25','26','27','29','30','31',
                                              '32','33','34','35','36','37']) THEN 'X'
               ELSE 'Y' END,
          hsdg.ctx_employee_id())
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION hsdg.seed_gst_scheme(uuid, uuid, text, text) FROM PUBLIC;

-- The import: whoever may manage the client's logins sets a GSTIN's first
-- scheme. Returns the scheme already there (which is kept), or NULL when set.
CREATE OR REPLACE FUNCTION hsdg.set_initial_gst_scheme(p_registration_id uuid, p_scheme text)
RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_entity uuid;
  v_number text;
BEGIN
  IF p_scheme NOT IN ('regular', 'qrmp') THEN
    RAISE EXCEPTION 'gst_scheme_invalid' USING ERRCODE = '22023';
  END IF;
  -- Through the caller's row-level security: an unseen GSTIN is "not found".
  SELECT r.entity_id, r.registration_number INTO v_entity, v_number
    FROM hsdg.entity_registrations r
   WHERE r.id = p_registration_id AND r.registration_type = 'gstin';
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = v_entity) THEN
    RAISE EXCEPTION 'registration_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (hsdg.ctx_can_manage_credentials(v_entity) OR hsdg.can_manage_entity_compliance(v_entity)) THEN
    RAISE EXCEPTION 'gst_scheme_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN hsdg.seed_gst_scheme(v_entity, p_registration_id, left(v_number, 2), p_scheme);
END
$$;
REVOKE EXECUTE ON FUNCTION hsdg.set_initial_gst_scheme(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hsdg.set_initial_gst_scheme(uuid, text) TO hsdg_app;

-- ── A GSTIN added later picks up the login waiting for it ─────────────────
-- The login of the same client and state (or one with no state, when that is
-- all there is) moves onto the GSTIN, and its frequency becomes the GSTIN's
-- first scheme. A GSTIN that already has a GST login keeps it.
CREATE OR REPLACE FUNCTION hsdg.attach_pending_gst_login() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = hsdg, pg_temp AS $$
DECLARE
  v_state  text := left(NEW.registration_number, 2);
  v_id     uuid;
  v_scheme text;
BEGIN
  IF EXISTS (SELECT 1 FROM hsdg.client_credentials c
              WHERE c.registration_id = NEW.id AND c.portal = 'gst' AND c.account = 'main') THEN
    RETURN NEW;
  END IF;
  SELECT c.id, c.pending_gst_scheme INTO v_id, v_scheme
    FROM hsdg.client_credentials c
   WHERE c.entity_id = NEW.entity_id AND c.portal = 'gst' AND c.account = 'main'
     AND c.registration_id IS NULL
     AND (c.state_code = v_state OR c.state_code IS NULL)
   ORDER BY (c.state_code IS NULL), c.created_at
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  UPDATE hsdg.client_credentials
     SET registration_id = NEW.id, state_code = v_state, pending_gst_scheme = NULL
   WHERE id = v_id;
  IF v_scheme IS NOT NULL THEN
    PERFORM hsdg.seed_gst_scheme(NEW.entity_id, NEW.id, v_state, v_scheme);
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION hsdg.attach_pending_gst_login() FROM PUBLIC;
CREATE TRIGGER entity_registrations_attach_gst_login
  AFTER INSERT OR UPDATE OF registration_number, registration_type ON hsdg.entity_registrations
  FOR EACH ROW WHEN (NEW.registration_type = 'gstin' AND NEW.registration_number ~ '^[0-9]{2}')
  EXECUTE FUNCTION hsdg.attach_pending_gst_login();

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

DROP TRIGGER IF EXISTS entity_registrations_attach_gst_login ON hsdg.entity_registrations;
DROP FUNCTION IF EXISTS hsdg.attach_pending_gst_login();
DROP FUNCTION IF EXISTS hsdg.set_initial_gst_scheme(uuid, text);
DROP FUNCTION IF EXISTS hsdg.seed_gst_scheme(uuid, uuid, text, text);
DROP POLICY IF EXISTS registration_compliance_profiles_owner_insert ON hsdg.registration_compliance_profiles;
DROP POLICY IF EXISTS registration_compliance_profiles_owner_read ON hsdg.registration_compliance_profiles;
DROP FUNCTION IF EXISTS hsdg.reveal_client_credential(uuid);
DROP TABLE IF EXISTS hsdg.credential_access_log;
DROP TABLE IF EXISTS hsdg.client_credentials;
DROP FUNCTION IF EXISTS hsdg.ctx_can_manage_credentials(uuid);
