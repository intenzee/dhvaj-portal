import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { TodayView } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Staff Workflow WF-201 "Done when": GET /work/today answers in under 300 ms
 * with 500 open items. Senior Y gets 300 tasks to prepare, 100 waiting on the
 * client and 100 open client requests on one engagement; the median of five
 * warm reads must stay under the budget, and every item is counted.
 */
describe('Today under load (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let sy: string;
  let engagementId: string | undefined;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    // Leave Senior Y's day as it was for the suites (and Playwright) that follow.
    if (engagementId) {
      await su.query(`DELETE FROM hsdg.client_dependencies WHERE engagement_id = $1`, [
        engagementId,
      ]);
      await su.query(`DELETE FROM hsdg.tasks WHERE engagement_id = $1`, [engagementId]);
    }
    await su?.end();
    await app?.close();
  });

  it('answers in under 300 ms with 500 open items', async () => {
    const entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `PERF${Date.now()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    engagementId = eng;
    const me = await employeeId('EMP006');
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: me, roleOnEngagement: 'in_charge' })
      .expect(201);

    // Start from a clean slate for Senior Y, so the count below is exact.
    const before = (await http().get('/api/v1/work/today').set(bearer(sy)).expect(200)).body;
    const baseline = new Map<string, number>(
      before.groups.map((g: { group: string; total: number }) => [g.group, g.total]),
    );

    await su.query(
      `INSERT INTO hsdg.tasks (engagement_id, title, status, assigned_to_employee_id, due_date)
       SELECT $1, 'Perf task ' || g, CASE WHEN g <= 300 THEN 'todo' ELSE 'blocked' END, $2,
              current_date + (g % 30)
         FROM generate_series(1, 400) g`,
      [eng, me],
    );
    await su.query(
      `INSERT INTO hsdg.client_dependencies
         (engagement_id, requested_info, status, responsible_employee_id, escalation_date)
       SELECT $1, 'Perf request ' || g, 'pending', $2, current_date + (g % 20)
         FROM generate_series(1, 100) g`,
      [eng, me],
    );

    // A real table has statistics; autovacuum would analyze after a load this size.
    await su.query('ANALYZE hsdg.tasks, hsdg.client_dependencies');
    const read = async (): Promise<{ ms: number; body: TodayView }> => {
      const t0 = performance.now();
      const res = await http().get('/api/v1/work/today').set(bearer(sy)).expect(200);
      return { ms: performance.now() - t0, body: res.body };
    };
    await read(); // warm the plan cache and the pool
    const runs = [];
    for (let i = 0; i < 5; i += 1) runs.push(await read());
    const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
    console.log(
      `GET /work/today with 500 open items: ${ms.map((m) => m.toFixed(0)).join(', ')} ms`,
    );
    const median = ms[2]!;

    const totals = new Map<string, number>(runs[0]!.body.groups.map((g) => [g.group, g.total]));
    expect(totals.get('prepare')! - (baseline.get('prepare') ?? 0)).toBe(300);
    expect(totals.get('waiting')! - (baseline.get('waiting') ?? 0)).toBe(200);
    // Each group sends its most urgent rows only; the totals above stay exact.
    for (const g of runs[0]!.body.groups) expect(g.items.length).toBeLessThanOrEqual(100);
    expect(median).toBeLessThan(300);
  });
});
