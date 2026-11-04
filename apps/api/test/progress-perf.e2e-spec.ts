import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { ProgressView } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * D-1 "Done when": GET /work/progress answers in under 300 ms with 5,000 open
 * tasks, for the Managing Partner (the firm) and for a Senior (their tree),
 * in each grouping, and the drill-down's first page too. Median of five warm
 * reads; every task is counted.
 */
describe('Progress under load (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let sy: string;
  const engagementIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
  });

  afterAll(async () => {
    if (engagementIds.length) {
      await su.query(`DELETE FROM hsdg.tasks WHERE engagement_id = ANY ($1::uuid[])`, [
        engagementIds,
      ]);
    }
    await su?.end();
    await app?.close();
  });

  it('answers in under 300 ms with 5,000 open tasks', async () => {
    const pa = await token('partner.a@dhvaj.in');
    const first = async (path: string) =>
      (await http().get(path).set(bearer(mp)).expect(200)).body.items[0].id as string;
    const serviceId = await first('/api/v1/services?search=ITR_FILING&limit=100');
    const bharat = await first('/api/v1/entities?search=Bharat&limit=100');
    for (let i = 0; i < 10; i += 1) {
      const eng = (
        await http()
          .post('/api/v1/engagements')
          .set(bearer(pa))
          .send({
            entityId: await freshClient(bharat),
            serviceId,
            financialYear: '2026-27',
            periodLabel: `PPERF${Date.now()}${i}`,
            status: 'accepted',
          })
          .expect(201)
      ).body.id as string;
      engagementIds.push(eng);
    }
    const { rows: people } = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code IN ('EMP006')
       UNION ALL
       SELECT id FROM hsdg.employees WHERE reports_to_id = (SELECT id FROM hsdg.employees WHERE employee_code = 'EMP006')`,
    );
    const others = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE date_of_exit IS NULL ORDER BY employee_code LIMIT 30`,
    );
    const holders = [...people.map((p) => p.id), ...others.rows.map((p) => p.id)];
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
       SELECT e, p, 'member' FROM unnest($1::uuid[]) e, unnest($2::uuid[]) p
       ON CONFLICT DO NOTHING`,
      [engagementIds, holders],
    );

    const before = (
      await http().get('/api/v1/work/progress?groupBy=person').set(bearer(mp)).expect(200)
    ).body as ProgressView;

    // 5,000 open tasks over a month, spread over the people and engagements.
    await su.query(
      `INSERT INTO hsdg.tasks (engagement_id, title, status, assigned_to_employee_id, due_date)
       SELECT ($1::uuid[])[1 + g % 10], 'Progress perf ' || g,
              (ARRAY['todo','in_progress','blocked','in_review','paused'])[1 + g % 5],
              ($2::uuid[])[1 + g % cardinality($2::uuid[])],
              date_trunc('month', current_date)::date + (g % 28)
         FROM generate_series(1, 5000) g`,
      [engagementIds, holders],
    );
    await su.query('ANALYZE hsdg.tasks');

    const time = async (who: string, path: string): Promise<number> => {
      await http().get(path).set(bearer(who)).expect(200); // warm
      const ms: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const t0 = performance.now();
        await http().get(path).set(bearer(who)).expect(200);
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      console.log(
        `GET ${path} (${who === mp ? 'MP' : 'Senior'}): ${ms.map((m) => m.toFixed(0)).join(', ')} ms`,
      );
      return ms[2]!;
    };

    const after = (
      await http().get('/api/v1/work/progress?groupBy=person').set(bearer(mp)).expect(200)
    ).body as ProgressView;
    const open = (v: ProgressView) => v.totals.notStarted + v.totals.inProgress;
    expect(open(after) - open(before)).toBe(5000);

    const medians: number[] = [];
    for (const groupBy of ['person', 'client', 'filing']) {
      medians.push(await time(mp, `/api/v1/work/progress?groupBy=${groupBy}`));
      medians.push(await time(sy, `/api/v1/work/progress?groupBy=${groupBy}`));
    }
    medians.push(await time(mp, '/api/v1/work/progress/items?limit=50'));
    medians.push(await time(sy, '/api/v1/work/progress/items?limit=50'));
    for (const m of medians) expect(m).toBeLessThan(300);
  });
});
