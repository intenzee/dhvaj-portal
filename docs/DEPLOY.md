# Production deploy checklist — DHVAJ portal

For the free synthetic-data demo (Render + Neon, dev-persona sign-in) see
[`/DEPLOY.md`](../DEPLOY.md). This page is for a deploy that holds **real client
data**: PAN/GSTIN, sealed client portal logins, invoices.

Never deploy from a laptop. Render auto-deploys `main` to the demo (see
`render.yaml`); production is its own Blueprint, `render.production.yaml`,
deployed by hand (§0). The Azure workflow (`.github/workflows/deploy.yml`) runs
only by hand.

---

## 0. First go-live (once)

1. **Microsoft sign-in: two app registrations** in the firm's tenant
   (entra.microsoft.com → App registrations). These are separate from the
   SharePoint app in `microsoft-365-sharepoint-provisioning.md`.
   - **DHVAJ Portal API**: Expose an API → Application ID URI
     `api://<its client id>` → add the scope `access_as_user` (admins and users
     may consent). Its tenant and client ids are `AUTH_ENTRA_TENANT_ID` /
     `AUTH_ENTRA_CLIENT_ID`.
   - **DHVAJ Portal Web**: Authentication → add a **Single-page application**
     platform with the redirect URI `https://portal.dhvaj.in` (exactly the web
     address, no path or trailing slash). API permissions → My APIs → DHVAJ Portal API →
     `access_as_user` → **Grant admin consent**. Its ids go into
     `NEXT_PUBLIC_ENTRA_TENANT_ID` / `NEXT_PUBLIC_ENTRA_CLIENT_ID`, and
     `NEXT_PUBLIC_ENTRA_API_SCOPE` = `api://<API client id>/access_as_user`.
   - **MFA:** the portal reads MFA from the token (`amr`). A user with
     "Require multi-factor authentication" ticked (the bootstrap owner always
     is) is refused on any sign-in without it, so their MFA must happen every
     time:
     - **Entra ID P1/P2** (e.g. Microsoft 365 Business Premium): a Conditional
       Access policy requiring MFA for both apps (Portal API and Portal Web);
       then tick the box for anyone.
     - **Entra Free:** keep **security defaults** on (Entra ID → Overview →
       Properties → Manage security defaults). They ask Global Administrators
       for MFA at every sign-in, others only "when necessary"; so the owner
       must be a Global Administrator, and other users keep the box unticked.
       Don't mix in legacy per-user MFA.
2. **Database:** a paid managed Postgres 16 with point-in-time recovery, in the
   same region as the services (Render Postgres or Neon, Singapore). Copy the
   owner's **external** (TLS) connection string.
3. **Render:** New → Blueprint → this repo, Blueprint file path
   `render.production.yaml`. Fill in every value it asks for (§1 explains
   each). The blueprint already uses the firm's domains:
   - **portal.dhvaj.in** → `dhvaj-web` (Settings → Custom Domains → add it),
   - **api.dhvaj.in** → `dhvaj-api` (same),
   - at the dhvaj.in DNS provider, a **CNAME** for each — `portal` →
     `dhvaj-web.onrender.com`, `api` → `dhvaj-api.onrender.com` (Render shows
     the exact targets); Render issues the TLS certificates itself.
   Other names? Change `WEB_PUBLIC_URL`, `CORS_ORIGINS` (API) and
   `NEXT_PUBLIC_API_URL` (web) to match, and the SPA redirect URI (step 1);
   redeploy the web after any `NEXT_PUBLIC_*` change.
4. **First boot** (`SEED_MODE=production`): with no office in the database,
   `start.mjs` creates the first office (`BOOTSTRAP_OFFICE_CODE`/`_NAME`) and
   the owner (`BOOTSTRAP_OWNER_EMAIL`/`_NAME`) as managing partner + admin, with
   a partner-grade employee record. Nothing else, and never the demo: under
   Entra sign-in `start.mjs` refuses `SEED_MODE=demo`. The email **must be the
   owner's Microsoft sign-in name (UPN)**. Missing values stop the boot and are
   named in the log; nothing is half-written. Once the office exists the
   `BOOTSTRAP_*` values are no longer read.
