import { createHash } from 'node:crypto';
import {
  CARO_OUTCOME,
  COMPONENT_AUDITOR_TYPE,
  CONSOLIDATION_OUTCOME,
  CONSOLIDATION_OUTCOME_LABEL,
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_CHANGE_TYPE,
  ICFR_OUTCOME_LABEL,
  REPORTING_APPLICABILITY,
  REPORTING_CARD,
  REPORTING_FRAMEWORK_LABEL,
  SCHEDULE_III_OUTCOME_LABEL,
  SMC_STATUS_LABEL,
  type ConsolidationOutcome,
  type DownstreamPreviewItem,
  type FrameworkChangeType,
  type FrameworkImpactItem,
  type FrameworkPriorYearChange,
  type FrameworkSnapshotFacts,
  type FrameworkSourceSection,
  type FrameworkTriggeredRequirement,
  type FrameworkWorkKind,
  type IcfrOutcome,
  type ReportingApplicability,
  type ReportingFrameworkOutcome,
  type ScheduleIiiOutcome,
  type SmcStatus,
} from '@hsdg/contracts';

/**
 * 02.8 Track B engine (spec v1.0 §5, §6, §8, §16). Pure and deterministic — the
 * DI-free readers gather {@link FrameworkRecordInputs} once inside the caller's
 * RLS transaction and every 02.8 list is DERIVED from it, never maintained by
 * hand: an incorrect result is fixed in the originating 02.x assessment.
 *
 *   • triggered requirements (§5) — circumstance-driven SAs only, never a full
 *     SA checklist; each cites a Provision Library code.
 *   • downstream preview (§6) — the 12 configuration rules.
 *   • snapshot facts (§8, §14) — the comparable facts frozen into an approved
 *     baseline; `diffSnapshotFacts` compares two of them for the prior-year
 *     view AND for a revision's change-impact analysis (§16).
 */

/** The 02.1–02.7 facts every Track B rule reads. */
export interface FrameworkRecordInputs {
  initialAudit: boolean;
  sa510: boolean;
  sa402: boolean;
  jointAudit: boolean;
  serviceOrgProvider: string | null;
  jointAuditors: string[];
  accountingEnvironment: string | null;
  accountingSoftware: string[];
  recordsElectronic: string | null;
  /** ACC-04 specialists expected (labels). */
  specialists: string[];
  entityClass: string | null;
  listingAnswer: string | null;
  smallCompanyOutcome: string | null;
  /** Each 02.x outcome: the conclusion when decided, else the system suggestion. */
  outcomes: {
    frf: string | null;
    smc: string | null;
    scheduleIii: string | null;
    caro: string | null;
    icfr: string | null;
    cfs: string | null;
    otherReporting: string | null;
  };
  /** 02.2 framework the group follows (for the consolidation standard cited). */
  groupFramework: string | null;
  /** The 02.6 perimeter (investees). */
  perimeter: Array<{ name: string; relationship: string; included: string }>;
  /** 02.6 group-audit components (non-withdrawn). */
  components: Array<{ name: string; auditorType: string | null; firmName: string | null }>;
  /** 02.6 branches audited by a branch auditor (non-withdrawn). */
  branches: Array<{ name: string; firmName: string | null }>;
  /** 02.7 requirement cards. */
  cards: Array<{ key: string; applicability: ReportingApplicability; requirement: string }>;
  ruleVersions: Array<{ ruleCode: string; versionLabel: string | null }>;
  methodologyVersion: string | null;
}

const ERP_SOFTWARE = new Set(['sap', 'oracle', 'dynamics']);
const SOFTWARE_LABEL: Record<string, string> = {
  tally: 'Tally',
  sap: 'SAP',
  oracle: 'Oracle',
  dynamics: 'Microsoft Dynamics',
  zoho: 'Zoho Books',
};

const applies = (a: ReportingApplicability | undefined) =>
  a === REPORTING_APPLICABILITY.applicable || a === REPORTING_APPLICABILITY.conditional;

function card(inputs: FrameworkRecordInputs, key: string) {
  return inputs.cards.find((c) => c.key === key);
}

/** Components audited by another auditor (SA 600 / §143(8) reliance). */
export function otherAuditorComponents(inputs: FrameworkRecordInputs) {
  return inputs.components.filter(
    (c) => c.auditorType === COMPONENT_AUDITOR_TYPE.otherAuditor && c.name.trim(),
  );
}

