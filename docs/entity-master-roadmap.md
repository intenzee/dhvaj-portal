# Add Client / Entity Master — Completion Roadmap

Source spec: *HSDG Portal — Add Client / Entity Master, Developer Specification
(Section 1, §1–§36)*. This roadmap completes the spec across **three phases**,
building on the existing Entity Master foundation (`entities`, `entity_types`,
`entity_registrations`, `entity_contacts`, `entity_groups`,
`engagement_entities`, registration write-back, statutory rules).

## Core principle (do not violate)

The Add Client / Entity page **captures facts; it does not decide statutory
applicability** (§1, §32, §35). Missing information is **never** Not Applicable.
A downstream, versioned Regulatory Applicability Engine consumes these facts.
Add Client only *displays* the engine's results (§20–§23) — it holds no
hard-coded statutory rules.

## Locked decisions

- **Client layer (ADR-0033):** introduce a `clients` table (commercial
  relationship) above `entities` and `entity_groups`, per §2/§31. A standalone
  entity may exist without a group; a client may span a group. Existing entities
  are backfilled to a client.
- **Delivery:** native repo conventions — one ADR + one migration per object,
  README status block per phase, §-referenced `feat` commits.
- **Non-negotiables:** progressive completion (create on minimum identity);
  year-wise financials immutable; historical registration records retained;
  every master-data change audited; entity status independent of regulatory
  profile status (§29).

---

## Phase A — Data Foundation: complete the facts schema

**Spec:** §2, §6–§19, §29, §31 · **ADR:** 0033 (client layer + schema completion)
**Exit gate:** every fact in the spec has a home; nothing is hard-coded in UI;
RLS + audit + `set_updated_at` on all new tables; Down migrations present.

- [ ] **ADR-0033** — client layer + Entity Master schema completion; backfill plan.
- [ ] **`clients`** table (commercial relationship, §2/§31); backfill existing
      entities → one client each; RLS office-scoped, fail-closed.
- [ ] **Extend `entities`** — trade/brand name, short name, country of
      incorporation (default India, not hard-coded), legal & constitution block
      (company/LLP/partnership/proprietorship conditional fields, §8); widen
      `status` enum to §6 (Under Incorporation, Dormant, Struck Off, Under
      Liquidation, CIRP/Insolvency, Closed, Other).
- [ ] **`entity_relationships`** — structured holding/subsidiary/WOS/associate/
      JV/step-down/fellow/ultimate/intermediate/other (§13), auditable,
      entity-specific.
- [ ] **`entity_addresses`** — registered/business/other, typed (§31).
- [ ] **`entity_financial_profiles`** — year-wise, **immutable per FY**
      (unique on entity+FY, never overwritten), all §16 threshold metrics +
      §17 source/verification fields.
- [ ] **`entity_business_activities`** — primary/secondary industry (controlled
      master), NIC code, activity boolean flags, regulated-activity (§18).
- [ ] **`entity_listings`** — listing status, exchange (multi), security type
      (multi), regulated sector, special status (§15).
- [ ] **`entity_regulatory_attributes`** — structured facts the engine reads
      (§19); facts only, never conclusions.
- [ ] **Extend `entity_registrations`** — add §10 fields (jurisdiction,
      registration_date, effective_from/to, issuing_authority, source,
      verified/verified_by/verified_date, principal/additional, document_ref);
      widen status to include `pending`/`expired`; add a separate `applicability`
      state (Under Assessment / Not Applicable / …) distinct from status (§12).
- [ ] **Extend `entity_contacts`** — department, contact_type, portal_user,
      portal_role (§24).
- [ ] **Status split (§29)** — `entity_status` (Draft/Active/Inactive/Archived)
      independent from `regulatory_profile_status`
      (Incomplete/Under Review/Complete/Needs Reassessment).
- [ ] **Reference masters** (optimization) — industries, NIC, registration
      types, relationship types as config tables so the wizard is data-driven,
      not hard-coded.
- [ ] Indexes for wizard query paths; RLS + audit + Down migrations on all.

---

## Phase B — API, Registration Lifecycle & Progressive Completion

