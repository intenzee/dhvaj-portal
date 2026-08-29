# HSDG Portal

The central **practice-management and professional-work operating system** for
HSDG Chartered Accountants — a merged practice with 12 partners.

The Portal manages the full lifecycle of professional engagements (audit, tax,
GST, accounting, litigation, advisory and more): organisation and people,
client entities and registrations, a configurable service catalogue,
engagements with accountable Engagement Partners, review & sign-off, compliance,
tasks, client dependencies, documents, notifications, reporting and an immutable
audit trail.

> **Status: Billing & Collections + Resource Management views (complete).** The
> last two `ComingSoon` screens are now live — the portal navigation is fully
> built. Both are additive, read-only projections over existing RLS-scoped tables
> (the `/documents` and `/reports` precedent), so no migration, policy or write
> path changed:
>
> - **Billing & Collections (§31)** — firm-wide `GET /invoices` +
>   `GET /invoices/summary` (`report.read`), RLS-scoped exactly like the
>   per-engagement invoice list. The list carries engagement/client context and a
>   derived **overdue** flag (sorts overdue to the top; `?overdueOnly=` filter);
>   the summary rolls up counts + totals (outstanding / overdue / paid / draft)
>   and a **receivables-aging** partition (not-due / 1–30 / 31–60 / 61–90 / 90+).
>   New **Billing** screen; writes stay on the audited per-engagement routes. See
>   [ADR-0025](docs/adr/0025-billing-and-collections.md).
> - **Resource Management** — `GET /resources/workload` (`employee.read`) reuses
>   the utilisation rows (now a shared helper) and rolls them up by **office** and
>   **grade** with headline totals (people / active assignments / open / overdue /
>   overloaded). New **Resources** screen with a per-person workload table + CSV.
>   See [ADR-0026](docs/adr/0026-resource-management.md).
>
> Also in this pass: fixed the API lint (4 prettier errors), a web jest
> `.next/` haste collision, and made the date-sensitive escalation e2e spec
> derive its dates from the clock; the e2e suite now **resets to a fresh schema
> before it runs** (jest `globalSetup`) so local re-runs are repeatable, not just
> the first. api+web typecheck, lint & build pass; **133 unit + 310 e2e green**.
>
> **Status: Commercial & Billing, Notes, and Registration write-back (complete).**
> The three remaining spec gaps are closed — every one additive, engagement-scoped
> and audited, with a live-verified UI:
>
> - **§31 Commercial Scope & Billing** — a 1:1 `engagement_commercial` config
>   (billing frequency, effective/end dates, retainer, scope notes), and
>   `invoices` + `invoice_line_items` with a **generated invoice number** and a
>   **draft → issued → paid / void** lifecycle. Invoice totals are kept
>   authoritative by DB triggers (`subtotal` from the lines, `total = subtotal +
>   tax`); issuing requires ≥1 line; a paid/void invoice is locked. The §31
>   **out-of-scope path** lands on tasks (`is_out_of_scope` / `is_billable` + a
>   lead **approve** action) so unpredictable work is captured without changing
>   the original historical scope. New **Invoices** tab (commercial summary,
>   create/issue/pay/void, per-line editing).
> - **§26 Notes** — a shared `engagement_notes` notebook: any member reads/adds,
>   author-or-lead edits/removes (RLS-enforced), pinnable, scopable to a service
>   line or component. Real **Notes** tab replaces the placeholder.
> - **§40 Registration write-back** — a catalogue component can be flagged
>   `sets_registration_type`; completing its work instance records the issued
>   number into the central Registration Master (`entity_registrations`) through
>   a **lead-gated, coverage-checked SECURITY DEFINER** writer. A **Record
>   registration** action on the component-work row drives it.
>
> api+web typecheck, web lint & production build pass; **117 unit + 299 e2e tests
> green** (incl. a new `commercial.e2e-spec.ts` covering all three, and a
> refreshed notifications unit test aligned to the batched-emit/durable-outbox
> contract).
>
> **Status: Group engagements, creation wizard & tabbed workspace (complete).**
> Three more spec areas closed:
>
> - **Group / multi-entity engagements (§5–§6, §30)** — a new `engagement_entities`
>   coverage grain lets one engagement cover several entities (a group audit over
>   parent + subsidiaries), and `entity_groups` + `entities.group_id` model a named
>   client group. Strictly additive (mirrors the multi-service work): 169/169
>   engagements backfilled to one primary covered entity; `engagements.entity_id`
>   stays the identity anchor. An **Entities covered** panel adds/removes coverage,
>   and being on an engagement now grants visibility of every entity it covers.
> - **Guided creation wizard (§4/§41)** — the create form is now a 4-step stepper
>   (Client + group coverage → Details → Services → Review) that provisions the
>   engagement, its additional services and covered entities in one flow.
> - **Tabbed engagement workspace (§26)** — the engagement page is a tabbed
>   workspace (Overview / Services / Work / Compliance / Documents / Team /
>   Activity / Invoices / Notes) with the status & lifecycle action bar always
>   visible; the **Activity** tab shows lifecycle history. (Invoices & Notes are
>   now live modules — see the Commercial & Billing / Notes status above.)
>
> api+web typecheck, lint, and API tests pass; verified end-to-end in the browser.
>
> **Status: Config-depth partials + dark mode (complete).** Four spec gaps
> closed, each additive, plus a full UI theme:
>
> - **Engagement Type & commercial fields (§3/§7)** — `engagement_type`
>   (recurring-compliance / one-time / project / retainer / advisory / audit /
>   certification / litigation) plus Priority, Confidentiality, Currency, Billing
>   model and the mandate-letter reference, shown on the engagement and settable
>   in the create form.
> - **Fact-driven applicability (§11)** — component discovery now decides
>   applicability from **client facts** (the registrations the entity holds, its
>   legal category) rather than a static catalogue default; a GST scope shows
>   *“not applicable — no active GST registration”* for a client without a GSTIN.
> - **Activation ceremony (§20/§37)** — one gated, atomic `POST
>   /engagements/:id/activate`: precondition checks, draft component configs →
>   active, and recurring-work generation in a single transaction; an **Activate**
>   button drives it.
> - **Per-component checklists + PBC (§13/§17)** — each component carries a
>   checklist (seeded from a catalogue template, materialised on selection),
>   tickable by any member with who/when attribution and lead-managed structure;
>   client dependencies can now be **attached to a component** (PBC).
> - **Dark mode** — a theme-aware token system (CSS variables flipped by a
>   `.dark` class) with a topbar Sun/Moon toggle, persisted per-viewer and
>   respecting the OS preference, applied with no flash of the wrong theme.
>
> All parts: api+web typecheck, web lint & production build pass, 112/112 API
> tests green, verified end-to-end in the browser.
>
> **Status: Multiple services per engagement (complete).** The engagement is no
> longer keyed to a single service. A new **`engagement_services`** table (spec
> §2, §9–§10, §27, §36, §38) is the **service-line grain** that lets **one
> engagement carry several services** (e.g. GST + TDS + Accounting) for the same
> client, FY and period — each with its own servicing office, lead and lifecycle.
> Delivered end-to-end across four additive parts:
>
> - **Schema (A)** — `engagement_services` with RLS mirroring the engagement
>   (member-read / lead-write). Every existing engagement was **backfilled**
>   (169/169) to one *primary* service row from its current `service_id`;
>   `engagements.service_id` is **kept** as the primary/legacy pointer. §16/§35
>   duplication is preserved **with no API change**: an AFTER-INSERT trigger
>   auto-creates the primary row and a partial unique index enforces *entity +
>   service + FY + period* at the service grain (duplicate → clean 409).
>   `engagement_components` gained an `engagement_service_id` (backfilled, guard
>   re-pointed). See [ADR-0024](docs/adr/0024-multi-service-engagements.md).
> - **API (B)** — engagement detail returns a `services[]` array;
>   `GET/POST /engagements/:id/services` and
>   `DELETE …/services/:serviceLineId` (soft-cancel, history-preserving; the
>   primary can’t be removed).
> - **Components (C)** — discovery & configuration run **per service line**
>   (`?engagementServiceId=…`), defaulting to the primary line so single-service
>   behaviour is unchanged; a component is validated against its line’s service.
> - **Web (D)** — the engagement page gains a **Services** panel (list / add /
>   remove) and the **Scope & components** panel is service-line-aware (a line
>   selector filters the table and scopes discovery).
>
> `api` + `web` typecheck, web lint & production build pass, 106/106 API tests
> green. Group / multi-entity engagements (§5–§6, §30) remain a separate,
> orthogonal follow-on.
>
> **Status: Component work generation (complete).** A configured **recurring
> component now generates period-specific work** (spec §21–§22): one
> `component_instance` per period of the engagement's financial year (12 months /
> 4 quarters / 2 halves / 1 year — the FY bounds the horizon), never duplicated
> (a `(component, period)` unique key). Generation **reconciles to the current
> configuration** rather than only adding: it creates or revives the in-scope
> periods and **cancels work that falls out of scope** — so the lead has full
> **manual control** via the config's **active window** (`start`/`end` dates —
> "I look after this client Apr–Sep"), **frequency**, **applicability**
> (`not_applicable` suppresses it) and **status**; removing a component cancels
> its pending work too, while **completed/waived work is always preserved**
> (§25). Changing **frequency** once work exists is a controlled version change
> (§23/§24): the current configuration is **superseded** and a **new version**
> (new frequency) takes over — old periods become history, new ones generate — in
> one click. Each period's deadline is computed from the compliance rule version
> **effective as of that period's end** and snapshotted, so a later rule change
> never rewrites history; scheduled/future work is derived and shown distinctly
> from current work. The engagement gains a **Component work** panel (bulk
> "Generate work" + per-instance completion), the **Scope** panel gains **inline
> configuration editing** (owner/reviewer/frequency/applicability/EP-review +
> active window), and a firm-wide **Component catalogue** admin screen
> (`/services/components`, gated `service.manage`) manages the catalogue. Also in
> this pass: the component list/discovery queries were optimised (single-query
> totals, batched deadline preview, a SQL optimistic-lock guard) and the
> compliance-rule list gained a `search` filter.
>
> **Service Components & Component Configuration (complete).** The layer
> the practice spec calls **Component → Component Configuration** now sits between
> the service catalogue and the work/compliance instances. A firm-wide
> **component catalogue** (`service_components`, gated `service.manage`) declares
> the scopes/obligations available under each service, their default applicability
> (**mandatory / recommended / optional**) and frequency, and an optional link to
> the **compliance rule** that governs the deadline. A **Component Discovery**
> engine (`GET /engagements/:id/components/discovery`) categorises that catalogue
> for one engagement — **mandatory / applicable / optional** — with the reason and
> a **statutory + internal deadline preview** (reusing the compliance-calc engine
> where the basis is determinable). Leads then **select and configure** components
> per engagement (`engagement_components`, RLS members-read / leads-write): the
> professional applicability decision, frequency, owner/reviewer, EP-review flag
> and config status. A **partial unique index** enforces one *live* configuration
> per component (duplication prevention); **removal is a soft-cancel** that stops
> future work and **preserves history**, so a component can be re-added. Every
> mutation is **audited**. The engagement workspace gains a **Scope & components**
> panel with a discovery drawer. Additive by design — it hangs off the existing
> single-service engagement, so no existing engagement, test or policy changed.
>
> **Phase 13 — Administration (complete).** The firm can now be
> administered from the portal: an **Administration** screen (gated on
> `user.manage`) with **Users & Roles** and **Offices** tabs. New audited write
> endpoints land on the previously read-only identity module — **create/update a
> user**, **replace a user's role set** (`PUT /users/:id/roles`, idempotent),
> **create/update an office** — each firm-wide-gated by RLS *and* a permission
> guard (defence in depth), each recording a before/after **audit** entry. Users
> are **deactivated, never deleted** (soft flag). A new `office.manage` permission
> is granted to the Managing Partner and administrators. Role assignment reuses
> the existing `user_roles` RLS write policy; nothing bypasses the database.
>
> **Production-hardening UI cluster (follow-on).** The backend-ready gaps are now
> closed in the portal: **client onboarding** (create/edit entities with a live
> duplicate-check, plus add registrations & contacts), a **Notifications inbox**
> (read / dismiss / mark-all-read, deep-linking to engagements), a **cross-engagement
> Documents view** (one new RLS-scoped `GET /documents`, same visibility as the
> per-engagement list, flattened), **Compliance configuration** (rules, append-only
> effective-dated versions, and the holiday calendar), and reusable **pagination
> controls** on the busy lists. Every write reuses an existing audited, RLS-enforced
> endpoint; the browser never re-implements a rule.
>
> **Reports & MIS.** A management view (new `report.read` permission → Managing
> Partner / admin / partner / manager): **engagement MIS** (totals + breakdowns by
> status, service line, office and Engagement Partner), **compliance MIS**
> (open / overdue / due-soon by category) and **utilisation** (per-person workload
> — active engagements as EP/manager/member plus open & overdue tasks), each with
> **CSV export**. Every figure is **RLS-scoped** exactly like the dashboard —
> firm-wide for the MP, assignment-scoped for a partner — computed in the database.
>
> <details><summary>Earlier phases</summary>
>
> **Phase 12 — Dashboard / Frontend Foundation.** The first frontend: a
> **Next.js portal** — one app whose navigation and Home dashboards are
> **permission-driven** per role (MP/Partner get the full accountability view;
> manager/senior/article see progressively less), never separate apps. Role
> dashboards render the mandated cards (**Active Engagements, Overdue, Due Soon,
> Pending Reviews, Pending Sign-offs, Client Dependencies, High Risk, My Tasks**)
> from a single **RLS-scoped `GET /dashboard/summary`**. Core screens are live:
> **My Work, Engagements (list + detail), Client 360, Review Queue, Compliance
> Calendar**. The browser calls the API directly; every authorisation/RLS rule
> stays enforced by the backend.
>
> **Phase 11 — Notifications.** Material events reach the right person through a
> **notification framework**: a **recipient-scoped** inbox written only through a
> SECURITY DEFINER emit path (the app role can't insert directly), with a
> **channel abstraction** (in-app portal always on; email/Teams pluggable). Five
> events fire in-request — **task assigned**, **EP changed**, **engagement
> reopened**, **EP sign-off pending**, **high-risk (key matter)**. An idempotent
> **date-driven sweep** turns the Phase 8–9 clocks into notifications (**internal
> SLA overdue/approaching**, **statutory deadline approaching**, **client-dependency
> reminders**).
>
> **Phase 10 — Documents.** Engagements carry **document evidence**: metadata + a
> versioned file chain, with the bytes held in **blob storage** behind a provider
> abstraction (Azure Blob in production, a local filesystem provider in dev/test)
> — PostgreSQL stores only metadata and an **opaque storage reference**. Access
> **inherits the engagement**; a new upload creates a **new version and retains
> the old one** (version rows are append-only), documents are **never
> hard-deleted**, and every **download is RLS-mediated and audited** — a document
> id alone can never reach the bytes, so there is no direct-URL bypass.
>
> **Phase 9 — Tasks & Client Dependencies.** Engagements track **internal tasks**
> (assignment, due dates, task→task dependencies that block completion) and
> **client dependencies** — information requested from the client. An open
> dependency makes the engagement **WAITING FOR CLIENT** (a derived operational
> state), and the read model surfaces **internally overdue** (a task past due —
> our delay) separately from **client delay** (a dependency past its escalation
> date). A task's assignee — even a senior/article — may progress their own work,
> while assignment and governance stay lead-only. Firm-wide "My Work" views
> aggregate assigned tasks and open dependencies.
>
> **Phase 8 — Compliance Engine.** The engagement is the
> central transactional object (identity = Entity + Service + FY + Period), with
> one accountable Engagement Partner, a per-engagement **team of shared
> resources**, and **assignment-based** access. Lifecycle moves only through
> **explicit guarded transitions** (Phase 6); **completion is gated by review
> sign-off** (Phase 7 — a manager can complete an ITR, but a statutory audit
> needs **EP sign-off**). Phase 8 adds a **compliance engine**: configurable,
> effective-dated, **versioned** statutory rules turned into per-engagement
> obligations that **snapshot the rule version used** — so changing a *future*
> rule never rewrites history. Two clocks are tracked separately (**statutory
> deadline** vs **internal SLA**), deadlines are computed with offsets +
> working-day/holiday adjustment + conditional applicability, and manual
> overrides are audited with reason + evidence. No statutory date is hard-coded —
> rules are data.
>
> </details>
>
> Remaining modules follow phase by phase — see [Roadmap](#roadmap).

---

## Architecture at a glance

- **Modular monolith** (NestJS) with event-driven background processing added
  later — deliberately not microservices. See [docs/adr/0001-architecture.md](docs/adr/0001-architecture.md).
- **PostgreSQL is the system of record.** Security is enforced in depth:
  authentication → application authorisation → business rules → **PostgreSQL Row
  Level Security** → data. The API connects only as a **least-privilege role**
  that cannot bypass RLS, and refuses to start otherwise (fail-closed).
- **Configuration over hard-coding** — statutory dates, review models, service
  workflows and partner/office data are all data, never source constants.
- Target domain model: Organisation → Entities → Services → **Engagement** (the
  central transactional object) → EP / Team / Review / Compliance / Documents /
  Audit. See [docs/adr/0002-domain-model.md](docs/adr/0002-domain-model.md).

## Technology

| Layer | Choice |
| --- | --- |
| Frontend (Phase 12) | Next.js (App Router) · React · TypeScript (strict) · Tailwind · TanStack Query/Table · React Hook Form · Zod |
| Backend | NestJS · TypeScript (strict) · REST · OpenAPI/Swagger |
| Database | PostgreSQL 16 · Row Level Security (`FORCE`) · `node-pg-migrate` |
| Data access | `pg` (Phase 0) → Drizzle (from Phase 1, alongside first tables) |
| Auth (Phase 1) | Microsoft Entra ID · MFA for partners/admins |
| Document storage (Phase 10) | Blob storage behind a provider abstraction — **Azure Blob** (prod) · **local filesystem** (dev/test); DB holds metadata only |
| Notifications (Phase 11) | Recipient-scoped inbox · channel abstraction (portal always on; email/Teams pluggable) · idempotent date-driven sweep |
| Cache, jobs | Redis (cache) · Azure Service Bus (jobs) |
| Cloud / secrets / obs. | Azure · Key Vault · App Insights / Azure Monitor |
| Testing | Jest · Supertest · Playwright (E2E, later) · RLS tests |

## Repository layout

```
apps/
  api/          NestJS modular monolith (the backend)
  web/          Next.js portal (Phase 12 — role dashboards + core screens)
packages/
  tsconfig/     shared strict TypeScript config
  contracts/    shared enums/DTOs between api and web (filled per phase)
db/
  migrations/   node-pg-migrate SQL migrations (system of record schema)
  seeds/        seed data (per phase)
infra/
  docker/       local Postgres bootstrap (least-privilege roles)
  terraform/    IaC (skeleton; later)
docs/adr/       Architecture Decision Records
.github/workflows/  CI
```

## Getting started (local development)

Prerequisites: **Node 22+**, **Docker**, and (optionally) a local `psql` client.

```bash
# 1. Install workspace dependencies
npm install

# 2. Start PostgreSQL + Redis (Postgres is published on host port 5433 to avoid
#    clashing with any local PostgreSQL on 5432)
npm run db:up

# 3. Configure the API environment
cp apps/api/env.example apps/api/.env

# 4. Apply database migrations (runs as the migrator role)
npm run db:migrate

# 5. Seed sample identity data (offices + users; runs as the superuser)
npm run db:seed:dev

# 6. Run the API (http://localhost:3001/api/v1)
npm run api
```

Once running:

- Health (liveness): `GET http://localhost:3001/api/v1/health/live`
- Health (readiness): `GET http://localhost:3001/api/v1/health/ready`
- OpenAPI docs: `http://localhost:3001/api/docs`

### Trying the API (dev auth)

The dev auth provider mints tokens for seeded users (non-production only):

```bash
# Mint a token for the Managing Partner, then call a protected endpoint
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/dev-token \
  -H 'content-type: application/json' -d '{"email":"mp@hsdg.in"}' \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).accessToken))")

curl -s http://localhost:3001/api/v1/users -H "authorization: Bearer $TOKEN"
```

Seeded users: `mp@hsdg.in` (Managing Partner), `admin@hsdg.in`,
`partner.a@hsdg.in` (North), `partner.b@hsdg.in` (South), `manager.x@hsdg.in`,
`senior.y@hsdg.in`. Partners in different offices demonstrate RLS scoping.

### Running the web portal (Phase 12)

With the API running, start the Next.js portal (it calls the API directly; CORS
is enabled for `http://localhost:3000`):

```bash
npm run web
```

Open `http://localhost:3000`, then use a **quick sign-in** button (seeded
persona) to land on that role's dashboard. Sign in as the Managing Partner for
the full firm-wide view, or a senior for the personal-work view. Configuration:
copy `apps/web/.env.example` to `apps/web/.env.local` to point at a non-default
API URL.

### Useful scripts

| Command | Description |
| --- | --- |
| `npm run api` | Run the API in watch mode |
| `npm run web` | Run the Next.js portal (http://localhost:3000) |
| `npm run build` | Build all workspaces |
| `npm run lint` / `npm run typecheck` | Lint / typecheck all workspaces |
| `npm test` | Unit tests (no infrastructure required) |
| `npm run test:e2e` | Integration/e2e tests (requires DB up + migrated) |
| `npm run db:up` / `npm run db:down` | Start / stop local infrastructure |
| `npm run db:migrate` | Apply migrations as the migrator role |
| `npm run db:migrate:create -- <name>` | Scaffold a new migration |

## Security posture (foundation)

- Two database roles from day one: `hsdg_migrator` (owns schema, runs
  migrations) and `hsdg_app` (the only runtime role — **no superuser, no
  `BYPASSRLS`**). Provisioned in [infra/docker/postgres/init/00-roles.sql](infra/docker/postgres/init/00-roles.sql).
- The API **verifies on boot** that its connection is genuinely least-privilege
  and **refuses to start** if it is a superuser or can bypass RLS.
- Every data-access transaction carries a security context (`hsdg.user_id`,
  `hsdg.role`, `hsdg.office_id`) via `SET LOCAL`, read by the RLS policies.
- **RLS is live (Phase 1):** `FORCE ROW LEVEL SECURITY` on identity tables,
  office-scoped with a Managing-Partner firm-wide override, fail-closed (no
  context ⇒ no rows). The audit trail is append-only (no UPDATE/DELETE).
- **Role separation (business vs platform):** firm-wide authority is split in
  two — `managing_partner` is **business** firm-wide (all client/engagement
  data), while the technical **`admin`** role is firm-wide only for identity,
  HR, catalogue config and audit **read**, with **no** automatic access to
  client or engagement data (enforced at the data layer *and* the API). See
  [ADR-0009](docs/adr/0009-security-role-separation.md).
- **Accountability integrity:** a database trigger enforces that an Engagement
  Partner is partner-grade and an Engagement Manager is manager-grade — for every
  writer, atomically. See [ADR-0010](docs/adr/0010-engagement-grade-rules-and-concurrency.md).
- **Document access (Phase 10) has no bypass URL:** files live in blob storage
  under opaque references never exposed to clients; a download reads the version
  row under RLS first (non-members get 404) and only then streams the bytes,
  writing an audit event in the same transaction. Version rows are append-only
  and documents are never hard-deleted, so evidence cannot be silently replaced.
  See [ADR-0015](docs/adr/0015-documents.md).
- **Notifications have a deliberately narrow write path (Phase 11):** they are
  recipient-scoped by RLS (a user sees/mutates only their own), and the app role
  **cannot INSERT one directly** — every notification is created through a
  SECURITY DEFINER emit function, so recipients are resolved by business logic
  (never client input) and de-duplicated. See [ADR-0016](docs/adr/0016-notifications.md).
- Authentication (Entra ID / dev providers), MFA enforcement, and permission
  guards sit above RLS — never instead of it.
- Uniform error envelope, correlation IDs on every request/response, and secret
  redaction in logs. The correlation id is carried in an async-local context and
  stamped onto every audit event, tying each recorded action to its request.
- Hardening: `helmet` security headers, per-IP rate limiting (`@nestjs/throttler`),
  and the RLS security context applied in a single round-trip per transaction.

See [ADR-0003](docs/adr/0003-identity-and-rls.md) for the identity/RLS design.

## API (Phase 1)

All endpoints are versioned under `/api/v1`. Everything except health and the
dev-token endpoint requires a bearer token. List endpoints marked _paginated_
accept `?limit=&offset=` and return `{ items, total, limit, offset }`
([ADR-0005](docs/adr/0005-api-conventions.md)).

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/auth/dev-token` | public (non-prod) | Mint a dev token for a seeded user |
| GET | `/auth/me` | bearer | The authenticated principal + derived context |
| GET | `/users` | `user.read` | RLS-scoped list _(paginated)_ |
| GET | `/users/:id` | `user.read` | 404 if outside RLS scope (scope not leaked) |
| GET | `/offices` | `office.read` | |
| GET | `/audit` | `audit.read` | Firm-wide only; append-only trail _(paginated)_ |
| GET | `/employees` | `employee.read` | RLS-scoped _(paginated)_; filter `?status=&grade=&office=` |
| GET | `/employees/:id` | `employee.read` | 404 if outside scope |
| GET | `/employees/:id/reports` | `employee.read` | Direct reports (org structure) |
| POST | `/employees` | `employee.manage` | Create (audited) |
| PATCH | `/employees/:id` | `employee.manage` | Update (audited; optimistic concurrency via `version`) |
| GET | `/partners` | `employee.read` | Partner register |
| GET | `/entities` | `entity.read` | Clients _(paginated)_; filter `?status=&type=&office=&search=` |
| GET | `/entities/:id` | `entity.read` | Detail with registrations + contacts; 404 off-scope |
| GET | `/entities/duplicate-check` | `entity.read` | Exact PAN + fuzzy name candidates |
| POST | `/entities` | `entity.manage` | Create (nested registrations/contacts, audited) |
| PATCH | `/entities/:id` | `entity.manage` | Update (audited; optimistic concurrency) |
| POST | `/entities/:id/registrations` | `entity.manage` | Add a registration (audited) |
| POST | `/entities/:id/contacts` | `entity.manage` | Add a contact/signatory (audited) |
| GET | `/entity-types` | `entity.read` | Entity type reference |
| GET | `/review-models` | `service.read` | Review models (ranked) |
| GET | `/workflow-families` | `service.read` | Workflow families with ordered states |
| GET | `/service-lines` | `service.read` | Service lines |
| POST | `/service-lines` | `service.manage` | Create (audited) |
| PATCH | `/service-lines/:id` | `service.manage` | Update (audited; optimistic concurrency) |
| GET | `/services` | `service.read` | Catalogue _(paginated)_; filter `?serviceLine=&active=&search=` |
| GET | `/services/:id` | `service.read` | Detail with workflow states |
| POST | `/services` | `service.manage` | Create (audited) |
| PATCH | `/services/:id` | `service.manage` | Update (audited; optimistic concurrency) |
| GET | `/engagements` | `engagement.read` | Assignment-scoped _(paginated)_; filter `?status=&entityId=&serviceCode=&office=&mine=` |
| GET | `/engagements/:id` | `engagement.read` | Detail with team; 404 unless assigned |
| POST | `/engagements` | `engagement.manage` | Create (audited) |
| PATCH | `/engagements/:id` | `engagement.manage` | Update (audited; optimistic concurrency) |
| POST | `/engagements/:id/reassign-partner` | `engagement.manage` | Change EP (firm-wide; audited) |
| POST | `/engagements/:id/team` | `engagement.manage` | Assign a team member (audited) |
| DELETE | `/engagements/:id/team/:employeeId` | `engagement.manage` | Remove a team member (audited) |
| POST | `/engagements/:id/{submit-for-acceptance,accept,start,put-on-hold,resume,complete,close,decline,withdraw,cancel,reopen}` | `engagement.manage` | Guarded lifecycle transitions (Phase 6; each audited, versioned, `reopen` is MP-only) |
| GET | `/engagements/:id/lifecycle-history` | `engagement.read` | Lifecycle transition journal _(paginated)_ |
| POST | `/engagements/:id/workflow-transitions` | `engagement.manage` | Advance the service-workflow state (Phase 6; audited) |
| GET | `/engagements/:id/reviews` | `engagement.read` | Review & sign-off history with review points _(paginated)_ |
| POST | `/engagements/:id/reviews` | `engagement.manage` | Record a manager/EP review, optionally raising review points (audited) |
| POST | `/engagements/:id/sign-off` | `engagement.manage` | Terminal sign-off; authority set by the effective review model (audited) |
| POST | `/engagements/:id/review-points/:pointId/resolve` | `engagement.manage` | Resolve an open review point (audited) |
| POST | `/engagements/:id/review-plan` | `engagement.manage` | Escalate the review model (escalate-only; audited) |
| GET | `/compliance-rules` | `compliance.read` | Compliance rules with version history _(paginated)_; filter `?category=&serviceCode=&activeOnly=` |
| GET | `/compliance-rules/:idOrCode` | `compliance.read` | One rule with all versions |
| POST | `/compliance-rules` | `compliance.manage` | Create a rule (firm-wide config; audited) |
| POST | `/compliance-rules/:id/versions` | `compliance.manage` | Add an effective-dated version (append-only; audited) |
| PATCH | `/compliance-rules/:id/active` | `compliance.manage` | Activate/deactivate a rule (audited) |
| GET/POST | `/compliance-holidays` | `compliance.read` / `compliance.manage` | Working-day holiday calendar |
| GET | `/engagements/:id/compliance` | `engagement.read` | Engagement compliance obligations (both clocks + overdue flags) _(paginated)_ |
| GET | `/engagements/:id/compliance/:instanceId` | `engagement.read` | One obligation with its override history |
| POST | `/engagements/:id/compliance` | `engagement.manage` | Generate an obligation from a rule (snapshots the version; audited) |
| POST | `/engagements/:id/compliance/:instanceId/override` | `engagement.manage` | Override a clock's deadline (reason + evidence; audited) |
| POST | `/engagements/:id/compliance/:instanceId/{complete,waive}` | `engagement.manage` | Complete or waive an obligation (audited) |
| GET/POST | `/engagements/:id/tasks` | `engagement.read` / `engagement.manage` | Engagement tasks _(paginated)_; filter `?status=&assignedToEmployeeId=` |
| GET/PATCH | `/engagements/:id/tasks/:taskId` | `engagement.read` / `engagement.manage` | Task detail with blockers / update fields (lead) |
| POST | `/engagements/:id/tasks/:taskId/status` | `task.update` | Progress a task (assignee or lead; blocked while a blocker is open) |
| POST/DELETE | `/engagements/:id/tasks/:taskId/dependencies[/:depId]` | `engagement.manage` | Add/remove a blocker (rejects cycles) |
| GET/POST | `/engagements/:id/client-dependencies` | `engagement.read` / `engagement.manage` | Client dependencies _(paginated)_; request info (→ waiting-for-client) |
| POST | `/engagements/:id/client-dependencies/:id/{receive,close}` | `engagement.manage` | Record receipt / waive-cancel (audited) |
| GET | `/work/tasks` | `engagement.read` | My assigned tasks across engagements _(paginated)_; `?overdueOnly=` |
| GET | `/work/client-dependencies` | `engagement.read` | Open client dependencies I'm waiting on _(paginated)_; `?overdueOnly=` |
| GET | `/engagements/:id/documents` | `engagement.read` | Documents _(paginated)_; filter `?status=&documentType=&classification=&search=` |
| GET | `/engagements/:id/documents/:docId` | `engagement.read` | Detail with full version history |
| POST | `/engagements/:id/documents` | `engagement.manage` | Upload a document (first version; bytes base64; audited) |
| POST | `/engagements/:id/documents/:docId/versions` | `engagement.manage` | Upload a new version (supersedes; earlier versions retained; audited) |
| PATCH | `/engagements/:id/documents/:docId` | `engagement.manage` | Update metadata (audited; optimistic concurrency) |
| POST | `/engagements/:id/documents/:docId/{archive,restore}` | `engagement.manage` | Archive / restore (reason recorded; audited) |
| GET | `/engagements/:id/documents/:docId/download` | `engagement.read` | Download current version bytes (RLS-mediated; audited) |
| GET | `/engagements/:id/documents/:docId/versions/:versionId/download` | `engagement.read` | Download a specific version's bytes (RLS-mediated; audited) |
| GET | `/notifications` | `notification.read` | My notifications _(paginated)_; filter `?status=&unreadOnly=` |
| GET | `/notifications/unread-count` | `notification.read` | Unread badge count |
| POST | `/notifications/read-all` | `notification.read` | Mark all my unread notifications read |
| POST | `/notifications/:id/{read,dismiss}` | `notification.read` | Mark one read / dismiss (404 if not mine) |
| POST | `/notifications/scan` | `notification.scan` | Run the date-driven sweep (MP/worker; idempotent) |
| GET | `/dashboard/summary` | `engagement.read` | RLS-scoped Home-dashboard counts; `?dueSoonDays=` (default 7) |
| GET | `/invoices` | `report.read` | Firm-wide invoices across accessible engagements _(paginated)_; filter `?status=&overdueOnly=&search=` |
| GET | `/invoices/summary` | `report.read` | Billing rollup: counts/totals (outstanding/overdue/paid/draft) + receivables aging |
| GET | `/resources/workload` | `employee.read` | Per-person workload (EP/manager/member + open/overdue tasks) with office/grade rollups; RLS-scoped |

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| **0** | Repository & architecture foundation | ✅ done |
| **1** | Identity & security (users, roles, offices, RLS policies + tests) | ✅ done |
| **2** | Organisation & people (partners, managers, seniors, articles) | ✅ done |
| **3** | Entity master (entities, registrations, contacts, duplicates) | ✅ done |
| **4** | Service catalogue (configurable services & review models) | ✅ done |
| **5** | Engagement core (EP accountability, team, identity) | ✅ done |
| **6** | Engagement lifecycle (explicit guarded transitions) | ✅ done |
| **7** | Review & sign-off engine (review models, sign-off gate, review points) | ✅ done |
| **8** | Compliance engine (effective-dated, versioned; two clocks) | ✅ done |
| **9** | Tasks & client dependencies (waiting-for-client; internal vs client delay) | ✅ done |
| **10** | Documents (blob storage, versioned evidence, audited RLS-mediated access) | ✅ done |
| **11** | Notifications (recipient-scoped inbox, channel abstraction, date-driven sweep) | ✅ done |
| **12** | Dashboard / frontend foundation (Next.js portal, role dashboards, core screens) | ✅ done |
| **13** | Administration (audited user/role/office write flows + admin UI) | ✅ current |

Each phase delivers **database + business logic + API + security + RLS + audit +
tests + documentation** — not merely UI.

The production-hardening follow-ons within Phase 13 have now closed the last
`ComingSoon` screens — **Billing & Collections** (ADR-0025) and **Resource
Management** (ADR-0026) — so every primary navigation item is live. Their natural
next milestones (a Collections workflow — dunning, receipts, part-payments,
multi-currency rollups; and capacity *planning* — availability/leave/allocation)
are called out in those ADRs.

The service-line master has been reconciled to the Service Catalogue Master's
frozen §3 (**ADR-0027**): the advisory-family lines — **FEMA, Valuation, Virtual
CFO, Governance, Forensic** — are now co-equal top-level lines (no longer folded
into Advisory), litigation is a service under Direct Tax rather than a separate
line, and the §17 **Other Professional Services** fallback exists as a governed
line — creating a service under it requires the Managing-Partner-only
`service.manage_other` permission plus a recorded approval reference. The
workflow families now match §19's fifteen named lifecycles (**ADR-0028**), with
each service re-pointed to its family. The configuration layers a service loads —
checklist, PBC, document-requirement — are now **reusable, effective-dated
template masters** with append-only versions, and workflow families carry
effective-dated versions; a configuration snapshots the template and workflow
version it loaded (**ADR-0029**). This closes the §18/§25/§27 catalogue-fidelity
items; the deeper follow-ons (versioning the workflow state machine itself, a
template-authoring UI) are called out in ADR-0029.

Against the **Due-Date Classification** spec, the compliance engine (Phase 8)
already implements the classification, calculation, deadline-layer, extension,
override and escalation model; the rule coverage has now been completed for the
event-triggered statutory obligations (appeals, allotments, incorporation,
resolutions, FDI, amendments), taking bound statutory components to 32/46, with
the remainder deliberately event/manual-driven (**ADR-0030**). The calendar engine
was then completed (**ADR-0031**): the `/compliance/events` fan-out scopes by clock
(an Internal-SLA view) and by service (§22); every event is field-complete —
due-date source, layer owner, extension flag (§23); and each band on the escalation
ladder carries its distinct action (notify owner → alert manager → escalate to
partner → escalate to firm), defined once in `@hsdg/contracts` and shared by the
API, the calendar legend and the notifications (§24). The web Compliance Calendar
gains an obligations/events toggle, the clock views and the escalation legend. A
verification guide lives in `docs/compliance-rules-verification.md` (§25). Finally,
the engagement Compliance tab gained a **Record event** flow (**ADR-0032**): it
lists the service's event-triggered rules
(`GET /engagements/:id/compliance/event-rules`) and generates the chosen
limitation obligation (appeal, allotment, incorporation, FDI, amendment) from a
recorded event date — the last piece bulk generation could only skip — so every
classified obligation in the spec is now reachable from the UI.

## License

UNLICENSED — proprietary to HSDG.
