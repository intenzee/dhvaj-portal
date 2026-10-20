-- ─────────────────────────────────────────────────────────────────────────
-- Portal passwords · staff may sign in with email + password as well as
-- with Microsoft.
--
-- user_passwords — one row per user who has a portal password. An admin sets
--                  a temporary one (must_change = true); the person picks
--                  their own at first sign-in. password_hash is a salted
--                  scrypt hash ("scrypt$N$r$p$salt$hash"); the password itself
--                  is never stored. version goes up on every set/change, and a
--                  session token carries the version it was issued under, so a
--                  reset or change ends every older session. failed_attempts /
--                  locked_until lock the password for a while after repeated
--                  wrong tries.
--
-- Only the sign-in path (the reserved 'system' context) reads or writes the
-- table: no business context — not even an admin — can select a hash.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

CREATE TABLE hsdg.user_passwords (
  user_id          uuid PRIMARY KEY REFERENCES hsdg.users (id) ON DELETE CASCADE,
  password_hash    text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  must_change      boolean NOT NULL DEFAULT true,
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  failed_attempts  integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until     timestamptz,
  set_by_user_id   uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  changed_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hsdg.user_passwords ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.user_passwords FORCE  ROW LEVEL SECURITY;
CREATE POLICY user_passwords_system ON hsdg.user_passwords
  TO hsdg_app
  USING (hsdg.ctx_role() = 'system') WITH CHECK (hsdg.ctx_role() = 'system');
CREATE POLICY user_passwords_owner ON hsdg.user_passwords
  TO hsdg_migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON hsdg.user_passwords TO hsdg_app;

-- Down Migration

DROP TABLE IF EXISTS hsdg.user_passwords;
