# 02.5 Internal Financial Controls / ICFR Reporting — build split (two sessions, 50/50)

Spec: `DHVAJ_Section_02_5_ICFR_Reporting_Applicability_Developer_Specification_v1.1.docx` (§1–§26).
Base: `origin/main` 1d23d81. Integration branch: **`feat/02-5-icfr`** (Track A).
Track B works on **`feat/02-5-icfr-controls`**, branched from `feat/02-5-icfr` and
merged by A at the end; A then verifies everything (migrations up/down/up, API unit,
full e2e on a scratch DB, web jest, tsc, lint, next build) and pushes.

## Gap check summary (what exists)

- Correct pure engine `icfr.ts` + `audit-icfr.service.ts` (shared
  `audit_framework_subassessment`, `sub_section_key '02.5'`, `area_key 'ifc'`), rules
  `ICFR_EXEMPT_TURNOVER / _BORROWINGS` (strict `<`, 1763800000000).
- BUT Section 05's IFC workstream (`WORKSTREAM_TEMPLATES.ifc`, 3 generic procedures)
  and Section 08's "IFC (Annexure B)" read `audit_framework_assessments` 'ifc', fed by
  the OLD rule in `framework-suggestions.ts` ("any company → applicable") — not synced.
- Web: only a small block in `reporting-facts-card.tsx`. No 02.5 workspace, no
  borrowing breakdown, filing default is a bare boolean defaulting to "no default",
  no partner approval, no memo, 2 of 6 provisions, no controls / D-I-OE / deficiency
  framework, no CFS ICFR consideration, no §23 completion.

## Track A — Level 1 applicability, end to end (session "dhvaj entity regulatory profile")

Owns `packages/contracts/src/statutory-audit-icfr.ts`, `icfr.ts`, `icfr-completion.ts`,
`icfr-read.ts`, `audit-icfr.service.ts/controller`, `dto/icfr.dto.ts`,
`framework-suggestions.ts` (ifc branch), `audit-framework.service.ts` (ifc mirror),
`reporting-facts-card.tsx` (ICFR block), new `icfr-workspace.tsx`.
Migrations **1767500000000 – 1767549999999**.

- §2 capture once: turnover from the **latest audited financial statements** (02.1
  profile / financial profile, with period + source + Open Source); Needs
  Re-evaluation naming the changed fact / affected rule.
- §3 Rules Library: `ICFR_OPC_ROUTE`, `ICFR_SMALL_COMPANY_ROUTE`,
  `ICFR_FILING_CONDITION`, `ICFR_PRIVATE_MONETARY_JOIN` as versioned rules; turnover
  measurement basis → `latest_audited_financial_statements`; condition jsonb (covered /
  excluded sources, prerequisites) + guidance reference on all ICFR rules.
- §5/§6 decision flow Steps 1–7 with per-route rows (OPC / Small / Turnover /
  Borrowings / Filing → Exempt route / No / Satisfied / Failed / Pending).
- §7 IFC-01 turnover (period, source, actual, threshold, operator; Pending when no
  audited figure).
- §8 IFC-02 borrowing schedule (date, source bank / FI / body corporate / other,
  amount) → system computes the peak aggregate + date of peak + per-source split;
  "other" included/excluded only per the rule condition; year-end-only data → Pending.
- §9 IFC-03 filing condition: No Default Identified / Default Identified /
  Information Pending with per-filing records (form, period, due date, filed date,
  SRN, source) — **unknown ≠ no default**.
- §10 structured system conclusion; §11 IFC-04 Confirm / Override (conclusion + reason
  + technical basis + evidence) / Information Pending (blocking facts); EP approval for
  significant override; system result kept separately.
- §12 persistent control-audit reminder when Exempt; Section 05 normal controls stay on.
- §17 consolidated context: CFS in scope from 02.6 → `consolidated.status`
  (`pending` until 02.6 decides; standalone conclusion never blocked).
- §19 prior-year applicability panel (prior result + basis, flag changed facts).
- §22/§23 completion checklist + 02.5 COMPLETE; legacy Section 02 'ifc' row mirrors
  02.5 (suggestion + conclusion), so Section 05 activation, Section 08 Annexure B,
  planning signals and completion all read the 02.5 result.
- Web: `IcfrWorkspace` landing screen (Header, System Assessment, Facts Used, Rule
  Basis, Exemption Assessment table, IFC-01/02/03 capture, Professional Conclusion,
  Control Audit Reminder, Workstream Configuration slot, Consolidated slot, Evidence
  slot, Prior Year, Completion), opened inline (+/−, no modal) from the ICFR card.

### Interface A → B (in `@hsdg/contracts`, statutory-audit-icfr.ts)

```ts
export const ICFR_PROVISION_CODE = {
  section143_3_i: 'COS_ACT_143_3_I',
  exemptionNotification: 'MCA_ICFR_PVT_EXEMPTION',   // B seeds
  section92: 'COS_ACT_92',                           // B seeds
  section137: 'COS_ACT_137',                         // B seeds
  guidanceNote: 'ICAI_GN_ICFR',                      // B seeds
  implementationGuide: 'ICAI_IG_ICFR_SMALL',         // B seeds
  rule11g: 'AUDIT_RULE_11G',
} as const;

export interface IcfrApprovedResult {
  workflowInstanceId: string;
  outcome: IcfrOutcome | null;   // conclusion when decided, else stored suggestion
  decided: boolean;              // professional conclusion recorded
  complete: boolean;             // 02.5 COMPLETE (§23)
  reportingApplies: boolean | null;
  consolidated: { cfsInScope: boolean | null; status: 'applicable' | 'not_applicable' | 'pending' };
  financialYear: string | null;
  periodStart: string;           // audit period start (rule / provision resolution date)
}
```

