import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import {
  WORKFLOW_MEASURE,
  type WorkflowBaselineInfo,
  type WorkflowMeasuresReport,
  type WorkflowTarget,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';

/**
 * Staff Workflow · How we measure it — POST /telemetry stores route changes and
 * row opens with no content, as the signed-in user; GET /telemetry/measures
 * rolls them up with the review, overdue, received → filed and unread numbers.
 */
describe('Telemetry (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let sy: string;
  let syUser: string;
  let mxUser: string;
  let north: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const session = (): string => `s${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const userOf = async (email: string): Promise<string> =>
    (await su.query<{ id: string }>(`SELECT id FROM hsdg.users WHERE email = $1`, [email])).rows[0]!
      .id;

  beforeAll(async () => {
    await seedIdentityFixtures();
    const { createTestApp } = await import('./create-test-app');
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    syUser = await userOf('senior.y@dhvaj.in');
    mxUser = await userOf('manager.x@dhvaj.in');
    north = (await su.query<{ id: string }>(`SELECT id FROM hsdg.offices WHERE code = 'NORTH'`))
      .rows[0]!.id;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('stores events as the caller, with ids and values stripped', async () => {
    const sid = session();
    await http()
      .post('/api/v1/telemetry')
      .set(bearer(sy))
      .send({
        events: [
          { kind: 'route', path: '/today', params: [], sessionId: sid },
          {
            kind: 'row_open',
            // A client that leaves an id in the path does not get it stored.
            path: '/engagements/7f1c2a9e-3b4d-4c5e-8f6a-0b1c2d3e4f5a',
            params: ['tab', 'part', 'm', 'tab'],
            source: 'today',
            sessionId: sid,
            at: '2001-01-01T00:00:00Z',
          },
        ],
      })
      .expect(204);
    const rows = (
      await su.query<{
        user_id: string;
        kind: string;
        path: string;
        params: string[];
        source: string | null;
        old: boolean;
      }>(
        `SELECT user_id, kind, path, params, source, occurred_at < now() - interval '1 day' AS old
           FROM hsdg.telemetry_events WHERE session_id = $1 ORDER BY id`,
        [sid],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === syUser)).toBe(true);
    expect(rows[1]).toMatchObject({
      kind: 'row_open',
      path: '/engagements/:id',
      params: ['m', 'part', 'tab'],
      source: 'today',
      // A time from the client's past is clamped to now.
      old: false,
    });
  });

  it('rejects content, oversize batches and anonymous callers', async () => {
    const sid = session();
    const ev = { kind: 'route', path: '/today', params: [], sessionId: sid };
    await http()
      .post('/api/v1/telemetry')
      .set(bearer(sy))
      .send({ events: [{ ...ev, params: ['q=bharat gstr1'] }] })
      .expect(400);
    await http()
      .post('/api/v1/telemetry')
      .set(bearer(sy))
      .send({ events: [{ ...ev, path: 'https://example.com/x' }] })
      .expect(400);
    await http()
      .post('/api/v1/telemetry')
      .set(bearer(sy))
      .send({ events: Array.from({ length: 51 }, () => ev) })
      .expect(400);
    await http()
      .post('/api/v1/telemetry')
      .send({ events: [ev] })
      .expect(401);
  });

  it('the measures report needs report.read', async () => {
    await http().get('/api/v1/telemetry/measures').set(bearer(sy)).expect(403);
    await http()
      .get('/api/v1/telemetry/measures?from=2026-10-10&to=2026-10-01')
      .set(bearer(mp))
      .expect(400);
    const res = (await http().get('/api/v1/telemetry/measures').set(bearer(mp)).expect(200))
      .body as WorkflowMeasuresReport;
    expect(res.measures.map((m) => m.key)).toEqual(Object.values(WORKFLOW_MEASURE));
  });

  it('measures steps to the first filing and the exact-link share', async () => {
    // A quiet window of our own, in the past.
    const day = '2020-03-02';
    await su.query(
      `DELETE FROM hsdg.telemetry_events
        WHERE occurred_at >= '2020-02-01' AND occurred_at < '2020-04-01'`,
    );
    const at = (min: number) => `${day}T10:${String(min).padStart(2, '0')}:00+05:30`;
    const ins = (
      user: string,
      sid: string,
      kind: string,
      path: string,
      params: string[],
      min: number,
    ) =>
      su.query(
        `INSERT INTO hsdg.telemetry_events (user_id, session_id, kind, path, params, source, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user, sid, kind, path, params, kind === 'row_open' ? 'today' : null, at(min)],
      );
    // Manager X (North): sign-in redirects to /today (not a step), a filing → 1 step.
    await ins(mxUser, 'sessNorth01', 'route', '/', ['landing'], 0);
    await ins(mxUser, 'sessNorth01', 'redirect', '/today', [], 0);
    await ins(mxUser, 'sessNorth01', 'row_open', '/engagements/:id', ['m', 'part', 'tab'], 1);
    await ins(mxUser, 'sessNorth01', 'route', '/engagements/:id', ['m', 'part', 'tab'], 1);
    // Senior Y (South): /today → /engagements (Overview) → the GST tab, whose
    // month the app fills in (not a step) → the section → 3 steps…
    await ins(syUser, 'sessSouth001', 'route', '/today', [], 0);
    await ins(syUser, 'sessSouth001', 'row_open', '/engagements/:id', [], 1);
    await ins(syUser, 'sessSouth001', 'route', '/engagements/:id', [], 1);
    await ins(syUser, 'sessSouth001', 'route', '/engagements/:id', ['tab'], 2);
    await ins(syUser, 'sessSouth001', 'redirect', '/engagements/:id', ['m', 'tab'], 2);
    await ins(syUser, 'sessSouth001', 'route', '/engagements/:id', ['m', 'part', 'tab'], 3);
    // …and a session that never reaches a filing.
    await ins(syUser, 'sessSouth002', 'route', '/notifications', [], 5);

    const measure = async (qs: string) => {
      const r = (
        await http()
          .get(`/api/v1/telemetry/measures?from=${day}&to=${day}${qs}`)
          .set(bearer(mp))
          .expect(200)
      ).body as WorkflowMeasuresReport;
      return Object.fromEntries(r.measures.map((m) => [m.key, m]));
    };
    const all = await measure('');
    expect(all[WORKFLOW_MEASURE.stepsToFirstAction]).toMatchObject({ value: 2, sample: 2 });
    expect(all[WORKFLOW_MEASURE.exactLinkShare]).toMatchObject({
      value: 50,
      sample: 2,
      onTrack: false,
      targetLabel: '≥ 90%',
    });
    // Nothing before it to compare with.
    expect(all[WORKFLOW_MEASURE.stepsToFirstAction]!.previous).toBeNull();

    const n = await measure(`&officeId=${north}`);
    expect(n[WORKFLOW_MEASURE.stepsToFirstAction]).toMatchObject({
      value: 1,
      sample: 1,
      onTrack: true,
    });
    expect(n[WORKFLOW_MEASURE.exactLinkShare]).toMatchObject({ value: 100, sample: 1 });
  });

  it('partners save a baseline and set targets; the report compares with them', async () => {
    const day = '2020-03-02';
    const pa = await token('partner.a@dhvaj.in');
    const mx = await token('manager.x@dhvaj.in');
    const body = { from: day, to: day };
    // Saving and setting need workflow.manage; reading the targets, report.read.
    await http().post('/api/v1/telemetry/baselines').set(bearer(mx)).send(body).expect(403);
    await http().post('/api/v1/telemetry/baselines').set(bearer(sy)).send(body).expect(403);
    await http()
      .put('/api/v1/telemetry/targets')
      .set(bearer(mx))
      .send({ items: [{ key: 'steps_to_first_action', rule: 'at_most', value: 1 }] })
      .expect(403);
    await http().get('/api/v1/telemetry/targets').set(bearer(sy)).expect(403);
    // A window still to come cannot be a baseline.
    await http()
      .post('/api/v1/telemetry/baselines')
      .set(bearer(pa))
      .send({ from: day, to: '2999-01-01' })
      .expect(400);

    // A partner (North) sees North's people, so baselines North only.
    await http().post('/api/v1/telemetry/baselines').set(bearer(pa)).send(body).expect(403);
    const south = (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.offices WHERE code = 'SOUTH'`)
    ).rows[0]!.id;
    await http()
      .post('/api/v1/telemetry/baselines')
      .set(bearer(pa))
      .send({ ...body, officeId: south })
      .expect(403);
    const ownNorth = (
      await http()
        .post('/api/v1/telemetry/baselines')
        .set(bearer(pa))
        .send({ ...body, officeId: north })
        .expect(201)
    ).body as WorkflowBaselineInfo;
    expect(ownNorth).toMatchObject({ officeId: north });

    const saved = (
      await http().post('/api/v1/telemetry/baselines').set(bearer(mp)).send(body).expect(201)
    ).body as WorkflowBaselineInfo;
    expect(saved).toMatchObject({ from: day, to: day, officeId: null });
    expect(saved.savedBy).toBeTruthy();
    const frozen = (
      await su.query<{ measures: Record<string, number | null> }>(
        `SELECT measures FROM hsdg.workflow_baselines WHERE id = $1`,
        [saved.id],
      )
    ).rows[0]!.measures;
    expect(frozen).toMatchObject({ steps_to_first_action: 2, exact_link_share: 50 });
    const audited = await su.query(
      `SELECT 1 FROM hsdg.audit_events WHERE action = 'workflow.baseline_saved' AND object_id = $1`,
      [saved.id],
    );
    expect(audited.rowCount).toBe(1);

    const report = async (): Promise<WorkflowMeasuresReport> =>
      (
        await http()
          .get(`/api/v1/telemetry/measures?from=${day}&to=${day}`)
          .set(bearer(mp))
          .expect(200)
      ).body as WorkflowMeasuresReport;
    const byKey = (r: WorkflowMeasuresReport) =>
      Object.fromEntries(r.measures.map((m) => [m.key, m]));
    let r = await report();
    expect(r.baseline).toMatchObject({ id: saved.id, from: day, to: day });
    expect(byKey(r)[WORKFLOW_MEASURE.stepsToFirstAction]).toMatchObject({
      value: 2,
      baseline: 2,
      vsBaseline: 0,
      targetLabel: '≤ 2 steps',
      onTrack: true,
    });
    // North's baseline is its own scope.
    const n = (
      await http()
        .get(`/api/v1/telemetry/measures?from=${day}&to=${day}&officeId=${north}`)
        .set(bearer(mp))
        .expect(200)
    ).body as WorkflowMeasuresReport;
    expect(n.baseline).toMatchObject({ id: ownNorth.id, officeId: north });
    expect(byKey(n)[WORKFLOW_MEASURE.stepsToFirstAction]).toMatchObject({
      value: 1,
      baseline: 1,
    });

    const before = (await http().get('/api/v1/telemetry/targets').set(bearer(mx)).expect(200))
      .body as WorkflowTarget[];
    expect(before.map((t) => t.key)).toEqual(Object.values(WORKFLOW_MEASURE));
    try {
      // Bad rules and values are refused.
      for (const item of [
        { key: 'steps_to_first_action', rule: 'about', value: 1 },
        { key: 'nope', rule: 'at_most', value: 1 },
        { key: 'steps_to_first_action', rule: 'at_most', value: -1 },
        { key: 'review_wait', rule: 'change_by', value: -101 },
      ])
        await http()
          .put('/api/v1/telemetry/targets')
          .set(bearer(pa))
          .send({ items: [item] })
          .expect(400);
      const after = (
        await http()
          .put('/api/v1/telemetry/targets')
          .set(bearer(mp))
          .send({
            items: [
              { key: 'steps_to_first_action', rule: 'at_most', value: 1 },
              { key: 'exact_link_share', rule: 'change_by', value: -10 },
            ],
          })
          .expect(200)
      ).body as WorkflowTarget[];
      expect(after.find((t) => t.key === 'review_wait')).toEqual(
        before.find((t) => t.key === 'review_wait'),
      );
      r = await report();
      expect(byKey(r)[WORKFLOW_MEASURE.stepsToFirstAction]).toMatchObject({
        targetLabel: '≤ 1 step',
        onTrack: false,
      });
      // −10% on a baseline of 50%: 50% is no cut.
      expect(byKey(r)[WORKFLOW_MEASURE.exactLinkShare]).toMatchObject({
        targetLabel: '−10% on the baseline',
        onTrack: false,
      });
      const log = await su.query<{ before_state: unknown; after_state: unknown }>(
        `SELECT before_state, after_state FROM hsdg.audit_events
          WHERE action = 'workflow.targets_updated' ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(log.rows[0]!.after_state).toMatchObject({
        targets: [
          { key: 'steps_to_first_action', rule: 'at_most', value: 1 },
          { key: 'exact_link_share', rule: 'change_by', value: -10 },
        ],
      });
    } finally {
      await http().put('/api/v1/telemetry/targets').set(bearer(mp)).send({ items: before });
    }
  });
});
