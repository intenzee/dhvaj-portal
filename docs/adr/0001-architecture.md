# ADR-0001 — Foundational Architecture

- **Status:** Accepted
- **Date:** 2026-08-18
- **Phase:** 0 (Repository & Architecture)

## Context

HSDG needs a central operating system for professional work across 12 partners
and many service lines (audit, tax, GST, accounting, litigation, advisory, …).
The system must be extensible toward billing/WIP, a client portal, external
integrations and analytics, while enforcing Big-4-grade controls: explicit
accountability, strong auditability, segregation of duties, configurable
workflows, and reliable compliance calculations.

This ADR records the foundational decisions made in Phase 0.

## Decisions

### 1. Modular monolith, not microservices

A single deployable NestJS application, internally organised into modules with
clear responsibilities and no circular dependencies. Background/event-driven
processing (Azure Service Bus + workers) is introduced when first needed, not
up front.

**Why:** the domain is highly relational and transactional (an engagement ties
together people, entities, services, reviews, compliance, documents and audit).
A monolith over one PostgreSQL instance gives transactional integrity and far
lower operational complexity than microservices. Module boundaries keep it
maintainable and leave a clean seam to extract services later if ever needed.

Conceptual modules: `identity, organisation, entities, services, engagements,
workflows, reviews, compliance, tasks, dependencies, documents, notifications,
reporting, audit, administration`, plus cross-cutting `config`, `common`,
`database`, `health`.

### 2. PostgreSQL is the single system of record

No MongoDB as a primary transactional store. Documents/files live in Azure Blob
Storage; PostgreSQL stores only their metadata and storage references.

### 3. Defence-in-depth security, enforced at the database

Security layers: **authentication → application authorisation → business rules
→ PostgreSQL Row Level Security → data**. Frontend permissions are UX only and
never authoritative.

Concrete Phase 0 posture:

- **Two roles.** `hsdg_migrator` owns the schema and runs migrations;
  `hsdg_app` is the only role the running API uses. `hsdg_app` is **not** a
  superuser and does **not** have `BYPASSRLS`, so RLS always applies to it.
- **Fail-closed startup.** On boot the API asserts its connection is genuinely
  least-privilege and refuses to start if the role is a superuser or can bypass
  RLS. (Verified in Phase 0.)
- **Transaction-local security context.** Every RLS-governed unit of work runs
  in a transaction that stamps `hsdg.user_id`, `hsdg.role`, `hsdg.office_id` and
  `hsdg.org_id` via `SET LOCAL` (using parameterised `set_config`, never string
  interpolation). Because the settings are transaction-local, they cannot leak
  across pooled connections. RLS policies added from Phase 1 read these values.
- **`FORCE ROW LEVEL SECURITY`** will be applied to protected tables as they are
  created, so even the table owner is subject to policy.

### 4. Raw SQL migrations via `node-pg-migrate`

Schema is managed as reviewed SQL migrations, run as `hsdg_migrator`. Role-level
provisioning (creating roles, per-database `search_path`, locking down the
`public` schema) is done once by the superuser-run init script, because a
least-privilege migrator cannot alter other roles — a healthy separation.

**Why not an ORM's migration engine:** RLS, `FORCE RLS`, custom roles, grants
and `SET LOCAL` context need precise SQL control. ORMs tend to fight this. We
use `pg` directly in Phase 0 and will introduce **Drizzle** for typed queries in
Phase 1 alongside the first real tables; Drizzle exposes raw SQL and lets us
own the connection/transaction, so it coexists with RLS rather than hiding it.

### 5. Configuration over hard-coding

Statutory dates, review models, permitted-review rules, service workflows,
partner names and office names are **data**, not source constants. Compliance
rules are effective-dated and versioned so historical calculations never change
when future rules do (Phase 8).

### 6. Cross-cutting foundation

- **Config:** `@nestjs/config` with a **Zod** schema that validates the
  environment and aborts boot on any invalid/missing value (fail-closed).
- **Logging:** `nestjs-pino` structured JSON logs; a correlation id per request
  (honoured from `x-correlation-id` or minted), echoed on the response and
  attached to every log line; secrets/authorization headers redacted.
- **Errors:** a single global exception filter emits a uniform `ErrorResponse`
  envelope (code, message, details, path, timestamp, correlationId). Unexpected
  errors are logged in full but never leak internals to clients.
- **API:** REST, URI-versioned under `/api/v1`, documented with OpenAPI/Swagger
  at `/api/docs`. Sensitive state changes will use explicit command endpoints
  (e.g. `POST /engagements/:id/accept`), never unrestricted generic `PATCH`.
- **Testing:** Jest + Supertest; unit tests need no infrastructure; e2e/RLS
  tests run against a real PostgreSQL in CI. Every important rule gets a success
  **and** a failure test.

## Consequences

- Strong transactional integrity and a single, auditable security model.
- Database-enforced access that holds even if application code is bypassed.
- Slightly more up-front SQL/role discipline in exchange for correctness and
  auditability appropriate to a professional-services firm.
- A clean, phase-by-phase path: each domain module adds its tables, RLS
  policies, endpoints, audit events and tests behind this foundation.

## Alternatives considered

- **Microservices** — rejected for Phase 0: unnecessary operational complexity
  for a highly relational domain; can be extracted later along module seams.
- **ORM-managed schema (Prisma/TypeORM migrations)** — rejected as the schema
  authority because of friction with RLS/roles/`SET LOCAL`.
- **Application-only authorisation** — rejected as insufficient; the brief and
  Big-4 expectations require database-enforced access (RLS) with negative tests.
