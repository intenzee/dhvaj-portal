import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { seedIdentityFixtures } from './seed.helper';

/**
 * Identity & security through the HTTP API: authentication, MFA, permission
 * enforcement, RLS-scoped listing, and the audit trail — the Phase 1 acceptance
 * criteria, end to end.
 */
describe('Identity & Security (e2e)', () => {
  let app: INestApplication;

  const token = async (email: string, mfa?: boolean): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-token')
      .send({ email, ...(mfa === undefined ? {} : { mfa }) })
      .expect(201);
    return res.body.accessToken as string;
  };

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

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

  describe('authentication', () => {
    it('rejects an unauthenticated request (401)', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    });

    it('rejects a garbage token (401)', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').set(bearer('not-a-jwt')).expect(401);
    });

    it('returns the principal for a valid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      expect(res.body.principal.email).toBe('partner.a@hsdg.in');
      expect(res.body.principal.effectiveRole).toBe('partner');
      expect(res.body.context.role).toBe('partner');
    });
  });

  describe('MFA enforcement', () => {
    it('allows a non-MFA user without an MFA claim', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(bearer(await token('manager.x@hsdg.in', false)))
        .expect(200);
    });

    it('blocks an MFA-required user whose token lacks MFA (401)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set(bearer(await token('partner.a@hsdg.in', false)))
        .expect(401);
      expect(res.body.message).toMatch(/multi-factor/i);
    });
  });

  describe('authorisation (permissions)', () => {
    it('allows a Partner (has user.read) to list users', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
    });

    it('forbids a Senior (lacks user.read) from listing users (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(bearer(await token('senior.y@hsdg.in')))
        .expect(403);
    });
  });

  describe('RLS-scoped listing via the API', () => {
    it('scopes a Partner to their office', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(200);
      const emails = (res.body as Array<{ email: string }>).map((u) => u.email);
      expect(emails).toContain('partner.a@hsdg.in');
      expect(emails).not.toContain('partner.b@hsdg.in');
    });

    it('gives the Managing Partner every user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect((res.body as unknown[]).length).toBeGreaterThanOrEqual(6);
    });

    it('returns 404 for a cross-office user fetched by id (scope not leaked)', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(bearer(await token('mp@hsdg.in')));
      const partnerB = (list.body as Array<{ email: string; id: string }>).find(
        (u) => u.email === 'partner.b@hsdg.in',
      )!;
      await request(app.getHttpServer())
        .get(`/api/v1/users/${partnerB.id}`)
        .set(bearer(await token('partner.a@hsdg.in')))
        .expect(404);
    });
  });

  describe('audit trail', () => {
    it('lets the Managing Partner read the audit trail', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit')
        .set(bearer(await token('mp@hsdg.in')))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('forbids a Manager from reading the audit trail (403)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit')
        .set(bearer(await token('manager.x@hsdg.in')))
        .expect(403);
    });
  });
});
