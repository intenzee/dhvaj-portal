# DHVAJ Statutory Audit — Implementation Guide (Sections 01 & 02.1–02.8)

**Audience:** engineers implementing the Statutory Audit workflow in the HSDG Portal monorepo.
**Scope of this document:** the **web portal first**. Every rule, contract and engine
described here is written to be UI-agnostic so the React Native app can reuse it later
(see §14 *Mobile parity*). Build web, prove the logic, then wrap the same endpoints and
`@hsdg/contracts` types in the app.
**Source of truth:** the ten developer specifications —
Section 01 (Engagement & Acceptance) and Sections 02.1–02.8 (Audit Framework).
This guide translates them into an engineering blueprint that fits the **existing**
codebase; it does not restate the specs verbatim. Read a section's source spec alongside
its chapter here.

---

## 0. How to use this document

Each Section chapter follows the same shape so you can implement it end-to-end without
re-reading the whole guide:

1. **What it decides** — the professional outcome(s).
2. **Existing vs required** — what the codebase already has and what must change.
3. **Data model** — tables/columns to add (node-pg-migrate SQL, `hsdg.` schema).
4. **Contracts** — the vocabulary/types to add to `@hsdg/contracts`.
5. **Engine** — the pure, deterministic rule logic (unit-tested without a DB).
6. **API** — controller/service endpoints.
7. **Downstream triggers** — what this section feeds.
8. **Acceptance tests** — the spec's developer acceptance tests, made executable.

If any instruction here conflicts with an existing convention in the repo, **the existing
convention wins** — flag the conflict in the PR rather than diverging silently.

---

## 1. Product context and the "flawless output" bar

The statutory audit file is a controlled, legally-reproducible artefact. "Flawless" here
has a precise meaning, and every task below is judged against it:

- **No statutory number lives in code.** Every threshold, ratio, effective date, exemption
  condition and legal reference is *configuration data* resolved from a versioned library
  (§4). A build that hard-codes ₹250 cr, ₹1 cr, 11%, "8 years", "1 April 2023" etc. in a
  frontend constant or a service literal **fails review**, regardless of whether the number
  is currently correct.
- **A fact is captured once and reused.** Entity/engagement facts entered in 02.1 (and in
  the Client/Entity/Engagement masters) are never re-asked in 02.2–02.8. Re-asking a value
  the portal already holds fails review.
- **The system proposes; the professional concludes.** Every rule-driven area produces a
  *system suggestion + basis*; the Manager confirms or overrides; an override keeps **both**
  the original suggestion and the professional conclusion, plus a mandatory reason.
- **History is never silently rewritten.** Approved conclusions are frozen against the rule
  version and methodology version in force for the audit period. Later rule changes affect
  **future** periods only. Changing an approved framework requires a controlled reopen with
  impact analysis (§13).
- **Documents are portal-native.** Create-from-template → open in the in-app Office editor →
  autosave → version history, with no download/edit/re-upload step (§11).
- **Every legal claim is traceable.** Any conclusion driven by a provision/SA/guidance note
  exposes a `View Provision / View Standard / View Guidance` action resolving through the
  Authority Library (§5).

These are the acceptance criteria that recur in *all ten* specs. They are cross-cutting and
non-negotiable; the section chapters assume them.

---

## 2. Where this fits the existing codebase

The monorepo already implements a large part of the audit skeleton. **Do not rebuild it —
extend it.**

| Layer | Package / path | Reuse |
|---|---|---|
| Shared vocab & DTO types | `packages/contracts/src/*` | Add new modules; keep the "vocab defined once" rule |
| API (NestJS modular monolith) | `apps/api/src/modules/*` | Add sub-modules under `statutory-audit`, `catalogue`, `documents` |
| Web (Next.js 14 app router) | `apps/web/src/app/(portal)/*`, `components/statutory-audit/*` | Extend the Work-tab screens |
| Migrations (SQL, node-pg-migrate) | `db/migrations/*` | Timestamped files, `hsdg.` schema, RLS via helpers |
| Office editing | `modules/documents/{onlyoffice,m365,storage}` | This **is** the "SharePoint/M365" contract (§11) |
| Rules-versioning precedent | `modules/compliance` (`ComplianceRuleVersionRecord`) | Copy this pattern for the Audit Rules Library (§4) |
| Entity facts | `modules/entities`, migrations `1760500000000`–`1761200000000` | 02.1 reads/confirms these; never duplicates |
| Group relationships | `entity_relationships` (`1760800000000`) | 02.1/02.6 read this; do not build a second group master |
| Components / branch | `modules/components` | 02.6 component/branch auditor matrix builds here |

### 2.1 Current Statutory-Audit state (what already exists)

- A **versioned workflow shell**: `service_workflow_instances` + `audit_workflow_phases`,
  ten phases (`acceptance → framework → planning → risk → controls → audit_areas →
  completion → reporting → sign_off → archiving`), template version frozen on the instance,
  idempotent provisioning (`UNIQUE(engagement_service_id)` + `ON CONFLICT DO NOTHING`).
  Vocabulary in `contracts/src/statutory-audit.ts`.
- A **framework layer**: `audit_framework_assessments` / `_evidence` / `_approvals`
  (16 flat areas), an advisory **suggestion engine** (`framework-suggestions.ts`), a
  **work-generation engine** (`work-generation.ts`), and a versioned Framework Memo approval
  that snapshots conclusions to JSONB. Vocabulary in `statutory-audit-framework.ts`.
