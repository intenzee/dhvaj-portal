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

  // ── OnlyOffice Document Server (in-app Office editing) ────────────────────
  // Embeds the OnlyOffice editor for Excel/Word/PDF with full desktop fidelity.
  // Off in production unless explicitly enabled; on by default in dev so the
  // feature works out of the box once `npm run oo:up` is running.
  ONLYOFFICE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Browser-facing base URL of the Document Server (used to load its editor
  // script) — must be reachable from the user's browser.
  ONLYOFFICE_DS_PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  // URL the Document Server uses to reach THIS api for the file download and the
  // save callback. From inside the DS container the host API is host.docker.internal.
  ONLYOFFICE_API_INTERNAL_URL: z.string().url().default('http://host.docker.internal:3001'),
  // Shared secret between this API and the Document Server (its JWT_SECRET),
  // signing the editor config and the save callback. The dev default is
  // INSECURE and MUST be overridden (on both sides) in production; empty string
  // disables DS-side JWT (dev only).
  ONLYOFFICE_JWT_SECRET: z.string().default('dev-onlyoffice-shared-secret-change-me'),

  // ── Microsoft 365 / SharePoint Online (genuine Office web editing) ────────
  // When enabled, Office files (Word/Excel/PowerPoint) open in Microsoft's real
  // Office-for-the-web editor with co-authoring. The bytes live in a single
  // locked-down SharePoint document library inside the firm's own M365 tenant.
  // End users are NOT members of that site, so they cannot browse it — the API
  // RLS-checks access, then mints a SHORT-LIVED ANONYMOUS ("Anyone with the
  // link") sharing link to just one file (via Microsoft Graph) so it opens in
  // real Office 365 for the web with NO per-user Microsoft sign-in — the portal
  // is the single gatekeeper. PostgreSQL stays the record of truth; SharePoint
  // is only the editing/viewing surface (see the `documents/m365` bridge).
  // OnlyOffice remains the automatic fallback when this is off/unavailable.
  //
  // OFF by default: the feature is inert until the SharePoint site + Entra app
  // registration are provisioned and these values are supplied. Secrets have no
  // defaults. Storage is covered by the M365 Enterprise licences (no separate
  // Azure subscription needed).
  M365_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Directory (tenant) id of the firm's Microsoft 365 tenant.
  M365_TENANT_ID: z.string().optional(),
  // Application (client) id of the Entra app registration used for app-only
  // Graph calls (byte upload/download + sharing-link creation).
  M365_CLIENT_ID: z.string().optional(),
  // Client secret for that app registration (a certificate is preferable in
  // production; this scaffold uses the client-credentials secret flow).
  M365_CLIENT_SECRET: z.string().optional(),
  // The locked-down SharePoint site id whose document library holds live editing
  // copies. Used to resolve the drive id when M365_DRIVE_ID is not pinned.
  M365_SITE_ID: z.string().optional(),
  // The document-library drive id the portal writes into. Preferred: pin it to
  // skip a per-boot site→drive lookup. If blank, it is resolved from M365_SITE_ID.
  M365_DRIVE_ID: z.string().optional(),
  // How long a minted anonymous sharing link stays valid, in minutes. The link
  // opens the file in Office 365 for the web with NO per-user login, so the
  // portal keeps it SHORT-LIVED to limit the value of a copied URL — the user
  // simply gets a fresh link the next time they open the document. 0 disables
  // expiry (not recommended). Default: 120 minutes.
  M365_LINK_EXPIRY_MINUTES: z.coerce.number().int().min(0).default(120),
  // Allow anonymous EDIT links (co-authoring + commit) for users who may manage
  // the engagement. When on, editable files open editable in Office for the web;
  // if the tenant/site refuses anonymous edit links the bridge transparently
  // falls back to a VIEW link so the file still opens. Set to false to force
  // view-only everywhere.
  M365_ALLOW_ANON_EDIT: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Microsoft Graph + login endpoints (overridable for national clouds).
  M365_GRAPH_BASE_URL: z.string().url().default('https://graph.microsoft.com/v1.0'),
  M365_LOGIN_BASE_URL: z.string().url().default('https://login.microsoftonline.com'),

  // ── Document text extraction / OCR (Azure Document Intelligence) ──────────
  // When enabled, uploaded documents are run through Azure Document Intelligence
  // to extract their text (for full-text search) and key fields (to pre-fill the
  // type and pull GSTIN/period). OFF by default: the feature is inert until an
  // endpoint + key are supplied. Extraction failures never block an upload.
  DOC_AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Azure Document Intelligence resource endpoint, e.g. https://<res>.cognitiveservices.azure.com
  DOC_AI_ENDPOINT: z.string().url().optional(),
  // Resource key (Ocp-Apim-Subscription-Key). No default — supplied as a secret.
  DOC_AI_KEY: z.string().optional(),
  // Prebuilt model to run. `prebuilt-read` is pure OCR/text; `prebuilt-document`
  // (a.k.a. layout) also returns key-value pairs used to pre-fill fields.
  DOC_AI_MODEL: z.string().default('prebuilt-read'),
  DOC_AI_API_VERSION: z.string().default('2024-11-30'),
  // Max seconds to wait for the async analyze operation before giving up.
  DOC_AI_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(300).default(60),

  // ── Client upload portal (secure magic-link) ─────────────────────────────
  // When enabled, staff can mint tokenised, expiring, upload-only links for a
  // client dependency; clients upload without logging in. OFF by default: the
  // PUBLIC endpoints 404 until this is turned on. This is a public write path —
  // review it (see the migration note) before enabling in production.
  CLIENT_UPLOAD_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Default validity of a new link, in hours (staff can shorten per link).
  CLIENT_UPLOAD_DEFAULT_TTL_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
  // Default max uploads per link (0 = unlimited).
  CLIENT_UPLOAD_DEFAULT_MAX_UPLOADS: z.coerce.number().int().min(0).max(1000).default(20),

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

  // Background scheduler (spec §17/§18/§24): when enabled, a cron authenticates
  // as the firm-wide operator (managing partner) and runs the notification sweep
  // and the rolling-horizon generation automatically. Off by default so nothing
  // fires unexpectedly in dev/test; enable in the deployed environment.
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Cron expressions (standard 5-field, evaluated in the server timezone). The
  // sweep runs often (hourly) so escalations are timely; the horizon roll is a
  // once-a-day housekeeping job.
  SCHEDULER_SWEEP_CRON: z.string().default('0 * * * *'),
  SCHEDULER_HORIZON_CRON: z.string().default('30 1 * * *'),
  // The outbox drain runs frequently so external delivery latency stays low.
  SCHEDULER_OUTBOX_CRON: z.string().default('*/5 * * * *'),
  // Bearer secret for GET /internal/cron — the HTTP trigger serverless hosts
  // (Vercel Cron) use in place of the in-process scheduler. Unset = disabled.
  CRON_SECRET: z.string().min(16).optional(),

  // Auto-generated deadline layers (spec §16/§17 step 8): when a STATUTORY
  // obligation is generated, add the standard review milestones as separate
  // calendar events — a manager review, and an EP review when the service
  // requires full EP review. Each lead is counted in WORKING days back from the
  // statutory date (manager reviews earlier, EP later/closer to filing).
  COMPLIANCE_AUTO_LAYERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  COMPLIANCE_MANAGER_REVIEW_LEAD_DAYS: z.coerce.number().int().nonnegative().max(60).default(5),
  COMPLIANCE_EP_REVIEW_LEAD_DAYS: z.coerce.number().int().nonnegative().max(60).default(2),

  // Auto-generated tasks (spec §17 step 10): when a STATUTORY obligation is
  // generated, create the one material "complete this obligation" task, assigned
  // to the accountable owner and due at the internal SLA date. Routine checklist
  // items stay in Workflow (§21) — this is the single actionable task per filing.
  COMPLIANCE_AUTO_TASKS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
