# ADR-0018 — Administration (User / Role / Office Management)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Phase:** 13 (Administration)

## Context

The identity module (Phase 1) shipped read-only: `GET /users`, `GET /offices`,
and principal/permission resolution for auth. The database, however, was already
complete — migration 0002 created the `users`, `user_roles` and `offices` tables
with **firm-wide-gated RLS write policies** (`users_insert`/`users_update`,
`user_roles_write`, `offices_write`) and a `user.manage` permission granted to
the Managing Partner and administrators. What was missing was the application
surface: write endpoints and an Administration screen so the firm can be managed
from the portal instead of by hand-editing the database or re-running seeds.

This is the first step of the alpha→production hardening track (Administration
is high-value, exercises the role/permission model, and needs no external cloud
access).

## Decisions

### 1. Write endpoints on the existing identity module, audited

`IdentityService` gains `createUser`, `updateUser`, `setUserRoles`,
`createOffice`, `updateOffice` (and `listRoles` for the picker). Each mutation
runs inside the caller's RLS context via `withRlsContext` and records a
before/after entry through `AuditService.recordWith` on the same transaction, so
the change and its audit row commit atomically — identical to the Phase 2
employee write path. No new data-access pattern is introduced.

### 2. Deactivate, never delete

`updateUser` exposes an `isActive` flag; there is no user-delete endpoint. Users
are soft-deactivated so history, assignments and the audit trail stay intact
(consistent with the append-only posture elsewhere: documents, audit).

### 3. Role assignment is a full-set replace (idempotent)

`PUT /users/:id/roles` replaces the user's complete role set rather than exposing
add/remove verbs. The UI edits a checkbox group and sends the intended set; the
service diffs and rewrites `user_roles`. An empty set is legal (a user with no
access). The reserved `system` role can never be assigned — it is absent from
`ASSIGNABLE_ROLES`, excluded by `listRoles`, and rejected by `resolveRoleId`.

### 4. `office.manage` — a permission to match the RLS policy (defence in depth)

Office writes already had an RLS policy (`offices_write`, firm-wide) but no
dedicated permission — the app layer only knew `office.read`. Migration
`1757200000000_admin_office_manage` adds an `office.manage` permission and grants
it to the Managing Partner and administrators, so the **API guard and the
database policy must both agree** before an office row changes. User writes reuse
the existing `user.manage`.

> Reference-data gotcha: the grant joins `hsdg.roles`, which runs under `FORCE`
> ROW LEVEL SECURITY, so the context-less migrator sees zero roles unless `FORCE`
> is briefly dropped on `roles` (as well as `permissions`/`role_permissions`) for
> the duration of the seed — the pattern established in migration 0003. Missing
> the `roles` toggle silently inserts zero grants.

### 5. The UI is a thin, permission-gated client

The Administration screen (`/admin`) is one page with **Users & Roles** and
**Offices** tabs, gated in nav on `user.manage` and again in the page (defence in
depth). Create/edit are modals over the same audited endpoints; the backend
remains authoritative for every rule. Front-end validation is UX only.

## Consequences

- The identity module now imports `AuditModule`; it is the auth bootstrap
  dependency **and** an administered domain.
- Provisioning a firm no longer requires database access — an administrator can
  create offices, users and role assignments through the portal, fully audited.
- Not in scope: bulk import, self-service profile editing, and password/MFA
  enrolment (MFA is asserted by the identity provider, not stored here).
