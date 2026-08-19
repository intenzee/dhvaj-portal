# ADR-0011 — Engagement Lifecycle & Workflow Engine

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase:** 6 (Engagement Lifecycle & Workflow Engine)

## Context

Through Phase 5, `PATCH /engagements/:id { status }` accepted any value in the
`engagements.status` CHECK list with no transition validation — any caller
holding `engagement.manage` could move an engagement from `prospect` straight
to `closed`, or from `completed` back to `active`, in one request. Phase 6
replaces that with a controlled, auditable, configurable state-transition
architecture, and lays the foundation for the service-workflow instance that
Phase 7's review engine will attach to.

Four distinct concepts stay separate, per the brief: **A.** the engagement
lifecycle (governance/commercial state — this phase), **B.** the service
workflow (how the work is performed — foundation only, this phase), **C.**
review state (Phase 7), **D.** compliance state (Phase 8). Review state and
compliance state are deliberately *not* folded into `engagements.status`.

## Decisions

### 1. Configuration says what transitions exist; code says who may use them

`hsdg.engagement_lifecycle_transitions` is a migration-managed reference table
(action, from_status, to_status, display_name, is_active) — 14 rows covering
the 11 actions in §4 of the brief. It is the single source of truth for legal
`from → to` shapes, read by any authenticated role, written only by
migrations (same pattern as `workflow_states`/`review_models`).

Business/security rules are **not** pushed into that table. Each action has a
guard chain in code (`lifecycle-guards.ts`, a `Record<LifecycleAction,
LifecycleGuard[]>` — exhaustive at compile time): `epRequiredGuard` (accept),
`workflowTerminalGuard` (complete), `reasonRequiredGuard` (put-on-hold,
reopen), `managingPartnerOnlyGuard` (reopen). A `LifecycleGuard` is a one-
method interface (`check(context)`), so Phase 7 can add a `ReviewGuard`
without touching the orchestrator.

### 2. One orchestrator, ten steps, one transaction

`EngagementLifecycleService.transition()` runs the sequence in §21 of the
brief inside a single `db.withRlsContext` transaction: load via RLS → look up
the configured transition for the current status → resolve the destination
→ run guards → atomically `UPDATE … WHERE id = $1 AND status = $2 [AND
version = $3]` → write `engagement_lifecycle_history` → write the
`engagement.status_changed` audit event → commit. The `WHERE` always re-checks
`status`, not only the optional `version` — so a concurrent transition that
already moved the engagement is caught even for a caller who never supplied
one. Any failure anywhere in that sequence rolls the whole thing back; there
is never a mutation without its history/audit row or vice versa, by
construction of the transaction boundary (not a manufactured guarantee).

### 3. Two distinct journals, on purpose

`engagement_lifecycle_history` (new) records the engagement's *business
journey* — one row per successful lifecycle transition, with
`previous_version`/`resulting_version`. `audit_events` (existing, Phase 1)
records *what happened*, generically, across every domain. Both are written
in the same transaction as the mutation. Service-workflow transitions are
audited via `audit_events` only (`engagement.workflow_state_changed`) — they
are operational-progress events, not lifecycle journal entries, so they don't
share the lifecycle-history table's `from_status`/`to_status` columns (which
are scoped to the `engagements.status` domain).

### 4. `resume` has a dynamic destination

Every other transition's `to_status` is fixed in config. `resume` is not: an
`on_hold` engagement must return to whatever operational status it held
before the hold (§11 — "do not simply assume every hold resumes to ACTIVE").
`engagement_lifecycle_transitions` represents this with `to_status = NULL`
(allowed only for `action = 'resume'`, enforced by a CHECK), and
`engagements` carries `on_hold_previous_status`/`on_hold_reason`/
`on_hold_at`/`on_hold_expected_resume_date`, set on `put_on_hold` and cleared
on `resume`. A CHECK (`engagements_on_hold_requires_previous`) makes it
impossible for a row to sit in `on_hold` without a recorded previous status.

### 5. `reopen` is Managing-Partner-only, structurally reinforced

The existing `engagements_update` RLS policy (USING `is_engagement_lead`)
would let the EP or manager through on their own engagement — appropriate for
ordinary transitions, wrong for reopening a closed engagement. `reopen`
therefore carries an explicit application-layer guard
(`managingPartnerOnlyGuard`, checking `ctx.role === 'managing_partner'`) on
top of the RLS floor — a deliberate ceiling, not a replacement for RLS. The
platform admin is excluded by construction: it isn't business-firm-wide
(ADR-0009) and lost `engagement.manage` in migration 0009, so it's blocked at
both the permission layer and the guard layer.

### 6. The service-workflow instance (§16-19 — foundation only)

`engagements` gains `current_workflow_state_id` (FK to the existing
`workflow_states`, nullable — `NULL` until the workflow starts). A new
migration-managed table, `hsdg.workflow_transitions`, holds one generic
`advance` edge between each consecutive pair of states in a family's own
`sequence` (seeded by a single self-join over `workflow_states`, so no
family needed hard-coding). `start` (accepted → active) initialises
`current_workflow_state_id` from the service's workflow family's `is_initial`
state — looked up from `hsdg.services.workflow_family_id`, never hard-coded
("audit starts at Planning" does not appear anywhere in application code). A
service with a family that has no initial state fails the `start` transition
with a clear 400, per §18.

Workflow transitions run through a **separate** service
(`EngagementWorkflowService.advance`) and a separate endpoint
(`POST /engagements/:id/workflow-transitions`), gated by the same RLS floor
and `engagement.manage` permission as lifecycle actions, plus one operational
guard: the engagement must be `active`. This is the Phase 6 scope decision —
workflow progress is only tracked while the engagement is actively being
worked, matching every lifecycle/workflow pairing example in the brief
(ACTIVE+MANAGER_REVIEW, ACTIVE+EP_SIGN_OFF, …). Putting the engagement on
hold freezes the workflow state in place; it is untouched by `put_on_hold`/
`resume` (proven in tests).