DI-free helper (A): `apps/api/src/modules/statutory-audit/icfr-read.ts`
`readIcfrResultOn(client, workflowInstanceId): Promise<IcfrApprovedResult | null>` —
reads stored columns only, so B can call it without injecting `AuditIcfrService`
(lesson from 02.4: never import a service file into a helper the service imports —
the ESM cycle breaks Nest DI).

Reference anchors A's UI passes to `<FrameworkReferences contextKey="02.5" anchors=…>`:
`section_143_3_i`, `mca_exemption`, `section_92`, `section_137`, `icai_gn_icfr`,
`icai_impl_guidance`, `rule_11g` (B seeds the `authority_reference_link` rows).

## Track B — Section 05 ICFR work, evidence, provisions, CFS (session "DHVAJ portal features assessment")

Owns new `packages/contracts/src/statutory-audit-icfr-controls.ts` (imports types from
statutory-audit-icfr; never re-exports the same names), new `icfr-controls.ts` engine,
`audit-icfr-controls.service/controller`, `icfr-controls-read.ts`, `icfr-memo-values.ts`,
`work-automation.ts` (ifc branch), `completion-automation.ts` (ICFR deficiency feed),
web `icfr-workstream.tsx`, `icfr-evidence.tsx`, `icfr-consolidated.tsx`.
Migrations **1767550000000 – 1767599999999**.

- §21 provisions + `authority_reference_link` context '02.5' anchors listed above
  (MCA private-company exemption notification + corrigendum version, s92, s137, ICAI GN
  on Audit of ICFR, ICAI implementation guidance for smaller entities, Rule 11(g)).
- §20 ICFR Applicability Memo (`icfr_applicability_memo` template key + merge values),
  Add File / Link Existing / Open / Version History through the shared framework
  evidence (sub-assessment '02.5'); memo suggested only for override / complex.
- §13 Section 05 ICFR workstream instantiated when 02.5 is decided Applicable:
  versioned process-area framework (Entity-Level Controls, Financial Close &
  Reporting always; Revenue, Purchases, Inventory, PPE, Payroll, Treasury, Taxation,
  ITGC fact/risk-driven; Other Significant Processes added by scoping) — replaces the 3
  generic `WORKSTREAM_TEMPLATES.ifc` procedures; never "every process mandatory".
- §14 one control record with purposes (FS Audit / ICFR / both), process, assertions,
  related risk, evidence linked once (reuse, no duplicate upload), review.
- §15 Design (Adequate / Deficiency), Implementation (Implemented / Not), Operating
  effectiveness (Effective / Exception Identified / Not Tested) kept separate; overall
  derived, never collapsed to Yes/No.
- §16 deficiency register (Control Deficiency / Significant Deficiency / Material
  Weakness, account/disclosure, assertions, magnitude, likelihood, compensating
  controls, remediation, audit + reporting impact, Manager review, Partner conclusion).
- §17 Consolidated ICFR Reporting Consideration (components from 02.6 group structure
  + manual; Indian company, component ICFR applicable/exempt/pending, auditor DHVAJ /
  other, linked 143(3)(i) report, materiality, MW yes/no + details, parent conclusion).
- §19 prior-year material weaknesses / significant deficiencies / unresolved
  remediation highlighted + current-year follow-up created; prior effectiveness context
  only.
- §22 deficiencies / MWs → Section 07 Completion and Section 08 ICFR report item;
  §18 Rule 11(g) cross-reference only (separate conclusion).

### Interface B → A

- `icfr-controls-read.ts` (DI-free):
  `icfrWorkstreamStatusOn(client, wfId): Promise<{ instantiated: boolean; processAreas: number; openDeficiencies: number; materialWeaknesses: number }>`
  `icfrConsolidatedStatusOn(client, wfId): Promise<{ configured: boolean; components: number; pending: number }>`
  — A's §23 checklist items `workstream` and `consolidated` read these.
- Web components A mounts in `IcfrWorkspace` slots:
  `<IcfrWorkstream engagementId workflowInstanceId />`,
  `<IcfrConsolidated engagementId workflowInstanceId />`,
  `<IcfrEvidence engagementId icfr={StatutoryAuditIcfr} readOnly />`.
- `StatutoryAuditIcfr` gains `memoSuggested: boolean` (A sets it: override / further
  assessment / partner approval required) for B's evidence block.

## Rules

- Never push to `main`; A pushes `feat/02-5-icfr` after full verification; `main` is the
  user's call.
- e2e: point **all three** DB URLs (DATABASE_URL, DATABASE_SUPERUSER_URL,
  DATABASE_MIGRATE_URL) at a scratch DB — global setup drops schema `hsdg`.
- FORCE-RLS library tables (`audit_rule*`, `authority_provision`,
  `authority_reference_link`, `document_templates`): wrap seeds in NO FORCE / FORCE.
