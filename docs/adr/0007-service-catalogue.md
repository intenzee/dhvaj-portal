# ADR-0007 — Service Catalogue

- **Status:** Accepted
- **Date:** 2026-08-18
- **Phase:** 4 (Service Catalogue)

## Context

Phase 4 defines the firm's configurable offering — the backbone engagements
reference from Phase 5. It embodies the brief's "configuration over hard-coding"
principle: services, review requirements and workflows are **data**, not source
constants.

## Decisions

### 1. Shape

- `review_models` — Manager / Key-Matter / Full-EP, each with a **rank**
  (rigour). Reference data.
- `service_lines` — Audit, Tax, GST, Accounts, ROC, Litigation, Advisory.
  Firm-managed (create/update).
- `workflow_families` + `workflow_states` — a family (e.g. audit_workflow) owns
  an ordered set of states (planning → fieldwork → review → EP sign-off →
  completed), one initial per family. This is the **service-specific** workflow,
  kept separate from the universal engagement lifecycle (Phase 6). Reference data.
- `services` — the catalogue entry: code, line, **required (minimum) review
  model**, workflow family, default recurrence, `is_active`, `version`.

### 2. Firm-wide configuration, not office-scoped

Unlike entities, the catalogue is global. RLS: any authenticated context reads
(`ctx_role() IS NOT NULL`); only firm-wide (MP/admin) writes. Application
permissions: `service.read` for everyone, `service.manage` for MP/admin. Both
layers apply — a non-firm-wide role is blocked by the RLS `WITH CHECK` even
before the permission guard. Fail-closed with no context.

### 3. What is API-managed vs seeded reference

Services and service lines are managed via the API (create/update, audited,
optimistic concurrency). Review models and workflow definitions are seeded
reference config (read-only via the API this phase) — the review-model set is a
stable conceptual triad, and authoring workflow state machines via API is
deferred until there is a need. This still honours "configuration over
hard-coding": it is all data, versioned in migrations.

### 4. The required-review-model rule (data now, enforced later)

Each service stores its **minimum** review model (by rank). The rule "a service
may not be signed off below its required model" (e.g. no statutory audit
completes below Full EP Review) is represented here as data + a pure helper
`meetsReviewRequirement(requiredRank, actualRank)` in `@hsdg/contracts`, and will
be enforced at sign-off in Phase 7.

### 5. Reuse of established conventions

Offset pagination, audited writes (`service.created` / `service.updated` /
`service_line.*`), optimistic concurrency via `version`, whitelisted combined
query DTOs, the shared `translatePgError`, and the FORCE-toggle pattern for
reference-data seeding — all as in Phases 2–3.

## Post-phase review

No urgent errors. Unlike the entity list (fixed in Phase 3), the service list
joins reference tables rather than running correlated subqueries, so `EXPLAIN`
shows `Limit → WindowAgg → join` with no per-row `SubPlan` — already efficient.
No changes warranted.

## Consequences

- A configurable catalogue engagements can point at (Phase 5), carrying the
  review requirement and workflow each engagement inherits.
- The universal-lifecycle-vs-service-workflow separation is now concrete.

## Alternatives considered

- **Hard-coded service list / review rules** — rejected outright; the brief
  requires configuration.
- **Office-scoping the catalogue** — rejected; the firm offers one catalogue.
- **Full workflow-authoring API now** — deferred; state-machine editing is
  substantial and not needed until workflows are exercised (Phase 6).
