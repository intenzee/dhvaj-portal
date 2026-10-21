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
  // Express `trust proxy`: how many reverse proxies sit in front of the API
  // (Render/Vercel/a load balancer: usually 1), `true`, `false`, or a comma list
  // of proxy addresses/subnets. Unset ⇒ not trusted. Behind a proxy it must be
  // set so the rate limiter and the logs see the client's address, not the
  // proxy's (otherwise every user shares one rate-limit bucket).
  TRUST_PROXY: z.string().optional(),
  // Requests per minute per client address across the API. The public routes
  // (client upload links, the cron trigger) have their own, tighter limits.
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),

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

  // Email + password sign-in alongside Microsoft. Nobody can use it until an
  // admin gives them a password (Users & Roles); `false` turns it off entirely
  // (the endpoints 404 and password sessions are refused).
  AUTH_PASSWORD_LOGIN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // ── Clients' portal logins (ADR-0035) ────────────────────────────────────
  // AES-256-GCM keys for the GST (and later other) portal logins the firm saves
  // for its clients: `1:<base64 of 32 random bytes>`, comma-separated to rotate
  // (the highest version encrypts, every listed version decrypts). The key is
  // never stored in the database. Unset ⇒ logins can be neither saved nor shown;
  // the rest of the portal is unaffected. Generate one with
  //   node -e "console.log('1:' + require('crypto').randomBytes(32).toString('base64'))"
  CREDENTIALS_KEYS: z
    .string()
    .optional()
    .refine(
      (v) =>
        v === undefined ||
        v.trim() === '' ||
        v.split(',').every((part) => /^\s*[1-9][0-9]*:[A-Za-z0-9+/]{43}=\s*$/.test(part)),
      'CREDENTIALS_KEYS must be "<version>:<base64 of 32 bytes>", comma-separated',
    ),

  // Entra ID (required only when AUTH_PROVIDER=entra; validated at provider use).
  AUTH_ENTRA_TENANT_ID: z.string().optional(),
  AUTH_ENTRA_CLIENT_ID: z.string().optional(),

  // ── Document storage (Phase 10) ──────────────────────────────────────────
  // Where document bytes live. `local` is a filesystem provider for dev/test;
  // `azure_blob` is the production path. The database only ever holds metadata.
  // `sharepoint` stores every version in the firm's SharePoint Online site
  // (uses the M365_* connection settings below).
  STORAGE_PROVIDER: z.enum(['local', 'azure_blob', 'sharepoint']).default('local'),
  // Folder in the SharePoint document library that holds stored versions
  // (separate from the editor's live co-authoring copies under `portal/`).
  STORAGE_SHAREPOINT_ROOT: z.string().default('vault'),
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
  // Retired: the portal opens Office files in Microsoft 365 only (M365_* below),
  // and the web no longer embeds OnlyOffice. Off unless explicitly enabled.
  ONLYOFFICE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
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
  // is the single gatekeeper. PostgreSQL stays the record of truth for metadata
  // (see the `documents/m365` bridge). When this is off/unavailable the portal
  // shows files in its built-in viewers. The same connection settings back
  // STORAGE_PROVIDER=sharepoint, which keeps every stored version in the site.
  //
  // OFF by default: the feature is inert until the SharePoint site + Entra app
  // registration are provisioned and these values are supplied. Secrets have no
  // defaults. Storage is covered by the Microsoft 365 licences (no separate
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
  // The locked-down SharePoint site, by URL (simplest — e.g.
  // https://contoso.sharepoint.com/sites/PortalFiles). Resolved to its id once.
  M365_SITE_URL: z.string().url().optional(),
  // ...or by id (`host,siteCollectionId,webId`), which skips the URL lookup.
  // Either is used to resolve the drive id when M365_DRIVE_ID is not pinned.
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

  // ── Feature flags (Engagement Restructure phases) ─────────────────────────
  // Comma list of enabled flags (ff_engagement_kinds, ff_calendar_v2,
  // ff_gst_tab, ff_compliance_tabs, ff_auto_time, ff_work_links, ff_today_view,
  // ff_filing_runs, ff_notices, ff_billing_v2), 'all', or 'none'. Unset →
  // 'all' outside production (dev/test cover the new paths) and 'none' in
  // production, so each phase is switched on deliberately per environment.
  FEATURE_FLAGS: z.string().optional(),
  // Rollout to one office first (Staff Workflow "Rollout"): limit an enabled flag
  // to users whose office is listed. `flag:CODE,CODE;flag:CODE`, e.g.
  // FEATURE_FLAG_OFFICES=ff_today_view:NORTH;ff_filing_runs:NORTH. A flag not
  // named here is on for every office (when FEATURE_FLAGS enables it).
  FEATURE_FLAG_OFFICES: z.string().optional(),
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
  // Nightly compliance calendar run (calendar v2): attach new government
  // extensions and regenerate every open Compliance engagement.
  SCHEDULER_CALENDAR_CRON: z.string().default('0 2 * * *'),
  // Change 3 automatic time: close idle (no heartbeat for 15 min) and day-end
  // entries. Runs every 5 minutes; the office day ends at this hour, IST.
  SCHEDULER_TIME_CLOSER_CRON: z.string().default('*/5 * * * *'),
  TIME_DAY_END_HOUR_IST: z.coerce.number().int().min(12).max(23).default(20),
  // Change 6 monthly GST data request: on the 1st (09:00 IST) each GSTIN with
  // the request switched on gets one upload link for last month's registers.
  SCHEDULER_GST_DATA_REQUEST_CRON: z.string().default('30 3 1 * *'),
  // Staff Workflow WF-305: yesterday's informational notices in one message,
  // 07:00 IST, once actionable notifications are on firm-wide.
  SCHEDULER_DIGEST_CRON: z.string().default('30 1 * * *'),
  // HR: leavers whose date of exit has come are exited and their login
  // switched off, 00:05 IST daily.
  SCHEDULER_PEOPLE_EXITS_CRON: z.string().default('35 18 * * *'),
  // Browser-facing base URL of the web app (links sent to clients).
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
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
  if (parsed.data.NODE_ENV === 'production') {
    const problems = productionConfigProblems(parsed.data, raw);
    if (problems.length > 0) {
      throw new Error(
        `Unsafe production configuration. Refusing to start:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      );
    }
  }
  return parsed.data;
}

/** Secrets that ship in this repo (examples, CI, tests) — never valid in production. */
const KNOWN_DEV_SECRETS = new Set([
  'dev-only-change-me-in-real-environments',
  'ci-only-secret-at-least-16-chars',
  'test-only-secret-at-least-16-chars',
  'a-sufficiently-long-secret',
  'dev-onlyoffice-shared-secret-change-me',
]);

const MIN_PROD_SECRET_LENGTH = 32;

function weakSecret(value: string | undefined): boolean {
  return !value || value.length < MIN_PROD_SECRET_LENGTH || KNOWN_DEV_SECRETS.has(value);
}

function isSet(raw: Record<string, unknown>, key: string): boolean {
  const v = raw[key];
  return typeof v === 'string' && v.trim() !== '';
}

function isLocalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

/**
 * Production-only fail-fast rules: settings whose defaults are fine for a laptop
 * but unsafe (or silently broken) with real client data. Pure — tested.
 *
 * A production API with AUTH_PROVIDER=dev is the synthetic-data demo (nobody
 * can mint a sign-in token there); the rules that only matter once real client
 * data is held (credential vault key, durable storage, client-facing links) are
 * enforced when AUTH_PROVIDER=entra.
 */
export function productionConfigProblems(env: Env, raw: Record<string, unknown>): string[] {
  const problems: string[] = [];

  // CORS: an explicit allowlist of https origins (no wildcard, no paths).
  if (!isSet(raw, 'CORS_ORIGINS')) {
    problems.push('CORS_ORIGINS must be set to the web app origin(s) (https://…).');
  } else {
    for (const origin of env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)) {
      let ok = false;
      try {
        const u = new URL(origin);
        ok = u.protocol === 'https:' && origin === `${u.protocol}//${u.host}`;
      } catch {
        ok = false;
      }
      if (!ok)
        problems.push(
          `CORS_ORIGINS entry "${origin}" must be an https origin, e.g. https://portal.example.com.`,
        );
    }
  }

  if (weakSecret(env.AUTH_JWT_SECRET)) {
    problems.push(
      `AUTH_JWT_SECRET must be a unique random value of at least ${MIN_PROD_SECRET_LENGTH} characters.`,
    );
  }

  // Database: the runtime role, over TLS (a same-host database excepted).
  let dbUrl: URL | null = null;
  try {
    dbUrl = new URL(env.DATABASE_URL);
  } catch {
    dbUrl = null;
  }
  if (dbUrl) {
    const user = decodeURIComponent(dbUrl.username);
    const privileged = new Set(['postgres', 'hsdg_migrator']);
    for (const key of ['DATABASE_MIGRATE_URL', 'DATABASE_ADMIN_URL']) {
      if (!isSet(raw, key)) continue;
      try {
        privileged.add(decodeURIComponent(new URL(String(raw[key])).username));
      } catch {
        /* not a URL — not ours to validate */
      }
    }
    if (privileged.has(user)) {
      problems.push(
        `DATABASE_URL connects as "${user}"; the API must use the least-privilege app role (hsdg_app).`,
      );
    }
    if (!env.DATABASE_SSL && !isLocalHost(dbUrl.hostname)) {
      problems.push('DATABASE_SSL must be true for a database on another host.');
    }
  }

  if (env.AUTH_PROVIDER === 'entra' && (!env.AUTH_ENTRA_TENANT_ID || !env.AUTH_ENTRA_CLIENT_ID)) {
    problems.push('AUTH_PROVIDER=entra requires AUTH_ENTRA_TENANT_ID and AUTH_ENTRA_CLIENT_ID.');
  }

  // Storage and Microsoft 365.
  if (env.M365_ENABLED || env.STORAGE_PROVIDER === 'sharepoint') {
    const missing: string[] = (
      ['M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET'] as const
    ).filter((k) => !env[k]);
    if (!env.M365_SITE_URL && !env.M365_SITE_ID && !env.M365_DRIVE_ID) {
      missing.push('M365_SITE_URL');
    }
    if (missing.length > 0) {
      const why =
        env.STORAGE_PROVIDER === 'sharepoint' ? 'STORAGE_PROVIDER=sharepoint' : 'M365_ENABLED';
      problems.push(
        `${why} requires ${missing.join(', ')} (site: one of M365_SITE_URL / M365_SITE_ID / M365_DRIVE_ID).`,
      );
    }
  }
  if (
    env.STORAGE_PROVIDER === 'azure_blob' &&
    (!env.STORAGE_AZURE_CONNECTION_STRING || !env.STORAGE_AZURE_CONTAINER)
  ) {
    problems.push(
      'STORAGE_PROVIDER=azure_blob requires STORAGE_AZURE_CONNECTION_STRING and STORAGE_AZURE_CONTAINER.',
    );
  }

  if (env.ONLYOFFICE_ENABLED && weakSecret(env.ONLYOFFICE_JWT_SECRET)) {
    problems.push(
      `ONLYOFFICE_ENABLED requires a unique ONLYOFFICE_JWT_SECRET of at least ${MIN_PROD_SECRET_LENGTH} characters.`,
    );
  }
  if (env.DOC_AI_ENABLED && (!env.DOC_AI_ENDPOINT || !env.DOC_AI_KEY)) {
    problems.push('DOC_AI_ENABLED requires DOC_AI_ENDPOINT and DOC_AI_KEY.');
  }

  // Links sent to clients must point at the real web app.
  const needsWebUrl = env.AUTH_PROVIDER === 'entra' || env.CLIENT_UPLOAD_ENABLED;
  if (needsWebUrl) {
    let ok = false;
    try {
      ok = isSet(raw, 'WEB_PUBLIC_URL') && new URL(env.WEB_PUBLIC_URL).protocol === 'https:';
    } catch {
      ok = false;
    }
    if (!ok)
      problems.push(
        'WEB_PUBLIC_URL must be set to the web app’s https URL (it goes into links sent to clients).',
      );
  }

  // Real client data (Entra sign-in): durable document storage. (The vault key,
  // CREDENTIALS_KEYS, stays optional: without it only client logins are off.)
  if (env.AUTH_PROVIDER === 'entra') {
    if (env.STORAGE_PROVIDER === 'local' && !env.STORAGE_LOCAL_DIR) {
      problems.push(
        'STORAGE_PROVIDER=local without STORAGE_LOCAL_DIR keeps documents in a temp dir that a redeploy wipes; ' +
          'use sharepoint (or point STORAGE_LOCAL_DIR at a persistent disk).',
      );
    }
  }

  return problems;
}

