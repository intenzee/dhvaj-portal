-- ─────────────────────────────────────────────────────────────────────────
-- HSDG PostgreSQL role bootstrap (runs once, as the postgres superuser, on
-- first container start of an empty data directory).
--
-- Establishes the two-role security posture the application depends on:
--
--   hsdg_migrator  — owns the application schema and runs migrations.
--                    Creates/alters tables and RLS policies. NOT a superuser.
--
--   hsdg_app       — the ONLY role the API logs in as at runtime.
--                    LEAST PRIVILEGE: no superuser, no createrole, no createdb,
--                    and (critically) NO BYPASSRLS, so Row Level Security always
--                    applies. Table privileges are granted per-migration.
--
-- Passwords here are for LOCAL DEVELOPMENT ONLY. Real environments provision
-- these roles with secrets from Azure Key Vault.
-- ─────────────────────────────────────────────────────────────────────────

-- Migrator: schema owner. Explicitly NOBYPASSRLS / NOSUPERUSER.
CREATE ROLE hsdg_migrator WITH
  LOGIN
  PASSWORD 'hsdg_migrator_dev_pw'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

-- Application runtime role: least privilege.
CREATE ROLE hsdg_app WITH
  LOGIN
  PASSWORD 'hsdg_app_dev_pw'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

-- The application database, owned by the migrator (not postgres/superuser).
CREATE DATABASE hsdg OWNER hsdg_migrator;

-- Lock down the database: no ambient privileges for arbitrary roles.
REVOKE ALL ON DATABASE hsdg FROM PUBLIC;
GRANT CONNECT ON DATABASE hsdg TO hsdg_migrator;
GRANT CONNECT ON DATABASE hsdg TO hsdg_app;

-- Role-level configuration is a provisioning concern (requires elevated
-- privileges), so it lives here in the superuser-run init script rather than in
-- migrations. Migrations run as the least-privilege migrator and only manage
-- schema objects it owns.
--
-- Resolve unqualified object names against the app schema for both roles. The
-- `hsdg` schema itself is created by the first migration; naming it here before
-- it exists is fine (search_path is just a string).
ALTER ROLE hsdg_migrator IN DATABASE hsdg SET search_path = hsdg, public;
ALTER ROLE hsdg_app IN DATABASE hsdg SET search_path = hsdg, public;

-- Keep the public schema empty and unprivileged; app objects live in `hsdg`.
\connect hsdg
REVOKE ALL ON SCHEMA public FROM PUBLIC;
