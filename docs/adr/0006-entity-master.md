# ADR-0006 — Entity Master (Clients)

- **Status:** Accepted
- **Date:** 2026-08-18
- **Phase:** 3 (Entity Master)

## Context

Phase 3 introduces the client registry: entities, their statutory registrations,
and contacts — with duplicate detection. It reuses the RLS/audit/pagination/
concurrency patterns from Phases 1–2.

## Decisions

### 1. Entity shape

`entities` carries the legal name, a nullable-but-unique **PAN** (the primary
Indian tax identity and the hard duplicate key), an entity **type** (reference
table: company/LLP/partnership/individual/trust/…), a **home office**, an
optional **parent** (group/holding structure), status, and an auto-generated
`ENT#####` code. `entity_registrations` holds the 0..n other registrations
(GSTIN per state, CIN, LLPIN, TAN, IEC, …); `entity_contacts` holds
directors/signatories with at most one primary.

### 2. Access: office-scoped, partners manage their own clients

Entities are scoped by `home_office_id`. RLS: firm-wide roles (MP/admin) see and
manage all; office-scoped roles see and manage **only their office's** clients —
so a partner can create/update their office's entities but not another office's
(the `WITH CHECK` turns a cross-office write into a 403). Application permissions
gate the door (`entity.read` for all staff, `entity.manage` for MP/admin/partner)
and RLS enforces the rows underneath. Engagement-level access layers on in Phase
5. Fail-closed with no context.

### 3. Duplicate detection — hard and soft

- **Hard:** a partial unique index on PAN (`WHERE pan IS NOT NULL`) blocks true
  duplicates **globally** — even a PAN in another office the caller can't see
  still raises a conflict on insert (the index is not subject to RLS).
- **Soft:** `pg_trgm` powers a `duplicate-check` endpoint that returns an exact
  PAN match plus fuzzy legal-name candidates (`similarity > 0.3`), so the UI can
  warn before creating. Soft results are RLS-scoped (you see the candidates you
  are allowed to see); the hard guard covers the rest.

### 4. Extensions must be reachable by the app role

`pg_trgm` (and citext, pgcrypto) install into the `public` schema, which we
locked down. Calling `similarity()` therefore requires the app role to have
`USAGE` on `public`. Migration 0006 grants it. `CREATE` stays revoked and
`public` holds no application data, so the least-privilege posture is intact.
(Caught in Phase 3 when `similarity()` failed for the app role.)

### 5. Reuse of established conventions

Nested transactional create (entity + registrations + contacts) with a single
audited `entity.created`; audited `entity.updated` / `entity.registration_added`
/ `entity.contact_added`; optimistic concurrency via `version`; offset
pagination; RLS child-row policies via `EXISTS` on the parent entity.

## Cross-cutting fixes made in this phase

- **Validation parity (real bug):** `main.ts` runs `ValidationPipe` with
  `forbidNonWhitelisted: true`, but the e2e harness had configured a looser pipe
  — so list endpoints that combined `@Query() dto` with extra `@Query('x')`
  params returned **400 in production** while tests passed. Fixed by (a) giving
  each list endpoint a single query DTO with every param whitelisted
  (`EntityListQueryDto`, `EmployeeListQueryDto`), and (b) a shared `createTestApp`
  the e2e suites use so tests run the exact production configuration. Regression
  tests were added (`?search=` returns 200; `?bogus=` returns 400).

## Consequences

- A searchable, de-duplicated client registry with office-level confidentiality.
- The write+audit+concurrency pattern now spans three domains and is stable.
- Tests exercise production validation, closing a class of false-green bugs.

## Alternatives considered

- **PAN inside `entity_registrations`** — rejected; PAN is 1:1 and the dedup key,
  so it belongs on the entity for a fast partial-unique guard.
- **Grant `public` broadly / move extensions to `hsdg`** — the minimal `USAGE`
  grant keeps the lockdown while enabling extension functions.
