# ADR-0004 — Organisation & People

- **Status:** Accepted
- **Date:** 2026-08-18
- **Phase:** 2 (Organisation & People)

## Context

Phase 2 adds the firm's HR/organisational model on top of Phase 1 identity:
who works at the firm, at what grade, in which office, reporting to whom — and
the partner register. It must not blur two distinctions the brief treats as
fundamental.

## Decisions

### 1. HR grade ≠ security role

`grades` (Partner / Manager / Senior / Article, each with a `rank`) describe a
person's professional standing. They are **separate** from identity `roles`
(Phase 1), which grant permissions. A person can hold a Manager grade and an
Admin role; the seed data deliberately shows this. Conflating the two would tie
access to HR position, which the firm explicitly does not want.

### 2. Reporting line ≠ access

`employees.reports_to_id` captures org structure only. It confers **no** data
visibility. RLS scopes employee data by office (with a firm-wide override),
never by reporting chain. Engagement-level access is granted explicitly later
(Phase 5+). This keeps "shared resources" (a senior serving several partners)
possible without reporting lines leaking access.

### 3. Employees are distinct from users

`employees` is the person/HR record; `users` (Phase 1) is the login identity.
The link is optional (`employees.user_id`, nullable) — not every employee logs
in (e.g. articles), and some users are not employees. This avoids forcing an
auth identity onto every person.

### 4. RLS consistent with Phase 1

`grades`, `employees`, `partner_profiles` all run `FORCE ROW LEVEL SECURITY`.
Employees are office-scoped with a Managing-Partner/admin firm-wide override and
fail-closed with no context. `grades` are reference data (read by any
authenticated context; migration-managed, no app writes). Writes to employees
require both the `employee.manage` permission (app layer) and firm-wide context
(RLS).

### 5. Writes are audited atomically

`POST /employees` and `PATCH /employees/:id` record `employee.created` /
`employee.updated` audit events **in the same transaction** as the change (via
`AuditService.recordWith(client, …)`), so a mutation and its audit entry commit
or roll back together. Updates capture before/after state.

### 6. Employment status is a light lifecycle

`employment_status ∈ {active, on_leave, notice_period, exited}` with a database
`CHECK` that an `exited` employee has a date of exit. This is a data constraint,
not the guarded state machine that engagements get in Phase 6.

## Operational note — reference-data migrations under FORCE RLS

Reference tables (`roles`, `permissions`, `role_permissions`, `grades`) run
`FORCE ROW LEVEL SECURITY`, which subjects even the owning migrator to policy.
A migration that **reads or writes** such a table has no security context, so
its policies evaluate fail-closed (zero rows) — silently corrupting seed logic
(e.g. a `role_permissions` insert that joins `roles` would insert nothing).

**Pattern:** briefly `ALTER TABLE … NO FORCE ROW LEVEL SECURITY` around the
reference-data change — for **every** such table the statement touches, reads
included — then restore `FORCE`. Migrations 0003 and 0004 follow this. (This was
caught in Phase 2 when employee-permission grants silently inserted zero rows
because the join read the FORCE-protected `roles` table.)

## Consequences

- A clean org/HR layer that keeps access decisions out of HR structure.
- The write+audit pattern established here is reused by every later mutating
  domain (engagements, reviews, compliance).
- Reference-data migrations must consciously toggle FORCE — documented and now
  covered by the full-chain migration test in CI.
