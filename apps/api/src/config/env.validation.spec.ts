import { productionConfigWarnings, trustProxySetting, validateEnv } from './env.validation';

const validBase = {
  DATABASE_URL: 'postgres://hsdg_app:pw@localhost:5432/hsdg',
  AUTH_JWT_SECRET: 'a-sufficiently-long-secret',
};

describe('validateEnv (fail-closed configuration)', () => {
  it('accepts a minimal valid environment and applies safe defaults', () => {
    const env = validateEnv({ ...validBase });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.API_GLOBAL_PREFIX).toBe('api');
    // String booleans are coerced to real booleans.
    expect(env.LOG_PRETTY).toBe(false);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.DATABASE_SSL).toBe(false);
  });

  it('coerces numeric strings to numbers', () => {
    const env = validateEnv({ ...validBase, PORT: '8080', DATABASE_POOL_MAX: '25' });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_MAX).toBe(25);
  });

  it('REFUSES to start when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/Invalid environment configuration/);
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('REFUSES to start when DATABASE_URL is not a URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('REFUSES to start on an out-of-range PORT', () => {
    expect(() => validateEnv({ ...validBase, PORT: '70000' })).toThrow(/PORT/);
  });

  it('REFUSES to start on an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...validBase, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('REFUSES to start without an AUTH_JWT_SECRET', () => {
    expect(() => validateEnv({ DATABASE_URL: validBase.DATABASE_URL })).toThrow(/AUTH_JWT_SECRET/);
  });

  it('REFUSES to start on a too-short AUTH_JWT_SECRET', () => {
    expect(() => validateEnv({ ...validBase, AUTH_JWT_SECRET: 'short' })).toThrow(
      /AUTH_JWT_SECRET/,
    );
  });
});

const SECRET = 'x'.repeat(40);
const KEY = `1:${Buffer.alloc(32, 7).toString('base64')}`;

/** A production environment that passes every rule (Entra, SharePoint storage). */
const prodBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://hsdg_app:pw@db.example.com:5432/hsdg',
  DATABASE_SSL: 'true',
  AUTH_JWT_SECRET: SECRET,
  AUTH_PROVIDER: 'entra',
  AUTH_ENTRA_TENANT_ID: 'tenant',
  AUTH_ENTRA_CLIENT_ID: 'client',
  CORS_ORIGINS: 'https://portal.example.com',
  WEB_PUBLIC_URL: 'https://portal.example.com',
  CREDENTIALS_KEYS: KEY,
  STORAGE_PROVIDER: 'sharepoint',
  M365_TENANT_ID: 'tenant',
  M365_CLIENT_ID: 'client',
  M365_CLIENT_SECRET: 'secret',
  M365_SITE_URL: 'https://example.sharepoint.com/sites/portal',
};

