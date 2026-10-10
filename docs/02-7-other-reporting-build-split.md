# 02.7 Other Companies Act & Statutory Reporting — build split (two sessions, 50/50)

Spec: `DHVAJ_Section_02_7_Other_Companies_Act_Statutory_Reporting_Developer_Specification.docx` v1.0 (§1–§22).
Base: `origin/main` c6b5878. Integration branch: **`feat/02-7-reporting`** (Track A,
worktree `.claude/worktrees/02-2-framework`). Track B works on **`feat/02-7-records`**,
branched from `feat/02-7-reporting` @ the interface commit, and merged by A at the end;
A then verifies everything (migrations up/down/up, API unit, full e2e on a scratch DB,
web jest, tsc, lint, next build), runs the gap/optimisation pass with B, and pushes to
`main` (user-approved for this build, both sessions' work).

## Gap check summary (what exists on c6b5878)

- Pure engine `other-reporting.ts` (11(g) per system with 2 booleans; §197 single 11%
  ceiling; Schedule V only at profit <= 0; fraud ₹1cr route + 45/15 days from the event
  date; 11(e)/(f) flags), `audit-other-reporting.service/controller` (facts /
  fill-from-master / run / decision; shared `audit_framework_subassessment`,
  `sub_section_key '02.7'`, `area_key 'other_regulatory'`), migration 1764000000000
  (MGMT_REMUN_LIMIT 11, FRAUD_CG_THRESHOLD 1cr, FRAUD_BOARD_REPLY_DAYS 45,
  FRAUD_CG_FORWARD_DAYS 15, AUDIT_TRAIL_RETENTION 8).
- Web: only an "audit trail ran all year" checkbox list in `reporting-facts-card.tsx`.
- Legacy Phase-02 `rule_11` / `section_143` rows say "company → applies"; NOT mirrored.
- Provisions present: 143(3), 143(3)(i), 143(8), 143(12), 164(2), 197, 197(16), 198,
  SCH_V, AUDIT_RULE_11, AUDIT_RULE_11G, AUDIT_RULE_13.

## Track A — matrix, Rule 11, audit trail, remuneration, conclusion (session "dhvaj entity regulatory profile")

Owns `packages/contracts/src/statutory-audit-other-reporting.ts`, `other-reporting.ts`
(engine), new `other-reporting-completion.ts`, `other-reporting-read.ts`,
`audit-other-reporting.service/controller`, `dto/other-reporting.dto.ts`,
`framework-suggestions.ts` (rule_11 / section_143 branch), `audit-framework.service.ts`
(rule_11 / section_143 mirror), `framework-facts-prefill.ts` (other reporting),
`audit-rollforward.service.ts` (02.7 lines), `reporting-facts-card.tsx` (Other
reporting block), new web `other-reporting-workspace.tsx`, `other-reporting-matrix.tsx`,
`other-reporting-rule11.tsx`, `other-reporting-audit-trail.tsx`,
`other-reporting-remuneration.tsx`.
Migrations **1767700000000 – 1767749999999**.

- §2/§19 rules: REM_ONE_MDWTD_MANAGER 5, REM_MULTI_MDWTD_MANAGER 10,
  REM_NONEXEC_WITH_MGMT 1, REM_NONEXEC_WITHOUT_MGMT 3, FRAUD_INITIAL_NOTICE_DAYS 2,
  AUDIT_TRAIL_EFFECTIVE_DATE (version effective 2023-04-01); new child table
  `hsdg.schedule_v_band` (versioned effective-capital bands + ceilings).
- §3 landing screen: status (Complete / Attention Required / Pending Facts), panels.
- §4 Section 143(3) core matrix — one card per item (a)…(j) incl. (h); applicability
  from facts + B's director status, 02.6 branches, 02.5 ICFR.
- §5–§10 Rule 11 cards: R11-01 litigation, R11-02 foreseeable losses, R11-03 IEPF,
  Rule 11(e) two mirrored assessments, R11-04 dividend / §123. Each card: Requirement,
  Applicability, Source Workpaper, Evidence (B count), Exception, Proposed Reporting
  Conclusion, Review Status — card work state in new table `hsdg.audit_reporting_card`
  (editable after 02.7 approval: cards may stay Work Pending, §20).
- §11 Rule 11(g) register (all 11 fields per system), period gate by rule, retention
  from rule data, ICFR / books cross-link without copying conclusions.
- §13 §197(16): REM-01 public company from 02.1 `companyType` (fallback entity type);
  persons by category, Section 198 net profit, 11/5/10/1/3 only in the relevant
  category, approvals, Schedule V bands on no / inadequate profit.
- §17 final statutory reporting matrix (data), §16 card UX.
- §3/§20 conclusion Confirm / Override (reason + technical basis + evidence) /
  Information Pending; EP approval of a significant override; §20 completion + 02.7
  COMPLETE; legacy rule_11 / section_143 mirror; roll-forward.

### Interface A → B (committed)

Contracts (`statutory-audit-other-reporting.ts`): `REPORTING_CARD` keys,
`ReportingCardKey`, `OTHER_REPORTING_PROVISION_CODE`, `OTHER_REPORTING_REFERENCE_CONTEXT
= '02.7'`, `OTHER_REPORTING_REFERENCE_ANCHOR`, `OTHER_REPORTING_RULE_CODE`, and the status
types B fills: `FraudFrameworkStatus`, `DirectorDisqualificationStatus`,
`ReportingCrossRefs`, `ReportingEvidenceCounts` (+ `EMPTY_*`).

DI-free (A): `other-reporting-read.ts` `readOtherReportingResultOn(client, wfId)` →
`{ state, conclusion, systemOutcome, decided, cards: ReportingCard[], needsReevaluation }`
for B's work programme / completion / Section 08 hooks.

## Track B — fraud, directors, cross-references, provisions, evidence, downstream (session "DHVAJ portal features assessment")

Owns new `packages/contracts/src/statutory-audit-reporting-records.ts` (imports from
statutory-audit-other-reporting; never re-exports the same names), new
`fraud-matters.ts` engine, `audit-reporting-records.service/controller`,
`dto/reporting-records.dto.ts`, `other-reporting-records-read.ts` (replace A's
placeholder), `work-automation.ts` / `work-generation.ts` (02.7 items),
`completion-automation.ts` (rule_11_143 from 02.7), Section 07 MRL hook, web
`other-reporting-fraud.tsx`, `other-reporting-directors.tsx`,
`other-reporting-cross-refs.tsx`, `other-reporting-evidence.tsx` (replace placeholders).
Migrations **1767750000000 – 1767799999999**.

- §14 Fraud Matter records (one central record, raisable from anywhere in the audit):
  nature, amount / estimated amount, officers / employees / parties, date knowledge
  obtained, source, audit procedures, management / TCWG communication, threshold
  result (FRAUD_CG_THRESHOLD by audit period, `>=`), reporting route, deadlines,
  Partner consultation, evidence, regulatory status, final conclusion. Deadline engine
  from the LEGALLY relevant event dates: knowledge + FRAUD_INITIAL_NOTICE_DAYS (2) →
  report to Board/AC; report date + FRAUD_BOARD_REPLY_DAYS (45) → reply due; reply
  RECEIVED + FRAUD_CG_FORWARD_DAYS (15) → forward to CG; no reply by the due date →
  forward with the Rule 13 note. ADT-4 reference. Migrate the legacy single
  `fraudIdentified / fraudAmount / fraudEventDate` facts into a first matter on open.
  `fraudFrameworkStatusOn(client, wfId, auditPeriodStart)` for A.
- §12 Section 164(2) director workpaper: director name / DIN, appointment period,
  directorship info + evidence, management representation link, MCA / statutory
  evidence link, disqualification Yes / No / Pending, auditor conclusion + legal
  analysis (no DIN-status shortcut); fill from the contacts-master directors.
  `directorDisqualificationStatusOn(client, wfId)` feeds A's 143(3)(g) card.
- §15 / §17 cross-references: `reportingCrossRefsOn(client, wfId)` from 02.4 (CARO
  conclusion + clause status), 02.5 (ICFR result / 143(3)(i)), 02.6 (CFS conclusion,
  BR-01 + `audit_group_branch`: auditors, reports dealt with) — no second register;
  web panel with deep links to the source workspaces.
- §18 provisions: seed COS_ACT_128_5, COS_ACT_123, COS_ACT_124_125 (IEPF), COS_ACT_196,
  FORM_ADT_4, ICAI_IG_RULE_11 (11(e)/(f) guide), ICAI_IG_AUDIT_TRAIL (Revised 2024),
  ICAI_ADVISORY_197_16; `authority_reference_link` context '02.7' for every
  `OTHER_REPORTING_REFERENCE_ANCHOR` (A's cards render them with `FrameworkReferences`).
- §16 per-card evidence: link / unlink engagement documents per `ReportingCardKey`
  (table + API + `ReportingCardEvidence` component); `reportingEvidenceCountsOn`.
- Downstream: Section 06 work items per applicable 02.7 card (replace the single
  auditor's-reporting workstream entry), completion-automation `rule_11_143` reads
  `readOtherReportingResultOn`, Rule 11(e) representations → Section 07 MRL.

### Interface B → A

- `other-reporting-records-read.ts` (DI-free): the four functions above (A committed
  placeholders returning `EMPTY_*`).
- Web components A mounts in `OtherReportingWorkspace`:
  `<OtherReportingFraud engagementId workflowInstanceId canManage />`,
  `<OtherReportingDirectors … />`, `<OtherReportingCrossRefs … />`,
  `<ReportingCardEvidence engagementId workflowInstanceId cardKey canManage />` (per card).

## Rules

- B never pushes `main`; A merges B, verifies and pushes `main` at the end.
- Until A's API commit lands, `tsc` errors in A's `other-reporting.ts` /
  `audit-other-reporting.service.ts` / their specs are expected — B must not edit them.
- e2e: point **all three** DB URLs (DATABASE_URL, DATABASE_SUPERUSER_URL,
  DATABASE_MIGRATE_URL) at a scratch DB **inline in the same command** — global setup
  drops schema `hsdg`. Never run e2e against the dev DB `hsdg`.
- FORCE-RLS library tables (`audit_rule*`, `authority_provision`,
  `authority_reference_link`, `document_templates`): wrap seeds in NO FORCE / FORCE;
  provision seeds after 1767150000000 need `ON CONFLICT (code) WHERE effective_to IS NULL`.
- Never import a service file into a `*-read.ts` helper (ESM cycle breaks Nest DI).
- Inline expand (+/−) under the row, never modals.
