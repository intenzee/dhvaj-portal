# Always-on deployment (Vercel + Neon)

Unlike free Render, Vercel does not put the site to sleep. The same repo deploys
as **two Vercel projects** from the same GitHub repo, and the database stays on **Neon**:

| Vercel project | Root Directory | What it is |
|---|---|---|
| `dhvaj-web` | `apps/web` | The Next.js portal (auto-detected as Next.js) |
| `dhvaj-api` | `apps/api` | The NestJS API as one serverless function (`apps/api/vercel.json`) |

The API's build step provisions the DB roles, runs migrations and seeds the
database on first deploy (`SETUP_ONLY=true node scripts/deploy/start.mjs`), so
there is no boot-time setup. The in-process cron is replaced by a daily
**Vercel Cron** job (07:00 IST) that calls `GET /api/v1/internal/cron` with
`CRON_SECRET`.

## 1. API project

Vercel → **Add New… → Project** → import `intenzee/hsdg` → set **Project Name**
`dhvaj-api`, **Root Directory** `apps/api` (leave everything else as it is; `vercel.json`
sets the build) → add these **Environment Variables** → **Deploy**.

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `AUTH_PROVIDER` | `dev` |
| `AUTH_JWT_SECRET` | random, 32+ chars |
| `DATABASE_ADMIN_URL` | Neon connection string (owner) |
| `DB_MIGRATOR_PASSWORD` | random alphanumeric |
| `DB_APP_PASSWORD` | random alphanumeric |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `3` |
| `CRON_SECRET` | random, 32+ chars |
| `CORS_ORIGINS` | `https://dhvaj-web.vercel.app` (the web URL) |
| `STORAGE_PROVIDER` | `local` (see "Documents" below) |

Generate a random value with `openssl rand -hex 24`.

> **Reusing the Render database?** Copy `DB_MIGRATOR_PASSWORD` and
> `DB_APP_PASSWORD` from Render (hsdg-api → Environment) exactly. The setup step
> re-applies these passwords to the DB roles, so different values would lock out
> whichever host did not set them last.

Check: `https://dhvaj-api.vercel.app/api/v1/health/ready` → `{"status":"ok",…}`.

## 2. Web project

Import the same repo again → **Project Name** `dhvaj-web`, **Root Directory**
`apps/web` → env var `NEXT_PUBLIC_API_URL` = `https://dhvaj-api.vercel.app/api/v1` → **Deploy**.

If Vercel gives either project a different URL, update `CORS_ORIGINS` (API) /
`NEXT_PUBLIC_API_URL` (web, then **Redeploy**, because it is baked in at build time).

After that, every push to `main` redeploys both projects.

## Limits to know

- **Plan:** Vercel Hobby (free) is for non-commercial use only. Use **Pro** for firm use.
- **Documents:** Vercel's disk is temporary, so with `STORAGE_PROVIDER=local` uploaded files
  disappear shortly after upload. To keep them, set `STORAGE_PROVIDER=azure_blob` +
  `STORAGE_AZURE_CONNECTION_STRING` + `STORAGE_AZURE_CONTAINER`.
- **Upload size:** Vercel caps a request body at 4.5 MB. Uploads are base64 JSON, so the
  largest file that works is about 3.3 MB.
- **Scheduler:** Hobby runs cron jobs once a day. The sweep, horizon roll and outbox
  drain all run in that single daily call. On Pro you can add more `crons` entries
  in `apps/api/vercel.json` (for example, hourly).
- **Cold starts:** after the API has been idle, the first request takes about 1–3 s, not the
  30–50 s Render takes. Neon's free tier also pauses an idle database. It wakes on the next query.
