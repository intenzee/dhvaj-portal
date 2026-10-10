import {
  BLOCKING_FINDING_CATEGORIES,
  COMPONENT_AUDITOR_TYPE,
  COMPONENT_REPORT_TYPE_LABEL,
  FINDING_CATEGORY_LABEL,
  FINDING_IMPACT_CHOICES,
  FINDING_IMPACT_LABEL,
  GROUP_MATRIX_STATE,
  GROUP_WORK_PROGRAMME_STATE,
  MODIFIED_REPORT_TYPES,
  PACKAGE_DOCUMENT_KEYS,
  type Br01Answer,
  type ComponentAuditorType,
  type ComponentReportType,
  type ComponentSignificance,
  type ConsolidationComponentRef,
  type ConsolidationWorkLibraryItem,
  type Ga01Answer,
  type Ga02Answer,
  type GaYesNoPending,
  type GroupAuditStatus,
  type GroupFindingCategory,
  type GroupFindingImpact,
  type GroupMatrixState,
  type GroupWorkProgrammeState,
  type PackageDocumentKey,
  type PackageDocumentStatus,
  type Sa600Consideration,
  type WorkItemActivation,
} from '@hsdg/contracts';
import { componentsFromDetail } from './consolidation-read';

/**
 * 02.6 Part B — pure group / component / branch auditor engine (DHVAJ 02.6
 * spec §12–§17, §19, §21). No I/O and no statutory numbers: significance is a
 * professional judgment (never a percentage, §18), and every amount reaches the
 * component instructions only from an approved Section 03.3.
 */

/** 02.6 perimeter relationships whose entities are components of the CFS. */
export const CFS_COMPONENT_RELATIONSHIPS: ReadonlySet<string> = new Set([
  'subsidiary',
  'associate',
  'joint_venture',
]);

/** One 02.6 perimeter entry with the facts the group-audit framework reads. */
export interface PerimeterComponent extends ConsolidationComponentRef {
  /** The 02.6 relationship record flags another auditor (legacy indicator). */
  auditedByOtherAuditor: boolean;
  /** CFS-04 policy alignment result ('conversion_required' …), when assessed. */
  policyResult: string | null;
}

interface StoredExtras {
  id?: string;
  name?: string;
  auditedByOtherAuditor?: boolean;
  policy?: { result?: string | null } | null;
}

/** The stored 02.6 perimeter (system_detail) with the extra facts Part B needs. */
export function perimeterFromDetail(detail: unknown): PerimeterComponent[] {
  const raw = ((detail as { perimeter?: StoredExtras[] } | null)?.perimeter ?? []).filter((p) =>
    p?.name?.trim(),
  );
  return componentsFromDetail(detail).map((c, i) => ({
    ...c,
    auditedByOtherAuditor: raw[i]?.auditedByOtherAuditor === true,
    policyResult: raw[i]?.policy?.result ?? null,
  }));
}

// ── §12 matrix ────────────────────────────────────────────────────────────

export function groupMatrixState(cfsRequired: boolean | null): {
  state: GroupMatrixState;
  reason: string;
} {
  if (cfsRequired === true)
    return {
      state: GROUP_MATRIX_STATE.active,
      reason:
        'Consolidated financial statements are required — every component included in the 02.6 perimeter has one row here.',
    };
  if (cfsRequired === false)
    return {
      state: GROUP_MATRIX_STATE.notRequired,
      reason:
        'Consolidated financial statements are not required (or exempt) — no component matrix. Branch auditors are still recorded below.',
    };
  return {
    state: GROUP_MATRIX_STATE.awaiting,
    reason: 'Waiting for 02.6 to decide whether consolidated financial statements are required.',
  };
}

/** The components that get a matrix row: included (Yes) subsidiaries, associates and JVs. */
export function matrixComponents(perimeter: readonly PerimeterComponent[]): PerimeterComponent[] {
  return perimeter.filter(
    (p) => p.included === 'yes' && CFS_COMPONENT_RELATIONSHIPS.has(p.relationship),
  );
}

export interface PriorComponent {
  auditorType: ComponentAuditorType | null;
  firmName: string | null;
  frn: string | null;
  professionalBody: string | null;
  auditorCountry: string | null;
  partnerContact: string | null;
  reportType: ComponentReportType | null;
}

