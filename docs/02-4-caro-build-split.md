# 02.4 CARO 2020 Applicability — build split (two sessions, 50/50)

Spec: `DHVAJ_Section_02_4_CARO_2020_Applicability_Developer_Specification.docx` (§1–§22).
Base: `origin/main` c097d48. Integration branch: **`feat/02-4-caro`** (Track A).
Track B works on **`feat/02-4-caro-programme`**, branched from `feat/02-4-caro` and
rebased onto it as A lands; A merges B at the end, verifies everything, then pushes.

## Gap check summary (what exists)

- Correct Level-1 engine `caro.ts` + `audit-caro.service.ts` (shared
  `audit_framework_subassessment`, `sub_section_key '02.4'`, `area_key 'caro'`),
  rules `CARO_PVT_CAPITAL_RESERVES / _BORROWINGS / _REVENUE` (1763700000000).
- BUT the visible Phase-02 "CARO" card and completion / Section 08 read
  `audit_framework_assessments` fed by an OLD simplified engine in
  `framework-suggestions.ts` (no direct exemptions, paid-up only, year-end borrowings).
- No clause library, no per-clause work items (only 2 generic items in
  `work-automation.ts` WORKSTREAM_TEMPLATES.caro), no 3(xxi), no SFS/CFS split,
  no memo, missing provisions, no 02.4 workspace UI.

## Track A — Level 1 applicability, end to end (session "dhvaj entity regulatory profile")

Owns `packages/contracts/src/statutory-audit-caro.ts`, `caro.ts`,
`audit-caro.service.ts/controller`, `dto/caro.dto.ts`, `framework-suggestions.ts`
(CARO branch), `audit-framework.service.ts` (CARO mirror), re-evaluation hooks,
`apps/web/src/components/statutory-audit/caro-workspace.tsx`, `group-caro-card.tsx`.
Migrations **1767400000000 – 1767449999999**.

- §2 facts reuse + Needs Re-evaluation naming the affected rule; add `group` → 02.4.
- §3/§21 public-group test as a versioned rule `CARO_PVT_PUBLIC_GROUP`; retire the
  legacy `CARO_PVT_CAPITAL` (effective_to) so only capital+reserves resolves.
- §5 CARO-01..05 per-test Yes / No / Information Pending with basis + provision codes.
- §6/§7 private-company cumulative table (Satisfied / Failed / Pending, actual vs
  configured limit, measurement basis, rule version); measurement inputs:
  capital + reserves components, bank/FI borrowing balance schedule (aggregate
  peak computed, Pending when "any point" data insufficient), revenue incl.
  discontinued operations.
- §8 structured conclusion (route, direct exemption, private exemption, failed
  condition, actual, limit, rule version, provision codes).
- §9 CARO-06 Confirm / Override (conclusion + reason + technical basis + evidence
  note) / Information Pending (blocking facts); EP approval for significant
  override; system result stays visible.
- §10 report contexts: standalone + consolidated (CFS from 02.6; Pending until 02.6).
- §15 prior-year applicability context (prior result, exemption basis, changed facts).
- §19 completion checklist + 02.4 COMPLETE per report context.
- Legacy Phase-02 CARO row becomes a mirror of 02.4 (suggestion + conclusion), so
  completion / Section 08 / planning read the correct result.
- Web: `CaroWorkspace` landing screen (Header, System Assessment, Facts Used with
  Open Source, Exemption Tests, Rule Basis with View Provision, Professional
  Conclusion, report contexts, Prior Year), opened inline (+/−, no modal) from the
  02.4 card. It mounts Track B components (below).

### Interface A → B (in `@hsdg/contracts`, statutory-audit-caro.ts)

