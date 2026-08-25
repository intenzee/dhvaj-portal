# ADR-0022 — Service Components & Component Configuration

- **Status:** Accepted
- **Date:** 2026-08-25
- **Phase:** Service Configuration spec — Component layer

## Context

The "HSDG Portal — Service Configuration & Engagement Creation" specification
defines a layer the codebase did not have: a **Component** — a specific
scope/obligation available under a Service — and its per-client **Component
Configuration** (spec §11–§13, §16, §24, §35–§36). The engagement model to date
is *one engagement = one service* (`entity + service + FY + period`), with
`compliance_instances` handling recurring statutory obligations. There was no
concept of selectable components under a service, no applicability/discovery
step, and no per-engagement component configuration.

The spec's fuller target (an engagement spanning **multiple** service lines and
services, group/entity scope, engagement-type taxonomy, and a recurring-horizon
generator) is a larger re-architecture. This ADR covers the **foundational,
additive** slice — the Component layer itself — which delivers the spec's central
missing capability without disturbing the ~600 existing engagements, the RLS
model, or the test suite.

## Decisions

### 1. Two objects, mirroring the compliance engine's config/instance split

- **`service_components`** — the firm-wide component **catalogue**. Columns:
  `service_id`, `code`, `default_applicability` (`mandatory` / `recommended` /
  `optional`), `default_frequency` (the existing recurrence enum), an optional
  `compliance_rule_id`, `display_order`, `is_active`, `version`. Firm-wide config,
  exactly like `services`: any authenticated context reads (`ctx_role()` not
  null); only firm-wide writes (`ctx_is_firmwide()`), gated at the API by
  `service.manage`. Seeded with a realistic set aligned to the spec examples
  (GSTR-1/3B/ITC-recon, tax-audit stages, book-closure, ROC/ITR filings).

- **`engagement_components`** — the per-engagement **configuration**. Columns:
  `applicability_status` (the §11 output categories: `mandatory` / `applicable` /
  `optional` / `pending_review` / `not_applicable`), `frequency`, `owner`/
  `reviewer`, `ep_review_required`, config `status`
  (`draft`/`active`/`on_hold`/`completed`/`cancelled`/`superseded`), dates,
  and `compliance_rule_version_id` (the version bound at activation, §19).
  Engagement-scoped: it reuses the `is_engagement_member` / `is_engagement_lead`
  SECURITY DEFINER helpers (members read, leads write) — the same floor as the
  review and compliance engines, so the platform admin never touches a client's
  component configuration.

### 2. Additive — it hangs off the engagement's existing single service

Components attach to the engagement's own `service_id`; discovery lists the
catalogue for that service. This fits the current model with zero migration of
existing rows and no change to any existing table, policy, or test. When the
multi-service engagement lands, `engagement_components` gains an
`engagement_service_id` and the model generalises without a rewrite.

A `BEFORE INSERT/UPDATE` trigger enforces that a configured component belongs to
the engagement's service (a plain trigger suffices — services and components are
firm-wide readable, so there is no cross-office visibility gap, mirroring
`enforce_engagement_workflow_state` in 0011).

### 3. Duplication prevention is a partial unique index (§16, §35)

`UNIQUE (engagement_id, service_component_id) WHERE status NOT IN
('cancelled','superseded')` — at most one **live** configuration per component
per engagement. Cancelled/superseded rows are excluded, so **removal is a
soft-cancel** (`status = 'cancelled'`, `DELETE` revoked from `hsdg_app`) that
stops future work and preserves history, and a removed component can be re-added
(§24/§25). A duplicate live insert surfaces as a clean `409`.

### 4. Component Discovery reuses the compliance-calc engine

`GET /engagements/:id/components/discovery` categorises the service's active
catalogue for the engagement, gives a reason per component, and — where a
compliance rule governs the component and the basis is determinable without a
per-instance date (`fy_end` / `fixed_date`) — previews the **statutory and
internal deadlines** by reusing the pure `computeDeadlines` / `resolveReferenceDate`
functions (no hard-coded dates; the version effective as of FY end is selected).
period/month/event bases surface the rule version but leave the dates unpreviewed
("preview where determinable", §12).

### 5. No new permissions

Catalogue reads/writes reuse `service.read` / `service.manage`; per-engagement
configuration reuses `engagement.read` / `engagement.manage` plus the engagement
RLS floor. Nothing new to grant — and the FORCE-RLS-during-seed toggle
(drop FORCE on `services`/`compliance_rules`, seed, restore) is the only
migration ceremony, matching migrations 0009/0013.

## Consequences

- The engagement workspace gains a **Scope & components** panel: a discovery
  drawer (categorised, deadline-previewed) and a configured-components table with
  add/remove, gated on `engagement.manage`.
- 7 new e2e tests (catalogue, discovery + deadline math, configure, duplication
  409, soft-remove/re-add, role + RLS negatives); full suite **232 e2e + 98
  unit** green.
- **Deliberate follow-ups (own phases):** multi-service engagements
  (`engagement_services`), engagement-type taxonomy (§3), group/entity scope
  (§6/§30), the recurring-horizon work generator (§21–§22), and driving
  compliance-instance generation directly from a configured component.
