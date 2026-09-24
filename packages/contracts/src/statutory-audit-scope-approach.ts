/**
 * Statutory Audit — 03.4 Audit Scope & Approach (DHVAJ 03.4 spec; build doc §5.4).
 *
 * 03.4 records the STRATEGIC scope and overall approach: which population is
 * audited, the preliminary orientation (substantive / controls), timing
 * pattern, evidence channels and triggered special considerations. It never
 * concludes that controls are effective, never designs assertion-level work or
 * procedures, and never re-keys facts owned by Section 02 / 03.1–03.3.
 */
import type { PartnerAttentionTrigger } from './statutory-audit-materiality';
import type { PlanningAttention } from './statutory-audit-planning-signal';
import type { PlanningCompletionCheck } from './statutory-audit-planning-strategy';

/** Strategic taxonomy version (evidence channels, cycles, consistency rules). */
export const SCOPE_METHODOLOGY_VERSION = 'dhvaj-scope-2026.1';

export const scopeVersionLabel = (versionNo: number): string => `v1.${versionNo - 1}`;

const labels = <T extends string>(m: Record<T, string>) => m;

// ── Status ───────────────────────────────────────────────────────────────────

export type ScopeApproachStatus = 'draft' | 'complete' | 'reassessment_required';
export const SCOPE_STATUS_LABEL = labels<ScopeApproachStatus>({
  draft: 'Draft',
  complete: 'Complete',
  reassessment_required: 'Reassessment Required',
});

// ── 03.4.2 Financial statement scope — SC-01 / SC-02 ─────────────────────────

export const FS_COVERED = ['standalone', 'cfs', 'both', 'other'] as const;
export type FsCovered = (typeof FS_COVERED)[number];
export const FS_COVERED_LABEL = labels<FsCovered>({
  standalone: 'Standalone financial statements',
  cfs: 'Consolidated financial statements',
  both: 'Both standalone and consolidated',
  other: 'Other statutory financial statements',
});
export const SC02_ANSWERS = ['yes', 'requires_correction'] as const;
export type Sc02Answer = (typeof SC02_ANSWERS)[number];
export const SC02_LABEL = labels<Sc02Answer>({
  yes: 'Yes — correctly represents the financial statements covered',
  requires_correction: 'Requires correction (route to Section 02)',
});

// ── 03.4.3 Audit population — SC-03 ─────────────────────────────────────────

export const SCOPE_UNIT_TYPES = [
  'entity',
  'component',
  'branch',
  'plant',
  'warehouse',
  'office',
  'service_organisation',
  'other',
] as const;
export type ScopeUnitType = (typeof SCOPE_UNIT_TYPES)[number];
export const SCOPE_UNIT_TYPE_LABEL = labels<ScopeUnitType>({
  entity: 'Entity',
  component: 'Component',
  branch: 'Branch',
  plant: 'Plant',
  warehouse: 'Warehouse',
  office: 'Office',
  service_organisation: 'Service organisation',
  other: 'Other',
});

export const UNIT_AUDITORS = [
  'dhvaj',
  'component_auditor',
  'branch_auditor',
  'joint_auditor',
  'other',
] as const;
export type UnitAuditor = (typeof UNIT_AUDITORS)[number];
export const UNIT_AUDITOR_LABEL = labels<UnitAuditor>({
  dhvaj: 'DHVAJ',
  component_auditor: 'Component auditor',
  branch_auditor: 'Branch auditor',
  joint_auditor: 'Joint auditor',
  other: 'Other auditor',
});

export const SCOPE_CONCLUSIONS = [
  'in_scope',
  'limited',
  'not_separately_scoped',
  'further_assessment',
  'not_applicable',
] as const;
export type ScopeConclusion = (typeof SCOPE_CONCLUSIONS)[number];
export const SCOPE_CONCLUSION_LABEL = labels<ScopeConclusion>({
  in_scope: 'In Scope',
  limited: 'Limited or Specific Work',
  not_separately_scoped: 'Not Separately Scoped',
  further_assessment: 'Further Assessment',
  not_applicable: 'Not Applicable',
});
/** Conclusions that need a rationale where relevance exists (§6). */
export const SCOPE_EXCLUDING_CONCLUSIONS: ScopeConclusion[] = [
  'limited',
  'not_separately_scoped',
  'not_applicable',
];

export const UNIT_RELEVANCE = [
  'financial_significance',
  'specific_risk_focus',
  'inventory_asset_location',
  'regulatory_significance',
  'significant_transaction_process',
  'group_reporting',
  'controls_relevance',
  'other',
] as const;
export type UnitRelevance = (typeof UNIT_RELEVANCE)[number];
export const UNIT_RELEVANCE_LABEL = labels<UnitRelevance>({
  financial_significance: 'Financial significance',
  specific_risk_focus: 'Specific risk / focus area',
  inventory_asset_location: 'Inventory / asset location',
  regulatory_significance: 'Regulatory significance',
  significant_transaction_process: 'Significant transaction / process',
  group_reporting: 'Group reporting',
  controls_relevance: 'Controls relevance',
  other: 'Other',
});