5. **Sign in as the owner** with Microsoft, then in Admin add the other offices,
   every staff member, and the clients. For each person: **Users & Roles** →
   New user (email = their UPN, roles, office), then **People** → New employee
   (code, grade, office, joining date; pick the user under *Portal login*;
   partners also get their ICAI membership number). Anyone without a portal
   user is refused at sign-in ("not a known user"), and a deactivated user is
   refused too.

   **Email + password logins (no Microsoft account needed).** In Users & Roles
   → New user, leave *Give a portal password* ticked. After *Create user* the
   dialog shows the portal address, the email and a **temporary password**
   (e.g. `Abcd-Efgh-Jkmn`) once — copy it and hand it over. At
   portal.dhvaj.in they type the email and temporary password and must choose
   their own (≥ 10 characters, not their name or a common word) before they
   are in. Afterwards they change it with the key icon next to *Sign out*.
   - The **Sign-in** column shows *Password*, *Temporary password*, *Locked*
     or *Microsoft only*.
   - Forgotten password or *Locked*: Edit → **Reset password** gives a new
     temporary one, lifts the lock and signs them out everywhere.
   - Five wrong passwords lock the account for 15 minutes (it lifts by
     itself); `/auth/login` also allows 10 tries a minute per address.
   - Edit → **Turn off password sign-in** leaves Microsoft only. A user created
     with *Require multi-factor authentication* can only use Microsoft.
   - Passwords are stored as scrypt hashes in `hsdg.user_passwords`, readable
     only by the sign-in code; no admin ever sees one after it is shown. Every
     set, reset, change and password sign-in is in the audit log.
   - To switch the feature off: `AUTH_PASSWORD_LOGIN=false` (API) and
     `NEXT_PUBLIC_PASSWORD_LOGIN=false` (web, rebuild).

   **Moving to another Microsoft tenant or domain** (e.g. `@hsdg.in` →
   `@dhvaj.in`): register the two apps in the new tenant (step 1), create
   everyone's portal user under the new address *or* edit the existing user's
   Email in Users & Roles — editing keeps their roles, employee record and
   history and drops the link to the old Microsoft account. Then swap
   `AUTH_ENTRA_TENANT_ID`/`AUTH_ENTRA_CLIENT_ID` (API) and
   `NEXT_PUBLIC_ENTRA_TENANT_ID`/`_CLIENT_ID`/`_API_SCOPE` (web) and
   redeploy both. Keep one admin who can sign in on each side of the swap, or
   change your own email last, after you can sign in with the new tenant.
6. Then: the vault key (§6), features (§4), billing (§3), and the smoke tests
   (§5). Back up (§2) before the first real data goes in, and test a restore.
7. **The link on dhvaj.in.** A button or menu item on the firm's website that
   opens the portal in a new tab. Signed-out visitors land on the sign-in
   page (email + password, or Microsoft); nothing else is public. The portal cannot be embedded in a page
   (it sends `X-Frame-Options: SAMEORIGIN`) — link to it, don't iframe it:
   ```html
   <a href="https://portal.dhvaj.in" target="_blank" rel="noopener">Staff portal</a>
   ```
   The portal asks search engines not to index it (`robots.txt`,
   `X-Robots-Tag: noindex`), so the website link is how people find it.
8. **Retire the demo.** The free demo (`render.yaml`: `hsdg-api` / `hsdg-web`
   and its Neon database) holds only synthetic data and lets anyone pick a
   persona. Once production is live, suspend or delete those two services and
   the Neon project so no one uses the demo by mistake.

### Starting clean after a trial run

If the firm tries production out first and wants the trial entries gone before
real use, start from an empty database rather than deleting rows: create a new
database (or drop and recreate the `hsdg` schema and `public.pgmigrations` as
the owner), point `DATABASE_ADMIN_URL` at it, keep the `BOOTSTRAP_*` values,
and redeploy the API. The first boot migrates and creates the office and owner
again. Documents uploaded during the trial stay in SharePoint: remove the trial
folder there too. Back up (`pg_dump -Fc`) first, as always.

---

## 1. Services and their settings

### API (`apps/api`, NestJS)

Validated at boot by `apps/api/src/config/env.validation.ts`. With
`NODE_ENV=production` the API **refuses to start** when any of these is wrong:

