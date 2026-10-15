/**
 * Default environment for unit tests. Specs that build the config module need a
 * valid environment to boot; real values (CI, local) win, these only fill gaps
 * so `npm test` passes without a hand-crafted env. Nothing here connects.
 */
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'error';
process.env.AUTH_JWT_SECRET ??= 'test-only-secret-at-least-16-chars';
process.env.DATABASE_URL ??= 'postgres://hsdg_app:hsdg_app_dev_pw@localhost:5433/hsdg';
