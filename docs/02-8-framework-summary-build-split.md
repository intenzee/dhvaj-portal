# 02.8 Audit Framework Summary & Approval — build split (two sessions, 50/50)

Spec: `DHVAJ_Section_02_8_Audit_Framework_Summary_Approval_Developer_Specification.docx` v1.0 (§1–§21).
Base: `origin/main` ebef519. Integration branch: **`feat/02-8-summary`** (Track A,
worktree `.claude/worktrees/02-2-framework`). Track B works on **`feat/02-8-records`**,
branched from `feat/02-8-summary` @ the interface commit, and is merged by A at the end;
A then verifies everything (migrations up/down/up, API unit, full e2e on a scratch DB,
web jest, tsc, lint, next build), runs the gap/optimisation pass with B, and pushes to
`main` (user-approved for this build, both sessions' work).

## Gap check summary (what exists on ebef519)

- API-only `audit-framework-summary.service/controller` + migration 1764100000000
  (`hsdg.audit_framework_baseline`: draft → manager_confirmed → approved → superseded;
  v1.0 → v1.1 on reopen; snapshot jsonb; rule_version_ids; `memo_document_id` never written).
  No web usage at all.
- Two approval systems, not synced: the legacy SA-2 Phase-02 card in `framework-panel.tsx`
  ("Approve framework" + plain-text memo) writes `hsdg.audit_framework_approvals`, which
  Planning (`audit-planning.service.ts`), Work (`audit-work.service.ts`) and Reassessment
  read. The 02.8 baseline unlocks nothing.
- Source sections 02.2/02.4–02.7 already refuse edits once `approved` (unless
  `needs_reevaluation`) — good, the lock exists at source.
- Matter register `hsdg.audit_matter` has owner / due / status / resolution / document_id /
  description; categories already = the spec's six (`FRAMEWORK_MATTER_CATEGORY` in
  `statutory-audit-matters.ts`). No impact / partner-attention fields.
- Prior year: `engagements.predecessor_engagement_id` + roll-forward service exist; nothing
  compares frameworks.

## Track A — control layer: header, dashboard, gates, AF-01, AF-02, approval, baseline, reopen, Section 03 lock (session "dhvaj entity regulatory profile")

Owns `packages/contracts/src/statutory-audit-framework-summary.ts` (B may ADD types in its
own file, see below), `audit-framework-summary.service/controller`,
`dto/framework-summary.dto.ts`, `framework-summary.spec.ts`, new
`framework-approval-read.ts` (DI-free approval state), the legacy approve path in
`audit-framework.service.ts` + readers in `audit-planning.service.ts`,
`audit-work.service.ts`, `audit-reassessment.service.ts`, `framework-panel.tsx`
(Phase-02 approve card + memo textarea are replaced by the 02.8 workspace),
`entity-profile-workspace.tsx` (SECTION_ANCHOR), `planning-panel.tsx` (lock banner), new web
`framework-summary-workspace.tsx`, `framework-summary-approval.tsx`,
`framework-summary-types.ts`, e2e `statutory-audit-framework-summary.e2e-spec.ts`.
Migrations **1767800000000 – 1767849999999**.

- §3 header (status Draft / Ready for Manager Review / Partner Review / Approved / Reopened,
  preparer, EM, EP, period, framework + methodology version, open / blocking counts).
- §4 dashboard: rows 02.1–02.7 + "Other framework areas" (legacy area cards with no 02.x
  workspace), Complete / Attention Required with reasons, "View 02.x" anchor links.
- §9 AF-01 Yes (needs preview reviewed) / No (per affected section: action + owner →
  return items that block re-submission until the source owner clears them).
