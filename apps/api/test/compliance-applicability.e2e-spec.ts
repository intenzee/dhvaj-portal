import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Conditional applicability by turnover threshold (§17). A rule version carries a
 * `condition` ({field,op,value}); generation injects the engagement entity's
 * `turnover`, so an entity below the threshold does NOT get the obligation. The
 * seed turnovers: Bharat ₹8cr, Coastal ₹3cr, Deepak ₹5 lakh; thresholds:
 * GSTR-9 ₹2cr, GSTR-9C ₹5cr, Tax Audit ₹1cr.
 */
describe('Conditional applicability by turnover (e2e)', () => {
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

  const engagementFor = async (entitySearch: string): Promise<string> => {
    const entityId = await findId(`/api/v1/entities?search=${entitySearch}&limit=1`);
    const serviceId = await findId('/api/v1/services?search=GST_ANNUAL&limit=1');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(mp))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `APP${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const generate = (eng: string, code: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/engagements/${eng}/compliance`)
      .set(bearer(mp))
      .send({ complianceRuleCode: code });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('applies GSTR-9 to a high-turnover entity (₹8cr ≥ ₹2cr)', async () => {
    const eng = await engagementFor('Bharat');
    await generate(eng, 'GSTR9_ANNUAL').expect(201);
  });

  it('does NOT apply GSTR-9 to a low-turnover entity (₹5 lakh < ₹2cr)', async () => {
    const eng = await engagementFor('Deepak');
    const res = await generate(eng, 'GSTR9_ANNUAL').expect(400);
    expect(String(res.body.message)).toMatch(/does not apply/i);
  });

  it('honours the boundary: GSTR-9 applies but GSTR-9C does not for a mid-tier entity (₹3cr)', async () => {
    const eng = await engagementFor('Coastal');
    await generate(eng, 'GSTR9_ANNUAL').expect(201); // 3cr ≥ 2cr
    await generate(eng, 'GSTR9C_ANNUAL').expect(400); // 3cr < 5cr
  });
});