export const OTHER_AUDITOR_STRATEGIES = [
  'use_other_auditor',
  'direct_dhvaj',
  'combination',
  'further_assessment',
] as const;
export type OtherAuditorStrategy = (typeof OTHER_AUDITOR_STRATEGIES)[number];
export const OTHER_AUDITOR_STRATEGY_LABEL = labels<OtherAuditorStrategy>({
  use_other_auditor: 'Expected Use of Other Auditor Work',
  direct_dhvaj: 'Direct DHVAJ Work',
  combination: 'Combination',
  further_assessment: 'Further Assessment',
});

export interface ScopeUnit {
  id: string;
  code: string; // SU-00n
  unitKey: string | null;
  isAuto: boolean;
  sourceLabel: string | null;
  name: string;
  unitType: ScopeUnitType;
  location: string | null;
  finMetric: string | null;
  /** Rupees. */
  finAmount: number | null;
  finSource: string | null;
  finNotAvailable: boolean;
  /** "2.4× OM" / "Below OM — not excluded on that basis" — context only. */
  materialityContext: string | null;
  relevance: UnitRelevance[];
  relevanceOther: string | null;
  qualitativeNote: string | null;
  signalIds: string[];
  focusIds: string[];
  specificMateriality: boolean;
  auditor: UnitAuditor;
  auditorStrategy: OtherAuditorStrategy | null;
  scopeConclusion: ScopeConclusion | null;
  rationale: string | null;
  noLongerGenerated: boolean;
  version: number;
}

export interface ScopeUnitInput {
  name?: string;
  unitType?: ScopeUnitType;
  location?: string | null;
  finMetric?: string | null;
  finAmount?: number | null;
  finSource?: string | null;
  finNotAvailable?: boolean;
  relevance?: UnitRelevance[];
  relevanceOther?: string | null;
  qualitativeNote?: string | null;
  signalIds?: string[];
  focusIds?: string[];
  specificMateriality?: boolean;
  auditor?: UnitAuditor;
  auditorStrategy?: OtherAuditorStrategy | null;
  scopeConclusion?: ScopeConclusion | null;
  rationale?: string | null;
  /** Required on edit (0 on create). */
  version?: number;
}

// ── 03.4.4 Overall approach — AP-01 ──────────────────────────────────────────

export const AP01_OPTIONS = [
  'predominantly_substantive',
  'combined',
  'controls_selected_areas',
  'mixed_by_area',
  'not_yet_determinable',
] as const;
export type Ap01Answer = (typeof AP01_OPTIONS)[number];
export const AP01_LABEL = labels<Ap01Answer>({
  predominantly_substantive: 'Predominantly Substantive',
  combined: 'Combined Controls + Substantive',
  controls_selected_areas: 'Controls Reliance Expected for Selected Areas',
  mixed_by_area: 'Mixed Approach by Audit Area',
  not_yet_determinable: 'Not Yet Determinable',
});

/** §8 system support — prompts only; never a conclusion. */
export interface StrategyConsideration {
  key: string;
  label: string;
  detail: string;
}

// ── Keyed strategic decisions (controls / timing / evidence / technology) ────

export type ScopeDecisionKind = 'controls_cycle' | 'timing' | 'evidence_channel' | 'technology_use';

export interface DecisionItemDef {
  key: string;
  label: string;
  options: string[];
  /** Destination / prompt shown with the item. */
  hint?: string;
}

export const DECISION_STATUS_LABEL: Record<string, string> = {
  reliance_contemplated: 'Reliance Contemplated',
  no_reliance: 'No Reliance Currently Planned',
  further_assessment: 'Further Assessment',
  interim: 'Interim',
  count_date: 'Count date',
  year_end: 'Year-end',
  both: 'Both',
  tbd: 'TBD',
  expected: 'Expected',
  not_significant: 'Not significant',
  not_presently_expected: 'Not presently expected',
  relevant: 'Relevant',
  not_relevant: 'Not relevant',
  likely_required: 'Likely required',
  evaluate_further: 'Evaluate further',
  not_required: 'Not required',
  direct_dhvaj: 'Direct DHVAJ work',
  combination: 'Combination',
  consider_use: 'Consider use',
  do_not_use: 'Do not use',
  not_planned: 'Not planned',
  assess: 'Assess',
};

const RELIANCE = ['reliance_contemplated', 'no_reliance', 'further_assessment'];
export const CONTROLS_CYCLES: DecisionItemDef[] = [
  { key: 'revenue', label: 'Revenue', options: RELIANCE, hint: 'Section 05' },
  { key: 'procurement', label: 'Procurement / payables', options: RELIANCE, hint: 'Section 05' },
  { key: 'payroll', label: 'Payroll', options: RELIANCE, hint: 'Section 05 / SA 402 if outsourced' },
  { key: 'inventory', label: 'Inventory', options: RELIANCE, hint: 'Section 05' },
  { key: 'treasury', label: 'Treasury', options: RELIANCE, hint: 'Section 05' },
  { key: 'financial_close', label: 'Financial close / reporting', options: RELIANCE, hint: 'Section 05' },
];
export const CONTROLS_RELIANCE_OPTIONS = RELIANCE;

