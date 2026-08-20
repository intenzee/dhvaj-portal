# ADR-0017 — Frontend Foundation (Web Portal)

- **Status:** Accepted
- **Date:** 2026-08-20
- **Phase:** 12 (Dashboard / Frontend Foundation)

## Context

Phase 12 is the first frontend phase — the Home dashboards and core screens over
the now-stable backend (§22). The brief requires **role dashboards** (MP,
Partner, Manager, Senior, Article) with a fixed set of cards, then the screens
My Work, Engagement List, Engagement Detail, Client 360, Review Queue, Compliance
Calendar — all as **one portal with permission-driven experiences**, not
separate apps per role.

## Decisions

### 1. One portal, permission-driven — nav and dashboards adapt to the principal

A single Next.js (App Router) app. The sidebar renders only the nav items the
signed-in user's permissions allow (`visibleNav`), and Home renders only the
cards the user's role emphasises (`cardsForRole`). The Managing Partner and
Partner see the full accountability view (sign-offs, high risk); a manager drops
the EP-sign-off card; a senior/article see personal work. Both mappings are pure
and unit-tested.

### 2. The backend stays authoritative; the browser calls the API directly

The portal is a thin client: it fetches from the NestJS API directly (CORS is
enabled for the portal origin) with a bearer token, and renders. Every rule —
authorisation, **RLS**, validation — remains enforced by the backend; the
frontend never re-implements a business rule (§18). Frontend validation is UX
only. Data fetching/caching is TanStack Query; lists use TanStack Table.

### 3. A dashboard needs aggregate counts → one RLS-scoped endpoint

Rather than have the client stitch counts from many list endpoints, the phase
adds `GET /dashboard/summary`: ten counts computed as scalar subqueries over
RLS-protected tables, so the whole summary is **already scoped** to what the
caller can see (firm-wide for the MP, assignment-scoped otherwise) in one
round-trip. The web decides which cards to show; the database has scoped the
numbers. Proven with e2e (shape, RLS scoping, window override, auth).

### 4. Derive where the read models already answer; add endpoints only when they don't

- **Review Queue** is derived client-side from the engagements read model
  (`openReviewPointCount`, `effectiveReviewModel.requiresEpSignoff`,
  `isSignedOff`) — no new endpoint.
- **Compliance Calendar** uses the existing firm-wide `GET /compliance` calendar.
- Only the dashboard summary was genuinely missing, so only it was added.

### 5. Auth is dev-token now, Entra later

Sign-in mints a token from the API's non-production dev-token endpoint and stores
it client-side; `GET /auth/me` yields the principal that drives the UI.
Production replaces this with Microsoft Entra SSO behind the same `useAuth`
surface — no screen changes.

## Consequences

- Every role gets a working Home dashboard with live, correctly-scoped counts,
  plus functional My Work / Engagements / Client 360 / Review Queue / Compliance
  screens — verified in a real browser end-to-end (login → dashboard → list →
  detail).
- `npm run build` (contracts → api → web), `typecheck`, `lint`, and unit tests
  all run across the monorepo; the web adds 16 unit tests (Jest + RTL).

## Known limitations / deferred (not gold-plated)

- **No Playwright E2E yet.** The frontend is covered by unit tests (pure logic +
  a component render) and a manual browser smoke test; full Playwright flows
  against a running API are a follow-up.
- **Write actions are deferred.** The foundation is read-first (dashboards,
  lists, detail). Mutating flows (create engagement, record review, sign off,
  upload document, request client info) are the next frontend increment — the
  APIs already exist and are audited/guarded.
- **Some nav destinations are placeholders.** Services, Documents, Reports & MIS,
  Resource Management, Billing, and Administration render an honest "coming soon"
  page; their backends (where they exist) are ready to build on.
- **Client-side token storage.** Adequate for the dev-token foundation; Entra SSO
  with proper session handling replaces it.
