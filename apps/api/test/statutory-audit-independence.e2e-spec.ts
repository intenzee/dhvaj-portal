import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { StatutoryAuditAcceptance } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * 01.5 team independence (spec §8): the summary is generated from the team
 * the portal already holds (Engagement Partner, Manager, engagement team);
 * each person declares for themselves; the segment waits on the pending ones.
 */
describe('Statutory Audit — 01.5 team independence declarations (e2e)', () => {
  let app: INestApplication;
  let pa: string;
  let pb: string;
  let mx: string;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const post = (t: string, url: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(url).set(bearer(t)).send(body);
  const get = (t: string, url: string) =>
    request(app.getHttpServer()).get(url).set(bearer(t)).expect(200);
  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp)).expect(200);
    return res.body.items[0].id as string;
  };
  const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    pa = await token('partner.a@dhvaj.in');
    pb = await token('partner.b@dhvaj.in');
    mx = await token('manager.x@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('summarises the team, takes each own declaration and keeps 01.5 open until all are in', async () => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE full_name = 'Manager X'`,
    );
    await c.end();
    const managerId = rows[0]!.id;
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Independence Seed ${stamp()}`,
      typeSlug: 'private_limited',
      officeCode: 'NORTH',
    }).expect(201);
    const itr = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const stat = await findId('/api/v1/services?search=STAT_AUDIT&limit=100');
    const eng = await post(pa, '/api/v1/engagements', {
      entityId: entity.body.id,
      serviceId: itr,
      financialYear: '2024-25',
      periodLabel: `P${stamp()}`,
      status: 'accepted',
      engagementManagerEmployeeId: managerId,
    }).expect(201);
    const engId = eng.body.id as string;
    await post(pa, `/api/v1/engagements/${engId}/services`, { serviceId: stat }).expect(201);
    const accUrl = `/api/v1/engagements/${engId}/statutory-audit/acceptance`;
    const read = async (t: string) => (await get(t, accUrl)).body[0] as StatutoryAuditAcceptance;
    const shellId = (await read(pa)).workflowInstanceId;
    const declare = (t: string, body: Record<string, unknown>) =>
      post(
        t,
        `/api/v1/engagements/${engId}/statutory-audit/${shellId}/acceptance/independence/declaration`,
        body,
      );
    const segment = (acc: StatutoryAuditAcceptance) =>
      acc.segments.find((s) => s.segmentKey === 'independence_ethics')!;

    // System-generated: the partner and the manager, both pending.
    let acc = await read(pa);
    expect(acc.context.independence).toMatchObject({ required: 2, completed: 0, pending: 2 });
    expect(acc.context.independence.rows.map((r) => r.role)).toEqual([
      'Engagement Partner',
      'Engagement Manager',
    ]);
    expect(acc.context.independence.mine?.role).toBe('Engagement Partner');

    // The partner declares; the manager's declaration is still awaited.
    acc = (await declare(pa, { status: 'independent' }).expect(201)).body;
    expect(acc.context.independence).toMatchObject({ completed: 1, pending: 1 });
    expect(segment(acc).attentionItems.map((i) => i.text)).toContain(
      '1 team independence declaration pending',
    );

    // Someone not on the engagement cannot declare; a threat needs its disclosure.
    expect([403, 404]).toContain((await declare(pb, { status: 'independent' })).status);
    await declare(mx, { status: 'threat_disclosed' }).expect(400);
    acc = (
      await declare(mx, {
        status: 'threat_disclosed',
        disclosure: 'Spouse holds 200 shares in the client.',
      }).expect(201)
    ).body;
    expect(acc.context.independence).toMatchObject({
      completed: 2,
      pending: 0,
      threatsDisclosed: 1,
    });
    // The manager's own row is theirs; the partner sees it in the team list.
    expect(acc.context.independence.mine).toMatchObject({
      role: 'Engagement Manager',
      status: 'threat_disclosed',
    });
    const seen = (await read(pa)).context.independence;
    expect(seen.mine?.role).toBe('Engagement Partner');
    expect(seen.rows.find((r) => r.role === 'Engagement Manager')?.disclosure).toBe(
      'Spouse holds 200 shares in the client.',
    );
    expect(
      segment(acc)
        .attentionItems.map((i) => i.text)
        .join(' '),
    ).not.toMatch(/pending/);
  });
});
