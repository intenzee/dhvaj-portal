-- ─────────────────────────────────────────────────────────────────────────
-- 0002 · Identity & Security
--
-- Runs as hsdg_migrator. Creates the identity model (offices, users, roles,
-- permissions, assignments) and the audit foundation, and enforces access with
-- PostgreSQL Row Level Security (FORCE) driven by the transaction-local security
-- context stamped by the API (hsdg.user_id / hsdg.role / hsdg.office_id).
--
-- Fail-closed: on protected tables, a session with NO context sees NO rows.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- Case-insensitive email. citext is a trusted extension (db owner may create).
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Shared helpers ────────────────────────────────────────────────────────

-- Auto-maintain updated_at on UPDATE.
CREATE OR REPLACE FUNCTION hsdg.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Read the transaction-local security context. STABLE + schema-qualified so RLS
-- policies stay readable. Empty/unset settings resolve to NULL (fail-closed).
CREATE OR REPLACE FUNCTION hsdg.ctx_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hsdg.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION hsdg.ctx_role() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hsdg.role', true), '')
$$;

CREATE OR REPLACE FUNCTION hsdg.ctx_office_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hsdg.office_id', true), '')::uuid
$$;

-- Firm-wide authority: the Managing Partner and administrators (and the
-- synthetic 'system' context used only during authentication bootstrap) can see
-- across offices. Everyone else is office-scoped.
CREATE OR REPLACE FUNCTION hsdg.ctx_is_firmwide() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT hsdg.ctx_role() IN ('system', 'managing_partner', 'admin')
$$;

-- ── Offices ───────────────────────────────────────────────────────────────

CREATE TABLE hsdg.offices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER offices_set_updated_at BEFORE UPDATE ON hsdg.offices
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Users ─────────────────────────────────────────────────────────────────

CREATE TABLE hsdg.users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE CHECK (position('@' in email) > 1),
  display_name      text NOT NULL CHECK (length(trim(display_name)) > 0),
  -- External identity (Microsoft Entra ID object id). Null until linked.
  entra_object_id   uuid UNIQUE,
  primary_office_id uuid NOT NULL REFERENCES hsdg.offices (id) ON DELETE RESTRICT,
  is_active         boolean NOT NULL DEFAULT true,
  -- MFA is mandatory for some users (partners/admins). Enforced in the app by
  -- trusting the identity provider's MFA claim.
  mfa_required      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_primary_office_idx ON hsdg.users (primary_office_id);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON hsdg.users
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

-- ── Roles / Permissions / assignments ─────────────────────────────────────

CREATE TABLE hsdg.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON hsdg.roles
  FOR EACH ROW EXECUTE FUNCTION hsdg.set_updated_at();

