# ADR-0005 — API Conventions: Dates, Pagination, Optimistic Concurrency

- **Status:** Accepted
- **Date:** 2026-08-18
- **Phase:** 2 (post-review hardening, before Phase 3)

## Context

A review after Phase 2 surfaced one correctness bug and two conventions worth
establishing *before* the large domains (entities, engagements) are built, so
later work inherits the right shapes instead of retrofitting them.

## Decisions

### 1. `date` columns are strings, not timezone-shifted Dates

**Bug:** node-postgres parses a bare SQL `date` into a JS `Date` at the server's
*local* midnight; serialising with `toISOString()` then crosses the UTC boundary.
On an IST server, `2024-06-01` was returned as `2024-05-31` — an off-by-one that
would corrupt statutory/compliance dates (Phase 8) for an Indian CA firm.

**Fix:** a global pg type-parser override (`src/database/pg-types.ts`) returns
`date` (OID 1082) as its raw `YYYY-MM-DD` string. A `date` has no time or zone,
so it must never be run through a timezone conversion. Timestamps (`timestamptz`)
are unaffected and still serialise as ISO instants.

### 2. Offset pagination with a uniform envelope

Every list endpoint that can grow returns:

```json
{ "items": [...], "total": <pre-limit count>, "limit": 20, "offset": 0 }
```

via `?limit=&offset=` (`limit` default 20, max 100). The `total` is computed in
the **same** query with a `count(*) OVER()` window, so pagination costs one
round-trip, not two. Shared `Paginated<T>` type lives in `@hsdg/contracts`;
`PaginationQueryDto` + `paginate()` live in `common/pagination`.

Applied now to `/users`, `/employees`, `/audit`. Naturally-bounded lists
(`/partners`, `/offices`, `/employees/:id/reports`) stay plain arrays. Cursor
pagination can be added later behind the same envelope if a feed needs it.

### 3. Optimistic concurrency via a `version` column

Mutable rows carry an integer `version` (starts at 1). Updates always
`SET version = version + 1`; when a caller supplies an expected `version`, the
`UPDATE` matches `… AND version = $expected` and a zero-row result (on an
existing row) returns **409 Conflict** — a lost update was prevented. `version`
is returned on every record so clients can round-trip it.

Introduced on `employees` (migration 0005). This is the pattern the engagement
lifecycle (Phase 6) and every other concurrent-write domain will follow;
supplying the version is optional today and becomes mandatory where correctness
demands it.

## Consequences

- Dates are correct regardless of server timezone.
- List responses have a stable, paginated shape from here on — no breaking
  change when a table grows large.
- A ready concurrency pattern exists before the first stateful workflow.

## Alternatives considered

- **Store dates as `timestamptz`** — rejected; a joining/compliance date is a
  calendar date, not an instant, and shouldn't carry a zone.
- **Cursor pagination everywhere now** — deferred; offset is simpler and
  adequate for current list sizes, and the envelope leaves room to switch.
- **`SELECT … FOR UPDATE` locking** — heavier and holds locks; optimistic
  versioning fits an HTTP request/response model better.
