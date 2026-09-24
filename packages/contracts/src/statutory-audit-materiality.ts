/**
 * Statutory Audit — 03.3 Materiality (DHVAJ 03.3 spec; build doc §5.3).
 *
 * Materiality is professional judgment. The portal exposes relevant measures,
 * benchmark stability, user focus, qualitative factors and sensitivity; the
 * auditor selects and concludes. No amount, benchmark or percentage here is an
 * automatic audit conclusion, and any percentage shown is DHVAJ methodology
 * guidance (versioned, in the Audit Rules Library) — SA 320 prescribes none.
 */
import type { DatasetStatus, FinancialUnit } from './statutory-audit-planning-analytics';
import type { PlanningCompletionCheck } from './statutory-audit-planning-strategy';

// ── 03.3.1 Context — MAT-01 / MAT-02 ─────────────────────────────────────────

export const PRINCIPAL_USER = {
  shareholdersPromoters: 'shareholders_promoters',
  publicInvestors: 'public_investors',
  lendersBanks: 'lenders_banks',
  governmentRegulators: 'government_regulators',
  parentGroup: 'parent_group',
  membersDonors: 'members_donors',
  other: 'other',
} as const;
export type PrincipalUser = (typeof PRINCIPAL_USER)[keyof typeof PRINCIPAL_USER];
export const PRINCIPAL_USERS: PrincipalUser[] = Object.values(PRINCIPAL_USER);
export const PRINCIPAL_USER_LABEL: Record<PrincipalUser, string> = {
  shareholders_promoters: 'Shareholders / promoters',
  public_investors: 'Public investors',
  lenders_banks: 'Lenders / banks',
  government_regulators: 'Government / regulators',
  parent_group: 'Parent / group management',
  members_donors: 'Members / donors',
  other: 'Other',
};

export const USER_FOCUS_MEASURE = {
  profit: 'profit',
  revenue: 'revenue',
  assets: 'assets',
  netAssets: 'net_assets',
  expenditure: 'expenditure',
  regulatoryCovenant: 'regulatory_covenant',
  other: 'other',
} as const;
export type UserFocusMeasure = (typeof USER_FOCUS_MEASURE)[keyof typeof USER_FOCUS_MEASURE];
export const USER_FOCUS_MEASURES: UserFocusMeasure[] = Object.values(USER_FOCUS_MEASURE);
export const USER_FOCUS_LABEL: Record<UserFocusMeasure, string> = {
  profit: 'Profit / profitability',
  revenue: 'Revenue / scale',
  assets: 'Assets',
  net_assets: 'Net assets / equity',
  expenditure: 'Expenditure',
  regulatory_covenant: 'Regulatory / covenant measure',
  other: 'Other',
};

export interface MaterialityContextItem {
  label: string;
  value: string;
  source: string;
}

// ── 03.3.2 – 03.3.4 Benchmarks ───────────────────────────────────────────────

export const MATERIALITY_BENCHMARK = {
  pbt: 'pbt',
  normalisedPbt: 'normalised_pbt',
  revenue: 'revenue',
  totalAssets: 'total_assets',
  netAssets: 'net_assets',
  expenditure: 'expenditure',
  other: 'other',
} as const;
export type MaterialityBenchmark =
  (typeof MATERIALITY_BENCHMARK)[keyof typeof MATERIALITY_BENCHMARK];
export const MATERIALITY_BENCHMARKS: MaterialityBenchmark[] = Object.values(MATERIALITY_BENCHMARK);
/** Candidates the system derives from 03.2 (everything except a Manager "Other"). */
export type CandidateBenchmark = Exclude<MaterialityBenchmark, 'other'>;
export const CANDIDATE_BENCHMARKS: CandidateBenchmark[] = [
  'pbt',
  'normalised_pbt',
  'revenue',
  'total_assets',
  'net_assets',
  'expenditure',
];
export const MATERIALITY_BENCHMARK_LABEL: Record<MaterialityBenchmark, string> = {
  pbt: 'Profit before tax',
  normalised_pbt: 'Normalised profit before tax',
  revenue: 'Revenue from operations',
  total_assets: 'Total assets',
  net_assets: 'Net assets / equity',
  expenditure: 'Total expenditure',
  other: 'Other (approved) benchmark',
};