- §12 AF-02 EP-only: Approve / Approve Subject to Conditions (condition, owner, due, impact,
  Planning-may-commence) / Return for Further Work (reason + sections → return items,
  baseline back to draft, memo back to draft via B's `returnFrameworkMemoOn`).
- §13 approval record: EP, timestamp, audit period, baseline version, methodology version,
  rule versions (code + version label per section), memo version/reference (from B's
  `controlFrameworkMemoOn`), structured conditions; audit trail.
- §13/§20 ONE approval: AF-02 writes the legacy `audit_framework_approvals` row + freezes
  legacy areas + completes phase 'framework'; Planning / Work / Reassessment read the
  02.8 state through `framework-approval-read.ts`; legacy approve endpoint retired (409 →
  "use 02.8"). Section 03 locked until approval or an approved condition with
  `planningMayCommence`.
- §14 baseline history (all versions, superseded preserved), immutable snapshot (dashboard,
  sections, triggered requirements, preview, B's `readSnapshotFactsOn` facts).
- §15 reopen with all mandatory fields (reason, affected sections, date identified,
  identified by, evidence, reapproval required); flags only the affected sections;
  calls B's `onFrameworkReopenedOn`.
- §18 completion checklist (10 checks) driving the gates.

## Track B — triggered requirements, preview, matters, prior year, memorandum, impact, notifications (session "DHVAJ portal features assessment")

Owns (replace A's PLACEHOLDERS, keep the exported signatures):
`framework-summary-triggers.ts`, `framework-summary-preview.ts`,
`framework-summary-matters.ts`, `framework-summary-prior-year.ts`,
`framework-summary-memo.ts`, `framework-summary-impact.ts`; new
`audit-framework-memo.service/controller` + `audit-framework-impact.service/controller` (or
one `audit-framework-records.*`), their DTOs, `framework-summary-memo-values.ts` (+ spec),
matters additions (`audit-matters.service.ts`, `matters-generation.ts`), notifications
wiring, Section 07 / 08 surfacing, downstream-work ↔ baseline link; optional new contract
file `statutory-audit-framework-records.ts` for B-only types (never re-export A's names).
Web (replace A's placeholders, same props `FrameworkSummaryPanelProps`):
`framework-summary-triggers.tsx`, `framework-summary-preview.tsx`,
`framework-summary-matters.tsx`, `framework-summary-prior-year.tsx`,
`framework-summary-memo.tsx`, `framework-summary-impact.tsx`.
Migrations **1767850000000 – 1767899999999**.

- §5 triggered requirements: initial audit → SA 510, service organisation → SA 402, joint
  audit → joint-audit standard, other/component auditor → SA 600, expert expected → SA 620
  consideration, CFS required → consolidation, significant IT / accounting environment →
  SA 315 IT / methodology (02.1 / 02.7). Each with Requirement | Trigger | Source |
  Downstream Work | View Standard (central Authority/Provision Library, applicable version).
- §6 rule-driven preview (not text): FS review (framework + division), CARO programme,
  ICFR statutory programme, internal controls work (always), consolidation programme,
  component auditor work (count), branch auditor work (count), audit trail workpaper,
  §197(16) workpaper, Rule 11 workpapers, initial audit procedures, specialist planning.
  Each item names its source section (UI "Fix in 02.x" link, no ad-hoc edits).
- §7 matters: all unresolved 02.1–02.7 matters with source section, spec category, impact,
  owner, due, status, Partner Attention, resolution, evidence (SharePoint) link; actions
  (manager/EP) — set Partner Attention, record impact/resolution, "Return to source
  section" (re-assign owner, status under_review) without recreating the matter.
- §8 prior-year changes: compare to the predecessor engagement's latest approved baseline
  snapshot facts (`readSnapshotFactsOn` is also what A freezes) — only meaningful changes
  across the 10 change types; initial audit → `available: false` with reason.
- §10–§11 Audit Framework Memorandum: create from the approved DHVAJ Word template in the
  engagement SharePoint location (existing `audit-framework-evidence` / document-template
  pipeline), 16 merged sections incl. actual client value | limit | operator | result
  tables for every numeric rule (ICFR turnover / borrowings, CARO thresholds, associate %,
  fraud thresholds); file card (filename, work item, version, status, prepared by, last
  editor, last saved); Open / Edit / Version History / Submit for Review; enabled only
  when `gates.canCreateMemo`; `controlFrameworkMemoOn` makes the submitted version
  controlled on approval; a revision gets a NEW memo (never silently replace).
  NOTE: AF-02 requires `memo.status === 'submitted'` (§18) — e2e needs a seeded/approved
  template; decide whether a migration seeds a default template (FORCE RLS on dev
  `document_templates` — see memory) or the tests upload one.
- §16 impact analysis: `readImpactOn` diffs the current revision vs the approved baseline it
  supersedes (CARO / ICFR / CFS / AS→Ind AS / new component auditor / audit trail /
  public-company / rule version) → affected downstream section, existing work affected,
  new work required, completed work to reassess, owner, approval requirement; professional
  confirmation endpoint (`gates.impactConfirmed` blocks AF-01 on a revision until done).
- §17 notifications on reopen (EM + EP; downstream owners), preserve completed work and
  mark its relation to the superseded baseline; surface in Section 07 Completion and
  Section 08 Reporting.

## Interface (committed by A on `feat/02-8-summary`)

Contract `statutory-audit-framework-summary.ts`: everything B fills is typed there —
`FrameworkTriggeredRequirement`, `DownstreamPreviewItem`, `FrameworkSummaryMatter`
(category = existing `FrameworkMatterCategory`), `FrameworkPriorYearComparison` /
`FrameworkPriorYearChange` / `FRAMEWORK_CHANGE_TYPE`, `FrameworkMemoCard`,
`FrameworkImpactAnalysis` / `FrameworkImpactItem`, `FrameworkSnapshotFacts`,
`FrameworkBaselineSnapshot`, `ConfirmFrameworkImpactInput`, `FRAMEWORK_SOURCE_SECTION` /
labels / anchors.

DI-free hooks (B implements, A calls inside its transaction — signatures fixed):

| File                            | Function                                                                                                                                             | Called by A                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| framework-summary-triggers.ts   | `readTriggeredRequirementsOn(client, wfId, sections)`                                                                                                | every read; frozen on approval                                                    |
| framework-summary-preview.ts    | `readDownstreamPreviewOn(client, wfId, sections)`                                                                                                    | every read; frozen on approval                                                    |
| framework-summary-matters.ts    | `readFrameworkMattersOn(client, wfId)`                                                                                                               | every read; `blocking` gates AF-01/AF-02; `partner_consultation` open → §18 check |
| framework-summary-prior-year.ts | `readSnapshotFactsOn(client, wfId)`, `readPriorYearChangesOn(client, wfId)`                                                                          | approval snapshot; every read                                                     |
| framework-summary-memo.ts       | `readFrameworkMemoOn(client, wfId, baselineId)`, `controlFrameworkMemoOn(client, ctx, baselineId)`, `returnFrameworkMemoOn(client, ctx, baselineId)` | read; AF-02 approve; AF-02 return                                                 |
| framework-summary-impact.ts     | `readImpactOn(client, wfId, baselineId)`, `onFrameworkReopenedOn(client, ctx, event)`, `onFrameworkApprovedOn(client, ctx, event)`                   | read; reopen; approve                                                             |

A provides to B: `framework-approval-read.ts` → `readFrameworkApprovalStateOn(client, wfIds)`
and `readApprovedSnapshotOn(client, wfId, version?)` (the frozen `FrameworkBaselineSnapshot`
of the latest / a given approved baseline) — for prior-year (predecessor engagement's
shell) and impact (superseded baseline).

Web: `FrameworkSummaryWorkspace` (A) renders B's six panels with
`FrameworkSummaryPanelProps { engagementId, summary, canManage, onChanged }` and
`FRAMEWORK_SUMMARY_QK`. B's own mutations invalidate `FRAMEWORK_SUMMARY_QK`.

## Coordination

- B branches `feat/02-8-records` from the interface commit; rebase on `feat/02-8-summary`
  when A pushes the API commit (A tells B). Neither edits the other's files; any needed
  change in the other track's file goes by message.
- Gotchas: FORCE RLS on authority_provision / audit_rule(_version) /
  authority_reference_link — wrap seeds in NO FORCE / FORCE; provisions seeded after
  1767150000000 use `ON CONFLICT (code) WHERE effective_to IS NULL`; never import a
  service file from a DI-free helper (ESM cycle breaks Nest DI); e2e drops the DB —
  always run it with an INLINE scratch DATABASE_URL, never the dev DB `hsdg`.
- B messages A when done (commit SHAs + verification). A merges, verifies, runs the joint
  gap/optimisation pass, pushes to `main`.