CREATE TABLE hsdg.permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_.]{2,60}$'),
  description text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hsdg.role_permissions (
  role_id       uuid NOT NULL REFERENCES hsdg.roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES hsdg.permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE hsdg.user_roles (
  user_id     uuid NOT NULL REFERENCES hsdg.users (id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES hsdg.roles (id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON hsdg.user_roles (role_id);

-- ── Audit foundation ──────────────────────────────────────────────────────
-- Append-only. Immutability is enforced two ways: no UPDATE/DELETE grant to the
-- app role (below), and no UPDATE/DELETE RLS policy.

CREATE TABLE hsdg.audit_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid REFERENCES hsdg.users (id) ON DELETE SET NULL,
  actor_role     text,
  action         text NOT NULL CHECK (length(action) > 0),
  object_type    text NOT NULL,
  object_id      text,
  before_state   jsonb,
  after_state    jsonb,
  reason         text,
  correlation_id text
);
CREATE INDEX audit_events_occurred_idx ON hsdg.audit_events (occurred_at DESC);
CREATE INDEX audit_events_object_idx ON hsdg.audit_events (object_type, object_id);
CREATE INDEX audit_events_actor_idx ON hsdg.audit_events (actor_user_id);

-- ── Seed reference data (BEFORE enabling FORCE RLS, so the migrator can write) ─

INSERT INTO hsdg.roles (slug, name, description, is_system) VALUES
  ('managing_partner', 'Managing Partner', 'Firm-wide authority', true),
  ('admin',            'Administrator',    'Firm administration', true),
  ('partner',          'Partner',          'Engagement Partner / partner', true),
  ('manager',          'Manager',          'Engagement manager', true),
  ('senior',           'Senior',           'Senior team member', true),
  ('article',          'Article',          'Article assistant', true);

INSERT INTO hsdg.permissions (slug, description) VALUES
  ('user.read',      'View users within permitted scope'),
  ('user.read.all',  'View users firm-wide'),
  ('user.manage',    'Create and modify users'),
  ('office.read',    'View offices'),
  ('audit.read',     'View the audit trail');

-- managing_partner: everything
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r CROSS JOIN hsdg.permissions p
WHERE r.slug = 'managing_partner';

-- admin: user + office + audit management
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p
  ON p.slug IN ('user.read', 'user.manage', 'office.read', 'audit.read')
WHERE r.slug = 'admin';

-- partner / manager: read users (office-scoped by RLS) + offices
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p
  ON p.slug IN ('user.read', 'office.read')
WHERE r.slug IN ('partner', 'manager');

-- senior / article: offices only
INSERT INTO hsdg.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM hsdg.roles r JOIN hsdg.permissions p
  ON p.slug IN ('office.read')
WHERE r.slug IN ('senior', 'article');

-- ── Privileges: reference tables are managed via migrations, not the app ──
REVOKE INSERT, UPDATE, DELETE ON hsdg.roles            FROM hsdg_app;
REVOKE INSERT, UPDATE, DELETE ON hsdg.permissions      FROM hsdg_app;
REVOKE INSERT, UPDATE, DELETE ON hsdg.role_permissions FROM hsdg_app;
-- Audit is append-only for the app: it may INSERT and SELECT, never mutate.
REVOKE UPDATE, DELETE ON hsdg.audit_events FROM hsdg_app;

-- ── Row Level Security ─────────────────────────────────────────────────────
-- Enable + FORCE (so even a table owner is subject to policy) on every table.

ALTER TABLE hsdg.offices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.offices          FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.users            FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.roles            FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.permissions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.role_permissions FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.user_roles       FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsdg.audit_events     FORCE  ROW LEVEL SECURITY;

-- Reference data: any authenticated context may read; nobody writes via the app.
CREATE POLICY roles_read ON hsdg.roles
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY permissions_read ON hsdg.permissions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY role_permissions_read ON hsdg.role_permissions
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);

-- Offices: any authenticated context may read; only firm-wide may write.
CREATE POLICY offices_read ON hsdg.offices
  FOR SELECT USING (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY offices_write ON hsdg.offices
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- Users: firm-wide sees all; otherwise office-scoped, plus always yourself.
-- With no context, every branch is NULL/false → zero rows (fail-closed).
CREATE POLICY users_select ON hsdg.users
  FOR SELECT USING (
    hsdg.ctx_is_firmwide()
    OR primary_office_id = hsdg.ctx_office_id()
    OR id = hsdg.ctx_user_id()
  );
CREATE POLICY users_insert ON hsdg.users
  FOR INSERT WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY users_update ON hsdg.users
  FOR UPDATE USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());
CREATE POLICY users_delete ON hsdg.users
  FOR DELETE USING (hsdg.ctx_is_firmwide());

-- User-role assignments: visible when the underlying user is visible.
CREATE POLICY user_roles_select ON hsdg.user_roles
  FOR SELECT USING (
    hsdg.ctx_is_firmwide()
    OR user_id = hsdg.ctx_user_id()
    OR EXISTS (
      SELECT 1 FROM hsdg.users u
      WHERE u.id = user_roles.user_id
        AND u.primary_office_id = hsdg.ctx_office_id()
    )
  );
CREATE POLICY user_roles_write ON hsdg.user_roles
  FOR ALL USING (hsdg.ctx_is_firmwide()) WITH CHECK (hsdg.ctx_is_firmwide());

-- Audit: insert within any authenticated context; read only firm-wide; the
-- absence of UPDATE/DELETE policies (and grants) makes it immutable.
CREATE POLICY audit_insert ON hsdg.audit_events
  FOR INSERT WITH CHECK (hsdg.ctx_role() IS NOT NULL);
CREATE POLICY audit_select ON hsdg.audit_events
  FOR SELECT USING (hsdg.ctx_is_firmwide());

-- Down Migration

DROP TABLE IF EXISTS hsdg.audit_events CASCADE;
DROP TABLE IF EXISTS hsdg.user_roles CASCADE;
DROP TABLE IF EXISTS hsdg.role_permissions CASCADE;
DROP TABLE IF EXISTS hsdg.permissions CASCADE;
DROP TABLE IF EXISTS hsdg.roles CASCADE;
DROP TABLE IF EXISTS hsdg.users CASCADE;
DROP TABLE IF EXISTS hsdg.offices CASCADE;

DROP FUNCTION IF EXISTS hsdg.ctx_is_firmwide();
DROP FUNCTION IF EXISTS hsdg.ctx_office_id();
DROP FUNCTION IF EXISTS hsdg.ctx_role();
DROP FUNCTION IF EXISTS hsdg.ctx_user_id();
DROP FUNCTION IF EXISTS hsdg.set_updated_at();
