# ADR-0025 — Firm-wide Billing & Collections View

- **Status:** Accepted
- **Date:** 2026-08-28
- **Phase:** 13 (Administration) — production-hardening follow-on

## Context

Commercial & Billing (§31, ADR-0024's sibling migration `1759500000000`) is
engagement-scoped: `engagement_commercial`, `invoices` and `invoice_line_items`
all hang off an engagement, and every route lives under
`/engagements/:id/invoices`. The `invoices` SELECT policy scopes a row to
`is_engagement_member`, so a caller sees an invoice exactly when they can see its
engagement. The portal's **Billing & Collections** nav item was a `ComingSoon`
placeholder: there was no firm-wide view of what has been billed, what is
outstanding, and what is overdue — the practice's collections signal.

## Decision

Add two read-only endpoints under a new `/invoices` root
(`InvoicesListController`), both gated by `report.read` (the management tier, the
same audience as Reports & MIS), backed by `CommercialService`:

- `GET /invoices` — cross-engagement invoice list (`listAllInvoices`).
- `GET /invoices/summary` — counts/totals rollup + receivables aging
  (`billingSummary`).

### 1. Reuse the existing RLS scope — no new visibility surface

Both methods run their queries under the caller's RLS context against
`hsdg.invoices`. Because the invoices policy already scopes rows to accessible
engagements, the firm-wide list returns **exactly** the union of what the
per-engagement lists return — the same visibility, flattened. No new policy,
permission, or scope is introduced. The e2e suite asserts a partner in another
office does **not** see an invoice on an engagement they are not on, and that a
partner's `summary` counts never exceed the Managing Partner's.

### 2. Management gate on top of RLS (defence in depth)

RLS already limits *rows*; `report.read` limits *who can open the screen at all*,
matching Reports & MIS. A senior (no `report.read`) is refused with 403 even
though RLS would have scoped their rows to nothing — the screen is a management
function, so the permission guard states that intent explicitly. `report.read`
is held by Managing Partner / admin / partner / manager.

### 3. LEFT JOIN the client entity (defence against RLS asymmetry)

The list projection joins `engagements` (same access scope as the invoices) for
`engagement_code`, and **LEFT JOIN**s `entities` for the client name — the same
reasoning as ADR-0019: entities carry office-scoped RLS that is not identical to
engagement-assignment scope, so a LEFT JOIN guarantees an invoice a user may see
is never hidden because the client row is outside their entity scope (the name
renders blank in that edge case). Correctness over cosmetic completeness.

### 4. Derived `overdue` + receivables aging, computed in the database

`overdue` (issued and past `due_date`) is computed in SQL and used both to sort
overdue invoices to the top of the list and to filter (`?overdueOnly=true`). The
summary adds a receivables **aging** partition over the outstanding (issued,
unpaid) invoices — Not yet due / 1–30 / 31–60 / 61–90 / 90+ days past due —
computed with a `CASE` over `CURRENT_DATE - due_date`. The aging bands partition
`outstanding`, so their counts sum to `outstanding.count` (asserted in e2e).

### 5. Money totals are naive cross-currency sums (documented simplification)

`billingSummary` sums `total` across the caller's visible invoices and labels the
result with the **dominant** invoice currency in scope. HSDG bills in INR in
practice; a mixed-currency headline would need per-currency rollups, which is a
product decision deferred to the Collections milestone. Counts are exact and
currency-agnostic; the per-invoice currency is shown on every list row.

### 6. Writes stay on the audited per-engagement routes

The view is strictly read-only. Creating, issuing, paying or voiding an invoice —
and its audit trail and lead/team context — all remain on
`/engagements/:id/invoices/…`. The global list carries `engagementId`, so the UI
deep-links a row to that engagement's Invoices tab. No new write path or way to
mutate money is created.

## Consequences

- The Billing & Collections nav item is now live: outstanding / overdue / paid /
  draft tiles, a receivables-aging panel, and a filterable (status / overdue /
  search) paginated invoice table that deep-links to each engagement.
- The per-engagement commercial API and its guarantees are unchanged; this is
  purely additional read projections over the same rows.
- **Not in scope (a future Collections milestone):** payment reminders / dunning,
  receipts and part-payment tracking, and multi-currency rollups.
