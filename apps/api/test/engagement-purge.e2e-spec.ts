import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * An engagement opened by mistake is deleted permanently — by the
 * administrator alone, with its code typed to confirm — and nothing under it
 * is left. One audit event records that it was deleted.
 */
describe('Engagement purge (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let admin: string;
  let eng: string;
  let code: string;
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const count = async (sql: string, id: string): Promise<number> =>
    Number((await su.query<{ n: string }>(sql, [id])).rows[0]!.n);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    admin = await token('admin@dhvaj.in');
    const entity = (await http().get('/api/v1/entities?search=Acme&limit=10').set(bearer(mp))).body
      .items[0].id as string;
    const services = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items as Array<{ id: string; code: string }>;
    const created = await http()
      .post('/api/v1/engagements')
      .set(bearer(mp))
      .send({
        entityId: entity,
        serviceId: services.find((s) => s.code === 'ITR_FILING')!.id,
        financialYear: '2026-27',
        periodLabel: `P${Date.now()}`,
        status: 'prospect',
      })
      .expect(201);
    eng = created.body.id;
    code = created.body.engagementCode;
    await http()
      .post(`/api/v1/engagements/${eng}/tasks`)
      .set(bearer(mp))
      .send({ title: 'Opened by mistake' })
      .expect(201);
  });

  afterAll(async () => {
    await su.end();
    await app.close();
  });

  it('shows the administrator what would go, found by its code', async () => {
    const res = await http()
      .get(`/api/v1/engagement-purge?code=${code.toLowerCase()}`)
      .set(bearer(admin))
      .expect(200);
    expect(res.body).toMatchObject({ id: eng, engagementCode: code, tasks: 1 });
  });

  it('is the administrator’s alone — the managing partner is refused', async () => {
    await http().get(`/api/v1/engagement-purge?code=${code}`).set(bearer(mp)).expect(403);
    await http()
      .delete(`/api/v1/engagement-purge/${eng}`)
      .set(bearer(mp))
      .send({ confirmCode: code })
      .expect(403);
  });

  it('needs the code typed exactly', async () => {
    await http()
      .delete(`/api/v1/engagement-purge/${eng}`)
      .set(bearer(admin))
      .send({ confirmCode: 'ENG-WRONG' })
      .expect(400);
    expect(await count(`SELECT count(*) AS n FROM hsdg.engagements WHERE id = $1`, eng)).toBe(1);
  });

  it('deletes it and everything under it, leaving one audit event', async () => {
    await http()
      .delete(`/api/v1/engagement-purge/${eng}`)
      .set(bearer(admin))
      .send({ confirmCode: code })
      .expect(200);
    expect(await count(`SELECT count(*) AS n FROM hsdg.engagements WHERE id = $1`, eng)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM hsdg.tasks WHERE engagement_id = $1`, eng)).toBe(
      0,
    );
    const { rows } = await su.query<{ action: string }>(
      `SELECT action FROM hsdg.audit_events WHERE object_id = $1`,
      [eng],
    );
    expect(rows.map((r) => r.action)).toEqual(['engagement.purged']);
  });
});