/**
 * Production settings that are allowed but worth a loud line in the boot log.
 * Pure — tested.
 */
export function productionConfigWarnings(env: Env): string[] {
  const warnings: string[] = [];
  if (env.AUTH_PROVIDER === 'dev') {
    warnings.push(
      'AUTH_PROVIDER=dev in production: demo posture — no one can sign in except with tokens signed by AUTH_JWT_SECRET. Synthetic data only.',
    );
  }
  if (!env.TRUST_PROXY) {
    warnings.push(
      'TRUST_PROXY is not set: behind a load balancer every request looks like it comes from the proxy, so all users share one rate-limit bucket.',
    );
  }
  if (!env.SCHEDULER_ENABLED && !env.CRON_SECRET) {
    warnings.push(
      'Neither SCHEDULER_ENABLED nor CRON_SECRET is set: deadline sweeps, reminders and the outbox drain never run.',
    );
  }
  if (!env.CREDENTIALS_KEYS || env.CREDENTIALS_KEYS.trim() === '') {
    warnings.push(
      'CREDENTIALS_KEYS is not set: clients’ portal logins can be neither saved nor shown (see docs/DEPLOY.md).',
    );
  }
  if (env.STORAGE_PROVIDER === 'local' && !env.STORAGE_LOCAL_DIR) {
    warnings.push(
      'STORAGE_PROVIDER=local without STORAGE_LOCAL_DIR: uploaded documents are lost on redeploy.',
    );
  }
  return warnings;
}

/** Express `trust proxy` value from TRUST_PROXY (undefined ⇒ leave Express's default). Pure — tested. */
export function trustProxySetting(raw: string | undefined): boolean | number | string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
