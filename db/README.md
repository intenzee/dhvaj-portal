# Database migrations

SQL migrations for the HSDG Portal, managed by
[`node-pg-migrate`](https://github.com/salsita/node-pg-migrate).

## Principles

- **PostgreSQL is the system of record.** Schema changes happen **only** through
  migrations — never by hand on any environment.
- Migrations run as the schema-owning **`hsdg_migrator`** role (never the app
  role, never a superuser at runtime).
- Role provisioning, per-database `search_path`, and locking down the `public`
  schema are handled once by the superuser-run init script
  (`infra/docker/postgres/init/00-roles.sql`), because the least-privilege
  migrator cannot alter other roles.
- Each migration is a single `.sql` file with `-- Up Migration` and
  `-- Down Migration` sections.
- From Phase 1, every table that holds protected data ships **in the same
  migration** with its RLS policies (`ENABLE` + `FORCE ROW LEVEL SECURITY`) and
  its grants to `hsdg_app`.

## Commands

Run from the repo root (they target `apps/api` and read `DATABASE_MIGRATE_URL`):

```bash
npm run db:migrate                 # apply all pending migrations
npm run db:migrate:create -- name  # scaffold a new timestamped migration
```

Down/rollback (use deliberately):

```bash
npm run migrate:down --workspace @hsdg/api
```

## Connection

Migrations use `DATABASE_MIGRATE_URL` (the migrator role). The running API uses
`DATABASE_URL` (the least-privilege `hsdg_app` role). These are intentionally
different roles — see `apps/api/env.example`.

## Current migrations

| File | Purpose |
| --- | --- |
| `1755500000000_bootstrap.sql` | Enable `pgcrypto`; create the `hsdg` app schema; grant `USAGE` and default table/sequence privileges to `hsdg_app`. No domain tables. |
