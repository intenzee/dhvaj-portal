import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { seedIdentityFixtures } from './seed.helper';

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
  const codes = (body: unknown): string[] =>
    (body as Array<{ employeeCode: string }>).map((e) => e.employeeCode).sort();

  beforeAll(async () => {
    await seedIdentityFixtures();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'v' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('reads (RLS-scoped)', () => {
    it('gives the Managing Partner every employee', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(8);
    });

    it('scopes a Partner to their office', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      const c = codes(res.body);
      expect(c).toContain('EMP001'); // North
      expect(c).not.toContain('EMP004'); // South
    });

    it('lists partners', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/partners')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect((res.body as Array<{ isPartner: boolean }>).every((e) => e.isPartner)).toBe(true);
    });

    it('filters by grade', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees?grade=partner')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(
        (res.body as Array<{ gradeSlug: string }>).every((e) => e.gradeSlug === 'partner'),
      ).toBe(true);
    });

    it('returns 404 for a cross-office employee by id (scope not leaked)', async () => {
      const all = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set(bearer(await token('mp@hsdg.in')));
      const south = (all.body as Array<{ employeeCode: string; id: string }>).find(
        (e) => e.employeeCode === 'EMP004',
      )!;
      await request(app.getHttpServer())
        .get(`/api/v1/employees/${south.id}`)
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(404);
    });
  });

  describe('writes (permission-gated + audited)', () => {
    it('forbids a Manager (no employee.manage) from creating (403)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set(bearer(await token('manager.x@hsdg.in')))
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
        .set(bearer(await token('admin@hsdg.in')))
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
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      const event = (
        audit.body as Array<{ action: string; objectId: string; correlationId: string }>
      ).find((e) => e.action === 'employee.created' && e.correlationId === correlationId);
      expect(event).toBeDefined();
      expect(event!.objectId).toBe(created.body.id);
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
      const admin = await token('admin@hsdg.in');
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
      const admin = await token('admin@hsdg.in');
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
        .set(bearer(await token('admin@hsdg.in')))
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