export const BENCHMARK_ASSESSMENT = {
  suitable: 'suitable',
  potentiallySuitable: 'potentially_suitable',
  notSuitable: 'not_suitable',
  normalisedRequired: 'normalised_required',
} as const;
export type BenchmarkAssessment = (typeof BENCHMARK_ASSESSMENT)[keyof typeof BENCHMARK_ASSESSMENT];
export const BENCHMARK_ASSESSMENTS: BenchmarkAssessment[] = Object.values(BENCHMARK_ASSESSMENT);
export const BENCHMARK_ASSESSMENT_LABEL: Record<BenchmarkAssessment, string> = {
  suitable: 'Suitable',
  potentially_suitable: 'Potentially suitable',
  not_suitable: 'Not suitable',
  normalised_required: 'Normalised benchmark required',
};

/** Audit Rules Library area + criteria for the Materiality Methodology Library (§8). */
export const MATERIALITY_RULE_AREA = 'materiality';
export const MATERIALITY_RULE_CRITERION = {
  omPct: {
    pbt: 'om_pct_pbt',
    normalised_pbt: 'om_pct_normalised_pbt',
    revenue: 'om_pct_revenue',
    total_assets: 'om_pct_total_assets',
    net_assets: 'om_pct_net_assets',
    expenditure: 'om_pct_expenditure',
  } as Record<CandidateBenchmark, string>,
  pmPct: 'pm_pct_om',
  cttPct: 'ctt_pct_om',
  pyChangeAttention: 'py_change_attention',
  volatilityAttention: 'volatility_attention',
  nearBreakevenMargin: 'near_breakeven_margin',
  roundingStep: 'rounding_step',
} as const;

/** One configured guidance range, resolved for the engagement period. */
export interface MaterialityGuidance {
  criterion: string;
  lowPct: number | null;
  highPct: number | null;
  ruleCode: string;
  ruleVersion: number;
  reference: string | null;
  /** True while the range is a placeholder awaiting DHVAJ approval. */
  provisional: boolean;
}

/** Guidance used by this determination (stored with it, spec §20). */
export interface MaterialityMethodology {
  /** e.g. `MAT_OM_PCT_PBT@1, MAT_PM_PCT_OM@1, …` — stored on the determination. */
  versionLabel: string;
  omGuidance: Partial<Record<CandidateBenchmark, MaterialityGuidance>>;
  pmGuidance: MaterialityGuidance | null;
  cttGuidance: MaterialityGuidance | null;
  pyChangeAttentionPct: number | null;
  volatilityAttentionPct: number | null;
  nearBreakevenMarginPct: number | null;
  /** Rupees; null = no methodology rounding configured. */
  roundingStep: number | null;
  anyProvisional: boolean;
}

export type BenchmarkCandidateStatus = 'available' | 'insufficient_data' | 'not_meaningful';

export interface BenchmarkCandidate {
  key: CandidateBenchmark;
  label: string;
  formula: string;
  /** Dataset units (03.2.7). */
  cy: number | null;
  py: number | null;
  movementPct: number | null;
  /** `+12.3%`, `N/M` or `—`. */
  movementLabel: string;
  /** |movement| at or above the methodology volatility attention parameter. */
  volatile: boolean;
  status: BenchmarkCandidateStatus;
  reason: string | null;
  /** CY amount in rupees (dataset units × unit factor). */
  amountInr: number | null;
  /** MAT-02 user-focus measure this candidate answers to, if selected. */
  userFocusLinked: boolean;
  /** Neutral prompts (life cycle, ownership / financing, …) — never a ranking. */
  prompts: string[];
  guidance: MaterialityGuidance | null;
  indicativeLowInr: number | null;
  indicativeHighInr: number | null;
  assessment: BenchmarkAssessment | null;
  rationale: string | null;
  /** Optimistic-lock version of the assessment row; 0 = not assessed. */
  version: number;
}

