# 02.6 Consolidation / Group Audit Framework — build split (two sessions, 50/50)

Spec: `DHVAJ_Section_02_6_Consolidation_Group_Audit_Framework_Developer_Specification.docx` v1.0 (§1–§26).
Base: `origin/main` 15eeb63. Integration branch: **`feat/02-6-consolidation`** (Track A).
Track B works on **`feat/02-6-group-audit`**, branched from `feat/02-6-consolidation` @ the
interface commit, and merged by A at the end; A then verifies everything (migrations
up/down/up, API unit, full e2e on a scratch DB, web jest, tsc, lint, next build), runs
the gap/optimisation pass with B, and pushes to `main` (user-approved for this build).

## Gap check summary (what exists)

- Pure engine `consolidation.ts` (CFS-01 §129(3) trigger + Rule 6 cumulative, rules
  `CFS_CONTROL_OWNERSHIP` > 50 / `CFS_SIGNIFICANT_INFLUENCE` >= 20 in 1763900000000),
  `audit-consolidation.service/controller` (facts / fill-from-master / run / decision;
  shared `audit_framework_subassessment`, `sub_section_key '02.6'`, `area_key 'cfs'`).
- 02.4 3(xxi) and 02.5 consolidated components already sync from
  `system_detail.perimeter` (by name, relationship subsidiary/associate/joint_venture).
- Web: only the "Consolidation" block in `group-caro-card.tsx` (suggestion + parent-CFS select).
- Legacy Phase-02 'cfs' row (`framework-suggestions.ts`) runs an OLD simple rule and is
  NOT mirrored to 02.6 (CARO / ICFR are).
- Missing: everything in Part B, CFS-03/04, rich relationship record, Rule 6 evidence,
  perimeter fields, CFS-05 EP approval + summary, §24 completion, §2(6), memo, UI.

## Track A — Part A: CFS applicability & perimeter, end to end (session "dhvaj entity regulatory profile")

Owns `packages/contracts/src/statutory-audit-consolidation.ts`, `consolidation.ts`,
new `consolidation-completion.ts`, `consolidation-read.ts`,
`audit-consolidation.service/controller`, `dto/consolidation.dto.ts`,
`framework-suggestions.ts` (cfs branch), `audit-framework.service.ts` (cfs mirror),
`audit-rollforward.service.ts` (02.6 change indicators), `framework-facts-prefill.ts`
(consolidation), `group-caro-card.tsx` (Consolidation block), new
`consolidation-workspace.tsx` + `consolidation-perimeter.tsx`.
Migrations **1767600000000 – 1767649999999**.

- §5 Relationship assessment per related entity: stable `id`, suggested relationship
  (Subsidiary / Associate / JV / Other), ownership % direct + indirect, voting % direct +
  indirect, board-composition rights (Yes/No/details), contractual rights (key terms +
  evidence), control / significant influence / joint control conclusions each
  Yes / No / Further assessment, effective from/to, country, Indian company, evidence,
  View authority. Percentages are rule inputs; AS 21 control = > 50% VOTING POWER or
  board-composition control; Ind AS 110 never a bare % test; 20% rebuttable both ways;
  joint control only from a contractual arrangement.
- §6 CFS-01 Required / Not Required / Further Assessment Required with facts + rules used.
- §7 CFS-02 Rule 6 condition-by-condition (Satisfied / Failed / Pending each) with
  evidence: ownership; other members — written intimation, proof of delivery, objection
  status (silence ≠ consent unless the rule says so); listing (from 02.1 listings);
  parent filing — parent name, SRN, filed date, evidence.
- §8 perimeter: included Yes/No/Pending + reason, method proposed from the framework
  (§9 routing), reporting date, local framework, group framework (02.2), component
  auditor column = Track B's matrix value.
- §10 CFS-03 reporting date per component (Yes/No; date, reason, interim info,
  significant intervening transactions) + max gap from the Rules Library
  (`CFS_REPORTING_DATE_GAP` AS 21 / Ind AS 110 versions, shown with the standard version).
- §11 CFS-04 Aligned / Conversion Required / Further Assessment per component +
  conversion work item (reporting package file, GAAP/policy differences list, conversion
  adjustments links, reviewer, final adjusted group TB link); statutory accounts untouched.
- §21 roll forward: new/acquired, disposed (history kept), ownership/voting change,
  reporting date / framework change → reassess flags; stable data → System Suggested.
