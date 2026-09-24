# Section 03 — Planning: Build & Context Spec (03.1 – 03.5)

> **Purpose of this file.** Consolidated, developer-ready digest of the five DHVAJ
> "Section 03 — Planning" functional specifications (03.1–03.5), mapped onto the
> **actual `@hsdg` portal codebase** so the build can start without re-reading the
> source `.docx` files. This is the working context document — keep it in sync as
> modules land.
>
> **Source specs** (in `~/Downloads/`, converted text in job tmp):
> - `DHVAJ_Section_03_1_Planning_Intelligence_Overall_Audit_Strategy_Developer_Specification.docx`
> - `DHVAJ_Section_03_2_Business_Understanding_Preliminary_Analytics_Developer_Specification.docx`
> - `DHVAJ_Section_03_3_Materiality_Developer_Specification.docx`
> - `DHVAJ_Section_03_4_Audit_Scope_Approach_Developer_Specification.docx`
> - `DHVAJ_Section_03_5_Audit_Areas_Assertions_Developer_Specification.docx`
>
> **Target repo:** `~/Documents/hsdg` (`hsdg-portal`, remote `intenzee/hsdg`), the DHVAJ portal.

---

## Build status (updated 2026-09-24)

| Piece | Status | Where |
|---|---|---|
| Planning Signal Register (signals, Areas of Focus, focus↔signal link) | ✅ built, live-tested | migration `1764200000000_statutory_audit_planning_signals.sql`; contract `statutory-audit-planning-signal.ts` |
| 03.1 Engagement Intelligence generator | ✅ derives from `audit_entity_profile` (initial/joint audit, SA 510/402/299, accounting env) + `audit_framework_assessments` (CARO, ICFR, CFS, internal audit) | `planning-signals-generation.ts` (pure, unit-tested) |
| 03.1 PI-01 changes, signal assessment + rationale gates, Areas of Focus, AS-01/AS-02, Strategy Summary draft, completion gate, status flow | ✅ | `audit-planning-intelligence.{service,controller}.ts`, `dto/planning-intelligence.dto.ts` |
| 03.1 remaining sub-sections: strategic timing/resource considerations (§13.2–13.3), prior-year intelligence (03.1.6), acceptance carry-forward (03.1.7), team planning discussion (03.1.8), Planning Matter/Action register (§18), full §20 completion checklist, §17 summary sections | ✅ built, live-tested end-to-end to `complete` | migration `1764300000000_statutory_audit_planning_strategy.sql`; contract `statutory-audit-planning-strategy.ts`; `audit-planning-strategy.{service,controller}.ts`, `dto/planning-strategy.dto.ts`, `planning-considerations-generation.ts` (pure, unit-tested), `planning-shared.ts` |
| 03.1 web control room (9 tabs + completion checklist) | ✅ builds; not yet clicked through in a browser | `planning-intelligence-panel.tsx` + `planning-strategy-sections.tsx`, opened from the `audit_strategy` row in `planning-panel.tsx` |
| 03.1 still open | ⏳ | SharePoint evidence flow on signals/changes/PY matters (only a `documentId` link today); PY matters are manual in v1 (no prior-year portal data yet); signal/consideration rules live in code, not the `audit_rule*` library; Partner Planning View / notifications for new Enhanced/IPA signals (§19) |
| 03.2 Business Understanding & Preliminary Analytics — sections 03.2.1–03.2.6 (field catalogue + "anything changed?" + PI-01/Section 02 context), focused financial dataset (canonical metric ids, source per figure, unit conversion, custom metrics), analytics engine (movements, N/M, ratios with formula + inputs, relationship rules, industry profiles, versioned attention parameters), Investigation Cards (§16 gates, reopen on figure change, never deleted), expectation vs actual (§14), §19 conclusion draft, BA-01 + §22 checklist | ✅ built, live-tested end-to-end to `complete` | migration `1764400000000_statutory_audit_business_understanding.sql`; contract `statutory-audit-planning-analytics.ts`; `planning-analytics-engine.ts` (pure, unit-tested), `audit-business-understanding.{service,controller}.ts`, `dto/business-understanding.dto.ts`; web `business-understanding-panel.tsx` (mounted on the `engagement_understanding` row) |
| 03.2 still open | ⏳ | Attention parameters + industry profiles are versioned constants in code (`dhvaj-analytics-2026.1`), not yet a methodology-admin library; average-balance day ratios not offered (closing balances only, disclosed in formula); evidence is a text reference, not the SharePoint flow; prior-year prefill of 03.2.1 from an approved PY file not built (no PY portal data yet); Enhanced/IPA notification to a Partner Planning View (§18) |
| 03.3 Materiality — MAT-01/02 context (prefilled from 01/02/03.1/03.2), candidate benchmark cards read live from the 03.2 canonical dataset (CY/PY/movement/volatility, N/M for loss/zero, never ranked), Manager assessment per candidate, normalisation adjustment schedule (Partner Attention auto), comparison table + mandatory guidance disclosure, MAT-03/04 OM (calculated unrounded + methodology-rounded + selected with reasons; outside-guidance override), percentage judgment assistant (two neutral buckets, never scored), MAT-05 PM (aggregation factors, generated rationale draft, PM < OM blocking), MAT-06 specific materiality (monetary + qualitative/no fixed threshold), clearly trivial (concept warning), 03.3.9 qualitative challenge (11 considerations, link existing signal / focus), MAT-07 sensitivity (no pass/fail), §19 Partner Attention triggers, §22 checklist, MAT-08 completion → publishes to the flat `audit_materiality` row, versioned revision v1.0 → v1.1 with baseline + affected-work items (owner/resolve) | ✅ built, live-tested end-to-end (v1.0 complete + v1.1 revision) | migration `1764500000000_statutory_audit_materiality.sql`; contract `statutory-audit-materiality.ts`; `materiality-engine.ts` (pure, unit-tested), `audit-materiality.{service,controller}.ts`, `dto/materiality.dto.ts`; web `materiality-panel.tsx` (mounted on the `materiality` row; old free-form materiality card is now a read-only "Materiality in use" summary and its API is blocked once 03.3 is used) |
| 03.3 still open | ⏳ | **Guidance % ranges are PROVISIONAL placeholders** seeded as Audit Rules Library data (`MAT_*` rules, area `materiality`) — DHVAJ must confirm/replace them (append a new rule version; no admin UI yet); Partner Planning View / notifications for triggers; SharePoint evidence is a text reference; PY materiality is entered manually (no PY portal file); FRF not shown in context; no link yet to the Reassessment module (revision raises its own affected-work items) |
| 03.4 – 03.5 | ⏳ not started | |