export interface NormalisationAdjustment {
  id: string;
  code: string;
  description: string;
  /** Dataset units, signed. */
  amount: number;
  reason: string | null;
  recurring: boolean;
  evidence: string | null;
  version: number;
}

export interface NormalisationSummary {
  reportedPbt: number | null;
  adjustmentsTotal: number;
  normalisedPbt: number | null;
}

// ── 03.3.5 / 10 Judgment assistants ──────────────────────────────────────────

/** A neutral judgment factor: never scored, never an automatic % adjustment (§10). */
export interface JudgmentFactor {
  key: string;
  label: string;
  /** true / false from engagement facts; null = auditor to confirm. */
  present: boolean | null;
  detail: string | null;
  source: string;
  /** Ticked by the auditor as considered. */
  considered: boolean;
}

export const PCT_FACTOR_KEYS = [
  'broad_user_base',
  'lender_dependence',
  'benchmark_volatility',
  'initial_audit',
  'audit_differences_history',
  'complexity_estimates',
  'reporting_control_concerns',
  'stable_simple_operations',
] as const;
export type PctFactorKey = (typeof PCT_FACTOR_KEYS)[number];

export const AGGREGATION_FACTOR_KEYS = [
  'prior_misstatements',
  'prior_differences',
  'control_deficiencies',
  'initial_audit',
  'management_system_changes',
  'complex_estimates',
  'multiple_locations',
  'fraud',
  'other',
] as const;
export type AggregationFactorKey = (typeof AGGREGATION_FACTOR_KEYS)[number];

export type MethodologyStatus = 'within_guidance' | 'outside_guidance' | 'no_guidance';
export const METHODOLOGY_STATUS_LABEL: Record<MethodologyStatus, string> = {
  within_guidance: 'Within DHVAJ guidance',
  outside_guidance: 'Outside DHVAJ guidance',
  no_guidance: 'No DHVAJ guidance configured',
};

// ── 03.3.7 Specific materiality — MAT-06 ─────────────────────────────────────

export const MAT06_ANSWERS = ['no', 'yes', 'further_assessment'] as const;
export type Mat06Answer = (typeof MAT06_ANSWERS)[number];

export const SPECIFIC_SCOPE_TYPES = ['class_of_transactions', 'account_balance', 'disclosure'] as const;
export type SpecificScopeType = (typeof SPECIFIC_SCOPE_TYPES)[number];
export const SPECIFIC_SCOPE_TYPE_LABEL: Record<SpecificScopeType, string> = {
  class_of_transactions: 'Class of transactions',
  account_balance: 'Account balance',
  disclosure: 'Disclosure',
};
export const SPECIFIC_THRESHOLD_TYPES = ['monetary', 'qualitative'] as const;
export type SpecificThresholdType = (typeof SPECIFIC_THRESHOLD_TYPES)[number];

export interface SpecificMaterialityRecord {
  id: string;
  code: string;
  scopeType: SpecificScopeType;
  scope: string;
  thresholdType: SpecificThresholdType;
  amount: number | null;
  specificPm: number | null;
  reason: string;
  affectedAreas: string[];
  version: number;
}

export interface SpecificMaterialityInput {
  scopeType: SpecificScopeType;
  scope: string;
  thresholdType: SpecificThresholdType;
  amount?: number | null;
  specificPm?: number | null;
  reason: string;
  affectedAreas?: string[];
  /** Required on update. */
  version?: number;
}

/** Prompts surfaced BEFORE MAT-06 is answered — prompts, not conclusions. */
export interface MaterialityPrompt {
  key: string;
  label: string;
  present: boolean | null;
  detail: string | null;
  source: string;
}

// ── 03.3.9 Qualitative challenge ─────────────────────────────────────────────

export const QUALITATIVE_CONSIDERATIONS: readonly { key: string; label: string }[] = [
  { key: 'fraud', label: 'Fraud / suspected fraud' },
  { key: 'related_parties', label: 'Related parties / promoters' },
  { key: 'directors_kmp', label: 'Directors / KMP' },
  { key: 'law_regulation', label: 'Law / regulation' },
  { key: 'covenant_regulatory_threshold', label: 'Debt covenant / regulatory threshold' },
  { key: 'profit_loss_flip', label: 'Changes profit to loss / loss to profit or masks a trend' },
  { key: 'remuneration_threshold', label: 'Management remuneration / bonus threshold' },
  { key: 'sensitive_disclosure', label: 'Sensitive disclosure' },
  { key: 'accounting_policy', label: 'Accounting-policy matter' },
  { key: 'segment_information', label: 'Segment / disaggregated information' },
  { key: 'other', label: 'Other user-sensitive circumstance' },
];