- Downstream SA phases (planning, risk, procedures, PBC, review/team, completion,
  reassessment) already scaffolded as modules + contracts + migrations.

### 2.2 The gap these ten specs close

| Spec area | Current codebase | Required change | Effort |
|---|---|---|---|
| **Rules Library (versioned, effective-dated)** | Thresholds **hard-coded** in `framework-suggestions.ts` | New `catalogue`-owned Audit Rules Library; refactor engine to resolve rules by audit-period effective date | **Large — do first (§4)** |
| **Authority / Provision Library** | Ad-hoc; no versioned legal reference store | New provision registry + `View Provision/Standard/Guidance` component | Medium (§5) |
| **Section 01 Engagement & Acceptance** | Phase seeded as `complete` (stub) | Full 8-segment acceptance workflow + Acceptance Matters + partner approval gate that **unlocks** framework | **Large (§8)** |
| **02.1 Entity & Regulatory Profile** | Folded into one descriptive framework area | Dedicated fact-capture-once profile that feeds all engines; small-company system assessment; SA 510/402/299 triggers | Large (§9) |
| **02.2 Financial Reporting Framework** | One `ind_as_as` area, hard-coded ₹250 cr | Full Ind AS/AS/SMC roadmap engine, net-worth timing, group/NBFC branches, first-time Ind AS | Large (§9) |
| **02.3 Schedule III** | One boolean area | Division I/II/III routing, version resolution, components, cash-flow exemption, rounding, disclosure library | Large (§9) |
| **02.4 CARO 2020** | One area, hard-coded exemption | Direct exemptions + cumulative private-company test with *intra-year* borrowing measurement; clause work-programme instantiation; CFS 3(xxi) | Large (§9) |
| **02.5 ICFR** | One `ifc` area | 143(3)(i) applicability decision flow; ICFR workstream config into Controls; separate from Rule 11(g) | Large (§9) |
| **02.6 Consolidation / Group Audit** | `cfs` boolean + `components` module | CFS applicability + Rule 6 exemption + perimeter + SA 600 component/branch auditor matrix + consolidation work programme | Large (§9) |
| **02.7 Other Companies Act reporting** | `rule_11`/`section_143`/`csr` booleans | Statutory reporting matrix: 143(3), Rule 11(a)–(g), 197(16), 143(12) fraud escalation, branch cross-refs | Large (§9) |
| **02.8 Framework Summary & Approval** | Single versioned memo approval | Consolidated dashboard, downstream config preview, blocking-matter gate, **baseline lock + controlled reopen + change-impact analysis** | Medium–Large (§9, §13) |
| **Matters/Exceptions engine** | None (framework has no matter register) | Auto-generated Acceptance Matters (01) + Framework Matters (02), never re-entered | Medium (§10) |
| **Prior-year roll-forward** | Partial (reassessment module) | Systematic roll-forward with "changed since last year" diffing across 01 & 02 | Medium (§12) |

**Decision to make explicit in the PR:** the existing 16-area flat framework model
(`FRAMEWORK_AREAS`) is a superset labelling; these specs re-organise Section 02 into the
sub-sections **02.1–02.8**. Recommended approach: **keep the `audit_framework_*` tables as
the approval/snapshot spine**, and add **per-sub-section assessment tables** (below) that the
02.8 dashboard aggregates. Map each existing area key to its owning sub-section so no data or
downstream wiring is lost. Do **not** delete the existing model before 02.8 aggregation is
proven.

---

## 3. Non-negotiable architectural principles (cross-cutting)

These are distilled from every spec's "Rule-Engine Requirement", "Completion Rules",
"Audit Trail" and "Developer Acceptance Tests" sections. Implement them once, centrally.

1. **Capture-once → versioned rules → show result elsewhere.** One reusable fact block per
   engagement (the 02.1 profile + masters). Engines read facts; they never re-collect them.
2. **Configuration, not constants.** All statutory numbers/dates/conditions live in the
   Rules Library, resolved by the engagement's audit period (§4).