| Setting | Production rule |
| --- | --- |
| `DATABASE_URL` | The least-privilege app role `hsdg_app` (never `postgres`, the migrator, or the admin/owner user). The API also refuses at boot if the role is a superuser, has BYPASSRLS, or owns the `hsdg` schema. |
| `DATABASE_SSL` | `true` unless the database is on the same host. |
| `AUTH_JWT_SECRET` | A unique random value, ≥ 32 characters; none of the dev/CI examples. |
| `CORS_ORIGINS` | Explicit `https://…` origins of the web app, comma-separated; no `*`, no paths. |
| `AUTH_PROVIDER=entra` | Needs `AUTH_ENTRA_TENANT_ID`, `AUTH_ENTRA_CLIENT_ID`, an https `WEB_PUBLIC_URL`, and durable storage (`sharepoint`, or `local` with `STORAGE_LOCAL_DIR` on a persistent disk). |
| `M365_ENABLED` / `STORAGE_PROVIDER=sharepoint` | `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, and one of `M365_SITE_URL` / `M365_SITE_ID` / `M365_DRIVE_ID`. |
| `STORAGE_PROVIDER=azure_blob` | `STORAGE_AZURE_CONNECTION_STRING`, `STORAGE_AZURE_CONTAINER`. |
| `ONLYOFFICE_ENABLED` | A unique `ONLYOFFICE_JWT_SECRET` ≥ 32 characters. |
| `DOC_AI_ENABLED` | `DOC_AI_ENDPOINT`, `DOC_AI_KEY`. |
| `CLIENT_UPLOAD_ENABLED` | An https `WEB_PUBLIC_URL` (links sent to clients point at it). |

It starts but logs a **warning** (check the boot log) for:
`AUTH_PROVIDER=dev` (demo only), no `TRUST_PROXY`, neither `SCHEDULER_ENABLED`
nor `CRON_SECRET`, no `CREDENTIALS_KEYS` (client logins off), local storage
without `STORAGE_LOCAL_DIR`.

Also set, as needed:

- `TRUST_PROXY=1` behind Render/Azure/any load balancer, so rate limits and logs see the client's address.
- `RATE_LIMIT_PER_MINUTE` (default 300 per address). The public client-upload routes allow 20/min, the cron trigger 5/min.
- `FEATURE_FLAGS`: the master switch. Unset means **none** in production. List the flags the deploy may use, e.g. `ff_today_view,ff_filing_runs,ff_notices,ff_billing_v2`, then roll out per office in Admin → Rollout (§4).
- `FEATURE_FLAG_OFFICES` (optional): a pilot list fixed by the deploy, e.g. `ff_billing_v2:NORTH`.
- `SCHEDULER_ENABLED=true` on the API instances, **or** `CRON_SECRET` plus an external daily call to `GET /api/v1/internal/cron` with `Authorization: Bearer <CRON_SECRET>`. Scheduled jobs take a Postgres advisory lock, so several instances never run the same tick twice.
- `CREDENTIALS_KEYS`: the vault key (§6).
- `NOTIFICATION_CHANNELS`, `CLIENT_UPLOAD_*`, `SCHEDULER_*_CRON`, `COMPLIANCE_*`: optional; the defaults are in `env.validation.ts`.
- `AUTH_PASSWORD_LOGIN` (default `true`): email + password sign-in alongside Microsoft. Password sessions are signed with a key derived from `AUTH_JWT_SECRET`; rotating that secret signs everyone out.
- `SWAGGER_ENABLED=false` unless the API docs should be public.
- `LOG_LEVEL=info`, `LOG_PRETTY=false`. Request logs carry the method, path, status and user agent only: no bodies, no headers, no query values, and client-upload tokens are masked.

### Web (`apps/web`, Next.js)

Baked in at **build** time, so rebuild after a change:

- `NEXT_PUBLIC_API_URL`: `https://<api host>/api/v1`.
- `NEXT_PUBLIC_ENTRA_TENANT_ID`, `NEXT_PUBLIC_ENTRA_CLIENT_ID`, `NEXT_PUBLIC_ENTRA_API_SCOPE`: with Entra sign-in.
- `NEXT_PUBLIC_CLIENT_UPLOAD_ENABLED`: matches the API's `CLIENT_UPLOAD_ENABLED`.
- `NEXT_PUBLIC_PASSWORD_LOGIN` (default on): `false` hides the email + password form; matches the API's `AUTH_PASSWORD_LOGIN`.