const TIMING = ['interim', 'year_end', 'both', 'tbd'];
export const TIMING_AREAS: DecisionItemDef[] = [
  { key: 'controls', label: 'Controls', options: TIMING, hint: 'Roll-forward required? — prompted from the controls strategy.' },
  { key: 'revenue', label: 'Revenue / transactions', options: TIMING, hint: 'Assess remaining-period work.' },
  { key: 'receivables', label: 'Receivables / balances', options: TIMING, hint: 'Assess roll-forward if interim.' },
  { key: 'inventory', label: 'Inventory', options: ['interim', 'count_date', 'year_end', 'both', 'tbd'], hint: 'Assess movement / reconciliation need.' },
];
export const TIMING_OPTIONS = TIMING;
export const ROLL_FORWARD = ['required', 'not_required', 'assess'] as const;
export type RollForward = (typeof ROLL_FORWARD)[number];
export const ROLL_FORWARD_LABEL = labels<RollForward>({
  required: 'Roll-forward required',
  not_required: 'Not required',
  assess: 'Assess',
});

const EXP = ['expected', 'not_presently_expected', 'further_assessment'];
export const EVIDENCE_CHANNELS: DecisionItemDef[] = [
  { key: 'accounting_records', label: 'Entity accounting records', options: ['expected', 'not_significant', 'further_assessment'] },
  { key: 'external_confirmations', label: 'External confirmations', options: EXP, hint: 'SA 505 — see EC-01.' },
  { key: 'physical_observation', label: 'Physical observation / inspection', options: EXP, hint: 'SA 501 where inventory is material / relevant.' },
  { key: 'recalculation', label: 'Recalculation / reperformance', options: EXP },
  { key: 'analytical_procedures', label: 'Analytical procedures', options: EXP },
  { key: 'ipe', label: 'System-generated reports / IPE', options: EXP },
  { key: 'external_information', label: 'External information', options: EXP },
  { key: 'management_expert', label: 'Management expert', options: ['relevant', 'not_relevant', 'further_assessment'] },
  { key: 'auditor_expert', label: 'Auditor expert', options: ['likely_required', 'evaluate_further', 'not_required'], hint: 'SA 620 — route to 03.8.' },
  { key: 'component_auditor', label: 'Component / branch auditor', options: ['expected', 'direct_dhvaj', 'combination', 'further_assessment'], hint: '03.9' },
  { key: 'internal_audit', label: 'Internal audit', options: ['consider_use', 'do_not_use', 'further_assessment'], hint: 'SA 610 — see IA-01.' },
  { key: 'service_org_evidence', label: 'Service-organisation evidence', options: ['expected', 'not_relevant', 'further_assessment'], hint: 'SA 402' },
  { key: 'data_analytics', label: 'Data analytics / CAATs', options: ['expected', 'not_planned', 'further_assessment'], hint: 'See DT-01.' },
];

const USE = ['expected', 'not_planned', 'assess'];
export const TECHNOLOGY_USES: DecisionItemDef[] = [
  { key: 'full_population', label: 'Full-population analytics', options: USE },
  { key: 'journal_entry', label: 'Journal-entry analytics', options: USE },
  { key: 'revenue_analytics', label: 'Revenue analytics', options: USE },
  { key: 'duplicate_gap', label: 'Duplicate / sequence / gap testing', options: USE },
  { key: 'aging_matching', label: 'Aging / matching analytics', options: USE },
  { key: 'user_access', label: 'User-access / audit-trail analytics', options: USE },
];

export const DECISION_DEFS: Record<ScopeDecisionKind, DecisionItemDef[]> = {
  controls_cycle: CONTROLS_CYCLES,
  timing: TIMING_AREAS,
  evidence_channel: EVIDENCE_CHANNELS,
  technology_use: TECHNOLOGY_USES,
};
/** Options for a Manager-added ("other") item of each kind. */
export const CUSTOM_DECISION_OPTIONS: Record<ScopeDecisionKind, string[] | null> = {
  controls_cycle: RELIANCE,
  timing: TIMING,
  evidence_channel: null,
  technology_use: USE,
};

export interface ScopeDecision {
  kind: ScopeDecisionKind;
  itemKey: string;
  label: string;
  isCustom: boolean;
  options: string[];
  hint: string | null;
  status: string | null;
  rollForward: RollForward | null;
  /** System prompt (e.g. roll-forward suggested because reliance is contemplated). */
  prompt: string | null;
  note: string | null;
  version: number;
}

