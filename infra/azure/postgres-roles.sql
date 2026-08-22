-- ─────────────────────────────────────────────────────────────────────────
-- HSDG PostgreSQL role bootstrap for Azure Database for PostgreSQL (Flexible
-- Server). Establishes the same two-role posture as local dev, but the database
-- itself is created by Bicep, and passwords come from psql variables (never
-- committed).
--
-- Run ONCE per server, as the admin login (hsdgadmin), against the hsdg db:
--
--   psql "host=<server>.postgres.database.azure.com port=5432 dbname=hsdg \
--         user=hsdgadmin sslmode=require" \
--     -v app_pw="$PG_APP_PASSWORD" -v migrator_pw="$PG_MIGRATOR_PASSWORD" \
--     -f infra/azure/postgres-roles.sql
--
--   hsdg_migrator — owns the schema, runs migrations. NOT superuser.
--   hsdg_app      — the ONLY runtime login. Least privilege, NO BYPASSRLS.
-- ─────────────────────────────────────────────────────────────────────────

-- Create the roles if absent (idempotent). Passwords are set below with the
-- psql variables so they never appear inline in this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hsdg_migrator') THEN
    CREATE ROLE hsdg_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hsdg_app') THEN
    CREATE ROLE hsdg_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE hsdg_migrator WITH PASSWORD :'migrator_pw';
ALTER ROLE hsdg_app WITH PASSWORD :'app_pw';

GRANT CONNECT ON DATABASE hsdg TO hsdg_migrator;
GRANT CONNECT ON DATABASE hsdg TO hsdg_app;

ALTER ROLE hsdg_migrator IN DATABASE hsdg SET search_path = hsdg, public;
ALTER ROLE hsdg_app IN DATABASE hsdg SET search_path = hsdg, public;

-- The migrator must own the database so migrations own the schema they create.
-- The admin must be a member of hsdg_migrator to reassign ownership to it.
GRANT hsdg_migrator TO CURRENT_USER;
ALTER DATABASE hsdg OWNER TO hsdg_migrator;

-- Keep the public schema empty and unprivileged; app objects live in `hsdg`.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
