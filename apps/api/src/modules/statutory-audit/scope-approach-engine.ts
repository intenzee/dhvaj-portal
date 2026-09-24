import {
  AP01_LABEL,
  DECISION_STATUS_LABEL,
  FS_COVERED_LABEL,
  INVENTORY_DECISION_LABEL,
  OB01_LABEL,
  OTHER_AUDITOR_STRATEGY_LABEL,
  SCOPE_EXCLUDING_CONCLUSIONS,
  SIGNIFICANT_DEPENDENCY_IMPACTS,
  SO01_LABEL,
  SPECIALIST_DECISION_LABEL,
  UNIT_AUDITOR_LABEL,
  type ConfirmationArea,
  type FsCovered,
  type PartnerAttentionTrigger,
  type PlanningAttention,
  type PlanningCompletionCheck,
  type ScopeApproachRecord,
  type ScopeConsideration,
  type ScopeConsistencyCheck,
  type ScopeDecision,
  type ScopeDependency,
  type ScopeLimitation,
  type ScopeMapItem,
  type ScopePartnerAction,
  type ScopeServiceOrg,
  type ScopeTriggers,
  type ScopeUnit,
  type ScopeUnitType,
  type SpecialConsiderationTag,
  type StrategyConsideration,
  type UnitAuditor,
  type UnitRelevance,
} from '@hsdg/contracts';

/**
 * 03.4 Audit Scope & Approach — pure engine. Derives the Audit Population,
 * preliminary map areas, special-approach implications and specialist prompts
 * from facts already recorded in Section 02 / 03.1 / 03.2 / 03.3, and evaluates
 * the §24 consistency checks, Partner Attention triggers and §29 completion.
 * Nothing here concludes on scope: materiality is context, never an exclusion
 * rule, and planned controls reliance is never labelled effective.
 */

export interface ScopeSignalFact {
  id: string;
  code: string;
  observation: string;
  potentialImplications: string | null;
  ruleKey: string | null;
  attention: PlanningAttention;
  destinations: string[];
}

export interface ScopeInvesteeFact {
  name: string;
  relationship: string | null;
  auditedByOtherAuditor: boolean;
}

export interface ScopeFacts {
  entityName: string | null;
  initialAudit: boolean;
  jointAudit: boolean;
  accountingEnvironment: string | null;
  sa402: boolean;
  frameworkConclusions: Record<string, string>;
  investees: ScopeInvesteeFact[];
  hasBranches: boolean;
  /** 03.2 canonical metrics — dataset units. */
  metrics: Record<string, { cy: number | null; py: number | null }>;
  /** Dataset units → rupees; null when not convertible / not ready. */
  unitFactor: number | null;
  overallMateriality: number | null;
  performanceMateriality: number | null;
  specific: { scope: string; amount: number | null; affectedAreas: string[] }[];
  signals: ScopeSignalFact[];
  focusNames: string[];
  changeCategories: string[];
  erpChange: boolean;
  cycles: string[];
  otherSystems: string[];
  customerTypes: string[];
  serviceOrgContext: string | null;
  revenueAnalyticsFlag: boolean;
}

const lc = (s: string) => s.toLowerCase();
const fw = (f: ScopeFacts, key: string) => f.frameworkConclusions[key] === 'applicable';
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// ── Triggers ─────────────────────────────────────────────────────────────────

export function deriveTriggers(
  f: ScopeFacts,
  units: Pick<ScopeUnit, 'unitType' | 'auditor'>[],
): ScopeTriggers {
  const cfs = fw(f, 'cfs') && f.investees.length > 0;
  const inv = f.metrics.inventory?.cy ?? null;
  const invInr = inv !== null && f.unitFactor ? inv * f.unitFactor : null;
  const threshold = f.performanceMateriality ?? f.overallMateriality;
  let inventoryReason: string | null = null;
  if (invInr !== null && invInr > 0) {
    inventoryReason =
      threshold !== null && invInr >= threshold
        ? `Inventory of ${inr(invInr)} (03.2) is at or above ${f.performanceMateriality !== null ? 'performance' : 'overall'} materiality.`
        : `Inventory of ${inr(invInr)} is recorded in 03.2 — decide whether it is material / relevant.`;
  } else if (f.cycles.includes('Inventory')) {
    inventoryReason = 'Inventory is a key transaction cycle in 03.2.';
  } else if (units.some((u) => u.unitType === 'warehouse' || u.unitType === 'plant')) {
    inventoryReason = 'A warehouse / plant is in the Audit Population.';
  }
  return {
    initialAudit: f.initialAudit,
    jointAudit: f.jointAudit,
    serviceOrganisation:
      f.sa402 ||
      f.accountingEnvironment === 'outsourced_service_organisation' ||
      f.accountingEnvironment === 'hybrid',
    internalAuditFunction: fw(f, 'internal_audit'),
    icfrApplicable: fw(f, 'ifc') || fw(f, 'icfr'),
    caroApplicable: fw(f, 'caro'),
    cfsApplicable: cfs,
    hasBranches: f.hasBranches,
    otherAuditors:
      f.jointAudit ||
      f.hasBranches ||
      f.investees.some((i) => i.auditedByOtherAuditor) ||
      units.some((u) => u.auditor !== 'dhvaj'),
    inventoryRelevant: inventoryReason !== null,
    inventoryReason,
    suggestedFsCovered: (cfs ? 'both' : 'standalone') as FsCovered,
  };
}