export interface SaveScopeDecisionInput {
  status?: string | null;
  rollForward?: RollForward | null;
  note?: string | null;
  /** Custom items only (create). */
  label?: string;
  version: number;
}

// ── 03.4.7 EC-01 / physical observation ──────────────────────────────────────

export const EC01_ANSWERS = ['expected', 'not_presently_expected', 'further_assessment'] as const;
export type Ec01Answer = (typeof EC01_ANSWERS)[number];
export const EC01_LABEL = labels<Ec01Answer>({
  expected: 'Expected',
  not_presently_expected: 'Not Presently Expected',
  further_assessment: 'Further Assessment',
});
export const CONFIRMATION_AREAS = [
  'banks',
  'receivables',
  'payables',
  'loans',
  'investments',
  'legal_matters',
  'related_party_balances',
  'other',
] as const;
export type ConfirmationArea = (typeof CONFIRMATION_AREAS)[number];
export const CONFIRMATION_AREA_LABEL = labels<ConfirmationArea>({
  banks: 'Banks',
  receivables: 'Receivables',
  payables: 'Payables',
  loans: 'Loans / borrowings',
  investments: 'Investments',
  legal_matters: 'Legal matters',
  related_party_balances: 'Related-party balances',
  other: 'Other',
});

export const INVENTORY_DECISIONS = [
  'attendance_expected',
  'alternative_assessment',
  'not_material',
  'information_required',
] as const;
export type InventoryDecision = (typeof INVENTORY_DECISIONS)[number];
export const INVENTORY_DECISION_LABEL = labels<InventoryDecision>({
  attendance_expected: 'Physical Attendance Expected',
  alternative_assessment: 'Alternative Approach Requires Assessment',
  not_material: 'Inventory Not Material / Relevant',
  information_required: 'Information Required',
});

// ── 03.4.8 Triggered cards — OB-01 / SO-01 / IA-01 / DT-01 ───────────────────

export const OB01_OPTIONS = [
  'standard',
  'enhanced_attention',
  'potential_evidence_limitation',
  'further_information_required',
] as const;
export type Ob01Answer = (typeof OB01_OPTIONS)[number];
export const OB01_LABEL = labels<Ob01Answer>({
  standard: 'Standard Opening-Balance Work',
  enhanced_attention: 'Enhanced Attention',
  potential_evidence_limitation: 'Potential Evidence Limitation',
  further_information_required: 'Further Information Required',
});
export interface ObInputDef {
  key: string;
  label: string;
  options: string[];
}
export const OB_INPUTS: ObInputDef[] = [
  { key: 'prior_fs', label: 'Prior financial statements', options: ['available', 'unavailable', 'pending'] },
  { key: 'prior_report', label: 'Prior auditor report', options: ['available', 'unavailable', 'pending'] },
  { key: 'prior_report_modified', label: 'Prior auditor report modified?', options: ['yes', 'no', 'unknown'] },
  { key: 'predecessor_access', label: 'Predecessor working-paper access', options: ['expected', 'not_expected', 'pending'] },
  { key: 'opening_schedules', label: 'Opening balances / schedules', options: ['available', 'pending'] },
];

export const ASSURANCE_REPORT = ['available', 'expected', 'not_known', 'not_available'] as const;
export type AssuranceReport = (typeof ASSURANCE_REPORT)[number];
export const ASSURANCE_REPORT_LABEL = labels<AssuranceReport>({
  available: 'Available',
  expected: 'Expected',
  not_known: 'Not known',
  not_available: 'Not available',
});
export const CUEC_ANSWERS = ['yes', 'no', 'unknown'] as const;
export type CuecAnswer = (typeof CUEC_ANSWERS)[number];
export const SO01_OPTIONS = ['sa402_required', 'not_relevant', 'further_assessment'] as const;
export type So01Answer = (typeof SO01_OPTIONS)[number];
export const SO01_LABEL = labels<So01Answer>({
  sa402_required: 'SA 402 Consideration Required',
  not_relevant: 'Not Relevant to Financial Reporting',
  further_assessment: 'Further Assessment',
});

export interface ScopeServiceOrg {
  id: string;
  code: string; // SO-00n
  sourceKey: string | null;
  provider: string;
  process: string | null;
  affectedAreas: string[];
  assuranceReport: AssuranceReport | null;
  reportDetail: string | null;
  cuec: CuecAnswer | null;
  so01: So01Answer | null;
  note: string | null;
  version: number;
}
export interface ServiceOrgInput {
  provider?: string;
  process?: string | null;
  affectedAreas?: string[];
  assuranceReport?: AssuranceReport | null;
  reportDetail?: string | null;
  cuec?: CuecAnswer | null;
  so01?: So01Answer | null;
  note?: string | null;
  version?: number;
}

export const IA01_OPTIONS = ['yes_sa610', 'no', 'further_assessment'] as const;
export type Ia01Answer = (typeof IA01_OPTIONS)[number];
export const IA01_LABEL = labels<Ia01Answer>({
  yes_sa610: 'Yes — Evaluate under SA 610',
  no: 'No',
  further_assessment: 'Further Assessment',
});

