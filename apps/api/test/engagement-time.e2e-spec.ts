import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Engagement time tracking (ADR-0034) through the HTTP API: a manual stopwatch
 * with one running timer per person (firm-wide), assignment-scoped visibility,
 * the terminal-state auto-stop safety net, and the report.read-gated firm report.
 */
describe('Engagement Time Tracking (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniquePeriod = (): string => `T${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let mp: string;
  const findEntityId = async (search: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/entities?search=${search}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };
  const findServiceId = async (code: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/services?search=${code}&limit=100`)
      .set(bearer(mp));
    return res.body.items[0].id as string;
  };

  /** Create an engagement led by Partner A (who becomes the EP). */
  const createEngagement = async (
    pa: string,
    opts: { status?: string; serviceCode?: string } = {},
  ): Promise<{ id: string; code: string }> => {
    const entityId = await findEntityId('Bharat'); // North client, Partner A's office
    const serviceId = await findServiceId(opts.serviceCode ?? 'ITR_FILING');
    const res = await request(app.getHttpServer())
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId,
        financialYear: '2024-25',
        periodLabel: uniquePeriod(),
        ...(opts.status ? { status: opts.status } : {}),
      })
      .expect(201);
    return { id: res.body.id as string, code: res.body.engagementCode as string };
  };

  /** Make sure an actor has no running timer left over (keeps tests independent). */
  const stopIfRunning = async (t: string): Promise<void> => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/engagements/time/active')
      .set(bearer(t));
    const active = res.body;
    if (active && active.entry) {
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${active.entry.engagementId}/time/stop`)
        .set(bearer(t))
        .send({});
    }
  };

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    mp = await token('mp@dhvaj.in');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('start / stop', () => {
    it('starts a running timer and stops it with a recorded duration', async () => {
      const pa = await token('partner.a@dhvaj.in');
      await stopIfRunning(pa);
      const eng = await createEngagement(pa, { status: 'accepted' });

      const started = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/time/start`)
        .set(bearer(pa))
        .send({ note: 'drafting return' })
        .expect(201);
      expect(started.body.isRunning).toBe(true);
      expect(started.body.endedAt).toBeNull();
      expect(started.body.note).toBe('drafting return');

      const stopped = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/time/stop`)
        .set(bearer(pa))
        .send({})
        .expect(201);
      expect(stopped.body.isRunning).toBe(false);
      expect(stopped.body.stoppedReason).toBe('manual');
      expect(typeof stopped.body.durationSeconds).toBe('number');
      expect(stopped.body.durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('rejects a second running timer anywhere for the same person (409)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      await stopIfRunning(pa);
      const a = await createEngagement(pa, { status: 'accepted' });
      const b = await createEngagement(pa, { status: 'accepted', serviceCode: 'GST_MONTHLY' });

      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${a.id}/time/start`)
        .set(bearer(pa))
        .send({})
        .expect(201);
      const conflict = await request(app.getHttpServer())
        .post(`/api/v1/engagements/${b.id}/time/start`)
        .set(bearer(pa))
        .send({})
        .expect(409);
      expect(conflict.body.message).toContain(a.code);

      await stopIfRunning(pa);
    });

    it('404s when starting on an engagement the caller cannot see (RLS)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      await stopIfRunning(pa);
      const eng = await createEngagement(pa, { status: 'accepted' });
      // Partner B (South) is not on this North engagement — it does not exist for them.
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/time/start`)
        .set(bearer(await token('partner.b@dhvaj.in')))
        .send({})
        .expect(404);
    });

    it('404s stopping when the caller has no running timer on the engagement', async () => {
      const pa = await token('partner.a@dhvaj.in');
      await stopIfRunning(pa);
      const eng = await createEngagement(pa, { status: 'accepted' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/time/stop`)
        .set(bearer(pa))
        .send({})
        .expect(404);
    });
  });

  describe('active timer + per-engagement summary', () => {
    it('exposes the running timer to its owner and clears it on stop', async () => {
      const pa = await token('partner.a@dhvaj.in');
      await stopIfRunning(pa);
      const eng = await createEngagement(pa, { status: 'accepted' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/time/start`)
        .set(bearer(pa))
        .send({})
        .expect(201);

      const active = await request(app.getHttpServer())
        .get('/api/v1/engagements/time/active')
        .set(bearer(pa))
        .expect(200);
      expect(active.body.engagementCode).toBe(eng.code);
      expect(active.body.entry.engagementId).toBe(eng.id);

      await stopIfRunning(pa);
      const cleared = await request(app.getHttpServer())
        .get('/api/v1/engagements/time/active')
        .set(bearer(pa))
        .expect(200);
      expect(cleared.body).toEqual({} as unknown); // null serialises to empty body
    });

    it('shows the per-person summary to any assigned team member', async () => {
      const pa = await token('partner.a@dhvaj.in');
      await stopIfRunning(pa);
      const eng = await createEngagement(pa, { status: 'accepted' });
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/time/start`)
        .set(bearer(pa))
        .send({})
        .expect(201);
      await stopIfRunning(pa);

      const report = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}/time`)
        .set(bearer(pa))
        .expect(200);
      expect(report.body.byPerson.length).toBeGreaterThanOrEqual(1);
      expect(report.body.byPerson[0].employeeName).toBe('Partner A');

      // A non-member cannot see it (RLS) — the engagement 404s.
      await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}/time`)
        .set(bearer(await token('partner.b@dhvaj.in')))
        .expect(404);
    });
  });

  describe('terminal-state safety net', () => {
    it('force-stops running timers when the engagement is cancelled (terminal)', async () => {
      const pa = await token('partner.a@dhvaj.in');
      await stopIfRunning(pa);
      // A prospect can be cancelled (a terminal state) directly.
      const eng = await createEngagement(pa);
      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/time/start`)
        .set(bearer(pa))
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/engagements/${eng.id}/cancel`)
        .set(bearer(pa))
        .send({ reason: 'client withdrew' })
        .expect(201);

      // The caller now has NO running timer — the net stopped it.
      const active = await request(app.getHttpServer())
        .get('/api/v1/engagements/time/active')
        .set(bearer(pa))
        .expect(200);
      expect(active.body).toEqual({} as unknown);

      const report = await request(app.getHttpServer())
        .get(`/api/v1/engagements/${eng.id}/time`)
        .set(bearer(pa))
        .expect(200);
      expect(report.body.entries[0].isRunning).toBe(false);
      expect(report.body.entries[0].stoppedReason).toBe('engagement_closed');
    });
  });

  describe('firm-wide report', () => {
    it('is available to a report.read holder and denied to a senior (403)', async () => {
      await request(app.getHttpServer()).get('/api/v1/reports/time').set(bearer(mp)).expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/reports/time')
        .set(bearer(await token('senior.y@dhvaj.in')))
        .expect(403);
    });

    it('rolls up time per person across engagements', async () => {
      const report = await request(app.getHttpServer())
        .get('/api/v1/reports/time')
        .set(bearer(mp))
        .expect(200);
      expect(report.body.totals).toHaveProperty('people');
      expect(report.body.totals).toHaveProperty('totalSeconds');
      expect(Array.isArray(report.body.rows)).toBe(true);
    });
  });
});