// ── Audit Population (SC-03) ─────────────────────────────────────────────────

export interface GeneratedUnit {
  unitKey: string;
  name: string;
  unitType: ScopeUnitType;
  auditor: UnitAuditor;
  sourceLabel: string;
  relevance: UnitRelevance[];
  finMetric: string | null;
  finAmount: number | null;
  finSource: string | null;
}

const slug = (s: string) =>
  lc(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'unit';

/** Units derived from known facts. Generation is idempotent by `unitKey`. */
export function generatePopulation(f: ScopeFacts): GeneratedUnit[] {
  const out: GeneratedUnit[] = [];
  const rev = f.metrics.revenue?.cy ?? null;
  out.push({
    unitKey: 'entity',
    name: f.entityName ?? 'Reporting entity',
    unitType: 'entity',
    auditor: f.jointAudit ? 'joint_auditor' : 'dhvaj',
    sourceLabel: 'Engagement / 02.1',
    relevance: ['financial_significance'],
    finMetric: rev !== null ? 'Revenue from operations' : null,
    finAmount: rev !== null && f.unitFactor ? rev * f.unitFactor : null,
    finSource: rev !== null ? '03.2 financial dataset' : null,
  });
  if (fw(f, 'cfs')) {
    for (const i of f.investees) {
      out.push({
        unitKey: `investee:${slug(i.name)}`,
        name: i.name,
        unitType: 'component',
        auditor: i.auditedByOtherAuditor ? 'component_auditor' : 'dhvaj',
        sourceLabel: `02.6${i.relationship ? ` — ${i.relationship.replace(/_/g, ' ')}` : ''}`,
        relevance: ['group_reporting'],
        finMetric: null,
        finAmount: null,
        finSource: null,
      });
    }
  }
  if (f.hasBranches) {
    out.push({
      unitKey: 'branches',
      name: 'Branch(es) audited by branch auditor',
      unitType: 'branch',
      auditor: 'branch_auditor',
      sourceLabel: '02.6 — §143(8) branches',
      relevance: [],
      finMetric: null,
      finAmount: null,
      finSource: null,
    });
  }
  if (
    f.accountingEnvironment === 'outsourced_service_organisation' ||
    f.accountingEnvironment === 'hybrid' ||
    f.sa402
  ) {
    out.push({
      unitKey: 'service_org:accounting',
      name: 'Outsourced accounting / processing service provider',
      unitType: 'service_organisation',
      auditor: 'dhvaj',
      sourceLabel: '02.1 accounting environment',
      relevance: ['controls_relevance'],
      finMetric: null,
      finAmount: null,
      finSource: null,
    });
  }
  return out;
}

/** Amount relative to overall materiality — context only, never an exclusion. */
export function materialityContext(amount: number | null, om: number | null): string | null {
  if (amount === null || om === null || om <= 0) return null;
  const x = amount / om;
  return x >= 1
    ? `${x.toFixed(1)}× OM`
    : `Below OM (${(x * 100).toFixed(0)}% of OM) — not excluded on that basis`;
}

// ── Preliminary Audit Approach Map (§23) ────────────────────────────────────

export interface GeneratedMapArea {
  areaKey: string;
  name: string;
  metricKey: string | null;
  sourceLabel: string;
  suggestedSpecial: SpecialConsiderationTag[];
}

const METRIC_AREAS: [string, string, SpecialConsiderationTag[]][] = [
  ['revenue', 'Revenue', []],
  ['trade_receivables', 'Trade receivables', []],
  ['inventory', 'Inventory', ['physical_attendance']],
  ['ppe', 'Property, plant & equipment', []],
  ['investments', 'Investments', []],
  ['cash_bank', 'Cash & bank', []],
  ['trade_payables', 'Trade payables / procurement', []],
  ['total_borrowings', 'Borrowings', []],
  ['employee_cost', 'Employee benefits / payroll', []],
  ['related_party', 'Related parties', []],
];

export function generateMapAreas(f: ScopeFacts, triggers: ScopeTriggers): GeneratedMapArea[] {
  const out: GeneratedMapArea[] = [];
  for (const [key, name, special] of METRIC_AREAS) {
    const m = f.metrics[key];
    if (m && (m.cy !== null || m.py !== null)) {
      const tags = [...special];
      if (key === 'employee_cost' && triggers.serviceOrganisation)
        tags.push('service_organisation');
      out.push({
        areaKey: key,
        name,
        metricKey: key,
        sourceLabel: '03.2 financial dataset',
        suggestedSpecial: tags,
      });
    }
  }
  out.push({
    areaKey: 'financial_close',
    name: 'Financial close & reporting',
    metricKey: null,
    sourceLabel: 'Every engagement',
    suggestedSpecial: f.erpChange ? ['technology'] : [],
  });
  if (triggers.cfsApplicable) {
    out.push({
      areaKey: 'consolidation',
      name: 'Consolidation',
      metricKey: null,
      sourceLabel: '02.6 CFS',
      suggestedSpecial: ['component'],
    });
  }
  if (triggers.initialAudit) {
    out.push({
      areaKey: 'opening_balances',
      name: 'Opening balances',
      metricKey: null,
      sourceLabel: '02.1 initial audit',
      suggestedSpecial: ['opening_balance'],
    });
  }
  return out;
}

/** Specific-materiality records that plausibly touch a map area (context for the Manager). */
export function specificFor(areaName: string, f: ScopeFacts): string[] {
  const words = lc(areaName)
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3);
  return f.specific
    .filter((s) => {
      const hay = lc([s.scope, ...s.affectedAreas].join(' '));
      return words.some((w) => hay.includes(w));
    })
    .map((s) => (s.amount !== null ? `${s.scope} (${inr(s.amount)})` : `${s.scope} (qualitative)`));
}