3. **Suggestion vs conclusion.** Engines emit `{ suggestion, state, basis }`. Professionals
   decide. Overrides preserve both + reason (this is already the `FrameworkState` model —
   extend it, don't reinvent it).
4. **Effective-date resolution + historical freeze.** A conclusion stores the rule version
   and methodology version used. Rule-library edits create new versions; historical
   engagements keep resolving against their frozen version.
5. **Idempotency.** Every generation/instantiation (work programmes, clause libraries,
   component records) is `UNIQUE`-keyed and upserted, mirroring `work-generation.ts` and the
   `ON CONFLICT DO NOTHING` provisioning precedent. Re-running never duplicates.
6. **Exception-driven UX.** Segments/areas are compact dashboards, not long questionnaires.
   Yes/No/NA controls; narrative fields appear only on exception. Every blocker is a
   clickable link to its source (§8.4, §13).
7. **Matters are generated, not re-entered.** Adverse answers create Matter records with a
   `source` back-link; users resolve them in place (§10).
8. **Documents are portal-native and evidence is linked once.** Reuse the `documents`
   module; evidence points at a document row, never a duplicate copy (this is already how
   `audit_framework_evidence` works).
9. **Audit trail on everything.** Store actor, timestamp, source reference, prior value,
   rule/methodology version for every confirmation, override, approval and reopen.
10. **Locks gate workflow; RLS gates permission.** Phase locks are professional state, not
    security. Access is enforced by the existing `is_engagement_member` / `is_engagement_lead`
    RLS helpers (never by hiding a button).

---

## 4. Foundational subsystem #1 — the Audit Rules Library (build first)

This is the single most important piece. Until it exists, **do not** implement any 02.x
threshold logic, because doing so will hard-code numbers you must later rip out.

### 4.1 Design — copy the `compliance` precedent

`modules/compliance` already models an effective-dated, append-only, version-frozen rule:
`ComplianceRuleRecord` → `ComplianceRuleVersionRecord (effectiveFrom, effectiveTo, …)`, and
instances snapshot the version they used. Reuse that exact shape for audit applicability
rules. Owner: extend the **`catalogue`** module (it already owns firm-wide reference data:
services, templates, review models, workflow families).

### 4.2 Schema (`db/migrations/<ts>_audit_rules_library.sql`)

```
hsdg.audit_rule
  id, code (unique, e.g. 'INDAS_CORPORATE_UNLISTED_NETWORTH'),
  area_key (fk vocabulary: ind_as_as | caro | ifc | cfs | schedule_iii | reporting | …),
  entity_class (text, nullable, e.g. 'nbfc' | 'non_nbfc' | 'private' | 'public'),
  criterion (text, e.g. 'net_worth'),
  operator (text CHECK IN ('>=','>','<=','<','==','between')),
  unit (text, e.g. 'inr' | 'percent' | 'boolean' | 'date'),
  measurement_basis (text, e.g. 'standalone_audited_fs' | 'at_any_point_in_year'),
  is_active, created_at, updated_at

hsdg.audit_rule_version              -- append-only; the frozen calculation snapshot
  id, audit_rule_id (fk), version (int),
  effective_from (date), effective_to (date NULL until superseded),
  threshold numeric NULL, threshold_high numeric NULL,  -- 'between' uses both
  condition jsonb NULL,                                 -- structured extra conditions
  outcome text,                                         -- e.g. 'applicable' | 'ind_as'
  authority_provision_id (fk hsdg.authority_provision), -- §5
  guidance_reference text NULL,
  notes text,
  created_at,
  UNIQUE (audit_rule_id, version)

hsdg.audit_ruleset_version           -- the methodology bundle frozen onto an engagement
  id, methodology_version (text, e.g. 'v2026.1'),
  effective_from, effective_to, notes
```

Rules Library edits by an authorised methodology administrator create **new versions**
(new `effective_from`); they never mutate a prior version. Store child rule tables where a
rule has a band table (e.g. **Schedule V effective-capital → remuneration ceilings** for
02.7): `audit_rule_band (audit_rule_version_id, lower, upper, ceiling_value, …)`.

### 4.3 Resolution service

```
AuditRulesService.resolve(areaKey, criterion, auditPeriodStart, entityClass?) 
   → { ruleId, version, threshold, operator, unit, outcome, authorityProvisionId, methodologyVersion }
```

- Selects the `audit_rule_version` where `effective_from <= auditPeriodStart` and
  (`effective_to IS NULL` OR `effective_to > auditPeriodStart`), highest `effective_from`.
- Returns `Information Insufficient` when no version covers the period (never a guess).
- The engine renders the **actual rule used** in the basis string, e.g.
  `"Unlisted; applicable net worth ₹312 cr; threshold ₹250 cr; rule effective 01-Apr-2017; Ind AS applicable."`

### 4.4 Refactor `framework-suggestions.ts`

The current pure engine hard-codes `250 * CRORE`, `1 * CRORE`, `10 * CRORE`, Sec 138/204/135
limits, etc. Refactor so the engine takes an injected **`RuleResolver`** (a pure function
`(areaKey, criterion, entityClass) → ResolvedRule`) alongside `FrameworkFacts`. Keep it pure
and deterministic — the resolver is passed in, so unit tests still run without a DB by
supplying a fixture resolver. This preserves the existing test style
(`framework-suggestions.spec.ts`) while removing every literal.

**Acceptance:** changing a threshold for a future `effective_from` changes future-period
results with no code change and no rewrite of historical conclusions (the exact acceptance
test in 02.2, 02.4, 02.5, 02.6, 02.7).

---

## 5. Foundational subsystem #2 — the Authority / Provision Library

Every `View Provision / View Standard / View Guidance` action resolves here. **No external
URL is embedded in a UI component.**

### 5.1 Schema (`<ts>_authority_provision_library.sql`)

```
hsdg.authority_provision
  id, code (e.g. 'COS_ACT_2_85'), authority (MCA | ICAI | SEBI | RBI | IRDAI | other),
  title, provision_number (e.g. 'Section 2(85)'),
  effective_from (date), effective_to (date NULL),
  source_reference (text/URL), superseded_by_id (fk NULL),
  methodology_version_scope text NULL, created_at, updated_at
```

- References resolve **by engagement period**; a historical engagement opens the version in
  force then, never the current one.
- Web renders a `<ProvisionLink code effectiveOn>` component that opens an **in-portal
  viewer / side panel** — the user never leaves the workflow.

Seed the provisions each spec lists (Section 2(85), 2(41), 129(3), 143(3)/(3)(i)/(8)/(12),
164(2), 197/198, Schedule III Div I/II/III, Schedule V, Rule 4 Ind AS Rules, Rule 6 Accounts
Rules, Rule 11(a)–(g), Rule 13, CARO 2020, SA 299/402/510/600, Ind AS 28/101/110/111, AS
21/23/27, SMC definition, IEPF, ADT-4). Store title/authority/number/effective dates +
source; wire each rule version's `authority_provision_id`.

---

## 6. Domain data model — new tables per sub-section

All tables live in `hsdg.`, follow the existing RLS pattern (`ENABLE ROW LEVEL SECURITY`,
`SELECT` = `is_engagement_member`, `INSERT/UPDATE` = `is_engagement_lead`, migrator-owned
`SECURITY DEFINER` helpers bypass), carry `version int`, `created_at/updated_at` with the
`set_updated_at` trigger, and reference `service_workflow_instances(id)` +
`engagements(id)`.

Recommended new tables (names indicative — align to existing pluralisation):

- **01 Acceptance:** `audit_acceptance_segments`, `audit_acceptance_answers`,
  `audit_acceptance_matters`, `audit_independence_matters`, `audit_acceptance_approvals`.
- **02.1 Profile:** `audit_entity_profile` (one row per shell; confirmed fact snapshot +
  source refs + methodology version), `audit_profile_financials`
  (parameter, current_fy, prior_fy, source_type, preparer, captured_at, document_id).
- **02.2–02.7 assessments:** one `audit_framework_subassessment` table keyed
  `(workflow_instance_id, sub_section_key, area_key)` reusing the existing `FrameworkState`
  model, **plus** engine-output columns: `system_outcome`, `system_basis jsonb`
  (facts+rule+limit+effective date), `rule_version_id`, `authority_provision_id`,
  `conclusion`, `is_overridden`, `basis`, `impact`, `needs_reevaluation bool`. Prefer one
  table with a discriminator over eight near-identical tables.
- **02.4 CARO clauses:** `audit_caro_clause` (clause library instance, versioned,
  `applicability_to_facts`, `conclusion`, `reporting_output`) + `audit_caro_cfs_component`.
- **02.5 ICFR:** ICFR workstream config rows feed the existing `controls` phase; store the
  applicability decision + the exemption test values on the sub-assessment.
- **02.6 CFS/group:** extend `components` module —
  `audit_component_entity` (relationship, ownership%, voting%, control conclusion,
  accounting method, reporting date, local GAAP, component auditor), `audit_component_auditor`
  (SA 600 fields), `audit_branch_auditor` (Sec 143(8)), `audit_cfs_exemption` (Rule 6
  condition-by-condition), `audit_consolidation_workprogramme`.
- **02.7 reporting matrix:** `audit_reporting_matter` (one row per 143(3)/Rule 11 item),
  `audit_remuneration_workpaper` (Sec 197/198), `audit_audit_trail_system`
  (per software/module, Rule 11(g)), `audit_fraud_matter` (Sec 143(12), with a **deadline
  engine** computing 2/45/15-day dates from the *event* date — reuse the compliance
  deadline-layer pattern).
- **02.8 baseline:** `audit_framework_baseline` (version, methodology version, rule versions
  used, memo document ref, approver, immutable snapshot jsonb), `audit_framework_reopen`
  (reason, affected sections, impact analysis jsonb, new revision).

---

## 7. Rule-engine design pattern (apply to every 02.x engine)

Model each sub-section engine on the existing `framework-suggestions.ts` conventions:

- **Pure module** `apps/api/src/modules/statutory-audit/framework/<subsection>.ts`, exported
  functions, no DB access, deterministic, with a sibling `.spec.ts`.
- Signature: `assess(facts: SubsectionFacts, resolve: RuleResolver): SubsectionResult`.
- `SubsectionResult` always carries `{ outcome, state, basis, factsUsed[], ruleVersionId,
  authorityProvisionId }`. `state` uses the existing `FRAMEWORK_STATE` union
  (`pending_information` when a deciding fact is absent; `professional_judgement_required`
  when no safe rule applies — **never guess**).
- The service layer loads facts (from 02.1 profile + masters), calls the engine, persists the
  suggestion, and exposes confirm/override endpoints. Override writes `is_overridden=true`,
  requires `basis`, keeps `system_*` intact (enforced by the existing
  `framework_override_needs_basis` CHECK — extend it to the new table).
- **Cross-section flow:** when a source fact changes after confirmation, set
  `needs_reevaluation=true` on affected downstream sub-assessments (the "Needs Re-evaluation"
  requirement in 02.1/02.3/02.4). Compute the affected set from the downstream trigger map
  (§9, each spec's Table "Downstream Trigger Map").

---

## 8. Section 01 — Engagement & Acceptance

### 8.1 What it decides
Whether DHVAJ can accept/continue the audit: appointment & eligibility, previous-auditor
communication, acceptance/continuance, independence & ethics, audit preconditions,
engagement letter, and **Partner approval** that unlocks Section 02.

### 8.2 Existing vs required
The `acceptance` phase is currently seeded `complete` (a stub, because the engagement is
already accepted to reach service-add). These specs make it a **real 8-segment workflow**.
Change the initial state to `in_progress` for a new statutory-audit shell, and gate the
`framework` phase unlock on `AF`-style partner approval here.

### 8.3 Segments (compact dashboards, left-nav + focused centre + right context)
`01.1 Engagement Profile` (read-only master confirm) · `01.2 Appointment & Eligibility`
(with eligibility checklist → Matters) · `01.3 Previous Auditor Communication` (conditional;
"Not Applicable — Continuing Engagement" path) · `01.4 Acceptance / Continuance`
(new vs continuing branch) · `01.5 Independence & Ethics` (system-generated team-independence
summary; other-services list from active engagement services) · `01.6 Audit Preconditions` ·
`01.7 Engagement Letter & Required Documents` (create-from-template) ·
`01.8 Final Acceptance & Partner Approval` (readiness summary, no re-questionnaire).

Prefill everything from Client/Entity/Engagement/Team masters (read-only). Correction routes
to the **source master**, never a duplicate audit-only copy.

### 8.4 Acceptance Matters engine (§10 pattern)
Adverse answers auto-create `audit_acceptance_matters` with `matter_id`, `source` (the
question/segment), `category`, `severity`, `owner`, `action/safeguard`, `due_date`, `status`,
`resolution`, `approver`. A compact **Open Acceptance Matters** panel shows on the landing +
final screen; each item deep-links to its source. Blocking matters prevent completion.

### 8.5 Completion & gate
Section 01 → `complete` only when the spec's §14 checklist passes and the Engagement Partner
records `FINAL-02`. On approval: record partner/timestamp/conclusion, **lock** approved
records against silent editing (controlled reopen thereafter), and **unlock Section 02**
(set `framework` phase to `in_progress`). Explicitly *exclude* the items in spec §15 (AS/Ind
AS, Schedule III, CARO, IFC, CFS, SA matrix, materiality, risk) — those are Section 02+.

### 8.6 Documents
Auditor Consent/Eligibility Certificate, Previous-Auditor Communication, Engagement Letter,
Client Acknowledgement — all `Create from Template` → in-app Office editor → autosave →
version history via the `documents` module (§11). Template records are version-controlled;
historical engagements retain the template version actually used.

---

## 9. Section 02 — Audit Framework (02.1–02.8)

Every sub-section follows §7's engine pattern, §4's rules resolution and §5's provision
links. Below: the decision each makes, its defining rules, and its acceptance tests. Read the
matching spec for full field lists and tables.

### 9.1 — 02.1 Entity & Regulatory Profile (the factual foundation)
- **Decides:** the confirmed fact set that drives 02.2–02.9. Outcome is not an applicability
  conclusion.
- **Cards A–J:** company classification; special-entity matrix (bank/insurance/NBFC/HFC/
  Sec 8/govt/Nidhi/producer/dormant/other regulator); group structure (from
  `entity_relationships` — confirm, don't rebuild); **one reusable financial-data block**
  (paid-up capital, turnover, net worth, total assets, borrowings, bank/FI borrowings,
  deposits — current & prior FY, with source/preparer/date/evidence); **Small Company system
  assessment** (computed from Section 2(85) rule version — never a manual checkbox);
  financial year (Sec 2(41)); initial/continuing audit (derived from engagement history →
  **auto-flags SA 510**); accounting environment (→ service organisation auto-flags **SA 402**);
  joint audit (→ **SA 299**).
- **Rules:** small-company thresholds via Rules Library; SA 510/402/299 flags carried forward
  to 02.8 & Planning.
- **Roll-forward:** stable classifications shown as *System Suggested*; monetary values
  refreshed from current-year data, never rolled forward; changes flag downstream
  re-evaluation.
- **Completion:** `CONFIRM PROFILE` records preparer, timestamp, methodology version, data
  snapshot; fact set becomes available to 02.2–02.9.
- **Acceptance (spec §20):** masters pre-populated; no duplicate audit-only values; small-
  company computed with `View Provision`; SA 510/402/299 auto-flagged; facts reused
  downstream with no re-entry; full audit trail.

### 9.2 — 02.2 Financial Reporting Framework
- **Decides:** Ind AS / AS / Specialised-Further-Assessment, with legal basis.
- **Engine sequence (02.2D):** prior/continuing Ind AS status → voluntary adoption → SME
  Exchange/roadmap exception → listing status → Rule 4 net-worth timing → apply
  ₹500cr/₹250cr roadmap rule by effective phase → group-relationship triggers → return
  Applicable / Not Applicable / Information Insufficient / Professional Review Required.
- **Branches:** ordinary corporate vs **NBFC** (own Rule 4(2A) phases) vs bank/insurance
  (route to specialised methodology — do not force the ordinary roadmap). **Continuing Ind AS**
  wins over a low current-year net worth. If AS → compute **SMC** sub-status (turnover ₹250cr /
  borrowings ₹50cr, Rules-Library values). First-time Ind AS → flag Ind AS 101 downstream
  (don't do transition testing here).
- **Acceptance (spec §22):** the ten scenarios (unlisted ₹600cr→Ind AS; ₹300cr→Phase II;
  listed non-SME below ₹500cr via listing roadmap; SME proviso tested; group-triggered;
  prior adopter continuing; NBFC ₹600cr@2018 phase; NBFC unlisted ₹300cr@2019; AS→SMC;
  future rule-library change affects future only). Every reference opens via the Provision
  Library.

### 9.3 — 02.3 Schedule III & Presentation Framework
- **Decides:** applicable Schedule III **Division** (I=AS / II=Ind AS non-NBFC / III=Ind AS
  NBFC) or specialised statutory format; version; required FS components; cash-flow
  requirement/exemption; rounding framework; disclosure library.
- **Rules:** route from 02.2 conclusion; bank/insurance/regulated → specialised-format
  assessment (don't force a Division). Resolve the exact Schedule III **version by audit
  period**. Cash-flow exemption **consumes** the 02.1 classifications (OPC/small/dormant) —
  never re-asks. Rounding units and disclosure list come from the versioned Schedule III rule.
- **Output:** `Create Financial Statements Workbook` (correct template version, created in the
  document workspace). Disclosure engine = baseline mandatory + fact-triggered (a zero balance
  never suppresses a rule-required disclosure).
- **Acceptance (spec §21):** Division routing per framework; specialised entity not forced;
  02.2 change marks 02.3 for re-evaluation; version by period; cash-flow reuse; versioned
  rounding/disclosures; workbook template selection; historical version freeze.

### 9.4 — 02.4 CARO 2020 Applicability
- **Decides:** Applicable / Not Applicable-Exempt / Further Assessment; instantiates the
  clause work programme if applicable.
- **Rules:** effective FY 2021-22+. **Direct exemptions first** (banking, insurance, Sec 8,
  OPC, small company — consume the 02.1 small-company result, don't recompute). Then the
  **cumulative private-company test**: public-group relationship AND paid-up+reserves ≤ ₹1cr
  (at BS date) AND bank/FI borrowings ≤ ₹1cr (**aggregate, at any point in the year** — not
  year-end) AND total revenue ≤ ₹10cr (CARO measurement basis). All conditions cumulative;
  one fail → CARO may apply.
- **Two-level model:** Level 1 = CARO applies to the report; Level 2 = clause relevance to
  facts. A clause "Not Applicable to Facts" **never** changes Level 1. CFS → only clause
  3(xxi) (gather component CARO reports), not a duplicate full programme.
- **Acceptance (spec §20):** banking exempt without threshold tests; private sub of public
  fails regardless of money; intra-year borrowing peak fails; aggregate-not-per-lender
  borrowings; revenue exactly at limit passes ("does not exceed"); standalone instantiates
  paragraph-3 programme; CFS = 3(xxi) only; future rule change affects future only.

### 9.5 — 02.5 Internal Financial Controls / ICFR Reporting
- **Decides:** Section 143(3)(i) reporting Applicable / Exempt / Further Assessment; configures
  the ICFR workstream in the Controls phase when applicable.
- **Decision flow:** resolve version → non-private ⇒ applicable → else test OPC → small company
  (consume 02.1) → else test **both** turnover < ₹50cr **AND** peak aggregate covered
  borrowings < ₹25cr (banks + FIs + **any body corporate**, intra-year max, operator `<`) →
  test **filing-default** condition (Sec 92/137). Both monetary conditions required (AND).
- **Critical separations:** ICFR exemption does **not** disable the Controls phase (normal SA
  control work continues). Rule 11(g) audit-trail reporting is a **separate** conclusion
  (§9.7). Integrated audit: one control record, multiple purposes (FS + ICFR) — no duplicate
  tests. CFS → a consolidated ICFR *consideration*, not a duplicate parent workstream.
- **Acceptance (spec §24):** turnover exactly ₹50cr fails (`<`); borrowings exactly ₹25cr
  fails; intra-year peak governs; both-AND; filing default blocks even if money passes;
  exemption keeps Controls active; evidence reusable across FS+ICFR; Rule 11(g) stays separate.

### 9.6 — 02.6 Consolidation / Group Audit Framework
- **Decides:** CFS required?; consolidation perimeter + accounting method; SA 600 component &
  branch auditor framework; consolidation work programme.
- **Rules:** Section 129(3) trigger; **Rule 6 exemption tested condition-by-condition**
  (ownership status; partially-owned → all other members intimated in writing & no objection,
  proof retained; not listed/in-process; parent files compliant CFS) — all cumulative; no
  ownership % creates the exemption by itself. **Percentages are inputs/presumptions, never
  the whole test**: AS 21 (>50% or board control), AS 23/Ind AS 28 (20% rebuttable), Ind AS
  110 (principle-based control — not a 50% code test), Ind AS 111. Reporting-date gap &
  GAAP-conversion driven by the applicable standard version. SA 600 (not revised ISA 600
  unless ICAI adopts). Branch auditors → Sec 143(8).
- **No fixed materiality %** here — perimeter passes to Section 03.3.
- **Cross-links:** feeds CARO 3(xxi) (02.4) and consolidated ICFR (02.5) from **one** group
  structure — no duplicate component entry.
- **Acceptance (spec §25):** control not coded as bare >50%; 20% rebuttable both ways;
  partially-owned Rule 6 needs all conditions; listed subsidiary fails Rule 6; missing parent
  CFS filing ⇒ pending/unavailable; other auditor ⇒ SA 600 + instructions; no duplicate
  CARO/ICFR component records; no hard-coded materiality %; historical rule freeze.

### 9.7 — 02.7 Other Companies Act & Statutory Reporting
- **Decides:** the statutory reporting **matrix** — 143(3) core items, Rule 11(a)–(g),
  197(16) managerial remuneration, 143(12) fraud escalation, branch cross-refs. It
  *configures* obligations and downstream work; it is **not** a second audit.
- **Rule 11(g) audit trail:** effective FY commencing on/after 1 Apr 2023; assess
  **per software/module**, not one Yes/No; 8-year preservation (Sec 128(5)) is rule data.
  Separate from 143(3)(h) and 143(3)(i).
- **197(16):** public company only; compare against 11%/5%/10%/1%/3% using **Section 198 net
  profit** (not PBT/PAT); no/inadequate profit → **versioned Schedule V band table**, not the
  ratios alone.
- **143(12) fraud:** one central Fraud Matter record; ₹1 cr CG-route threshold; **deadline
  engine** computes 2-day / 45-day / 15-day dates from the **legally relevant event date**
  (reuse the compliance deadline-layer pattern), ADT-4 reference. Below ₹1 cr → Audit
  Committee/Board route.
- **Rule 11(e)/(f):** two mirrored intermediary/ultimate-beneficiary assessments linked to
  the MRL; no invented monetary threshold. Dividend → Sec 123.
- **Acceptance (spec §21):** public activates 197(16); Sec 198 basis; Schedule V routing;
  fraud exactly ₹1cr triggers CG route (₹99.99 L below); deadline math from event dates;
  Rule 11(g) period logic; per-system audit trail with rule-configured retention;
  cross-links consume 02.4/02.5/02.6; future limit changes are config-only.

### 9.8 — 02.8 Audit Framework Summary & Approval
- **Decides nothing new** — it is the **closure/control layer**. Consolidated dashboard (every
  conclusion links to its source assessment); triggered-SA list (510/402/299/600/expert/CFS);
  **Downstream Configuration Preview** generated from config (what will be created/activated/
  deactivated in Planning/Controls/Areas/Reporting); aggregated Framework Matters; prior-year
  change diff; Manager confirmation (`AF-01`) → **Audit Framework Memorandum** (create-from-
  template, showing actual value / limit / operator / result wherever a number drove a
  conclusion) → Engagement Partner approval (`AF-02`).
- **On approval:** freeze **Audit Framework Baseline v1.0** (methodology + all rule versions +
  memo doc version + immutable snapshot); set Section 02 `approved`; **unlock Planning**.
- **Controlled reopen (§13):** preserves v1.0, creates v1.1, edits happen in the originating
  sub-section, runs **change-impact analysis**, notifies EP/Manager and downstream owners,
  never deletes completed downstream work.
- **Acceptance (spec §20):** no duplicate editable source facts; dashboard links to source;
  blocking matter blocks submission/approval; preview accurate; memo shows numbers+limits;
  approval stores versions; baseline prevents silent edit; reopen preserves v1.0 → v1.1;
  material change produces impact analysis; Planning locked until approval.

---

## 10. Cross-cutting — the Matters / Exceptions engine

One reusable mechanism serves Section 01 (Acceptance Matters) and Section 02 (Framework
Matters). Model on the spec's matter tables:

- Auto-generated from adverse answers/overrides/pending facts with a `source` back-link
  (question/segment/area). **Never re-entered** in a separate register.
- Fields: `matter_id` (auto), `source`, `category`, `severity`
  (`low|medium|high|critical` for acceptance; `information_pending|technical_judgment|
  framework_override|legal_interpretation|partner_consultation|blocking` for framework),
  `owner`, `due_date`, `status` (`open|under_review|resolved|accepted_with_approval|blocking`),
  `resolution`, `approver`, evidence link.
- A **blocking** matter prevents section completion/approval. Non-blocking matters may remain
  only where methodology permits and the EP records the condition/treatment.
- A compact Matters panel on each section's landing + final screen; each row deep-links.

---

## 11. Cross-cutting — document & Office integration ("SharePoint/M365" = the `documents` module)

The specs say "SharePoint-backed / Microsoft 365". The codebase implements the **same
contract** via `modules/documents` (`onlyoffice`, `m365`, `storage`, `ocr`). Treat the spec's
document workflow as an **abstraction** satisfied by this module — do **not** add a new
SharePoint integration unless the firm decides to. Required behaviours, all already supported:

- `Create from Template` → create the file in the engagement document workspace, **merge**
  engagement/entity/partner/firm data, open in the in-app editor.
- `Open` / `Edit` → in-app Office editor (OnlyOffice), **AutoSave** to the same file, no
  download/re-upload.
- `Version History` surfaced on the file card; approved work requires **controlled reopen**.
- `Add File` / `Link Existing File` → store once, link to the work item; evidence points at
  the document row (never a copy), exactly as `audit_framework_evidence` already does.

Template records are version-controlled through the `catalogue` templates
(`catalogue-templates.*`, `add-template-version.dto.ts`); historical engagements keep the
template version used.

---

## 12. Cross-cutting — prior-year roll-forward

For continuing audits (`initialState` derived in 02.1), each section is roll-forward driven:
show prior-year values beside current; carry stable classifications as **System Suggested**
(never silently final); refresh monetary values from current data; **highlight changes**
(listing, group, category, regulator, FY, accounting environment, framework, CARO/ICFR
status); any change that affects an already-computed downstream assessment marks it
`needs_reevaluation`. The `reassessment` module + migration `1762900000000` is the existing
home for this — extend it rather than adding a parallel mechanism.

---

## 13. Cross-cutting — baseline locking, controlled reopen & change-impact

- **Baseline:** 02.8 approval writes an immutable `audit_framework_baseline` (v1.0) capturing
  methodology version, every rule version used by 02.1–02.7, the memo document version, and a
  JSONB conclusion snapshot. Approved assessments become read-only with source links.
- **Reopen:** `Reopen Audit Framework` preserves v1.0, creates v1.1, requires reason + affected
  sections; the user edits the **originating** sub-section (not a copy in 02.8).
- **Change-impact analysis:** a deterministic engine maps a changed conclusion to affected
  downstream: e.g. `CARO Exempt→Applicable` = create CARO programme + reassess planning/
  completion/reporting; `AS→Ind AS` = reconfigure FS framework/Schedule III/disclosures/
  planning; `CFS Not Required→Required` = create consolidation/group work. Notify EP/Manager
  and downstream owners; **never delete** completed downstream work — mark its relation to the
  superseded baseline; surface reporting implications in Completion/Reporting.

---

## 14. Mobile parity plan (after the web portal is proven)

The app copies features from the web portal with **zero logic duplication**:

- **Reuse `@hsdg/contracts`** — all vocab, states, DTO shapes are already UI-agnostic. The RN
  app imports the same package.
- **Reuse the pure engines** — `framework-suggestions`, `work-generation`, and every new
  `framework/<subsection>.ts` are pure TS with no DB/React dependency. Move any shared pure
  logic into a `packages/*` package if the app needs it client-side; otherwise the app calls
  the same API endpoints.
- **Same API** — the app is another client of the NestJS API; no mobile-specific endpoints
  unless payload shaping demands it.
- **Screen mapping:** the web segment/left-nav + exception-driven pattern maps to RN
  stack/tab navigation; the compact-dashboard model is *more* suited to mobile, so honour it.
- **Deferred on mobile:** in-app Office editing and the provision side-panel may open in a web
  view; plan for that boundary but don't block web delivery on it.

Do not fork rules or thresholds into the app. If the app ever needs a threshold, it comes from
the API/Rules Library, never a mobile constant.

---

## 15. Testing strategy (the "flawless" gate)

1. **Pure engine unit tests** — one `.spec.ts` per sub-section engine, mirroring
   `framework-suggestions.spec.ts`. Encode **every developer acceptance test** from the ten
   specs as a named case (they are enumerated in each spec's "Developer Acceptance Tests" and
   summarised in §9 above). These run without a DB via a fixture `RuleResolver`.
2. **Rules-Library resolution tests** — effective-date selection, historical freeze, "future
   threshold change affects future only, never rewrites history" (the recurring acceptance
   test across 02.2/02.4/02.5/02.6/02.7).
3. **Service/integration tests** — confirm/override preserves both values + reason; matter
   auto-generation; idempotent work-programme/clause/component instantiation; downstream
   `needs_reevaluation` propagation; baseline freeze + reopen creating v1.1.
4. **RLS tests** — member can read, only lead can mutate, on every new table (extend the
   existing engagement RLS test suite).
5. **E2E** (`test:e2e`) — the two headline flows: (a) Section 01 acceptance → Partner approval
   → Section 02 unlock; (b) 02.1 profile → 02.2–02.7 conclusions → 02.8 memo → EP approval →
   baseline v1.0 → Planning unlock; plus a reopen-and-impact flow.
6. **No-hard-coded-number lint** — add a CI check/grep that fails on statutory numeric
   literals in `framework/*` engines and web components (allow only via the resolver). This is
   the mechanical guard for principle #2.

---

## 16. Recommended build sequence (dependency-ordered)

1. **Rules Library** (§4) + **Authority/Provision Library** (§5) + seed. *Refactor
   `framework-suggestions.ts` to the resolver.* — unblocks everything.
2. **Matters engine** (§10) + **document/template wiring** confirmation (§11).
3. **Section 01** acceptance workflow (§8) + Partner-approval gate to unlock Framework.
4. **02.1 Entity & Regulatory Profile** (§9.1) — the fact foundation; nothing else in 02 is
   correct until facts are captured once here.
5. **02.2 → 02.3 → 02.4 → 02.5** (§9.2–9.5) — each: contract, engine + spec, service, screen,
   downstream triggers.
6. **02.6 Consolidation/Group** (§9.6) — extends `components`; wire CARO 3(xxi) + consolidated
   ICFR cross-links.
7. **02.7 reporting matrix** (§9.7) — reporting matters, remuneration, audit-trail, fraud
   deadline engine.
8. **02.8 summary, baseline lock, controlled reopen, change-impact** (§9.8, §13) — closes
   Section 02 and unlocks Planning.
9. **Prior-year roll-forward** hardening across 01 & 02 (§12).
10. **Mobile parity** (§14) once web Sections 01 & 02 are signed off.

Ship each sub-section behind the existing phase-lock model so partial delivery never exposes
an unapproved framework to Planning.

---

## 17. Definition of Done — per-section "flawless" checklist

A sub-section is done only when **all** of the following hold:

- [ ] No statutory number/date/ratio/condition is a literal in engine or UI code — all resolve
      from the Rules Library by audit period.
- [ ] Every legal claim exposes a working `View Provision/Standard/Guidance` via the Authority
      Library, resolved to the period-correct version.
- [ ] Facts are read from 02.1/masters; nothing already held is re-asked.
- [ ] The engine emits `{ outcome, state, basis, factsUsed, ruleVersionId, provisionId }`;
      `pending_information` / `professional_judgement_required` are used instead of guessing.
- [ ] Confirm/override persists both system suggestion and professional conclusion; override
      requires a basis (DB CHECK enforced).
- [ ] Adverse answers create Matters with source back-links; blocking matters gate completion.
- [ ] Instantiation (work programmes/clauses/components) is idempotent (UNIQUE + upsert).
- [ ] Downstream `needs_reevaluation` fires on source-fact change per the trigger map.
- [ ] Documents create-from-template → in-app edit → autosave → version history; evidence
      links, never copies.
- [ ] RLS present (member read / lead mutate); audit trail records actor/time/version/prior
      value.
- [ ] Every developer acceptance test from the source spec exists as a green named test case.
- [ ] Prior-year roll-forward behaves per §12 for continuing audits.
- [ ] All types live in `@hsdg/contracts` so the app can reuse them unchanged.

When Section 01 and 02.1–02.8 each pass this list, the web portal is ready and the mobile app
can be built by wrapping the same contracts, engines and endpoints.
