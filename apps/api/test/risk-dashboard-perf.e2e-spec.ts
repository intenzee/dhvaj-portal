import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { RiskDashboard } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * PS-301 "Done when": the partner sees every risk tile fast. With 2,000 open
 * items (1,000 filings past their statutory date, 1,000 due this week and not
 * started) on one engagement, the median of five warm reads of
 * GET /dashboard/risk as the Managing Partner stays under 500 ms, and both
 * tiles count every item.
 */
describe('Risk dashboard under load (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let engagementId: string | undefined;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
  });

  afterAll(async () => {
    if (engagementId) {
      await su.query(
        `DELETE FROM hsdg.tasks WHERE source_compliance_instance_id IN
           (SELECT id FROM hsdg.compliance_instances WHERE engagement_id = $1)`,
        [engagementId],
      );
      await su.query(`DELETE FROM hsdg.compliance_instances WHERE engagement_id = $1`, [
        engagementId,
      ]);
    }
    await su?.end();
    await app?.close();
  });

  it('answers in under 500 ms with 2,000 items at risk', async () => {
    const first = async (path: string): Promise<string> =>
      (await http().get(path).set(bearer(mp))).body.items[0].id as string;
    const entityId = await freshClient(await first('/api/v1/entities?search=Bharat&limit=100'));
    const serviceId = await first('/api/v1/services?search=GST_MONTHLY&limit=100');
    engagementId = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `RISKPERF${Date.now()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;

    const read = async (): Promise<{ ms: number; body: RiskDashboard }> => {
      const t0 = performance.now();
      const res = await http().get('/api/v1/dashboard/risk').set(bearer(mp)).expect(200);
      return { ms: performance.now() - t0, body: res.body as RiskDashboard };
    };
    const count = (d: RiskDashboard, key: string): number =>
      d.tiles.find((t) => t.key === key)!.count;
    const baseline = (await read()).body;

    await su.query(
      `INSERT INTO hsdg.compliance_instances
         (engagement_id, compliance_rule_id, compliance_rule_version_id, reference_date,
          statutory_deadline, internal_sla_date, status, workflow_status, form_label)
       SELECT $1, r.id, v.id, DATE '2000-01-01' + g,
              CASE WHEN g <= 1000 THEN current_date - 1 - (g % 300) ELSE current_date + (g % 7) END,
              current_date, 'open',
              CASE WHEN g <= 1000 THEN 'in_preparation' ELSE 'not_started' END,
              'Perf filing ' || g
         FROM generate_series(1, 2000) g,
              (SELECT r.id FROM hsdg.compliance_rules r WHERE r.code = 'GST_GSTR1_M') r,
              LATERAL (SELECT v.id FROM hsdg.compliance_rule_versions v
                        WHERE v.compliance_rule_id = r.id LIMIT 1) v`,
      [engagementId],
    );
    await su.query('ANALYZE hsdg.compliance_instances, hsdg.tasks');

    await read(); // warm the plan cache and the pool
    const runs = [];
    for (let i = 0; i < 5; i += 1) runs.push(await read());
    const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
    console.log(
      `GET /dashboard/risk with 2,000 items: ${ms.map((m) => m.toFixed(0)).join(', ')} ms`,
    );

    // Each tile on its own, as the web loads them: which one costs what.
    const each: string[] = [];
    for (const t of runs[0]!.body.tiles) {
      const t0 = performance.now();
      await http().get(`/api/v1/dashboard/risk/${t.key}`).set(bearer(mp)).expect(200);
      each.push(`${t.key} ${(performance.now() - t0).toFixed(0)}`);
    }
    console.log(`Each tile (ms): ${each.join(', ')}`);

    const d = runs[0]!.body;
    expect(count(d, 'missed') - count(baseline, 'missed')).toBe(1000);
    expect(count(d, 'due_unready') - count(baseline, 'due_unready')).toBe(1000);
    for (const t of d.tiles) expect(t.items.length).toBeLessThanOrEqual(10);
    expect(ms[2]!).toBeLessThan(500);
  });
});
