-- Up Migration
-- ─────────────────────────────────────────────────────────────────────────
-- Practice Services PS-305 · the DSC register and custody.
--
-- "Offices hold clients' and directors' DSC tokens. Expiry and custody are
-- tracked on paper, and PINs are shared insecurely."
--   · hsdg.dsc_tokens: one row per token the firm knows of — the holder (and
--     their PAN / DIN), the client it is for, class, usage, issuer, validity,
--     serial — and where it is now: in the office (and where in it) or out,
--     with whom, since when and back by when. A token is never deleted: it is
--     returned to its holder, or lost, with the reason.
--   · hsdg.dsc_movements: the custody log, append-only (out, in, returned to
--     the holder).
--   · The PIN is an ADR-0035 credential: client_credentials gets the portal
--     'dsc' and a dsc_token_id (one PIN per token). It is revealed only through
--     hsdg.reveal_client_credential, with its checks and log; the Client
--     Master export with passwords never carries a PIN.
--   · Visibility: firm-wide roles, the token's office, or anyone who can see
--     its client. The API asks register.manage to add or change a token, and
--     engagement.read or register.manage to check one out or in.
--   · dsc_expiring (30 and 7 days before valid_to) and dsc_overdue_return
--     (out past expected_back_at) are the scan's.
--   · A client merged into another takes its tokens (and their PINs) with it.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.dsc_tokens (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id              uuid NOT NULL REFERENCES hsdg.offices(id),
  holder_name            text NOT NULL CHECK (length(btrim(holder_name)) BETWEEN 1 AND 120),
  holder_pan             text CHECK (holder_pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  din                    text CHECK (din ~ '^[0-9]{8}$'),
  entity_id              uuid REFERENCES hsdg.entities(id) ON DELETE SET NULL,
  class                  text NOT NULL DEFAULT 'class3' CHECK (class IN ('class3', 'dgft', 'other')),
  usage                  text NOT NULL DEFAULT 'sign' CHECK (usage IN ('sign', 'encrypt', 'both')),
  issuer                 text CHECK (length(issuer) <= 80),
  valid_from             date,
  valid_to               date NOT NULL,
  token_serial           text CHECK (length(token_serial) <= 60),
  in_office              boolean NOT NULL DEFAULT true,
  location               text CHECK (length(location) <= 120),
  out_with_employee_id   uuid REFERENCES hsdg.employees(id),
  out_with_name          text CHECK (length(out_with_name) <= 120),
  out_since              timestamptz,
  expected_back_at       timestamptz,
  status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'expired', 'returned_to_holder', 'lost')),
  status_reason          text CHECK (length(status_reason) <= 500),
  notes                  text CHECK (length(notes) <= 500),
  created_by_employee_id uuid REFERENCES hsdg.employees(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  version                integer NOT NULL DEFAULT 1,
  CONSTRAINT dsc_tokens_validity CHECK (valid_from IS NULL OR valid_from <= valid_to),
  -- Out means out since a time; in the office means no one has it.
  CONSTRAINT dsc_tokens_custody CHECK (
    (in_office AND out_with_employee_id IS NULL AND out_with_name IS NULL
       AND out_since IS NULL AND expected_back_at IS NULL)
    OR (NOT in_office AND out_since IS NOT NULL)),
  -- Returned or lost needs its reason; neither is in the office.
  CONSTRAINT dsc_tokens_gone CHECK (
    status NOT IN ('returned_to_holder', 'lost')
    OR (status_reason IS NOT NULL AND NOT in_office))
);
CREATE INDEX dsc_tokens_office_idx ON hsdg.dsc_tokens (office_id);
CREATE INDEX dsc_tokens_entity_idx ON hsdg.dsc_tokens (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX dsc_tokens_din_idx ON hsdg.dsc_tokens (din) WHERE din IS NOT NULL;
CREATE INDEX dsc_tokens_valid_to_idx ON hsdg.dsc_tokens (valid_to) WHERE status = 'active';
CREATE TRIGGER dsc_tokens_set_updated_at BEFORE UPDATE ON hsdg.dsc_tokens
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.dsc_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id          uuid NOT NULL REFERENCES hsdg.dsc_tokens(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('out', 'in', 'returned_to_holder')),
  at                timestamptz NOT NULL DEFAULT now(),
  by_employee_id    uuid REFERENCES hsdg.employees(id),
  with_employee_id  uuid REFERENCES hsdg.employees(id),
  with_name         text CHECK (length(with_name) <= 120),
  purpose           text CHECK (length(purpose) <= 200),
  expected_back_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dsc_movements_token_idx ON hsdg.dsc_movements (token_id, at DESC);

GRANT SELECT, INSERT, UPDATE ON hsdg.dsc_tokens TO hsdg_app;
-- The custody log is never changed.
GRANT SELECT, INSERT ON hsdg.dsc_movements TO hsdg_app;

ALTER TABLE hsdg.dsc_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.dsc_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE hsdg.dsc_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.dsc_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY dsc_tokens_owner ON hsdg.dsc_tokens
  TO hsdg_migrator USING (true) WITH CHECK (true);
-- Firm-wide, the token's office, or the token's client.
CREATE POLICY dsc_tokens_select ON hsdg.dsc_tokens FOR SELECT TO hsdg_app
  USING (hsdg.ctx_is_business_firmwide()
         OR office_id = hsdg.ctx_office_id()
         OR (entity_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = dsc_tokens.entity_id)));
