# HSDG Portal

The central **practice-management and professional-work operating system** for
HSDG Chartered Accountants — a merged practice with 12 partners.

The Portal manages the full lifecycle of professional engagements (audit, tax,
GST, accounting, litigation, advisory and more): organisation and people,
client entities and registrations, a configurable service catalogue,
engagements with accountable Engagement Partners, review & sign-off, compliance,
tasks, client dependencies, documents, notifications, reporting and an immutable
audit trail.

> **Status: Phase 0 — Foundation.** This repository currently contains the
> production-grade foundation only (repo structure, backend skeleton, database
> bootstrap with Row Level Security posture, migrations, config, logging, error
> handling, OpenAPI, testing, CI). **No business modules are implemented yet.**
> Development proceeds phase-by-phase — see [Roadmap](#roadmap).

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

# 5. Run the API (http://localhost:3001/api/v1)
npm run api
```

Once running:

- Health (liveness): `GET http://localhost:3001/api/v1/health/live`
- Health (readiness): `GET http://localhost:3001/api/v1/health/ready`
- OpenAPI docs: `http://localhost:3001/api/docs`

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
  `hsdg.role`, `hsdg.office_id`, `hsdg.org_id`) via `SET LOCAL`, ready for the
  RLS policies added from Phase 1.
- Uniform error envelope, correlation IDs on every request/response, and secret
  redaction in logs.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| **0** | Repository & architecture foundation | ✅ current |
| 1 | Identity & security (users, roles, offices, RLS policies + tests) | ⬜ |
| 2 | Organisation & people (partners, managers, seniors, articles) | ⬜ |
| 3 | Entity master (entities, registrations, contacts, duplicates) | ⬜ |
| 4 | Service catalogue (configurable services & review models) | ⬜ |
| 5 | Engagement core (EP accountability, team, identity) | ⬜ |
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
