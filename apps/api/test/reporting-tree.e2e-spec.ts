import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * C-2 — the reporting tree in RLS. A Partner / Manager sees their tree's
 * people, tasks and the engagements their tree works on; a Senior sees their
 * Articles and the tasks they gave; an Article (strict firm) sees only their
 * own tasks. C-5's Start / Send for review: started_at, the giver reviews.
 *
 *   Partner P ← Manager M ← Senior S ← Article A (SOUTH office)
 *   Outsider O (Article, SOUTH, reports to no one)
 *
 *   E1 (EP Partner A of the seed): team S, A, O. Tasks: tA (A, given by S),
 *   tS (S), tO (O).
 *   E2 (EP Partner A): team O only.
 */
describe('Reporting tree scope (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let e1: string;
  let e2: string;
  const tag = Date.now().toString().slice(-7);
  let seq = 0;
  let strictBefore: unknown;

  type Person = { employeeId: string; email: string; userId: string };
  let P: Person, M: Person, S: Person, A: Person, O: Person;
  let tA: string, tS: string, tO: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function person(
    name: string,
    role: 'partner' | 'manager' | 'senior' | 'article',
    reportsTo: string | null,
    office: 'NORTH' | 'SOUTH' = 'NORTH',
  ): Promise<Person> {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${tag}@dhvaj.in`;
    const u = await su.query<{ id: string }>(
      `INSERT INTO hsdg.users (email, display_name, primary_office_id)
       SELECT $1, $2, id FROM hsdg.offices WHERE code = $3 RETURNING id`,
      [email, name, office],
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
         FROM hsdg.offices o WHERE o.code = $6 RETURNING id`,
      [`T${tag}${++seq}`, name, role, userId, reportsTo, office],
    );
    return { employeeId: e.rows[0]!.id, email, userId };
  }

  const onTeam = (engagementId: string, ...people: Person[]) =>
    su.query(
      `INSERT INTO hsdg.engagement_team (engagement_id, employee_id, role_on_engagement)
       SELECT $1, unnest($2::uuid[]), 'member'`,
      [engagementId, people.map((p) => p.employeeId)],
    );

  async function task(engagementId: string, title: string, to: Person, by: Person | null) {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.tasks (engagement_id, title, assigned_to_employee_id, assigned_by_employee_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [engagementId, title, to.employeeId, by?.employeeId ?? null],
    );
    return rows[0]!.id;
  }

  const setStrict = (on: boolean) =>
    su.query(
      `UPDATE hsdg.firm_settings
          SET strict_checks = COALESCE(strict_checks, '{}'::jsonb)
                              || jsonb_build_object('task_assignee_only', $1::boolean)`,
      [on],
    );

  /** The task ids `who` sees on an engagement, or null when the engagement is hidden. */
  async function tasksSeen(who: Person, engagementId: string): Promise<string[] | null> {
    const res = await http()
      .get(`/api/v1/engagements/${engagementId}/tasks?limit=100`)
      .set(bearer(await token(who.email)));
    if (res.status === 404 || res.status === 403) return null;
    expect(res.status).toBe(200);
    return (res.body.items as { id: string }[]).map((t) => t.id);
  }

  async function engagementSeen(who: Person, engagementId: string): Promise<boolean> {
    const res = await http()
      .get(`/api/v1/engagements/${engagementId}`)
      .set(bearer(await token(who.email)));
    return res.status === 200;
  }

  async function personSeen(who: Person, other: Person): Promise<boolean> {
    const res = await http()
      .get(`/api/v1/employees/${other.employeeId}`)
      .set(bearer(await token(who.email)));
    return res.status === 200;
  }

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    strictBefore = (await su.query(`SELECT strict_checks FROM hsdg.firm_settings LIMIT 1`)).rows[0]
      ?.strict_checks;
    mp = await token('mp@dhvaj.in');
    const pa = await token('partner.a@dhvaj.in');
    const first = async (path: string) =>
      (await http().get(path).set(bearer(mp)).expect(200)).body.items[0].id as string;
    const serviceId = await first('/api/v1/services?search=ITR_FILING&limit=100');
    const engagement = async (label: string) =>
      (
        await http()
          .post('/api/v1/engagements')
          .set(bearer(pa))
          .send({
            entityId: await freshClient(await first('/api/v1/entities?search=Bharat&limit=100')),
            serviceId,
            financialYear: '2026-27',
            periodLabel: `${label}${tag}`,
            status: 'accepted',
          })
          .expect(201)
      ).body.id as string;
    e1 = await engagement('TREE1');
    e2 = await engagement('TREE2');

    P = await person(`Tree Partner ${tag}`, 'partner', null);
    M = await person(`Tree Manager ${tag}`, 'manager', P.employeeId);
    S = await person(`Tree Senior ${tag}`, 'senior', M.employeeId);
    A = await person(`Tree Article ${tag}`, 'article', S.employeeId, 'SOUTH');
    O = await person(`Outside Article ${tag}`, 'article', null, 'SOUTH');

    await onTeam(e1, S, A, O);
    await onTeam(e2, O);
    tA = await task(e1, 'Article work', A, S);
    tS = await task(e1, 'Senior work', S, M);
    tO = await task(e1, 'Outsider work', O, null);
  });

  afterAll(async () => {
    if (su) {
      await su.query(`UPDATE hsdg.firm_settings SET strict_checks = $1`, [strictBefore ?? null]);
      await su.end();
    }
    await app?.close();
  });

  describe('engagements', () => {
    it('a Partner / Manager sees the engagements their tree works on, and no others', async () => {
      for (const who of [P, M]) {
        expect(await engagementSeen(who, e1)).toBe(true);
        expect(await engagementSeen(who, e2)).toBe(false);
      }
    });

    it('a Senior / Article sees only their team engagements', async () => {
      expect(await engagementSeen(S, e1)).toBe(true);
      expect(await engagementSeen(A, e1)).toBe(true);
      expect(await engagementSeen(S, e2)).toBe(false);
      expect(await engagementSeen(A, e2)).toBe(false);
    });
  });

  describe('people', () => {
    it('everyone sees their tree, wherever its office', async () => {
      expect(await personSeen(P, A)).toBe(true);
      expect(await personSeen(M, A)).toBe(true);
      expect(await personSeen(S, A)).toBe(true);
    });

    it('nobody outside the tree comes with it', async () => {
      // O is in SOUTH, on no engagement with P, outside P's tree.
      expect(await personSeen(P, O)).toBe(false);
    });
  });

  describe('tasks, strict firm (task_assignee_only on)', () => {
    beforeAll(() => setStrict(true));

    it('a Partner / Manager sees their tree’s tasks, not the rest', async () => {
      for (const who of [P, M]) {
        const seen = await tasksSeen(who, e1);
        expect(seen).toEqual(expect.arrayContaining([tA, tS]));
        expect(seen).not.toContain(tO);
      }
    });

    it('a Senior sees their own and the ones they gave', async () => {
      const seen = await tasksSeen(S, e1);
      expect(seen).toEqual(expect.arrayContaining([tA, tS]));
      expect(seen).not.toContain(tO);
    });

    it('an Article sees only their own', async () => {
      expect(await tasksSeen(A, e1)).toEqual([tA]);
    });
  });

  describe('tasks, easy mode (task_assignee_only off)', () => {
    beforeAll(() => setStrict(false));

    it('a team member sees the whole engagement’s tasks', async () => {
      expect(await tasksSeen(A, e1)).toEqual(expect.arrayContaining([tA, tS, tO]));
    });

    it('a Partner reached through the tree sees the engagement’s tasks too', async () => {
      expect(await tasksSeen(P, e1)).toEqual(expect.arrayContaining([tA, tS, tO]));
    });
  });

  describe('moving work down the tree (tasks UPDATE)', () => {
    /** Rows an UPDATE touches as `who`, through the app role and the real context. */
    async function canUpdate(who: Person, role: string, taskId: string): Promise<boolean> {
      const app = new Client({ connectionString: process.env.DATABASE_URL });
      await app.connect();
      try {
        await app.query('BEGIN');
        await app.query(
          `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', $2, true),
                  set_config('hsdg.roles', $2, true), set_config('hsdg.employee_id', $3, true),
                  set_config('hsdg.office_id', '', true)`,
          [who.userId, role, who.employeeId],
        );
        const res = await app.query(`UPDATE hsdg.tasks SET priority = 'high' WHERE id = $1`, [
          taskId,
        ]);
        return (res.rowCount ?? 0) === 1;
      } finally {
        await app.query('ROLLBACK').catch(() => undefined);
        await app.end();
      }
    }

    beforeAll(() => setStrict(true));

    it('a Manager / Partner may change their reports’ tasks, not others’', async () => {
      expect(await canUpdate(M, 'manager', tA)).toBe(true);
      expect(await canUpdate(P, 'partner', tS)).toBe(true);
      expect(await canUpdate(M, 'manager', tO)).toBe(false);
    });

    it('a Senior may change the tasks they gave their Articles', async () => {
      expect(await canUpdate(S, 'senior', tA)).toBe(true);
      expect(await canUpdate(S, 'senior', tO)).toBe(false);
    });

    it('an Article only their own', async () => {
      expect(await canUpdate(A, 'article', tA)).toBe(true);
      expect(await canUpdate(A, 'article', tS)).toBe(false);
    });
  });

  describe('C-5 Start and Send for review', () => {
    beforeAll(() => setStrict(false));

    it('Start stamps started_at once; Send for review goes to the giver', async () => {
      const t = await token(A.email);
      await http()
        .post(`/api/v1/engagements/${e1}/tasks/${tA}/start`)
        .set(bearer(t))
        .send({})
        .expect(201);
      const first = (
        await su.query<{ started_at: Date }>(`SELECT started_at FROM hsdg.tasks WHERE id = $1`, [
          tA,
        ])
      ).rows[0]!.started_at;
      expect(first).toBeTruthy();

      await http()
        .post(`/api/v1/engagements/${e1}/tasks/${tA}/send-for-review`)
        .set(bearer(t))
        .send({})
        .expect(201);
      const { rows } = await su.query<{ reviewer_employee_id: string; started_at: Date }>(
        `SELECT reviewer_employee_id, started_at FROM hsdg.tasks WHERE id = $1`,
        [tA],
      );
      expect(rows[0]!.reviewer_employee_id).toBe(S.employeeId);
      expect(rows[0]!.started_at).toEqual(first);
      const history = await su.query(
        `SELECT 1 FROM hsdg.task_assignments
          WHERE task_id = $1 AND kind = 'reviewer' AND to_employee_id = $2`,
        [tA, S.employeeId],
      );
      expect(history.rowCount).toBe(1);
    });
  });

  describe('C-5 My Work: the giver on each row, Ask <giver>', () => {
    it('lists the giver and when the work started', async () => {
      const res = await http()
        .get('/api/v1/work/tasks?limit=100')
        .set(bearer(await token(A.email)))
        .expect(200);
      const row = (res.body.items as { id: string }[]).find((t) => t.id === tA) as
        { assignedById: string; assignedByName: string; startedAt: string | null } | undefined;
      expect(row).toMatchObject({
        assignedById: S.employeeId,
        assignedByName: `Tree Senior ${tag}`,
      });
      expect(row!.startedAt).toBeTruthy();
    });

    it('sends the question to the person who gave the task', async () => {
      const res = await http()
        .post(`/api/v1/engagements/${e1}/tasks/${tA}/ask`)
        .set(bearer(await token(A.email)))
        .send({ question: 'Which invoices are in?' })
        .expect(201);
      expect(res.body).toEqual({ askedId: S.employeeId, askedName: `Tree Senior ${tag}` });
      const { rows } = await su.query<{ body: string }>(
        `SELECT n.body FROM hsdg.notifications n
           JOIN hsdg.employees e ON e.user_id = n.recipient_user_id
          WHERE e.id = $1 AND n.type = 'task_question' AND n.object_id = $2`,
        [S.employeeId, tA],
      );
      expect(rows.map((r) => r.body)).toEqual(['Which invoices are in?']);
    });

    it('says whom to ask when nobody gave the task', async () => {
      const res = await http()
        .post(`/api/v1/engagements/${e1}/tasks/${tO}/ask`)
        .set(bearer(await token(O.email)))
        .send({ question: 'Anyone?' })
        .expect(400);
      expect(res.body.message).toMatch(/Manager or Partner/);
    });
  });
});