The web sends HSTS, `nosniff`, `SAMEORIGIN` framing, a referrer policy and a
permissions policy (`next.config.mjs`). A full Content-Security-Policy is still
to do (§8).

### Database (Postgres 16)

Three roles:
- the owner/admin user, used only to provision;
- `hsdg_migrator`, which owns the `hsdg` schema and runs migrations;
- `hsdg_app`, the runtime role, which is subject to RLS (FORCE ROW LEVEL SECURITY on every tenant table).

`scripts/deploy/start.mjs` creates both roles from `DATABASE_ADMIN_URL`,
`DB_MIGRATOR_PASSWORD` and `DB_APP_PASSWORD`, then migrates, seeds the first
boot by `SEED_MODE` (`production`: the first office and owner from
`BOOTSTRAP_*`, §0; `demo`: the synthetic firm; `none`), and starts the API as
`hsdg_app`. `SEED_MODE` defaults to `production` under `AUTH_PROVIDER=entra`
and to `demo` otherwise.

---

## 2. Deploy steps

1. **Back up.** `pg_dump -Fc` the production database. Keep the dump until the release has settled.
2. **CI is green on the commit:** lint, typecheck, build, unit tests, migrations on a fresh DB, and the e2e/RLS suite (`.github/workflows/ci.yml`).
3. **Migrate before the new API serves.** On Render this happens inside `start.mjs`. Anywhere else:
   ```sh
   DATABASE_MIGRATE_URL=postgres://hsdg_migrator:…@host/db?sslmode=require npm run db:migrate
   ```
   Each migration runs in its own transaction; re-running the command applies only the ones not yet applied.
4. **Roll the API, then the web.** The API serves the older web unchanged: API changes are additive.
5. **Check the boot log** for `Unsafe production configuration` (the boot was refused) and for config warnings, and look for `Database connection verified as least-privilege role "hsdg_app"`.
6. Run the **smoke tests** (§5).

### Rollback