CREATE POLICY dsc_tokens_insert ON hsdg.dsc_tokens FOR INSERT TO hsdg_app
  WITH CHECK (hsdg.ctx_is_business_firmwide()
              OR office_id = hsdg.ctx_office_id()
              OR (entity_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = dsc_tokens.entity_id)));
CREATE POLICY dsc_tokens_update ON hsdg.dsc_tokens FOR UPDATE TO hsdg_app
  USING (hsdg.ctx_is_business_firmwide()
         OR office_id = hsdg.ctx_office_id()
         OR (entity_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = dsc_tokens.entity_id)))
  WITH CHECK (hsdg.ctx_is_business_firmwide()
              OR office_id = hsdg.ctx_office_id()
              OR (entity_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM hsdg.entities e WHERE e.id = dsc_tokens.entity_id)));

CREATE POLICY dsc_movements_owner ON hsdg.dsc_movements
  TO hsdg_migrator USING (true) WITH CHECK (true);
CREATE POLICY dsc_movements_select ON hsdg.dsc_movements FOR SELECT TO hsdg_app
  USING (EXISTS (SELECT 1 FROM hsdg.dsc_tokens t WHERE t.id = dsc_movements.token_id));
CREATE POLICY dsc_movements_insert ON hsdg.dsc_movements FOR INSERT TO hsdg_app
  WITH CHECK (EXISTS (SELECT 1 FROM hsdg.dsc_tokens t WHERE t.id = dsc_movements.token_id));

-- ── A merged client's tokens follow it ──────────────────────────────────
CREATE FUNCTION hsdg.dsc_tokens_follow_merge() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  UPDATE hsdg.dsc_tokens SET entity_id = NEW.merged_into_id WHERE entity_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER entities_dsc_tokens_follow_merge
  AFTER UPDATE OF merged_into_id ON hsdg.entities
  FOR EACH ROW WHEN (NEW.merged_into_id IS NOT NULL AND OLD.merged_into_id IS NULL)
  EXECUTE FUNCTION hsdg.dsc_tokens_follow_merge();

-- ── A token back in the office, renewed or released clears its nudges ──
CREATE FUNCTION hsdg.dsc_tokens_resolve_nudges() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = hsdg, pg_temp AS $$
BEGIN
  IF NEW.in_office AND NOT OLD.in_office OR NEW.status <> 'active' THEN
    PERFORM hsdg.resolve_notifications('dsc_token', ARRAY[NEW.id], ARRAY['dsc_overdue_return']);
  END IF;
  IF NEW.valid_to IS DISTINCT FROM OLD.valid_to OR NEW.status <> 'active' THEN
    PERFORM hsdg.resolve_notifications('dsc_token', ARRAY[NEW.id], ARRAY['dsc_expiring']);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER dsc_tokens_resolve_nudges
  AFTER UPDATE ON hsdg.dsc_tokens
  FOR EACH ROW EXECUTE FUNCTION hsdg.dsc_tokens_resolve_nudges();

-- ── The token PIN: an ADR-0035 credential, one per token ────────────────
ALTER TABLE hsdg.client_credentials
  ADD COLUMN dsc_token_id uuid REFERENCES hsdg.dsc_tokens(id) ON DELETE CASCADE;
GRANT SELECT (dsc_token_id) ON hsdg.client_credentials TO hsdg_app;
ALTER TABLE hsdg.client_credentials DROP CONSTRAINT client_credentials_portal_check;
ALTER TABLE hsdg.client_credentials ADD CONSTRAINT client_credentials_portal_check
  CHECK (portal IN ('gst', 'income_tax', 'traces', 'mca', 'eway_bill', 'einvoice', 'dsc'));
