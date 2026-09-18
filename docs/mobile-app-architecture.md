# HSDG (Dhvaj) Mobile App — Architecture

**Status:** Proposed (pre-build) · **Date:** 2026-09-14 · **Target platforms:** iOS + Android

This document defines the architecture for the HSDG mobile app. It is grounded in
the existing `hsdg-portal` monorepo (NestJS API + Next.js web + shared contracts),
and its central premise is:

> **The mobile app is a thin client over an already-capable API.**
> Everything hard — SharePoint/M365, OnlyOffice, storage, OCR, RLS, permissions,
> auth — already lives server-side. Mobile consumes it; it does not re-implement it.

---

## 1. Goals & constraints

| Goal | How this architecture meets it |
| --- | --- |
| Works on iOS **and** Android from one codebase | React Native (Expo) — single TypeScript codebase |
| **Maximum performance** | Hermes engine + New Architecture (Fabric/TurboModules), FlashList virtualization, server-side pagination |
| **No stress on the device** | Heavy work (docs, OCR, rendering, co-editing) stays on the server; device only renders and caches |
| **Full feature parity** with the web portal | Every web route maps to an API endpoint that already exists (see §7) |
| **Future scalability, low complexity** | Reuse `@hsdg/contracts`, TanStack Query patterns, and Entra auth already in the stack; add `apps/mobile` to the existing workspace |
| Deployment cost is not a constraint | EAS Build (cloud iOS+Android builds) + EAS Update (OTA) |

---

## 2. What already exists (and is reused, not rebuilt)

From the current repo:

- **API** — NestJS 10 modular monolith, PostgreSQL (system of record) + Redis,
  Zod + `class-validator`, OpenAPI/Swagger at `/{prefix}/docs`, JWT via `jose`,
  throttling, helmet, RLS-based access control, permissions guard.
- **Auth** — provider abstraction (`authentication-provider.ts`) with
  `entra-auth.provider.ts` and `dev-auth.provider.ts`, switched by `AUTH_PROVIDER`.
  The API already validates Entra Bearer tokens and derives a `Principal` + RLS context.
- **Documents / M365** — `documents/m365/m365.service.ts` already bridges to
  SharePoint Online via Microsoft Graph: it keeps a live co-authorable copy in a
  locked-down SharePoint library, mints a **short-lived anonymous Office-for-web
  editor URL** (no per-user Microsoft sign-in), and commits edited bytes back into
  the append-only version store. PostgreSQL stays the record of truth.
  Alternatives/companions: OnlyOffice bridge, Azure Blob + local storage providers,
  Azure Document Intelligence OCR, token-based client-upload.
- **Shared contracts** — `@hsdg/contracts` exports Zod-backed enums/DTO shapes per
  domain (identity, entities, services, components, engagements, time, commercial,
  notes, reviews, compliance, tasks, documents, notifications, dashboard, reports,
  pagination), consumed by both API and web.

**Implication:** the mobile app needs to add UI + navigation + a data layer. It
adds **no new backend capability** for the core feature set.

---

## 3. Tech stack decision

### Chosen: Expo (React Native) + TypeScript

| Factor | Rationale |
| --- | --- |
| Same language/paradigm | TypeScript + React + hooks — same as web; one team, no context switch |
| Code reuse | `@hsdg/contracts` used **directly**; TanStack Query patterns and business logic port over |
| Performance | New Architecture + Hermes is more than sufficient for a data/forms/tables/documents app |
| Delivery | EAS Build + EAS Update (OTA fixes without store review) |
| Scalability | Added as `apps/mobile` in the existing npm workspaces; contract changes propagate to all three apps |

**Rejected alternatives:** Flutter (throws away the TS/Zod/React investment and the
shared contracts package); native Swift+Kotlin (2× code/teams, overkill for a
business portal); Capacitor/PWA wrapper (caps the native performance/feel the
project explicitly wants).

### Library selections

| Concern | Choice | Note |
| --- | --- | --- |
| Framework | **Expo (managed)** + React Native | New Architecture on |
| Navigation | **Expo Router** | File-based; mirrors the Next.js mental model |
| Server state | **TanStack Query** | Same as web |
| Offline | **TanStack Query persistence** (cache-only) | See §6 |
| API client | **Generated from OpenAPI** (`orval`/`openapi-typescript`) | API already publishes Swagger — client stays in sync |
| Types/validation | **`@hsdg/contracts`** + Zod | One source of truth |
| Forms | **react-hook-form + zod** | Same as web |
| Styling | **NativeWind** (Tailwind for RN) | Reuse Tailwind tokens/knowledge |
| Large lists/tables | **FlashList** | Virtualized — the main "no device stress" lever |
| Auth | **expo-auth-session** (Entra PKCE) | See §5 |
| Secure token store | **expo-secure-store** | Keychain / Keystore |
| Biometrics | **expo-local-authentication** | Face ID / fingerprint app-unlock |
| Documents | **WebView** (co-edit) + native PDF viewer | See §6 |
| Push | **expo-notifications** | See §8 |

---

