import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Global e2e setup — reset to a pristine schema before the whole suite runs.
 *
 * The suite seeds identity fixtures per spec but never truncates the
 * transactional tables, so a run leaves engagements/invoices/obligations behind.
 * CI is immune (a fresh Postgres container per run), but a local run against the
 * persisted docker volume accumulates rows across runs, and count/pagination-
 * sensitive assertions (e.g. the firm-wide calendar's `limit=100`) eventually
 * fail. Dropping the app schema + migration ledger as the superuser and
 * re-applying every migration leaves exactly the state a fresh migrate produces,
 * so `npm run test:e2e` is repeatable regardless of prior runs.
 */
export default async function globalSetup(): Promise<void> {
  const superuserUrl =
    process.env.DATABASE_SUPERUSER_URL ?? 'postgres://postgres:postgres@localhost:5433/hsdg';
  const migrateUrl =
    process.env.DATABASE_MIGRATE_URL ??
    'postgres://hsdg_migrator:hsdg_migrator_dev_pw@localhost:5433/hsdg';

  // The reset DROPs schema hsdg. Never point it at the persisted local dev DB
  // (docker volume on :5433, database `hsdg`) by accident — use a scratch DB for
  // all three URLs, or opt in explicitly. CI runs a throwaway Postgres on :5432.
  const isLocalDevDb = (url: string): boolean => {
    const u = new URL(url);
    return u.port === '5433' && u.pathname.replace(/^\//, '') === 'hsdg';
  };
  if (
    (isLocalDevDb(superuserUrl) || isLocalDevDb(migrateUrl)) &&
    process.env.E2E_ALLOW_DEV_DB_RESET !== '1'
  ) {
    throw new Error(
      'e2e would DROP the local dev database (localhost:5433/hsdg). Point DATABASE_URL, ' +
        'DATABASE_SUPERUSER_URL and DATABASE_MIGRATE_URL at a scratch database, or set ' +
        'E2E_ALLOW_DEV_DB_RESET=1 to reset the dev database on purpose.',
    );
  }

  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS hsdg CASCADE');
    await client.query('DROP TABLE IF EXISTS public.pgmigrations CASCADE');
  } finally {
    await client.end();
  }

  // Reuse the canonical migration command so the reset can never drift from it.
  execSync('npm run migrate:up', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_MIGRATE_URL: migrateUrl },
    stdio: 'ignore',
  });
}