```ts
export interface CaroApprovedResult {
  workflowInstanceId: string;
  outcome: CaroOutcome | null;      // conclusion when decided, else live suggestion
  decided: boolean;                 // professional conclusion recorded (confirm/override)
  complete: boolean;                // 02.4 COMPLETE (§19)
  standalone: CaroContextResult;    // { applies: boolean | null; status: 'applicable'|'not_applicable'|'pending' }
  consolidated: CaroContextResult & { cfsInScope: boolean }; // pending until 02.6 concludes
  financialYear: string | null;
  periodStart: string;              // ISO date — resolve the clause library version with it
}
```
API side: `AuditCaroService.readResultOn(client, workflowInstanceId): Promise<CaroApprovedResult | null>`
(runs inside the caller's RLS transaction; Track B may inject AuditCaroService —
Track A never injects Track B services, so there is no DI cycle).

Provision codes Track A links to (Track B seeds them; A tolerates absence):
`CARO_2020` (exists), `CARO_2020_PARA_1`, `ICAI_GN_CARO_2020`, `COS_ACT_8`,
`COS_ACT_2_62`, `COS_ACT_2_85` (exists), `COS_ACT_143_11`.

## Track B — Level 2 clause programme, library, evidence (session "DHVAJ portal features assessment")

Owns new `packages/contracts/src/statutory-audit-caro-programme.ts`,
`caro-programme.ts` (pure), `audit-caro-programme.service.ts/controller`,
`dto/caro-programme.dto.ts`, the `MEMOS` entry in `audit-framework-evidence.service.ts`,
`caro-memo-values.ts`, `apps/web/.../caro-programme.tsx`, `caro-evidence.tsx`.
Migrations **1767450000000 – 1767499999999**.

- §17 provisions: CARO 2020 Order, para 1, every para-3 clause/sub-clause
  (`CARO_2020_3_I` … `CARO_2020_3_XXI`, sub-clauses e.g. `CARO_2020_3_I_A`), ICAI
  Guidance Note on CARO 2020 (Revised 2022), CA 2013 s8, s2(62), s143(11); source
  links via the Provision Library (no URLs in components).
- §11 versioned clause library tables (order version, clause, sub-clause, effective
  dates, provision code, guidance code, related Schedule III requirement codes /
  audit-area codes, procedures) seeded with CARO 2020 3(i)–3(xxi).
- §11/§12 instantiation: on read, when `readResultOn(...).standalone.applies && decided`,
  instantiate the programme idempotently from the library version in force for
  `periodStart`; if 02.4 later concludes not applicable, mark items withdrawn (never
  delete). Level-2 "Not Applicable to Facts" never touches Level 1.
- §13 clause work: applicability to facts, procedures, evidence (reuse approved
  files — link, never re-upload), findings (create once; link clause + area +
  reporting), management response, proposed reporting language (draft), final
  conclusion + review/approval; cross-ref 02.3 disclosure + audit area.
- §14 clause 3(xxi) item for CFS (components from 02.6 group structure; CARO
  applicable to component, linked auditor report, qualification/adverse remark,
  paragraph number, consolidated conclusion, reviewer/partner review).
- §15 prior-year clause conclusions / reportable matters (reference only).
- §16 CARO Applicability Memo: `document_templates` key `caro_applicability_memo`,
  merge values, Add File / Link Existing / Open / Version history via the shared
  `audit_framework_files` plumbing.
- §18 downstream: approved clause conclusions → draft CARO annexure (Section 08 /
  completion), replace the generic `WORKSTREAM_TEMPLATES.caro` items with the
  clause programme.
- Web: `<CaroProgramme engagementId workflowInstanceId canManage />` and
  `<CaroEvidence engagementId workflowInstanceId canManage />` — Track A mounts both
  inside `CaroWorkspace`. Inline expand rows (+/−), never pop-ups.

## Shared rules

- No statutory number or URL in code; everything versioned and effective-dated.
- FORCE RLS on authority_provision / audit_rule(_version) / library tables: wrap
  seeds in NO FORCE / FORCE. Provision seeds after 1767150000000 use
  `ON CONFLICT (code) WHERE effective_to IS NULL`.
- Verify before handing over: `pnpm -C apps/api test`, the relevant e2e specs,
  `pnpm -C apps/web test`, `pnpm -C apps/web build`, migrations up/down/up.