// ── §20 special approach implications / §17 specialists ─────────────────────

export interface GeneratedConsideration {
  key: string;
  kind: 'implication' | 'specialist';
  signalId: string | null;
  sourceLabel: string;
  observation: string;
  suggestion: string | null;
  attention: PlanningAttention;
}

export function generateImplications(
  f: ScopeFacts,
  triggers: ScopeTriggers,
  warehouses: number,
): GeneratedConsideration[] {
  const out: GeneratedConsideration[] = [];
  const add = (
    key: string,
    sourceLabel: string,
    observation: string,
    suggestion: string,
    attention: PlanningAttention = 'standard',
  ) =>
    out.push({
      key: `fact:${key}`,
      kind: 'implication',
      signalId: null,
      sourceLabel,
      observation,
      suggestion,
      attention,
    });
  const changed = (c: string) => f.changeCategories.includes(c);

  if (f.erpChange || changed('erp_accounting_system'))
    add(
      'erp_change',
      '03.1 / 03.2',
      'New ERP / system migration during the year.',
      'Greater IT / control / data-quality focus; consider data migration and technology strategy.',
      'enhanced',
    );
  if (changed('acquisition_disposal'))
    add(
      'acquisition_disposal',
      '03.1 PI-01',
      'Acquisition / disposal during the year.',
      'Accounting / specialist / enhanced review consideration.',
      'enhanced',
    );
  if (
    changed('accounting_policies') ||
    f.focusNames.some((n) => /estimat|valuation|impair/i.test(n))
  )
    add(
      'significant_estimate',
      '03.1',
      'Significant estimate or accounting-policy change.',
      'Enhanced senior / Partner / specialist involvement.',
      'enhanced',
    );
  if (f.revenueAnalyticsFlag)
    add(
      'revenue_analytics',
      '03.2 analytics',
      'Revenue pressure / unusual revenue analytics.',
      'Greater year-end / substantive / analytics attention on revenue.',
      'enhanced',
    );
  if (warehouses >= 2)
    add(
      'multiple_warehouses',
      '03.4 population',
      `${warehouses} warehouses / plants in the Audit Population.`,
      'Inventory location / attendance planning.',
    );
  if (triggers.serviceOrganisation)
    add(
      'service_org',
      '02.1',
      'A service organisation is used for financially relevant processing.',
      'SA 402 consideration (SO-01 card).',
    );
  if (triggers.initialAudit)
    add(
      'initial_audit',
      '02.1',
      'Initial audit engagement.',
      'Opening-balance strategy (OB-01, SA 510).',
      'enhanced',
    );
  if (triggers.cfsApplicable)
    add(
      'cfs_components',
      '02.6',
      'Consolidated financial statements / components.',
      'Group / component strategy; detailed planning in 03.9.',
    );
  if (changed('litigation'))
    add(
      'litigation',
      '03.1 PI-01',
      'Significant litigation.',
      'External / legal evidence consideration (legal confirmations).',
      'enhanced',
    );

  for (const s of f.signals) {
    if (!s.destinations.includes('03.4')) continue;
    out.push({
      key: `signal:${s.id}`,
      kind: 'implication',
      signalId: s.id,
      sourceLabel: s.code,
      observation: s.observation,
      suggestion: s.potentialImplications,
      attention: s.attention,
    });
  }
  return out;
}

