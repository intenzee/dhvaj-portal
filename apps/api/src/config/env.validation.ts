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

  // Non-production convenience: when true AND not production, the dev-token
  // sign-in and dev JWTs are ALSO accepted alongside the active provider (so a
  // local build can use Microsoft Entra SSO and the seeded persona logins at the
  // same time). Ignored/forced off in production — fail-closed.
  AUTH_DEV_FALLBACK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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

  // ── Document storage (Phase 10) ──────────────────────────────────────────
  // Where document bytes live. `local` is a filesystem provider for dev/test;
  // `azure_blob` is the production path. The database only ever holds metadata.
  STORAGE_PROVIDER: z.enum(['local', 'azure_blob']).default('local'),
  // Base directory for the local provider (defaults to an OS temp dir if blank).
  STORAGE_LOCAL_DIR: z.string().optional(),
  // Azure Blob (required only when STORAGE_PROVIDER=azure_blob; validated at use).
  STORAGE_AZURE_CONNECTION_STRING: z.string().optional(),
  STORAGE_AZURE_CONTAINER: z.string().optional(),
  // Hard ceiling on a single uploaded document version (bytes). Default 10 MiB.
  DOCUMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),

  // ── Notifications (Phase 11) ─────────────────────────────────────────────
  // Enabled delivery channels (comma-separated). `portal` (the in-app row) is
  // always on; add `email` and/or `teams` to fan out to those (stub transports
  // for now). Example: NOTIFICATION_CHANNELS=portal,email
  NOTIFICATION_CHANNELS: z.string().default('portal'),
  // How many days ahead the sweep flags an internal SLA / statutory deadline as
  // "approaching".
  NOTIFICATION_SLA_LEAD_DAYS: z.coerce.number().int().nonnegative().default(3),
  NOTIFICATION_DEADLINE_LEAD_DAYS: z.coerce.number().int().nonnegative().default(7),

  // Recurring-work FUTURE HORIZON (spec §18): recurring component work is
  // generated only for periods starting within this many months of today, and a
  // rolling job extends it as time advances. Default 12 months keeps a current
  // financial year fully materialised while bounding far-future generation.
  COMPLIANCE_HORIZON_MONTHS: z.coerce.number().int().positive().max(120).default(12),

  // Escalation ladder (spec §24): an OPEN obligation this many days past its
  // operative deadline is "critical" — escalated beyond the engagement leads to
  // the firm (managing partner). Below the threshold it is plain "overdue".
  COMPLIANCE_CRITICAL_OVERDUE_DAYS: z.coerce.number().int().positive().max(365).default(7),
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