**Design decisions taken while building:**
- Signal rules are **derived in code** (like `matters-generation.ts`), not yet a DB rule library. Moving them to `audit_rule*` data is a later step.
- RBAC follows the existing convention: members read, EP/manager leads mutate (RLS). Finer-grained Manager-vs-Partner rights aren't split yet.
- Generate is idempotent (upsert by `rule_key`), never overwrites Manager judgments, never deletes a signal, and only bumps `version` when the source text actually changes.
- Timing/resource considerations are re-derived from the register on generate, on new signals/changes and on each signal assessment; same idempotency rules (keyed by `consideration_key`).
- "Unresolved or conditional" acceptance matters = `audit_matter` rows with `section='acceptance'` and `status <> 'resolved'` (so `accepted_with_approval` counts as conditional).
- AS-02 is stored as an explicit No/Yes (`additional_scope_required`); continuing audits with no PY matters need `prior_year_reviewed` ticked. Initial audits skip the PY check.
- 03.2 analytical findings are Planning Signals with source `analytics` in the SAME register; Investigation Cards are keyed by engine `rule_key`, so re-running never duplicates. A figure change re-snapshots the card and sets `needs_reassessment` on an assessed card; a rule that stops flagging sets `no_longer_flagged` (never deleted).
- 03.2 industry profile only switches analytics/prompts (excluded ratios/rules + suggested considerations) — the data model is identical across profiles.
- 03.3 keeps ONE row per determination version; a completed version is immutable (writes 409) and a revision copies it into the next draft, which supersedes it only when completed. Candidate amounts are never stored except the snapshot of the selected benchmark (source-change detection → "re-confirm", never a silent OM change). Amounts: benchmarks in 03.2 dataset units, OM/PM/CTT/specific in rupees.
- 03.3 methodology numbers (OM % per benchmark, PM % and CTT % of OM, PY-change / volatility / near-break-even attention, rounding step) resolve through `AuditRulesService.buildResolverOn` — the engine has no percentages in code. The version label used is stored on the determination.
- The web page passes EP + Manager into the planning `team` list (they sit on `engagements`, not `engagement_team`), so they can own signals/matters and attend the discussion.

---

## 0. TL;DR

Section 03 (Planning) is a **12-module series** (03.1 … 03.12). These 5 specs define
03.1–03.5. Today the portal models all of Phase 03 as a **shallow checklist** — 16
generic `audit_planning_items` rows (`{item_key, title, state, narrative}`) plus a
flat `audit_materiality` row. **These specs replace that shallow model, for sub-areas
03.1–03.5, with rich decision-support workflows** built on one shared primitive: the
**Planning Signal Register**.

The single most important architectural decision: **build the Planning Signal
Register first as a first-class, engagement-scoped object with ONE register shared by
all sub-modules.** 03.1 creates signals, 03.2 adds analytical signals to the *same*
register, and 03.3/03.4/03.5 *consume* signals. Never create per-module "risk
registers."

The second invariant, repeated in every spec: **a Planning Signal is NOT a risk of
material misstatement.** Attention levels are `Standard / Enhanced / Immediate Partner
Attention` — never Low/Medium/High/Significant Risk. Formal RMM lives in 03.6 / Section 04.

---

## 1. Current codebase state (what already exists)

### Stack & conventions
- **Monorepo:** npm workspaces — `apps/api` (`@hsdg/api`), `apps/web` (`@hsdg/web`),
  `packages/contracts` (`@hsdg/contracts`, shared zod schemas + types), `packages/tsconfig`.
- **API:** NestJS + **raw `pg`** (no ORM) + `zod` + `class-validator` + Swagger.
  Per-area **controller + service** pair. DTOs in `apps/api/src/modules/statutory-audit/dto`.
- **DB:** raw SQL migrations in `db/migrations/*.sql` (timestamp-prefixed, `node-pg-migrate`
  style, up/down). All tables in the `hsdg.` schema. Postgres on **:5433** (docker compose).
  Seeds in `db/seeds/`. Migrate: `npm run db:migrate`.
- **Web:** Next.js (app router) + React Query (`@tanstack/react-query`) + `react-hook-form`
  + Tailwind + `lucide-react`. Azure MSAL auth. Doc editing via `docx`/`mammoth`/`xlsx`
  (+ OnlyOffice via `docker compose up onlyoffice`).
- **Contracts flow:** define zod schema + TS types + permission constants + vocabulary in
  `packages/contracts/src/<area>.ts` → export from `index.ts` → consumed by both api & web.
- **Auth/RBAC:** `PERMISSION` constants in contracts; web guards via `can()` /
  `@/lib/principal`; api guards per controller. Roles map to: Article/Senior,
  Engagement Manager, Engagement Partner, Methodology Admin, Platform Admin.

### How an audit phase renders (the pattern to copy)
- Engagement screen: `apps/web/src/app/(portal)/engagements/[id]/page.tsx` — tabbed;
  the **Work** tab shows an audit-file phase tree and mounts **panel** components.
- Panels live in `apps/web/src/components/statutory-audit/`:
  `framework-panel.tsx`, `planning-panel.tsx`, `risk-panel.tsx`, `audit-area-panel.tsx`,
  `work-areas-panel.tsx`, `pbc-panel.tsx`, `team-panel.tsx`, `completion-panel.tsx`,
  `review-panel.tsx`, `reassessment-panel.tsx`, `audit-file-nav.tsx`.
- API module: `apps/api/src/modules/statutory-audit/` — `statutory-audit.module.ts`
  wires ~20 controller/service pairs. Existing planning:
  `audit-planning.controller.ts` + `audit-planning.service.ts` (463 lines),
  contract `packages/contracts/src/statutory-audit-planning.ts`.

