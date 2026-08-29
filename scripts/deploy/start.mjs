// ─────────────────────────────────────────────────────────────────────────
// HSDG API — deploy entrypoint for a managed Postgres (e.g. Neon) + Render.
//
// A managed Postgres gives you ONE owner role and no superuser, but the app is
// built around a two-role posture (hsdg_migrator owns the schema; hsdg_app is
// the least-privilege runtime role). This script bridges that on boot:
//
//   1. PROVISION — as the Neon owner (DATABASE_ADMIN_URL), create the two roles
//      and the privileges/search_path/pgcrypto the app expects (idempotent).
//   2. MIGRATE   — as hsdg_migrator, apply every db/migrations/*.sql not yet
//      recorded in public.pgmigrations (self-contained runner; each Up in a txn).
//   3. SEED      — first boot only: with RLS temporarily lifted (as the owner),
//      load db/seeds/dev_identity.sql + demo_data.sql, then restore RLS.
//   4. LAUNCH    — start the API as hsdg_app (DATABASE_URL).
//
// Everything is idempotent, so it is safe to run on every container start.
// Only DATABASE_ADMIN_URL + the two role passwords need to be configured.
// ─────────────────────────────────────────────────────────────────────────
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');
const SEEDS_DIR = path.join(ROOT, 'db', 'seeds');

const ADMIN_URL = requireEnv('DATABASE_ADMIN_URL');
const MIGRATOR_PW = requireEnv('DB_MIGRATOR_PASSWORD');
const APP_PW = requireEnv('DB_APP_PASSWORD');
// Managed PG (Neon) uses a shared CA over TLS; set DEPLOY_DB_SSL=false only for
// a local, non-TLS Postgres (e.g. running this runner against docker locally).
const SSL = process.env.DEPLOY_DB_SSL === 'false' ? false : { rejectUnauthorized: false };
// When set, run provision+migrate+seed and exit (no API launch) — handy as a
// one-off pre-deploy step or for testing.
const SETUP_ONLY = process.env.SETUP_ONLY === 'true';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[deploy] Missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

/** Swap the userinfo of a postgres URL, keeping host/db/params. */
function urlAs(base, user, pw) {
  const u = new URL(base);
  u.username = user;
  u.password = pw;
  return u.toString();
}

const DB_NAME = decodeURIComponent(new URL(ADMIN_URL).pathname.replace(/^\//, '')) || 'postgres';
const MIGRATOR_URL = urlAs(ADMIN_URL, 'hsdg_migrator', MIGRATOR_PW);
const APP_URL = urlAs(ADMIN_URL, 'hsdg_app', APP_PW);

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString, ssl: SSL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ── 1. Provision the two roles (as the managed-DB owner) ──────────────────
async function provision() {
  console.log('[deploy] Provisioning roles…');
  await withClient(ADMIN_URL, async (db) => {
    const ensureRole = async (role, pw) => {
      await db.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
             CREATE ROLE ${role} LOGIN;
           END IF;
         END $$;`,
      );
      // NOBYPASSRLS is the critical property for the runtime role. ALTER ROLE
      // is a utility statement (no bind params), so the password is inlined as
      // an escaped literal — safe here because the passwords are alphanumeric.
      const lit = `'${pw.replace(/'/g, "''")}'`;
      await db.query(
        `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${lit}`,
      );
      await db.query(`GRANT CONNECT ON DATABASE "${DB_NAME}" TO ${role}`);
      await db.query(`ALTER ROLE ${role} IN DATABASE "${DB_NAME}" SET search_path = hsdg, public`);
    };
    await ensureRole('hsdg_migrator', MIGRATOR_PW);
    await ensureRole('hsdg_app', APP_PW);
    // The migrator owns and creates the schema; it needs CREATE on the database.
    await db.query(`GRANT CREATE ON DATABASE "${DB_NAME}" TO hsdg_migrator`);
    // The migration ledger (public.pgmigrations) lives in the public schema,
    // which PG15+ locks down — grant the migrator create rights there.
    await db.query(`GRANT USAGE, CREATE ON SCHEMA public TO hsdg_migrator`);
    // pgcrypto (gen_random_uuid) — a trusted extension; create it up-front.
    await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await db.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    // Let the owner administer migrator-owned objects if ever needed.
    await db.query(`GRANT hsdg_migrator TO CURRENT_USER`).catch(() => {});
  });
  console.log('[deploy] Roles ready.');
}