- §22 CFS-05 Confirm / Override (reason + technical basis + evidence) / Information
  Pending; EP approval for significant override / control or perimeter dispute; system
  conclusion preserved; summary (CFS required, counts by relationship, DHVAJ vs other
  components, branch auditors, pending reports, framework, workstream — from B's status).
- §24 completion checklist + 02.6 COMPLETE (reads B's `groupAuditStatusOn`).
- Legacy Phase-02 'cfs' row mirrors 02.6 (suggestion + conclusion), like CARO / ICFR.
- §18 hand-off: `readConsolidationResultOn` gives 03.3 / B / 02.4 / 02.5 the perimeter.
- Web: `ConsolidationWorkspace` landing screen (§4): System Assessment, Group Structure,
  CFS Exemption, Consolidation Perimeter (+ CFS-03/04), Other Auditors slot, Outstanding
  Information, Professional Conclusion, Workstream slot, Evidence slot, Completion;
  opened inline (+/−, no modal) from the Consolidation block.

### Interface A → B (`@hsdg/contracts`, statutory-audit-consolidation.ts — already committed)

`CONSOLIDATION_PROVISION_CODE`, `CONSOLIDATION_REFERENCE_CONTEXT = '02.6'`,
`CONSOLIDATION_REFERENCE_ANCHOR`, `PERIMETER_INCLUSION`, `COMPONENT_AUDITOR_TYPE(_LABEL)`,
`ConsolidationComponentRef`, `ConsolidationApprovedResult`, `GroupAuditStatus`.

DI-free helper (A): `apps/api/src/modules/statutory-audit/consolidation-read.ts`
`readConsolidationResultOn(client, wfId): Promise<ConsolidationApprovedResult | null>`
(components carry a stable `id` — key B's rows on `component_id`; skip
`included !== 'yes'` for the matrix but keep history rows).

`StatutoryAuditConsolidation` gains `memoSuggested: boolean` (override / further
assessment / EP approval required) for B's evidence block.

## Track B — Part B: group / component / branch auditor framework (session "DHVAJ portal features assessment")

Owns new `packages/contracts/src/statutory-audit-group-audit.ts` (imports from
statutory-audit-consolidation; never re-exports the same names), new
`group-audit.ts` engine, `audit-group-audit.service/controller`, `dto/group-audit.dto.ts`,
`consolidation-group-read.ts` (replace A's placeholder), `consolidation-memo-values.ts`,
`work-automation.ts` (consolidation / component items), `audit-framework-evidence.controller.ts`
(02.6 memo route), web `consolidation-other-auditors.tsx`, `consolidation-branch-auditors.tsx`,
`consolidation-work-programme.tsx`, `consolidation-evidence.tsx`.
Migrations **1767650000000 – 1767699999999**.

- §12 component / other auditor matrix per perimeter component (+ branches): auditor
  DHVAJ / Another Auditor / Unaudited-special purpose / None / TBD, firm, FRN /
  professional body, country, partner/contact, audit period, report type/date, SA 600
  consideration Required / N/A / Pending, report / completion memo (SharePoint).
- §13 SA 600 GA-01 (principal-auditor sufficiency: significance of components + DHVAJ
  involvement), GA-02 competence (Yes/No/N/A + basis/evidence), GA-03 instructions
  communicated (Yes/No/Pending), GA-04 sufficient evidence (Yes/No/Pending — Pending blocks
  completion where material). Indian SA 600, not IAASB ISA 600 (revised).
- §14 Create Component Auditor Instructions: `component_auditor_instructions` Word
  template generated in engagement SharePoint, merged with component/group facts (topics
  per spec; materiality "supplied later from 03.3"), Open in Microsoft 365.
- §15 component reporting package checklist (10 documents), SharePoint-backed Add File /
  Link Existing / Open / Version History; approved evidence never silently replaced.
- §16 other-auditor findings register with category → impact choices; control deficiency
  → ICFR cross-ref (02.5); fraud → escalation; findings feed Section 07/08.
- §17 BR-01 (Yes / No / Pending, suggested from `branchesOnMaster`) + branch auditor
  records (branch name/location/country, auditor, appointment basis, period,
  instructions/materiality link, branch report, findings, principal-auditor response),
  §143(8) + SA 600.
- §19 consolidation work programme (15 items) generated when CFS required — replaces
  the 2 generic `work-automation.ts` items.
- §20 group audit feed: auditor matrix + package status feed 02.4 3(xxi) / 02.5
  consolidated component rows (auditor, report) and Planning / Completion / Reporting.
- §23 provisions: seed `COS_ACT_2_6` (+ Rule 6 / SA 600 version check) and
  `authority_reference_link` context '02.6' for every anchor above.
- 02.6 Consolidation & Group Audit memo (`consolidation_group_audit_memo` template key +
  merge values) + evidence block via the shared framework evidence (sub-assessment '02.6').

### Interface B → A

- `consolidation-group-read.ts` (DI-free): `groupAuditStatusOn(client, wfId): Promise<GroupAuditStatus>`
  — A's landing screen, CFS-05 summary and §24 checklist read it (A committed a placeholder).
- Web components A mounts in `ConsolidationWorkspace` slots:
  `<ConsolidationOtherAuditors engagementId workflowInstanceId canManage />` (matrix + SA 600 +
  instructions + packages + findings), `<ConsolidationBranchAuditors … />`,
  `<ConsolidationWorkProgramme … />`,
  `<ConsolidationEvidence engagementId consolidation={StatutoryAuditConsolidation} readOnly />`.

## Rules

- B never pushes `main`; A merges B, verifies and pushes `main` at the end.
- e2e: point **all three** DB URLs (DATABASE_URL, DATABASE_SUPERUSER_URL,
  DATABASE_MIGRATE_URL) at a scratch DB **inline in the same command** — global setup
  drops schema `hsdg`. Never run e2e against the dev DB `hsdg`.
- FORCE-RLS library tables (`audit_rule*`, `authority_provision`,
  `authority_reference_link`, `document_templates`): wrap seeds in NO FORCE / FORCE;
  provision seeds after 1767150000000 need `ON CONFLICT (code) WHERE effective_to IS NULL`.
- Never import a service file into a `*-read.ts` helper (ESM cycle breaks Nest DI).
