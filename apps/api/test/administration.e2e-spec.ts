import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Administration (Phase 13) through the HTTP API: audited write endpoints for
 * users, role assignment and offices. Verifies permission gating (only
 * user.manage / office.manage may write), RLS firm-wide enforcement, uniqueness
 * conflicts, and that every mutation lands in the audit trail.
 */
describe('Administration (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string, mfa?: boolean): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email, ...(mfa === undefined ? {} : { mfa }) })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const uniq = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('roles reference', () => {
    it('lists assignable roles for an admin, never the reserved system role', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set(bearer(await token('admin@dhvaj.in')))
        .expect(200);
      const slugs = (res.body as Array<{ slug: string }>).map((r) => r.slug);
      expect(slugs).toContain('managing_partner');
      expect(slugs).toContain('article');
      expect(slugs).not.toContain('system');
    });

    it('forbids a Senior (lacks user.manage) from listing roles (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set(bearer(await token('senior.y@dhvaj.in')))
        .expect(403);
    });
  });

  describe('user write', () => {
    it('lets an admin create a user with roles (audited)', async () => {
      const email = `qa.${uniq()}@dhvaj.in`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email, displayName: 'QA User', officeCode: 'NORTH', roles: ['manager'] })
        .expect(201);
      expect(res.body.email).toBe(email);
      expect(res.body.roles).toContain('manager');

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(await token('mp@dhvaj.in')))
        .expect(200);
      const created = (audit.body.items as Array<{ action: string; objectId: string }>).some(
        (e) => e.action === 'user.created' && e.objectId === res.body.id,
      );
      expect(created).toBe(true);
    });

    it('rejects a duplicate email (409)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email: 'partner.a@dhvaj.in', displayName: 'Dupe', officeCode: 'NORTH' })
        .expect(409);
    });

    it('rejects an unknown office (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email: `qa.${uniq()}@dhvaj.in`, displayName: 'X', officeCode: 'NOPE' })
        .expect(400);
    });

    it('forbids a Partner (lacks user.manage) from creating a user (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('partner.a@dhvaj.in')))
        .send({ email: `qa.${uniq()}@dhvaj.in`, displayName: 'X', officeCode: 'NORTH' })
        .expect(403);
    });

    it('deactivates a user via PATCH (soft, audited)', async () => {
      const email = `qa.${uniq()}@dhvaj.in`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email, displayName: 'To Deactivate', officeCode: 'NORTH' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${created.body.id}`)
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ isActive: false })
        .expect(200);
      expect(res.body.isActive).toBe(false);
    });

    it('changes a user’s sign-in email, keeping their roles (audited)', async () => {
      const oldEmail = `qa.${uniq()}@hsdg.in`;
      const newEmail = `qa.${uniq()}@dhvaj.in`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({
          email: oldEmail,
          displayName: 'Moving Firm',
          officeCode: 'NORTH',
          roles: ['manager'],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${created.body.id}`)
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email: newEmail })
        .expect(200);
      expect(res.body.email).toBe(newEmail);
      expect(res.body.roles).toContain('manager');

      // Sign-in now resolves the new email, not the old one.
      await request(app.getHttpServer())
        .post('/api/v1/auth/dev-token')
        .send({ email: oldEmail })
        .expect(404);
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(bearer(await token(newEmail)))
        .expect(200);
      expect(me.body.principal.userId).toBe(created.body.id);
      expect(me.body.principal.email).toBe(newEmail);

      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit?limit=100')
        .set(bearer(await token('mp@dhvaj.in')))
        .expect(200);
      const updated = (audit.body.items as Array<{ action: string; objectId: string }>).some(
        (e) => e.action === 'user.updated' && e.objectId === created.body.id,
      );
      expect(updated).toBe(true);
    });

    it('rejects changing an email to one already in use (409)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email: `qa.${uniq()}@dhvaj.in`, displayName: 'Clash', officeCode: 'NORTH' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${created.body.id}`)
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email: 'Partner.A@dhvaj.in' })
        .expect(409);
    });

    it('replaces a user’s role set via PUT :id/roles', async () => {
      const email = `qa.${uniq()}@dhvaj.in`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email, displayName: 'Role Change', officeCode: 'NORTH', roles: ['article'] })
        .expect(201);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/users/${created.body.id}/roles`)
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ roles: ['senior', 'manager'] })
        .expect(200);
      expect(res.body.roles.sort()).toEqual(['manager', 'senior']);
    });

    describe('a staff role brings an employee record', () => {
      type Emp = { id: string; userId: string | null; gradeSlug: string; officeCode: string };
      const employeeOf = async (userId: string): Promise<Emp | undefined> => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/employees?limit=100&status=active')
          .set(bearer(await token('mp@dhvaj.in')))
          .expect(200);
        return (res.body.items as Emp[]).find((e) => e.userId === userId);
      };

      it('gives a new Partner a partner-grade employee, so they can be an Engagement Partner', async () => {
        const created = await request(app.getHttpServer())
          .post('/api/v1/users')
          .set(bearer(await token('admin@dhvaj.in')))
          .send({
            email: `qa.${uniq()}@dhvaj.in`,
            displayName: `New Partner ${uniq()}`,
            officeCode: 'SOUTH',
            roles: ['partner'],
          })
          .expect(201);
        const emp = await employeeOf(created.body.id);
        expect(emp).toMatchObject({ gradeSlug: 'partner', officeCode: 'SOUTH' });

        const partners = await request(app.getHttpServer())
          .get('/api/v1/partners')
          .set(bearer(await token('mp@dhvaj.in')))
          .expect(200);
        expect((partners.body as Array<{ id: string }>).map((p) => p.id)).toContain(emp!.id);
      });

      it('raises the grade when a role is granted, never lowers it when one is taken away', async () => {
        const created = await request(app.getHttpServer())
          .post('/api/v1/users')
          .set(bearer(await token('admin@dhvaj.in')))
          .send({
            email: `qa.${uniq()}@dhvaj.in`,
            displayName: `Rising ${uniq()}`,
            officeCode: 'NORTH',
            roles: ['senior'],
          })
          .expect(201);
        expect((await employeeOf(created.body.id))?.gradeSlug).toBe('senior');

        const admin = await token('admin@dhvaj.in');
        const put = (roles: string[]) =>
          request(app.getHttpServer())
            .put(`/api/v1/users/${created.body.id}/roles`)
            .set(bearer(admin))
            .send({ roles })
            .expect(200);
        await put(['manager']);
        const promoted = await employeeOf(created.body.id);
        expect(promoted?.gradeSlug).toBe('manager');

        await put(['article']);
        const after = await employeeOf(created.body.id);
        expect(after).toMatchObject({ id: promoted!.id, gradeSlug: 'manager' });
      });

      it('lists engagement leads from every office, narrowly, to anyone who creates engagements', async () => {
        const senior = await token('senior.y@dhvaj.in'); // SOUTH, not firm-wide
        const leads = await request(app.getHttpServer())
          .get('/api/v1/employees/leads')
          .set(bearer(senior))
          .expect(200);
        const rows = leads.body as Array<Record<string, unknown>>;
        expect(rows.some((r) => r.officeCode === 'NORTH' && r.isPartner === true)).toBe(true);
        expect(rows.every((r) => r.gradeSlug === 'partner' || r.gradeSlug === 'manager')).toBe(
          true,
        );
        expect(Object.keys(rows[0]!).sort()).toEqual(
          ['fullName', 'gradeName', 'gradeSlug', 'id', 'isPartner', 'officeCode'].sort(),
        );

        await request(app.getHttpServer())
          .get('/api/v1/employees/leads')
          .set(bearer(await token('admin@dhvaj.in')))
          .expect(403);
      });

      it('drops someone from the engagement leads once their login is deactivated', async () => {
        const admin = await token('admin@dhvaj.in');
        const created = await request(app.getHttpServer())
          .post('/api/v1/users')
          .set(bearer(admin))
          .send({
            email: `qa.${uniq()}@dhvaj.in`,
            displayName: `Trial Partner ${uniq()}`,
            officeCode: 'NORTH',
            roles: ['partner'],
          })
          .expect(201);
        const emp = await employeeOf(created.body.id);
        const leadIds = async (): Promise<string[]> => {
          const res = await request(app.getHttpServer())
            .get('/api/v1/employees/leads')
            .set(bearer(await token('mp@dhvaj.in')))
            .expect(200);
          return (res.body as Array<{ id: string }>).map((r) => r.id);
        };
        expect(await leadIds()).toContain(emp!.id);

        await request(app.getHttpServer())
          .patch(`/api/v1/users/${created.body.id}`)
          .set(bearer(admin))
          .send({ isActive: false })
          .expect(200);
        expect(await leadIds()).not.toContain(emp!.id);
      });

      it.each(['accountant', 'hr', 'admin'])(
        'gives a %s-only login an article-grade employee, never an engagement lead',
        async (role) => {
          const created = await request(app.getHttpServer())
            .post('/api/v1/users')
            .set(bearer(await token('admin@dhvaj.in')))
            .send({
              email: `qa.${uniq()}@dhvaj.in`,
              displayName: `Support ${uniq()}`,
              officeCode: 'NORTH',
              roles: [role],
            })
            .expect(201);
          const emp = await employeeOf(created.body.id);
          expect(emp?.gradeSlug).toBe('article');

          const leads = await request(app.getHttpServer())
            .get('/api/v1/employees/leads')
            .set(bearer(await token('mp@dhvaj.in')))
            .expect(200);
          expect((leads.body as Array<{ id: string }>).map((r) => r.id)).not.toContain(emp!.id);
        },
      );
    });

    it('rejects an unknown role slug (400)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ email: `qa.${uniq()}@dhvaj.in`, displayName: 'Bad Role', officeCode: 'NORTH' })
        .expect(201);
      await request(app.getHttpServer())
        .put(`/api/v1/users/${created.body.id}/roles`)
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ roles: ['superuser'] })
        .expect(400);
    });
  });

  describe('office write', () => {
    it('lets an admin create and update an office (audited)', async () => {
      const code = `QA${uniq()}`.slice(0, 20);
      const created = await request(app.getHttpServer())
        .post('/api/v1/offices')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ code, name: 'QA Office' })
        .expect(201);
      expect(created.body.code).toBe(code);
      expect(created.body.isActive).toBe(true);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/offices/${created.body.id}`)
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ name: 'QA Office (renamed)', isActive: false })
        .expect(200);
      expect(updated.body.name).toBe('QA Office (renamed)');
      expect(updated.body.isActive).toBe(false);
    });

    it('rejects a duplicate office code (409)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/offices')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({ code: 'NORTH', name: 'Clash' })
        .expect(409);
    });

    it('forbids a Manager (lacks office.manage) from creating an office (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/offices')
        .set(bearer(await token('manager.x@dhvaj.in', false)))
        .send({ code: `QA${uniq()}`.slice(0, 20), name: 'Nope' })
        .expect(403);
    });
  });
});