export const DT01_OPTIONS = ['yes', 'no', 'further_assessment'] as const;
export type Dt01Answer = (typeof DT01_OPTIONS)[number];
export const DT01_LABEL = labels<Dt01Answer>({
  yes: 'Yes',
  no: 'No',
  further_assessment: 'Further Assessment',
});

// ── §17 specialists / §20 special approach implications ─────────────────────

export type ScopeConsiderationKind = 'implication' | 'specialist';
export const IMPLICATION_RESPONSES = ['accepted', 'modified', 'rejected', 'further_assessment'] as const;
export type ImplicationResponse = (typeof IMPLICATION_RESPONSES)[number];
export const IMPLICATION_RESPONSE_LABEL = labels<ImplicationResponse>({
  accepted: 'Accept',
  modified: 'Modify',
  rejected: 'Reject (rationale)',
  further_assessment: 'Further assessment',
});
export const SPECIALIST_DECISIONS = ['likely_required', 'evaluate_further', 'not_required'] as const;
export type SpecialistDecision = (typeof SPECIALIST_DECISIONS)[number];
export const SPECIALIST_DECISION_LABEL = labels<SpecialistDecision>({
  likely_required: 'Specialist Likely Required (→ 03.8)',
  evaluate_further: 'Evaluate Further (Planning Matter)',
  not_required: 'Not Required',
});
export const SPECIALIST_AREAS = [
  'valuation',
  'actuarial',
  'it',
  'tax',
  'legal',
  'complex_instruments',
  'environmental',
  'other',
] as const;
export type SpecialistArea = (typeof SPECIALIST_AREAS)[number];
export const SPECIALIST_AREA_LABEL = labels<SpecialistArea>({
  valuation: 'Valuation',
  actuarial: 'Actuarial',
  it: 'IT',
  tax: 'Tax',
  legal: 'Legal',
  complex_instruments: 'Complex financial instruments',
  environmental: 'Environmental obligations',
  other: 'Other',
});

export interface ScopeConsideration {
  id: string;
  kind: ScopeConsiderationKind;
  considerationKey: string;
  isAuto: boolean;
  signalId: string | null;
  signalCode: string | null;
  sourceLabel: string | null;
  observation: string;
  suggestion: string | null;
  attention: PlanningAttention;
  response: string | null;
  note: string | null;
  planningMatterId: string | null;
  planningMatterCode: string | null;
  noLongerTriggered: boolean;
  version: number;
}
export interface SaveScopeConsiderationInput {
  response: string | null;
  note?: string | null;
  version: number;
}
export interface NewSpecialistInput {
  area: SpecialistArea;
  observation: string;
  signalId?: string | null;
}

// ── 03.4.9 Dependencies / SL-01 limitations ─────────────────────────────────

export const DEPENDENCY_OWNER_PARTIES = ['engagement_team', 'client', 'third_party'] as const;
export type DependencyOwnerParty = (typeof DEPENDENCY_OWNER_PARTIES)[number];
export const DEPENDENCY_OWNER_PARTY_LABEL = labels<DependencyOwnerParty>({
  engagement_team: 'Engagement team',
  client: 'Client',
  third_party: 'Third party',
});
export const NEEDED_BY = ['planning', 'interim', 'year_end', 'reporting'] as const;
export type NeededBy = (typeof NEEDED_BY)[number];
export const NEEDED_BY_LABEL = labels<NeededBy>({
  planning: 'Planning',
  interim: 'Interim fieldwork',
  year_end: 'Year-end fieldwork',
  reporting: 'Reporting',
});
export const DEPENDENCY_IMPACTS = [
  'information',
  'delay',
  'approach_change',
  'potential_evidence_limitation',
  'other',
] as const;
export type DependencyImpact = (typeof DEPENDENCY_IMPACTS)[number];
export const DEPENDENCY_IMPACT_LABEL = labels<DependencyImpact>({
  information: 'Information',
  delay: 'Delay',
  approach_change: 'Approach change',
  potential_evidence_limitation: 'Potential evidence limitation',
  other: 'Other',
});
/** Rule-driven Partner Attention (§21). */
export const SIGNIFICANT_DEPENDENCY_IMPACTS: DependencyImpact[] = [
  'approach_change',
  'potential_evidence_limitation',
];
export const DEPENDENCY_STATUSES = ['open', 'in_progress', 'resolved', 'escalated'] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];
export const DEPENDENCY_STATUS_LABEL = labels<DependencyStatus>({
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  escalated: 'Escalated',
});

