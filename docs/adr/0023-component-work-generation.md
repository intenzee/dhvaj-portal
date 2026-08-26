# ADR-0023 — Component Work Generation

- **Status:** Accepted
- **Date:** 2026-08-25
- **Phase:** Service Configuration spec — recurring work (§21–§22, §36)

## Context

ADR-0022 added the Component layer (catalogue + per-engagement configuration).
A configured component was still inert — it recorded scope but produced no work.
The specification's operational payoff (§21–§22) is that a **recurring component
generates period-specific work within a horizon, extends automatically as time
advances, and never duplicates**. This ADR adds that engine as
`component_instances` (§36).

## Decisions

### 1. The FY bounds the horizon — no infinite generation

An engagement is scoped to **one financial year**, so the period set is
naturally bounded: 12 months / 4 quarters / 2 halves / 1 year. There is no
open-ended future to guard against. Multi-year recurrence is modelled as a
**successor engagement per FY** (the existing `predecessor_engagement_id`
chain), each generating its own year's instances. Period enumeration
(`enumeratePeriods`) is a pure, unit-tested function over `(frequency, FY)`;
`as_required` is ad-hoc (§29) and yields no periods.

### 2. Generation RECONCILES to the configuration (not merely add)

`component_instances` carries `UNIQUE (engagement_component_id, period_key)`, so
duplicates are impossible. Generation reconciles the live work to the current
configuration's **target set** = `enumeratePeriods(frequency) ∩ active window`:

- an in-window period that does not exist is **created**;
- an in-window period that was previously **cancelled** is **revived**;
- a **scheduled/active** instance no longer in the target set (window narrowed,
  or frequency changed) is **cancelled** (reported as `removed`);
- **completed/waived** work is never touched (filed work is history, §25).

So re-running fills newly-in-range periods *and* shrinks work when scope
narrows — the button reads as "sync", and the result carries `generated`,
`removed`, and `skipped`. A future Container Apps Job can call the same endpoint.

### 2b. Manual control: the active window (§13/§24)

The configuration's `start_date`/`end_date` are the **active window** — "I look
after this client Apr–Sep" generates only the overlapping periods. Combined with
`frequency`, `applicability_status` (`not_applicable` suppresses generation) and
`status` (`cancelled`/`superseded` stop it), the lead has full manual control;
every one of these is reconciled on the next generate. Removing a component (or
editing it to a non-live/not-applicable state) also cancels its pending
instances immediately, so removed scope leaves no orphan work.

### 3. Each instance snapshots the rule version used

Where a component links a compliance rule, each period's deadline is computed
from the rule version **effective as of that period's end**, and the instance
stores `compliance_rule_version_id`. This mirrors `compliance_instances`: a
later rule change never rewrites an existing instance (§25). The pure
`compliance-calc` engine is reused (no duplicated date logic, no hard-coded
statutory dates). Deadlines are nullable — a component need not be a statutory
obligation; `event_date` bases have no deadline at generation (no event yet).

### 4. Scheduled vs current is derived, not stored

`is_future` (`period_start > CURRENT_DATE`) and `is_overdue` (open + past the
statutory deadline) are computed in the read query, so the portal can visually
separate scheduled/future work from current work (§22) without a nightly job to
flip stored flags.

### 5. Same security posture as the rest of the engagement

`component_instances` is engagement-scoped: members read, leads write (the
`is_engagement_member` / `is_engagement_lead` helpers), `DELETE` revoked from
`hsdg_app` (completed/filed work is soft-cancelled, never hard-deleted, §25).
Generation and status changes need `engagement.manage`; listing needs
`engagement.read`. No new permission.

## Consequences

- The engagement workspace gains a **Component work** panel: a bulk "Generate
  work" action and per-instance completion, with future/overdue styling; the
  **Scope & components** panel's edit modal exposes the active window and the
  manual controls. Cancelled work is hidden from the operational view.
- A configured recurring component now drives real, dated, auditable work, and
  the lead can bound and reshape it (window, frequency, applicability, removal).
- 7 e2e tests (12-month idempotent generation, deadline snapshot, completion,
  bulk generate, **window narrow-removes / widen-revives**, **remove cancels
  pending work but preserves completed**, role/RLS negatives) + 7 unit tests for
  period enumeration.
- **Follow-ups:** a scheduled Container Apps Job to call `generate` as periods
  come into range (the endpoint is already idempotent); linking a component
  instance to its workflow/checklist/PBC structures; and reconciling with the
  rule-centric `compliance_instances` so a component that *is* a statutory
  obligation surfaces in one place.

## Also in this change (optimisations)

Alongside the engine, the ADR-0022 services were tightened: the two list methods
collapsed to a single `count(*) OVER()` query; the component-config update gained
a SQL-level optimistic-lock guard (closing a read-then-write race); and Component
Discovery's per-row deadline preview was batched into one query. A `search`
filter was added to the compliance-rule list (find a rule by code/name) — a
product improvement that also makes a pollution-sensitive test deterministic.
