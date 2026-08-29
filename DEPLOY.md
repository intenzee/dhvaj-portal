# Ship a free temporary demo (Render + Neon)

A throwaway, no-cost deployment so someone can open the HSDG Portal in a browser
and click around. **The data is synthetic** and anyone with the URL can sign in
as a persona (no password) — fine for a demo, not for real client data. Delete
it whenever you're done.

**Two free signups, no credit card:** [Neon](https://neon.tech) (Postgres) and
[Render](https://render.com) (the web + API). ~15 minutes. The person you're
sharing it with needs **nothing** — just the URL.

---

## 1. Database — Neon (2 min)

1. Sign up at **neon.tech** → **Create project** (any name, region **Singapore**
   or **AWS Mumbai** is closest to India).
2. On the project dashboard, copy the **connection string** (Neon shows it as
   `postgresql://<owner>:<password>@ep-....neon.tech/neondb?sslmode=require`).
   Keep it handy — this is your `DATABASE_ADMIN_URL`.

That's all on Neon. The app creates its own two database roles on first boot.

## 2. App — Render (10 min)

1. Sign up at **render.com** (use "Sign in with GitHub" so it can see the repo).
2. **New +** → **Blueprint**.
3. Pick the **`intenzee/hsdg`** repository. Render reads **`render.yaml`** and
   shows two services: **hsdg-api** and **hsdg-web**.
4. It will ask for the one secret marked "sync: false" —
   **`DATABASE_ADMIN_URL`**: paste the Neon connection string from step 1.
   (Everything else — JWT secret, DB role passwords — is auto-generated.)
5. Click **Apply** / **Create**. Render builds both images and deploys.

**First deploy takes a few minutes** — the API image builds, then on boot it
provisions the DB roles, runs all migrations and loads the demo data before it
starts serving. Watch the **hsdg-api → Logs**; you'll see
`[deploy] Roles ready` → `Migrations complete` → `Seed complete` →
`HSDG API listening`.

## 3. Open it

- Your portal is at **`https://hsdg-web.onrender.com`** (Render shows the exact
  URL on the **hsdg-web** service page).
- Open it, click **Managing Partner** on the sign-in screen — you're in.
- Send that URL to your boss. He clicks a persona and explores: the dashboard,
  Engagements, and any engagement's tabbed workspace (Overview / Services / Work
  / Compliance / …).

---

## Good to know

- **Cold starts:** free Render services sleep after ~15 min idle. The first hit
  after a nap takes ~30–50s to wake, then it's fast. Tell your boss "give it a
  moment if the first page is slow."
- **Free Neon** pauses an idle database too; the first query wakes it in a few
  seconds.
- **It's temporary:** to take it down, delete the two Render services (and the
  Neon project). No charges either way.
- **Uploaded documents don't persist** across a redeploy (local disk is
  ephemeral on free Render) — irrelevant for a look-around demo.

## If the URLs don't match

`render.yaml` assumes the names `hsdg-api` / `hsdg-web` are free, so it hardcodes
`https://hsdg-api.onrender.com` and `https://hsdg-web.onrender.com`. If Render
gives your services different URLs:

1. **hsdg-api → Environment** → set `CORS_ORIGINS` to the real **web** URL
   (e.g. `https://hsdg-web-ab12.onrender.com`) → save (it redeploys).
2. **hsdg-web → Environment** → set `NEXT_PUBLIC_API_URL` to the real **api** URL
   **+ `/api/v1`** (e.g. `https://hsdg-api-cd34.onrender.com/api/v1`) → **Manual
   Deploy → Clear build cache & deploy** (this value is baked in at build time).

## If a page says "Engagement not found" or the list is empty

The API is probably still finishing first-boot setup, or waking from a cold
start. Refresh after a minute. Check **hsdg-api → Logs** for `Seed complete`.

## Reset the demo data

Delete everything and re-seed cleanly: in Neon's **SQL Editor** run
`DROP SCHEMA hsdg CASCADE; DROP TABLE IF EXISTS public.pgmigrations;`, then
redeploy **hsdg-api** (Manual Deploy) — it re-provisions, re-migrates and
re-seeds from scratch.
