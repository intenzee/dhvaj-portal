# ADR-0030 — Statutory-rule coverage for event-based obligations

- **Status:** Accepted
- **Date:** 2026-08-29
- **Phase:** 13 — Due-Date Classification spec, Part 1 (rule coverage & classification)

## Context

The Due-Date Classification spec drives the compliance calendar off **rules**,
not a generic date-and-repeat scheduler. Migrations 0035/0037 seeded the
recurring statutory rules (GST/TDS/ROC/labour/ITR/audit) and bound them to their
catalogue components. An audit of the catalogue found:

- Classification is **complete and accurate** — all 118 components carry a §2
  category and §3 source consistent with the spec's §6–§15 mapping (the existing
  e2e already pins ~20 archetypes; nothing needed correcting).
- The **calculation engine already supports all nine §4 methods**, including
  `event_date ± offset` (`offset_days` has no non-negative constraint, so
  EVENT_DATE_MINUS_DAYS works) — now covered by unit tests.
- But of 46 statutory components, only **22 had a rule bound**. The unbound ones
  were the **event-triggered** obligations (appeals, allotments, incorporation,
  resolutions, FDI, amendments) whose deadline is a limitation period measured
  from an event date — classified, but with no rule to compute the date.

## Decision

Migration `0038_statutory_rules_completion` seeds the well-established Indian
event-limitation rules (`event_date` basis + `offset_days`) and binds ten more
components, taking statutory coverage to **32/46**:

| Rule | Component | Limitation |
| --- | --- | --- |
| IT_APPEAL_LIMITATION | TXP_LIMITATION | order + 30d |
| GST_APPEAL_LIMITATION | GAP_LIMITATION | order + 90d (3 months) |
| ITR_VERIFICATION_DUE | ITR_VERIFY | filing + 30d |
| PAS3_ALLOTMENT | ROCE_SHARE | allotment + 30d |
| BEN2_DECLARATION | ROCE_BEN | declaration + 30d |
| ROC_EVENT_FILING | ROCE_FILING | resolution + 30d (MGT-14) |
| INC20A_COMMENCEMENT | INC_INITIAL | incorporation + 180d |
| FCGPR_REPORTING | FEMA_FDI | allotment + 30d |
| GST_AMENDMENT_LIMITATION | GSTR_AMEND | change + 15d (REG-14) |
| BOARD_MEETING_QUARTERLY | GOV_MEETINGS | quarterly (period-based) |

Offsets are the standard statutory periods and are **versioned config** (§25) —
the firm supersedes any with a new effective-dated version without touching
history.

### Deliberately left unbound (documented, not a gap)

No single fixed rule is correct for these, so they use the event/manual path
(the engine supports event-date generation and authorised overrides):

- **Notice/order response deadlines** (TXA_NOTICE/ORDER, GAS_NOTICE/ORDER) and
  **authority-scheduled hearings** (TXP_HEARING, GAP_HEARING) — the date is on
  the document or set by the authority, captured per matter. Their
  STATUTORY_EVENT + LAW_RULE classification is retained (the obligation is
  statutory; only the date is matter-specific).
- **Transaction/continuous** obligations with no periodic due date (GST
  e-invoice, per-remittance withholding) and **determination** milestones
  (tax-audit applicability, GST refund, treaty relief, restructuring, licence
  renewal/amendment).

## Consequences

- Every event-triggered statutory obligation the firm commonly handles now
  computes its deadline from the recorded event date. The recurring horizon
  sweep is unaffected: `computeForPeriod` already skips `event_date` bases
  (returns no deadline) and ad-hoc frequencies, so binding these rules creates no
  spurious dates and cannot throw.
- Calc-method coverage (incl. EVENT_DATE_MINUS_DAYS) is now unit-tested;
  component→rule bindings and event-date generation are e2e-tested. Migration
  validated up → down → up.
- **Next (Part 2/3):** the calendar-engine gaps (§16 standard deadline layers,
  §22 Internal-SLA/Component views, §23 field completeness, §24 distinct
  escalation actions) and the calendar UX, per the plan.
