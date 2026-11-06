import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  AttendanceRegister,
  LeaveApprovals,
  LeaveRequest,
  MyDay,
  MyLeave,
  PickEngagement,
  PickTask,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * Attendance: Senior Y logs the day — 5h of a client's work at the client's
 * office, 3h of training at the office — and the day is Present; trimmed to
 * 5h it is a Half day. Rows older than 3 days stay as they are. Senior Y now
 * reports to Manager X, who reports to Partner A: X approves Y's leave, A
 * sees both in Team attendance, HR has the firm's register and its CSV.
 */
describe('Attendance (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let pa: string;
  let mx: string;
  let sy: string;
  let hr: string;
  let seniorY: string;
  let managerX: string;
  let yReportedTo: string | null;
  let eng: string;
  let task: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;

  const IST = 330 * 60_000;
  const istDay = (offsetDays = 0): string =>
    new Date(Date.now() + IST + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const isSunday = (d: string): boolean => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
  /** The latest day 1–3 back that is not a Sunday: logged, and over. */
  const past = (): string => [1, 2, 3].map((n) => istDay(-n)).find((d) => !isSunday(d))!;
  /** A working day a fortnight or more ahead. */
  const ahead = (from = 14): string => {
    for (let n = from; ; n++) if (!isSunday(istDay(n))) return istDay(n);
  };
  const H = 3600;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    [mp, pa, mx, sy, hr] = await Promise.all([
      token('mp@dhvaj.in'),
      token('partner.a@dhvaj.in'),
      token('manager.x@dhvaj.in'),
      token('senior.y@dhvaj.in'),
      token('hr@dhvaj.in'),
    ]);
    seniorY = await employeeId('EMP006');
    managerX = await employeeId('EMP005');
    yReportedTo = (
      await su.query<{ r: string | null }>(
        `SELECT reports_to_id AS r FROM hsdg.employees WHERE id = $1`,
        [seniorY],
      )
    ).rows[0]!.r;
    await su.query(`UPDATE hsdg.employees SET reports_to_id = $2 WHERE id = $1`, [
      seniorY,
      managerX,
    ]);
    // A clean slate for Y's recent days (the suite never truncates).
    await su.query(`DELETE FROM hsdg.internal_time_entries WHERE employee_id = $1`, [seniorY]);
    await su.query(`DELETE FROM hsdg.leave_requests WHERE employee_id = $1`, [seniorY]);
    await su.query(
      `DELETE FROM hsdg.engagement_time_entries te
        WHERE te.employee_id = $1 AND te.started_at > now() - interval '10 days'
          AND NOT EXISTS (SELECT 1 FROM hsdg.time_billings tb WHERE tb.time_entry_id = te.id)
          AND NOT EXISTS (SELECT 1 FROM hsdg.engagement_time_entries a WHERE a.adjusts_entry_id = te.id)`,
      [seniorY],
    );
    await su.query(`DELETE FROM hsdg.firm_holidays WHERE name LIKE 'E2E %'`);

    const entityId = await freshClient(
      (await http().get('/api/v1/entities?search=Bharat&limit=100').set(bearer(mp))).body.items[0]
        .id as string,
    );
    const serviceId = (
      await http().get('/api/v1/services?search=ITR_FILING&limit=100').set(bearer(mp))
    ).body.items[0].id as string;
    eng = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId,
          serviceId,
          financialYear: '2026-27',
          periodLabel: `ATT${Date.now()}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/v1/engagements/${eng}/team`)
      .set(bearer(mp))
      .send({ employeeId: seniorY, roleOnEngagement: 'in_charge' })
      .expect(201);
    task = (
      await http()
        .post(`/api/v1/engagements/${eng}/tasks`)
        .set(bearer(pa))
        .send({ title: 'File the ITR', assignedToEmployeeId: seniorY })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    if (su) {
      await su.query(`UPDATE hsdg.employees SET reports_to_id = $2 WHERE id = $1`, [
        seniorY,
        yReportedTo,
      ]);
      await su.query(`DELETE FROM hsdg.firm_holidays WHERE name LIKE 'E2E %'`);
      await su.end();
    }
    await app?.close();
  });

  let workRow: string;
  let internalRow: string;

  it('lists the engagements and tasks you can log on', async () => {
    const engs = (
      await http().get('/api/v1/attendance/pick/engagements').set(bearer(sy)).expect(200)
    ).body as PickEngagement[];
    expect(engs.map((e) => e.engagementId)).toContain(eng);
    const tasks = (
      await http()
        .get(`/api/v1/attendance/pick/tasks?engagementId=${eng}`)
        .set(bearer(sy))
        .expect(200)
    ).body as PickTask[];
    expect(tasks.find((t) => t.id === task)).toMatchObject({ mine: true });
  });

  it('5h of client work and 3h of training make the day Present', async () => {
    const day = past();
    let d = (
      await http()
        .post(`/api/v1/attendance/day/${day}/work`)
        .set(bearer(sy))
        .send({
          engagementId: eng,
          taskId: task,
          minutes: 300,
          location: 'client_office',
          note: 'ITR',
        })
        .expect(200)
    ).body as MyDay;
    expect(d).toMatchObject({ status: 'half_day', workedSeconds: 5 * H });
    workRow = d.entries.find((e) => e.source === 'logged')!.id;
    expect(d.entries[0]).toMatchObject({
      taskTitle: 'File the ITR',
      location: 'client_office',
      editable: true,
    });

    d = (
      await http()
        .post(`/api/v1/attendance/day/${day}/internal`)
        .set(bearer(sy))
        .send({ category: 'training', minutes: 180, location: 'office' })
        .expect(200)
    ).body as MyDay;
    internalRow = d.entries.find((e) => e.source === 'internal')!.id;
    expect(d).toMatchObject({ status: 'present', workedSeconds: 8 * H });
    expect(d.byLocation).toEqual({ client_office: 5 * H, office: 3 * H });

    // The time is on the task too: it counts toward what the filing took.
    const { rows } = await su.query<{ s: number }>(
      `SELECT sum(duration_seconds)::int AS s FROM hsdg.engagement_time_entries WHERE task_id = $1`,
      [task],
    );
    expect(rows[0]!.s).toBe(5 * H);
  });

  it('a row trimmed to 2h makes it a Half day; taking training out leaves it Absent', async () => {
    let d = (
      await http()
        .patch(`/api/v1/attendance/entries/${workRow}`)
        .set(bearer(sy))
        .send({ minutes: 120 })
        .expect(200)
    ).body as MyDay;
    expect(d).toMatchObject({ status: 'half_day', workedSeconds: 5 * H });
    d = (
      await http().delete(`/api/v1/attendance/entries/${internalRow}`).set(bearer(sy)).expect(200)
    ).body as MyDay;
    expect(d).toMatchObject({ status: 'absent', workedSeconds: 2 * H });
  });

  it('keeps to today and the last 3 days, and to 16 hours a day', async () => {
    await http()
      .post(`/api/v1/attendance/day/${istDay(-5)}/internal`)
      .set(bearer(sy))
      .send({ category: 'admin', minutes: 60, location: 'home' })
      .expect(400);
    await http()
      .post(`/api/v1/attendance/day/${istDay(2)}/internal`)
      .set(bearer(sy))
      .send({ category: 'admin', minutes: 60, location: 'home' })
      .expect(400);
    await http()
      .post(`/api/v1/attendance/day/${past()}/internal`)
      .set(bearer(sy))
      .send({ category: 'admin', minutes: 720, location: 'home' })
      .expect(200);
    await http()
      .post(`/api/v1/attendance/day/${past()}/internal`)
      .set(bearer(sy))
      .send({ category: 'admin', minutes: 180, location: 'home' })
      .expect(400);
    // Someone else's row is not yours to change.
    await http()
      .patch(`/api/v1/attendance/entries/${workRow}`)
      .set(bearer(mx))
      .send({ minutes: 60 })
      .expect(404);
  });

  it('"I worked from home" places a task clock’s rows', async () => {
    await http()
      .post(`/api/v1/engagements/${eng}/tasks/${task}/start`)
      .set(bearer(sy))
      .send({})
      .expect(201);
    await http()
      .post(`/api/v1/engagements/${eng}/tasks/${task}/pause`)
      .set(bearer(sy))
      .send({})
      .expect(201);
    const today = istDay();
    let d = (await http().get(`/api/v1/attendance/day/${today}`).set(bearer(sy)).expect(200))
      .body as MyDay;
    const clock = d.entries.find((e) => e.source === 'task_clock')!;
    expect(clock).toMatchObject({ location: null, editable: false, locationOnly: true });
    d = (
      await http()
        .post(`/api/v1/attendance/day/${today}/location`)
        .set(bearer(sy))
        .send({ location: 'home' })
        .expect(200)
    ).body as MyDay;
    expect(d.entries.find((e) => e.id === clock.id)!.location).toBe('home');
    // A task clock's time is not typed over here.
    await http()
      .patch(`/api/v1/attendance/entries/${clock.id}`)
      .set(bearer(sy))
      .send({ minutes: 60 })
      .expect(400);
    await http().delete(`/api/v1/attendance/entries/${clock.id}`).set(bearer(sy)).expect(400);
  });

  let leave: LeaveRequest;

  it('Y asks for leave; Manager X is told, approves it, and Y is told', async () => {
    const day = ahead();
    leave = (
      await http()
        .post('/api/v1/attendance/leave')
        .set(bearer(sy))
        .send({ type: 'casual', fromDay: day, toDay: day, reason: 'Family function' })
        .expect(201)
    ).body as LeaveRequest;
    expect(leave).toMatchObject({
      status: 'pending',
      days: 1,
      approverName: 'Manager X',
      canDecide: false,
    });

    await http()
      .post('/api/v1/attendance/leave')
      .set(bearer(sy))
      .send({ type: 'sick', fromDay: day, toDay: day, half: 'first_half', reason: 'Again' })
      .expect(409);

    const told = await su.query(
      `SELECT 1 FROM hsdg.notifications n JOIN hsdg.employees e ON e.user_id = n.recipient_user_id
        WHERE n.type = 'leave_requested' AND n.object_id = $1 AND e.id = $2 AND n.status = 'unread'`,
      [leave.id, managerX],
    );
    expect(told.rowCount).toBe(1);

    await http()
      .post(`/api/v1/attendance/leave/${leave.id}/decide`)
      .set(bearer(sy))
      .send({ approve: true })
      .expect(403);
    await http()
      .post(`/api/v1/attendance/leave/${leave.id}/decide`)
      .set(bearer(pa))
      .send({ approve: true })
      .expect(403);

    const waiting = (
      await http().get('/api/v1/attendance/leave/approvals').set(bearer(mx)).expect(200)
    ).body as LeaveApprovals;
    expect(waiting.pending.find((l) => l.id === leave.id)).toMatchObject({ canDecide: true });

    const decided = (
      await http()
        .post(`/api/v1/attendance/leave/${leave.id}/decide`)
        .set(bearer(mx))
        .send({ approve: true, note: 'Enjoy' })
        .expect(200)
    ).body as LeaveRequest;
    expect(decided).toMatchObject({ status: 'approved', decidedByName: 'Manager X' });

    const resolved = await su.query(
      `SELECT 1 FROM hsdg.notifications WHERE type = 'leave_requested' AND object_id = $1 AND status = 'unread'`,
      [leave.id],
    );
    expect(resolved.rowCount).toBe(0);
    const toY = await su.query(
      `SELECT 1 FROM hsdg.notifications n JOIN hsdg.employees e ON e.user_id = n.recipient_user_id
        WHERE n.type = 'leave_decided' AND n.object_id = $1 AND e.id = $2`,
      [leave.id, seniorY],
    );
    expect(toY.rowCount).toBe(1);

    const mine = (
      await http()
        .get(`/api/v1/attendance/leave?year=${day.slice(0, 4)}`)
        .set(bearer(sy))
        .expect(200)
    ).body as MyLeave;
    expect(mine.approverName).toBe('Manager X');
    expect(mine.balances.find((b) => b.type === 'casual')).toMatchObject({
      allowance: 12,
      taken: 1,
      left: 11,
    });
  });

  it('a half day of leave and 4 hours of work make the day Present', async () => {
    const day = past();
    const half = (
      await http()
        .post('/api/v1/attendance/leave')
        .set(bearer(sy))
        .send({ type: 'casual', fromDay: day, toDay: day, half: 'second_half', reason: 'Doctor' })
        .expect(201)
    ).body as LeaveRequest;
    expect(half.days).toBe(0.5);
    await http()
      .post(`/api/v1/attendance/leave/${half.id}/decide`)
      .set(bearer(mx))
      .send({ approve: true })
      .expect(200);
    // 2h logged + 12h admin earlier; take the admin out to leave 2h, then add 2h.
    let d = (await http().get(`/api/v1/attendance/day/${day}`).set(bearer(sy)).expect(200))
      .body as MyDay;
    for (const e of d.entries.filter((x) => x.source === 'internal')) {
      await http().delete(`/api/v1/attendance/entries/${e.id}`).set(bearer(sy)).expect(200);
    }
    d = (await http().get(`/api/v1/attendance/day/${day}`).set(bearer(sy)).expect(200))
      .body as MyDay;
    expect(d).toMatchObject({
      status: 'half_day',
      workedSeconds: 2 * H,
      leave: { half: 'second_half' },
    });
    d = (
      await http()
        .post(`/api/v1/attendance/day/${day}/internal`)
        .set(bearer(sy))
        .send({ category: 'internal_meeting', minutes: 120, location: 'office' })
        .expect(200)
    ).body as MyDay;
    expect(d.status).toBe('present');
  });

  it('Partner A sees the team: Manager X and Senior Y below them', async () => {
    const month = past().slice(0, 7);
    const team = (await http().get(`/api/v1/attendance/team/${month}`).set(bearer(pa)).expect(200))
      .body as AttendanceRegister;
    const names = team.people.map((p) => p.employeeName);
    expect(names).toEqual(expect.arrayContaining(['Manager X', 'Senior Y']));
    const y = team.people.find((p) => p.employeeId === seniorY)!;
    expect(y.days.find((d) => d.day === past())!.status).toBe('present');

    const yDay = (
      await http()
        .get(`/api/v1/attendance/people/${seniorY}/day/${past()}`)
        .set(bearer(pa))
        .expect(200)
    ).body as MyDay;
    expect(yDay).toMatchObject({ employeeName: 'Senior Y', editable: false });
    // Y does not see the manager's days.
    await http()
      .get(`/api/v1/attendance/people/${managerX}/day/${past()}`)
      .set(bearer(sy))
      .expect(404);
  });

  it('HR has the firm’s register and its CSV; others do not', async () => {
    const month = past().slice(0, 7);
    const reg = (
      await http().get(`/api/v1/attendance/register/${month}`).set(bearer(hr)).expect(200)
    ).body as AttendanceRegister;
    expect(
      reg.people.find((p) => p.employeeId === seniorY)!.summary.present,
    ).toBeGreaterThanOrEqual(1);
    const csv = await http()
      .get(`/api/v1/attendance/register/${month}/export`)
      .set(bearer(hr))
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('EMP006');
    expect(csv.text).toContain('Payable days');
    await http().get(`/api/v1/attendance/register/${month}`).set(bearer(sy)).expect(403);
    await http().get(`/api/v1/attendance/register/${month}/leave`).set(bearer(hr)).expect(200);
  });

  it('HR keeps the holidays and the settings', async () => {
    const day = ahead(40);
    await http()
      .post('/api/v1/attendance/holidays')
      .set(bearer(sy))
      .send({ day, name: 'E2E Fest' })
      .expect(403);
    const h = (
      await http()
        .post('/api/v1/attendance/holidays')
        .set(bearer(hr))
        .send({ day, name: 'E2E Fest' })
        .expect(201)
    ).body as { id: string };
    await http()
      .post('/api/v1/attendance/holidays')
      .set(bearer(hr))
      .send({ day, name: 'E2E Fest' })
      .expect(409);
    const month = (
      await http()
        .get(`/api/v1/attendance/month/${day.slice(0, 7)}`)
        .set(bearer(sy))
        .expect(200)
    ).body as { person: { days: { day: string; status: string }[] } };
    expect(month.person.days.find((d) => d.day === day)!.status).toBe('holiday');
    await http().delete(`/api/v1/attendance/holidays/${h.id}`).set(bearer(hr)).expect(204);

    await http()
      .put('/api/v1/attendance/settings')
      .set(bearer(sy))
      .send({ presentMinutes: 420, halfDayMinutes: 210, allowances: {} })
      .expect(403);
    const s = (await http().get('/api/v1/attendance/settings').set(bearer(sy)).expect(200)).body;
    expect(s).toMatchObject({ presentMinutes: 480, halfDayMinutes: 240 });
  });

  it('Y can withdraw approved leave before it starts', async () => {
    const out = (
      await http().post(`/api/v1/attendance/leave/${leave.id}/cancel`).set(bearer(sy)).expect(200)
    ).body as LeaveRequest;
    expect(out.status).toBe('cancelled');
  });

  it('the calendar row carries the filer and the hours', async () => {
    const res = await http().get('/api/v1/compliance/calendar').set(bearer(mp)).expect(200);
    for (const row of res.body.items as { filedByName: unknown; timeSeconds: unknown }[]) {
      expect(typeof row.timeSeconds).toBe('number');
      expect(row).toHaveProperty('filedByName');
    }
  });
});