/** Who audits the component — last year's matrix first (stable master data, §21), else 02.6. */
export function suggestAuditor(
  c: Pick<PerimeterComponent, 'auditedByOtherAuditor'>,
  prior: PriorComponent | null,
): { type: ComponentAuditorType; basis: string; source: 'system' | 'prior_year' } {
  if (prior?.auditorType && prior.auditorType !== COMPONENT_AUDITOR_TYPE.tbd) {
    return {
      type: prior.auditorType,
      basis: `Rolled forward from last year's matrix${prior.firmName ? ` (${prior.firmName})` : ''} — confirm it still holds.`,
      source: 'prior_year',
    };
  }
  if (c.auditedByOtherAuditor) {
    return {
      type: COMPONENT_AUDITOR_TYPE.otherAuditor,
      basis: 'The 02.6 relationship record says another auditor audits this component.',
      source: 'system',
    };
  }
  return {
    type: COMPONENT_AUDITOR_TYPE.tbd,
    basis: 'Nothing on file says who audits this component — record it.',
    source: 'system',
  };
}

/** SA 600 follows the auditor: another auditor → Required; DHVAJ / unaudited / none → N/A. */
export function suggestSa600(type: ComponentAuditorType): Sa600Consideration {
  if (type === COMPONENT_AUDITOR_TYPE.otherAuditor) return 'required';
  if (type === COMPONENT_AUDITOR_TYPE.tbd) return 'pending';
  return 'not_applicable';
}

/** GA-01 (SA 600): DHVAJ alone → Yes; any other / undecided auditor → Further Assessment. */
export function suggestGa01(types: readonly ComponentAuditorType[]): {
  answer: Ga01Answer | null;
  basis: string;
} {
  if (!types.length) return { answer: null, basis: 'No components in the matrix yet.' };
  const others = types.filter((t) => t === COMPONENT_AUDITOR_TYPE.otherAuditor).length;
  const tbd = types.filter((t) => t === COMPONENT_AUDITOR_TYPE.tbd).length;
  if (!others && !tbd)
    return {
      answer: 'yes',
      basis:
        'No component is audited by another auditor — DHVAJ audits the group itself and acts as principal auditor.',
    };
  return {
    answer: 'further_assessment',
    basis: `${others ? `${others} component${others === 1 ? ' is' : 's are'} audited by another auditor` : ''}${others && tbd ? '; ' : ''}${tbd ? `${tbd} still TBD` : ''} — document the significance of those components and DHVAJ's own involvement before answering Yes.`,
  };
}

/** BR-01 (§17): branch records → Yes; branches on the master → Pending (confirm); else No. */
export function suggestBr01(input: { branchesOnMaster: boolean; branchRecords: number }): {
  answer: Br01Answer;
  basis: string;
} {
  if (input.branchRecords > 0)
    return {
      answer: 'yes',
      basis: `${input.branchRecords} branch auditor record${input.branchRecords === 1 ? '' : 's'} on file.`,
    };
  if (input.branchesOnMaster)
    return {
      answer: 'pending',
      basis:
        'The client master shows branch addresses — confirm whether any branch is audited by another auditor (section 143(8)).',
    };
  return {
    answer: 'no',
    basis: 'The client master shows no branches.',
  };
}

// ── §15 reporting package ─────────────────────────────────────────────────

/**
 * Which package documents apply: another auditor → all (ICFR / CARO only for
 * an Indian company or when unknown); unaudited / special purpose → no audit
 * report or completion memo. Null when the component takes no package (DHVAJ /
 * none / TBD).
 */
export function packageRelevance(
  type: ComponentAuditorType,
  isIndianCompany: boolean | null,
): Record<PackageDocumentKey, boolean> | null {
  if (type !== COMPONENT_AUDITOR_TYPE.otherAuditor && type !== COMPONENT_AUDITOR_TYPE.unaudited)
    return null;
  const out = {} as Record<PackageDocumentKey, boolean>;
  for (const k of PACKAGE_DOCUMENT_KEYS) out[k] = true;
  if (isIndianCompany === false) {
    out.icfr_report = false;
    out.caro_report = false;
  }
  if (type === COMPONENT_AUDITOR_TYPE.unaudited) {
    out.audit_report = false;
    out.completion_memo = false;
  }
  return out;
}

/** Package documents still outstanding (relevant and Pending). */
export function pendingPackageDocuments(
  relevance: Record<PackageDocumentKey, boolean> | null,
  status: Partial<Record<PackageDocumentKey, PackageDocumentStatus>>,
): PackageDocumentKey[] {
  if (!relevance) return [];
  return PACKAGE_DOCUMENT_KEYS.filter(
    (k) => relevance[k] && (status[k] ?? 'pending') === 'pending',
  );
}