ALTER TABLE hsdg.client_credentials ADD CONSTRAINT client_credentials_dsc
  CHECK ((portal = 'dsc') = (dsc_token_id IS NOT NULL) AND (portal <> 'dsc' OR account = 'main'));
DROP INDEX hsdg.client_credentials_one_per_target;
CREATE UNIQUE INDEX client_credentials_one_per_target ON hsdg.client_credentials
  (entity_id, portal, account, COALESCE(dsc_token_id::text, registration_id::text, state_code, ''));
CREATE INDEX client_credentials_dsc_token_idx ON hsdg.client_credentials (dsc_token_id)
  WHERE dsc_token_id IS NOT NULL;

-- merge_entities keeps the newer of two logins for the same portal and
-- registration; two PINs are for two tokens, so a merge keeps both.
CREATE FUNCTION hsdg.client_credentials_keep_dsc_on_merge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.portal = 'dsc' AND hsdg.merging_clients() THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER client_credentials_keep_dsc_on_merge
  BEFORE DELETE ON hsdg.client_credentials
  FOR EACH ROW EXECUTE FUNCTION hsdg.client_credentials_keep_dsc_on_merge();

-- The Client Master export with passwords never carries a DSC PIN.
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
         AND c.portal <> 'dsc'
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

-- ── Notification types dsc_expiring, dsc_overdue_return ─────────────────
DO $$
DECLARE
  types text[] := hsdg.notification_types_now();
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  types := array_append(array_remove(types, 'dsc_expiring'), 'dsc_expiring');
  types := array_append(array_remove(types, 'dsc_overdue_return'), 'dsc_overdue_return');
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

-- Down Migration

DELETE FROM hsdg.notifications WHERE type IN ('dsc_expiring', 'dsc_overdue_return');
DO $$
DECLARE
  types text[] := array_remove(array_remove(hsdg.notification_types_now(), 'dsc_expiring'),
                               'dsc_overdue_return');
BEGIN
  IF coalesce(array_length(types, 1), 0) < 10 THEN
    RAISE EXCEPTION 'could not read the notification type list: %', types;
  END IF;
  ALTER TABLE hsdg.notifications DROP CONSTRAINT notifications_type_check;
  EXECUTE format('ALTER TABLE hsdg.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', types);
END;
$$;

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
  IF (SELECT count(DISTINCT l.revealed_at) FROM hsdg.credential_access_log l
       WHERE l.user_id = hsdg.ctx_user_id() AND l.via = 'export'
         AND l.revealed_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'credential_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
    WITH picked AS (
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

DROP TRIGGER IF EXISTS client_credentials_keep_dsc_on_merge ON hsdg.client_credentials;
DROP FUNCTION IF EXISTS hsdg.client_credentials_keep_dsc_on_merge();
ALTER TABLE hsdg.client_credentials NO FORCE ROW LEVEL SECURITY;
DELETE FROM hsdg.client_credentials WHERE portal = 'dsc';
ALTER TABLE hsdg.client_credentials FORCE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS hsdg.client_credentials_dsc_token_idx;
DROP INDEX hsdg.client_credentials_one_per_target;
CREATE UNIQUE INDEX client_credentials_one_per_target ON hsdg.client_credentials
  (entity_id, portal, account, COALESCE(registration_id::text, state_code, ''));
ALTER TABLE hsdg.client_credentials DROP CONSTRAINT client_credentials_dsc;
ALTER TABLE hsdg.client_credentials DROP CONSTRAINT client_credentials_portal_check;
ALTER TABLE hsdg.client_credentials ADD CONSTRAINT client_credentials_portal_check
  CHECK (portal IN ('gst', 'income_tax', 'traces', 'mca', 'eway_bill', 'einvoice'));
ALTER TABLE hsdg.client_credentials DROP COLUMN dsc_token_id;

DROP TRIGGER IF EXISTS dsc_tokens_resolve_nudges ON hsdg.dsc_tokens;
DROP FUNCTION IF EXISTS hsdg.dsc_tokens_resolve_nudges();
DROP TRIGGER IF EXISTS entities_dsc_tokens_follow_merge ON hsdg.entities;
DROP FUNCTION IF EXISTS hsdg.dsc_tokens_follow_merge();
DROP TABLE IF EXISTS hsdg.dsc_movements;
DROP TABLE IF EXISTS hsdg.dsc_tokens;
