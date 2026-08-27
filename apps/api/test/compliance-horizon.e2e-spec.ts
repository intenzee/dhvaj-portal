import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Rolling recurring-work horizon (spec §18).
 *
 * Recurring component work is materialised only for periods starting within a
 * configurable future horizon; a rolling sweep extends it as time advances,
 * idempotently and without duplicating. These tests pin "today" to the machine
 * clock (2026-08-27) and a monthly GST component on FY 2026-27:
 *   • horizon 1 month  → Apr–Sep 2026 (6 periods: past + 1 future month)
 *   • horizon 12 months → the full FY (12 periods)
 * Shrinking the horizon never cancels already-created future work.
 */
describe('Rolling recurring-work horizon (e2e)', () => {
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
    const serviceId = await findId('/api/v1/services?search=GST_MONTHLY&limit=100');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(epToken))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `H${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    return res.body.id as string;
  };

  const configure = async (t: string, engId: string, code: string): Promise<void> => {
    await request(app.getHttpServer())
      .post(`/api/v1/engagements/${engId}/components`)
      .set(bearer(t))
      .send({ serviceComponentCode: code })
      .expect(201);
  };

  const roll = (t: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/v1/compliance/horizon').set(bearer(t)).send(body);

  const liveCount = async (t: string, engId: string): Promise<number> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/engagements/${engId}/component-work?limit=100`)
      .set(bearer(t))
      .expect(200);
    return (res.body.items as Array<{ status: string }>).filter((i) => i.status !== 'cancelled')
      .length;
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@hsdg.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes the configured horizon (default 12 months)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/compliance/horizon')
      .set(bearer(mp))
      .expect(200);
    expect(res.body.horizonMonths).toBe(12);
  });

  it('bounds generation to the horizon, then rolls forward idempotently', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    await configure(pa, engId, 'GSTR1'); // monthly

    // Horizon 1 month → today (2026-08-27) + 1mo ⇒ only Apr–Sep 2026 (6 periods).
    const first = await roll(pa, { horizonMonths: 1, engagementId: engId }).expect(201);
    expect(first.body.engagementsProcessed).toBe(1);
    expect(first.body.generated).toBe(6);
    expect(await liveCount(pa, engId)).toBe(6);

    // Roll the full 12-month horizon → the remaining 6 periods, no duplicates.
    const second = await roll(pa, { horizonMonths: 12, engagementId: engId }).expect(201);
    expect(second.body.generated).toBe(6);
    expect(await liveCount(pa, engId)).toBe(12);

    // Idempotent — re-running generates nothing new.
    const third = await roll(pa, { horizonMonths: 12, engagementId: engId }).expect(201);
    expect(third.body.generated).toBe(0);
    expect(third.body.removed).toBe(0);
    expect(await liveCount(pa, engId)).toBe(12);
  });

  it('shrinking the horizon never cancels already-created future work', async () => {
    const pa = await token('partner.a@hsdg.in');
    const engId = await createEngagement(pa);
    await configure(pa, engId, 'GSTR1');
    await roll(pa, { horizonMonths: 12, engagementId: engId }).expect(201); // full FY (12)
    expect(await liveCount(pa, engId)).toBe(12);

    // A smaller horizon must NOT remove the future work already generated.
    const shrunk = await roll(pa, { horizonMonths: 1, engagementId: engId }).expect(201);
    expect(shrunk.body.generated).toBe(0);
    expect(shrunk.body.removed).toBe(0);
    expect(await liveCount(pa, engId)).toBe(12);
  });

  it('forbids a Senior (no engagement.manage) from rolling the horizon (403)', async () => {
    await roll(await token('senior.y@hsdg.in'), { horizonMonths: 3 }).expect(403);
  });
});