export const QUALITATIVE_RESPONSES = [
  'no_special_implication',
  'specific_materiality',
  'qualitative_consideration',
  'further_assessment',
] as const;
export type QualitativeResponse = (typeof QUALITATIVE_RESPONSES)[number];
export const QUALITATIVE_RESPONSE_LABEL: Record<QualitativeResponse, string> = {
  no_special_implication: 'No special implication',
  specific_materiality: 'Specific materiality',
  qualitative_consideration: 'Qualitative consideration',
  further_assessment: 'Further assessment',
};

export interface QualitativeChallengeItem {
  key: string;
  label: string;
  /** System prompt from engagement facts, if any. */
  prompt: string | null;
  response: QualitativeResponse | null;
  note: string | null;
  signalId: string | null;
  signalCode: string | null;
  focusId: string | null;
  focusCode: string | null;
  significant: boolean;
  /** 0 = not yet answered. */
  version: number;
}

export interface SaveQualitativeInput {
  response: QualitativeResponse;
  note?: string | null;
  signalId?: string | null;
  focusId?: string | null;
  significant?: boolean;
  version: number;
}

// ── 03.3.10 Sensitivity — MAT-07 ─────────────────────────────────────────────

export interface SensitivityRow {
  key: string;
  label: string;
  formula: string;
  /** Percentage (or null when not meaningful). */
  value: number | null;
  display: string;
  note: string | null;
}

// ── 03.3.11 Revision ─────────────────────────────────────────────────────────

export const REVISION_TRIGGERS = [
  'actual_results',
  'significant_transaction',
  'changed_circumstances',
  'audit_finding',
  'corrected_financial_information',
  'other',
] as const;
export type RevisionTrigger = (typeof REVISION_TRIGGERS)[number];
export const REVISION_TRIGGER_LABEL: Record<RevisionTrigger, string> = {
  actual_results: 'Actual results',
  significant_transaction: 'Significant transaction',
  changed_circumstances: 'Changed circumstances',
  audit_finding: 'Audit finding',
  corrected_financial_information: 'Corrected financial information',
  other: 'Other',
};

export interface StartRevisionInput {
  trigger: RevisionTrigger;
  reason: string;
  revisionDate?: string | null;
  ownerEmployeeId?: string | null;
}

export interface RevisionImpactItem {
  id: string;
  itemKey: string;
  label: string;
  detail: string | null;
  applicable: boolean;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  status: 'open' | 'resolved';
  resolution: string | null;
  version: number;
}

export interface UpdateRevisionItemInput {
  ownerEmployeeId?: string | null;
  status?: 'open' | 'resolved';
  resolution?: string | null;
  version: number;
}

/** Amounts of the previous completed version (read-only baseline). */
export interface MaterialityBaseline {
  versionLabel: string;
  overallMateriality: number | null;
  performanceMateriality: number | null;
  clearlyTrivial: number | null;
  specificCount: number;
  benchmark: MaterialityBenchmark | null;
  selectedPct: number | null;
}

export interface MaterialityVersionHistory {
  versionNo: number;
  versionLabel: string;
  status: MaterialityDeterminationStatus;
  overallMateriality: number | null;
  performanceMateriality: number | null;
  clearlyTrivial: number | null;
  revisionTrigger: RevisionTrigger | null;
  revisionReason: string | null;
  completedByName: string | null;
  completedAt: string | null;
}

// ── Determination ────────────────────────────────────────────────────────────