// ── 2. Self-contained SQL migration runner (as hsdg_migrator) ─────────────
async function migrate() {
  console.log('[deploy] Applying migrations…');
  await withClient(MIGRATOR_URL, async (db) => {
    await db.query(
      `CREATE TABLE IF NOT EXISTS public.pgmigrations (
         id serial PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL)`,
    );
    const done = new Set(
      (await db.query(`SELECT name FROM public.pgmigrations`)).rows.map((r) => r.name),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    let applied = 0;
    for (const file of files) {
      const name = file.replace(/\.sql$/, '');
      if (done.has(name)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // node-pg-migrate `-j sql` runs the section between the Up/Down markers.
      const up = sql.split(/^--\s*Down Migration/im)[0].replace(/^--\s*Up Migration/im, '');
      console.log(`[deploy]   ↑ ${name}`);
      await db.query('BEGIN');
      try {
        await db.query(up);
        await db.query(`INSERT INTO public.pgmigrations (name, run_on) VALUES ($1, now())`, [name]);
        await db.query('COMMIT');
        applied++;
      } catch (err) {
        await db.query('ROLLBACK');
        console.error(`[deploy] Migration ${name} failed:`, err.message);
        throw err;
      }
    }
    console.log(`[deploy] Migrations complete (${applied} applied, ${done.size} already present).`);
  });
}

// ── 3. Seed identity + demo data, first boot only (as hsdg_migrator) ──────
async function seed() {
  await withClient(MIGRATOR_URL, async (db) => {
    const seeded = await db.query(`SELECT count(*)::int AS n FROM hsdg.offices`);
    if (seeded.rows[0].n > 0) {
      console.log('[deploy] Seed data already present — skipping.');
      return;
    }
    console.log('[deploy] Seeding identity + demo data…');
    // Capture each table's RLS state, disable RLS, seed, then restore exactly.
    const tables = (
      await db.query(
        `SELECT c.relname,
                c.relrowsecurity AS enabled,
                c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'hsdg' AND c.relkind = 'r'`,
      )
    ).rows;
    for (const t of tables) {
      await db.query(`ALTER TABLE hsdg."${t.relname}" DISABLE ROW LEVEL SECURITY`);
    }
    try {
      for (const f of ['dev_identity.sql', 'demo_data.sql']) {
        console.log(`[deploy]   ⋯ ${f}`);
        await db.query(readFileSync(path.join(SEEDS_DIR, f), 'utf8'));
      }
    } finally {
      for (const t of tables) {
        if (t.enabled) await db.query(`ALTER TABLE hsdg."${t.relname}" ENABLE ROW LEVEL SECURITY`);
        if (t.forced) await db.query(`ALTER TABLE hsdg."${t.relname}" FORCE ROW LEVEL SECURITY`);
      }
    }
    console.log('[deploy] Seed complete.');
  });
}

// ── 4. Launch the API as hsdg_app ─────────────────────────────────────────
async function launch() {
  process.env.DATABASE_URL = APP_URL;
  process.env.DATABASE_SSL = 'true';
  console.log('[deploy] Starting API as hsdg_app…');
  await import(path.join(ROOT, 'apps', 'api', 'dist', 'main.js'));
}

try {
  await provision();
  await migrate();
  await seed();
  if (SETUP_ONLY) {
    console.log('[deploy] SETUP_ONLY — done.');
    process.exit(0);
  }
  await launch();
} catch (err) {
  console.error('[deploy] Startup failed:', err);
  process.exit(1);
}