export interface ScopeDependency {
  id: string;
  code: string; // SD-00n
  description: string;
  affected: string | null;
  unitId: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  ownerParty: DependencyOwnerParty;
  neededBy: NeededBy | null;
  impact: DependencyImpact;
  status: DependencyStatus;
  resolution: string | null;
  partnerAttention: boolean;
  version: number;
}
export interface ScopeDependencyInput {
  description?: string;
  affected?: string | null;
  unitId?: string | null;
  ownerEmployeeId?: string | null;
  ownerParty?: DependencyOwnerParty;
  neededBy?: NeededBy | null;
  impact?: DependencyImpact;
  status?: DependencyStatus;
  resolution?: string | null;
  version?: number;
}

export const SL01_ANSWERS = ['no', 'yes', 'uncertain'] as const;
export type Sl01Answer = (typeof SL01_ANSWERS)[number];
export const SL01_LABEL = labels<Sl01Answer>({ no: 'No', yes: 'Yes', uncertain: 'Uncertain' });
export const SCOPE_LIMITATION_NOTE =
  'A potential scope limitation is always Immediate Partner Attention with an open Planning Matter. The reporting consequence is NOT determined here — it is assessed later if the matter remains unresolved.';

export interface ScopeLimitation {
  id: string;
  code: string; // SL-00n
  matter: string;
  affected: string | null;
  managementPosition: string | null;
  alternativeEvidence: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  status: 'open' | 'resolved';
  resolution: string | null;
  planningMatterId: string | null;
  planningMatterCode: string | null;
  version: number;
}
export interface ScopeLimitationInput {
  matter?: string;
  affected?: string | null;
  managementPosition?: string | null;
  alternativeEvidence?: string | null;
  ownerEmployeeId?: string | null;
  status?: 'open' | 'resolved';
  resolution?: string | null;
  version?: number;
}

// ── 03.4.10 Preliminary Audit Approach Map ──────────────────────────────────

export const MAP_CONTROLS_STRATEGIES = ['reliance_contemplated', 'no_reliance', 'assess'] as const;
export type MapControlsStrategy = (typeof MAP_CONTROLS_STRATEGIES)[number];
export const MAP_CONTROLS_STRATEGY_LABEL = labels<MapControlsStrategy>({
  reliance_contemplated: 'Reliance contemplated',
  no_reliance: 'No reliance',
  assess: 'Assess',
});
export const MAP_TIMINGS = ['interim', 'year_end', 'both', 'tbd'] as const;
export type MapTiming = (typeof MAP_TIMINGS)[number];
export const MAP_TIMING_LABEL = labels<MapTiming>({
  interim: 'Interim',
  year_end: 'Year-end',
  both: 'Both',
  tbd: 'TBD',
});
export const MAP_EVIDENCE_CATEGORIES = [
  'records',
  'confirmations',
  'physical',
  'recalculation',
  'analytics',
  'ipe',
  'external_information',
  'experts',
  'other_auditors',
  'internal_audit',
  'service_org',
  'caats',
] as const;
export type MapEvidenceCategory = (typeof MAP_EVIDENCE_CATEGORIES)[number];
export const MAP_EVIDENCE_LABEL = labels<MapEvidenceCategory>({
  records: 'Records',
  confirmations: 'Confirmations',
  physical: 'Physical',
  recalculation: 'Recalculation',
  analytics: 'Analytics',
  ipe: 'IPE',
  external_information: 'External info',
  experts: 'Experts',
  other_auditors: 'Other auditors',
  internal_audit: 'Internal audit',
  service_org: 'Service org',
  caats: 'CAATs',
});
export const SPECIAL_CONSIDERATIONS = [
  'opening_balance',
  'component',
  'specialist',
  'physical_attendance',
  'service_organisation',
  'technology',
  'internal_audit',
  'other',
] as const;
export type SpecialConsiderationTag = (typeof SPECIAL_CONSIDERATIONS)[number];
export const SPECIAL_CONSIDERATION_LABEL = labels<SpecialConsiderationTag>({
  opening_balance: 'Opening balance',
  component: 'Component',
  specialist: 'Specialist',
  physical_attendance: 'Physical attendance',
  service_organisation: 'Service organisation',
  technology: 'Technology',
  internal_audit: 'Internal audit',
  other: 'Other',
});
export const MAP_DESTINATION_NOTE =
  'Convert / refine in 03.5 (areas & assertions); risk / response in 03.6; procedures in 03.7. The map is preliminary and never an automatic scope exclusion.';

export interface ScopeMapItem {
  id: string;
  code: string; // AM-00n
  areaKey: string | null;
  isAuto: boolean;
  sourceLabel: string | null;
  name: string;
  metricKey: string | null;
  /** Rupees — live from 03.2 (auto areas) or the Manager's amount (custom). */
  amount: number | null;
  manualAmount: number | null;
  materialityContext: string | null;
  materialityNote: string | null;
  specificMateriality: string[];
  signalIds: string[];
  focusIds: string[];
  controlsStrategy: MapControlsStrategy | null;
  timing: MapTiming | null;
  evidenceChannels: MapEvidenceCategory[];
  specialConsiderations: SpecialConsiderationTag[];
  suggestedSpecial: SpecialConsiderationTag[];
  note: string | null;
  included: boolean;
  exclusionReason: string | null;
  reassessmentRequired: boolean;
  reassessmentReason: string | null;
  version: number;
}
export interface ScopeMapItemInput {
  name?: string;
  manualAmount?: number | null;
  materialityNote?: string | null;
  signalIds?: string[];
  focusIds?: string[];
  controlsStrategy?: MapControlsStrategy | null;
  timing?: MapTiming | null;
  evidenceChannels?: MapEvidenceCategory[];
  specialConsiderations?: SpecialConsiderationTag[];
  note?: string | null;
  included?: boolean;
  exclusionReason?: string | null;
  /** Clears the Reassessment Required flag — needs a note of what was reconsidered. */
  reassessed?: boolean;
  version?: number;
}

