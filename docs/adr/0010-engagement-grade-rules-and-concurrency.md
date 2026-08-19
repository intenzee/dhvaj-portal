# ADR-0010 — Engagement Accountability Grade Rules & Concurrency Consistency

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase:** Post-Phase-5 checkpoint (before Phase 6)

## Context

Two checkpoint findings, both about the engagement aggregate:

1. **Accountability grade was unenforced.** A foreign key guaranteed
   `engagement_partner_id` / `engagement_manager_id` referenced *an* employee, but
   not their grade — a senior or article could hold partner accountability, which
   contradicts the system's headline invariant ("exactly one accountable
   **Engagement Partner**").
2. **The optimistic-concurrency model was inconsistent.** `updateEngagement` used
   the `version` guard, but `reassignPartner` ignored it and team assign/remove
   did not bump `version` at all — so a roster change was invisible to a client
   holding a stale copy.

## Decisions

### 1. Grade rules enforced in the database (migration 0010)

A `BEFORE INSERT/UPDATE` trigger on `engagements`:
- `engagement_partner_id` must be **partner-grade** (`grades.is_partner_grade`).
- `engagement_manager_id` must be **manager-grade or more senior**
  (`grades.rank >= rank('manager')`).

The check runs only when the column is set and (on UPDATE) actually changed, so
routine updates — notably the Phase 6 status transitions — incur no extra cost.
The trigger raises a clear message; the service maps `P0001` to a `400`.

#### RLS interaction — `employees`/`grades` set to `ENABLE`, not `FORCE`

The trigger must read grade **regardless of the writer's scope**: the superuser
seed carries no security context, and a firm-wide MP may assign a cross-office
EP/manager the caller cannot otherwise see. We reuse the **exact ADR-0008
pattern**: the check function is `SECURITY DEFINER` (runs as the migrator, the
tables' owner) over `employees`/`grades` switched to `ENABLE` — not `FORCE` —
row security. The owner bypasses RLS *inside the check function only*.

This does **not** change runtime access. `hsdg_app` is never the owner, so it
remains fully governed by the unchanged `employees_select` / `grades_read`
policies — the RLS test-suite still proves fail-closed (no context ⇒ 0 rows) and
office-scoped employee visibility as `hsdg_app`. `FORCE` only ever constrained
the migrator, which runs migrations, never runtime queries. (An in-body
`set_config` to fake a context was rejected: a GUC changed mid-statement is not
reliably observed by that statement's own RLS check.)

### 2. Grade-aware accountability defaulting

`createEngagement` previously defaulted the EP to the creator. Now the creator is
defaulted only into a role their grade permits: a **partner** becomes the EP, a
**manager** becomes the manager. A non-partner therefore can't be silently
defaulted into partner accountability, and a manager can open an engagement
(becoming its manager) and nominate a partner EP.

### 3. Concurrency consistency

- Team assign/remove now bump `engagements.version`, so the aggregate version is
  a true optimistic-concurrency token for roster changes.
- `reassignPartner` accepts an optional expected `version` and returns `409` on a
  stale copy, matching `updateEngagement`.

## Consequences

- Accountability integrity is enforced at the data layer, atomically, for every
  writer including the seed — proven by tests (non-partner EP ⇒ 400, non-manager
  manager ⇒ 400, manager-creates-becomes-manager, team change bumps version,
  stale reassign ⇒ 409).
- `employees`/`grades` join the engagement tables as `ENABLE`-not-`FORCE`;
  runtime governance for the app role is unchanged and test-verified.
- Reversible: migration 0010 down restores `FORCE` on both tables and drops the
  trigger (verified down→up).