/** Specialist-related signals (routed to 03.8) become specialist decisions. */
export function generateSpecialists(f: ScopeFacts): GeneratedConsideration[] {
  return f.signals
    .filter((s) => s.destinations.includes('03.8'))
    .map((s) => ({
      key: `signal:${s.id}`,
      kind: 'specialist' as const,
      signalId: s.id,
      sourceLabel: s.code,
      observation: s.observation,
      suggestion:
        "Decide whether an auditor's expert / specialist is likely required (detail in 03.8).",
      attention: s.attention,
    }));
}

// ── §8 approach considerations + decision prompts ───────────────────────────

export function approachConsiderations(
  f: ScopeFacts,
  triggers: ScopeTriggers,
): StrategyConsideration[] {
  const out: StrategyConsideration[] = [];
  if (
    f.otherSystems.includes('Billing') ||
    f.customerTypes.some((c) => /retail|b2c|consumer/i.test(c))
  )
    out.push({
      key: 'high_volume',
      label: 'High-volume recurring transactions',
      detail: 'May suggest considering a controls / technology strategy.',
    });
  const controlSignals = f.signals.filter(
    (s) => /control|deficien/i.test(s.observation) && s.attention !== 'standard',
  );
  if (controlSignals.length)
    out.push({
      key: 'control_concerns',
      label: 'Prior / current control concerns',
      detail: `${controlSignals.map((s) => s.code).join(', ')} — may challenge anticipated reliance.`,
    });
  if (triggers.icfrApplicable)
    out.push({
      key: 'icfr',
      label: 'ICFR reporting applicable',
      detail:
        'A separate statutory ICFR workstream exists; ICFR reporting is not the same as controls reliance for the FS audit.',
    });
  if (
    f.changeCategories.includes('accounting_policies') ||
    f.changeCategories.includes('acquisition_disposal')
  )
    out.push({
      key: 'estimates',
      label: 'Significant estimates / non-routine transactions',
      detail: 'May suggest enhanced substantive / specialist consideration.',
    });
  if (triggers.initialAudit)
    out.push({
      key: 'initial_audit',
      label: 'Initial audit / weak historical evidence',
      detail: 'May affect the substantive / evidence strategy.',
    });
  return out;
}

export function decisionPrompt(
  d: Pick<ScopeDecision, 'kind' | 'itemKey' | 'status'>,
  all: Pick<ScopeDecision, 'kind' | 'itemKey' | 'status'>[],
): string | null {
  if (d.kind !== 'timing') return null;
  const reliance = all.filter(
    (x) => x.kind === 'controls_cycle' && x.status === 'reliance_contemplated',
  );
  const interim = d.status === 'interim' || d.status === 'both';
  if (d.itemKey === 'controls' && reliance.length && interim)
    return `Reliance contemplated (${reliance.map((r) => r.itemKey.replace(/_/g, ' ')).join(', ')}) with interim controls work — roll-forward to year-end is likely required.`;
  if (d.itemKey === 'receivables' && interim)
    return 'Interim balance work — assess roll-forward to the reporting date.';
  if (d.itemKey === 'revenue' && interim)
    return 'Interim transaction work — assess remaining-period work.';
  if (d.itemKey === 'inventory' && (d.status === 'interim' || d.status === 'count_date'))
    return 'Count before the reporting date — assess movement / reconciliation to year-end.';
  return null;
}