describe('validateEnv in production (fail fast on unsafe settings)', () => {
  it('accepts a complete production environment', () => {
    expect(validateEnv({ ...prodBase }).NODE_ENV).toBe('production');
  });

  it('REFUSES the default (localhost) or a wildcard CORS allowlist', () => {
    const noCors: Record<string, string> = { ...prodBase };
    delete noCors.CORS_ORIGINS;
    expect(() => validateEnv(noCors)).toThrow(/CORS_ORIGINS must be set/);
    expect(() => validateEnv({ ...prodBase, CORS_ORIGINS: '*' })).toThrow(
      /CORS_ORIGINS entry "\*"/,
    );
    expect(() => validateEnv({ ...prodBase, CORS_ORIGINS: 'http://portal.example.com' })).toThrow(
      /https origin/,
    );
    expect(() => validateEnv({ ...prodBase, CORS_ORIGINS: 'https://portal.example.com/' })).toThrow(
      /https origin/,
    );
  });

  it('REFUSES a short or repo-known JWT secret', () => {
    expect(() => validateEnv({ ...prodBase, AUTH_JWT_SECRET: 'sixteen-chars-ok' })).toThrow(
      /AUTH_JWT_SECRET/,
    );
    expect(() =>
      validateEnv({ ...prodBase, AUTH_JWT_SECRET: 'dev-only-change-me-in-real-environments' }),
    ).toThrow(/AUTH_JWT_SECRET/);
  });

  it('REFUSES the owner/migrator database role and a remote database without TLS', () => {
    expect(() =>
      validateEnv({ ...prodBase, DATABASE_URL: 'postgres://postgres:pw@db.example.com/hsdg' }),
    ).toThrow(/least-privilege/);
    expect(() =>
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgres://neondb_owner:pw@db.example.com/hsdg',
        DATABASE_ADMIN_URL: 'postgres://neondb_owner:pw@db.example.com/hsdg',
      }),
    ).toThrow(/least-privilege/);
    expect(() => validateEnv({ ...prodBase, DATABASE_SSL: 'false' })).toThrow(/DATABASE_SSL/);
  });

  it('REFUSES Entra sign-in without its ids or durable storage; the vault key only warns', () => {
    const noVault = validateEnv({ ...prodBase, CREDENTIALS_KEYS: '' });
    expect(productionConfigWarnings(noVault).join('\n')).toMatch(/CREDENTIALS_KEYS is not set/);
    expect(productionConfigWarnings(validateEnv({ ...prodBase })).join('\n')).not.toMatch(
      /CREDENTIALS_KEYS/,
    );
    expect(() => validateEnv({ ...prodBase, AUTH_ENTRA_TENANT_ID: '' })).toThrow(
      /AUTH_ENTRA_TENANT_ID/,
    );
    expect(() => validateEnv({ ...prodBase, STORAGE_PROVIDER: 'local' })).toThrow(
      /STORAGE_LOCAL_DIR/,
    );
    expect(() => validateEnv({ ...prodBase, WEB_PUBLIC_URL: '' })).toThrow(/WEB_PUBLIC_URL/);
  });

  it('REFUSES SharePoint storage or M365 editing without the M365 connection', () => {
    expect(() => validateEnv({ ...prodBase, M365_CLIENT_SECRET: '' })).toThrow(
      /STORAGE_PROVIDER=sharepoint requires M365_CLIENT_SECRET/,
    );
    const noSite: Record<string, string> = { ...prodBase };
    delete noSite.M365_SITE_URL;
    expect(() =>
      validateEnv({
        ...noSite,
        STORAGE_PROVIDER: 'local',
        STORAGE_LOCAL_DIR: '/data',
        M365_ENABLED: 'true',
      }),
    ).toThrow(/M365_ENABLED requires M365_SITE_URL/);
  });

  it('REFUSES OnlyOffice with its shipped shared secret', () => {
    expect(() => validateEnv({ ...prodBase, ONLYOFFICE_ENABLED: 'true' })).toThrow(
      /ONLYOFFICE_JWT_SECRET/,
    );
  });

  it('lets the dev-persona demo boot, with a warning', () => {
    const demo = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://hsdg_app:pw@db.example.com:5432/hsdg',
      DATABASE_SSL: 'true',
      AUTH_JWT_SECRET: SECRET,
      CORS_ORIGINS: 'https://demo.example.com',
      STORAGE_PROVIDER: 'local',
    };
    const env = validateEnv(demo);
    expect(productionConfigWarnings(env).join('\n')).toMatch(/AUTH_PROVIDER=dev/);
  });

  it('does not apply the production rules outside production', () => {
    expect(() => validateEnv({ ...validBase, CORS_ORIGINS: '*' })).not.toThrow();
  });
});

describe('trustProxySetting', () => {
  it('maps TRUST_PROXY to an Express trust proxy value', () => {
    expect(trustProxySetting(undefined)).toBeUndefined();
    expect(trustProxySetting(' ')).toBeUndefined();
    expect(trustProxySetting('1')).toBe(1);
    expect(trustProxySetting('true')).toBe(true);
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});