### Existing tables we build ON (do not re-invent)
| Table | Migration | Use for Section 03 |
|---|---|---|
| `hsdg.audit_planning_items` | `1762400000000_statutory_audit_planning_risk.sql` | Existing generic sub-area state (`item_key`,`title`,`state`,`narrative`). Keep as the **phase-level status roll-up**; back each of 03.1–03.5 with richer child tables. |
| `hsdg.audit_materiality` | same | Flat single row (`overall/performance/clearly_trivial/benchmark/basis`). **Too thin for 03.3** — extend / add child tables (see §5.3). |
| `hsdg.audit_planning_approvals` | same | Planning approval snapshots (03.12). |
| `hsdg.audit_risks` | same | Phase 04 / 03.6 RMM — signals must NOT write here. |
| `hsdg.authority_provision` | `1763000000000_authority_provision_library.sql` | **The central Authority/Provision Library** every spec requires. Link SA 300/315/320/330/402/450/501/505/510/520/610/620/299 here; never hard-code URLs in UI. |
| `hsdg.audit_rule` / `audit_rule_version` / `audit_rule_band` / `audit_ruleset_version` | `1763100000000_audit_rules_library.sql` | **Versioned methodology library** — reuse for Planning Signal rules, Analytics rules, Materiality benchmark/percentage guidance, Audit Area Library. Configurable, versioned, effective-dated. |
| `hsdg.audit_matter` | `1763200000000_audit_matters.sql` | **Verify:** likely the "Planning Matter / Action Register." Check if it can also back Planning Signals or if a dedicated `audit_planning_signal` table is needed (recommendation: dedicated table, see §4). |
| Section 01/02 tables | `..._acceptance.sql`, `..._profile.sql`, `..._subassessment.sql`, `..._schedule_iii.sql`, `..._caro.sql`, `..._icfr.sql`, `..._consolidation.sql`, `..._other_reporting.sql`, `..._framework*.sql` | Source of "Engagement Intelligence" facts consumed (read-only) by 03.1/03.4. Corrections route back here, never duplicated. |

### The gap
Sub-areas 03.1–03.5 currently exist only as generic checklist rows with a free-text
`narrative`. The specs demand structured decision-support: signal cards, analytics
engine, benchmark assessment, scope map, area/assertion matrix — each with its own
child tables, methodology-rule config, validations, and versioned snapshots.

---

## 2. Section 03 module map (position of these 5)

| Module | Spec here? | Existing `PLANNING_ITEM_KEY` | Responsibility (no-duplication) |
|---|---|---|---|
| 03.1 Planning Intelligence & Overall Audit Strategy | ✅ | `audit_strategy` | Surface signals, establish high-level strategy. |
| 03.2 Business Understanding & Preliminary Analytics | ✅ | `engagement_understanding` | Business understanding + preliminary analytics; can create signals. |
| 03.3 Materiality | ✅ | `materiality` | Materiality judgments/thresholds. |
| 03.4 Audit Scope & Approach | ✅ | `audit_approach` / `overall_audit_plan` | Scope + preliminary controls/substantive approach. |
| 03.5 Audit Areas & Assertions | ✅ | `areas_and_assertions` | Applicable audit areas + assertions matrix. |
| 03.6 Preliminary Risks & Planned Responses | — | `risk_to_response` | Candidate risks; formal RMM = Section 04. |
| 03.7 Audit Programme | — | `audit_programme` | Planned procedures. |
| 03.8 Team, Resources & Specialists | — | `team_allocation`,`specialist_planning` | People/skills/supervision. |
| 03.9 Component/Branch/Internal Audit Planning | — | `component_planning`,`use_of_internal_audit` | Other auditors / IA reliance. |
| 03.10 PBC & Information Requirements | — | `pbc_strategy` | Client info/doc requirements. |
| 03.11 Timeline, Milestones & Communications | — | `timeline_milestones`,`communication_review_plan` | Actual dates/milestones. |
| 03.12 Planning Challenge, Summary & EP Approval | — | `significant_matters` | Partner challenge, planning memo, approval. |

**No-duplication rule (applies throughout):** 03.1–03.5 may say *why* timing/resource/
component/specialist matters, but **must not** capture detailed *when/who/assignment/
timetable/work scope* — those belong to 03.8/03.9/03.11. Formal EP approval is only 03.12.

---

## 3. Shared foundations to build/extend FIRST

These are cross-module and should be delivered before (or alongside) 03.1.

### 3.1 Planning Signal Register — the spine (see §4)
One engagement-scoped register. First-class object. Created by 03.1, appended by 03.2,
consumed by 03.3/03.4/03.5. Sources: Section 01, Section 02, prior year, 03.1 changes,
03.2 analytics, Manager, Engagement Partner.

### 3.2 Methodology Libraries (reuse `audit_rule*` infra, versioned & effective-dated)
- **Planning Signal Rule Library** — trigger source/condition, observation template,
  "why it may matter", potential implications, suggested destination, suggested attention,
  effective_from/to, active. (Spec 03.1 §8)
- **Analytics Rule Library** — industry profile, required canonical metric IDs, transparent
  formula, configurable *attention parameter* (NEVER a materiality threshold), signal
  wording, effective version. (Spec 03.2 §15, §17 industry profiles)
- **Materiality Methodology Library** — benchmark + percentage *guidance* (labelled
  guidance, never SA-prescribed), CTT guidance, PM guidance, override rules. **Do not
  freeze percentage ranges in code** until DHVAJ approves methodology. (Spec 03.3 §8)
- **Audit Area Library** + **canonical Assertion master** — versioned; complete applicable
  population per engagement profile. (Spec 03.5 §4–7, §15)

> **Hard rule across all libraries:** methodology config lives in versioned data, never
> hard-coded in UI/page logic. Engagement stores the library *version* used; historical
> engagements retain their version; library updates surface a "methodology update
> available" prompt and require controlled refresh — never silent overwrite. There is an
> existing guard test `no-hardcoded-numbers.spec.ts` — respect it.

