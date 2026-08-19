# ADR-0013 — Compliance Engine

- **Status:** Accepted
- **Date:** 2026-08-19
- **Phase:** 8 (Compliance Engine)

## Context

Concept **D** from ADR-0011 (compliance state), kept separate from the
engagement lifecycle, the service workflow, and the review engine. The brief
(§10) is emphatic: **no hard-coded statutory dates.** Compliance rules must be
configurable, effective-dated, and versioned; every compliance instance must
record the rule version it was calculated with; and changing a *future* rule
must never rewrite historical calculations. Two clocks — the **statutory
deadline** and the firm's **internal SLA** — must remain distinct.

## Decisions

### 1. Rules are the identity; versions are effective-dated snapshots

`compliance_rules` holds the stable identity (code, name, optional service
link, category). `compliance_rule_versions` holds the effective-dated
calculation: `calculation_basis` (fy_end / period_end / month_end / fixed_date /
event_date), month/day offsets, `fixed_month`/`fixed_day`, `working_day_
adjustment`, `internal_sla_offset_days`, and a configurable `condition` jsonb.
"Changing a rule" means **adding a version** with a later `effective_from` — the
firm never edits an existing one. Versions are **append-only**: the migration
revokes `UPDATE`/`DELETE` on `compliance_rule_versions`, so a calculation an
instance already referenced can never be silently rewritten.

### 2. Instances snapshot the version + both computed dates, and are never recomputed

Generating an obligation selects the version **in force as of the obligation's
reference date** (`effective_from ≤ asOf`, respecting `effective_to`, greatest
`effective_from` wins), computes both clocks, and writes a
`compliance_instance` row carrying `compliance_rule_version_id`,
`reference_date`, `statutory_deadline`, and `internal_sla_date`. Nothing ever
recomputes an instance. This is what makes the acceptance test hold: add a
future version → every existing instance keeps its `complianceRuleVersion` and
its dates, proven directly through the API and at the DB layer.

### 3. The calculation engine is pure

`compliance-calc.ts` has no database or NestJS-state dependency: date parsing,
`addMonthsUTC` (end-of-month clamping), `resolveReferenceDate` (per-basis
interpretation), working-day adjustment over weekends + a holiday set,
`computeDeadlines` (both clocks), and `evaluateCondition`. All arithmetic is in
UTC so results are host-timezone-independent. 24 unit tests pin the mechanics
(FY_END+7mo ⇒ 31 Oct, period_end+20d, Saturday→Monday, holiday skip, SLA pulled
back to a working day, all/any/not conditions, missing-field errors).

### 4. Two clocks, always separate

The statutory deadline is `reference + offset`, working-day adjusted per the
rule. The internal SLA is `statutory − internal_sla_offset_days`, always pulled
back to the **previous** working day — so it lands on or before the statutory
date, never after. The read model exposes both, plus two derived flags:
`isStatutoryOverdue` and `isInternallyOverdue` (open + past the respective
effective date). This is the §11 "internally overdue vs statutory" distinction
at the data layer, ready for Phase 9's client-dependency work.

### 5. Overrides are additive and audited; the computed snapshot survives

An override sets `statutory_deadline_override` / `internal_sla_override`; the
effective date is `COALESCE(override, computed)`, so the **computed snapshot is
never lost**. Each override also appends a `compliance_instance_overrides` row
(clock, previous → new, reason, evidence reference, actor, timestamp,
correlation id) and writes an `audit_events` entry — the §10 requirement (new
date, actor, timestamp, reason, evidence, audit event). Reason is mandatory; the
override log is append-only (UPDATE/DELETE revoked).

### 6. Conditional applicability, evaluated with supplied context

A rule version may carry a `condition` jsonb (`{field, op, value}` with
`all`/`any`/`not` combinators). Generation evaluates it against `context`
supplied in the request. A **missing** referenced field is an error, never a
silent skip — a conditional rule must be given the data it needs.

### 7. Security: config is firm-wide, instances are engagement-scoped

Rules / versions / holidays are firm-wide administrative CONFIG, exactly like
the service catalogue: read by any authenticated role (`compliance.read`),
written only under `ctx_is_firmwide` RLS + the `compliance.manage` permission
(MP + platform admin). Per-engagement instances/overrides reuse the engagement
RLS helpers — `is_engagement_member` reads, `is_engagement_lead` writes — and
are gated by `engagement.read`/`engagement.manage`, **not** `compliance.manage`,
so the platform admin (which holds no engagement access, ADR-0009) can configure
statutory rules but can never touch a client's compliance data. Proven at the DB
layer: fail-closed with no context; a non-firm-wide role cannot write a rule; an
unassigned partner sees no instances; a cross-office team member does.

### 8. Extensions are effective-dated versions or instance overrides

The brief lists "extension" as a concept. Rather than a bespoke table, an
extension is expressed the same way as any rule change — a new effective-dated
version (a blanket statutory extension) or, for a single engagement, an
audited deadline override with the notification as its evidence reference. No
new machinery; the effective-dating and override mechanisms already cover it.

## Consequences

- Adding a future rule version leaves every existing instance byte-for-byte
  unchanged (headline acceptance), while new/future-period instances pick up
  the newer version by reference-date selection — both proven.
- Statutory vs internal-SLA overdue are independently queryable per instance.
- Overrides preserve the computed value, record full provenance, and audit.
- A new statutory rule, an amendment, or a holiday is a **data** change through
  the API — no source edit, no deploy.

## Known limitations / deferred (not gold-plated)

- **Single-rule generation.** `POST /engagements/:id/compliance` generates one
  obligation from an explicit rule + inputs. Bulk auto-generation of all
  applicable obligations for an engagement (deriving period reference dates from
  the service's recurrence) is a clean follow-up — the engine and selection
  logic it needs already exist.
- **Reference-date derivation.** `fy_end` and `fixed_date` derive their date
  from the engagement's financial year; `period_end` / `month_end` / `event_date`
  require an explicit date in the request (the engagement's free-text
  `period_label` is not parsed). A structured period model is future work.
- **Condition context is caller-supplied.** There is no automatic wiring of
  entity turnover/registration facts into the condition context yet — the caller
  passes what a conditional rule needs. Wiring entity master data in is additive.
- **Instances can be generated at any lifecycle status.** Compliance obligations
  are informational and may be planned early; no lifecycle gate is imposed on
  generation (only the engagement-lead RLS floor).

## Follow-ups for Phase 9

- Tasks & client dependencies (`WAITING_FOR_CLIENT`) build on the two-clock
  model here — an internally-overdue obligation that is waiting on the client is
  the exact §11 distinction, now representable.
