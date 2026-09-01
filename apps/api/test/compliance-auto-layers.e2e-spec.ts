import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Auto-generated deadline layers (§16/§17 step 8). When a STATUTORY obligation
 * is generated, the standard review milestones are materialised as their own
 * calendar events — a manager review always, and an EP review when the service
 * requires full EP review — each owned by the accountable lead. Advisory/internal
 * categories get none (§21). The feature ships ON by default (prod-faithful).
 */
describe('Auto-generated deadline layers (e2e)', () => {
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

  const createEngagement = async (epToken: string, serviceCode: string): Promise<string> => {
    const entityId = await findId('/api/v1/entities?search=Bharat&limit=100');
    const serviceId = await findId(`/api/v1/services?search=${serviceCode}&limit=100`);
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `AL${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const createRule = async (category: string): Promise<string> => {
    const code = `AL_${unique()}`;
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

  const layerEvents = async (
    eng: string,
    instanceId: string,
  ): Promise<Array<{ layerType: string; dueDate: string }>> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${eng}/compliance/${instanceId}`)
      .set(bearer(mp))
      .expect(200);
    return res.body.deadlines as Array<{ layerType: string; dueDate: string }>;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('adds a manager-review milestone (only) for a statutory obligation on a manager-review service', async () => {
    const pa = await token('partner.a@dhvaj.in');
    const eng = await createEngagement(pa, 'ITR_FILING'); // manager_review model
    const code = await createRule('STATUTORY_RULE');
    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-12-01' })
      .expect(201);

    const layers = await layerEvents(eng, gen.body.id);
    expect(layers.map((l) => l.layerType).sort()).toEqual(['manager_review']);
    // The milestone lands before the statutory date (2026-12-01).
    expect(new Date(layers[0]!.dueDate).getTime()).toBeLessThan(new Date('2026-12-01').getTime());
  });

  it('adds manager + EP review milestones for a full-EP-review service', async () => {
    const pa = await token('partner.a@dhvaj.in');
    const eng = await createEngagement(pa, 'TAX_AUDIT'); // full_ep_review model
    const code = await createRule('STATUTORY_RULE');
    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-12-01' })
      .expect(201);

    const layers = await layerEvents(eng, gen.body.id);
    expect(layers.map((l) => l.layerType).sort()).toEqual(['ep_review', 'manager_review']);
    // Manager reviews earlier than the EP (EP is closer to the filing date).
    const byType = Object.fromEntries(layers.map((l) => [l.layerType, l.dueDate]));
    expect(new Date(byType.manager_review!).getTime()).toBeLessThanOrEqual(
      new Date(byType.ep_review!).getTime(),
    );
  });

  it('adds no milestones for a non-statutory (advisory/internal) obligation', async () => {
    const pa = await token('partner.a@dhvaj.in');
    const eng = await createEngagement(pa, 'ITR_FILING');
    const code = await createRule('HSDG_MILESTONE');
    const gen = await request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(pa))
      .send({ complianceRuleCode: code, referenceDate: '2026-12-01' })
      .expect(201);

    expect(await layerEvents(eng, gen.body.id)).toHaveLength(0);
  });
});
