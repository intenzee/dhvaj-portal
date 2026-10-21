import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Accountant and HR roles, phase 0 (docs/accountant-hr-roles-spec.md §7).
 *
 * Done when: the two desk roles exist with their permissions; every role a user
 * holds reaches RLS (hsdg.roles), so a Senior + Accountant keeps the Senior's
 * client work and gains billing; the Accountant may bill every client but sees
 * no client work; HR keeps the employee master and onboards logins only up to
 * Manager, never their own; agreeing a fee needs fee.agree.
 */
describe('Accountant and HR roles — phase 0 (e2e)', () => {
  let app: INestApplication;
  let userIds: Record<string, string>;
  let hr: string;
  let accounts: string;
  let mp: string;
  let mx: string;
  let pa: string;

  const http = () => request(app.getHttpServer());
  const token = async (email: string): Promise<string> => {
    const res = await http().post('/api/v1/auth/dev-token').send({ email }).expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Row counts as the application role under a given role context (rolled back). */
  const countsAs = async <T extends string>(
    role: string,
    roles: string[],
    email: string,
    tables: readonly T[],
  ): Promise<Record<T, number>> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const emp = await c.query<{ id: string; office: string }>(
        `SELECT e.id, u.primary_office_id AS office
           FROM hsdg.users u LEFT JOIN hsdg.employees e ON e.user_id = u.id
          WHERE u.email = $1`,
        [email],
      );
      await c.query('SET LOCAL ROLE hsdg_app');
      await c.query(
        `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', $2, true),
                set_config('hsdg.roles', $3, true), set_config('hsdg.office_id', $4, true),
                set_config('hsdg.employee_id', $5, true)`,
        [userIds[email], role, roles.join(','), emp.rows[0]!.office, emp.rows[0]!.id ?? ''],
      );
      const out = {} as Record<T, number>;
      for (const t of tables) {
        const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM hsdg.${t}`);
        out[t] = Number(rows[0]!.n);
      }
      return out;
    } finally {
      await c.query('ROLLBACK');
      await c.end();
    }
  };

  /** Whether the context may bill the seeded Acme (NORTH) and Coastal (SOUTH). */
  const billable = async (role: string, roles: string[], email: string): Promise<boolean[]> => {
    const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      const ids = await c.query<{ id: string }>(
        `SELECT id FROM hsdg.entities WHERE pan IN ('AAACA1234A', 'AACCC9012C') ORDER BY pan`,
      );
      const office = await c.query<{ id: string }>(
        `SELECT primary_office_id AS id FROM hsdg.users WHERE email = $1`,
        [email],
      );
      await c.query('SET LOCAL ROLE hsdg_app');
      await c.query(
        `SELECT set_config('hsdg.role', $1, true), set_config('hsdg.roles', $2, true),
                set_config('hsdg.office_id', $3, true)`,
        [role, roles.join(','), office.rows[0]!.id],
      );
      const out: boolean[] = [];
      for (const r of ids.rows) {
        const { rows } = await c.query<{ ok: boolean }>(`SELECT hsdg.ctx_can_bill($1) AS ok`, [
          r.id,
        ]);
        out.push(rows[0]!.ok);
      }
      return out;
    } finally {
      await c.query('ROLLBACK');
      await c.end();
    }
  };

  beforeAll(async () => {
    ({ userIds } = await seedIdentityFixtures());
    app = await createTestApp();
    [hr, accounts, mp, mx, pa] = await Promise.all([
      token('hr@dhvaj.in'),
      token('accounts@dhvaj.in'),
      token('mp@dhvaj.in'),
      token('manager.x@dhvaj.in'),
      token('partner.a@dhvaj.in'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the roles and what they grant', () => {
    it('gives the Accountant billing without approvals or client work', async () => {
      const me = (await http().get('/api/v1/auth/me').set(bearer(accounts)).expect(200)).body
        .principal as { roles: string[]; permissions: string[] };
      expect(me.roles).toEqual(['accountant']);
      expect(me.permissions).toEqual(
        expect.arrayContaining([
          'billing.manage',
          'entity.read_billing',
          'engagement.read_commercial',
          'payroll.read_summary',
          'payroll.read_own',
        ]),
      );
      for (const p of [
        'billing.approve',
        'fee.agree',
        'engagement.read',
        'entity.read',
        'credential.reveal',
        'report.read',
        'employee.read',
        'payroll.read',
      ]) {
        expect(me.permissions).not.toContain(p);
      }
    });

    it('gives HR the employee master, onboarding and payroll preparation — no client work', async () => {
      const me = (await http().get('/api/v1/auth/me').set(bearer(hr)).expect(200)).body
        .principal as { permissions: string[] };
      expect(me.permissions).toEqual(
        expect.arrayContaining([
          'employee.manage',
          'user.onboard',
          'time.read_attendance',
          'payroll.prepare',
          'payroll.read',
        ]),
      );
      for (const p of [
        'user.manage',
        'payroll.approve',
        'engagement.read',
        'entity.read',
        'billing.manage',
        'report.read',
      ]) {
        expect(me.permissions).not.toContain(p);
      }
    });

    it('keeps the Accountant and HR out of client screens', async () => {
      await http().get('/api/v1/engagements').set(bearer(accounts)).expect(403);
      await http().get('/api/v1/entities').set(bearer(accounts)).expect(403);
      await http().get('/api/v1/engagements').set(bearer(hr)).expect(403);
      await http().get('/api/v1/billing/invoices').set(bearer(hr)).expect(403);
    });
  });

  describe('row-level security', () => {
    const clientWork = [
      'entities',
      'clients',
      'entity_registrations',
      'entity_contacts',
      'engagements',
      'tasks',
      'documents',
      'client_credentials',
      'notices',
      'engagement_time_entries',
      'audit_events',
    ];

    it('lets the Accountant bill every client but read no client work', async () => {
      expect(await billable('accountant', ['accountant'], 'accounts@dhvaj.in')).toEqual([
        true,
        true,
      ]);
      const seen = await countsAs('accountant', ['accountant'], 'accounts@dhvaj.in', clientWork);
      for (const t of clientWork) expect({ [t]: seen[t] }).toEqual({ [t]: 0 });
    });

    it('refuses the Accountant any change to the client master', async () => {
      const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        const north = await c.query<{ id: string }>(
          `SELECT primary_office_id AS id FROM hsdg.users WHERE email = 'accounts@dhvaj.in'`,
        );
        await c.query('SET LOCAL ROLE hsdg_app');
        await c.query(
          `SELECT set_config('hsdg.role', 'accountant', true), set_config('hsdg.roles', 'accountant', true),
                  set_config('hsdg.office_id', $1, true)`,
          [north.rows[0]!.id],
        );
        const upd = await c.query(
          `UPDATE hsdg.entities SET display_name = 'X' WHERE pan = 'AAACA1234A'`,
        );
        expect(upd.rowCount).toBe(0);
      } finally {
        await c.query('ROLLBACK');
        await c.end();
      }
    });

    it('gives a Senior + Accountant the Senior’s work and every client’s billing', async () => {
      const senior = await countsAs('senior', ['senior'], 'senior.y@dhvaj.in', ['engagements']);
      const both = await countsAs('senior', ['senior', 'accountant'], 'senior.y@dhvaj.in', [
        'engagements',
      ]);
      expect(senior.engagements).toBeGreaterThan(0);
      expect(both.engagements).toBe(senior.engagements);
      expect(await billable('senior', ['senior'], 'senior.y@dhvaj.in')).toEqual([false, false]);
      expect(await billable('senior', ['senior', 'accountant'], 'senior.y@dhvaj.in')).toEqual([
        true,
        true,
      ]);
    });

    it('gives HR every employee and login, and no client or billing data', async () => {
      const all = await countsAs('managing_partner', ['managing_partner'], 'mp@dhvaj.in', [
        'employees',
        'users',
      ]);
      const seen = await countsAs('hr', ['hr'], 'hr@dhvaj.in', [
        'employees',
        'users',
        'invoices',
        ...clientWork,
      ]);
      expect(seen.employees).toBe(all.employees);
      expect(seen.users).toBe(all.users);
      expect(seen.invoices).toBe(0);
      for (const t of clientWork) expect({ [t]: seen[t] }).toEqual({ [t]: 0 });
      expect(await billable('hr', ['hr'], 'hr@dhvaj.in')).toEqual([false, false]);
    });

    it('gives a Manager + HR the whole employee master on top of client work', async () => {
      const manager = await countsAs('manager', ['manager'], 'manager.x@dhvaj.in', [
        'employees',
        'engagements',
      ]);
      const both = await countsAs('manager', ['manager', 'hr'], 'manager.x@dhvaj.in', [
        'employees',
        'engagements',
      ]);
      const all = await countsAs('managing_partner', ['managing_partner'], 'mp@dhvaj.in', [
        'employees',
      ]);
      expect(manager.employees).toBeLessThan(all.employees);
      expect(both.employees).toBe(all.employees);
      expect(both.engagements).toBe(manager.engagements);
    });
  });

  describe('HR onboards logins up to Manager', () => {
    const email = () => `joiner.${Date.now()}.${Math.floor(Math.random() * 1e6)}@dhvaj.in`;

    it('creates a Senior, gives them a temporary password, and changes them to Manager', async () => {
      const created = (
        await http()
          .post('/api/v1/users')
          .set(bearer(hr))
          .send({
            email: email(),
            displayName: 'Joiner One',
            officeCode: 'SOUTH',
            roles: ['senior'],
          })
          .expect(201)
      ).body as { id: string; roles: string[] };
      expect(created.roles).toEqual(['senior']);
      const pw = await http()
        .post(`/api/v1/users/${created.id}/password`)
        .set(bearer(hr))
        .expect(201);
      expect(typeof pw.body.temporaryPassword).toBe('string');
      const moved = await http()
        .put(`/api/v1/users/${created.id}/roles`)
        .set(bearer(hr))
        .send({ roles: ['manager'] })
        .expect(200);
      expect(moved.body.roles).toEqual(['manager']);
      await http()
        .patch(`/api/v1/users/${created.id}`)
        .set(bearer(hr))
        .send({ isActive: false })
        .expect(200);
    });

    it('refuses any role above Manager, on create and on change', async () => {
      const res = await http()
        .post('/api/v1/users')
        .set(bearer(hr))
        .send({
          email: email(),
          displayName: 'Not A Partner',
          officeCode: 'NORTH',
          roles: ['partner'],
        })
        .expect(403);
      expect(res.body.message).toMatch(/Article, Senior or Manager/);
      for (const role of ['admin', 'managing_partner', 'accountant', 'hr']) {
        await http()
          .post('/api/v1/users')
          .set(bearer(hr))
          .send({ email: email(), displayName: 'No', officeCode: 'NORTH', roles: [role] })
          .expect(403);
      }
    });

    it('leaves people above Manager — and HR themself — to an administrator', async () => {
      const partnerA = userIds['partner.a@dhvaj.in']!;
      await http()
        .put(`/api/v1/users/${partnerA}/roles`)
        .set(bearer(hr))
        .send({ roles: ['manager'] })
        .expect(403);
      await http()
        .patch(`/api/v1/users/${partnerA}`)
        .set(bearer(hr))
        .send({ isActive: false })
        .expect(403);
      await http().post(`/api/v1/users/${partnerA}/password`).set(bearer(hr)).expect(403);
      await http().delete(`/api/v1/users/${partnerA}/password`).set(bearer(hr)).expect(403);
      const self = await http()
        .put(`/api/v1/users/${userIds['hr@dhvaj.in']}/roles`)
        .set(bearer(hr))
        .send({ roles: ['hr', 'manager'] })
        .expect(403);
      expect(self.body.message).toMatch(/Article, Senior or Manager|your own access/);
      await http()
        .patch(`/api/v1/users/${userIds['hr@dhvaj.in']}`)
        .set(bearer(hr))
        .send({ displayName: 'HR Boss' })
        .expect(403);
    });

    it('holds the same ceiling in the database', async () => {
      const c = new Client({ connectionString: process.env.DATABASE_SUPERUSER_URL });
      await c.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE hsdg_app');
        await c.query(
          `SELECT set_config('hsdg.user_id', $1, true), set_config('hsdg.role', 'hr', true),
                  set_config('hsdg.roles', 'hr', true)`,
          [userIds['hr@dhvaj.in']],
        );
        const upd = await c.query(`UPDATE hsdg.users SET display_name = 'X' WHERE id = $1`, [
          userIds['partner.a@dhvaj.in'],
        ]);
        expect(upd.rowCount).toBe(0);
        await expect(
          c.query(
            `INSERT INTO hsdg.user_roles (user_id, role_id)
             SELECT $1, id FROM hsdg.roles WHERE slug = 'partner'`,
            [userIds['senior.y@dhvaj.in']],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await c.query('ROLLBACK');
        await c.end();
      }
    });

    it('keeps onboarding away from the Accountant', async () => {
      await http()
        .post('/api/v1/users')
        .set(bearer(accounts))
        .send({ email: email(), displayName: 'No', officeCode: 'NORTH', roles: ['article'] })
        .expect(403);
    });

    it('still lets an administrator give any role', async () => {
      await http()
        .post('/api/v1/users')
        .set(bearer(mp))
        .send({
          email: email(),
          displayName: 'New Partner',
          officeCode: 'NORTH',
          roles: ['partner'],
        })
        .expect(201);
    });
  });

  describe('agreeing a fee is a partner’s call', () => {
    const anyEngagement = '00000000-0000-4000-8000-000000000001';

    it('refuses fee.agree routes to a manager and to the Accountant', async () => {
      for (const t of [mx, accounts]) {
        await http()
          .post(`/api/v1/billing/engagements/${anyEngagement}/fee-milestones`)
          .set(bearer(t))
          .send({ label: 'x', amount: '1000.00', dueOn: '2026-11-30' })
          .expect(403);
        await http()
          .post(`/api/v1/billing/fee-milestones/${anyEngagement}/cancel`)
          .set(bearer(t))
          .expect(403);
      }
    });

    it('lets a partner past the permission check and the Accountant read milestones', async () => {
      const add = await http()
        .post(`/api/v1/billing/engagements/${anyEngagement}/fee-milestones`)
        .set(bearer(pa))
        .send({ label: 'x', amount: '1000.00', dueOn: '2026-11-30' });
      expect(add.body.message ?? '').not.toMatch(/Missing required permission/);
      const read = await http()
        .get(`/api/v1/billing/engagements/${anyEngagement}/fee-milestones`)
        .set(bearer(accounts));
      expect(read.body.message ?? '').not.toMatch(/Requires one of|Missing required permission/);
    });
  });
});
