import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * C-3 / C-4 — sets of work. A Manager gives a batch of open tasks to someone
 * in their tree as one named set, with themselves as reviewer; the person it
 * was given to splits it among the people below them. Each task keeps its set.
 *
 *   Partner P ← Manager M ← Senior S ← Article A
 *   Outsider O (Article, reports to no one)
 *
 *   E1 (EP Partner A of the seed, none of them lead it): team M, S, A, O.
 *   Tasks t1, t2 (M, to do), tBusy (M, in progress), tO (O, to do).
 */
describe('Work sets (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let e1: string;
  const tag = Date.now().toString().slice(-7);
  let seq = 0;

  type Person = { employeeId: string; email: string; userId: string };
  let P: Person, M: Person, S: Person, A: Person, O: Person;
  let t1: string, t2: string, tBusy: string, tO: string;
  let setId: string;

  const http = () => request(app.getHttpServer());
  const tokens = new Map<string, string>();
  const as = async (who: Person) => {
    if (!tokens.has(who.email)) {
      const res = await http()
        .post('/api/v1/auth/dev-token')
        .send({ email: who.email })
        .expect(201);
      tokens.set(who.email, res.body.accessToken as string);
    }
    return { Authorization: `Bearer ${tokens.get(who.email)}` };
  };

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
      [`W${tag}${++seq}`, name, role, userId, reportsTo],
    );
    return { employeeId: e.rows[0]!.id, email, userId };
  }

  async function task(title: string, to: Person, status = 'todo'): Promise<string> {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.tasks (engagement_id, title, assigned_to_employee_id, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [e1, title, to.employeeId, status],
    );
    return rows[0]!.id;
  }

  const taskRow = async (id: string) =>
    (
      await su.query<{
        assigned_to_employee_id: string;
        reviewer_employee_id: string | null;
        assigned_by_employee_id: string | null;
        work_set_id: string | null;
        due_date: string | null;
        assigned_at: Date | null;
      }>(
        `SELECT assigned_to_employee_id, reviewer_employee_id, assigned_by_employee_id,
                work_set_id, due_date::text AS due_date, assigned_at
           FROM hsdg.tasks WHERE id = $1`,
        [id],
      )
    ).rows[0]!;

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    const mp = {
      Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email: 'mp@dhvaj.in' }).expect(201)).body.accessToken}`,
    };
    const pa = {
      Authorization: `Bearer ${(await http().post('/api/v1/auth/dev-token').send({ email: 'partner.a@dhvaj.in' }).expect(201)).body.accessToken}`,
    };
    const first = async (path: string) =>
      (await http().get(path).set(mp).expect(200)).body.items[0].id as string;
    e1 = (
      await http()
        .post('/api/v1/engagements')
        .set(pa)
        .send({
          entityId: await freshClient(await first('/api/v1/entities?search=Bharat&limit=100')),
          serviceId: await first('/api/v1/services?search=ITR_FILING&limit=100'),
          financialYear: '2026-27',
          periodLabel: `SETS${tag}`,
          status: 'accepted',
        })
        .expect(201)
    ).body.id as string;

    P = await person(`Set Partner ${tag}`, 'partner', null);
    M = await person(`Set Manager ${tag}`, 'manager', P.employeeId);
    S = await person(`Arjun Senior ${tag}`, 'senior', M.employeeId);
    A = await person(`Set Article ${tag}`, 'article', S.employeeId);
    O = await person(`Outside Article ${tag}`, 'article', null);
    await su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
       SELECT $1, unnest($2::uuid[]), 'member'`,
      [e1, [M, S, A, O].map((p) => p.employeeId)],
    );
    t1 = await task('Reconcile purchases', M);
    t2 = await task('Reconcile sales', M);
    tBusy = await task('Draft notes', M, 'in_progress');
    tO = await task('Outsider work', O);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  it('an Article gives no sets', async () => {
    await http()
      .get('/api/v1/work-sets/people')
      .set(await as(A))
      .expect(403);
  });

  it('a Manager may give to their tree only', async () => {
    const res = await http()
      .get('/api/v1/work-sets/people')
      .set(await as(M))
      .expect(200);
    const ids = (res.body as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([S.employeeId, A.employeeId]));
    expect(ids).not.toContain(O.employeeId);
    expect(ids).not.toContain(P.employeeId);
    expect(ids).not.toContain(M.employeeId);
  });

  it('a Manager lists the open tasks their tree holds, with the busy ones not movable', async () => {
    const res = await http()
      .get('/api/v1/work-sets/open-tasks')
      .set(await as(M))
      .expect(200);
    const rows = res.body as { id: string; movable: boolean }[];
    const ours = rows.filter((r) => [t1, t2, tBusy, tO].includes(r.id));
    expect(ours.map((r) => r.id).sort()).toEqual([t1, t2, tBusy].sort());
    expect(ours.find((r) => r.id === tBusy)?.movable).toBe(false);
  });

  it('refuses a busy task, a task outside the tree and a receiver outside the tree', async () => {
    await http()
      .post('/api/v1/work-sets')
      .set(await as(M))
      .send({ taskIds: [t1, tBusy], assignedToId: S.employeeId })
      .expect(400);
    const outside = await http()
      .post('/api/v1/work-sets')
      .set(await as(M))
      .send({ taskIds: [t1], assignedToId: O.employeeId });
    expect(outside.status).toBe(403);
    expect((await taskRow(t1)).work_set_id).toBeNull();
  });

  it('gives a set: the tasks move to the Senior with the Manager reviewing', async () => {
    const res = await http()
      .post('/api/v1/work-sets')
      .set(await as(M))
      .send({ taskIds: [t1, t2], assignedToId: S.employeeId, dueDate: '2026-11-20', note: 'Oct' })
      .expect(201);
    setId = res.body.id as string;
    expect(res.body).toMatchObject({
      name: '2 tasks — Arjun',
      assignedToId: S.employeeId,
      assignedById: M.employeeId,
      dueDate: '2026-11-20',
      taskCount: 2,
    });
    for (const id of [t1, t2]) {
      const t = await taskRow(id);
      expect(t).toMatchObject({
        assigned_to_employee_id: S.employeeId,
        reviewer_employee_id: M.employeeId,
        assigned_by_employee_id: M.employeeId,
        work_set_id: setId,
        due_date: '2026-11-20',
      });
      expect(t.assigned_at).not.toBeNull();
    }
    const { rows } = await su.query<{ title: string }>(
      `SELECT n.title FROM hsdg.notifications n
        WHERE n.recipient_user_id = $1 AND n.type = 'work_set_assigned' AND n.object_id = $2`,
      [S.userId, setId],
    );
    expect(rows.map((r) => r.title)).toEqual([
      `Set Manager ${tag} gave you 2 tasks: 2 tasks — Arjun, due 20 Nov`,
    ]);
  });

  it('lists the set on both sides', async () => {
    const mine = await http()
      .get('/api/v1/work-sets?mine=assigned_to')
      .set(await as(S))
      .expect(200);
    expect((mine.body as { id: string }[]).map((s) => s.id)).toContain(setId);
    const given = await http()
      .get('/api/v1/work-sets?mine=assigned_by')
      .set(await as(M))
      .expect(200);
    expect((given.body as { id: string }[]).map((s) => s.id)).toContain(setId);
  });

  it('the Senior splits a task to their Article, as its reviewer', async () => {
    const detail = await http()
      .get(`/api/v1/work-sets/${setId}`)
      .set(await as(S))
      .expect(200);
    expect(detail.body.canSplit).toBe(true);
    await http()
      .post(`/api/v1/work-sets/${setId}/split`)
      .set(await as(S))
      .send({ taskIds: [t1], toEmployeeId: O.employeeId })
      .expect(403);
    const res = await http()
      .post(`/api/v1/work-sets/${setId}/split`)
      .set(await as(S))
      .send({ taskIds: [t1], toEmployeeId: A.employeeId })
      .expect(201);
    expect(res.body).toEqual({ moved: 1 });
    expect(await taskRow(t1)).toMatchObject({
      assigned_to_employee_id: A.employeeId,
      reviewer_employee_id: S.employeeId,
      work_set_id: setId,
    });
    expect((await taskRow(t2)).assigned_to_employee_id).toBe(S.employeeId);
  });

  it('the giver still sees who holds every piece; the Article sees the set but cannot split it', async () => {
    const forM = await http()
      .get(`/api/v1/work-sets/${setId}`)
      .set(await as(M))
      .expect(200);
    const holders = Object.fromEntries(
      (forM.body.tasks as { id: string; assignedToId: string }[]).map((t) => [
        t.id,
        t.assignedToId,
      ]),
    );
    expect(holders).toEqual({ [t1]: A.employeeId, [t2]: S.employeeId });
    const forA = await http()
      .get(`/api/v1/work-sets/${setId}`)
      .set(await as(A))
      .expect(200);
    expect(forA.body.canSplit).toBe(false);
    await http()
      .post(`/api/v1/work-sets/${setId}/split`)
      .set(await as(A))
      .send({ taskIds: [t1], toEmployeeId: S.employeeId })
      .expect(403);
  });

  it('someone with no task in the set does not see it', async () => {
    await http()
      .get(`/api/v1/work-sets/${setId}`)
      .set(await as(O))
      .expect(404);
  });
});