### 3.3 Authority/Provision Library links
Every "View SA xxx" resolves centrally through `hsdg.authority_provision`
(title, authority, provision_number, effective dates, source_reference, version scope).
No hard-coded external URLs in components. Standards referenced across 03.1–03.5:
SA 299, 300, 315, 320, 330, 402, 450, 501, 505, 510, 520, 610, 620 + ICAI Implementation Guides.

### 3.4 SharePoint / evidence model (global)
All evidence uses the existing global document actions: **Add File / Link Existing File /
Open / Edit in M365 / AutoSave / Version History / controlled revision after approval.**
No routine local download/re-upload. 03.1–03.5 are primarily **structured portal data** —
do NOT generate standalone Word workpapers per module. One consolidated **Audit Planning
Memorandum** is generated later, in **03.12**, from the whole Planning section.

### 3.5 RBAC (consistent across all five)
| Role | Capability |
|---|---|
| Article / Senior | View; enter factual data/evidence/draft; **cannot** conclude/complete the module. |
| Engagement Manager | Assess signals; make judgments; create focus areas/records; **complete** the module. |
| Engagement Partner | View all; add Partner signals/challenge; **no separate approval here** (formal approval = 03.12). |
| Methodology Admin | Maintain libraries/rules; **no** engagement conclusion authority. |
| Platform/Platform Admin | **No** automatic professional/client-data access from technical role alone. |

---

## 4. Planning Signal Register — data model (recommended)

Recommendation: **dedicated `hsdg.audit_planning_signal` table** (verify whether
`audit_matter` should host it instead — but signals have distinct semantics and lineage
needs, so a dedicated table is cleaner). Engagement + workflow_instance scoped.

**`audit_planning_signal`** (first-class record):
- `id`, `workflow_instance_id`, `engagement_id`
- `signal_ref` (human, e.g. `PS-001`)
- `rule_id` + `rule_version` (nullable for manual/Manager/Partner signals) → Signal Rule Library
- `source` enum: `section_01 | section_02 | prior_year | change_03_1 | analytics_03_2 | manager | partner`
- `source_ref` (clickable deep-link to the source assessment/document/metric)
- `observation` (factual statement only), `why_may_matter`, `potential_implications` (suggestions)
- `suggested_attention` enum: `standard | enhanced | immediate_partner`
- `attention` (Manager-adjustable; downgrade from `immediate_partner` requires `attention_rationale`)
- `manager_assessment` enum: `area_of_focus | potential_risk_assess_further | normal_planning | further_information_required | not_relevant`  (`not_relevant` requires rationale)
- `owner_employee_id` (required where further info/action remains)
- `destination[]`: `03.4 | 03.5 | 03.6 | 03.8 | 03.9 | 03.11 | section_04`
- `status` enum: `open | assessed | awaiting_information | carried_forward | closed`
- audit-trail cols + `version`

**`audit_area_of_focus`** (03.1.4 — Manager groups signals):
- `id`, scope ids, `focus_ref` (e.g. `FA-001`), `name`, `why_requires_attention`
- `signal_ids[]` (many-to-one), `potential_fs_areas[]`, `potential_assertions[]` (optional here)
- `expected_strategic_implication`, `partner_attention bool`, `carry_forward[]`, `status`

**`audit_planning_matter`** (Planning Matter / Action Register — verify vs `audit_matter`):
- `matter_ref`, `origin` (signal/focus/discussion), `category`
  (`scope|information|timing|resource|reporting|technology|component|specialist|other`),
  `owner`, `due`, `partner_attention`, `affected_module` (03.2–03.11),
  `status` (`open|in_progress|resolved|carried_forward`), `resolution` (required on closure)

**Dynamic behaviour:** later modules (esp. 03.2) append to this same register; new
Enhanced/Immediate signals notify the Manager/Partner Planning View and may force
reassessment of Areas of Focus / Overall Strategy. After 03.12 approval, changes use
**controlled revision** preserving the approved baseline.

---

## 5. Per-module build specs

> Common to every module: consumes upstream facts read-only (no re-keying); generates a
> structured conclusion the Manager edits (never writes from scratch); uses the shared
> Signal Register; versioned; no silent overwrite; Partner Attention surfaces to a Partner
> Planning View; completion gated by explicit validations + a Manager confirmation question.

### 5.1 — 03.1 Planning Intelligence & Overall Audit Strategy
**Basis:** SA 300 (overall strategy: scope/timing/direction), SA 315 (understanding), +SA 510/402/299 where triggered.
**Landing = "planning control room"** with tiles: Planning Signals · Manager Focus Areas ·
Further Information Required · Partner Attention · Engagement Intelligence · Areas of Focus · Overall Strategy.
**Status flow:** Not Started → Intelligence Generated → Manager Assessment → Strategy Established → Complete. (EP approval NOT here.)

Sub-sections & tables:
- **03.1.1 Engagement Intelligence** — generated read-only panel from Sections 01 & 02.1–02.8
  (initial/continuing audit, framework, Schedule III, CARO, ICFR, CFS/components/other auditors,
  Rule 11/audit trail/s197, etc.). Each fact evaluated against Signal Rules. Corrections route to source.
- **03.1.2 Significant Changes Since PY (`PI-01`)** — selectable change categories (ownership,
  KMP, business model, customers/suppliers, geography, acquisition/disposal, subsidiary/JV,
  borrowings, restructuring, ERP, accounting policies, major contracts, regulatory, litigation,
  related parties, fraud, going concern, other/none). Per change capture **only**: *what changed
  / effective date / source-evidence / potential FR impact known? (Yes/No/Under Assessment)*.
  Do **not** ask the user to identify the audit risk. → creates signals.
- **03.1.3 Planning Signal Engine + Signal Cards** — see §4. Card fields & exact UX per spec §9.
  Attention levels per §10 (never "risk").
- **03.1.4 Manager Areas of Focus** — group signals → `audit_area_of_focus` (§4).
- **03.1.5 Overall Audit Direction** — system Strategy Considerations summary; **`AS-01`**
  orientation: Predominantly Substantive / Combined / Controls reliance selected areas / Not yet
  determinable. Persistent note: "preliminary strategic direction."
