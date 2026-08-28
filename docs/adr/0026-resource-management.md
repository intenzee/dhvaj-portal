# ADR-0026 — Resource Management View

- **Status:** Accepted
- **Date:** 2026-08-28
- **Phase:** 13 (Administration) — production-hardening follow-on

## Context

Reports & MIS (ADR-0020) already computes a **utilisation** rollup — per-employee
active-engagement involvement (as EP / manager / member) plus open and overdue
tasks — RLS-scoped so a partner sees only their accessible workload. The portal's
**Resource Management** nav item, however, was a `ComingSoon` placeholder: there
was no people-facing capacity view answering "who is carrying what, and who is
overloaded" without reading the Utilisation report tab under a management gate.

## Decision

Add one read-only endpoint, `GET /resources/workload` (`ResourcesController`),
gated by `employee.read` (held by everyone — the firm directory permission; RLS
still scopes the rows), backed by `ReportsService.resourceWorkload`.

### 1. Reuse the utilisation rows — one source of truth

The per-person query that powered `GET /reports/utilisation` is extracted into a
private `utilisationRows(client)` helper, now shared by both
`utilisation()` and `resourceWorkload()`. There is exactly one definition of "a
person's workload", so the two views can never disagree. `resourceWorkload` rolls
those rows up by **office** and by **grade** and adds headline totals (people,
active assignments, open/overdue tasks, and how many people carry at least one
overdue task — the "overloaded" count).

### 2. `employee.read`, not `report.read`

Resource Management is a people/directory view, so it sits on `employee.read`
(granted to every role) rather than the management `report.read`. This is
deliberate: RLS already scopes the rows to what the caller can see (a senior sees
only people sharing their engagements), so the broader permission exposes no data
the caller could not already reach — it just puts the capacity lens on the
firm-directory permission where it belongs. The endpoint requires authentication
(401 without a token, asserted in e2e).

### 3. Rollups computed in the app, over RLS-scoped rows

The office/grade grouping is done in TypeScript over the rows the database
returned, not in SQL — the rows are already the RLS-scoped truth, and grouping a
handful of people in memory keeps the endpoint a single query. Grades coalesce a
missing name to "Unassigned"; office is guaranteed present by the inner join to
`offices`, so no null bucket can appear. The e2e suite asserts the totals and the
office-rollup people-count reconcile with the row count, and that a partner sees
no more people than the Managing Partner.

## Consequences

- The Resource Management nav item is now live: capacity tiles (people / active
  assignments / open / overdue / overloaded), by-office and by-grade distribution
  bars, a per-person workload table, and a CSV export.
- The Utilisation report is unchanged and now shares its query with this view.
- **Not in scope (a future milestone):** capacity *planning* — availability,
  leave, and allocation targets — which needs an availability/leave data model
  that does not yet exist. Building it against invented schema was deliberately
  avoided; this view reports on real, existing workload only.
