# ADR-0032 — Record-event generation for event-triggered obligations

- **Status:** Accepted
- **Date:** 2026-08-29
- **Phase:** 13 — Due-Date Classification spec, closing the last UX gap

## Context

Part 1 (ADR-0030) bound the event-limitation rules (appeal/GST-amendment
limitations, PAS-3/BEN-2/MGT-14 allotments, INC-20A, FC-GPR) to their components.
Their deadline is a limitation period measured from an event date, so they use the
`event_date` calculation basis and cannot be computed until the event (order
served, shares allotted, …) is recorded.

The engagement's bulk **Generate** action calls `generate-for-service`, which
computes every rule on the service — and therefore *skips* the event rules (no date
to compute from). Until now the only way to create one was a raw API call with an
`eventDate`. So these obligations were classified and computable, but not reachable
from the UI — the one remaining gap in the spec.

## Decision

Add a purpose-built discovery endpoint and a web flow:

- `GET /engagements/:id/compliance/event-rules` returns the active rules on the
  engagement's service whose **in-force version** uses the `event_date` basis, with
  the offset (limitation period) for display. It mirrors `generate-for-service`'s
  service scoping and is RLS-scoped to what the caller can read. Filtering on the
  calculation **basis** (not the due-date category) is deliberate: it captures every
  rule that genuinely needs a date — e.g. `ITR_VERIFICATION_DUE` is categorised
  `STATUTORY_RULE` but is event-driven — and nothing that does not.
- The engagement Compliance tab gains a **Record event** button opening a modal:
  pick an event rule, enter the event date, and it posts to the existing
  `POST /engagements/:id/compliance { complianceRuleCode, eventDate }` — the same
  audited generation path, precedence and snapshotting as every other obligation.

No new generation logic: this only *surfaces* the event rules and reuses the
existing single-rule generate. The recurring **Generate** action is unchanged.

## Consequences

- Every classified obligation in the spec is now reachable from the UI; the
  event/manual path documented in ADR-0030 has a first-class entry point.
- Coverage: the classification e2e asserts the discovery lists the event rule with
  its offset and **excludes** recurring rules (an `ITR_FILING` engagement offers
  `ITR_VERIFICATION_DUE` but not `ITR_FILING_DUE`). Additive/read-side — no
  migration; existing suites stay green.