// ── Row completeness ──────────────────────────────────────────────────────

export interface Sa600AnswerFacts {
  ga02: Ga02Answer;
  ga03: GaYesNoPending;
  ga04: GaYesNoPending;
}

export interface ComponentRowFacts extends Sa600AnswerFacts {
  auditorType: ComponentAuditorType;
  firmName: string | null;
  country: string | null;
  auditorCountry: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  reportType: ComponentReportType | null;
  sa600: Sa600Consideration;
  significance: ComponentSignificance;
  hasReport: boolean;
  hasCompletionMemo: boolean;
  hasInstructions: boolean;
  pendingPackage: number;
  priorReportType: ComponentReportType | null;
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/** What keeps a matrix row from being complete (empty = complete). */
export function componentMissing(r: ComponentRowFacts): string[] {
  const out: string[] = [];
  if (r.auditorType === COMPONENT_AUDITOR_TYPE.tbd) {
    out.push('Record who audits this component');
    return out;
  }
  if (r.auditorType === COMPONENT_AUDITOR_TYPE.otherAuditor) {
    if (blank(r.firmName)) out.push('Component auditor firm');
    if (blank(r.auditorCountry) && blank(r.country)) out.push('Country');
    if (!r.periodFrom || !r.periodTo) out.push('Audit / reporting period');
    if (r.sa600 === 'pending') out.push('SA 600 consideration');
    if (r.significance === 'pending') out.push('Significance to the group (GA-01)');
    if (r.ga02 === 'pending') out.push('GA-02 competence of the other auditor');
    if (r.ga03 === 'pending')
      out.push(
        r.hasInstructions ? 'GA-03 instructions communicated' : 'Component instructions (GA-03)',
      );
    if (r.ga04 === 'pending') out.push('GA-04 sufficiency of the other auditor’s work');
    if (!r.reportType || r.reportType === 'not_issued') out.push('Component report type / date');
    if (!r.hasReport) out.push('Component audit report (SharePoint)');
    if (!r.hasCompletionMemo) out.push('Completion memorandum / communication');
  }
  if (r.auditorType === COMPONENT_AUDITOR_TYPE.unaudited) {
    if (!r.periodFrom || !r.periodTo) out.push('Reporting period');
    if (r.significance === 'pending') out.push('Significance to the group (GA-01)');
  }
  if (r.pendingPackage)
    out.push(
      `${r.pendingPackage} reporting-package document${r.pendingPackage === 1 ? '' : 's'} pending`,
    );
  if (
    r.priorReportType &&
    MODIFIED_REPORT_TYPES.includes(r.priorReportType) &&
    (!r.reportType || r.reportType === 'not_issued')
  )
    out.push(
      `Follow up last year's ${COMPONENT_REPORT_TYPE_LABEL[r.priorReportType].toLowerCase()}`,
    );
  return out;
}

export interface BranchRowFacts extends Sa600AnswerFacts {
  firmName: string | null;
  appointmentBasis: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  significance: ComponentSignificance;
  hasReport: boolean;
  hasInstructions: boolean;
  principalResponse: string | null;
  conclusion: string;
}

export function branchMissing(b: BranchRowFacts): string[] {
  const out: string[] = [];
  if (blank(b.firmName)) out.push('Branch auditor firm');
  if (!b.appointmentBasis) out.push('Appointment basis (section 143(8))');
  if (!b.periodFrom || !b.periodTo) out.push('Audit period');
  if (!b.hasInstructions) out.push('Instructions / materiality communicated');
  if (b.significance === 'pending') out.push('Significance to the company');
  if (b.ga02 === 'pending') out.push('GA-02 competence of the branch auditor');
  if (b.ga03 === 'pending') out.push('GA-03 instructions communicated');
  if (b.ga04 === 'pending') out.push('GA-04 sufficiency of the branch auditor’s work');
  if (!b.hasReport) out.push('Branch audit report (SharePoint)');
  if (b.conclusion === 'pending' || blank(b.principalResponse))
    out.push('Principal auditor response / conclusion');
  return out;
}

/** The auditor differs from last year (§21 — reassess SA 600 and instructions). */
export function auditorChanged(
  current: { auditorType: ComponentAuditorType; firmName: string | null },
  prior: PriorComponent | null,
): boolean {
  if (!prior?.auditorType || prior.auditorType === COMPONENT_AUDITOR_TYPE.tbd) return false;
  if (current.auditorType === COMPONENT_AUDITOR_TYPE.tbd) return false;
  if (current.auditorType !== prior.auditorType) return true;
  if (current.auditorType !== COMPONENT_AUDITOR_TYPE.otherAuditor) return false;
  const norm = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    !!norm(current.firmName) &&
    !!norm(prior.firmName) &&
    norm(current.firmName) !== norm(prior.firmName)
  );
}

