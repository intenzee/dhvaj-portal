import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type {
  Paginated,
  ProgressItem,
  ProgressRow,
  ProgressView,
  TaskTimeline,
} from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * D-1 — the Progress tracker. The Managing Partner sees the firm, a Senior
 * only themselves and their Articles, an Article their own; every row's counts
 * match its drill-down; cancelled work is left out; the timeline tells who did
 * what.
 *
 *   Partner P ← Manager M ← Senior S ← Article A;  Outsider O (no one above)
 *
 *   E1, team S, A, O. All due in Feb 2019 (open = overdue):
 *     A: todo, in_progress, blocked, done, cancelled (given by S)
 *     S: in_review    O: todo
 */
describe('Progress tracker (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let e1: string;
  const tag = Date.now().toString().slice(-7);
  let seq = 0;
  let strictBefore: unknown;
  const period = 'from=2019-02-01&to=2019-02-28';

  type Person = { employeeId: string; email: string; userId: string };
  let P: Person, M: Person, S: Person, A: Person, O: Person;
  let aTodo: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function person(
    name: string,
    role: 'partner' | 'manager' | 'senior' | 'article',
    reportsTo: string | null,
  ): Promise<Person> {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${tag}@dhvaj.in`;
    const u = await su.query<{ id: string }>(
      `INSERT INTO hsdg.users (email, display_name, primary_office_id)
       SELECT $1, $2, id FROM hsdg.offices WHERE code = 'NORTH' RETURNING id`,
      [email, name],
    );
    const userId = u.rows[0]!.id;
    await su.query(
      `INSERT INTO hsdg.user_roles (user_id, role_id) SELECT $1, id FROM hsdg.roles WHERE slug = $2`,
      [userId, role],
    );
    const e = await su.query<{ id: string }>(
      `INSERT INTO hsdg.employees
         (employee_code, full_name, grade_id, primary_office_id, date_of_joining, user_id, reports_to_id)
       SELECT $1, $2, (SELECT id FROM hsdg.grades WHERE slug = $3), o.id, '2024-01-01', $4, $5
         FROM hsdg.offices o WHERE o.code = 'NORTH' RETURNING id`,
      [`G${tag}${++seq}`, name, role, userId, reportsTo],
    );
    return { employeeId: e.rows[0]!.id, email, userId };
  }

  async function task(title: string, to: Person, status: string, by: Person | null = null) {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.tasks
         (engagement_id, title, status, assigned_to_employee_id, assigned_by_employee_id, due_date,
          completed_at)
       VALUES ($1, $2, $3, $4, $5, '2019-02-15', CASE WHEN $3 = 'done' THEN now() END) RETURNING id`,
      [e1, title, status, to.employeeId, by?.employeeId ?? null],
    );
    return rows[0]!.id;
  }

  const view = async (who: string, groupBy: string, extra = ''): Promise<ProgressView> =>
    (
      await http()
        .get(`/api/v1/work/progress?groupBy=${groupBy}&${period}${extra}`)
        .set(bearer(who))
        .expect(200)
    ).body as ProgressView;

  const items = async (who: string, query: string): Promise<Paginated<ProgressItem>> =>
    (
      await http()
        .get(`/api/v1/work/progress/items?${period}&limit=100&${query}`)
        .set(bearer(who))
        .expect(200)
    ).body as Paginated<ProgressItem>;

  /** A row's counts, each checked against its drill-down. */
  async function matchesDrillDown(who: string, groupBy: string, row: ProgressRow): Promise<void> {
    const key = `groupBy=${groupBy}&key=${encodeURIComponent(row.key)}`;
    expect((await items(who, key)).total).toBe(row.total);
    expect((await items(who, `${key}&progress=not_started`)).total).toBe(row.notStarted);
    expect((await items(who, `${key}&progress=in_progress`)).total).toBe(row.inProgress);
    expect((await items(who, `${key}&progress=completed`)).total).toBe(row.completed);
    expect((await items(who, `${key}&overdueOnly=true`)).total).toBe(row.overdue);
  }

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    strictBefore = (await su.query(`SELECT strict_checks FROM hsdg.firm_settings LIMIT 1`)).rows[0]
      ?.strict_checks;
    await su.query(
      `UPDATE hsdg.firm_settings
          SET strict_checks = COALESCE(strict_checks, '{}'::jsonb)
                              || jsonb_build_object('task_assignee_only', false)`,
    );
    mp = await token('mp@dhvaj.in');
    const pa = await token('partner.a@dhvaj.in');
    const first = async (path: string) =>
      (await http().get(path).set(bearer(mp)).expect(200)).body.items[0].id as string;
    e1 = (
      await http()
        .post('/api/v1/engagements')
        .set(bearer(pa))
        .send({
          entityId: await freshClient(await first('/api/v1/entities?search=Bharat&limit=100')),
          serviceId: await first('/api/v1/services?search=ITR_FILING&limit=100'),
          financialYear: '2026-27',
          periodLabel: `PROG${tag}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;

    P = await person(`Prog Partner ${tag}`, 'partner', null);
    M = await person(`Prog Manager ${tag}`, 'manager', P.employeeId);
    S = await person(`Prog Senior ${tag}`, 'senior', M.employeeId);
    A = await person(`Prog Article ${tag}`, 'article', S.employeeId);
    O = await person(`Prog Outsider ${tag}`, 'article', null);
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
       SELECT $1, unnest($2::uuid[]), 'member'`,
      [e1, [S, A, O].map((p) => p.employeeId)],
    );
    aTodo = await task('A todo', A, 'todo', S);
    await task('A doing', A, 'in_progress', S);
    await task('A waiting', A, 'blocked', S);
    await task('A done', A, 'done', S);
    await task('A cancelled', A, 'cancelled', S);
    await task('S in review', S, 'in_review', M);
    await task('O todo', O, 'todo');
  });

  afterAll(async () => {
    if (su) {
      if (e1) await su.query(`DELETE FROM hsdg.tasks WHERE engagement_id = $1`, [e1]);
      await su.query(`UPDATE hsdg.firm_settings SET strict_checks = $1`, [strictBefore ?? null]);
      await su.end();
    }
    await app?.close();
  });

  it('the Managing Partner sees the firm: the engagement counts everyone, cancelled left out', async () => {
    const v = await view(mp, 'client');
    expect(v.scope).toBe('firm');
    const row = v.rows.find((r) => r.engagementId === e1)!;
    expect(row).toMatchObject({
      notStarted: 2,
      inProgress: 3,
      completed: 1,
      overdue: 5,
      waitingOnClient: 1,
      inReview: 1,
      total: 6,
    });
    expect(row.label).not.toBe('');
    await matchesDrillDown(mp, 'client', row);
    // Overdue first: the drill-down lists the open, late work before the done task.
    const list = await items(mp, `groupBy=client&key=${e1}`);
    expect(list.items.slice(0, 5).every((i) => i.isOverdue)).toBe(true);
    expect(list.items[5]).toMatchObject({ progress: 'completed', isOverdue: false });
    // Each task opens on its engagement's work tab.
    expect(list.items[0]!.link).toMatchObject({ engagementId: e1, taskId: list.items[0]!.taskId });
  });

  it('a Senior sees only themselves and their Articles, and the counts match the drill-down', async () => {
    const st = await token(S.email);
    const v = await view(st, 'person');
    expect(v.scope).toBe('tree');
    expect(v.rows.map((r) => r.employeeId).sort()).toEqual([S.employeeId, A.employeeId].sort());
    expect(v.totals).toMatchObject({ notStarted: 1, inProgress: 3, completed: 1, total: 5 });
    const a = v.rows.find((r) => r.employeeId === A.employeeId)!;
    expect(a).toMatchObject({
      label: `Prog Article ${tag}`,
      notStarted: 1,
      inProgress: 2,
      completed: 1,
    });
    for (const row of v.rows) await matchesDrillDown(st, 'person', row);
    // The Outsider's work is in no list the Senior can open.
    expect((await items(st, '')).items.some((i) => i.assigneeId === O.employeeId)).toBe(false);
  });

  it('an Article sees their own list', async () => {
    const v = await view(await token(A.email), 'person');
    expect(v.scope).toBe('own');
    expect(v.rows.map((r) => r.employeeId)).toEqual([A.employeeId]);
  });

  it('the Managing Partner sees the Outsider; the Manager does not', async () => {
    const firm = await view(mp, 'person');
    expect(firm.rows.some((r) => r.employeeId === O.employeeId)).toBe(true);
    const mine = await view(await token(M.email), 'person');
    expect(mine.rows.some((r) => r.employeeId === O.employeeId)).toBe(false);
    expect(mine.rows.some((r) => r.employeeId === A.employeeId)).toBe(true);
  });

  it('rejects an unknown grouping', async () => {
    await http().get('/api/v1/work/progress?groupBy=office').set(bearer(mp)).expect(400);
  });

  it('the timeline names who created, gave, started and sent the task for review', async () => {
    const at = await token(A.email);
    await http()
      .post(`/api/v1/engagements/${e1}/tasks/${aTodo}/start`)
      .set(bearer(at))
      .send({})
      .expect(201);
    await http()
      .post(`/api/v1/engagements/${e1}/tasks/${aTodo}/send-for-review`)
      .set(bearer(at))
      .send({})
      .expect(201);
    const t = (
      await http().get(`/api/v1/work/progress/tasks/${aTodo}/timeline`).set(bearer(mp)).expect(200)
    ).body as TaskTimeline;
    const events = t.entries.map((e) => e.event);
    expect(events.slice(0, 2)).toEqual(['created', 'assigned']);
    expect(t.entries[1]).toMatchObject({
      byName: `Prog Senior ${tag}`,
      toName: `Prog Article ${tag}`,
    });
    expect(events).toContain('started');
    expect(events).toContain('sent_for_review');
    expect(t.entries.find((e) => e.event === 'started')?.byName).toBe(`Prog Article ${tag}`);
  });
});
