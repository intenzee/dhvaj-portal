import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';
import { TimeCloserScheduler } from '../src/modules/engagements/time/time-closer.scheduler';
import { AppConfigService } from '../src/config/config.module';

/**
 * Change 3 — automatic time, acceptance scenarios against Postgres with RLS on:
 * a task switch pauses the old task and closes its entry (task_switched); a
 * browser closed for 20 minutes ends the entry at the last heartbeat (idle)
 * while a recent heartbeat keeps it open; the office day-end closes entries
 * begun before the cut-off at the cut-off (day_end); sign-out closes the clock.
 */
describe('Automatic time (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let closer: TimeCloserScheduler;
  let dayEndHour: number;
  let mp: string;
  let pa: string;
  let sy: string;
  let seniorY: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const unique = (): string => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const employeeId = async (code: string): Promise<string> => {
    const r = await su.query<{ id: string }>(
      `SELECT id FROM hsdg.employees WHERE employee_code = $1`,
      [code],
    );
    return r.rows[0]!.id;
  };

  interface Entry {
    id: string;
    started_at: Date;
    ended_at: Date | null;
    last_heartbeat_at: Date | null;
    stopped_reason: string | null;
    duration_seconds: number | null;
    entry_kind: string;
    source: string;
  }
  const entriesOf = async (task: string): Promise<Entry[]> =>
    (
      await su.query<Entry>(
        `SELECT id, started_at, ended_at, last_heartbeat_at, stopped_reason, duration_seconds,
                entry_kind, source
           FROM hsdg.engagement_time_entries
          WHERE task_id = $1 AND adjusts_entry_id IS NULL
          ORDER BY started_at`,
        [task],
      )
    ).rows;
  const openEntryOf = async (task: string): Promise<Entry> => {
    const open = (await entriesOf(task)).filter((e) => e.ended_at === null);
    expect(open).toHaveLength(1);
    return open[0]!;
  };
  const statusOf = async (task: string): Promise<string> =>
    (await su.query<{ status: string }>(`SELECT status FROM hsdg.tasks WHERE id = $1`, [task]))
      .rows[0]!.status;
  const runningCountFor = async (employee: string): Promise<number> =>
    Number(
      (
        await su.query<{ n: string }>(
          `SELECT count(*) AS n FROM hsdg.engagement_time_entries
            WHERE employee_id = $1 AND ended_at IS NULL`,
          [employee],
        )
      ).rows[0]!.n,
    );
  const act = (t: string, eng: string, task: string, action: string) =>
    http().post(`/api/v1/engagements/${eng}/tasks/${task}/${action}`).set(bearer(t)).send({});

  /** A Compliance engagement (EP partner A, Senior Y on the team) with two tasks for Y. */
  const setup = async (): Promise<{ eng: string; a: string; b: string }> => {
    const entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    const created = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId,
        serviceId,
        financialYear: '2026-27',
        periodLabel: `AT${unique()}`,
        status: 'accepted',
      })
      .expect(201);
    const eng = created.body.id as string;
    // Automatic time runs on Compliance engagements only.
    expect((await http().get(`/api/v1/engagements/${eng}/tabs`).set(bearer(pa))).body.kind).toBe(
      'compliance',
    );
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(pa))
      .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
      .expect(201);
    const task = async (title: string): Promise<string> =>
      (
        await http()
          .post(`/api/v1/engagements/${eng}/tasks`)
          .set(bearer(pa))
          .send({ title, assignedToEmployeeId: seniorY })
          .expect(201)
      ).body.id as string;
    return { eng, a: await task('Prepare sales register'), b: await task('Reconcile 2B') };
  };

  beforeAll(async () => {
    // ff_auto_time must be on (unset already means 'all' outside production).
    process.env.FEATURE_FLAGS = 'all';
    await seedIdentityFixtures();
    app = await createTestApp();
    closer = app.get(TimeCloserScheduler);
    dayEndHour = app.get(AppConfigService).get('TIME_DAY_END_HOUR_IST');
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    sy = await token('senior.y@dhvaj.in');
    seniorY = await employeeId('EMP006');
    const flags = await http().get('/api/v1/meta/features').set(bearer(sy)).expect(200);
    expect(flags.body.flags.ff_auto_time).toBe(true);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('starting task B while task A runs pauses A and closes its entry with task_switched', async () => {
    const { eng, a, b } = await setup();

    await act(sy, eng, a, 'start').expect(201);
    expect(await statusOf(a)).toBe('in_progress');
    const runningA = await openEntryOf(a);
    expect(runningA).toMatchObject({ entry_kind: 'work', source: 'auto' });

    await act(sy, eng, b, 'start').expect(201);

    expect(await statusOf(a)).toBe('paused');
    const [closedA] = await entriesOf(a);
    expect(closedA!.id).toBe(runningA.id);
    expect(closedA!.ended_at).not.toBeNull();
    expect(closedA!.stopped_reason).toBe('task_switched');

    expect(await statusOf(b)).toBe('in_progress');
    expect(await openEntryOf(b)).toMatchObject({ entry_kind: 'work', source: 'auto' });
    // One running clock per person.
    expect(await runningCountFor(seniorY)).toBe(1);

    const clock = await http().get('/api/v1/time/clock').set(bearer(sy)).expect(200);
    expect(clock.body.running.taskId).toBe(b);
    // WF-205: the top-bar pill links to the running task, not just its engagement.
    const active = await http().get('/api/v1/engagements/time/active').set(bearer(sy)).expect(200);
    expect(active.body.entry.taskId).toBe(b);
    expect(active.body.link).toMatchObject({ engagementId: eng, taskId: b });

    await act(sy, eng, b, 'pause').expect(201);
    expect(await runningCountFor(seniorY)).toBe(0);
  });

  it('with the browser closed for 20 minutes the entry ends at the last heartbeat (idle)', async () => {
    const { eng, a } = await setup();

    await act(sy, eng, a, 'start').expect(201);
    const beat = await http().post('/api/v1/time/heartbeat').set(bearer(sy)).expect(200);
    expect(beat.body.running.taskId).toBe(a);
    const entry = await openEntryOf(a);
    // Y's earlier (closed) entries from other tests belong to yesterday, so this
    // entry is the latest one started — the "away and back" resume looks for that.
    await su.query(
      `UPDATE hsdg.engagement_time_entries
          SET started_at = started_at - interval '1 day', ended_at = ended_at - interval '1 day'
        WHERE employee_id = $1 AND id <> $2`,
      [seniorY, entry.id],
    );

    // A heartbeat inside the window (10 minutes ago) keeps the clock running.
    await su.query(
      `UPDATE hsdg.engagement_time_entries
          SET started_at = now() - interval '40 minutes',
              last_heartbeat_at = now() - interval '10 minutes'
        WHERE id = $1`,
      [entry.id],
    );
    // Run "at" today's IST midnight: the office day-end not reached, so only the
    // idle rule applies, whatever the clock says (CI after 20:00 IST closed it).
    const istToday = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const runAt = new Date(`${istToday}T00:00:00+05:30`);
    expect(await closer.run(runAt)).not.toBeNull();
    expect((await openEntryOf(a)).id).toBe(entry.id);
    expect(await statusOf(a)).toBe('in_progress');

    // Browser closed: the last heartbeat is now 21 minutes old.
    const hb = await su.query<{ last_heartbeat_at: Date; started_at: Date }>(
      `UPDATE hsdg.engagement_time_entries
          SET last_heartbeat_at = now() - interval '21 minutes'
        WHERE id = $1
        RETURNING last_heartbeat_at, started_at`,
      [entry.id],
    );
    const lastBeat = hb.rows[0]!.last_heartbeat_at;
    const res = await closer.run(runAt);
    expect(res).not.toBeNull();
    expect(res!.idle).toBeGreaterThanOrEqual(1);

    const [closed] = await entriesOf(a);
    expect(closed!.id).toBe(entry.id);
    expect(closed!.stopped_reason).toBe('idle');
    expect(closed!.ended_at!.toISOString()).toBe(lastBeat.toISOString());
    // 40 min ago → 21 min ago.
    expect(closed!.duration_seconds).toBe(19 * 60);
    expect(await statusOf(a)).toBe('paused');

    // On return: "You were away from <last heartbeat> — resume?"
    const clock = await http().get('/api/v1/time/clock').set(bearer(sy)).expect(200);
    expect(clock.body.running).toBeNull();
    expect(clock.body.resumable).toMatchObject({
      entryId: entry.id,
      taskId: a,
      stoppedReason: 'idle',
      awaySince: lastBeat.toISOString(),
    });
    // A late heartbeat does not reopen the closed entry.
    const late = await http().post('/api/v1/time/heartbeat').set(bearer(sy)).expect(200);
    expect(late.body.running).toBeNull();
    expect(await runningCountFor(seniorY)).toBe(0);

    // Resume = Start work again: a new entry, the closed one untouched.
    await act(sy, eng, a, 'start').expect(201);
    const entries = await entriesOf(a);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.stopped_reason).toBe('idle');
    await act(sy, eng, a, 'pause').expect(201);
  });

  it('closes entries begun before the office day-end at the cut-off (day_end), and on sign-out', async () => {
    const { eng, a, b } = await setup();
    // Yesterday in IST, so the cut-off is safely in the past whatever the clock says.
    const istYesterday = new Date(Date.now() + 330 * 60_000 - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const hh = String(dayEndHour).padStart(2, '0');
    const cutoff = new Date(`${istYesterday}T${hh}:00:00+05:30`);
    const runAt = new Date(`${istYesterday}T${hh}:30:00+05:30`);
    const startedAt = new Date(cutoff.getTime() - 2 * 3600_000);

    await act(sy, eng, a, 'start').expect(201);
    const entry = await openEntryOf(a);
    // Begun two hours before yesterday's cut-off; heartbeat fresh so idle stays out of it.
    await su.query(
      `UPDATE hsdg.engagement_time_entries
          SET started_at = $2, last_heartbeat_at = now()
        WHERE id = $1`,
      [entry.id, startedAt.toISOString()],
    );
    const res = await closer.run(runAt);
    expect(res).not.toBeNull();
    expect(res!.dayEnd).toBeGreaterThanOrEqual(1);

    const [closed] = await entriesOf(a);
    expect(closed!.stopped_reason).toBe('day_end');
    expect(closed!.ended_at!.toISOString()).toBe(cutoff.toISOString());
    expect(closed!.duration_seconds).toBe(2 * 3600);
    expect(await statusOf(a)).toBe('paused');

    // An entry begun after that cut-off is left running by the same pass.
    await act(sy, eng, b, 'start').expect(201);
    await closer.run(runAt);
    const runningB = await openEntryOf(b);

    // Sign-out closes the automatic clock and pauses the task.
    await http().post('/api/v1/time/sign-out').set(bearer(sy)).expect(200);
    const [signedOut] = await entriesOf(b);
    expect(signedOut!.id).toBe(runningB.id);
    expect(signedOut!.stopped_reason).toBe('signed_out');
    expect(signedOut!.ended_at).not.toBeNull();
    expect(await statusOf(b)).toBe('paused');
    expect(await runningCountFor(seniorY)).toBe(0);
  });
});
