import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';

/**
 * Row Level Security, proven at the database layer — no NestJS, no HTTP.
 *
 * Connects directly as the least-privilege `hsdg_app` role and sets the security
 * context with `set_config` exactly as the application does. If these pass, the
 * database enforces access on its own; the API and UI are irrelevant to it.
 */
describe('RLS (database-level, independent of the application)', () => {
  let app: Client;
  let userIds: Record<string, string>;
  let officeIds: Record<string, string>;

  type Ctx = { userId?: string; role?: string; officeId?: string };

  /** Run a read under a security context, in a rolled-back transaction. */
  async function underContext<T>(ctx: Ctx, sql: string): Promise<T[]> {
    await app.query('BEGIN');
    try {
      await app.query('SELECT set_config($1,$2,true)', ['hsdg.user_id', ctx.userId ?? '']);
      await app.query('SELECT set_config($1,$2,true)', ['hsdg.role', ctx.role ?? '']);
      await app.query('SELECT set_config($1,$2,true)', ['hsdg.office_id', ctx.officeId ?? '']);
      const { rows } = await app.query(sql);
      return rows as T[];
    } finally {
      await app.query('ROLLBACK');
    }
  }

  beforeAll(async () => {
    ({ userIds, officeIds } = await seedIdentityFixtures());
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
  });

  afterAll(async () => {
    await app?.end();
  });

  it('is fail-closed: with NO context, zero users are visible', async () => {
    const rows = await underContext<{ email: string }>({}, 'SELECT email FROM hsdg.users');
    expect(rows).toHaveLength(0);
  });

  it('scopes a Partner to their own office (North sees North, not South)', async () => {
    const rows = await underContext<{ email: string }>(
      { userId: userIds['partner.a@hsdg.in'], role: 'partner', officeId: officeIds['NORTH'] },
      'SELECT email FROM hsdg.users',
    );
    const emails = rows.map((r) => r.email);
    expect(emails).toContain('partner.a@hsdg.in');
    expect(emails).toContain('manager.x@hsdg.in');
    // Cross-office identities are invisible.
    expect(emails).not.toContain('partner.b@hsdg.in');
    expect(emails).not.toContain('senior.y@hsdg.in');
  });

  it('denies a Partner reading a cross-office user even by direct id', async () => {
    const rows = await underContext(
      { userId: userIds['partner.a@hsdg.in'], role: 'partner', officeId: officeIds['NORTH'] },
      `SELECT id FROM hsdg.users WHERE id = '${userIds['partner.b@hsdg.in']}'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('grants the Managing Partner firm-wide visibility (all users)', async () => {
    const rows = await underContext(
      { userId: userIds['mp@hsdg.in'], role: 'managing_partner', officeId: officeIds['NORTH'] },
      'SELECT id FROM hsdg.users',
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it('makes the audit trail immutable to the app role (UPDATE/DELETE denied)', async () => {
    await expect(app.query('UPDATE hsdg.audit_events SET reason = $1', ['tamper'])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(app.query('DELETE FROM hsdg.audit_events')).rejects.toThrow(/permission denied/i);
  });

  it('hides reference data (roles) without a context, reveals it with one', async () => {
    const none = await underContext({}, 'SELECT slug FROM hsdg.roles');
    expect(none).toHaveLength(0);
    const some = await underContext(
      { userId: userIds['manager.x@hsdg.in'], role: 'manager', officeId: officeIds['NORTH'] },
      'SELECT slug FROM hsdg.roles',
    );
    expect(some.length).toBeGreaterThan(0);
  });
});
