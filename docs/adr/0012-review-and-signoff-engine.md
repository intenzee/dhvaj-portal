# ADR-0012 — Review & Sign-off Engine

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase:** 7 (Review & Sign-off Engine)

## Context

ADR-0011 named review state as concept **C**, deliberately kept out of both the
engagement lifecycle (governance) and the service workflow (how work is done),
and left `complete` gated only by a shallow `workflowTerminalGuard` as the
extension point for Phase 7. This phase builds the real engine.

The non-negotiable business rules it must encode (brief §2.1, §2.4, §7):

- Every accepted engagement has **one accountable EP**; EP accountability is not
  the same as EP review. Routine work (an ITR) can be reviewed **and completed
  at manager level** where the service permits; a statutory audit **cannot
  complete without EP sign-off**.
- The service declares a **minimum** required review model (Phase 4, ranked).
  The EP may choose a more rigorous model per engagement but the system must
  **never allow a weaker one** than the service requires.

## Decisions

### 1. Configuration says who must sign off; code enforces it

`review_models` gains one column, `requires_ep_signoff` (reference config):
`manager_review` → false, `key_matter_review` / `full_ep_review` → true. This is
**not** a hard-coded slug list in application code — adding a review model, or
changing whether one needs EP sign-off, is a data change. The completion rule
reads entirely from this column via the engagement's *effective* review model.

### 2. The review plan is an escalate-only column, enforced in the database

`engagements.review_model_id` (nullable) is the EP's chosen review model;
`NULL` inherits the service default. The **effective review model** is
`COALESCE(plan, service.required)`, computed in the shared engagement read
query so both the API and the completion guard see the same resolved value.

A `BEFORE INSERT/UPDATE` trigger (`enforce_engagement_review_plan`) rejects any
plan whose rank is **below** the service's required rank — §2.4 ("never allow a
lower review model where the service requires Full EP Review") enforced
structurally, in the database, consistent with the RLS-in-the-database posture.
It is a plain (non-`SECURITY DEFINER`) trigger, like
`enforce_engagement_workflow_state`: `services`/`review_models` are firm-wide
readable to any authenticated context, so there is no cross-office visibility
gap to bridge.

### 3. Reviews and sign-off are one journal; authority is layered on RLS

`engagement_reviews` records every review event — `manager_review`, `ep_review`,
and the terminal `sign_off` — with an `outcome` (`cleared`/`returned` for
reviews, `signed_off` for the sign-off, paired by a CHECK).
`engagement_review_points` holds matters raised in a review (with `is_key_matter`
for the key-matter concept), each `open` until resolved.

Both tables are **engagement-scoped**, like `engagement_lifecycle_history`:
`is_engagement_member` reads, `is_engagement_lead` writes (the `SECURITY DEFINER`
helpers from ADR-0008). The **finer professional authority** is layered in
`EngagementReviewsService`, exactly as `reopen` layers `managingPartnerOnlyGuard`
over the same RLS floor:

- An **EP review** may only be recorded by the *accountable* EP
  (`ctx.employeeId === engagement_partner_id`) — the RLS lead floor also admits
  the manager, so this is the ceiling on top of it.
- A **sign-off** on an EP-required model may only be performed by the accountable
  EP; a manager-review model admits any lead (→ manager-level completion). A
  manager signing off a statutory audit is a `403`, not merely a UI omission.

Reviews are professional evidence: `DELETE` is revoked from the app role
(§12 — never hard-delete). The only mutation is controlled invalidation
(supersede) and review-point resolution.

### 4. Completion is gated by sign-off state, not workflow slugs

`workflowTerminalGuard` is **replaced** by `reviewSignedOffGuard` on `complete`.
An engagement may complete only when it carries a current (non-superseded)
sign-off **and** zero open review points. The guard stays **pure**: it reads
`isSignedOff` / `openReviewPointCount` from the engagement read shape (computed
via a lateral over `engagement_reviews` + a partial-index count over open
points), never a workflow state name. *Who* was allowed to sign off was already
enforced at sign-off time, so by the time a non-superseded sign-off exists the
required authority (e.g. EP for an audit) has been met. The service workflow and
the review engine are thus fully decoupled — the review engine gates
completion for **every** service, including filing workflows that have no
`ep_sign_off` state.

A partial unique index (`… WHERE review_type='sign_off' AND superseded_at IS
NULL`) guarantees at most one active sign-off per engagement.

### 5. Reopening invalidates the sign-off (ADR-0011 §6 follow-up)

`reopen` (completed/closed → active, MP-only) now **supersedes** the active
sign-off in the same transaction as the lifecycle mutation. The completed work
is being reopened for change, so its certification no longer holds — a fresh
sign-off is required before the engagement can complete again (proven in tests).
`current_workflow_state_id` is deliberately left untouched (resetting the
workflow on reopen was judged out of scope; no code depends on it).

## Consequences

- Scenario 1 (ITR, `manager_review`): the manager records the review, signs off,
  and completes; the EP stays accountable (`engagementPartnerName` unchanged).
- Scenario 2 (Statutory Audit, `full_ep_review`): a manager is blocked at
  sign-off (`403`) and at completion (`400`); only the accountable EP can sign
  off and complete.
- The EP can escalate an ITR to `full_ep_review`; a manager can then no longer
  sign off it. Weakening below the service requirement is a `400` (DB trigger).
- Review points block sign-off until resolved; the engagement version bumps on
  every review write, so optimistic concurrency stays meaningful for the
  completion flow.
- Every review, sign-off, resolution, and plan change writes an `audit_events`
  row in the same transaction as the mutation.

## Known limitations / deferred (not gold-plated)

- **Reviews require the engagement to be `active`.** Recording a review or
  signing off is only allowed at `ACTIVE` (matching the workflow-advance floor).
  Resolving a point mid-`ON_HOLD` (e.g. waiting on a client) is a one-line
  status-set change if the firm needs it.
- **A sign-off does not require a preceding manager/EP review record.** The
  sign-off is itself the approving act; the manager/EP review records are the
  evidence trail and where review points originate. Requiring a specific review
  sequence before sign-off is a policy the firm can add as a guard later.
- **`key_matter_review` vs `full_ep_review` share the completion gate** (both
  `requires_ep_signoff`). The distinction lives in *what* the EP reviews
  (`is_key_matter` points), not in who signs off — both require the accountable
  EP.
- **Review-point resolution is lead-only.** In practice the preparer often
  fixes the item and the reviewer confirms; here the lead (reviewer) confirms
  resolution. Broadening to team members is an RLS-policy change, not a schema
  one.
- **`POST /engagements` can still create directly at `active`** (the Phase 5
  escape hatch, unchanged): such an engagement has no `current_workflow_state_id`
  but the review engine does not depend on workflow state, so it can still be
  reviewed, signed off, and completed.

## Follow-ups for Phase 8

- Compliance state (concept **D**) attaches as its own engine, not folded into
  lifecycle/workflow/review — same separation discipline.
- A `ComplianceGuard` implementing `LifecycleGuard` can join the `complete`
  chain if the firm wants statutory filing to gate completion alongside sign-off.
