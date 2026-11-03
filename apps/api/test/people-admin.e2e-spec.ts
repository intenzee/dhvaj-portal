import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import type { DeletePersonCheck, PeopleRoster } from '@hsdg/contracts';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';
import { freshClient } from './fresh-client.helper';

/**
 * B-2 / B-3 — the People screen and leaving the firm: the roster with its
 * clean-up list, the partner picker, moving someone's open work, deactivating
 * and deleting permanently (removed outright, or kept as a former employee).
 */
describe('People screen and leaving the firm (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let engagementId: string;
  let mp: string;
  let admin: string;
  const tag = Date.now().toString().slice(-7);

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> =>
    (await http().post('/api/v1/auth/dev-token').send({ email }).expect(201)).body
      .accessToken as string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A person straight into the database, with a login holding `role` when given. */
  async function person(
    name: string,
    grade: string,
    role: string | null,
    status: 'active' | 'exited' = 'active',
  ): Promise<{ employeeId: string; userId: string | null; email: string | null }> {
    let userId: string | null = null;
    let email: string | null = null;
    if (role) {
      email = `${name.toLowerCase().replace(/\W+/g, '.')}.${tag}@dhvaj.in`;
      const u = await su.query<{ id: string }>(
        `INSERT INTO hsdg.users (email, display_name, primary_office_id)
         SELECT $1, $2, id FROM hsdg.offices WHERE code = 'NORTH' RETURNING id`,
        [email, name],
      );
      userId = u.rows[0]!.id;
      await su.query(
        `INSERT INTO hsdg.user_roles (user_id, role_id) SELECT $1, id FROM hsdg.roles WHERE slug = $2`,
        [userId, role],
      );
    }
    const e = await su.query<{ id: string }>(
      `INSERT INTO hsdg.employees
         (employee_code, full_name, grade_id, primary_office_id, date_of_joining, user_id,
          employment_status, date_of_exit)
       SELECT $1, $2, (SELECT id FROM hsdg.grades WHERE slug = $3), o.id, '2024-01-01', $4, $5,
              CASE WHEN $5 = 'exited' THEN DATE '2025-03-31' END
         FROM hsdg.offices o WHERE o.code = 'NORTH' RETURNING id`,
      [`P${tag}${Math.floor(Math.random() * 1000)}`, name, grade, userId, status],
    );
    return { employeeId: e.rows[0]!.id, userId, email };
  }

  async function task(
    title: string,
    assignee: string | null,
    reviewer: string | null = null,
    status = 'todo',
  ): Promise<string> {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO hsdg.tasks (engagement_id, title, assigned_to_employee_id, reviewer_employee_id, status, completed_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'done' THEN now() END) RETURNING id`,
      [engagementId, title, assignee, reviewer, status],
    );
    return rows[0]!.id;
  }

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    admin = await token('admin@dhvaj.in');
    const pa = await token('partner.a@dhvaj.in');
    const first = async (path: string) =>
      (await http().get(path).set(bearer(mp)).expect(200)).body.items[0].id as string;
    const eng = await http()
      .post('/api/v1/engagements')
      .set(bearer(pa))
      .send({
        entityId: await freshClient(await first('/api/v1/entities?search=Bharat&limit=100')),
        serviceId: await first('/api/v1/services?search=ITR_FILING&limit=100'),
        financialYear: '2026-27',
        periodLabel: `PPL${tag}`,
        status: 'accepted',
      })
      .expect(201);
    engagementId = eng.body.id as string;
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  describe('B-2 the People screen', () => {
    it('lists everyone with the clean-up list worked out from the data', async () => {
      const odd = await person(`Graded Partner ${tag}`, 'partner', 'article');
      const roster = (await http().get('/api/v1/people/admin/roster').set(bearer(mp)).expect(200))
        .body as PeopleRoster;
      const row = roster.people.find((p) => p.employeeId === odd.employeeId)!;
      expect(row).toMatchObject({ gradeSlug: 'partner', mainRole: 'article', addOns: [] });
      const disagree = roster.checks.find((c) => c.key === 'grade_role')!;
      expect(disagree.people.map((p) => p.employeeId)).toContain(odd.employeeId);
      const orphan = roster.checks.find((c) => c.key === 'no_reports_to')!;
      expect(orphan.people.map((p) => p.employeeId)).toContain(odd.employeeId);
      // The administrator reads it too.
      await http().get('/api/v1/people/admin/roster').set(bearer(admin)).expect(200);
    });

    it('is the Managing Partner’s and the administrator’s alone', async () => {
      for (const who of ['partner.a@dhvaj.in', 'manager.x@dhvaj.in']) {
        await http()
          .get('/api/v1/people/admin/roster')
          .set(bearer(await token(who)))
          .expect(403);
      }
    });

    it('offers only active people who are partners by grade and by role as leads', async () => {
      const notReally = await person(`Article On Partner Grade ${tag}`, 'partner', 'article');
      const left = await person(`Left Partner ${tag}`, 'partner', 'partner', 'exited');
      const real = await person(`Real Partner ${tag}`, 'partner', 'partner');
      const leads = (await http().get('/api/v1/employees/leads').set(bearer(mp)).expect(200))
        .body as { id: string; isPartner: boolean }[];
      const partners = leads.filter((l) => l.isPartner).map((l) => l.id);
      expect(partners).toContain(real.employeeId);
      expect(partners).not.toContain(notReally.employeeId);
      expect(leads.map((l) => l.id)).not.toContain(left.employeeId);
    });
  });

  describe('B-3 moving work and deactivating', () => {
    it('moves every open task and review to someone else, recording each move', async () => {
      const from = await person(`Mover From ${tag}`, 'senior', 'senior');
      const to = await person(`Mover To ${tag}`, 'senior', 'senior');
      const t1 = await task('Prepare GSTR-1', from.employeeId);
      const t2 = await task('Review GSTR-3B', null, from.employeeId);
      const closed = await task('Old return', from.employeeId, null, 'done');

      await http()
        .post('/api/v1/people/admin/move-work')
        .set(bearer(mp))
        .send({ fromEmployeeId: from.employeeId, toEmployeeId: from.employeeId, reason: 'x' })
        .expect(400);
      await http()
        .post('/api/v1/people/admin/move-work')
        .set(bearer(await token('partner.a@dhvaj.in')))
        .send({ fromEmployeeId: from.employeeId, toEmployeeId: to.employeeId, reason: 'x' })
        .expect(403);
      const moved = await http()
        .post('/api/v1/people/admin/move-work')
        .set(bearer(mp))
        .send({ fromEmployeeId: from.employeeId, toEmployeeId: to.employeeId, reason: 'Leaving' })
        .expect(201);
      expect(moved.body).toEqual({ assigned: 1, reviews: 1 });

      const { rows } = await su.query<{
        id: string;
        assigned_to_employee_id: string | null;
        reviewer_employee_id: string | null;
        assigned_by: string | null;
      }>(
        `SELECT t.id, t.assigned_to_employee_id, t.reviewer_employee_id, b.employee_code AS assigned_by
           FROM hsdg.tasks t LEFT JOIN hsdg.employees b ON b.id = t.assigned_by_employee_id
          WHERE t.id = ANY($1)`,
        [[t1, t2, closed]],
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[t1]).toMatchObject({
        assigned_to_employee_id: to.employeeId,
        assigned_by: 'EMP001',
      });
      expect(byId[t2]!.reviewer_employee_id).toBe(to.employeeId);
      expect(byId[closed]!.assigned_to_employee_id).toBe(from.employeeId); // done work keeps its name

      const log = await su.query<{ kind: string; reason: string }>(
        `SELECT kind, reason FROM hsdg.task_assignments
          WHERE from_employee_id = $1 AND to_employee_id = $2 ORDER BY kind`,
        [from.employeeId, to.employeeId],
      );
      expect(log.rows).toEqual([
        { kind: 'assignee', reason: 'Leaving' },
        { kind: 'reviewer', reason: 'Leaving' },
      ]);
      const audit = await su.query(
        `SELECT 1 FROM hsdg.audit_events WHERE action = 'employee.work_moved' AND object_id = $1`,
        [from.employeeId],
      );
      expect(audit.rowCount).toBe(1);
      // The new person joined the engagement team for the work.
      const team = await su.query(
        `SELECT 1 FROM hsdg.engagement_team WHERE engagement_id = $1 AND employee_id = $2`,
        [engagementId, to.employeeId],
      );
      expect(team.rowCount).toBe(1);
    });

    it('deactivates only once the open work has moved, turning the login off', async () => {
      const leaver = await person(`Leaver ${tag}`, 'senior', 'senior');
      const to = await person(`Taker ${tag}`, 'senior', 'senior');
      await task('Open filing', leaver.employeeId);
      const refused = await http()
        .post(`/api/v1/people/employees/${leaver.employeeId}/deactivate`)
        .set(bearer(mp))
        .send({ reason: 'Resigned' })
        .expect(409);
      expect(refused.body.message).toMatch(/Move their 1 open task/);
      await http()
        .post('/api/v1/people/admin/move-work')
        .set(bearer(mp))
        .send({
          fromEmployeeId: leaver.employeeId,
          toEmployeeId: to.employeeId,
          reason: 'Resigned',
        })
        .expect(201);
      await http()
        .post(`/api/v1/people/employees/${leaver.employeeId}/deactivate`)
        .set(bearer(mp))
        .send({ reason: 'Resigned' })
        .expect(201);
      const { rows } = await su.query<{ employment_status: string; is_active: boolean }>(
        `SELECT e.employment_status, u.is_active FROM hsdg.employees e
           JOIN hsdg.users u ON u.id = e.user_id WHERE e.id = $1`,
        [leaver.employeeId],
      );
      expect(rows[0]).toEqual({ employment_status: 'exited', is_active: false });
    });
  });

  describe('B-3 deleting permanently', () => {
    it('is the administrator’s alone, and lists what stands in the way', async () => {
      const lead = await person(`Blocked ${tag}`, 'manager', 'manager');
      await task('Still open', lead.employeeId);
      await su.query(`UPDATE hsdg.engagements SET engagement_manager_id = $1 WHERE id = $2`, [
        lead.employeeId,
        engagementId,
      ]);
      await http()
        .get(`/api/v1/people/employees/${lead.employeeId}/delete-check`)
        .set(bearer(mp))
        .expect(403);
      await http()
        .delete(`/api/v1/people/employees/${lead.employeeId}`)
        .set(bearer(mp))
        .send({ confirmName: `Blocked ${tag}` })
        .expect(403);
      const check = (
        await http()
          .get(`/api/v1/people/employees/${lead.employeeId}/delete-check`)
          .set(bearer(admin))
          .expect(200)
      ).body as DeletePersonCheck;
      expect(check.blockers.map((b) => [b.kind, b.count])).toEqual([
        ['open_tasks', 1],
        ['led_engagements', 1],
      ]);
      await http()
        .delete(`/api/v1/people/employees/${lead.employeeId}`)
        .set(bearer(admin))
        .send({ confirmName: `Blocked ${tag}` })
        .expect(409);
      await su.query(`UPDATE hsdg.engagements SET engagement_manager_id = NULL WHERE id = $1`, [
        engagementId,
      ]);
    });

    it('removes someone with no history outright, record and login', async () => {
      const p = await person(`Never Started ${tag}`, 'article', 'article');
      const check = (
        await http()
          .get(`/api/v1/people/employees/${p.employeeId}/delete-check`)
          .set(bearer(admin))
          .expect(200)
      ).body as DeletePersonCheck;
      expect(check).toMatchObject({ hasHistory: false, blockers: [] });
      await http()
        .delete(`/api/v1/people/employees/${p.employeeId}`)
        .set(bearer(admin))
        .send({ confirmName: 'Someone Else' })
        .expect(400);
      const res = await http()
        .delete(`/api/v1/people/employees/${p.employeeId}`)
        .set(bearer(admin))
        .send({ confirmName: `  never started ${tag} ` })
        .expect(200);
      expect(res.body).toEqual({ employeeId: p.employeeId, outcome: 'removed' });
      const left = await su.query(
        `SELECT (SELECT count(*) FROM hsdg.employees WHERE id = $1)::int AS e,
                (SELECT count(*) FROM hsdg.users WHERE id = $2)::int AS u`,
        [p.employeeId, p.userId],
      );
      expect(left.rows[0]).toEqual({ e: 0, u: 0 });
      const audit = await su.query(
        `SELECT 1 FROM hsdg.audit_events WHERE action = 'employee.deleted' AND object_id = $1`,
        [p.employeeId],
      );
      expect(audit.rowCount).toBe(1);
    });

    it('keeps someone with past work as "Name (former employee)", without broken links', async () => {
      const p = await person(`Past Worker ${tag}`, 'senior', 'senior');
      const old = await task('Filed GSTR-1 (Apr)', p.employeeId, null, 'done');
      const check = (
        await http()
          .get(`/api/v1/people/employees/${p.employeeId}/delete-check`)
          .set(bearer(admin))
          .expect(200)
      ).body as DeletePersonCheck;
      expect(check).toMatchObject({ hasHistory: true, blockers: [] });
      const res = await http()
        .delete(`/api/v1/people/employees/${p.employeeId}`)
        .set(bearer(admin))
        .send({ confirmName: `Past Worker ${tag}`, reason: 'Asked to be forgotten' })
        .expect(200);
      expect(res.body.outcome).toBe('erased');

      const { rows } = await su.query<{ full_name: string; former_name: string; user_id: string }>(
        `SELECT e.full_name, e.former_name, e.user_id FROM hsdg.tasks t
           JOIN hsdg.employees e ON e.id = t.assigned_to_employee_id WHERE t.id = $1`,
        [old],
      );
      expect(rows[0]).toEqual({
        full_name: `Past Worker ${tag} (former employee)`,
        former_name: `Past Worker ${tag}`,
        user_id: null,
      });
      const login = await su.query(`SELECT 1 FROM hsdg.users WHERE id = $1`, [p.userId]);
      expect(login.rowCount).toBe(0);
      // The record still opens from past work; the roster and lists leave it out.
      const one = await http().get(`/api/v1/employees/${p.employeeId}`).set(bearer(mp)).expect(200);
      expect(one.body.fullName).toBe(`Past Worker ${tag} (former employee)`);
      const roster = (
        await http().get('/api/v1/people/admin/roster').set(bearer(admin)).expect(200)
      ).body as PeopleRoster;
      expect(roster.people.map((r) => r.employeeId)).not.toContain(p.employeeId);
      // A second delete finds nobody.
      await http()
        .delete(`/api/v1/people/employees/${p.employeeId}`)
        .set(bearer(admin))
        .send({ confirmName: `Past Worker ${tag} (former employee)` })
        .expect(404);
    });

    it('never lets the administrator delete themselves', async () => {
      const me = await su.query<{ id: string }>(
        `SELECT id FROM hsdg.employees WHERE employee_code = 'EMP002'`,
      );
      await http()
        .delete(`/api/v1/people/employees/${me.rows[0]!.id}`)
        .set(bearer(admin))
        .send({ confirmName: 'Firm Admin' })
        .expect(400);
    });
  });
});