## 4. High-level architecture

```
┌─────────────────────────────┐
│        Mobile (Expo RN)      │
│  Expo Router · NativeWind    │
│  TanStack Query (+persist)   │
│  react-hook-form + zod       │
│  @hsdg/contracts (shared)    │
│  Generated OpenAPI client    │
└───────┬─────────────┬────────┘
        │ Bearer      │ Office-for-web / OnlyOffice editor URL (WebView)
        ▼             │
┌─────────────────────┴────────┐
│      NestJS API (existing)    │
│  Auth (Entra) · RLS · perms   │
│  Documents ── M365/Graph ─────┼──► SharePoint Online (live edit surface)
│  OnlyOffice · Storage · OCR   │
│  All domain modules           │
└───────┬───────────────────────┘
        ▼
   PostgreSQL (system of record) · Redis
```

Mobile never talks to SharePoint/Graph directly. It calls the API; the API brokers
Microsoft 365. This keeps one security boundary and one record of truth.

---

## 5. Authentication

**Decision: Microsoft Entra ID for user auth + biometric app-unlock.**

Why (corrected from the initial discussion): SharePoint unification does **not**
force Entra — the document bridge already avoids per-user Microsoft sign-in. Entra
is chosen because it is **already implemented end-to-end** (API provider + web MSAL),
so mobile reuses it with **no second identity system to bridge**, and staff already
have M365 accounts (SSO).

### Flow

1. First launch → `expo-auth-session` runs the Entra **OAuth 2.0 + PKCE** flow in a
   system browser (SSO: likely already signed in on the device).
2. Tokens stored in **`expo-secure-store`** (Keychain/Keystore). Refresh token used
   to renew access tokens silently.
3. Every API call sends the Entra access token as `Authorization: Bearer …`. The API
   already validates it (`entra-auth.provider.ts`) and builds the `Principal`/RLS context.
4. **Biometric unlock:** after first sign-in, day-to-day access is gated by
   `expo-local-authentication` (Face ID / fingerprint) unlocking the stored token —
   no repeated Microsoft login.

### To do on the Microsoft side
- App registration for a **public/native client** with mobile redirect URIs
  (`hsdg://auth` custom scheme / universal links).
- Confirm the same portal user model maps to Entra object IDs (it already does for web).

### External clients
Unchanged: `client-upload/[token]` stays a public, token-based flow. External
clients never authenticate — no mobile auth burden for them.

---

## 6. Data, offline & documents

