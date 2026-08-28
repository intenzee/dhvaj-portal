# ADR-0028 — Workflow Families: full §19 named master

- **Status:** Accepted
- **Date:** 2026-08-29
- **Phase:** 13 (Administration) — catalogue-fidelity follow-on

## Context

The Service Catalogue Master §19 names **fifteen** workflow families so every
service carries a recognisable execution lifecycle (AUDIT, ASSURANCE,
RECURRING_COMPLIANCE, TAX_FILING, TAX_COMPLIANCE, ACCOUNTING, PAYROLL,
REGISTRATION, CORPORATE_COMPLIANCE, LITIGATION, ADVISORY, VALUATION, CFO,
GOVERNANCE, INVESTIGATION). The engine shipped with four generic families
(`audit` / `filing` / `advisory` / `litigation`) and mapped every service onto
them — functional, but coarser than the freeze, and the generic `filing_workflow`
is not one of the fifteen.

`services.workflow_family_id` is load-bearing: on `start`, an engagement's
initial workflow state is resolved from its service's family; workflow moves
follow that family's `workflow_transitions`; and a trigger
(`enforce_engagement_workflow_state`) requires an engagement's
`current_workflow_state_id` to belong to its service's family. So re-pointing a
service is not a pure catalogue edit — existing engagements must move with it.

## Decision

Migration `0036_workflow_families_master`:

1. **Adds the twelve missing families** with ordered states and the standard
   one-`advance`-edge-per-consecutive-state transitions (seeded generically from
   the state sequence, exactly as `0018` did — no per-family hard-coding).
2. **Re-points every service** to its §19 family (audit/advisory/litigation
   services that already matched are left alone).
3. **Remaps affected engagements**: any engagement whose `current_workflow_state_id`
   now belongs to a different family than its service is moved to the equivalent
   state in the new family, **matched by sequence position** and capped at the
   new family's last state. State sequences are contiguous `1..N` in every
   family, so a match always exists; progress is preserved by position rather
   than reset. This keeps the integrity trigger satisfied and never strands an
   engagement.
4. **Retires the legacy generic `filing_workflow`** (not one of the fifteen)
   once every service has been re-pointed off it — a guarded delete that no-ops
   if anything still references it (and the `ON DELETE RESTRICT` engagement FK is
   a second backstop). The down path recreates it before re-pointing services
   back.

RLS: the migrator holds no role context, so the re-point/remap (which reads
`services` + `workflow_states` via the trigger and writes `engagements`, all
FORCE-RLS) drops FORCE on every table touched and restores it after — mirroring
`0007`. Validated up → down → up.

### Why not version the workflow here?

§25 also calls for *effective-dated workflow versions*. That is a separate,
larger change to the execution engine (the lifecycle resolves states directly
from the family today) and is deliberately out of this migration's scope — it is
tracked as its own item alongside the checklist / PBC / document-requirement
template masters.

## Consequences

- Every service now advertises a §19-accurate workflow family; the calendar,
  engagement detail, and workflow-transition APIs surface the richer lifecycles
  with no code change (they read families/states dynamically).
- The sequence-matched remap can move a long-family engagement (e.g. a 6-state
  audit) onto a shorter family at a capped position; in a pre-launch system with
  no in-flight production engagements this is acceptable and is documented here
  as the chosen trade-off over resetting progress to the initial state.
- `filing_workflow` is gone; `GST_MONTHLY` and the other former filing services
  now walk their proper five-state chains. The one workflow-walking e2e
  (`engagements.e2e-spec`) was updated to the new initial state and chain length.
- **Not in scope (next):** effective-dated `workflow_versions`, and the reusable
  versioned `checklist_templates` / `pbc_templates` /
  `document_requirement_templates` masters (§18/§25/§27).
