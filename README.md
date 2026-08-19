# HSDG Portal

The central **practice-management and professional-work operating system** for
HSDG Chartered Accountants — a merged practice with 12 partners.

The Portal manages the full lifecycle of professional engagements (audit, tax,
GST, accounting, litigation, advisory and more): organisation and people,
client entities and registrations, a configurable service catalogue,
engagements with accountable Engagement Partners, review & sign-off, compliance,
tasks, client dependencies, documents, notifications, reporting and an immutable
audit trail.

> **Status: Phase 5 — Engagement Core (complete).** The central transactional
> object is live: engagements with identity (Entity + Service + FY + Period),
> one accountable Engagement Partner, a manager, and a per-engagement **team of
> shared resources**. Access is **assignment-based** — a team member sees an
> engagement (and its client and co-workers) regardless of office — enforced by
> PostgreSQL RLS and proven by tests independent of the API. Audited management,
> EP-reassignment governance, and optimistic concurrency throughout. Remaining
> modules follow phase by phase — see [Roadmap](#roadmap).

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
| Frontend (from Phase 12) | Next.js · React · TypeScript · Tailwind · shadcn/ui · TanStack Query/Table · React Hook Form · Zod |
| Backend | NestJS · TypeScript (strict) · REST · OpenAPI/Swagger |
| Database | PostgreSQL 16 · Row Level Security (`FORCE`) · `node-pg-migrate` |
| Data access | `pg` (Phase 0) → Drizzle (from Phase 1, alongside first tables) |
| Auth (Phase 1) | Microsoft Entra ID · MFA for partners/admins |
| Docs, cache, storage | Azure Blob (documents) · Redis (cache) · Azure Service Bus (jobs) |
| Cloud / secrets / obs. | Azure · Key Vault · App Insights / Azure Monitor |
| Testing | Jest · Supertest · Playwright (E2E, later) · RLS tests |

## Repository layout

```
apps/
  api/          NestJS modular monolith (the backend)
  web/          Next.js portal (reserved; begins Phase 12)
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

### Useful scripts

| Command | Description |
| --- | --- |
| `npm run api` | Run the API in watch mode |
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

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| **0** | Repository & architecture foundation | ✅ done |
| **1** | Identity & security (users, roles, offices, RLS policies + tests) | ✅ done |
| **2** | Organisation & people (partners, managers, seniors, articles) | ✅ done |
| **3** | Entity master (entities, registrations, contacts, duplicates) | ✅ done |
| **4** | Service catalogue (configurable services & review models) | ✅ done |
| **5** | Engagement core (EP accountability, team, identity) | ✅ current |
| 6 | Engagement lifecycle (explicit guarded transitions) | ⬜ |
| 7 | Review & sign-off engine | ⬜ |
| 8 | Compliance engine (effective-dated, versioned) | ⬜ |
| 9 | Tasks & client dependencies | ⬜ |
| 10 | Documents (Azure Blob + audited access) | ⬜ |
| 11 | Notifications | ⬜ |
| 12 | Dashboard / frontend foundation | ⬜ |

Each phase delivers **database + business logic + API + security + RLS + audit +
tests + documentation** — not merely UI.

## License

UNLICENSED — proprietary to HSDG.
