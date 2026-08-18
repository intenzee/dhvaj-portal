import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { CORRELATION_ID_HEADER } from '../src/common/logging/logger.config';

/**
 * End-to-end smoke test of the Phase 0 foundation.
 *
 * Requires a reachable PostgreSQL reached via the least-privilege `hsdg_app`
 * role (DATABASE_URL). Booting AppModule also exercises the fail-closed
 * least-privilege assertion in DatabaseService.onModuleInit — if the role were
 * a superuser or could bypass RLS, this boot would throw.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  it('GET /api/v1/health/live → 200 and echoes a correlation id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers[CORRELATION_ID_HEADER]).toBeDefined();
  });

  it('honours an inbound x-correlation-id header', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set(CORRELATION_ID_HEADER, 'trace-abc-123');
    expect(res.headers[CORRELATION_ID_HEADER]).toBe('trace-abc-123');
  });

  it('GET /api/v1/health/ready → 200 with database up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.database.status).toBe('up');
  });

  it('returns the uniform error envelope for an unknown route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'NOT_FOUND',
      path: '/api/v1/does-not-exist',
    });
    expect(res.body.correlationId).toBeDefined();
  });
});