// ── §24 consistency checks / §26 partner view / §27 revision ─────────────────

export interface ScopeConsistencyCheck {
  key: string;
  label: string;
  severity: 'blocking' | 'challenge';
  met: boolean;
  detail: string | null;
}

export const PARTNER_ACTIONS = ['agree', 'challenge', 'request_consideration', 'add_signal'] as const;
export type PartnerScopeAction = (typeof PARTNER_ACTIONS)[number];
export const PARTNER_ACTION_LABEL = labels<PartnerScopeAction>({
  agree: 'Agree',
  challenge: 'Challenge',
  request_consideration: 'Request Additional Consideration',
  add_signal: 'Add Partner Planning Signal',
});
export interface ScopePartnerAction {
  id: string;
  action: PartnerScopeAction;
  note: string | null;
  signalId: string | null;
  signalCode: string | null;
  status: 'open' | 'addressed';
  response: string | null;
  createdByName: string | null;
  createdAt: string;
  version: number;
}
export interface PartnerScopeActionInput {
  action: PartnerScopeAction;
  note?: string | null;
}
export interface RespondPartnerActionInput {
  response: string;
  version: number;
}

export const SCOPE_REVISION_TRIGGERS = [
  'controls_not_supported',
  'new_significant_transaction',
  'materiality_revision',
  'component_auditor_issue',
  'inventory_access_denied',
  'data_unavailable',
  'other',
] as const;
export type ScopeRevisionTrigger = (typeof SCOPE_REVISION_TRIGGERS)[number];
export const SCOPE_REVISION_TRIGGER_LABEL = labels<ScopeRevisionTrigger>({
  controls_not_supported: 'Control testing does not support planned reliance',
  new_significant_transaction: 'New significant transaction / risk',
  materiality_revision: 'Materiality revision',
  component_auditor_issue: 'Component auditor issue',
  inventory_access_denied: 'Inventory access denied',
  data_unavailable: 'ERP / data unavailable',
  other: 'Other significant change',
});
/** §27 impact assessment prompt per trigger. */
export const SCOPE_REVISION_IMPACT: Record<ScopeRevisionTrigger, string> = {
  controls_not_supported: 'Affected approach map, risks, procedures, timing / resources.',
  new_significant_transaction: 'Scope / map / risk / procedure impact.',
  materiality_revision: 'Unit / area scoping and procedure impact.',
  component_auditor_issue: 'Group / component plan and evidence impact.',
  inventory_access_denied: 'Physical evidence strategy / potential limitation.',
  data_unavailable: 'Technology / evidence strategy and alternative procedures.',
  other: 'Manager identifies affected modules.',
};
export const SCOPE_AFFECTED_MODULES = ['03.5', '03.6', '03.7', '03.8', '03.9', '03.10', '03.11'] as const;

export interface ScopeRevision {
  fromVersionLabel: string;
  toVersionLabel: string;
  trigger: ScopeRevisionTrigger;
  reason: string;
  affectedModules: string[];
  createdByName: string | null;
  createdAt: string;
  /** Headline of the approved baseline preserved at revision. */
  baselineSummary: string;
}
export interface StartScopeRevisionInput {
  trigger: ScopeRevisionTrigger;
  reason: string;
  affectedModules?: string[];
}
export type ScopeReassessmentSource = 'materiality_revision' | 'section_05' | 'manager' | 'other';
export interface FlagScopeReassessmentInput {
  source: ScopeReassessmentSource;
  reason: string;
  /** Section 05: the controls cycle whose planned reliance is unsupported. */
  cycleKey?: string | null;
}

// ── Record + summary ─────────────────────────────────────────────────────────

export const AP02_ANSWERS = ['yes_complete', 'no_further_work'] as const;
export type Ap02Answer = (typeof AP02_ANSWERS)[number];
export const AP02_LABEL = labels<Ap02Answer>({
  yes_complete: 'Yes — Complete',
  no_further_work: 'No — Further Work Required',
});

export const CONTROLS_RELIANCE_NOTE =
  'Planned reliance is not actual reliance. Controls reliance may affect the nature, timing and extent of substantive work; it does not mean substantive procedures disappear. Section 05 establishes whether reliance is supportable; detailed SA 330 response design belongs downstream.';
