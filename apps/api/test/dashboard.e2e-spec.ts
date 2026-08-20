import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Phase 12 — Home dashboard summary, through the HTTP API.
 *
 * The summary is RLS-scoped: the Managing Partner sees firm-wide counts, while a
 * partner sees only their own assignment scope. The web renders per-role cards
 * from these already-scoped numbers.
 */
describe('Dashboard summary (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the full set of scoped counts to any authenticated user', async () => {
    const sy = await token('senior.y@hsdg.in');
    const res = await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set(bearer(sy))
      .expect(200);
    for (const key of [
      'activeEngagements',
      'overdueCompliance',
      'dueSoonCompliance',
      'pendingReviews',
      'pendingSignoffs',
      'openClientDependencies',
      'highRisk',
      'myOpenTasks',
      'myOverdueTasks',
      'unreadNotifications',
    ]) {
      expect(typeof res.body[key]).toBe('number');
      expect(res.body[key]).toBeGreaterThanOrEqual(0);
    }
    expect(res.body.dueSoonWindowDays).toBe(7);
  });

  it('is RLS-scoped: the Managing Partner sees at least as many active engagements as a single partner', async () => {
    const mp = await token('mp@hsdg.in');
    const pb = await token('partner.b@hsdg.in');
    const mpRes = await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set(bearer(mp))
      .expect(200);
    const pbRes = await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set(bearer(pb))
      .expect(200);
    // Seed has ≥2 engagements firm-wide; the MP sees them all.
    expect(mpRes.body.activeEngagements).toBeGreaterThanOrEqual(pbRes.body.activeEngagements);
  });

  it('accepts a due-soon window override', async () => {
    const mp = await token('mp@hsdg.in');
    const res = await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary?dueSoonDays=30')
      .set(bearer(mp))
      .expect(200);
    expect(res.body.dueSoonWindowDays).toBe(30);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/dashboard/summary').expect(401);
  });
});