- **Scope/Timing/Resource without duplication (§13):** `AS-02` additional scope consideration
  (route corrections to Section 02); strategic timing considerations (Relevant/Not Relevant/Further
  — detail → 03.11); strategic resource considerations (Likely Required/Consider in 03.8/Not
  Required — Not Required needs rationale if Enhanced/Immediate).
- **03.1.6 Prior-Year Intelligence** — surface PY matters; assess Still Relevant/Changed/Resolved/
  Further; can create/link current-year signal; never blindly roll forward. v1 allows controlled
  manual add with SharePoint evidence.
- **03.1.7 Acceptance Matters Carried Forward** — auto-show unresolved Section 01 matters; Create
  Signal / Link to existing / No further implication (reason mandatory).
- **03.1.8 Initial Engagement Team Planning Discussion** — structured (date, participants, signals/
  focus discussed, additional matters, skepticism areas, observations, actions).
- **03.1.9 Strategy Summary** — generated narrative from structured data (editable commentary,
  structured data authoritative). **No separate Word memo** (that's 03.12).
- **Planning Matter/Action Register** — §4.

**Completion criteria (§20):** intelligence reviewed; PI-01 complete; every active signal has
Manager assessment or owner; Immediate Partner Attention surfaced; focus areas established where
appropriate; AS-01 recorded; AS-02 captured/routed; timing/resource assessed & routed; PY matters
reassessed; acceptance matters linked/converted/concluded; team discussion recorded; strategy
summary generated; open matters have owner/status.
**Exclusions (§21):** materiality (03.3), detailed analytics (03.2), detailed scope/approach (03.4),
final areas/assertions (03.5), RMM (03.6/§04), procedures (03.7), staffing (03.8), etc.
**Key acceptance tests (§22):** intelligence auto-generates without re-entry; initial audit →
first-year/opening-balance signal; a signal can never auto-become a significant risk/RMM;
Not Relevant & IPA-downgrade require rationale; multiple signals → one focus area; new 03.2 signals
enter same register; strategy traceable to signals/focus.

### 5.2 — 03.2 Business Understanding & Preliminary Analytics
**Basis:** SA 315 (understanding/inquiries/analytics/observation), SA 520 (analytical procedures —
planning analytics are NOT automatically substantive), SA 300.
**Design:** portal calculates/compares; auditor interprets. A movement/ratio breach = a Signal,
not a risk conclusion. Feeds the **same** Signal Register (no "analytics risk register").

Sub-sections:
- **03.2.1 Business & Operating Model** — prefill stable facts + "has anything changed?" first.
  Fields `BU-01…BU-10` (activities, revenue streams, products, customer/supplier profile, locations
  [consume 02.6], channels, seasonality, significant contracts, PY change [consume 03.1 PI-01]).
- **03.2.2 Ownership, Governance & Management** — consume master/02.6; show changes; significant
  governance/mgmt change → Signal.
- **03.2.3 Industry, Market & Regulatory** — **Industry Analytics Profile** activates relevant
  KPIs/prompts (generic fallback otherwise).
- **03.2.4 Accounting, Systems & Process Environment** — finance org, ERP/systems, interfaces,
  service orgs (consume §02), transaction cycles, close process. System/process change → Signal.
  (Detailed controls testing = Section 05, not here.)
- **03.2.5 Objectives, Strategy & Business Risks** — only to extent relevant to FR; can generate Signal.
- **03.2.6 Performance Measures & Management Monitoring** — budgets, KPIs, board packs, covenants.
- **03.2.7 Focused Financial Dataset (v1)** — **NO Trial Balance / ledger import in v1.** Manual
  entry, every figure records source. Header: period end/currency/units/CY source/PY source/
  draft-final-mgmt/source date/prepared by. Canonical metrics (Revenue, other income, GP, EBITDA/
  op profit, PBT, PAT, total assets, net worth, cash, receivables, inventory, payables, borrowings,
  current assets/liabilities, PPE, investments, employee cost, finance cost, RP balances) + custom.
  Each value: metric ID, period, amount, unit, source, status, note. **Design canonical fields so a
  future TB module populates the same fields without redesigning analytics.**
- **03.2.8 Preliminary Analytical Review** — engine calculates only where inputs valid & denominators
  meaningful; **display formula + underlying values.** Movements (abs, % — PY=0 → `N/M`), margins
  (GP/PBT/PAT), receivable/inventory/payable days (inventory/payable days must use cost/purchases
  denominator, **never Revenue silently**), current ratio, D/E (show definition), finance-cost
  relationship, employee-cost ratio, working-capital. **No hard-coded "20% = risk"** — attention
  parameters are methodology-configurable, used only to surface exceptions.
- **Relationship analytics (§13)** — revenue vs receivables/inventory/employee cost/cash-PAT,
  borrowings vs finance cost, margin trend, liquidity, RP. Show actual values; never conclude misstatement.
- **Expectation vs Actual (§14)** — optional planning expectations; if later used as substantive AP,
  must separately satisfy SA 520.
- **03.2.9 Investigation of Analytical Exceptions** — every flagged exception opens an **Investigation
  Card** (observation, why flagged, management explanation [who/date], evidence, auditor assessment
  [reasonable/partially/not supported/further info/not relevant], affected areas, create Signal Y/N
  [No for Enhanced/Immediate needs rationale], owner/due, cross-ref). **Management explanation alone
  does not auto-close.**
- **03.2.10 Understanding & Analytics Conclusion** — generated block; **`BA-01`** Manager conclusion
  (Yes-Complete / No-Further Work). `BA-01` cannot complete while an Enhanced/Immediate exception is
  unassessed & ownerless.

**Data-quality controls (§21):** require period/currency/unit before figures; warn on unit/period
mismatch; PY=0 → N/M; handle negative denominators; no ratio without meaningful denominator; flag
draft/unaudited; store preparer/timestamp/source; source change recalculates & reopens affected
investigations/signals; never silently overwrite rolled-forward approved PY values.
**Key acceptance tests (§24):** analytics work without TB; no threshold labelled materiality/
misstatement/risk; days-ratios never silently use Revenue; industry profile changes available
analytics without changing core data model; same Signal object as 03.1.

### 5.3 — 03.3 Materiality
**Basis:** SA 320 (materiality = professional judgment; size/nature; users as a group), SA 450
(clearly trivial + misstatement accumulation).
**Non-negotiable:** no amount/benchmark/percentage is an automatic conclusion. Not a "percentage
calculator." **Extend the thin `audit_materiality` table** with child tables + versioning.

Sub-sections `03.3.1…03.3.12`:
- **Context** — prefill from 01/02/03.2 (no re-key). `MAT-01` principal users; `MAT-02` measures of user focus.
- **Benchmark Assessment** — candidate benchmark cards from 03.2 metrics (PBT/revenue/total assets/
  net assets/expenditure); show CY/PY/trend + volatility; **do not rank a "best" benchmark**; Manager
  status (Suitable/Potentially/Not/Normalised Required) + rationale.
- **Normalised/Alternative Benchmark** — only via a **controlled adjustment schedule** (repeatable
  lines: description/±amount/reason/recurring?/evidence); never overwrite source metric; "why more
  representative" mandatory; **Partner Attention auto-Yes**; versioned.
- **Benchmark Comparison** — side-by-side sensitivity table; any % shown = **DHVAJ methodology
  guidance, not SA-prescribed** (mandatory UI disclosure).
- **Overall Materiality (`MAT-03`,`MAT-04`)** — selected benchmark + amount (traceable) + selected %
  → calculated OM; selected OM may differ (reason mandatory); Partner Attention auto if outside
  methodology/unusual benchmark. `MAT-04` reasonableness.
- **Percentage Judgment Assistant** — show factor buckets ("factors considered" / "other
  considerations"); **never** convert to a numeric score or auto-select %.
- **Performance Materiality (`MAT-05`)** — must be **< OM** (blocking validation if PM ≥ OM);
  aggregation-risk considerations from prior differences/control deficiencies/initial audit/changes/
  estimates/components/fraud.
- **Specific Materiality (`MAT-06`)** — lower materiality for sensitive classes/balances/disclosures;
  supports monetary AND qualitative/no-fixed-threshold; reason mandatory.
- **Clearly Trivial Threshold** — **explicitly distinguished from "not material"**; supports SA 450
  accumulation; never auto-write-off; publishes to Misstatement Register (Completion).
- **Qualitative Materiality Challenge** — forced nature/circumstance challenge (fraud, RP, KMP,
  law/regulation, covenants, profit↔loss flips, remuneration thresholds, sensitive disclosures,
  policy, segments, etc.); reuse existing Signal/Focus rather than duplicate.
- **Sensitivity & Reasonableness (`MAT-07`)** — cross-checks vs revenue/PBT/normalised PBT/assets/
  net assets, change from PY OM, PM/OM, CTT/OM; **no automatic pass/fail**.
- **Materiality Impact Preview** — publish OM/specific/CTT + version to 03.4/03.5/03.6/03.7/execution/
  Section 07/completion. **Never use OM alone to auto-exclude an audit area.**
- **Revision During Audit** — **new version, never overwrite** approved determination; if OM/PM
  decreases → flag affected sampling/scoping/substantive/analytics/misstatement work; if increases →
  do not auto-reduce work done.
- **Conclusion (`MAT-08`)** — generated block + Manager conclusion.

**Partner Attention triggers (§19):** normalised benchmark, unusual/Other benchmark, %/amount outside
guidance, big PY change, volatile/loss benchmark, multiple/unusual specific thresholds, significant
qualitative matter, mid-audit revision, override of an IPA prompt.
**Data-model controls (§20):** consume 03.2 metric IDs (no duplicate financial master); inherit
units/currency & prevent mixed-unit calc; loss/zero → N/M; store unrounded + display rounded; store
calculated+selected+reason+user+time; store methodology version; recalc on source change but never
silently change approved OM.

### 5.4 — 03.4 Audit Scope & Approach
**Basis:** SA 300 primary; triggered SA 330/402/501/505/510/610/620.
**Core question:** given characteristics/available info/materiality/planning, how do we obtain
sufficient appropriate audit evidence? **Strategic** only — assertions=03.5, risks=03.6,
procedures=03.7, resources=03.8, component exec=03.9, dates=03.11.

Sub-sections `03.4.1…03.4.11`:
- **Scope Intelligence** — read-only panel from 02.x + 03.1/03.2/03.3 (standalone/CFS, group,
  branches/components, other auditors, joint audit, initial audit, service org, ICFR, CARO, audit
  trail/s197, FRF/Sch III, materiality, signals/focus). Landing cards: Scope Units · Material/
  Qualitatively Relevant Units · Other Auditors · Special Scope Considerations · Open Dependencies ·
  Potential Scope Limitations · Partner Attention.
- **FS Scope (`SC-01`,`SC-02`)** — standalone/CFS/both/other; read-only period/FRF; confirm or route
  correction to Section 02.
- **Audit Population (`SC-03`)** — generate from known entities/components/branches/locations/service
  orgs (no TB import; use 02/03.2 facts + manual unit indicators). Per unit: type, location, financial
  relevance (amount+source), qualitative relevance, auditor (DHVAJ/component/branch/joint), scope
  conclusion (In Scope / Limited / Not Separately Scoped / Further / N-A), rationale for exclusions.
  **No unit auto-excluded solely because a balance < OM.**
- **Overall Approach (`AP-01`)** — Predominantly Substantive / Combined / Controls Reliance selected
  areas / Mixed by area / **Not Yet Determinable** (must remain available).
- **Controls Reliance Strategy** — per major cycle: Reliance Contemplated / No Reliance Currently
  Planned / Further Assessment → Section 05. **Planned reliance ≠ actual reliance**; never label
  controls effective here.
- **Interim/Year-End Strategy** — strategic timing pattern per area (Interim/YE/Both/TBD) + roll-forward
  need; **no calendar dates** (that's 03.11).
- **Evidence Strategy** — channel-level expectations (records, confirmations, physical, recalculation,
  analytics, IPE, external info, mgmt/auditor expert, component/branch auditor, internal audit, service
  org evidence, CAATs). `EC-01` external confirmations. Physical/inventory attendance (SA 501 trigger).
- **Triggered special cards:** Initial audit/Opening balances (`OB-01`, SA 510 — auto-activate from 02.1;
  blocking if unaddressed), Service Organisation (`SO-01`, SA 402), Internal Audit (`IA-01`, SA 610),
  Experts/Specialists (route to 03.8), Other Auditor/Component (route detail to 03.9), Technology/Data
  (`DT-01`).
- **Scope Dependency Register** + **Potential Scope Limitation (`SL-01`)** — limitations always
  Immediate Partner Attention + open Planning Matter; do NOT pre-judge report modification.
- **Preliminary Audit Approach Map (§23)** — the principal output; per preliminary area: materiality
  relevance, linked signals/focus, controls strategy, timing, evidence channels, special consideration,
  destination. Convert/refine in 03.5 (not duplicate).
- **Consistency Checks (§24)** — blocking rules: initial audit+no OB strategy; material inventory+no
  attendance/alternative; service org+no SA 402; other/component auditor+no conclusion; Section 05 later
  contradicts planned reliance → **Reassessment Required** (not silent change); scope limitation → IPA;
  materiality revision → affected map items Reassessment Required.
- **Conclusion (`AP-02`)** + **Partner Planning View** (Agree/Challenge/Request/Add Partner Signal → feed 03.12).

### 5.5 — 03.5 Audit Areas & Assertions
**Status: FROZEN FOR DEVELOPMENT.** Implement values/labels/validations/IDs **exactly** as written.
**Basis:** SA 315 assertion taxonomy. **No RMM, no procedures, no TB in v1.**
**Primary output:** the **Audit Area & Assertion Matrix** (structured data consumable by 03.6).

Frozen behaviour:
- On first creation, **populate every active area from the applicable Audit Area Library**; default
  disposition **Retained**. Manager reviews complete population, removes, adds, reviews suggested
  assertions, completes. No per-area applicability questionnaire.
- **Applicable library** = by FRF (AS/Ind AS) + entity/industry profile + CFS (adds Consolidation) +
  initial audit (adds Opening Balances). Store the library version with the engagement; never change
  retrospectively without controlled refresh.
- **Section status:** Not Started / In Progress / Requires Review / Complete / Update Required.

Data model:
- **`audit_area_library`** (versioned master; §6 fields: `audit_area_id`, `area_code`, `area_name`,
  `area_type` [Balance Sheet/P&L/Disclosure/Cross-cutting], `framework_profile`, `industry_profile`,
  `default_assertions[]`, `default_attention`, `related_authorities[]`, `signal_mapping_tags[]`,
  `aliases[]`, `effective_from/to`, `active`, `library_version`). **Seed the initial General Corporate
  list from §7 into versioned data — do NOT hard-code in page logic.**
- **`audit_assertion`** master (§15 canonical IDs — implement exactly):
  `TX_OCC, TX_COMP, TX_ACC, TX_CUTOFF, TX_CLASS` (transactions);
  `BAL_EXIST, BAL_RO, BAL_COMP, BAL_VAL` (balances);
  `PD_OCC_RO, PD_COMP, PD_CLASS_UND, PD_ACC_VAL` (presentation/disclosure).
  **Downstream links to assertion IDs, never free text.**
- **`engagement_audit_area`** (§8) — `source` (Library/Custom), `source_audit_area_id`, snapshot
  name/type, `disposition` (Retained/Removed), `attention` (Standard/Enhanced/Requires Review),
  `removal_reason_code` + text, `covered_under_area_id`, optional `cy_amount/py_amount/currency/unit/
  amount_source`, audit-trail.
- **`engagement_area_assertion`** — active assertions per area, per-assertion attention (Standard/
  Enhanced), user-added/removed w/ reason, audit-trail.
- **`engagement_area_signal_link`** — many-to-many area ↔ Planning Signal.

Behaviour:
- **Remove** (§9.1) reason codes: `NO_BALANCE_ACTIVITY`, `NOT_APPLICABLE`, `COVERED_ELSEWHERE`
  (must select another retained area; self-select prohibited), `NOT_SEPARATELY_SCOPED` (rationale),
  `OTHER` (rationale). Removal never deletes; blocked if downstream work exists (resolve first). **Restore** (§9.2).
- **Intelligent removal warnings** (§10) — contextual challenge only, never auto-restore/override.
- **Add Audit Area** (§11): From DHVAJ Library (preserve ID/version; offer Restore if present) or
  Custom (name/type/reason; engagement-only; not added to master).
- **Attention model** (§14): Standard / Enhanced Attention / Requires Review only. **No Low/Med/High/
  Significant Risk anywhere.**
- **Assertions** (§16–17): retained area preselects defaults; keep/add/remove(reason)/restore; a
  retained area must have **≥1 active assertion**; assertion-level Enhanced Attention suggestions
  (revenue→Occurrence/Cut-off, receivables→Valuation, etc.); downgrade needs reason.
- **Prior-year** (§20): always start from current library; show Prior-Year indicator/context; fresh
  current-year decisions; no risk carry-forward.

**Validations `VAL-01…VAL-10` (§21) — gate completion:** all areas resolved; removal reasons complete;
≥1 assertion per retained; every active specific-materiality matter maps to ≥1 retained area; every
unresolved Enhanced/Immediate signal maps to ≥1 area or has documented "no mapping required"; CFS →
Consolidation not removed unresolved; initial audit → Opening Balances not removed unresolved;
significant-indicator removal documented; no Requires Review remaining; Covered-Elsewhere points to a
retained area.
**`AA-01` completion** — exact confirmation text (§22). Enabled only when VAL-01…10 pass; store
confirmer/timestamp/section version/matrix snapshot.
**Matrix output (§23)** — columns: Audit Area / CY / PY / Attention / Relevant Assertions (Enhanced
marked) / Planning Signals. **Structured data, not just a report.**
**Impact rules (§25)** — materiality-down/new specific/new Enhanced signal/CFS change/initial-audit
correction/new area → mark **Update Required**, never silent change; version the matrix on re-completion.
**Acceptance tests `AT-01…AT-20` (§30)** — implement all; notably: idempotent population, no duplicate
on reopen, all works without TB, downstream 03.6 reads only retained areas + active assertions.

---

## 6. Cross-cutting invariants (apply to ALL five)

1. **Signal ≠ risk.** Attention = Standard/Enhanced/Immediate Partner. Never Low/Med/High/Significant
   Risk. RMM = 03.6 / Section 04.
2. **One Planning Signal Register**, shared. No per-module risk registers.
3. **No TB / ledger import in v1.** Manual financial dataset with sources; canonical fields future-proofed for a TB module.
4. **No re-keying.** Consume Section 01/02/03.x facts read-only; corrections route to the source section.
5. **Methodology in versioned data, not code.** Store the version per engagement; surface "update
   available"; controlled refresh. Respect `no-hardcoded-numbers.spec.ts`.
6. **No silent overwrites.** Post-completion/approval changes create a new version and flag downstream
   Reassessment/Update Required, preserving the approved baseline + audit trail.
7. **Rationale gates:** Not Relevant, IPA downgrade, methodology override, Enhanced-assertion downgrade,
   significant-indicator removal — all require documented reason.
8. **Structured-data-first; generated conclusions.** Manager edits commentary; structured data is
   authoritative. **No standalone Word workpapers per module** — one Planning Memorandum in 03.12.
9. **Authority links centralised** in `authority_provision`; no hard-coded URLs in UI.
10. **SharePoint evidence** via global Add/Link/Open/Edit/AutoSave/Version History; no download/re-upload.
11. **Full audit trail** on every professional-judgment change (who/when/old→new/reason/version).
12. **RBAC** per §3.5; Platform Admin gets no professional/client data by technical role.

---

## 7. Suggested build order

1. **Foundations** — Planning Signal Register (`audit_planning_signal`, `audit_area_of_focus`,
   `audit_planning_matter`) + confirm/extend `audit_matter` reuse; wire Signal Rule / Analytics /
   Materiality / Audit-Area methodology libraries onto the existing `audit_rule*` infra; Authority-link
   helper; Partner Planning View shell. Contracts + migrations + seed loaders.
2. **03.1** — Engagement Intelligence generator + PI-01 + Signal Engine/Cards + Areas of Focus + AS-01/
   AS-02 + PY/acceptance carry-forward + team discussion + strategy summary.
3. **03.2** — Focused Financial Dataset (canonical metrics) + Analytics Engine + Relationship analytics
   + Investigation Cards + Industry Profiles + BA-01. (Feeds signals into the 03.1 register.)
4. **03.3** — Extend `audit_materiality` + benchmark/normalisation/OM/PM/specific/CTT/qualitative/
   sensitivity/revision + Materiality Impact Preview publish. Consume 03.2 metrics.
5. **03.4** — Scope Intelligence + Population + approach/controls/timing/evidence + triggered cards +
   dependency/limitation registers + Preliminary Approach Map + consistency checks.
6. **03.5** — Audit Area Library + assertion master (seed) + population/retain/remove/add + assertions +
   VAL-01…10 + AA-01 + versioned Matrix + impact rules. (FROZEN — build exactly.)
7. **Wire-up** — each module updates its `audit_planning_items` roll-up state; downstream consumers
   (03.6+) read the Matrix + register.

Each module: migration(s) → `packages/contracts/src/statutory-audit-<mod>.ts` (+ export in index) →
`apps/api/.../audit-<mod>.controller.ts` + `.service.ts` (register in `statutory-audit.module.ts`) →
`apps/web/src/components/statutory-audit/<mod>-panel.tsx` (mount in engagement Work tab) → spec tests.

---

## 8. Open questions to confirm before/while building

1. **`audit_matter` vs new `audit_planning_signal`** — does the existing `audit_matter` table already
   model Planning Signals, or only the Matter/Action register? (Read
   `db/migrations/1763200000000_audit_matters.sql` + `audit-matters.service.ts`.) Recommendation:
   dedicated signal table; reuse `audit_matter` for the Action Register.
2. **Existing `audit-planning.service.ts` (463 lines)** — how much of 03.1/03.4 strategy is already
   there? Confirm we extend rather than replace the sub-area state model.
3. **Existing `audit-risk.service.ts` / `audit_risks`** — confirm boundary so signals never write RMM.
4. **Materiality:** extend `audit_materiality` in place vs. new child tables + keep the flat row as a
   denormalised summary. (Recommend child tables + versioning; flat row = current-version cache.)
5. **Methodology library seeding** — who supplies the DHVAJ percentage/benchmark ranges? Spec 03.3 says
   **do not freeze % in code** until DHVAJ approves — keep them as admin-editable seed data.
6. **Industry Analytics Profiles** (03.2) & **Audit Area Library** (03.5) initial seed content — 03.5 §7
   gives the General Corporate baseline to seed; confirm Ind AS / industry additions.
7. **Partner Planning View** — is there an existing partner/review surface to extend, or new?

---

### Appendix — quick file/path reference
- Engagement screen / Work tab: `apps/web/src/app/(portal)/engagements/[id]/page.tsx`
- Panels: `apps/web/src/components/statutory-audit/*-panel.tsx`
- API module: `apps/api/src/modules/statutory-audit/` (controller+service pairs, `dto/`, `statutory-audit.module.ts`)
- Contracts: `packages/contracts/src/statutory-audit-*.ts` (export via `index.ts`)
- Migrations: `db/migrations/*.sql` (schema `hsdg.`); seeds: `db/seeds/`
- Existing planning schema: `db/migrations/1762400000000_statutory_audit_planning_risk.sql`
- Authority library: `db/migrations/1763000000000_authority_provision_library.sql`
- Methodology/rules: `db/migrations/1763100000000_audit_rules_library.sql`
- Matters: `db/migrations/1763200000000_audit_matters.sql`
- Guard test: `apps/api/src/modules/statutory-audit/no-hardcoded-numbers.spec.ts`
