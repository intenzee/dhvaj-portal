# ADR-0031 — Calendar-engine completeness (event views, field model, escalation actions)

- **Status:** Accepted
- **Date:** 2026-08-29
- **Phase:** 13 — Due-Date Classification spec, Parts 2 & 3

## Context

Part 1 (ADR-0030) closed the rule-coverage gap. Parts 2 and 3 of the Due-Date
Classification spec finish the calendar engine and its UX. An audit of the Phase-8
compliance engine found the hard parts already built — the two clocks, the §16
event fan-out (`/compliance/events`), the §16 auto-materialised review layers on
generation, the §22 firm-wide calendar with service/partner/manager views, and
the §24 escalation band on every row. The remaining gaps were completeness and
surfacing, not new machinery:

- **§22** — the event stream (the "picture in time") could not be scoped by
  **clock** (an Internal-SLA-only view) or by **service** the way the obligation
  calendar could.
- **§23** — calendar **events** were missing fields the obligation rows already
  carried: the due-date **source**, the layer **owner**, and the **extended**
  flag — so the event model was not field-complete.
- **§24** — the escalation **band** was derived, but the **distinct action** each
  band takes (who is told, what happens) lived only implicitly in the notification
  engine. There was no single shared source the calendar legend, the API, and the
  notifications agreed on.
- **Part 3** — the web Compliance Calendar showed only the statutory obligation
  table: no event fan-out, no clock/service views, and no escalation legend.

## Decision

**§22 event views.** `/compliance/events` gains a `kind`
(`statutory` | `internal_sla` | `layer`) and a `serviceCode` filter over the same
RLS-scoped stream — the Internal-SLA view and the component view, alongside the
statutory one.

**§23 field completeness.** Each event now carries `dueDateSource` (`LAW_RULE` on
a statutory event, `HSDG_POLICY` on an internal-SLA event, null on a layer),
`ownerName` (the layer owner), and `isExtended` (true on a statutory event under a
§19 overlay, whose `dueDate` is then the revised operative date).

**§24 distinct escalation actions.** A single shared descriptor
(`escalationAction(level)` + `ESCALATION_LADDER` in `@hsdg/contracts`) maps each
band to a distinct action and accountability tier — monitor → notify owner →
alert manager → escalate to partner → escalate to firm. Every calendar row and
event exposes `escalationAction` derived from this one source, so the API, the
legend, and the notification recipients cannot drift.

**Part 3 UX.** The `/compliance` page gains an Obligations / Deadline-events
toggle, a clock selector wired to the §22 `kind` filter, and an escalation-ladder
legend rendered from the shared `ESCALATION_LADDER`.

### Deliberately not built

A standalone "seed standard layers" endpoint. §16 standard review layers are
already auto-materialised inside the generation transaction (`autoGenerateLayers`,
config-driven, one source of truth). A parallel manual seeder would duplicate that
logic and risk two behaviours diverging, so the existing mechanism stands.

## Consequences

- The calendar renders a complete point-in-time picture: every deadline as its own
  categorised, owned, escalation-classified event, filterable by clock and by
  service.
- Escalation policy is defined once and shared, so a change to who is notified at a
  band updates the API, the legend, and the notifications together.
- Coverage: `escalation.spec.ts` pins the §24 ladder; the point-in-time e2e
  (`compliance-escalation.e2e-spec.ts`) asserts field completeness, the clock and
  service views, and `escalationAction` on every event and calendar row. Existing
  suites stay green; no migration was required (all additive, read-side).
