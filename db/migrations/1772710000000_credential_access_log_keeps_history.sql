-- ─────────────────────────────────────────────────────────────────────────
-- ADR-0035 · Who saw a client's passwords outlives the client
--
-- A client can now be deleted (DELETE /entities/:id), and its logins go
-- with it. credential_access_log cascaded on credential_id, so the record
-- of who revealed those logins went too. The row keeps entity_id, user_id,
-- role and the time; only the login it pointed at is cleared. The hourly
-- reveal limit counts by user, so it still counts these rows.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

ALTER TABLE hsdg.credential_access_log
  ALTER COLUMN credential_id DROP NOT NULL,
  DROP CONSTRAINT credential_access_log_credential_id_fkey,
  ADD CONSTRAINT credential_access_log_credential_id_fkey
    FOREIGN KEY (credential_id) REFERENCES hsdg.client_credentials (id) ON DELETE SET NULL;

-- Down Migration

DELETE FROM hsdg.credential_access_log WHERE credential_id IS NULL;
ALTER TABLE hsdg.credential_access_log
  DROP CONSTRAINT credential_access_log_credential_id_fkey,
  ADD CONSTRAINT credential_access_log_credential_id_fkey
    FOREIGN KEY (credential_id) REFERENCES hsdg.client_credentials (id) ON DELETE CASCADE,
  ALTER COLUMN credential_id SET NOT NULL;
