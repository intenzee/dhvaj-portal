# Compliance rules & calendar — verification guide (§25)

How to verify the compliance engine end to end: the seeded rules, the two clocks,
the §16 event fan-out, the §22 calendar views, and the §24 escalation ladder.
Everything here is data-driven — rules are versioned config, not code — so the
authoritative list is always the database, and the queries below print it.

## 1. The seeded rule set

Rules live in `hsdg.compliance_rules` with effective-dated calculation snapshots
in `hsdg.compliance_rule_versions`, and are bound to catalogue components via
`hsdg.service_components.compliance_rule_id`. To list every bound rule with its
calculation and its component (the source of truth):

```sql
SELECT cr.code, cr.due_date_category, cr.due_date_source,
       crv.calculation_basis, crv.offset_months, crv.offset_days,
       crv.working_day_adjustment, crv.internal_sla_offset_days,
       string_agg(sc.code, ', ' ORDER BY sc.code) AS components
FROM hsdg.compliance_rules cr
JOIN hsdg.compliance_rule_versions crv
  ON crv.compliance_rule_id = cr.id AND crv.version = 1
LEFT JOIN hsdg.service_components sc ON sc.compliance_rule_id = cr.id
WHERE cr.is_active
GROUP BY cr.code, cr.due_date_category, cr.due_date_source, crv.calculation_basis,
         crv.offset_months, crv.offset_days, crv.working_day_adjustment,
         crv.internal_sla_offset_days
ORDER BY cr.code;
```

The set spans four generation families (§4 calculation basis):

| Family | Basis | Examples |
| --- | --- | --- |
| Fixed-day recurring | `period_end` + days | GSTR1/3B, TDS/TCS payment, PF/ESI, PT |
| Rule / return | `fy_end` + months | ITR, tax audit (44AB), AOC-4, MGT-7, GSTR-9/9C |
| Fixed calendar date | `fixed_date` | Advance-tax instalments |
| **Event limitation** | `event_date` ± days | appeals, allotments, incorporation, FDI, amendments |

The event-limitation rules are the Part-1 additions (migration `0038`,
[ADR-0030](adr/0030-statutory-rule-coverage-completion.md)):

| Rule | Component | Limitation |
| --- | --- | --- |
| IT_APPEAL_LIMITATION | TXP_LIMITATION | order + 30 d |
| GST_APPEAL_LIMITATION | GAP_LIMITATION | order + 90 d |
| ITR_VERIFICATION_DUE | ITR_VERIFY | filing + 30 d |
| PAS3_ALLOTMENT | ROCE_SHARE | allotment + 30 d |
| BEN2_DECLARATION | ROCE_BEN | declaration + 30 d |
| ROC_EVENT_FILING | ROCE_FILING | resolution + 30 d |
| INC20A_COMMENCEMENT | INC_INITIAL | incorporation + 180 d |
| FCGPR_REPORTING | FEMA_FDI | allotment + 30 d |
| GST_AMENDMENT_LIMITATION | GSTR_AMEND | change + 15 d |
| BOARD_MEETING_QUARTERLY | GOV_MEETINGS | quarterly (period) |

## 2. Sign in

Web `http://localhost:3000/login` → **Managing Partner** (dev-token; non-prod).
For the API, mint a token and authorise Swagger (`http://localhost:3001/api/docs`):

```bash
curl -s -X POST http://localhost:3001/api/v1/auth/dev-token \
  -H 'Content-Type: application/json' -d '{"email":"mp@dhvaj.in"}'
```

## 3. Part 1 — event-based statutory rules

- `GET /service-components/TXP_LIMITATION` → `complianceRuleCode` is
  `IT_APPEAL_LIMITATION`, `dueDateCategory` is `STATUTORY_EVENT`.
- On an accepted **TAX_APPEAL** engagement,
  `POST /engagements/{id}/compliance { "complianceRuleCode": "IT_APPEAL_LIMITATION",
  "eventDate": "2026-06-15" }` → `statutoryDeadline: "2026-07-15"` (order + 30 d),
  a distinct `internalSlaDate`, `isExtended: false`.
- In the web app this is the **Record event** button on the engagement's
  Compliance tab: it lists the service's event rules
  (`GET /engagements/{id}/compliance/event-rules`) and generates the chosen one
  from the recorded date — the recurring **Generate** action still skips these.
- Recurring generation (roll horizon on a GST/TDS engagement) still produces real
  statutory + internal-SLA dates — event rules never enter the recurring sweep.

## 4. Part 2 — calendar-engine completeness

**§16 event fan-out.** `GET /compliance/events` returns one row **per deadline**:
each obligation yields a `statutory` event, an `internal_sla` event, and one
`layer` event per deadline layer. Generating a statutory obligation auto-creates
the standard review layer(s) (`manager_review`, and `ep_review` when the service
requires full EP review), each surfaced as its own event.

**§22 views.** The same stream can be scoped:
- `GET /compliance/events?kind=internal_sla` — the **Internal-SLA view** (only the
  firm's own clock); `?kind=statutory` / `?kind=layer` likewise.
- `GET /compliance/events?serviceCode=ITR_FILING` — the **component/service view**.
- The firm-wide calendar `GET /compliance` also scopes by `serviceCode`,
  `partnerId` (partner portfolio) and `managerId` (team workload).

**§23 field completeness.** Every event carries `dueDateSource` (`LAW_RULE` on a
statutory event, `HSDG_POLICY` on an internal-SLA event), `ownerName` (the layer
owner), and `isExtended` (true on a statutory event under a §19 government
extension — its `dueDate` is then the revised operative date).

**§24 distinct escalation actions.** Every calendar row and event carries both
`escalation` (the band) and `escalationAction` (the distinct action that band
triggers). The bands and their actions:

| Band | Action | Reaches |
| --- | --- | --- |
| upcoming | monitor — no alert | — |
| due_soon | notify owner | Owner |
| due_today | alert owner + manager | Owner, Manager |
| overdue | escalate to partner | Manager, Engagement partner |
| critical | escalate to firm | Engagement partner, Firm (MP) |

Thresholds come from firm config (`NOTIFICATION_DEADLINE_LEAD_DAYS`,
`COMPLIANCE_CRITICAL_OVERDUE_DAYS`). Closed obligations are `none`.

## 5. Part 3 — Compliance Calendar UX

At `http://localhost:3000/compliance`:
- The **Obligations / Deadline events** toggle switches between the obligation
  table and the §16 event fan-out.
- In **Deadline events**, the clock selector (All / Statutory / Internal SLA /
  Milestones) drives the §22 `kind` filter.
- The **escalation ladder legend** (§24) shows each band's colour, its distinct
  action, and who it reaches — sourced from the shared `ESCALATION_LADDER` so the
  legend, the API classification, and the notifications never drift.

On an engagement's **Compliance** tab:
- **Generate** creates all recurring/computable obligations for the service (bulk).
- **Record event** creates an event-triggered obligation (appeal/allotment/
  incorporation/FDI/amendment) from a recorded event date — the piece bulk
  generation cannot compute.

## 6. Automated coverage

- Unit: `apps/api/src/modules/compliance/compliance-calc.spec.ts` (all §4 methods,
  incl. `EVENT_DATE ± days`), `escalation.spec.ts` (the §24 ladder).
- e2e: `apps/api/test/compliance-classification.e2e-spec.ts` (§2/§3/§4/§19 +
  event-rule bindings) and `compliance-escalation.e2e-spec.ts` (§22 views, §24
  bands + notifications, and the point-in-time picture: field completeness, the
  clock/service views, and `escalationAction` on every event and calendar row).