// ── §16 findings ──────────────────────────────────────────────────────────

export const findingRef = (seq: number) => `GF-${String(seq).padStart(3, '0')}`;

/** Impacts must come from the category's choices and at least one is recorded. */
export function findingImpactError(
  category: GroupFindingCategory,
  impacts: readonly GroupFindingImpact[],
): string | null {
  const allowed = FINDING_IMPACT_CHOICES[category];
  if (!impacts.length)
    return `Choose the group impact: ${allowed.map((i) => FINDING_IMPACT_LABEL[i]).join(' / ')}.`;
  const bad = impacts.filter((i) => !allowed.includes(i));
  if (bad.length)
    return `${bad.map((i) => FINDING_IMPACT_LABEL[i]).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not an impact of ${FINDING_CATEGORY_LABEL[category].toLowerCase()} — choose from ${allowed.map((i) => FINDING_IMPACT_LABEL[i]).join(' / ')}.`;
  return null;
}

/** Categories that go to Section 07 / 08 by default; fraud is always escalated. */
export function findingDefaults(category: GroupFindingCategory): {
  escalated: boolean;
  reportingConsideration: boolean;
} {
  return {
    escalated: category === 'fraud',
    reportingConsideration: [
      'modified_opinion',
      'material_misstatement',
      'going_concern',
      'fraud',
    ].includes(category),
  };
}

/** A component report's modified opinion suggests a finding of that category. */
export function findingCategoryForReport(
  reportType: ComponentReportType | null,
): GroupFindingCategory | null {
  if (!reportType) return null;
  if (MODIFIED_REPORT_TYPES.includes(reportType)) return 'modified_opinion';
  if (reportType === 'unmodified_emphasis') return 'emphasis_other_matter';
  return null;
}

// ── §19 work programme ────────────────────────────────────────────────────

