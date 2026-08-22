# ADR-0019 — Cross-Engagement Documents View

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 13 (Administration) — production-hardening follow-on

## Context

Documents (Phase 10, ADR-0015) are engagement-scoped: every route lives under
`/engagements/:id/documents`, and access **inherits the engagement** — the
`documents` table's RLS lets a caller see a row exactly when they can see its
engagement. The production-hardening track needs a **firm-wide Documents screen**
that lists a user's document evidence across every engagement they can access,
which the per-engagement routes cannot serve without the client fanning out over
every engagement id.

## Decision

Add one read-only endpoint, `GET /documents` (`DocumentsListController`,
`engagement.read`), backed by `DocumentsService.listAll`.

### 1. Reuse the existing RLS scope — no new visibility surface

`listAll` runs a single `SELECT … FROM hsdg.documents d` under the caller's RLS
context. Because the documents policy already scopes rows to accessible
engagements, this returns **exactly** the union of what the per-engagement list
returns — the same visibility, flattened. No new policy, permission, or scope is
introduced; the e2e suite asserts a caller does **not** see documents on an
engagement they are not assigned to.

### 2. LEFT JOIN the client entity (defence against RLS asymmetry)

The projection joins `engagements` (same access scope as the documents) to add
`engagement_code`, and **LEFT JOIN**s `entities` for the client name. Entities
carry their own office-scoped RLS, which is not identical to engagement-assignment
scope; a LEFT JOIN guarantees a document a user is entitled to see is **never
hidden** because the client row happens to be outside their entity scope — the
name simply renders blank in that edge case. Correctness (never hide accessible
evidence) is chosen over cosmetic completeness.

### 3. Downloads stay on the audited per-engagement route

The global list carries `engagementId`, so the UI downloads through the existing
`GET /engagements/:id/documents/:docId/download` — the audited, RLS-mediated,
stream-through-the-API path. No new way to reach the bytes is created; a document
id still cannot be turned into a direct storage URL (ADR-0015 invariant intact).

## Consequences

- The Documents nav item is now live; the screen filters by status/type/
  classification/search and paginates.
- The per-engagement documents API and its guarantees are unchanged; this is
  purely an additional read projection over the same rows.
- Not in scope: uploading or re-versioning from the global view (those remain on
  the engagement, where team/lead context applies).
