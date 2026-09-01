import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedIdentityFixtures } from './seed.helper';
import { createTestApp } from './create-test-app';

/**
 * Organisation & people through the HTTP API: RLS-scoped employee reads,
 * permission-gated writes, audited create/update, and validation.
 */
describe('Organisation & People (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string, mfa?: boolean): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email, ...(mfa === undefined ? {} : { mfa }) })
      .expect(201);
    return res.body.accessToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const codes = (items: Array<{ employeeCode: string }>): string[] =>
    items.map((e) => e.employeeCode).sort();

  beforeAll(async () => {
    await seedIdentityFixtures();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('reads (RLS-scoped, paginated)', () => {
    it('gives the Managing Partner every employee (paginated envelope)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set(bearer(await token('mp@dhvaj.in')))
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(8);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.limit).toBe(20);
      expect(res.body.offset).toBe(0);
    });

    it('honours limit/offset while reporting the full total', async () => {
      const mp = await token('mp@dhvaj.in');
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees?limit=2&offset=0')
        .set(bearer(mp))
        .expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.total).toBeGreaterThanOrEqual(8); // total ignores the limit
    });

    it('scopes a Partner to their office', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees?limit=100')
        .set(bearer(await token('partner.a@dhvaj.in')))
        .expect(200);
      const c = codes(res.body.items);
      expect(c).toContain('EMP001'); // North
      expect(c).not.toContain('EMP004'); // South
    });

    it('lists partners', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/partners')
        .set(bearer(await token('mp@dhvaj.in')))
        .expect(200);
      expect((res.body as Array<{ isPartner: boolean }>).every((e) => e.isPartner)).toBe(true);
    });

    it('filters by grade', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees?grade=partner&limit=100')
        .set(bearer(await token('mp@dhvaj.in')))
        .expect(200);
      expect(
        (res.body.items as Array<{ gradeSlug: string }>).every((e) => e.gradeSlug === 'partner'),
      ).toBe(true);
    });

    it('returns 404 for a cross-office employee by id (scope not leaked)', async () => {
      const all = await request(app.getHttpServer())
        .get('/api/v1/employees?limit=100')
        .set(bearer(await token('mp@dhvaj.in')));
      const south = (all.body.items as Array<{ employeeCode: string; id: string }>).find(
        (e) => e.employeeCode === 'EMP004',
      )!;
      await request(app.getHttpServer())
        .get(`/api/v1/employees/${south.id}`)
        .set(bearer(await token('partner.a@dhvaj.in')))
        .expect(404);
    });
  });

  describe('writes (permission-gated + audited)', () => {
    it('forbids a Manager (no employee.manage) from creating (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(await token('manager.x@dhvaj.in')))
        .send({
          employeeCode: 'EMP900',
          fullName: 'X',
          gradeSlug: 'senior',
          officeCode: 'NORTH',
          dateOfJoining: '2024-01-01',
        })
        .expect(403);
    });

    it('lets an admin create an employee, and audits it', async () => {
      const code = `EMP${Date.now().toString().slice(-6)}`;
      const correlationId = `corr-create-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(await token('admin@dhvaj.in')))
        .set('x-correlation-id', correlationId)
        .send({
          employeeCode: code,
          fullName: 'Test Hire',
          gradeSlug: 'senior',
          officeCode: 'NORTH',
          dateOfJoining: '2024-03-01',
        })
        .expect(201);
      expect(created.body.employeeCode).toBe(code);

      // The create is audited and tied to the request correlation id.
      const audit = await request(app.getHttpServer())
        .get('/api/v1/audit')
        .set(bearer(await token('mp@dhvaj.in')))
        .expect(200);
      const event = (
        audit.body.items as Array<{ action: string; objectId: string; correlationId: string }>
      ).find((e) => e.action === 'employee.created' && e.correlationId === correlationId);
      expect(event).toBeDefined();
      expect(event!.objectId).toBe(created.body.id);
    });

    it('round-trips dates without timezone drift (IST regression)', async () => {
      const code = `EMP${Date.now().toString().slice(-6)}`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({
          employeeCode: code,
          fullName: 'Date Test',
          gradeSlug: 'article',
          officeCode: 'NORTH',
          dateOfJoining: '2024-06-01',
        })
        .expect(201);
      // Would have been '2024-05-31' before the pg date-parser fix.
      expect(created.body.dateOfJoining).toBe('2024-06-01');
    });

    it('enforces optimistic concurrency (stale version ⇒ 409)', async () => {
      const code = `EMP${Date.now().toString().slice(-6)}`;
      const admin = await token('admin@dhvaj.in');
      const created = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(admin))
        .send({
          employeeCode: code,
          fullName: 'Version Test',
          gradeSlug: 'article',
          officeCode: 'NORTH',
          dateOfJoining: '2024-01-01',
        })
        .expect(201);
      const v0 = created.body.version as number;

      // Correct version succeeds and bumps the version.
      const ok = await request(app.getHttpServer())
        .patch(`/api/v1/employees/${created.body.id}`)
        .set(bearer(admin))
        .send({ fullName: 'Version Test v2', version: v0 })
        .expect(200);
      expect(ok.body.version).toBe(v0 + 1);

      // Re-using the now-stale version is rejected.
      await request(app.getHttpServer())
        .patch(`/api/v1/employees/${created.body.id}`)
        .set(bearer(admin))
        .send({ fullName: 'Version Test v3', version: v0 })
        .expect(409);
    });

    it('rejects a duplicate employee code (409)', async () => {
      const code = `EMP${Date.now().toString().slice(-6)}`;
      const body = {
        employeeCode: code,
        fullName: 'Dup',
        gradeSlug: 'article',
        officeCode: 'SOUTH',
        dateOfJoining: '2024-01-01',
      };
      const admin = await token('admin@dhvaj.in');
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(admin))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(admin))
        .send(body)
        .expect(409);
    });

    it('rejects setting status=exited without a date of exit (400)', async () => {
      const code = `EMP${Date.now().toString().slice(-6)}`;
      const admin = await token('admin@dhvaj.in');
      const created = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(admin))
        .send({
          employeeCode: code,
          fullName: 'Leaver',
          gradeSlug: 'article',
          officeCode: 'NORTH',
          dateOfJoining: '2024-01-01',
        })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/employees/${created.body.id}`)
        .set(bearer(admin))
        .send({ employmentStatus: 'exited' })
        .expect(400);
      // With a date it succeeds.
      const ok = await request(app.getHttpServer())
        .patch(`/api/v1/employees/${created.body.id}`)
        .set(bearer(admin))
        .send({ employmentStatus: 'exited', dateOfExit: '2025-01-01' })
        .expect(200);
      expect(ok.body.employmentStatus).toBe('exited');
    });

    it('validates the request body (bad grade → 400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(await token('admin@dhvaj.in')))
        .send({
          employeeCode: 'EMP901',
          fullName: 'X',
          gradeSlug: 'wizard',
          officeCode: 'NORTH',
          dateOfJoining: '2024-01-01',
        })
        .expect(400);
    });
  });
});
