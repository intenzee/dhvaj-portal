import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Resource Management (spec — people workload/capacity) — the `/resources/workload`
 * view. Gated by `employee.read` (everyone, RLS scopes the rows) and rolled up by
 * office and grade. RLS-scoped exactly like the utilisation report.
 */
describe('Resource Management (e2e)', () => {
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

  it('requires authentication (401 without a token)', async () => {
    await request(app.getHttpServer()).get('/api/v1/resources/workload').expect(401);
  });

  it('returns per-person rows with office/grade rollups and totals for the MP', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/resources/workload')
      .set(bearer(await token('mp@dhvaj.in')))
      .expect(200);

    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(Array.isArray(res.body.byOffice)).toBe(true);
    expect(Array.isArray(res.body.byGrade)).toBe(true);
    expect(res.body.rows.length).toBeGreaterThan(0);

    // Totals reconcile with the rows.
    const rows = res.body.rows as Array<{
      asEp: number;
      asManager: number;
      asMember: number;
      openTasks: number;
      overdueTasks: number;
    }>;
    const expectedAssignments = rows.reduce((n, r) => n + r.asEp + r.asManager + r.asMember, 0);
    expect(res.body.totals.people).toBe(rows.length);
    expect(res.body.totals.activeAssignments).toBe(expectedAssignments);
    expect(res.body.totals.overloaded).toBe(rows.filter((r) => r.overdueTasks > 0).length);

    // Office rollup people sum to the row count.
    const officePeople = (res.body.byOffice as Array<{ people: number }>).reduce(
      (n, g) => n + g.people,
      0,
    );
    expect(officePeople).toBe(rows.length);
  });

  it('is RLS-scoped — a partner sees no more people than the MP', async () => {
    const mp = await request(app.getHttpServer())
      .get('/api/v1/resources/workload')
      .set(bearer(await token('mp@dhvaj.in')))
      .expect(200);
    const pa = await request(app.getHttpServer())
      .get('/api/v1/resources/workload')
      .set(bearer(await token('partner.a@dhvaj.in')))
      .expect(200);
    expect(pa.body.totals.people).toBeLessThanOrEqual(mp.body.totals.people);
  });
});
