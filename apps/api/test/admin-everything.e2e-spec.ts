import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * B-1 — the administrator sees and does everything. The reach test reads every
 * table under row level security as the least-privilege app role twice, once as
 * the Managing Partner and once as an administrator, with the same user, person
 * and office, so the role is the only difference: the counts must be equal.
 */
describe('The administrator sees and does everything (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  let userIds: Record<string, string>;
  let officeIds: Record<string, string>;
  let engagementId: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Row counts of every RLS table under one context; a table the role may not read at all is null. */
  async function reach(role: string, roles: string[]): Promise<Record<string, number | null>> {
    const { rows: tables } = await db.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'hsdg' AND c.relkind = 'r' AND c.relrowsecurity ORDER BY 1`,
    );
    const out: Record<string, number | null> = {};
    for (const { name } of tables) {
      await db.query('BEGIN');
      try {
        await db.query(
          `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', $2, true),
                  set_config('hsdg.roles', $3, true), set_config('hsdg.office_id', $4, true)`,
          [userIds['admin@dhvaj.in'], role, roles.join(','), officeIds['NORTH']],
        );
        const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM hsdg.${name}`);
        out[name] = Number(rows[0]!.n);
      } catch {
        out[name] = null;
      } finally {
        await db.query('ROLLBACK');
      }
    }
    return out;
  }

  beforeAll(async () => {
    ({ userIds, officeIds } = await seedIdentityFixtures());
    app = await createTestApp();
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    // An engagement of a North partner's, so client and engagement tables hold rows.
    const pa = await token('partner.a@dhvaj.in');
    const mp = await token('mp@dhvaj.in');
    const first = async (path: string) =>
      (await http().get(path).set(bearer(mp)).expect(200)).body.items[0].id as string;
    const eng = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId: await freshClient(await first('/api/v1/entities?search=Bharat&limit=100')),
        serviceId: await first('/api/v1/services?search=ITR_FILING&limit=100'),
        financialYear: '2026-27',
        periodLabel: `ADM${Date.now()}`,
        status: 'accepted',
      })
      .expect(201);
    engagementId = eng.body.id as string;
  });

  afterAll(async () => {
    await db?.end();
    await app?.close();
  });

  it('reads every table as the Managing Partner does', async () => {
    const mp = await reach('managing_partner', ['managing_partner']);
    const admin = await reach('admin', ['admin']);
    const differ = Object.keys(mp).filter((t) => mp[t] !== admin[t]);
    expect(differ.map((t) => `${t}: MP ${mp[t]}, admin ${admin[t]}`)).toEqual([]);
    expect(admin['engagements']).toBeGreaterThan(0);
    expect(admin['entities']).toBeGreaterThan(0);
  });

  it('holds every permission and opens any engagement', async () => {
    const admin = await token('admin@dhvaj.in');
    const me = await http().get('/api/v1/auth/me').set(bearer(admin)).expect(200);
    const su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const { rows } = await su
      .query<{ slug: string }>(`SELECT slug FROM hsdg.permissions ORDER BY slug`)
      .finally(() => su.end());
    expect([...(me.body.principal.permissions as string[])].sort()).toEqual(
      rows.map((r) => r.slug),
    );
    await http().get(`/api/v1/engagements/${engagementId}`).set(bearer(admin)).expect(200);
  });
});