export function suggestedConfirmationAreas(f: ScopeFacts): ConfirmationArea[] {
  const has = (k: string) => f.metrics[k]?.cy != null;
  const out: ConfirmationArea[] = [];
  if (has('cash_bank')) out.push('banks');
  if (has('trade_receivables')) out.push('receivables');
  if (has('trade_payables')) out.push('payables');
  if (has('total_borrowings')) out.push('loans');
  if (has('investments')) out.push('investments');
  if (f.changeCategories.includes('litigation')) out.push('legal_matters');
  if (has('related_party')) out.push('related_party_balances');
  return out;
}

// ── §24 consistency checks ──────────────────────────────────────────────────

export interface ScopeState {
  record: ScopeApproachRecord;
  triggers: ScopeTriggers;
  units: ScopeUnit[];
  decisions: ScopeDecision[];
  serviceOrgs: ScopeServiceOrg[];
  considerations: ScopeConsideration[];
  dependencies: ScopeDependency[];
  limitations: ScopeLimitation[];
  mapItems: ScopeMapItem[];
  partnerActions: ScopePartnerAction[];
}

const live = <T extends { noLongerTriggered: boolean }>(xs: T[]) =>
  xs.filter((x) => !x.noLongerTriggered);

export function consistencyChecks(s: ScopeState): ScopeConsistencyCheck[] {
  const { record: r, triggers: t } = s;
  const out: ScopeConsistencyCheck[] = [];
  const check = (
    key: string,
    label: string,
    severity: 'blocking' | 'challenge',
    met: boolean,
    detail: string,
  ) => out.push({ key, label, severity, met, detail: met ? null : detail });

  if (t.initialAudit)
    check(
      'opening_balances',
      'Initial audit → opening-balance strategy',
      'blocking',
      r.ob01 !== null,
      'Complete the OB-01 opening-balance strategy (SA 510).',
    );

  if (t.inventoryRelevant) {
    const owned = s.dependencies.some(
      (d) =>
        d.status !== 'resolved' &&
        /inventor|stock|count/i.test(`${d.description} ${d.affected ?? ''}`) &&
        (d.ownerEmployeeId !== null || d.ownerParty !== 'engagement_team'),
    );
    const pending =
      r.inventoryDecision === 'alternative_assessment' ||
      r.inventoryDecision === 'information_required';
    check(
      'inventory_attendance',
      'Material / relevant inventory → attendance or alternative assessment',
      'blocking',
      r.inventoryDecision !== null && (!pending || owned),
      r.inventoryDecision === null
        ? 'Record the physical attendance strategy for inventory (SA 501).'
        : 'An unresolved inventory decision must be owned — add an owned Scope Dependency for inventory.',
    );
  }

  if (t.serviceOrganisation)
    check(
      'service_org_sa402',
      'Financially relevant service organisation → SA 402 assessment',
      'blocking',
      s.serviceOrgs.length > 0 && s.serviceOrgs.every((o) => o.so01 !== null),
      s.serviceOrgs.length
        ? 'Record the SO-01 conclusion on every service organisation card.'
        : 'Add a service organisation card and record SO-01.',
    );

  const otherAuditorUnits = s.units.filter(
    (u) => u.auditor !== 'dhvaj' && u.scopeConclusion !== 'not_applicable',
  );
  if (otherAuditorUnits.length || t.jointAudit) {
    const missing = otherAuditorUnits.filter((u) => u.auditorStrategy === null);
    const jointMissing = t.jointAudit && !r.jointAuditNote;
    check(
      'other_auditor_conclusion',
      'Other / component / joint auditor → strategic conclusion',
      'blocking',
      missing.length === 0 && !jointMissing,
      [
        missing.length
          ? `No strategic conclusion for ${missing.map((u) => u.code).join(', ')}.`
          : '',
        jointMissing ? 'Record the joint-audit strategic division consideration.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  const section05 = r.reassessmentSource === 'section_05' && r.status === 'reassessment_required';
  if (section05)
    check(
      'controls_reliance',
      'Planned reliance vs Section 05 results',
      'blocking',
      false,
      'Section 05 does not support planned reliance — start a revision; the strategy is never changed silently.',
    );

  if (t.icfrApplicable)
    check(
      'icfr_workstream',
      'ICFR applicable → controls consideration',
      'challenge',
      !!r.icfrNote,
      'Confirm the separate ICFR workstream is addressed (not an automatic reliance requirement).',
    );

  const specialistGaps = live(s.considerations).filter(
    (c) =>
      c.kind === 'specialist' &&
      c.response === 'not_required' &&
      c.attention !== 'standard' &&
      !c.note,
  );
  check(
    'specialist_rationale',
    'Specialist signal marked Not Required',
    'blocking',
    specialistGaps.length === 0,
    `Rationale required where attention is Enhanced / Immediate Partner (${specialistGaps.map((c) => c.signalCode ?? c.observation).join(', ')}).`,
  );

  if (r.sl01 === 'yes' || r.sl01 === 'uncertain')
    check(
      'scope_limitation',
      'Potential scope limitation → Immediate Partner Attention + Planning Matter',
      'blocking',
      s.limitations.length > 0,
      'SL-01 is Yes / Uncertain — record the potential limitation.',
    );

  const flagged = s.mapItems.filter((m) => m.included && m.reassessmentRequired);
  check(
    'map_reassessment',
    'Approach Map items flagged Reassessment Required (materiality revision / Section 05)',
    'blocking',
    flagged.length === 0,
    `Reassess ${flagged.map((m) => `${m.code}${m.reassessmentReason ? ` (${m.reassessmentReason})` : ''}`).join(', ')} — the strategy is never changed silently.`,
  );

  return out;
}

// ── Partner Attention (§21/§22/§26) ─────────────────────────────────────────

export function partnerAttention(s: ScopeState): PartnerAttentionTrigger[] {
  const out: PartnerAttentionTrigger[] = [];
  for (const l of s.limitations.filter((x) => x.status === 'open'))
    out.push({
      key: `limitation:${l.id}`,
      label: `Potential scope limitation ${l.code}`,
      detail: l.matter,
    });
  for (const d of s.dependencies.filter((x) => x.partnerAttention))
    out.push({
      key: `dependency:${d.id}`,
      label: `Scope dependency ${d.code}`,
      detail: `${d.description} — impact: ${d.impact.replace(/_/g, ' ')}.`,
    });
  if (s.record.ob01 === 'potential_evidence_limitation')
    out.push({
      key: 'ob01',
      label: 'Opening balances',
      detail: 'OB-01 records a potential evidence limitation on opening balances.',
    });
  for (const u of s.units.filter(
    (x) => x.auditor !== 'dhvaj' && x.auditorStrategy === 'further_assessment',
  ))
    out.push({
      key: `unit:${u.id}`,
      label: `Other auditor strategy open — ${u.code}`,
      detail: `${u.name}: ${UNIT_AUDITOR_LABEL[u.auditor]} — further assessment.`,
    });
  for (const c of live(s.considerations).filter(
    (x) =>
      x.attention === 'immediate_partner' &&
      (x.response === 'rejected' || x.response === 'not_required'),
  ))
    out.push({
      key: `consideration:${c.id}`,
      label: `${c.kind === 'specialist' ? 'Specialist' : 'Implication'} set aside on an Immediate Partner Attention signal`,
      detail: c.observation,
    });
  if (s.record.status === 'reassessment_required')
    out.push({
      key: 'reassessment',
      label: 'Reassessment Required',
      detail: s.record.reassessmentReason ?? 'The approved strategy needs reassessment.',
    });
  for (const a of s.partnerActions.filter((x) => x.status === 'open' && x.action !== 'agree'))
    out.push({
      key: `partner:${a.id}`,
      label: 'Open Partner challenge / request',
      detail: a.note ?? '',
    });
  return out;
}

// ── §29 completion ──────────────────────────────────────────────────────────

export function scopeCompletion(
  s: ScopeState,
  consistency: ScopeConsistencyCheck[],
): PlanningCompletionCheck[] {
  const { record: r, triggers: t } = s;
  const out: PlanningCompletionCheck[] = [];
  const add = (key: string, label: string, met: boolean, detail: string) =>
    out.push({ key, label, met, detail: met ? null : detail });
  const std = (kind: ScopeDecision['kind']) =>
    s.decisions.filter((d) => d.kind === kind && !d.isCustom);
  const unset = (kind: ScopeDecision['kind']) =>
    s.decisions.filter((d) => d.kind === kind && d.status === null).map((d) => d.label);

  add(
    'fs_scope',
    'Financial statement scope confirmed (SC-01 / SC-02)',
    r.sc01 !== null && r.sc02 === 'yes',
    r.sc02 === 'requires_correction'
      ? 'SC-02 requires correction — correct the Section 02 source, then confirm.'
      : 'Record SC-01 and confirm SC-02.',
  );
  const unassessed = s.units.filter((u) => u.scopeConclusion === null);
  add(
    'population',
    'Audit Population generated and units assessed',
    s.units.length > 0 && unassessed.length === 0,
    s.units.length
      ? `Scope conclusion missing for ${unassessed.map((u) => u.code).join(', ')}.`
      : 'Generate the Audit Population.',
  );
  const noRationale = s.units.filter(
    (u) =>
      u.scopeConclusion !== null &&
      SCOPE_EXCLUDING_CONCLUSIONS.includes(u.scopeConclusion) &&
      (u.relevance.length > 0 || u.finAmount !== null || u.signalIds.length > 0) &&
      !u.rationale,
  );
  add(
    'significance',
    'Significance considered without mechanical materiality exclusion',
    noRationale.length === 0,
    `Rationale required for exclusions / limited work on relevant units: ${noRationale.map((u) => u.code).join(', ')}.`,
  );
  add(
    'ap01',
    'AP-01 overall strategic approach recorded',
    r.ap01 !== null,
    'Record AP-01 (Not Yet Determinable is available).',
  );
  add(
    'controls',
    'Controls reliance strategy considered for major cycles',
    unset('controls_cycle').length === 0 && std('controls_cycle').length > 0,
    `No strategy for: ${unset('controls_cycle').join(', ')}.`,
  );
  add(
    'timing',
    'Interim / year-end strategy established',
    unset('timing').length === 0,
    `No timing pattern for: ${unset('timing').join(', ')}.`,
  );
  add(
    'evidence',
    'Evidence channels assessed (incl. EC-01)',
    unset('evidence_channel').length === 0 && r.ec01 !== null,
    [
      unset('evidence_channel').length
        ? `Not assessed: ${unset('evidence_channel').join(', ')}.`
        : '',
      r.ec01 === null ? 'Answer EC-01.' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (t.initialAudit)
    add(
      'opening_balances',
      'Opening-balance strategy completed (initial audit)',
      r.ob01 !== null,
      'Record OB-01.',
    );
  const triggered: string[] = [];
  if (
    t.serviceOrganisation &&
    (!s.serviceOrgs.length || s.serviceOrgs.some((o) => o.so01 === null))
  )
    triggered.push('service organisation (SO-01)');
  if (t.internalAuditFunction && r.ia01 === null) triggered.push('internal audit (IA-01)');
  if (t.inventoryRelevant && r.inventoryDecision === null) triggered.push('physical attendance');
  if (r.dt01 === null) triggered.push('technology (DT-01)');
  if (r.dt01 === 'yes' && unset('technology_use').length) triggered.push('technology uses');
  const openConsiderations = live(s.considerations).filter((c) => c.response === null);
  if (openConsiderations.length)
    triggered.push(`${openConsiderations.length} special consideration(s) / specialist prompt(s)`);
  add(
    'triggered',
    'Triggered special considerations assessed',
    triggered.length === 0,
    `Outstanding: ${triggered.join('; ')}.`,
  );
  const unowned = s.dependencies.filter(
    (d) =>
      d.status !== 'resolved' && d.ownerEmployeeId === null && d.ownerParty === 'engagement_team',
  );
  const unescalated = s.limitations.filter((l) => l.status === 'open' && !l.planningMatterId);
  add(
    'dependencies',
    'Open dependencies owned; limitations escalated',
    unowned.length === 0 && unescalated.length === 0 && r.sl01 !== null,
    [
      r.sl01 === null ? 'Answer SL-01.' : '',
      unowned.length ? `Assign an owner: ${unowned.map((d) => d.code).join(', ')}.` : '',
      unescalated.length ? 'Escalate open limitations.' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  const included = s.mapItems.filter((m) => m.included);
  const incomplete = included.filter(
    (m) => m.controlsStrategy === null || m.timing === null || m.evidenceChannels.length === 0,
  );
  add(
    'map',
    'Preliminary Audit Approach Map generated',
    included.length > 0 && incomplete.length === 0,
    included.length
      ? `Complete controls strategy, timing and evidence for ${incomplete.map((m) => m.code).join(', ')}.`
      : 'Generate the Approach Map.',
  );
  const failing = consistency.filter((c) => !c.met);
  add(
    'consistency',
    'Consistency checks resolved or owned',
    failing.length === 0,
    failing.map((c) => c.detail).join(' '),
  );
  add(
    'ap02',
    'AP-02 completed by the Engagement Manager',
    r.ap02 === 'yes_complete' && !!r.conclusionSummary,
    'Review the generated conclusion and answer AP-02.',
  );
  return out;
}

export function isSignificantDependency(impact: string, status: string): boolean {
  return status !== 'resolved' && (SIGNIFICANT_DEPENDENCY_IMPACTS as string[]).includes(impact);
}

// ── §25 generated conclusion ────────────────────────────────────────────────

export function composeScopeConclusion(s: ScopeState, pa: PartnerAttentionTrigger[]): string {
  const { record: r } = s;
  const status = (kind: ScopeDecision['kind']) =>
    s.decisions
      .filter((d) => d.kind === kind && d.status)
      .map((d) => `${d.label}: ${DECISION_STATUS_LABEL[d.status!] ?? d.status}`)
      .join('; ');
  const count = (c: string) => s.units.filter((u) => u.scopeConclusion === c).length;
  const lines: string[] = [];
  lines.push(
    `Financial statement scope: ${r.sc01 ? FS_COVERED_LABEL[r.sc01] : 'not recorded'}${r.sc01 === 'other' && r.sc01Other ? ` (${r.sc01Other})` : ''}. ` +
      `Audit Population: ${s.units.length} unit(s) — ${count('in_scope')} in scope, ${count('limited')} limited / specific work, ${count('not_separately_scoped')} not separately scoped, ${count('further_assessment')} for further assessment.`,
  );
  const others = s.units.filter((u) => u.auditor !== 'dhvaj' && u.auditorStrategy);
  if (others.length)
    lines.push(
      `Other auditors: ${others.map((u) => `${u.name} — ${OTHER_AUDITOR_STRATEGY_LABEL[u.auditorStrategy!]}`).join('; ')} (detail in 03.9).`,
    );
  lines.push(
    `Overall approach (AP-01): ${r.ap01 ? AP01_LABEL[r.ap01] : 'not recorded'}.${r.ap01Rationale ? ` ${r.ap01Rationale}` : ''}`,
  );
  const controls = status('controls_cycle');
  if (controls)
    lines.push(
      `Controls reliance strategy (planned, not concluded): ${controls}. Section 05 establishes whether reliance is supportable.`,
    );
  const timing = status('timing');
  if (timing) lines.push(`Timing pattern: ${timing}. Dates are set in 03.11.`);
  const ev = s.decisions
    .filter(
      (d) =>
        d.kind === 'evidence_channel' &&
        (d.status === 'expected' || d.status === 'likely_required' || d.status === 'consider_use'),
    )
    .map((d) => d.label);
  if (ev.length) lines.push(`Key evidence channels: ${ev.join(', ')}.`);
  const special: string[] = [];
  if (r.ob01) special.push(`opening balances — ${OB01_LABEL[r.ob01]}`);
  for (const o of s.serviceOrgs) if (o.so01) special.push(`${o.provider} — ${SO01_LABEL[o.so01]}`);
  if (r.inventoryDecision)
    special.push(`inventory — ${INVENTORY_DECISION_LABEL[r.inventoryDecision]}`);
  if (r.ia01)
    special.push(
      `internal audit — ${r.ia01 === 'yes_sa610' ? 'use to be evaluated under SA 610' : r.ia01.replace(/_/g, ' ')}`,
    );
  if (r.dt01) special.push(`technology / data — ${r.dt01.replace(/_/g, ' ')}`);
  for (const c of live(s.considerations).filter((x) => x.kind === 'specialist' && x.response))
    special.push(
      `${c.observation} — ${SPECIALIST_DECISION_LABEL[c.response as keyof typeof SPECIALIST_DECISION_LABEL] ?? c.response}`,
    );
  if (special.length) lines.push(`Special considerations: ${special.join('; ')}.`);
  const openDeps = s.dependencies.filter((d) => d.status !== 'resolved');
  lines.push(
    `Scope dependencies: ${openDeps.length} open. Potential scope limitations: ${s.limitations.filter((l) => l.status === 'open').length} open${s.limitations.length ? ' (Immediate Partner Attention; reporting consequence not determined at planning)' : ''}.`,
  );
  const included = s.mapItems.filter((m) => m.included);
  lines.push(
    `Preliminary Audit Approach Map: ${included.length} area(s) — ${included.map((m) => m.name).join(', ')}. Refined in 03.5–03.7.`,
  );
  if (pa.length) lines.push(`Partner Attention: ${pa.map((p) => p.label).join('; ')}.`);
  return lines.join('\n\n');
}
