# ADR-0020 — Reports & MIS

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 13 (Administration) — production-hardening follow-on

## Context

The Home dashboard (Phase 12, ADR-0017) gives each user a set of RLS-scoped
counts. Management needs the next layer up: firm/partner **MIS** — engagement
rollups by status/service-line/office/EP, compliance posture by category, and
per-person workload — with export. This is a read-only aggregation concern over
the existing RLS-protected read models; no new source of truth.

## Decision

Add a `reports` module: `ReportsService` + `ReportsController` exposing three
read endpoints under `/reports` (`engagements`, `compliance`, `utilisation`).

### 1. Same RLS scoping as the dashboard — the database does the scoping

Every query runs under the caller's RLS context via `withRlsContext`, exactly
like `DashboardService`. `GROUP BY`/`FILTER` aggregate only the rows the caller
can see, so a partner's MIS reflects their accessible engagements and the
Managing Partner's reflects the firm — with no scope logic in the service. An
e2e test asserts `partner.total ≤ mp.total`, and that `byStatus` counts sum to
the reported total.

### 2. A dedicated `report.read` permission (management tier)

Unlike the all-staff dashboard, MIS surfaces cross-engagement rollups and
per-employee workload — a management concern. Migration
`1757300000000_report_read` adds a `report.read` permission granted to
**managing_partner, admin, partner, manager**; seniors/articles keep their
personal dashboard but do not get firm MIS. RLS still floors the numbers, so the
permission governs *access to the view*, not *what the view discloses*.

### 3. Utilisation filters to visible involvement

The utilisation query counts, per employee, active engagements as EP / manager /
team member and open / overdue assigned tasks — each an RLS-scoped subquery — and
the outer query drops anyone with zero visible involvement. Because the
subqueries are RLS-scoped, a caller never sees workload derived from engagements
they cannot access.

### 4. Export is client-side

CSV export builds the file in the browser from the already-fetched report data
(`downloadCsv`) — no export endpoint, no second round-trip, no server-rendered
file to secure. The data shown is the data exported.

## Consequences

- The Reports & MIS nav item is live, gated on `report.read`.
- Reports are pure read projections; they add no write path and no new scope.
- Not in scope (future): time-series/trend history, scheduled report delivery,
  and drill-through from a rollup to the underlying list.
