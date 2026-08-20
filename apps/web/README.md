# @hsdg/web — HSDG Portal (frontend)

The Next.js portal (Phase 12 — Dashboard / Frontend Foundation). **One portal,
permission-driven experiences** (§22): a single app whose navigation and role
dashboards adapt to the signed-in user's permissions — never separate apps per
role.

Stack: **Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS ·
TanStack Query · TanStack Table · React Hook Form · Zod**. Lean shadcn-style UI
primitives live in `src/components/ui.tsx`.

## What's here

- **Auth** — development sign-in against the API's dev-token endpoint (`src/lib/auth.tsx`);
  production swaps in Microsoft Entra SSO. The bearer token drives every request;
  all authorisation/RLS stays enforced by the backend.
- **App shell** — permission-gated sidebar nav + header (`src/components/app-shell.tsx`).
- **Home** — role dashboards. One RLS-scoped endpoint (`GET /dashboard/summary`)
  returns the counts; `src/lib/dashboard-cards.ts` decides which cards each role
  sees (MP/Partner get the full accountability view; senior/article see personal work).
- **Screens** — My Work, Engagements (list + detail), Client 360 (entity detail),
  Review Queue, Compliance Calendar. Nav items whose screens land later render an
  honest "coming soon" placeholder.

## Run it locally

The portal talks to the API directly (CORS is enabled for `http://localhost:3000`).
Start the API first (see the repo root README), then:

```bash
cp apps/web/.env.example apps/web/.env.local   # optional; defaults to localhost:3001
npm run web                                     # from the repo root → http://localhost:3000
```

Sign in with a seeded persona (quick-select buttons on the login page) to see
each role's dashboard.

## Checks

```bash
npm run typecheck --workspace @hsdg/web
npm run lint --workspace @hsdg/web
npm run test --workspace @hsdg/web     # Jest + React Testing Library (jsdom)
npm run build --workspace @hsdg/web
```