/** The library items in force on a date (latest effective_from per key). */
export function workItemsInForce(
  library: readonly ConsolidationWorkLibraryItem[],
  on: string,
): ConsolidationWorkLibraryItem[] {
  const best = new Map<string, ConsolidationWorkLibraryItem>();
  for (const i of library) {
    if (i.effectiveFrom > on || (i.effectiveTo && i.effectiveTo < on)) continue;
    const cur = best.get(i.itemKey);
    if (!cur || i.effectiveFrom > cur.effectiveFrom) best.set(i.itemKey, i);
  }
  return [...best.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface WorkProgrammeFacts {
  subsidiaries: number;
  associatesJvs: number;
  foreign: number;
  conversions: number;
  otherAuditors: number;
}

/** Perimeter (and matrix) facts that activate the library items. */
export function workProgrammeFacts(
  components: readonly PerimeterComponent[],
  otherAuditors: number,
): WorkProgrammeFacts {
  const isForeign = (c: PerimeterComponent) =>
    c.isIndianCompany === false || (!!c.country && !/^(india|in|ind)$/i.test(c.country.trim()));
  return {
    subsidiaries: components.filter((c) => c.relationship === 'subsidiary').length,
    associatesJvs: components.filter(
      (c) => c.relationship === 'associate' || c.relationship === 'joint_venture',
    ).length,
    foreign: components.filter(isForeign).length,
    conversions: components.filter((c) => c.policyResult === 'conversion_required').length,
    otherAuditors,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whether a library item applies on these facts, with the system's reason. */
export function workItemApplicability(
  activation: WorkItemActivation,
  f: WorkProgrammeFacts,
): { applicable: boolean; basis: string } {
  switch (activation) {
    case 'always':
      return { applicable: true, basis: 'Applies to every consolidation.' };
    case 'subsidiary':
      return f.subsidiaries
        ? {
            applicable: true,
            basis: `${plural(f.subsidiaries, 'subsidiary', 'subsidiaries')} in the perimeter.`,
          }
        : { applicable: false, basis: 'N/A — no subsidiary in the perimeter.' };
    case 'associate_jv':
      return f.associatesJvs
        ? {
            applicable: true,
            basis: `${plural(f.associatesJvs, 'associate / joint venture', 'associates / joint ventures')} in the perimeter.`,
          }
        : { applicable: false, basis: 'N/A — no associate or joint venture in the perimeter.' };
    case 'foreign':
      return f.foreign
        ? {
            applicable: true,
            basis: `${plural(f.foreign, 'foreign component', 'foreign components')} in the perimeter.`,
          }
        : { applicable: false, basis: 'N/A — no foreign component in the perimeter.' };
    case 'conversion':
      return f.conversions
        ? {
            applicable: true,
            basis: `${plural(f.conversions, 'component needs', 'components need')} GAAP / policy conversion (CFS-04).`,
          }
        : {
            applicable: false,
            basis: 'N/A — no component needs GAAP / policy conversion (CFS-04).',
          };
    case 'other_auditor':
      return f.otherAuditors
        ? {
            applicable: true,
            basis: `${plural(f.otherAuditors, 'component is', 'components are')} audited by another auditor (SA 600).`,
          }
        : { applicable: false, basis: 'N/A — no component is audited by another auditor.' };
  }
}

/** Ensure the programme while CFS is required; withdraw it (kept) when no longer required. */
export function planWorkProgramme(
  cfsRequired: boolean | null,
  current: 'none' | 'active' | 'withdrawn',
): 'ensure' | 'withdraw' | 'none' {
  if (cfsRequired === true) return 'ensure';
  if (cfsRequired === false && current === 'active') return 'withdraw';
  return 'none';
}

export function workProgrammeState(
  cfsRequired: boolean | null,
  current: 'none' | 'active' | 'withdrawn',
): { state: GroupWorkProgrammeState; reason: string } {
  if (current === 'active')
    return {
      state: GROUP_WORK_PROGRAMME_STATE.active,
      reason:
        'Consolidated financial statements are required — the consolidation work programme is in Section 06.',
    };
  if (current === 'withdrawn')
    return {
      state: GROUP_WORK_PROGRAMME_STATE.withdrawn,
      reason:
        'Withdrawn — 02.6 no longer requires consolidated financial statements. The record is kept.',
    };
  if (cfsRequired === false)
    return {
      state: GROUP_WORK_PROGRAMME_STATE.notRequired,
      reason:
        'Consolidated financial statements are not required — no consolidation work programme.',
    };
  return {
    state: GROUP_WORK_PROGRAMME_STATE.awaiting,
    reason: 'Waiting for 02.6 to decide whether consolidated financial statements are required.',
  };
}

export const CONSOLIDATION_WORK_AREA_KEY = 'cfs';
export const consolidationProcedureSourceKey = (itemKey: string) => `cfs:${itemKey}`;

export interface PlannedConsolidationProcedure {
  sourceKey: string;
  sourceNote: string;
  title: string;
  objective: string;
  expectedEvidence: string | null;
}

/** One Section 06 procedure per applicable live item — replaces the generic CFS programme. */
export function planConsolidationProcedures(
  items: ReadonlyArray<{
    itemKey: string;
    title: string;
    objective: string;
    evidence: string;
    applicable: boolean;
    withdrawn: boolean;
  }>,
  frameworkLabel: string,
): PlannedConsolidationProcedure[] {
  return items
    .filter((i) => i.applicable && !i.withdrawn)
    .map((i) => ({
      sourceKey: consolidationProcedureSourceKey(i.itemKey),
      sourceNote: `02.6 — ${frameworkLabel}`,
      title: i.title.length > 160 ? `${i.title.slice(0, 157)}…` : i.title,
      objective: i.objective,
      expectedEvidence: i.evidence || null,
    }));
}

// ── Status (Track A reads it) ─────────────────────────────────────────────

export interface StatusComponent extends Sa600AnswerFacts {
  componentId: string;
  componentName: string;
  auditorType: ComponentAuditorType;
  firmName: string | null;
  significance: ComponentSignificance;
  hasInstructions: boolean;
  pendingPackage: number;
}

export interface StatusBranch extends Sa600AnswerFacts {
  branchName: string;
  significance: ComponentSignificance;
  hasReport: boolean;
  principalResponse: string | null;
  conclusion: string;
}

export interface StatusFinding {
  ref: string;
  subjectName: string;
  category: GroupFindingCategory;
  status: 'open' | 'resolved';
}

export function computeGroupAuditStatus(input: {
  cfsRequired: boolean | null;
  /** Matrix-eligible perimeter component ids (rows expected). */
  expectedComponentIds: readonly string[];
  /** Live (not withdrawn) matrix rows. */
  components: readonly StatusComponent[];
  ga01: Ga01Answer | null;
  br01: Br01Answer;
  branches: readonly StatusBranch[];
  findings: readonly StatusFinding[];
  workProgrammeActive: boolean;
}): GroupAuditStatus {
  const live = input.cfsRequired === true ? input.components : [];
  const count = (t: ComponentAuditorType) => live.filter((c) => c.auditorType === t).length;
  const others = live.filter((c) => c.auditorType === COMPONENT_AUDITOR_TYPE.otherAuditor);
  const branches = input.br01 === 'yes' ? input.branches : [];
  const rowIds = new Set(live.map((c) => c.componentId));
  const tbd = count(COMPONENT_AUDITOR_TYPE.tbd);

  const matrixComplete =
    input.cfsRequired === false
      ? true
      : input.cfsRequired === true &&
        input.expectedComponentIds.every((id) => rowIds.has(id)) &&
        tbd === 0;

  const sa600Required = others.length > 0 || branches.length > 0;
  const pendingOf = (a: Sa600AnswerFacts) =>
    [a.ga02, a.ga03, a.ga04].filter((x) => x === 'pending').length;
  const sa600Pending =
    (sa600Required && input.ga01 !== 'yes' ? 1 : 0) +
    others.reduce((n, c) => n + pendingOf(c), 0) +
    branches.reduce((n, b) => n + pendingOf(b), 0);

  const blockingMatters: string[] = [];
  for (const c of others) {
    if (c.significance !== 'significant') continue;
    if (c.ga04 === 'pending')
      blockingMatters.push(
        `GA-04 is Pending for ${c.componentName}, a significant component — evidence that the other auditor's work is adequate must be obtained before the group audit is completed (SA 600).`,
      );
    else if (c.ga04 === 'no')
      blockingMatters.push(
        `GA-04 is No for ${c.componentName}, a significant component — record the audit response (further work or a reporting impact).`,
      );
  }
  for (const b of branches) {
    if (b.significance === 'significant' && b.ga04 === 'pending')
      blockingMatters.push(
        `GA-04 is Pending for branch ${b.branchName}, a significant branch — the branch auditor's work must be evaluated before completion.`,
      );
  }
  for (const f of input.findings) {
    if (f.status === 'open' && BLOCKING_FINDING_CATEGORIES.includes(f.category))
      blockingMatters.push(
        `${f.ref} (${f.subjectName}) — ${FINDING_CATEGORY_LABEL[f.category].toLowerCase()} is unresolved; record the principal auditor's response.`,
      );
  }

  const byComponent: GroupAuditStatus['byComponent'] = {};
  for (const c of live)
    byComponent[c.componentId] = {
      auditorType: c.auditorType,
      auditorName:
        c.auditorType === COMPONENT_AUDITOR_TYPE.dhvaj ? 'DHVAJ' : c.firmName?.trim() || null,
    };

  return {
    matrixComplete,
    dhvajComponents: count(COMPONENT_AUDITOR_TYPE.dhvaj),
    otherAuditorComponents: others.length,
    tbdComponents: tbd,
    byComponent,
    sa600Required,
    sa600Pending,
    instructionsPending: others.filter((c) => !c.hasInstructions).length,
    pendingReports: live.reduce((n, c) => n + c.pendingPackage, 0),
    branchAuditPresent: input.br01,
    branchAuditors: branches.length,
    branchPending: branches.filter(
      (b) => !b.hasReport || b.conclusion === 'pending' || blank(b.principalResponse),
    ).length,
    workProgrammeGenerated: input.workProgrammeActive,
    blockingMatters,
  };
}

/** Empty status (no 02.6 row / nothing configured yet). */
export function emptyGroupAuditStatus(): GroupAuditStatus {
  return {
    matrixComplete: false,
    dhvajComponents: 0,
    otherAuditorComponents: 0,
    tbdComponents: 0,
    byComponent: {},
    sa600Required: false,
    sa600Pending: 0,
    instructionsPending: 0,
    pendingReports: 0,
    branchAuditPresent: 'pending',
    branchAuditors: 0,
    branchPending: 0,
    workProgrammeGenerated: false,
    blockingMatters: [],
  };
}