`complete` (active → completed) requires `current_workflow_state.isTerminal`
— a deliberately shallow "did the operational workflow finish" check, not a
review/sign-off decision. This is the extension point Phase 7 plugs a real
`ReviewGuard` into; Phase 6 does not implement review sampling, key-matter
review, or EP sign-off.

### 7. Audit-workflow reconciliation (checkpoint finding, §20)

The Phase 4 seed had one generic `review` state in `audit_workflow`
(planning → fieldwork → review → ep_sign_off → completed). The brief's target
conceptual model is planning → fieldwork → **manager_review** →
**ep_review** → ep_sign_off → completed. Migration 0011 performs this split
as a two-step renumber (push `ep_sign_off`/`completed` out of the sequence
range, rename `review`→`manager_review`, insert `ep_review`, land the tail
states back at 5/6). No engagement referenced a specific `workflow_state` row
before this migration (`current_workflow_state_id` is new), so the rename is
safe — nothing to migrate forward.

This is a decision made under §32 ("if a design decision is ambiguous,
report and recommend") with a concrete target given in the brief itself, not
a genuinely open question — implemented as specified and flagged here for
visibility rather than paused on. Whether a given audit actually requires
personal EP review remains a Phase 7 (review model) decision (§8: "EP
accountability ≠ EP review"); the workflow engine does not hard-code it —
`INT_AUDIT` (key_matter_review) walks the identical six `audit_workflow`
states as `STAT_AUDIT`/`TAX_AUDIT` (full_ep_review).

### 8. A migration-writing pitfall worth recording

`workflow_states`/`workflow_families` run `FORCE ROW LEVEL SECURITY` (Phase
4). A migration runs as `hsdg_migrator` with **no** `hsdg.role` context set —
so under `FORCE`, reads/writes against those tables from *this* migration
would silently touch zero rows (not an error) unless FORCE is dropped first.
The very first version of this migration hit exactly this: the audit-workflow
reconciliation and the `workflow_transitions` seed both silently no-op'd,
caught only by inspecting the seeded data directly rather than trusting
"Migrations complete!" (which doesn't distinguish 0 rows affected from N).
Fixed by reusing the existing `NO FORCE … (work) … FORCE` pattern from
migration 0009 — bracket the reconciliation/seed statements, restore FORCE
immediately after. Verified with a full down→up round-trip, and separately
against a from-empty database (throwaway container, migrations + seed, torn
down afterward — the working dev database was never touched for this check).

## Consequences

- Lifecycle state can no longer be set arbitrarily — `status` was removed
  from `UpdateEngagementDto` entirely; `forbidNonWhitelisted` rejects it at
  the validation layer (proven by test), not merely a documented convention.
- Every transition is atomic, versioned, and leaves both an audit event and a
  lifecycle-history row, or leaves nothing — never a partial record.
- The service-workflow instance is independently queryable and independently
  mutable from the lifecycle status, proven directly (an engagement holds at
  `ACTIVE`/`fieldwork`, moves to `ON_HOLD`/`fieldwork` — workflow state
  unchanged by the hold).
- Reopening a closed/completed engagement is Managing-Partner-only, defended
  at both the RLS floor and an explicit application guard.
- Phase 7 has a concrete, narrow extension point (`LifecycleGuard`, the
  `workflowTerminalGuard` it will extend/replace on `complete`) rather than a
  hard-coded review requirement to unpick.

## Known limitations / deferred (not gold-plated)

- An engagement created directly at a status beyond `prospect` (the existing
  Phase 5 creation path, unchanged in Phase 6) does not retroactively get a
  lifecycle-history row for its initial status — history begins at the first
  Phase 6 transition. `engagement.created` in `audit_events` already captures
  the initial state; duplicating it into the history table was judged
  unnecessary (§14: "do not duplicate unnecessary information").
- `put_on_hold` is reachable only from `active` (not from `accepted`) — the
  only state the brief's examples and tests treat as "operational" prior to
  completion. Broader hold sources are a one-row config addition if the firm
  needs them; no code change.
- `hsdg.workflow_transitions` has no dedicated read endpoint (unlike
  `workflow_states`) — Phase 6 doesn't need one; the engine reads it directly.
  Add one if/when the frontend needs to render legal workflow moves ahead of
  attempting them.
- `POST /engagements` (unchanged from Phase 5) still accepts an arbitrary
  initial `status`, bypassing the transition engine entirely — that escape
  hatch predates Phase 6 and existing tests depend on it (e.g. creating
  directly at `accepted`). An engagement created directly at `active` this way
  has no `current_workflow_state_id` and no path back to `start` (only legal
  from `accepted`) to acquire one — `complete` would then permanently fail
  `workflowTerminalGuard`. Every Phase 6 test drives engagements through the
  transition endpoints, so this doesn't surface today; tightening `POST
  /engagements` to only ever create at `prospect` (or adding a way to
  initialise workflow state independently of `start`) is a decision for
  HSDG, not made unilaterally here.

## Follow-ups for Phase 7

- Add a `ReviewGuard` implementing `LifecycleGuard`, wired onto `complete`
  (replacing/extending `workflowTerminalGuard`) and onto `ep_review`/
  `ep_sign_off` workflow-transition actions, per each service's
  `required_review_model_id` rank.
- Decide whether `reopen` should reset `current_workflow_state_id` (currently
  untouched — an engagement reopened from `completed` keeps its workflow at
  the terminal state until Phase 7 defines what reopening implies for
  in-flight review).
