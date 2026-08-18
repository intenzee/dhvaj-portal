-- ─────────────────────────────────────────────────────────────────────────
-- 0001 · Bootstrap
--
-- Runs as hsdg_migrator (owner of database "hsdg"). Establishes the schema and
-- privilege baseline that every later migration builds on. Deliberately creates
-- NO domain tables — those arrive per phase starting with Phase 1 (identity).
--
-- Role-level setup (role creation, per-database search_path, public-schema
-- lockdown) is handled once by the superuser-run init script
-- (infra/docker/postgres/init/00-roles.sql), because a least-privilege migrator
-- cannot alter other roles. This migration only touches objects it owns.
-- ─────────────────────────────────────────────────────────────────────────

-- Up Migration

-- gen_random_uuid() and crypto helpers. pgcrypto is a "trusted" extension, so
-- the non-superuser owner of the database may create it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Dedicated application schema; all domain objects live here (never in public).
CREATE SCHEMA IF NOT EXISTS hsdg AUTHORIZATION hsdg_migrator;

-- The app role may resolve objects in the app schema, but cannot create them.
GRANT USAGE ON SCHEMA hsdg TO hsdg_app;

-- Default privileges: every table/sequence the migrator creates in schema hsdg
-- grants the app role table-level DML. RLS (added per table from Phase 1) then
-- filters WHICH rows are visible/mutable on top of these grants — the app role
-- has data privileges but no ability to bypass row security.
ALTER DEFAULT PRIVILEGES FOR ROLE hsdg_migrator IN SCHEMA hsdg
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hsdg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hsdg_migrator IN SCHEMA hsdg
  GRANT USAGE, SELECT ON SEQUENCES TO hsdg_app;

-- Down Migration

ALTER DEFAULT PRIVILEGES FOR ROLE hsdg_migrator IN SCHEMA hsdg
  REVOKE USAGE, SELECT ON SEQUENCES FROM hsdg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hsdg_migrator IN SCHEMA hsdg
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM hsdg_app;

REVOKE USAGE ON SCHEMA hsdg FROM hsdg_app;

DROP SCHEMA IF EXISTS hsdg CASCADE;

-- pgcrypto intentionally left installed; other objects may depend on it.
