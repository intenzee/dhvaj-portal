import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Auto-generated tasks (§17 step 10). Generating a STATUTORY obligation creates
 * exactly ONE material "complete this filing" task, assigned to the accountable
 * owner and due at the internal SLA date. Non-statutory obligations get none
 * (routine checklist work stays in Workflow, §21). Ships ON by default.
 */
describe('Auto-generated tasks (e2e)', () => {
  let app: INestApplication;
  let mp: string;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const findId = async (path: string): Promise<string> => {
    const res = await request(app.getHttpServer()).get(path).set(bearer(mp));
    return res.body.items[0].id as string;
  };

  const createEngagement = async (epToken: string): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId('/api/v1/services?search=ITR_FILING&limit=100');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `AT${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const createRule = async (category: string): Promise<string> => {
    const code = `ATSK_${unique()}`;
    const rule = await request(app.getHttpServer())
      .post('/api/v1/compliance-rules')
      .set(bearer(mp))
      .send({ code, name: code, dueDateCategory: category })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/compliance-rules/${rule.body.id}/versions`)
      .set(bearer(mp))
      .send({
        effectiveFrom: '2017-04-01',
        calculationBasis: 'period_end',
        offsetDays: 0,
        workingDayAdjustment: 'none',
      })
      .expect(201);
    return code;
  };

  const tasksFor = async (
    eng: string,
  ): Promise<Array<{ title: string; dueDate: string; assignedToId: string | null }>> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${eng}/tasks?limit=100`)
      .set(bearer(mp))
      .expect(200);
    return res.body.items as Array<{
      title: string;
      dueDate: string;
      assignedToId: string | null;
    }>;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates the one material task for a statutory obligation, due at the internal SLA', async () => {
    const pa = await token('partner.a@dhvaj.in');
    const eng = await createEngagement(pa);
    const code = await createRule('STATUTORY_RULE');
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-12-01' })
      .expect(201);

    const tasks = await tasksFor(eng);
    const auto = tasks.filter((t) => t.title.startsWith('Complete ' + code));
    expect(auto).toHaveLength(1);
    // internal SLA = statutory (period_end + 0, 0-day buffer) = 2026-12-01.
    expect(auto[0]!.dueDate).toBe('2026-12-01');
    // Assigned to the accountable owner (manager ?? partner).
    expect(auto[0]!.assignedToId).toBeTruthy();
  });

  it('creates no task for a non-statutory (advisory/internal) obligation', async () => {
    const pa = await token('partner.a@dhvaj.in');
    const eng = await createEngagement(pa);
    const code = await createRule('HSDG_MILESTONE');
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-12-01' })
      .expect(201);

    const tasks = await tasksFor(eng);
    expect(tasks.filter((t) => t.title.startsWith('Complete ' + code))).toHaveLength(0);
  });
});
