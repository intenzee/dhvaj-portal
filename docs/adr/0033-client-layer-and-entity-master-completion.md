# ADR-0033 — Client Layer & Entity Master Schema Completion

- **Status:** Accepted
- **Date:** 2026-08-31
- **Phase:** Add Client / Entity Master — Phase A (data foundation)
- **Spec:** *HSDG Portal — Add Client / Entity Master, Developer Specification*
  (§1–§36); roadmap in [entity-master-roadmap.md](../entity-master-roadmap.md).

## Context

The Entity Master (ADR-0006) already stores `entities`, `entity_types`,
`entity_registrations`, `entity_contacts`, plus `entity_groups` /
`engagement_entities` (ADR from the group/multi-entity work). The Add Client
spec formalises a **12-step factual master** that is materially wider than
today's schema: a separate commercial-client layer (§2), year-wise immutable
financials (§16), structured ownership relationships (§13), addresses, listings,
business activities and regulatory attributes (§15/§18/§19), and a much richer
registration lifecycle (§10–§12).

The **core principle** (§1, §32, §35): this master **captures facts only**. It
must never decide statutory applicability, and **missing information is never
Not Applicable**. A downstream versioned Regulatory Applicability Engine
consumes these facts; Add Client only displays engine results (§20–§23).

## Decision

Phase A adds the factual schema. No applicability logic, no API, no UI — those
are Phases B and C. Every table is office-scoped, fail-closed RLS, mirroring
`entities`; audit stays at the service layer (Phase B), as elsewhere in this
codebase.

### 1. Client layer (§2, §31)

Introduce `hsdg.clients` — the **commercial relationship** HSDG maintains —
above `entities` and `entity_groups`. `entities.client_id` is a **nullable**
FK (progressive completion: an entity can be created before its client record is
finalised, §5). Every existing entity is backfilled to one client. `clients`
reuses the `entity.read` / `entity.manage` permissions (a person who manages
client entities manages the client relationship) — no new permission sprawl.

A standalone entity may exist without a group; a client may span a group (§2).

### 2. Non-destructive status model (§29)

The spec has **two independent status axes** (§29) plus a legal/operational
status (§6). We keep the existing `entities.status` as the **entity lifecycle**
axis and only add `draft` to it (the spec's Draft/Active/Inactive/Archived);
`prospect` is retained for backward compatibility. We add two new columns rather
than overloading the existing one:

- `legal_status` — §6 operational status (Active, Under Incorporation, Dormant,
  Struck Off, Under Liquidation, CIRP/Insolvency, Closed, Other).
- `regulatory_profile_status` — §29 (Incomplete / Under Review / Complete /
  Needs Reassessment), independent of the lifecycle status.

This avoids rewriting the entities RLS/logic that keys off `status`.

### 3. Reference masters as config, everything else as widened CHECK enums

Only the genuinely large, extensible vocabularies become config tables:
`industries` and `nic_codes` (§18, controlled masters, FK-referenced).
Small, stable vocabularies (registration types, relationship types, address
types, listing/security types, result states) stay as **CHECK enums**, matching
the existing `entity_registrations`/`entity_types` convention. Config tables are
migration-managed: `REVOKE INSERT/UPDATE/DELETE` from `hsdg_app`, seeded here.

### 4. New factual child tables (all 0..n, office-scoped via parent entity)

- `entity_addresses` — registered / business / branch / other (§31).
- `entity_relationships` — structured holding/subsidiary/WOS/associate/JV/
  step-down/fellow/ultimate/intermediate/other, with optional shareholding %
  and effective dating; self-relationship guard (§13).
- `entity_financial_profiles` — **year-wise, append-only** (§16). One *current*
  row per (entity, FY) via a partial unique index `WHERE is_current`; a new
  figure set supersedes the prior via `supersedes_id` and never overwrites it
  (mirrors the catalogue component-supersede pattern). Carries §17 source +
  verification fields.
- `entity_business_activities` — industry/NIC classification rows, one primary
  (§18). The singular yes/no activity flags + `business_description` +
  `primary_industry_id` live on `entities`.
- `entity_listings` — per exchange/security listing lines with dates/status
  (§15). Entity-level `listing_status` lives on `entities`.
- `entity_regulatory_attributes` — an **extensible, coded fact store**
  (`attribute_code` + typed value + source/effective) the engine reads (§19):
  regulated sectors, special regulatory status, and any future structured
  fact — without schema churn. Facts only; never conclusions.

### 5. Registration & contact master completion (§10–§12, §24)

Extend `entity_registrations` with the §10 fields (jurisdiction, registration/
effective dates, issuing authority, source, verified/by/date, principal-vs-
additional, document reference) and widen `status` to include `pending` /
`expired`. Add a **separate** `applicability` column
(under_assessment / applicable / not_applicable / unknown) so
"pending application" (a *status*) is never confused with "not required" (an
*applicability*), per §12. Historical rows are retained on cancel/expire.

Extend `entity_contacts` with `department`, `contact_type`, `is_portal_user`,
`portal_role` (§24).

## Consequences

- The master can hold every fact in the spec without overwriting history; the
  immutability and missing≠NA guarantees are enforceable in Phase B on top of
  this schema.
- `entities` gains a controlled set of singular scalar columns; multi-valued
  facts are in child tables — no EAV except the deliberately-extensible
  `entity_regulatory_attributes`.
- `annual_turnover` on `entities` (a pre-existing cached scalar) is retained as
  a convenience; `entity_financial_profiles` is the authoritative year-wise
  source and Phase B refreshes the cache from the current FY row.
- No engine, no applicability rules, no UI here — Phase A is deliberately inert
  factual storage (§32, §35).

## Alternatives considered

- **Keep entity as the client anchor** (no `clients` table): rejected — diverges
  from the §2/§31 object model and blocks a true one-client-many-entities
  relationship.
- **Overload `entities.status`** for all three status axes: rejected — would
  rewrite existing RLS/logic and conflate independent concerns (§29).
- **Full EAV for all facts**: rejected — loses type-safety and queryability;
  used only for the intentionally open-ended regulatory attribute store.
