import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Reports & MIS (e2e). Management aggregations gated by `report.read`
 * (MP/admin/partner/manager) and RLS-scoped — a partner's rollups reflect only
 * their accessible engagements, never the whole firm.
 */
describe('Reports & MIS (e2e)', () => {
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

  describe('permission gating', () => {
    it('lets a manager (report.read) read the engagement MIS', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/engagements')
        .set(bearer(await token('manager.x@hsdg.in')))
        .expect(200);
    });

    it('forbids a senior (no report.read) from every report (403)', async () => {
      const t = await token('senior.y@hsdg.in');
      for (const path of ['engagements', 'compliance', 'utilisation']) {
        await request(app.getHttpServer())
          .get(`/api/v1/reports/${path}`)
          .set(bearer(t))
          .expect(403);
      }
    });
  });

  describe('engagement MIS', () => {
    it('returns totals and breakdowns for the Managing Partner', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/engagements')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(typeof res.body.totals.total).toBe('number');
      expect(res.body.totals.total).toBeGreaterThan(0);
      expect(Array.isArray(res.body.byStatus)).toBe(true);
      expect(Array.isArray(res.body.byServiceLine)).toBe(true);
      expect(Array.isArray(res.body.byOffice)).toBe(true);
      expect(Array.isArray(res.body.byPartner)).toBe(true);
      // byStatus counts sum to the total.
      const sum = (res.body.byStatus as Array<{ count: number }>).reduce((a, b) => a + b.count, 0);
      expect(sum).toBe(res.body.totals.total);
    });

    it('scopes the totals by RLS — a partner sees no more than the MP', async () => {
      const mp = await request(app.getHttpServer())
        .get('/api/v1/reports/engagements')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const pa = await request(app.getHttpServer())
        .get('/api/v1/reports/engagements')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      expect(pa.body.totals.total).toBeLessThanOrEqual(mp.body.totals.total);
      expect(pa.body.totals.total).toBeGreaterThan(0);
    });
  });

  describe('compliance MIS', () => {
    it('returns totals and by-category rollups, honouring dueSoonDays', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/compliance?dueSoonDays=45')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(res.body.dueSoonWindowDays).toBe(45);
      expect(typeof res.body.totals.open).toBe('number');
      expect(Array.isArray(res.body.byCategory)).toBe(true);
      // Overdue + due-soon are subsets of open, per category.
      for (const c of res.body.byCategory as Array<{ open: number; overdue: number; dueSoon: number }>) {
        expect(c.overdue).toBeLessThanOrEqual(c.open);
        expect(c.dueSoon).toBeLessThanOrEqual(c.open);
      }
    });
  });

  describe('utilisation', () => {
    it('returns per-employee workload rows for the Managing Partner', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/utilisation')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(Array.isArray(res.body.rows)).toBe(true);
      // Every listed employee has some visible involvement (the report filters zeros).
      for (const r of res.body.rows as Array<{
        asEp: number;
        asManager: number;
        asMember: number;
        openTasks: number;
      }>) {
        expect(r.asEp + r.asManager + r.asMember + r.openTasks).toBeGreaterThan(0);
      }
    });
  });
});
