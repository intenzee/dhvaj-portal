# ADR-0003 — Identity, Authorisation & Row Level Security

- **Status:** Accepted
- **Date:** 2026-08-18
- **Phase:** 1 (Identity & Security)

## Context

Phase 1 introduces the first real data (users, offices, roles, permissions) and
must make the security model from [ADR-0001](0001-architecture.md) concrete:
database-enforced access, fail-closed, provable independently of the UI.

## Decisions

### 1. Security context via transaction-local settings

Every request resolves a `Principal`; the database security context
(`hsdg.user_id`, `hsdg.role`, `hsdg.office_id`) is stamped with `set_config(...,
true)` inside the same transaction as the query. The **effective role** placed
in `hsdg.role` is the highest-precedence role the user holds — this is what RLS
tests for firm-wide vs office-scoped access.

### 2. RLS policies (FORCE) with a fail-closed default

All identity tables have `ENABLE` + `FORCE ROW LEVEL SECURITY`. Scoped tables
(`users`, `user_roles`) are visible to firm-wide roles (Managing Partner, admin)
or within the caller's office, or the caller's own row. With **no context**,
every predicate is NULL/false → **zero rows**. A query that forgets to set
context leaks nothing.

### 3. A reserved, non-assignable `system` context for auth bootstrap

Authentication must read the acting user *before* a real context exists. That
one lookup runs under a reserved `system` context which RLS grants firm-wide
read. `system` is never a row in `roles`, so `user_roles`' foreign key makes it
impossible to assign to any human — no principal can ever obtain it.

### 4. Application authorisation sits above RLS, never instead of it

Global guards run in order: **authenticate** (`AuthGuard`) then **authorise**
(`PermissionsGuard`). Endpoints declare `@RequirePermissions(...)`. Even a
permitted principal only sees rows RLS allows — the two layers are independent
and both required.

### 5. MFA by trusting the identity provider

MFA is not re-implemented. A user may be `mfa_required`; the token carries
whether MFA was satisfied (Entra's `amr` claim; the dev provider sets it
explicitly). `AuthGuard` blocks a required-but-unsatisfied request with 401.

### 6. Pluggable authentication providers

`AuthenticationProvider` is an interface with two implementations selected by
`AUTH_PROVIDER`: `EntraAuthProvider` (production; validates Entra tokens via
JWKS) and `DevAuthProvider` (development/testing; locally-signed JWTs). Token
issuance for dev is gated to non-production. This keeps the system fully
testable without a live tenant while the production path is real code.

### 7. Immutable audit trail

`audit_events` is append-only: the app role has **no** UPDATE/DELETE grant and
there is **no** UPDATE/DELETE policy. Reads are restricted to firm-wide roles.
`AuditService` offers only `record` and `list` — there is no mutation path by
construction.

### 8. Deviation: data access stays on `pg` (Drizzle deferred)

[ADR-0001](0001-architecture.md) anticipated introducing Drizzle in Phase 1.
**We deferred it.** In this security-critical phase, keeping data access as
explicit, parameterised SQL through the RLS-context gateway makes the security
behaviour maximally auditable and keeps the `SET LOCAL` transaction boundary
unambiguous. Introducing an ORM here would add surface area precisely where
clarity matters most. Drizzle can be layered in later for typed query ergonomics
without changing the RLS model. This is a deliberate, recorded change to the
Phase-1 plan, not an omission.

## Consequences

- Cross-office/cross-partner access is denied at the database and proven by
  tests that bypass the application entirely (`test/rls.e2e-spec.ts`).
- Provisioning (role creation, seeding protected tables) must run as a
  privileged/superuser connection — the app role cannot and must not.
- Later phases extend this exact context mechanism (e.g. engagement-level
  partner scoping in Phase 5) rather than inventing new access logic.

## Alternatives considered

- **Application-only authorisation** — rejected; violates the defence-in-depth
  requirement and cannot produce the RLS negative tests.
- **A BYPASSRLS role for auth lookups** — rejected; would hand the app a way to
  bypass RLS entirely. The reserved `system` *context* (not a privileged role)
  achieves the bootstrap read while RLS still governs.
