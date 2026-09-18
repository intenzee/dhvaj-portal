import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addMonthsUTC, parseISODate, toISODate } from '../src/modules/compliance/compliance-calc';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Rolling recurring-work horizon (spec §18).
 *
 * Recurring component work is materialised only for periods whose start falls on
 * or before a configurable future horizon (today + N months); a rolling sweep
 * extends it as time advances, idempotently and without duplicating. These tests
 * use a monthly GST component on FY 2026-27 (12 monthly periods, Apr 2026 – Mar
 * 2027) and compute the expected period count from the machine clock the same way
 * the service does (horizonEnd = addMonthsUTC(today, N)), so they stay correct as
 * the clock advances rather than pinning a specific "today". Shrinking the horizon
 * never cancels already-created future work.
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

  // The monthly period starts for FY 2026-27 — the 1st of each month Apr..Mar.
  const FY_MONTHLY_STARTS = Array.from({ length: 12 }, (_, i) =>
    toISODate(addMonthsUTC(parseISODate('2026-04-01'), i)),
  );
  // How many of those periods a given horizon materialises, computed exactly as
  // the service does: those whose start is on/before addMonthsUTC(today, months).
  const expectedPeriods = (horizonMonths: number): number => {
    const horizonEnd = toISODate(addMonthsUTC(parseISODate(toISODate(new Date())), horizonMonths));
    return FY_MONTHLY_STARTS.filter((start) => start <= horizonEnd).length;
  };

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
    mp = await token('mp@dhvaj.in');
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
    const pa = await token('partner.a@dhvaj.in');
    const engId = await createEngagement(pa);
    await configure(pa, engId, 'GSTR1'); // monthly

    // Horizon 1 month → only periods starting on/before today + 1 month.
    const within1 = expectedPeriods(1);
    const first = await roll(pa, { horizonMonths: 1, engagementId: engId }).expect(201);
    expect(first.body.engagementsProcessed).toBe(1);
    expect(first.body.generated).toBe(within1);
    expect(await liveCount(pa, engId)).toBe(within1);

    // Roll the full 12-month horizon → the remaining periods of the FY, no duplicates.
    const second = await roll(pa, { horizonMonths: 12, engagementId: engId }).expect(201);
    expect(second.body.generated).toBe(12 - within1);
    expect(await liveCount(pa, engId)).toBe(12);

    // Idempotent — re-running generates nothing new.
    const third = await roll(pa, { horizonMonths: 12, engagementId: engId }).expect(201);
    expect(third.body.generated).toBe(0);
    expect(third.body.removed).toBe(0);
    expect(await liveCount(pa, engId)).toBe(12);
  });

  it('shrinking the horizon never cancels already-created future work', async () => {
    const pa = await token('partner.a@dhvaj.in');
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
    await roll(await token('senior.y@dhvaj.in'), { horizonMonths: 3 }).expect(403);
  });
});