### Networking & state
- **Generated OpenAPI client** (from the API's Swagger doc) wrapped in **TanStack
  Query** hooks. Contract types come from `@hsdg/contracts`.
- **Pagination** uses the existing `pagination` contract — infinite queries + FlashList
  so large datasets never fully load into memory.

### Offline (cache-only, as decided)
- **TanStack Query persistence** (AsyncStorage/MMKV) makes recently-viewed data
  readable offline. No local write/sync engine, no SQLite mirror — deliberately
  simple. Mutations require connectivity; the UI surfaces offline state clearly.

### Documents (server-brokered; near-zero device cost)
- **List/metadata** — from the documents API (`documents-list`, `documents`).
- **Read-only preview** — PDFs and images rendered natively; other types previewed
  via a server-provided preview URL.
- **Live editing / co-authoring** — open the **Office-for-web editor URL** returned
  by the existing M365 bridge in a **secure in-app WebView**. This delivers true
  "one person edits, the whole firm sees it" co-editing, on mobile, with **no native
  Office app and no per-user Microsoft sign-in**. OnlyOffice bridge is the fallback
  surface where configured.
- The device only displays a WebView/PDF; rendering, co-authoring, OCR, and version
  commits all happen server-side. This is the core of "maximum performance, no stress
  on the device."

**Security note (inherited):** the M365 bridge uses short-lived anonymous sharing
links into a locked-down library. This is an existing, deliberate design choice; the
mobile app inherits it unchanged. Worth periodically reviewing link TTLs given the
sensitivity of client financial data.

---

## 7. Feature-surface map (parity target)

Every web route maps to an existing API controller and a contracts module. Mobile
pattern notes call out where a screen adapts for touch/small-screen.

| Web route | API controller(s) | Contracts | Mobile pattern |
| --- | --- | --- | --- |
| `(portal)/` Dashboard | `dashboard.controller` | `dashboard` | KPI cards + drill-downs |
| `my-work` | `work.controller` | `tasks` | Grouped task list (FlashList) |
| `tasks` | `tasks.controller`, `client-dependencies.controller` | `tasks` | List + detail + status actions |
| `engagements` (list/new/`[id]`) | `engagements.controller`, `time-tracking.controller`, `engagement-reviews.controller` | `engagements`, `time`, `reviews` | List → detail tabs (overview/time/reviews); create form |
| `entities` (list/new/`[id]`) | `entities.controller`, `entity-types.controller`, `industries.controller` | `entities` | List → detail; create form |
| `client-dependencies` | `client-dependencies.controller`, `clients.controller` | `tasks`, (clients) | Checklist-style list |
| `compliance` + `rules` | `compliance-instances.controller`, `compliance-rules.controller`, `government-extensions.controller`, `compliance-horizon.controller` | `compliance`, `components` | Filterable list + rule detail |
| `reviews` | `engagement-reviews.controller` | `reviews` | Review queue + actions |
| `documents` | `documents.controller`, `documents-list.controller`, `m365`, `onlyoffice.controller` | `documents` | List + preview + WebView editor (§6) |
| `billing` | `commercial.controller`, `invoices-list.controller` | `commercial` | Invoice list + detail (view-first) |
| `reports` | `reports.controller` | `reports` | Report list + rendered output/export |
| `resources` | `resources.controller` | `reports` | Resource library |
| `services` (+ `components`) | `services.controller`, `service-lines.controller`, `service-components.controller`, `catalogue-templates.controller`, `reference.controller` | `services`, `components` | Catalogue browse (mostly reference data) |
| `notifications` | `notifications.controller` | `notifications` | Notification center (+ push, §8) |
| `admin` | `users.controller`, `roles.controller`, `offices.controller`, `employees.controller`, `partners.controller`, `audit.controller` | `identity` | Admin screens (permission-gated) |
| `client-upload/[token]` (public) | `client-upload.controller` | `documents` | Optional: deep-link handler for staff; primarily web |
| `login` | `auth.controller` | `identity` | Entra flow (§5) |
| cross-cutting | `notes.controller` | `notes` | Notes attached to entities/engagements |

**Parity notes**
- Create/edit-heavy screens (engagements/new, entities/new) are real forms — build
  with react-hook-form + zod against the same contracts as web.
- Some admin/catalogue screens are low-frequency on mobile; they reach parity but are
  sequenced later (see §11).

---

## 8. Push notifications

The `notifications` module already exists server-side. Add:
- `expo-notifications` for device registration + display.
- A device-token registration endpoint (small API addition) and a delivery hook from
  the notifications module to APNs/FCM (via Expo push or direct).
- Deep links from a push into the relevant screen (task, engagement, review, document).

This is the **one meaningful backend addition** the mobile app implies.

---

## 9. Performance & device-stress strategy

- **Hermes + New Architecture** — fast startup, low memory.
- **FlashList** everywhere lists can grow (tasks, engagements, documents, notifications).
- **Server-side pagination + infinite queries** — never load full datasets.
- **Offload heavy work to the server** — document rendering, co-editing, OCR, exports
  are server/WebView, not native compute.
- **Image/asset discipline** — thumbnails from the API, `expo-image` with caching.
- **MMKV** for fast cache persistence.
- **Selective queries** — request only fields a screen needs; lean list DTOs.

---

## 10. Monorepo integration

- Add **`apps/mobile`** to `workspaces` in the root `package.json`.
- Configure Metro to resolve the workspace so `@hsdg/contracts` is imported directly.
- Reuse root tooling (`@hsdg/tsconfig`, prettier, eslint) where compatible with RN.
- CI: extend existing pipeline with a mobile lint/typecheck/test job; EAS handles builds.

---

## 11. Proposed build sequence (target remains full parity)

Parity is the destination; this is the order to get there safely, each slice shippable:

1. **Foundation** — scaffold `apps/mobile`, wire workspace + contracts, generate API
   client, base navigation/theme (NativeWind), TanStack Query + persistence.
2. **Auth spine** — Entra PKCE + secure store + biometric unlock; authenticated API calls.
3. **Core read flows** — Dashboard, My Work, Tasks, Notifications (+ push).
4. **Engagements & Entities** — lists, details, and create/edit forms.
5. **Documents** — list, preview, WebView co-editing via the M365 bridge.
6. **Compliance, Reviews, Billing, Reports, Resources.**
7. **Services/Catalogue & Admin** — completing parity.
8. **Hardening** — offline polish, deep links, error/empty states, accessibility, perf pass.

---

## 12. Risks & open questions

- **Entra native app registration** — needs a public-client registration + redirect
  URIs; who owns the Azure tenant/admin consent?
- **Anonymous document links on mobile** — inherited design; confirm TTLs are
  acceptable for mobile use of sensitive client documents.
- **Report/export rendering** — confirm reports return a mobile-renderable form
  (PDF/HTML/data) vs. web-only rendering.
- **OnlyOffice vs. M365 surface** — confirm which is canonical for editing so mobile
  targets one primary path.
- **Push delivery** — Expo push service vs. direct APNs/FCM; requires the small
  device-token endpoint + delivery hook.
- **Offline expectations** — cache-only is chosen; validate it against field
  realities (e.g., staff at client sites with poor connectivity) before GA.

---

## 13. Summary

A single Expo/React Native app, added to the existing monorepo, acting as a thin,
high-performance client over the current NestJS API. It reuses the shared contracts,
the Entra auth already in place, and — crucially — the already-built M365/SharePoint
document bridge, so unified real-time document collaboration works on mobile with
almost no device cost. The only material backend addition is push-notification
delivery. Parity is achievable because every web feature is already API-backed.
