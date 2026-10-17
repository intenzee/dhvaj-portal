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
//   3. SEED      — first boot only (no office yet), with RLS temporarily
//      lifted, by SEED_MODE: 'demo' loads db/seeds/dev_identity.sql +
//      demo_data.sql; 'production' creates the firm's first office and its
//      owner from BOOTSTRAP_* (everyone else is added in Admin); 'none' loads
//      nothing. Under Entra sign-in it defaults to 'production' and refuses
//      'demo' — the demo personas must never reach a real firm's database.
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
const ENTRA = process.env.AUTH_PROVIDER === 'entra';
const SEED_MODE = process.env.SEED_MODE || (ENTRA ? 'production' : 'demo');
if (!['demo', 'production', 'none'].includes(SEED_MODE)) {
  console.error(`[deploy] SEED_MODE must be demo, production or none (got "${SEED_MODE}").`);
  process.exit(1);
}
if (SEED_MODE === 'demo' && ENTRA) {
  console.error('[deploy] Refusing SEED_MODE=demo with AUTH_PROVIDER=entra: no demo data in a real firm.');
  process.exit(1);
}

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
      // A freshly created role is already the least-privilege posture we want:
      // NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE. We must NOT restate
      // those attributes — on a managed Postgres (Neon) the owner role is not a
      // superuser, and changing the SUPERUSER/BYPASSRLS attributes requires one.
      // So only (re)assert LOGIN + the password (a utility statement, no bind
      // params — the password is inlined as an escaped literal; safe here since
      // the passwords are alphanumeric).
      const lit = `'${pw.replace(/'/g, "''")}'`;
      await db.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${lit}`);
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

// ── 3. Seed, first boot only (as hsdg_migrator) ──────────────────────────
async function seed() {
  await withClient(MIGRATOR_URL, async (db) => {
    // hsdg.offices is FORCE RLS, readable once a role is in context: without
    // one the count is always 0 and every boot would seed again. The
    // schedulers' 'system' context, for this transaction only.
    await db.query('BEGIN');
    await db.query(`SELECT set_config('hsdg.role', 'system', true)`);
    const seeded = await db.query(`SELECT count(*)::int AS n FROM hsdg.offices`);
    await db.query('COMMIT');
    if (seeded.rows[0].n > 0) {
      console.log('[deploy] Seed data already present — skipping.');
      return;
    }
    if (SEED_MODE === 'none') {
      console.log('[deploy] SEED_MODE=none — leaving the database empty.');
      return;
    }
    // Checked before anything is written, so a missing value leaves no half-made firm.
    const owner = SEED_MODE === 'production' ? bootstrapValues() : null;
    console.log(`[deploy] Seeding (${SEED_MODE})…`);
    await withRlsLifted(db, async () => {
      if (owner) {
        await seedProduction(db, owner);
        return;
      }
      // All or nothing: a half-loaded demo has an office, so no later boot retries.
      await db.query('BEGIN');
      try {
        for (const f of ['dev_identity.sql', 'demo_data.sql']) {
          console.log(`[deploy]   ⋯ ${f}`);
          await db.query(readFileSync(path.join(SEEDS_DIR, f), 'utf8'));
        }
        await db.query('COMMIT');
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    });
    console.log('[deploy] Seed complete.');
  });
}

/** Capture each table's RLS state, disable RLS, run `fn`, then restore exactly. */
async function withRlsLifted(db, fn) {
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
    await fn();
  } finally {
    for (const t of tables) {
      if (t.enabled) await db.query(`ALTER TABLE hsdg."${t.relname}" ENABLE ROW LEVEL SECURITY`);
      if (t.forced) await db.query(`ALTER TABLE hsdg."${t.relname}" FORCE ROW LEVEL SECURITY`);
    }
  }
}

/**
 * The first office and its owner for SEED_MODE=production. The email must be
 * the owner's Microsoft sign-in name (UPN): Entra sign-in matches on it.
 */
function bootstrapValues() {
  const env = (name) => (process.env[name] ?? '').trim();
  const v = {
    email: env('BOOTSTRAP_OWNER_EMAIL').toLowerCase(),
    name: env('BOOTSTRAP_OWNER_NAME'),
    officeCode: env('BOOTSTRAP_OFFICE_CODE').toUpperCase(),
    officeName: env('BOOTSTRAP_OFFICE_NAME'),
    employeeCode: (env('BOOTSTRAP_OWNER_EMPLOYEE_CODE') || 'EMP001').toUpperCase(),
    joined: env('BOOTSTRAP_OWNER_JOINED') || new Date().toISOString().slice(0, 10),
    membershipNo: env('BOOTSTRAP_OWNER_MEMBERSHIP_NO') || null,
  };
  const code = /^[A-Z0-9_-]{2,20}$/;
  const problems = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) {
    problems.push("BOOTSTRAP_OWNER_EMAIL (the owner's Microsoft sign-in)");
  }
  if (!v.name) problems.push('BOOTSTRAP_OWNER_NAME');
  if (!code.test(v.officeCode)) problems.push('BOOTSTRAP_OFFICE_CODE (2–20 of A–Z, 0–9, _ or -)');
  if (!v.officeName) problems.push('BOOTSTRAP_OFFICE_NAME');
  if (!code.test(v.employeeCode)) problems.push('BOOTSTRAP_OWNER_EMPLOYEE_CODE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.joined)) problems.push('BOOTSTRAP_OWNER_JOINED (YYYY-MM-DD)');
  if (problems.length) throw new Error(`SEED_MODE=production needs: ${problems.join('; ')}.`);
  return v;
}

/**
 * One office and the owner: managing partner (firm-wide) + admin (platform),
 * with an employee record of partner grade so they can lead engagements. One
 * transaction; values are bound, never interpolated.
 */
async function seedProduction(db, o) {
  await db.query('BEGIN');
  try {
    const office = await db.query(
      `INSERT INTO hsdg.offices (code, name) VALUES ($1, $2) RETURNING id`,
      [o.officeCode, o.officeName],
    );
    const officeId = office.rows[0].id;
    const user = await db.query(
      `INSERT INTO hsdg.users (email, display_name, primary_office_id, mfa_required)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [o.email, o.name, officeId],
    );
    const userId = user.rows[0].id;
    const roles = await db.query(
      `INSERT INTO hsdg.user_roles (user_id, role_id)
       SELECT $1, r.id FROM hsdg.roles r WHERE r.slug IN ('managing_partner', 'admin')`,
      [userId],
    );
    if (roles.rowCount !== 2) {
      throw new Error('The managing_partner and admin roles are missing — are the migrations applied?');
    }
    const emp = await db.query(
      `INSERT INTO hsdg.employees
         (employee_code, full_name, user_id, grade_id, primary_office_id, employment_status, date_of_joining)
       SELECT $1, $2, $3, g.id, $4, 'active', $5::date FROM hsdg.grades g WHERE g.slug = 'partner'
       RETURNING id`,
      [o.employeeCode, o.name, userId, officeId, o.joined],
    );
    if (!emp.rows[0]) throw new Error('The partner grade is missing — are the migrations applied?');
    await db.query(
      `INSERT INTO hsdg.partner_profiles (employee_id, membership_no, partner_since)
       VALUES ($1, $2, $3::date)`,
      [emp.rows[0].id, o.membershipNo, o.joined],
    );
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
  console.log(`[deploy]   ⋯ office ${o.officeCode} and its owner (${o.email}) created`);
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