- **A feature misbehaves:** pause its flag in Admin → Rollout. This needs no deploy and leaves the data as it is. This is the first move every time.
- **The code is bad:** redeploy the previous image or commit. The schema is additive, so the older API runs on the newer schema.
- **A migration must be undone:** restore from the dump. If you must reverse in place instead, run `npm run migrate:down -w apps/api` with `DATABASE_MIGRATE_URL` set; each run reverts **one** migration, the newest first. Down sections drop the columns and tables they added, together with their data (for example, the time-billing ledger or a credit note's void trail).

---

## 3. Before switching billing on (`ff_billing_v2`)

The firm prepares:

1. **Billing → Settings (a partner):**
   - firm name, address, **GSTIN** (sets the state, which decides CGST+SGST or IGST), SAC;
   - invoice prefix and payment terms;
   - reminder days;
   - 26AS match tolerance.
2. **Invoice series.** Rule 46 needs one consecutive series per financial year. If invoices for this FY were already raised outside the portal, give the portal its own prefix (e.g. `DHV`) so numbers never collide with the old series.
3. **Billing go-live** (Billing → Settings → **Unbilled fees from**): the first day the portal bills. Fixed fees for periods before it are not listed as unbilled. Leave it blank only if every earlier period is to be billed here.
4. **Fees already billed elsewhere after go-live.** Go to Billing → Unbilled → **Set aside** each retainer, year fee or milestone period already invoiced in Tally/by hand ("billed elsewhere", with the bill's number). Otherwise it shows as unbilled and could be invoiced twice. **Not billing** a fee at all (a waiver) needs a reason and **another partner's approval**: it stays listed, marked pending, until approved under "Waivers to decide".
5. **Time already billed by hand.** "Bill from time" lists every stopped, billable entry not yet on a portal invoice. Bill by date range from the cut-over date, or untick earlier entries.
6. **GSTR-1 filed through** (Billing → Settings): the last day of the latest month (or quarter) whose GSTR-1 is filed. A credit note dated on or before it can no longer be voided; it is corrected by a debit note or an amendment instead. Update it after each filing.
7. **Who approves.** Credit notes, write-offs, fee waivers and credit-note voids need `billing.approve` (partners), and someone other than the requester.
8. **26AS.** Import the firm's latest 26AS for the current and previous year (Billing → TDS: the TRACES "View As Text" export, or the ZIP as downloaded, with its DDMMYYYY password). A deduction not yet in the 26AS shows as *awaited* until a 26AS as on 15 days past that quarter's 26Q due date still lacks it; only then can the client be reminded. Re-import after each quarter's due date.

---

## 4. Turning features on

Pilot one office first. In Admin → Rollout, set "Pilot offices only", then
"Every office". Each flag must also be listed in `FEATURE_FLAGS`. The order:

1. `ff_today_view`: Today and the filing drawer.
2. `ff_filing_runs`: filing runs, client chasing, search.
3. `ff_notices`: notices, their clock on Today, appeal deadlines.
4. `ff_billing_v2`: GST invoices, receipts, receivables, credit notes and write-offs, 26AS. Do §3 first.

The earlier flags (`ff_engagement_kinds`, `ff_calendar_v2`, `ff_gst_tab`,
`ff_compliance_tabs`, `ff_auto_time`, `ff_work_links`) come before these, if
they are not on already.

---

## 5. Smoke tests after each deploy

- `GET /api/v1/health/live` returns 200, and `GET /api/v1/health/ready` returns 200 (it checks the database).
- Sign in as a partner. Then:
  - Today loads;
  - open a client and an engagement;
  - the documents tab lists files, and one opens or downloads.
- Compliance: the calendar loads, and a filing run opens.
- With billing on:
  - Billing loads;
  - draft an invoice on a test engagement and delete the draft (don't issue, which would use a number);
  - Receivables loads.
- Client logins (if `CREDENTIALS_KEYS` is set): a test login on a test client saves, shows for 30 s, and the show is audited.
- Client upload (if enabled): a link opens in a private window from outside the office.
- The logs hold no request bodies, tokens, PANs or GSTINs.

---

## 6. The vault key for client portal logins

Clients' GST/IT/MCA portal logins are sealed with AES-256-GCM. The key lives
**only** in `CREDENTIALS_KEYS`, never in the database.

```sh
node -e "console.log('1:' + require('crypto').randomBytes(32).toString('base64'))"
```

- Store it in the hosting provider's secret store and in the firm's password manager. **A lost key means every saved login must be re-entered.**
- **Rotation:** add a new version, e.g. `CREDENTIALS_KEYS=1:<old>,2:<new>`. The highest version seals new saves; every listed version still opens. Keep old versions listed while any login sealed with them remains.
- Without the key the portal runs, and logins can be neither saved nor shown. The boot log warns.

---

## 7. Scheduled work

With `SCHEDULER_ENABLED=true`, each API instance schedules these jobs, and the
advisory lock lets only one instance run each tick:
- the notification sweep;
- the compliance horizon roll;
- the outbox drain;
- calendar maintenance;
- the stale-timer closer;
- the monthly GST data request.

The daily digest scheduler is not under that lock yet (§8). On serverless
hosts, use `CRON_SECRET` with an external daily call instead.

---

## 8. Known gaps before a real-data launch

- A full Content-Security-Policy for the web, tested against the PDF/Office viewers.
- The notification digest scheduler: put it under the same advisory lock if more than one API instance runs.
- Charge-out rate cards (PS-302): "Bill from time" takes the hourly rate typed per draft.
- Real 26AS/Form 16A samples to confirm the TDS parsers against the firm's own files (the layout is built from TRACES's published format and made-up data).
- Unbilled fees are listed to the engagement's team and the firm-wide roles; an office partner who is not on an engagement's team does not see its unbilled fees.
- The demo seed (`db/seeds/demo_data.sql`) no longer loads on a fresh database: it gives one client two open Compliance engagements, which `engagements_one_open_compliance` forbids. Production (`SEED_MODE=production`) does not use it; the demo blueprint's first boot fails cleanly (nothing is written) until it is updated.