**Spec:** §5, §10–§12, §22–§23, §28, §30, §33–§34
**Exit gate:** create-with-minimum-identity works; registration-obtained-later
(§34) passes end-to-end; every write audited; no overwrite of history.

- [ ] **CRUD modules/DTOs** for every Phase-A object (mirror the `entities`
      NestJS module), RLS-scoped, gated by `entity.read` / `entity.manage`.
- [ ] **Progressive-completion service** — allow create on minimum identity;
      never block on missing registrations; compute a server-side
      **Missing/Pending** list; soft validation where spec says "where available".
- [ ] **Registration onboarding workflow** (§11, §30) — three-record split
      (Work Item → Document → Master Data); wire existing write-back so an
      obtained registration **becomes master data**, marks Verified, and flags
      dependents **Needs Reassessment**.
- [ ] **Verification path** — verified/by/date set only via a reviewed, audited
      action.
- [ ] **Year-wise financial write path** — reject overwrite of an existing FY
      (append/version); require source + supporting-document link for verified
      figures (§16/§17).
- [ ] **Override scaffolding (§23)** — data + API only: calculated results never
      directly edited; override captures value/reason/evidence/user/date/approver
      and **retains the original engine result**. (Engine stays downstream, §32.)
- [ ] **Post-creation processing (§28)** — on create/registration-change:
      validate → refresh regulatory profile status → identify missing info →
      make entity available for engagements; never mark unassessed as Not
      Applicable.
- [ ] **Audit trail** — every master-data change auditable (§5); activity-history
      entries (§34), reusing the immutable audit pattern.
- [ ] **Atomic wizard submit** (optimization) — transactional multi-step create;
      shared `MissingInfo` + validation service reused by API and UI.
- [ ] **E2E acceptance scenarios** — progressive completion + registration
      obtained later (§34) as canonical tests.

---

## Phase C — 12-Step Wizard UI + Regulatory Profile surface

**Spec:** §3–§4, §6–§28, §33 · **UI:** Next.js `apps/web`
**Exit gate:** all 16 Developer Acceptance Criteria (§33) pass live.

- [ ] **Add Client entry point (§3)** — Individual/Proprietor · Legal Entity ·
      Group/Business Family; group ≠ legal entity (create group, then link
      entities).
- [ ] **12-step wizard (§4)** with a shared state machine + autosave draft
      (Entity Status = Draft) so progressive completion works mid-flow.
- [ ] **Conditional fields** driven by client/entity type (§6–§8), rendered from
      the Phase-A reference masters.
- [ ] **Steps 3–4** — registrations as separate master records (multiple
      GSTINs); ownership & relationship builder (§9–§14).
- [ ] **Steps 5–8** — listing/regulatory status, year-wise financial grid,
      business profile, accounting/reporting profile (system-derived inputs
      read-only) (§15–§19).
- [ ] **Step 9 — Regulatory Profile (read-only, §20–§22)** — all §20 results
      with states (§21) and **View Basis** explainability (§22: rule code/name/
      law/section/version, inputs, thresholds, exceptions, conclusion,
      timestamps, override history). Consumes the engine; **no statutory logic in
      the UI** (§32, §35).
- [ ] **Override UI (§23)** — professional override with mandatory reason/
      evidence; shows original engine result.
- [ ] **Steps 10–11** — contacts (+ portal user/role); Documents library
      (§25/§26) with **reuse-not-duplicate** across engagements; permanent vs
      current classification.
- [ ] **Step 12 — Review & Create (§27)** — completeness checklist + prominent
      **Missing Information** panel; creation permitted on minimum identity even
      with pending data.
- [ ] **Missing/Pending surface everywhere (§5)** — visually distinct from Not
      Applicable.
- [ ] **§33 acceptance gate** — verify all 16 Developer Acceptance Criteria.

---

## Non-goals (§35) — do not build here

- No detailed statutory applicability rules inside Add Client UI.
- No audit workflows or recurring compliance created from Add Client.
- No duplicating master documents into every engagement.
- No silent overwrite of historical financial or registration data.
- Never assume a missing registration means Not Applicable.
