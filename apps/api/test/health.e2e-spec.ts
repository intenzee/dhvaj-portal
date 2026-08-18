import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CORRELATION_ID_HEADER } from '../src/common/logging/logger.config';
import { createTestApp } from './create-test-app';

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
    app = await createTestApp();
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
