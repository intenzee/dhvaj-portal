# HSDG Portal

The central **practice-management and professional-work operating system** for
HSDG Chartered Accountants — a merged practice with 12 partners.

The Portal manages the full lifecycle of professional engagements (audit, tax,
GST, accounting, litigation, advisory and more): organisation and people,
client entities and registrations, a configurable service catalogue,
engagements with accountable Engagement Partners, review & sign-off, compliance,
tasks, client dependencies, documents, notifications, reporting and an immutable
audit trail.

> **Status: Phase 13 — Administration (complete).** The firm can now be
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

## License

UNLICENSED — proprietary to HSDG.
