import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { AuditMatterRecord } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { answerSection01 } from './section01.helper';

/**
 * Section 01 Acceptance Matters register (spec §11): a generated matter is
 * owned by the Engagement Manager and due in a week; the team edits its
 * description and action; closing it needs a resolution; a high or critical
 * matter is accepted with approval by the Engagement Partner only.
 */
describe('Statutory Audit — 01 Acceptance Matters register (e2e)', () => {
  let app: INestApplication;
  let pa: string;
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
    mx = await token('manager.x@dhvaj.in');
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('defaults owner and due date, edits in place and keeps significant acceptance with the partner', async () => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE full_name = 'Manager X'`,
    );
    const today = (await c.query<{ d: string }>(`SELECT (current_date + 7)::text AS d`)).rows[0]!.d;
    await c.end();
    const managerId = rows[0]!.id;
    const entity = await post(pa, '/api/v1/entities', {
      legalName: `Matters Seed ${stamp()}`,
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
    const base = `/api/v1/engagements/${engId}/statutory-audit`;
    const shellId = (await get(pa, base)).body[0].workflowInstanceId as string;

    await answerSection01(app, pa, engId, 'independence_ethics', 'ind_02', 'yes', {
      threat: 'familiarity',
      person: 'Article assistant',
      description: "The article assistant is the CFO's nephew.",
      significance: 'high',
      consultation: 'no',
      conclusion: 'safeguards',
      safeguard: 'Article assistant rotated off the engagement.',
    });
    const read = async (): Promise<AuditMatterRecord> =>
      (
        (await get(pa, `${base}/${shellId}/matters?section=acceptance`)).body as AuditMatterRecord[]
      ).find((m) => m.source.endsWith(':ind_02'))!;
    let m = await read();
    // Generated: the Engagement Manager owns it, due in a week.
    expect(m).toMatchObject({
      ownerEmployeeId: managerId,
      ownerName: 'Manager X',
      dueDate: today,
      description: null,
      action: null,
      severity: 'high',
      status: 'open',
    });

    // The manager writes the description and action and puts it under review.
    m = (
      await post(mx, `${base}/matters/${m.id}`, {
        status: 'under_review',
        description: 'Nephew of the CFO on the audit team.',
        action: 'Rotate the article assistant off the engagement.',
        version: m.version,
      }).expect(201)
    ).body;
    expect(m).toMatchObject({
      status: 'under_review',
      description: 'Nephew of the CFO on the audit team.',
      action: 'Rotate the article assistant off the engagement.',
    });

    // Closing needs a resolution; a high matter is accepted by the partner only.
    await post(mx, `${base}/matters/${m.id}`, { status: 'resolved', version: m.version }).expect(
      400,
    );
    await post(mx, `${base}/matters/${m.id}`, {
      status: 'accepted_with_approval',
      resolution: 'Rotated off; reviewed by the partner.',
      version: m.version,
    }).expect(403);
    m = (
      await post(pa, `${base}/matters/${m.id}`, {
        status: 'accepted_with_approval',
        resolution: 'Rotated off; reviewed by the partner.',
        version: m.version,
      }).expect(201)
    ).body;
    expect(m).toMatchObject({ status: 'accepted_with_approval', approverName: 'Partner A' });

    // An empty description restores the generated line.
    m = (
      await post(pa, `${base}/matters/${m.id}`, { description: '', version: m.version }).expect(201)
    ).body;
    expect(m.description).toBeNull();
  }, 30_000);
});