export function branchAuditorBranches(inputs: FrameworkRecordInputs) {
  return inputs.branches.filter((b) => b.name.trim() && b.firmName?.trim());
}

export function rule11Cards(inputs: FrameworkRecordInputs) {
  return inputs.cards.filter(
    (c) =>
      c.key.startsWith('rule_11_') &&
      c.key !== REPORTING_CARD.r11gAuditTrail &&
      applies(c.applicability),
  );
}

export function auditTrailApplies(inputs: FrameworkRecordInputs): boolean | null {
  const c = card(inputs, REPORTING_CARD.r11gAuditTrail);
  if (!c || c.applicability === REPORTING_APPLICABILITY.pending) return null;
  return applies(c.applicability);
}

export function s197Applies(inputs: FrameworkRecordInputs): boolean | null {
  const c = card(inputs, REPORTING_CARD.s197Remuneration);
  if (!c || c.applicability === REPORTING_APPLICABILITY.pending) return null;
  return applies(c.applicability);
}

function softwareLabels(inputs: FrameworkRecordInputs): string[] {
  return inputs.accountingSoftware.map((s) => SOFTWARE_LABEL[s] ?? s);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── §5 Triggered auditing requirements ───────────────────────────────────────

export function deriveTriggeredRequirements(
  inputs: FrameworkRecordInputs,
): FrameworkTriggeredRequirement[] {
  const out: FrameworkTriggeredRequirement[] = [];
  const push = (r: Omit<FrameworkTriggeredRequirement, 'authorityProvisionId'>) =>
    out.push({ ...r, authorityProvisionId: null });

  if (inputs.sa510 || inputs.initialAudit)
    push({
      key: 'sa_510',
      requirement: 'SA 510 consideration — opening balances',
      trigger: 'Initial audit engagement',
      source: '02.1',
      downstreamWork: 'Initial balances / predecessor work in Planning and Execution',
      provisionCode: 'SA_510',
    });
  if (inputs.sa402)
    push({
      key: 'sa_402',
      requirement: 'SA 402 consideration — service organisation',
      trigger: inputs.serviceOrgProvider?.trim()
        ? `Service organisation used (${inputs.serviceOrgProvider.trim()})`
        : 'Service organisation used',
      source: '02.1',
      downstreamWork: 'Planning / risk / control procedures',
      provisionCode: 'SA_402',
    });
  if (inputs.jointAudit)
    push({
      key: 'joint_audit',
      requirement: 'SA 299 — joint audit responsibilities',
      trigger: inputs.jointAuditors.length
        ? `Joint audit with ${inputs.jointAuditors.join(', ')}`
        : 'Joint audit',
      source: '02.1',
      downstreamWork: 'Planning, responsibility allocation and reporting',
      provisionCode: 'SA_299',
    });
  const others = otherAuditorComponents(inputs);
  const branchAuditors = branchAuditorBranches(inputs);
  if (others.length || branchAuditors.length) {
    const parts = [
      others.length ? plural(others.length, 'component') : null,
      branchAuditors.length ? plural(branchAuditors.length, 'branch', 'branches') : null,
    ].filter(Boolean);
    push({
      key: 'sa_600',
      requirement: 'SA 600 consideration — using the work of another auditor',
      trigger: `Other / component auditor: ${parts.join(' · ')}`,
      source: '02.6',
      downstreamWork: 'Component instructions / evidence / review',
      provisionCode: 'SA_600',
    });
  }
  if (inputs.specialists.length)
    push({
      key: 'sa_620',
      requirement: "SA 620 — using the work of an auditor's expert",
      trigger: `Expert expected: ${inputs.specialists.join(', ')}`,
      source: '02.1',
      downstreamWork: 'Section 03 specialist planning',
      provisionCode: 'SA_620',
    });
  if (inputs.outcomes.cfs === CONSOLIDATION_OUTCOME.cfsRequired) {
    const indAs = inputs.groupFramework === 'ind_as' || inputs.outcomes.frf === 'ind_as';
    push({
      key: 'cfs',
      requirement: 'Consolidation / group audit considerations',
      trigger: `CFS required (${indAs ? 'Ind AS 110' : 'AS 21'})`,
      source: '02.6',
      downstreamWork: 'Group planning and consolidation work',
      provisionCode: indAs ? 'INDAS_110' : 'AS_21',
    });
  }
  const erp = inputs.accountingSoftware.filter((s) => ERP_SOFTWARE.has(s));
  const trail = auditTrailApplies(inputs);
  if (erp.length || trail === true) {
    const facts = [
      erp.length ? `ERP accounting (${erp.map((s) => SOFTWARE_LABEL[s] ?? s).join(', ')})` : null,
      trail === true ? 'audit trail (Rule 11(g)) applicable' : null,
    ].filter(Boolean);
    push({
      key: 'it_environment',
      requirement: 'SA 315 — IT environment and general IT controls',
      trigger: `Significant IT / accounting environment: ${facts.join('; ')}`,
      source: trail === true && !erp.length ? '02.7' : '02.1',
      downstreamWork: 'Planning / risk / control work',
      provisionCode: 'SA_315',
    });
  }
  return out;
}

// ── §6 Downstream configuration preview ──────────────────────────────────────

const FRF_SHORT: Partial<Record<ReportingFrameworkOutcome, string>> = {
  ind_as: 'Ind AS',
  accounting_standards: 'AS',
};
const DIVISION_SHORT: Partial<Record<ScheduleIiiOutcome, string>> = {
  division_i: 'Schedule III Division I',
  division_ii: 'Schedule III Division II',
  division_iii: 'Schedule III Division III',
};

export function deriveDownstreamPreview(inputs: FrameworkRecordInputs): DownstreamPreviewItem[] {
  const o = inputs.outcomes;
  const items: DownstreamPreviewItem[] = [];
  const pending = (section: string) => `Pending — conclude ${section} first`;

  const frf = FRF_SHORT[o.frf as ReportingFrameworkOutcome];
  const div =
    DIVISION_SHORT[o.scheduleIii as ScheduleIiiOutcome] ??
    (o.scheduleIii ? SCHEDULE_III_OUTCOME_LABEL[o.scheduleIii as ScheduleIiiOutcome] : null);
  items.push({
    key: 'fs_review',
    item: 'Financial Statement Review',
    result: frf && div ? `${frf} + ${div}` : pending(frf ? '02.3' : '02.2'),
    action: frf && div ? 'parameterise' : 'none',
    source: frf ? '02.3' : '02.2',
    ruleKey: 'fs_review.framework_division',
  });

  const yesNo = (
    key: string,
    item: string,
    source: FrameworkSourceSection,
    on: boolean | null,
    section: string,
    ruleKey: string,
    action: DownstreamPreviewItem['action'] = 'create',
  ) =>
    items.push({
      key,
      item,
      result: on == null ? pending(section) : on ? 'Required' : 'Not Required',
      action: on ? action : 'none',
      source,
      ruleKey,
    });

  yesNo(
    'caro_programme',
    'CARO Work Programme',
    '02.4',
    o.caro === CARO_OUTCOME.applicable
      ? true
      : o.caro === CARO_OUTCOME.notApplicableExempt
        ? false
        : null,
    '02.4',
    'caro.applicable',
  );
  yesNo(
    'icfr_programme',
    'ICFR Statutory Work Programme',
    '02.5',
    o.icfr === 'applicable' ? true : o.icfr === 'exempt' ? false : null,
    '02.5',
    'icfr.applicable',
  );
  items.push({
    key: 'internal_controls',
    item: 'Internal Controls Audit Work',
    result: 'Required regardless of statutory ICFR exemption',
    action: 'activate',
    source: '02.5',
    ruleKey: 'controls.always',
  });
  yesNo(
    'consolidation_programme',
    'Consolidation Work Programme',
    '02.6',
    o.cfs === CONSOLIDATION_OUTCOME.cfsRequired
      ? true
      : o.cfs === CONSOLIDATION_OUTCOME.cfsExempt || o.cfs === CONSOLIDATION_OUTCOME.notApplicable
        ? false
        : null,
    '02.6',
    'cfs.required',
  );
  const others = otherAuditorComponents(inputs).length;
  items.push({
    key: 'component_auditor_work',
    item: 'Component Auditor Work',
    result: others ? plural(others, 'component') : 'Not Required',
    action: others ? 'create' : 'none',
    source: '02.6',
    ruleKey: 'group.other_auditor_components',
  });
  const branches = branchAuditorBranches(inputs).length;
  items.push({
    key: 'branch_auditor_work',
    item: 'Branch Auditor Work',
    result: branches ? plural(branches, 'branch', 'branches') : 'Not Required',
    action: branches ? 'create' : 'none',
    source: '02.6',
    ruleKey: 'group.branch_auditors',
  });
  yesNo(
    'audit_trail_workpaper',
    'Audit Trail Workpaper',
    '02.7',
    auditTrailApplies(inputs),
    '02.7',
    'rule_11_g.applicable',
  );
  yesNo(
    's197_workpaper',
    'Section 197(16) Workpaper',
    '02.7',
    s197Applies(inputs),
    '02.7',
    's197_16.applicable',
  );
  const r11 = rule11Cards(inputs).length;
  const r11Known = inputs.cards.some((c) => c.key.startsWith('rule_11_'));
  items.push({
    key: 'rule_11_workpapers',
    item: 'Rule 11 Workpapers',
    result: !r11Known
      ? pending('02.7')
      : r11
        ? `Required as configured in 02.7 (${plural(r11, 'clause')})`
        : 'Not Required',
    action: r11 ? 'create' : 'none',
    source: '02.7',
    ruleKey: 'rule_11.applicable_clauses',
  });
  yesNo(
    'initial_audit_procedures',
    'Initial Audit Procedures',
    '02.1',
    inputs.initialAudit || inputs.sa510,
    '02.1',
    'sa_510.initial_audit',
  );
  items.push({
    key: 'specialist_planning',
    item: 'Specialist Planning',
    result: inputs.specialists.length
      ? `${inputs.specialists.join(', ')} specialist consideration carried to Section 03`
      : 'Not Required',
    action: inputs.specialists.length ? 'create' : 'none',
    source: '02.1',
    ruleKey: 'sa_620.specialists',
  });
  return items;
}

// ── §8 / §14 Snapshot facts ──────────────────────────────────────────────────

const RELATIONSHIP_LABEL: Record<string, string> = {
  subsidiary: 'Subsidiary',
  associate: 'Associate',
  joint_venture: 'Joint venture',
  joint_operation: 'Joint operation',
};

export function snapshotFactsOf(inputs: FrameworkRecordInputs): FrameworkSnapshotFacts {
  const o = inputs.outcomes;
  return {
    entityClass: inputs.entityClass,
    listed: inputs.listingAnswer === 'yes' ? true : inputs.listingAnswer === 'no' ? false : null,
    smallCompany:
      inputs.smallCompanyOutcome === 'small'
        ? true
        : inputs.smallCompanyOutcome === 'not_small' ||
            inputs.smallCompanyOutcome === 'not_applicable'
          ? false
          : null,
    reportingFramework: o.frf,
    smcStatus: o.smc,
    scheduleIiiRoute: o.scheduleIii,
    caro: o.caro,
    icfr: o.icfr,
    cfsRequired:
      o.cfs === CONSOLIDATION_OUTCOME.cfsRequired
        ? true
        : o.cfs === CONSOLIDATION_OUTCOME.cfsExempt || o.cfs === CONSOLIDATION_OUTCOME.notApplicable
          ? false
          : null,
    groupEntities: inputs.perimeter
      .filter((p) => p.relationship && p.relationship !== 'none')
      .map((p) => ({ name: p.name, relationship: p.relationship }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    componentAuditors: otherAuditorComponents(inputs)
      .map((c) => ({ component: c.name, auditor: c.firmName?.trim() || 'Other auditor' }))
      .sort((a, b) => a.component.localeCompare(b.component)),
    branchAuditors: branchAuditorBranches(inputs)
      .map((b) => ({ branch: b.name, auditor: b.firmName!.trim() }))
      .sort((a, b) => a.branch.localeCompare(b.branch)),
    rule11Items: rule11Cards(inputs)
      .map((c) => c.requirement)
      .sort(),
    section197Applicable: s197Applies(inputs),
    accountingSoftware: softwareLabels(inputs).sort(),
    auditTrailApplicable: auditTrailApplies(inputs),
    ruleVersions: [...inputs.ruleVersions].sort((a, b) => a.ruleCode.localeCompare(b.ruleCode)),
    methodologyVersion: inputs.methodologyVersion,
  };
}

// ── §8 / §16 Facts diff ──────────────────────────────────────────────────────

const yn = (v: boolean | null) => (v == null ? null : v ? 'Yes' : 'No');
const frfLabel = (v: string | null) =>
  v ? (REPORTING_FRAMEWORK_LABEL[v as ReportingFrameworkOutcome] ?? v) : null;
const smcLabel = (v: string | null) => (v ? (SMC_STATUS_LABEL[v as SmcStatus] ?? v) : null);
const divLabel = (v: string | null) =>
  v ? (SCHEDULE_III_OUTCOME_LABEL[v as ScheduleIiiOutcome] ?? v) : null;
const caroLabel = (v: string | null) =>
  v === CARO_OUTCOME.applicable
    ? 'Applicable'
    : v === CARO_OUTCOME.notApplicableExempt
      ? 'Exempt'
      : v
        ? v.replace(/_/g, ' ')
        : null;
const icfrLabel = (v: string | null) => (v ? (ICFR_OUTCOME_LABEL[v as IcfrOutcome] ?? v) : null);
const cfsLabel = (v: boolean | null) =>
  v == null ? null : v ? 'CFS required' : 'CFS not required';
const relLabel = (r: string) => RELATIONSHIP_LABEL[r] ?? r.replace(/_/g, ' ');

/** A decided-looking value: undecided / pending outcomes are not compared. */
const UNDECIDED = new Set([
  'information_insufficient',
  'professional_review_required',
  'further_assessment',
  'pending',
]);
const comparable = (v: string | boolean | null | undefined) =>
  v != null && !(typeof v === 'string' && UNDECIDED.has(v));

/**
 * The meaningful changes between two snapshot facts (§8). A side that was never
 * captured (null / undecided) is not a change — only decided values compare.
 */
export function diffSnapshotFacts(
  prev: Partial<FrameworkSnapshotFacts> | null | undefined,
  cur: FrameworkSnapshotFacts,
): FrameworkPriorYearChange[] {
  if (!prev) return [];
  const out: FrameworkPriorYearChange[] = [];
  const scalar = <T extends string | boolean | null>(
    changeType: FrameworkChangeType,
    label: string,
    source: FrameworkSourceSection,
    a: T | undefined,
    b: T,
    fmt: (v: T) => string | null,
  ) => {
    if (!comparable(a ?? null) || !comparable(b)) return;
    if (a === b) return;
    out.push({ changeType, label, previous: fmt(a as T), current: fmt(b), source });
  };
  const T = FRAMEWORK_CHANGE_TYPE;
  scalar(
    T.entityClassification,
    'Entity class',
    '02.1',
    prev.entityClass,
    cur.entityClass,
    (v) => v,
  );
  scalar(T.entityClassification, 'Listed status', '02.1', prev.listed, cur.listed, (v) =>
    v == null ? null : v ? 'Listed' : 'Unlisted',
  );
  scalar(
    T.entityClassification,
    'Small Company status',
    '02.1',
    prev.smallCompany,
    cur.smallCompany,
    (v) => (v == null ? null : v ? 'Small Company' : 'Not a Small Company'),
  );
  scalar(
    T.reportingFramework,
    'Reporting framework',
    '02.2',
    prev.reportingFramework,
    cur.reportingFramework,
    frfLabel,
  );
  scalar(T.reportingFramework, 'SMC status', '02.2', prev.smcStatus, cur.smcStatus, smcLabel);
  scalar(
    T.scheduleIii,
    'Schedule III route',
    '02.3',
    prev.scheduleIiiRoute,
    cur.scheduleIiiRoute,
    divLabel,
  );
  scalar(T.caro, 'CARO 2020', '02.4', prev.caro, cur.caro, caroLabel);
  scalar(T.icfr, 'ICFR reporting', '02.5', prev.icfr, cur.icfr, icfrLabel);
  scalar(
    T.groupStructure,
    'Consolidated financial statements',
    '02.6',
    prev.cfsRequired,
    cur.cfsRequired,
    cfsLabel,
  );

  const before = new Map((prev.groupEntities ?? []).map((g) => [g.name.toLowerCase(), g]));
  const after = new Map(cur.groupEntities.map((g) => [g.name.toLowerCase(), g]));
  for (const [k, g] of after) {
    const p = before.get(k);
    if (!p)
      out.push({
        changeType: T.groupStructure,
        label: `New ${relLabel(g.relationship).toLowerCase()}: ${g.name}`,
        previous: null,
        current: relLabel(g.relationship),
        source: '02.6',
      });
    else if (p.relationship !== g.relationship)
      out.push({
        changeType: T.groupStructure,
        label: `Relationship changed: ${g.name}`,
        previous: relLabel(p.relationship),
        current: relLabel(g.relationship),
        source: '02.6',
      });
  }
  for (const [k, g] of before)
    if (!after.has(k))
      out.push({
        changeType: T.groupStructure,
        label: `Disposed / no longer in group: ${g.name}`,
        previous: relLabel(g.relationship),
        current: null,
        source: '02.6',
      });

  const auditorDiff = (
    kind: string,
    a: Array<{ name: string; auditor: string }>,
    b: Array<{ name: string; auditor: string }>,
  ) => {
    const pa = new Map(a.map((x) => [x.name.toLowerCase(), x]));
    for (const x of b) {
      const p = pa.get(x.name.toLowerCase());
      if (!p || p.auditor.toLowerCase() !== x.auditor.toLowerCase())
        out.push({
          changeType: T.otherAuditor,
          label: p ? `Change in ${kind} auditor: ${x.name}` : `New ${kind} auditor: ${x.name}`,
          previous: p?.auditor ?? null,
          current: x.auditor,
          source: '02.6',
        });
    }
  };
  auditorDiff(
    'component',
    (prev.componentAuditors ?? []).map((c) => ({ name: c.component, auditor: c.auditor })),
    cur.componentAuditors.map((c) => ({ name: c.component, auditor: c.auditor })),
  );
  auditorDiff(
    'branch',
    (prev.branchAuditors ?? []).map((c) => ({ name: c.branch, auditor: c.auditor })),
    cur.branchAuditors.map((c) => ({ name: c.branch, auditor: c.auditor })),
  );

  if (prev.rule11Items) {
    const was = new Set(prev.rule11Items);
    const now = new Set(cur.rule11Items);
    for (const r of cur.rule11Items)
      if (!was.has(r))
        out.push({
          changeType: T.statutoryReporting,
          label: `New Rule 11 requirement: ${r}`,
          previous: 'Not applicable',
          current: 'Applicable',
          source: '02.7',
        });
    for (const r of prev.rule11Items)
      if (!now.has(r))
        out.push({
          changeType: T.statutoryReporting,
          label: `Rule 11 requirement no longer applicable: ${r}`,
          previous: 'Applicable',
          current: 'Not applicable',
          source: '02.7',
        });
  }
  scalar(
    T.statutoryReporting,
    'Section 197(16) reporting',
    '02.7',
    prev.section197Applicable,
    cur.section197Applicable,
    (v) => (v == null ? null : v ? 'Applicable' : 'Not applicable'),
  );

  const sw = (v: string[] | undefined) => (v && v.length ? [...v].sort().join(', ') : null);
  const swPrev = sw(prev.accountingSoftware);
  const swCur = sw(cur.accountingSoftware);
  if (swPrev && swCur && swPrev !== swCur)
    out.push({
      changeType: T.systems,
      label: 'Accounting software',
      previous: swPrev,
      current: swCur,
      source: '02.1',
    });
  scalar(
    T.systems,
    'Audit trail (Rule 11(g)) environment',
    '02.7',
    prev.auditTrailApplicable,
    cur.auditTrailApplicable,
    (v) => (v == null ? null : v ? 'Applicable' : 'Not applicable'),
  );

  if (prev.ruleVersions) {
    const pv = new Map(prev.ruleVersions.map((r) => [r.ruleCode, r.versionLabel]));
    for (const r of cur.ruleVersions)
      if (pv.has(r.ruleCode) && pv.get(r.ruleCode) !== r.versionLabel)
        out.push({
          changeType: T.lawMethodology,
          label: `Rule version: ${r.ruleCode}`,
          previous: pv.get(r.ruleCode) ?? null,
          current: r.versionLabel,
          source: 'other_areas',
        });
  }
  if (
    prev.methodologyVersion &&
    cur.methodologyVersion &&
    prev.methodologyVersion !== cur.methodologyVersion
  )
    out.push({
      changeType: T.lawMethodology,
      label: 'Methodology version',
      previous: prev.methodologyVersion,
      current: cur.methodologyVersion,
      source: 'other_areas',
    });
  return out;
}

// ── §16 Change impact ────────────────────────────────────────────────────────

/** A downstream work item that may be affected by a framework change. */
export interface DownstreamWorkItem {
  kind: FrameworkWorkKind;
  ref: string;
  label: string;
  /** The 02.x section that configured the work. */
  section: FrameworkSourceSection;
  /** The framework area / change types the work was configured from. */
  changeTypes: FrameworkChangeType[];
  ownerEmployeeId: string | null;
  ownerName: string | null;
  completed: boolean;
  /** The work's state when linked (e.g. "complete", "in_progress"). */
  state: string | null;
}

interface ImpactRule {
  affectedSection: string;
  newWork: (c: FrameworkPriorYearChange) => string[];
}

const turnedOn = (c: FrameworkPriorYearChange, on: string) => c.current === on;

const IMPACT_RULES: Record<FrameworkChangeType, ImpactRule> = {
  entity_classification: {
    affectedSection: '02.7 reporting · Section 08 Reporting',
    newWork: () => ['Reassess Section 197(16) and other applicable reporting'],
  },
  reporting_framework: {
    affectedSection: 'Section 03 Planning · FS review · Section 08 Reporting',
    newWork: () => ['Reconfigure FS framework, Schedule III, disclosures and planning'],
  },
  schedule_iii: {
    affectedSection: 'FS review · Section 08 Reporting',
    newWork: () => ['Reconfigure FS presentation (Schedule III division) and disclosure checks'],
  },
  caro: {
    affectedSection: 'Section 04 Execution · Section 07 Completion · Section 08 Reporting',
    newWork: (c) =>
      turnedOn(c, 'Applicable')
        ? ['Create CARO work programme', 'Reassess planning, completion and reporting']
        : ['Withdraw CARO work programme (completed work preserved)', 'Reassess reporting'],
  },
  icfr: {
    affectedSection: 'Section 05 Controls · Section 08 Reporting',
    newWork: (c) =>
      c.current === ICFR_OUTCOME_LABEL.applicable
        ? ['Create statutory ICFR workstream', 'Reassess Section 05 scope and reporting']
        : [
            'Withdraw statutory ICFR workstream (normal control work continues)',
            'Reassess reporting',
          ],
  },
  group_structure: {
    affectedSection: 'Section 03 Planning · Group audit · Section 08 Reporting',
    newWork: (c) =>
      c.current === 'CFS required'
        ? [
            'Create consolidation / group work',
            'Component planning, group materiality and CFS reporting',
          ]
        : c.current == null
          ? ['Remove component from the perimeter; reassess consolidation work']
          : ['Update consolidation perimeter and component planning'],
  },
  other_auditor: {
    affectedSection: 'Group audit (SA 600) · Section 08 Reporting',
    newWork: () => ['Activate SA 600 component instructions and evidence requirements'],
  },
  statutory_reporting: {
    affectedSection: '02.7 workpapers · Section 08 Reporting',
    newWork: (c) =>
      c.current === 'Applicable'
        ? [`Create workpaper: ${c.label.replace(/^New Rule 11 requirement: /, '')}`]
        : ['Mark the workpaper not required (completed work preserved)'],
  },
  systems: {
    affectedSection: 'Section 05 Controls · 02.7 Rule 11(g)',
    newWork: (c) =>
      c.label.startsWith('Audit trail') && c.current === 'Applicable'
        ? ['Create Rule 11(g) audit trail workpaper', 'IT / control cross-references']
        : ['Reassess IT environment and control reliance'],
  },
  law_methodology: {
    affectedSection: 'Impacted framework rules',
    newWork: () => ['Re-evaluate impacted framework rules only'],
  },
};

/** Which downstream work a change type touches (§16 "existing work affected"). */
export const WORK_AREAS_BY_CHANGE: Record<FrameworkChangeType, string[]> = {
  entity_classification: [FRAMEWORK_AREA_KEY.otherRegulatory, FRAMEWORK_AREA_KEY.section143],
  reporting_framework: [
    FRAMEWORK_AREA_KEY.financialReportingFramework,
    FRAMEWORK_AREA_KEY.indAsAs,
    FRAMEWORK_AREA_KEY.scheduleIii,
  ],
  schedule_iii: [FRAMEWORK_AREA_KEY.scheduleIii],
  caro: [FRAMEWORK_AREA_KEY.caro],
  icfr: [FRAMEWORK_AREA_KEY.ifc],
  group_structure: [FRAMEWORK_AREA_KEY.cfs],
  other_auditor: [FRAMEWORK_AREA_KEY.cfs],
  statutory_reporting: [FRAMEWORK_AREA_KEY.rule11, FRAMEWORK_AREA_KEY.otherRegulatory],
  systems: [FRAMEWORK_AREA_KEY.rule11],
  law_methodology: [],
};

/**
 * The automatic first pass (§16): per change — affected downstream section,
 * existing work affected, new work required, completed work to reassess, owner
 * and whether reapproval is required (always, since a conclusion changed).
 */
export function impactItemsFor(
  changes: readonly FrameworkPriorYearChange[],
  work: readonly DownstreamWorkItem[],
  defaultOwner: string | null,
): FrameworkImpactItem[] {
  return changes.map((c, i) => {
    const rule = IMPACT_RULES[c.changeType];
    const touched = work.filter((w) => w.changeTypes.includes(c.changeType));
    return {
      key: `${c.changeType}:${i}:${c.label}`,
      label: c.label,
      from: c.previous,
      to: c.current,
      affectedSection: rule.affectedSection,
      existingWorkAffected: touched.filter((w) => !w.completed).map((w) => w.label),
      newWorkRequired: rule.newWork(c),
      completedWorkToReassess: touched.filter((w) => w.completed).map((w) => w.label),
      ownerName: touched.find((w) => w.ownerName)?.ownerName ?? defaultOwner,
      approvalRequired: true,
    };
  });
}

/** Stable fingerprint of a first pass — a later fact change voids a confirmation. */
export function impactFingerprint(items: readonly FrameworkImpactItem[]): string {
  const basis = items
    .map((i) => [i.label, i.from, i.to])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 32);
}

/** Reporting implications of a revision, for Section 07 / 08 (§17). */
export function reportingImpactsOf(changes: readonly FrameworkPriorYearChange[]): string[] {
  const reporting = new Set<FrameworkChangeType>([
    'entity_classification',
    'reporting_framework',
    'schedule_iii',
    'caro',
    'icfr',
    'group_structure',
    'other_auditor',
    'statutory_reporting',
    'systems',
  ]);
  return changes
    .filter((c) => reporting.has(c.changeType))
    .map((c) => `${c.label}: ${c.previous ?? '—'} → ${c.current ?? '—'}`);
}

/** 02.6 outcome label (the Consolidation dashboard wording). */
export function consolidationLabel(v: string | null): string | null {
  return v ? (CONSOLIDATION_OUTCOME_LABEL[v as ConsolidationOutcome] ?? v) : null;
}

/** The 02.x source of an aggregated matter, from its `source` key (§7). */
export function matterSourceOf(source: string | null): FrameworkSourceSection {
  const area = (source ?? '').split(':')[1] ?? '';
  switch (area) {
    case FRAMEWORK_AREA_KEY.entityRegulatoryProfile:
    case '02.1':
      return '02.1';
    case FRAMEWORK_AREA_KEY.financialReportingFramework:
    case FRAMEWORK_AREA_KEY.indAsAs:
    case '02.2':
      return '02.2';
    case FRAMEWORK_AREA_KEY.scheduleIii:
    case '02.3':
      return '02.3';
    case FRAMEWORK_AREA_KEY.caro:
    case '02.4':
      return '02.4';
    case FRAMEWORK_AREA_KEY.ifc:
    case '02.5':
      return '02.5';
    case FRAMEWORK_AREA_KEY.cfs:
    case '02.6':
      return '02.6';
    case FRAMEWORK_AREA_KEY.otherRegulatory:
    case FRAMEWORK_AREA_KEY.section143:
    case FRAMEWORK_AREA_KEY.rule11:
    case '02.7':
      return '02.7';
    default:
      return 'other_areas';
  }
}

export { yn };
