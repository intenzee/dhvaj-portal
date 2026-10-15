import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { FeatureRollout, FeatureRolloutList } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';

/**
 * Staff Workflow · Rollout: the managing partner pilots a phase in one office,
 * then every office, or pauses it — from Admin → Rollout, no deploy. People's
 * flags (and the API behind them) follow at once; the deploy's FEATURE_FLAGS
 * stays the master switch. Rows are removed afterwards for the suites that follow.
 */
describe('Feature rollouts (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let mx: string;
  let sy: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const flagsOf = async (t: string): Promise<Record<string, boolean>> =>
    (await http().get('/api/v1/meta/features').set(bearer(t)).expect(200)).body.flags;
  const put = (body: object, flag = 'ff_today_view') =>
    http().put(`/api/v1/feature-rollouts/${flag}`).set(bearer(mp)).send(body);

  beforeAll(async () => {
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    await su.query(`DELETE FROM hsdg.feature_rollouts`);
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    mx = await token('manager.x@dhvaj.in'); // NORTH
    sy = await token('senior.y@dhvaj.in'); // SOUTH
  });

  afterAll(async () => {
    await su?.query(`DELETE FROM hsdg.feature_rollouts`);
    await su?.end();
    await app?.close();
  });

  it('lists every phase flag; only those who administer the firm may', async () => {
    await http().get('/api/v1/feature-rollouts').set(bearer(pa)).expect(403);
    const list = (await http().get('/api/v1/feature-rollouts').set(bearer(mp)).expect(200))
      .body as FeatureRolloutList;
    expect(list.items.find((i) => i.flag === 'ff_today_view')).toMatchObject({
      label: expect.stringContaining('Today'),
      deployed: true,
      mode: null,
      liveIn: 'all',
      version: 0,
    });
    await put({ mode: 'firm', version: 0 }, 'ff_nope').expect(404);
    await http()
      .put('/api/v1/feature-rollouts/ff_today_view')
      .set(bearer(pa))
      .send({ mode: 'off', version: 0 })
      .expect(403);
  });

  it('pilots Today in one office, then every office, then pauses it — people follow at once', async () => {
    await put({ mode: 'offices', officeCodes: [], version: 0 }).expect(400);
    await put({ mode: 'offices', officeCodes: ['WEST'], version: 0 }).expect(400);

    const pilot = (
      await put({
        mode: 'offices',
        officeCodes: ['north'],
        note: 'Pilot with the North GST team',
        version: 0,
      }).expect(200)
    ).body as FeatureRollout;
    expect(pilot).toMatchObject({
      mode: 'offices',
      officeCodes: ['NORTH'],
      liveIn: ['NORTH'],
      version: 1,
      updatedByName: 'Managing Partner',
    });
    expect((await flagsOf(mx)).ff_today_view).toBe(true);
    expect((await flagsOf(sy)).ff_today_view).toBe(false);
    await http().get('/api/v1/work/today').set(bearer(sy)).expect(404);
    await http().get('/api/v1/work/today').set(bearer(mx)).expect(200);

    // A stale version is refused.
    await put({ mode: 'firm', version: 0 }).expect(409);
    await put({ mode: 'firm', version: 1 }).expect(200);
    expect((await flagsOf(sy)).ff_today_view).toBe(true);

    const paused = (await put({ mode: 'off', version: 2 }).expect(200)).body as FeatureRollout;
    expect(paused.liveIn).toEqual([]);
    expect((await flagsOf(mx)).ff_today_view).toBe(false);

    const audit = await su.query<{ action: string; after_state: Record<string, unknown> }>(
      `SELECT action, after_state FROM hsdg.audit_events
        WHERE object_type = 'feature_rollout' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'feature_rollout.updated',
      after_state: { flag: 'ff_today_view', mode: 'off', officeCodes: [] },
    });

    // Back to the deploy's own setting.
    const reset = (
      await http().delete('/api/v1/feature-rollouts/ff_today_view').set(bearer(mp)).expect(200)
    ).body as FeatureRollout;
    expect(reset).toMatchObject({ mode: null, liveIn: 'all', version: 0 });
    expect((await flagsOf(sy)).ff_today_view).toBe(true);
  });
});