export const TIMING_NOTE =
  '03.4 decides the strategic timing pattern only. 03.11 assigns actual dates, milestones and dependencies; detailed remaining-period procedures are designed in 03.7.';

export interface ScopeApproachRecord {
  id: string | null;
  versionNo: number;
  versionLabel: string;
  status: ScopeApproachStatus;
  methodologyVersion: string | null;
  sc01: FsCovered | null;
  sc01Other: string | null;
  sc02: Sc02Answer | null;
  sc02Note: string | null;
  ap01: Ap01Answer | null;
  ap01Rationale: string | null;
  icfrNote: string | null;
  ec01: Ec01Answer | null;
  ec01Areas: ConfirmationArea[];
  ec01Note: string | null;
  inventoryDecision: InventoryDecision | null;
  inventoryLocations: string | null;
  inventoryNote: string | null;
  physicalOther: Ec01Answer | null;
  physicalOtherNote: string | null;
  obInputs: Record<string, string>;
  ob01: Ob01Answer | null;
  ob01Note: string | null;
  ia01: Ia01Answer | null;
  ia01Note: string | null;
  jointAuditNote: string | null;
  dt01: Dt01Answer | null;
  dt01Note: string | null;
  sl01: Sl01Answer | null;
  materialityVersionNo: number | null;
  reassessmentReason: string | null;
  reassessmentSource: ScopeReassessmentSource | null;
  revisionTrigger: ScopeRevisionTrigger | null;
  revisionReason: string | null;
  conclusionSummary: string | null;
  ap02: Ap02Answer | null;
  completedByName: string | null;
  completedAt: string | null;
  version: number;
}

export interface UpdateScopeApproachInput {
  sc01?: FsCovered | null;
  sc01Other?: string | null;
  sc02?: Sc02Answer | null;
  sc02Note?: string | null;
  ap01?: Ap01Answer | null;
  ap01Rationale?: string | null;
  icfrNote?: string | null;
  ec01?: Ec01Answer | null;
  ec01Areas?: ConfirmationArea[];
  ec01Note?: string | null;
  inventoryDecision?: InventoryDecision | null;
  inventoryLocations?: string | null;
  inventoryNote?: string | null;
  physicalOther?: Ec01Answer | null;
  physicalOtherNote?: string | null;
  obInputs?: Record<string, string>;
  ob01?: Ob01Answer | null;
  ob01Note?: string | null;
  ia01?: Ia01Answer | null;
  ia01Note?: string | null;
  jointAuditNote?: string | null;
  dt01?: Dt01Answer | null;
  dt01Note?: string | null;
  sl01?: Sl01Answer | null;
  conclusionSummary?: string | null;
  ap02?: Ap02Answer | null;
  version: number;
}

export interface ScopeIntelligenceItem {
  label: string;
  value: string;
  source: string;
}

/** Engagement facts that switch triggered cards on (read-only, never re-keyed). */
export interface ScopeTriggers {
  initialAudit: boolean;
  jointAudit: boolean;
  serviceOrganisation: boolean;
  internalAuditFunction: boolean;
  icfrApplicable: boolean;
  caroApplicable: boolean;
  cfsApplicable: boolean;
  hasBranches: boolean;
  otherAuditors: boolean;
  inventoryRelevant: boolean;
  inventoryReason: string | null;
  suggestedFsCovered: FsCovered | null;
}

export interface ScopeMaterialityRef {
  versionNo: number;
  versionLabel: string;
  status: string;
  overallMateriality: number | null;
  performanceMateriality: number | null;
  specific: { scope: string; amount: number | null }[];
}

export interface ScopeLandingCards {
  scopeUnits: number;
  relevantUnits: number;
  otherAuditors: number;
  specialConsiderations: number;
  openDependencies: number;
  potentialLimitations: number;
  partnerAttention: number;
}

export interface ScopeAuthorityRef {
  code: string;
  label: string;
  title: string | null;
  provisionNumber: string | null;
}

export interface ScopeApproachSummary {
  record: ScopeApproachRecord;
  intelligence: ScopeIntelligenceItem[];
  triggers: ScopeTriggers;
  materiality: ScopeMaterialityRef | null;
  cards: ScopeLandingCards;
  units: ScopeUnit[];
  approachConsiderations: StrategyConsideration[];
  decisions: ScopeDecision[];
  suggestedConfirmationAreas: ConfirmationArea[];
  serviceOrgs: ScopeServiceOrg[];
  considerations: ScopeConsideration[];
  dependencies: ScopeDependency[];
  limitations: ScopeLimitation[];
  mapItems: ScopeMapItem[];
  consistency: ScopeConsistencyCheck[];
  partnerAttention: PartnerAttentionTrigger[];
  partnerActions: ScopePartnerAction[];
  revisions: ScopeRevision[];
  authorities: ScopeAuthorityRef[];
  completion: PlanningCompletionCheck[];
}
