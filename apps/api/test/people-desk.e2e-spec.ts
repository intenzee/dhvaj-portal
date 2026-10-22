import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * The HR People desk against Postgres with RLS on (spec
 * docs/accountant-hr-roles-spec.md §4, §8): HR sees attendance and workload
 * as figures about people and nothing of the client work behind them; a
 * partner is refused the firm's attendance but reads their own; the
 * articleship register and the HR vault are HR's and the Managing Partner's.
 */
describe('People desk (e2e)', () => {
  let app: INestApplication;
  let su: Client;
  let mp: string;
  let hr: string;
  let admin: string;
  let pa: string;
  let articleNorth: string;
  let partnerA: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const employeeId = async (code: string): Promise<string> =>
    (
      await su.query<{ id: string }>(`SELECT id FROM hsdg.employees WHERE employee_code = $1`, [
        code,
      ])
    ).rows[0]!.id;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const daysAgo = (n: number): string =>
    new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
    su = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await su.connect();
    mp = await token('mp@dhvaj.in');
    hr = await token('hr@dhvaj.in');
    admin = await token('admin@dhvaj.in');
    pa = await token('partner.a@dhvaj.in');
    articleNorth = await employeeId('EMP007');
    partnerA = await employeeId('EMP003');
    // The suite never truncates: start the article's register afresh.
    await su.query(`DELETE FROM hsdg.articleships WHERE employee_id = $1`, [articleNorth]);
  });

  afterAll(async () => {
    await su?.end();
    await app?.close();
  });

  describe('attendance and workload', () => {
    it('gives HR per-person days with no engagement, task or note', async () => {
      const res = await http()
        .get(`/api/v1/people/attendance?from=${daysAgo(30)}&to=${today}`)
        .set(bearer(hr))
        .expect(200);
      for (const row of res.body.rows as Array<Record<string, unknown>>) {
        expect(Object.keys(row).sort()).toEqual(
          [
            'categorySeconds',
            'day',
            'employeeCode',
            'employeeId',
            'employeeName',
            'firstStart',
            'gradeName',
            'lastStop',
            'officeCode',
            'otherSeconds',
            'reviewSeconds',
            'running',
            'totalSeconds',
            'workSeconds',
          ].sort(),
        );
      }
    });

    it('refuses a range over 92 days', async () => {
      await http()
        .get(`/api/v1/people/attendance?from=${daysAgo(120)}&to=${today}`)
        .set(bearer(hr))
        .expect(400);
    });

    it('refuses a partner the firm’s attendance, but gives them their own', async () => {
      await http()
        .get(`/api/v1/people/attendance?from=${daysAgo(7)}&to=${today}`)
        .set(bearer(pa))
        .expect(403);
      const own = await http()
        .get(`/api/v1/me/attendance?from=${daysAgo(7)}&to=${today}`)
        .set(bearer(pa))
        .expect(200);
      for (const row of own.body.rows as Array<{ employeeId: string }>) {
        expect(row.employeeId).toBe(partnerA);
      }
    });

    it('gives HR workload as counts, and the administrator none', async () => {
      const res = await http().get('/api/v1/people/workload').set(bearer(hr)).expect(200);
      expect(res.body.rows.length).toBeGreaterThan(0);
      const row = res.body.rows[0] as Record<string, unknown>;
      expect(row).not.toHaveProperty('engagements');
      expect(typeof row.activeEngagements).toBe('number');
      await http().get('/api/v1/people/workload').set(bearer(admin)).expect(403);
    });

    it('shows HR none of the client work itself', async () => {
      const engagements = await http().get('/api/v1/engagements?limit=100').set(bearer(hr));
      expect([200, 403]).toContain(engagements.status);
      if (engagements.status === 200) expect(engagements.body.items).toHaveLength(0);
      const { rows } = await su.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM hsdg.engagements`,
      );
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    });
  });

  describe('the desk', () => {
    it('gives HR the queues and the load', async () => {
      const res = await http().get('/api/v1/people/desk').set(bearer(hr)).expect(200);
      expect(res.body.workload.available).toBe(true);
      expect(res.body.queues.map((q: { key: string }) => q.key)).toContain('no_hours_yesterday');
      // Its own joiner with no login: other suites link Article North to one.
      const { rows } = await su.query<{ id: string }>(
        `INSERT INTO hsdg.employees
           (employee_code, full_name, grade_id, primary_office_id, employment_status, date_of_joining)
         SELECT $1, 'Desk No Login', g.id, o.id, 'active', $2
           FROM hsdg.grades g, hsdg.offices o WHERE g.slug = 'article' AND o.code = 'NORTH'
         RETURNING id`,
        [`NL${Date.now()}`.slice(0, 20), daysAgo(3)],
      );
      const desk = await http().get('/api/v1/people/desk').set(bearer(hr)).expect(200);
      const noLogin = desk.body.queues.find((q: { key: string }) => q.key === 'no_login');
      expect(noLogin.people.map((p: { employeeId: string }) => p.employeeId)).toContain(
        rows[0]!.id,
      );
    });

    it('gives the administrator the employee-master queues only', async () => {
      const res = await http().get('/api/v1/people/desk').set(bearer(admin)).expect(200);
      expect(res.body.workload.available).toBe(false);
      expect(res.body.queues.map((q: { key: string }) => q.key).sort()).toEqual(
        ['exit_passed_login_on', 'no_login'].sort(),
      );
    });
  });

  describe('articleship register', () => {
    it('lets HR record it, with the completion from the scheme', async () => {
      const res = await http()
        .put(`/api/v1/people/employees/${articleNorth}/articleship`)
        .set(bearer(hr))
        .send({
          principalEmployeeId: partnerA,
          schemeCode: 'three_year',
          icaiRegistrationNo: 'NRO0000001',
          startDate: '2026-01-31',
        })
        .expect(200);
      expect(res.body.expectedCompletion).toBe('2029-01-31');
      expect(res.body.principalMembershipNo).toBe('ICAI-100003');
    });

    it('records leave against the allowance', async () => {
      const res = await http()
        .post(`/api/v1/people/employees/${articleNorth}/articleship/leaves`)
        .set(bearer(hr))
        .send({ fromDate: '2026-05-04', toDate: '2026-05-05', days: 1.5, kind: 'exam' })
        .expect(201);
      expect(res.body.leaveTakenDays).toBe(1.5);
    });

    it('lets the principal read it but not change it; the administrator sees nothing', async () => {
      const list = await http().get('/api/v1/people/articles').set(bearer(pa)).expect(200);
      expect(list.body.map((a: { employeeId: string }) => a.employeeId)).toContain(articleNorth);
      await http()
        .post(`/api/v1/people/employees/${articleNorth}/articleship/leaves`)
        .set(bearer(pa))
        .send({ fromDate: '2026-06-01', days: 1, toDate: '2026-06-01', kind: 'leave' })
        .expect(403);
      const adminList = await http().get('/api/v1/people/articles').set(bearer(admin)).expect(200);
      expect(adminList.body).toHaveLength(0);
    });

    it('refuses a principal who is not a partner', async () => {
      await http()
        .put(`/api/v1/people/employees/${articleNorth}/articleship`)
        .set(bearer(hr))
        .send({
          principalEmployeeId: await employeeId('EMP005'),
          schemeCode: 'three_year',
          startDate: '2026-01-31',
          version: 1,
        })
        .expect(400);
    });
  });

  describe('the employee record (§4.3, §7.5)', () => {
    it('keeps HR from linking or unlinking a login above Manager, or a partner’s record', async () => {
      const userOf = async (email: string): Promise<string> =>
        (await su.query<{ id: string }>(`SELECT id FROM hsdg.users WHERE email = $1`, [email]))
          .rows[0]!.id;
      // Unlinking a partner's login.
      await http()
        .patch(`/api/v1/employees/${partnerA}`)
        .set(bearer(hr))
        .send({ userId: null })
        .expect(403);
      // HR's own login onto someone else's record.
      await http()
        .patch(`/api/v1/employees/${articleNorth}`)
        .set(bearer(hr))
        .send({ userId: await userOf('hr@dhvaj.in') })
        .expect((r) => expect([403, 409]).toContain(r.status));
      // A partner's record with no login takes no login HR controls.
      const partnerLogin = await userOf('partner.a@dhvaj.in');
      await su.query(`UPDATE hsdg.employees SET user_id = NULL WHERE id = $1`, [partnerA]);
      try {
        const { rows } = await su.query<{ id: string }>(
          `SELECT u.id FROM hsdg.users u
             JOIN hsdg.user_roles ur ON ur.user_id = u.id
             JOIN hsdg.roles r ON r.id = ur.role_id
            WHERE r.slug = 'manager'
              AND NOT EXISTS (SELECT 1 FROM hsdg.employees e WHERE e.user_id = u.id)
            LIMIT 1`,
        );
        const spare =
          rows[0]?.id ??
          (
            await su.query<{ id: string }>(
              `WITH u AS (
                 INSERT INTO hsdg.users (email, display_name, primary_office_id)
                 SELECT $1, 'Spare Manager', primary_office_id FROM hsdg.users WHERE email = 'hr@dhvaj.in'
                 RETURNING id)
               INSERT INTO hsdg.user_roles (user_id, role_id)
               SELECT u.id, r.id FROM u, hsdg.roles r WHERE r.slug = 'manager'
               RETURNING user_id AS id`,
              [`spare.${Date.now()}@dhvaj.in`],
            )
          ).rows[0]!.id;
        await http()
          .patch(`/api/v1/employees/${partnerA}`)
          .set(bearer(hr))
          .send({ userId: spare })
          .expect(403);
      } finally {
        await su.query(`UPDATE hsdg.employees SET user_id = $2 WHERE id = $1`, [
          partnerA,
          partnerLogin,
        ]);
      }
    });

    it('shows HR and the MP the record’s own history, and nobody else', async () => {
      const { rows } = await su.query<{ full_name: string }>(
        `SELECT full_name FROM hsdg.employees WHERE id = $1`,
        [articleNorth],
      );
      await http()
        .patch(`/api/v1/employees/${articleNorth}`)
        .set(bearer(hr))
        .send({ fullName: `${rows[0]!.full_name} (HR)` })
        .expect(200);
      await http()
        .patch(`/api/v1/employees/${articleNorth}`)
        .set(bearer(hr))
        .send({ fullName: rows[0]!.full_name })
        .expect(200);
      const history = (
        await http()
          .get(`/api/v1/people/employees/${articleNorth}/history`)
          .set(bearer(hr))
          .expect(200)
      ).body as { action: string; objectType: string }[];
      expect(history.filter((h) => h.action === 'employee.updated').length).toBeGreaterThanOrEqual(
        2,
      );
      expect(history.every((h) => ['employee', 'articleship', 'user'].includes(h.objectType))).toBe(
        true,
      );
      expect(history.some((h) => h.action.startsWith('auth.sign'))).toBe(false);
      await http()
        .get(`/api/v1/people/employees/${articleNorth}/history`)
        .set(bearer(mp))
        .expect(200);
      await http()
        .get(`/api/v1/people/employees/${articleNorth}/history`)
        .set(bearer(pa))
        .expect(403);
      // The firm-wide audit log stays shut to HR.
      const log = await http().get('/api/v1/audit').set(bearer(hr));
      expect([403, 404]).toContain(log.status);
    });
  });

  describe('HR documents vault', () => {
    const file = Buffer.from('%PDF-1.4 appointment letter').toString('base64');

    it('keeps a file for HR and the MP, audits the download, archives not deletes', async () => {
      const up = await http()
        .post(`/api/v1/people/employees/${articleNorth}/documents`)
        .set(bearer(hr))
        .send({
          kind: 'appointment_letter',
          title: 'Appointment letter',
          filename: 'appointment.pdf',
          contentType: 'application/pdf',
          contentBase64: file,
        })
        .expect(201);
      const id = up.body.id as string;
      expect(up.body).not.toHaveProperty('storageReference');

      const mpList = await http()
        .get(`/api/v1/people/employees/${articleNorth}/documents`)
        .set(bearer(mp))
        .expect(200);
      expect(mpList.body.map((d: { id: string }) => d.id)).toContain(id);

      const dl = await http()
        .get(`/api/v1/people/employees/${articleNorth}/documents/${id}/download`)
        .set(bearer(hr))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((dl.body as Buffer).toString('base64')).toBe(file);
      const audit = await su.query(
        `SELECT 1 FROM hsdg.audit_events WHERE action = 'hr_document.downloaded'
            AND after_state->>'documentId' = $1`,
        [id],
      );
      expect(audit.rowCount).toBe(1);

      await http()
        .post(`/api/v1/people/employees/${articleNorth}/documents/${id}/archive`)
        .set(bearer(hr))
        .expect(201);
      const live = await http()
        .get(`/api/v1/people/employees/${articleNorth}/documents`)
        .set(bearer(hr))
        .expect(200);
      expect(live.body.map((d: { id: string }) => d.id)).not.toContain(id);
      const withArchived = await http()
        .get(`/api/v1/people/employees/${articleNorth}/documents?archived=true`)
        .set(bearer(hr))
        .expect(200);
      expect(withArchived.body.map((d: { id: string }) => d.id)).toContain(id);
    });

    it('shows the administrator an empty vault and refuses an upload', async () => {
      const list = await http()
        .get(`/api/v1/people/employees/${articleNorth}/documents`)
        .set(bearer(admin))
        .expect(200);
      expect(list.body).toHaveLength(0);
      await http()
        .post(`/api/v1/people/employees/${articleNorth}/documents`)
        .set(bearer(admin))
        .send({ kind: 'nda', title: 'NDA', filename: 'nda.pdf', contentBase64: file })
        .expect(403);
    });
  });
});