export type MaterialityDeterminationStatus = 'draft' | 'complete' | 'superseded';
export const MAT04_ANSWERS = ['yes', 'no_adjust'] as const;
export type Mat04Answer = (typeof MAT04_ANSWERS)[number];
export const MAT07_ANSWERS = ['yes', 'no_reassess'] as const;
export type Mat07Answer = (typeof MAT07_ANSWERS)[number];
export const MAT08_ANSWERS = ['yes_complete', 'no_reassess'] as const;
export type Mat08Answer = (typeof MAT08_ANSWERS)[number];

export interface MaterialityDetermination {
  /** null until the first save creates v1.0. */
  id: string | null;
  versionNo: number;
  /** v1.0, v1.1, … */
  versionLabel: string;
  status: MaterialityDeterminationStatus;
  methodologyVersion: string | null;
  principalUsers: PrincipalUser[];
  principalUsersOther: string | null;
  userFocus: UserFocusMeasure[];
  userFocusOther: string | null;
  pyOverallMateriality: number | null;
  pyPerformanceMateriality: number | null;
  pyClearlyTrivial: number | null;
  pyBenchmark: string | null;
  pySource: string | null;
  pyAuditDifferences: string | null;
  normalisationRationale: string | null;
  selectedBenchmark: MaterialityBenchmark | null;
  otherBenchmarkLabel: string | null;
  /** Dataset units. */
  otherBenchmarkAmount: number | null;
  otherBenchmarkSource: string | null;
  benchmarkRationale: string | null;
  /** Snapshot of the benchmark amount used (dataset units). */
  benchmarkAmount: number | null;
  selectedPct: number | null;
  /** Unrounded rupees. */
  calculatedOm: number | null;
  selectedOm: number | null;
  omAdjustmentReason: string | null;
  omOverrideReason: string | null;
  pctFactorsConsidered: string[];
  pctFactorsNote: string | null;
  mat04: Mat04Answer | null;
  mat04Rationale: string | null;
  aggregationFactors: string[];
  aggregationOther: string | null;
  pmPct: number | null;
  calculatedPm: number | null;
  selectedPm: number | null;
  pmAdjustmentReason: string | null;
  pmRationale: string | null;
  pmOverrideReason: string | null;
  mat06: Mat06Answer | null;
  mat06Note: string | null;
  selectedCtt: number | null;
  cttRationale: string | null;
  cttOverrideReason: string | null;
  mat07: Mat07Answer | null;
  mat07Note: string | null;
  revisionTrigger: RevisionTrigger | null;
  revisionReason: string | null;
  revisionDate: string | null;
  revisionOwnerEmployeeId: string | null;
  revisionOwnerName: string | null;
  conclusionSummary: string | null;
  mat08: Mat08Answer | null;
  completedByName: string | null;
  completedAt: string | null;
  /** Optimistic lock; 0 = not yet saved. */
  version: number;
}

/** Partial update of the current draft. Omitted fields stay unchanged. */
export interface UpdateMaterialityInput {
  principalUsers?: PrincipalUser[];
  principalUsersOther?: string | null;
  userFocus?: UserFocusMeasure[];
  userFocusOther?: string | null;
  pyOverallMateriality?: number | null;
  pyPerformanceMateriality?: number | null;
  pyClearlyTrivial?: number | null;
  pyBenchmark?: string | null;
  pySource?: string | null;
  pyAuditDifferences?: string | null;
  normalisationRationale?: string | null;
  selectedBenchmark?: MaterialityBenchmark | null;
  otherBenchmarkLabel?: string | null;
  otherBenchmarkAmount?: number | null;
  otherBenchmarkSource?: string | null;
  benchmarkRationale?: string | null;
  selectedPct?: number | null;
  selectedOm?: number | null;
  omAdjustmentReason?: string | null;
  omOverrideReason?: string | null;
  pctFactorsConsidered?: string[];
  pctFactorsNote?: string | null;
  mat04?: Mat04Answer | null;
  mat04Rationale?: string | null;
  aggregationFactors?: string[];
  aggregationOther?: string | null;
  pmPct?: number | null;
  selectedPm?: number | null;
  pmAdjustmentReason?: string | null;
  pmRationale?: string | null;
  pmOverrideReason?: string | null;
  mat06?: Mat06Answer | null;
  mat06Note?: string | null;
  selectedCtt?: number | null;
  cttRationale?: string | null;
  cttOverrideReason?: string | null;
  mat07?: Mat07Answer | null;
  mat07Note?: string | null;
  conclusionSummary?: string | null;
  mat08?: Mat08Answer | null;
  /** Re-take the benchmark snapshot after 03.2 figures changed (draft only). */
  reconfirmSource?: boolean;
  version: number;
}

