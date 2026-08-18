import { z } from 'zod';

/**
 * Authoritative schema for process environment.
 *
 * Fail-closed principle: the API refuses to boot if configuration is missing or
 * malformed, rather than starting with unsafe defaults. Secrets have no
 * defaults; only non-sensitive operational knobs do.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // HTTP
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  API_GLOBAL_PREFIX: z.string().default('api'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Database — the application MUST connect as the least-privilege app role,
  // never as the database owner/superuser. See ADR-0001 §Security.
  DATABASE_URL: z.string().url().describe('postgres://hsdg_app:...@host:5432/hsdg'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(15000),

  // OpenAPI / Swagger UI exposure
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // ── Authentication ───────────────────────────────────────────────────────
  // Which identity provider verifies incoming tokens. `dev` uses locally-signed
  // JWTs (development/testing only); `entra` validates Microsoft Entra ID tokens.
  AUTH_PROVIDER: z.enum(['dev', 'entra']).default('dev'),

  // Signing/verification secret for the dev provider's JWTs. No default — a
  // secret must be supplied explicitly (fail-closed). Min length guards against
  // trivially weak keys.
  AUTH_JWT_SECRET: z.string().min(16),
  AUTH_JWT_ISSUER: z.string().default('hsdg-portal'),
  AUTH_JWT_AUDIENCE: z.string().default('hsdg-portal'),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Entra ID (required only when AUTH_PROVIDER=entra; validated at provider use).
  AUTH_ENTRA_TENANT_ID: z.string().optional(),
  AUTH_ENTRA_CLIENT_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validation callback wired into @nestjs/config. Throws (aborting boot) on any
 * invalid value, with a readable aggregation of every problem found.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration. Refusing to start:\n${issues}`);
  }
  return parsed.data;
}
