import { validateEnv } from './env.validation';

const validBase = {
  DATABASE_URL: 'postgres://hsdg_app:pw@localhost:5432/hsdg',
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
});
