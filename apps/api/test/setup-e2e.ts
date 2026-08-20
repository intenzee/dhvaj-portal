/**
 * Default environment for e2e/integration tests. Real values (CI, local) win;
 * these only fill gaps so the suite can boot without a hand-crafted env.
 */
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'error';
process.env.LOG_PRETTY ??= 'false';
process.env.AUTH_JWT_SECRET ??= 'test-only-secret-at-least-16-chars';

// Local dev DB (docker-compose publishes Postgres on 5433). CI overrides these
// to point at its own service on 5432.
process.env.DATABASE_URL ??= 'postgres://hsdg_app:hsdg_app_dev_pw@localhost:5433/hsdg';
process.env.DATABASE_SUPERUSER_URL ??= 'postgres://postgres:postgres@localhost:5433/hsdg';

// Keep the document size ceiling small under test so the over-size path can be
// exercised without allocating multi-megabyte payloads (which pressure memory
// when every suite boots its own app in-band). Production uses the 10 MiB default.
process.env.DOCUMENT_MAX_BYTES ??= String(256 * 1024);