export interface AssessBenchmarkInput {
  assessment: BenchmarkAssessment;
  rationale?: string | null;
  /** 0 when first assessed. */
  version: number;
}

export interface NormalisationAdjustmentInput {
  description: string;
  amount: number;
  reason?: string | null;
  recurring?: boolean;
  evidence?: string | null;
  version?: number;
}

/** Calculations on the current draft (never stored as a conclusion). */
export interface MaterialityComputed {
  /** Live benchmark amount (dataset units) for the selected benchmark. */
  liveBenchmarkAmount: number | null;
  liveCalculatedOm: number | null;
  /** Methodology-rounded display amount (unrounded is stored). */
  roundedOm: number | null;
  /** Selected OM as a % of the benchmark actually used. */
  effectiveOmPct: number | null;
  omMethodologyStatus: MethodologyStatus;
  liveCalculatedPm: number | null;
  roundedPm: number | null;
  effectivePmPct: number | null;
  pmMethodologyStatus: MethodologyStatus;
  effectiveCttPct: number | null;
  cttMethodologyStatus: MethodologyStatus;
  /** 03.2 figures behind the selected benchmark changed since selection. */
  sourceChanged: boolean;
  sourceChangeDetail: string | null;
  /** Generated "why appropriate" draft from selected aggregation factors. */
  pmRationaleDraft: string | null;
}

export interface PartnerAttentionTrigger {
  key: string;
  label: string;
  detail: string;
}

export interface MaterialityImpactConsumer {
  consumer: string;
  use: string;
}

export interface MaterialityAuthorityRef {
  code: string;
  label: string;
  title: string | null;
  provisionNumber: string | null;
}

export interface MaterialityDatasetInfo {
  ready: boolean;
  reason: string | null;
  periodEnd: string | null;
  currency: string | null;
  units: FinancialUnit | null;
  unitLabel: string | null;
  unitFactor: number | null;
  dataStatus: DatasetStatus | null;
  cySource: string | null;
}

export interface MaterialitySummary {
  determination: MaterialityDetermination;
  /** The previous completed version, when this draft is a revision. */
  baseline: MaterialityBaseline | null;
  history: MaterialityVersionHistory[];
  dataset: MaterialityDatasetInfo;
  context: MaterialityContextItem[];
  methodology: MaterialityMethodology;
  candidates: BenchmarkCandidate[];
  adjustments: NormalisationAdjustment[];
  normalisation: NormalisationSummary;
  pctFactors: JudgmentFactor[];
  aggregationFactors: JudgmentFactor[];
  specificPrompts: MaterialityPrompt[];
  specific: SpecificMaterialityRecord[];
  qualitative: QualitativeChallengeItem[];
  sensitivity: SensitivityRow[];
  computed: MaterialityComputed;
  partnerAttention: PartnerAttentionTrigger[];
  revisionItems: RevisionImpactItem[];
  impactPreview: MaterialityImpactConsumer[];
  authorities: MaterialityAuthorityRef[];
  completion: PlanningCompletionCheck[];
}

/** Mandatory UI disclosure (§7). */
export const MATERIALITY_GUIDANCE_DISCLOSURE =
  'Percentages/ranges displayed are DHVAJ methodology guidance. SA 320 does not prescribe a fixed benchmark or percentage. Final benchmark, percentage and amount require professional judgment.';

/** Mandatory concept warning (§13). */
export const CLEARLY_TRIVIAL_WARNING =
  'Clearly Trivial is NOT another expression for Not Material. If there is uncertainty whether a matter is clearly trivial, it is not treated as clearly trivial. The threshold supports accumulation of identified misstatements under SA 450; it is not an automatic write-off or dismissal rule.';

export function materialityVersionLabel(versionNo: number): string {
  return `v1.${versionNo - 1}`;
}
