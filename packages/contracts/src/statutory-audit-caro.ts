/**
 * 02.4 — CARO 2020 Applicability (Implementation Guide §9.4; DHVAJ 02.4 spec).
 *
 * Decides whether the Companies (Auditor's Report) Order 2020 applies to the
 * audit report (Level 1), by taking the **direct exemptions first** (CARO-01..05:
 * banking, insurance, Section 8, OPC, small company — consuming the 02.1
 * classifications, never recomputing them), then the **cumulative private-company
 * test**: a private company is exempt only when it is NOT a holding/subsidiary
 * of a public company AND its paid-up capital + reserves & surplus (balance-sheet
 * date), its aggregate bank/FI borrowings (at ANY point in the year, not
 * year-end) and its total revenue (CARO basis, incl. discontinuing operations)
 * are each within the CARO limits. Any one condition failing → the route fails.
 *
 * Two-level model: Level 1 (this assessment) decides whether CARO applies to the
 * report, per report context (standalone → paragraph 3 programme; consolidated
 * → clause 3(xxi) only); Level 2 (the clause work programme, statutory-audit-
 * caro-programme.ts) decides each clause's relevance to the facts. A clause
 * being "Not Applicable to Facts" NEVER changes Level 1.
 *
 * NO statutory number lives in code (guide §1): every limit, its measurement
 * basis and the public-group test resolve from the Audit Rules Library by the
 * engagement's audit period, so a future change affects future periods only.
 */

import type { MasterFact } from './statutory-audit';
import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

/** The CARO 2020 Level-1 applicability outcome the engine concludes (§1, §8). */
export const CARO_OUTCOME = {
  /** CARO 2020 applies to the audit report. */
  applicable: 'applicable',
  /** Directly exempt, or exempt via the private-company cumulative test. */
  notApplicableExempt: 'not_applicable_exempt',
  /** The system cannot decide (e.g. period predates CARO 2020) — a professional must. */
  furtherAssessment: 'further_assessment',
  /** A deciding fact is absent — never a guess (guide §4.3, spec §7). */
  informationInsufficient: 'information_insufficient',
} as const;
export type CaroOutcome = (typeof CARO_OUTCOME)[keyof typeof CARO_OUTCOME];
export const CARO_OUTCOMES: CaroOutcome[] = Object.values(CARO_OUTCOME);

/** Outcomes a professional may record as the conclusion (CARO-06 override choices). */
export const CARO_CONCLUSIONS: CaroOutcome[] = [
  CARO_OUTCOME.applicable,
  CARO_OUTCOME.notApplicableExempt,
  CARO_OUTCOME.furtherAssessment,
];

/** CARO-06 professional action (spec §9). */
export const CARO_PROFESSIONAL_ACTION = {
  confirm: 'confirm',
  override: 'override',
  informationPending: 'information_pending',
} as const;
export type CaroProfessionalAction =
  (typeof CARO_PROFESSIONAL_ACTION)[keyof typeof CARO_PROFESSIONAL_ACTION];
export const CARO_PROFESSIONAL_ACTIONS: CaroProfessionalAction[] =
  Object.values(CARO_PROFESSIONAL_ACTION);

/** A CARO-01..05 answer (spec §5): System Yes / No / Information Pending. */
export const CARO_ANSWER = { yes: 'yes', no: 'no', pending: 'pending' } as const;
export type CaroAnswer = (typeof CARO_ANSWER)[keyof typeof CARO_ANSWER];

/** One cumulative private-company condition's result (spec §6). */
export const CARO_CONDITION_RESULT = {
  satisfied: 'satisfied',
  failed: 'failed',
  pending: 'pending',
  /** Not reached — a direct exemption or an earlier failure already decided the route. */
  notTested: 'not_tested',
} as const;
export type CaroConditionResult =
  (typeof CARO_CONDITION_RESULT)[keyof typeof CARO_CONDITION_RESULT];

/** The direct-exemption tests CARO-01..05 (spec §5). */
export const CARO_DIRECT_TEST = {
  banking: 'banking',
  insurance: 'insurance',
  section8: 'section_8',
  opc: 'opc',
  smallCompany: 'small_company',
} as const;
export type CaroDirectTestKey = (typeof CARO_DIRECT_TEST)[keyof typeof CARO_DIRECT_TEST];

/** The four cumulative private-company conditions (spec §6, §21). */
export const CARO_CONDITION = {
  publicGroup: 'public_group',
  capitalReserves: 'capital_reserves',
  borrowings: 'borrowings',
  revenue: 'revenue',
} as const;
export type CaroConditionKey = (typeof CARO_CONDITION)[keyof typeof CARO_CONDITION];

/** The route the system took to its conclusion (spec §8 "Entity route"). */
export const CARO_ENTITY_ROUTE = {
  nonCompany: 'non_company',
  directExemption: 'direct_exemption',
  privateCompany: 'private_company',
  publicCompany: 'public_company',
  undetermined: 'undetermined',
} as const;
export type CaroEntityRoute = (typeof CARO_ENTITY_ROUTE)[keyof typeof CARO_ENTITY_ROUTE];

/** Report contexts CARO is concluded for (spec §10). */
export const CARO_REPORT_CONTEXT = {
  standalone: 'standalone',
  consolidated: 'consolidated',
} as const;
export type CaroReportContext = (typeof CARO_REPORT_CONTEXT)[keyof typeof CARO_REPORT_CONTEXT];

export const CARO_CONTEXT_STATUS = {
  applicable: 'applicable',
  notApplicable: 'not_applicable',
  pending: 'pending',
} as const;
export type CaroContextStatus = (typeof CARO_CONTEXT_STATUS)[keyof typeof CARO_CONTEXT_STATUS];

/**
 * How the borrowing figures were obtained (spec §7): an "at any point during the
 * year" test cannot rest on year-end balances alone.
 */
export const CARO_BORROWING_DATA_BASIS = {
  daily: 'daily',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearEndOnly: 'year_end_only',
} as const;
export type CaroBorrowingDataBasis =
  (typeof CARO_BORROWING_DATA_BASIS)[keyof typeof CARO_BORROWING_DATA_BASIS];
export const CARO_BORROWING_DATA_BASES: CaroBorrowingDataBasis[] =
  Object.values(CARO_BORROWING_DATA_BASIS);

/**
 * Provision Library codes 02.4 links through (spec §17) — resolved by code and
 * audit period, never a URL in a component. A missing code renders no link.
 */
export const CARO_PROVISION_CODE = {
  order: 'CARO_2020',
  paragraph1: 'CARO_2020_PARA_1',
  guidanceNote: 'ICAI_GN_CARO_2020',
  section8: 'COS_ACT_8',
  section2_62: 'COS_ACT_2_62',
  section2_85: 'COS_ACT_2_85',
  section143_11: 'COS_ACT_143_11',
} as const;

/** One bank/FI balance in the year, for the aggregate "at any point" test (spec §7). */
export interface CaroBorrowingPoint {
  /** ISO date of the balance. */
  asOn: string;
  lender: string;
  lenderType: 'bank' | 'financial_institution';
  /** Outstanding (₹) on that date — all covered short/long-term, secured/unsecured facilities. */
  amount: number;
}

/**
 * The normalised facts the 02.4 engine reads. Direct-exemption and classification
 * facts are assembled from 02.1 + masters (null = not yet known → Information
 * Pending); the CARO-measurement inputs are captured on the sub-assessment.
 */
export interface CaroFacts {
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  isBanking: boolean | null;
  isInsurance: boolean | null;
  isSection8: boolean | null;
  isOpc: boolean | null;
  /** The APPROVED 02.1 §2(85) conclusion (null until 02.1 is confirmed). */
  isSmallCompany: boolean | null;
  /** The 02.1 small-company rule version, cited — never recalculated here. */
  smallCompanyBasis?: string | null;
  /** Whether 02.1 holds these classifications yet (an unconfirmed profile still answers). */
  profileAvailable?: boolean;
  isHoldingOrSubsidiaryOfPublic: boolean | null;
  publicGroupCounterparties?: string[];
  paidUpCapital?: number | null;
  reservesAndSurplus?: number | null;
  /** Total when components are not captured (e.g. from the client master). */
  capitalPlusReserves: number | null;
  borrowingSchedule?: CaroBorrowingPoint[] | null;
  borrowingDataBasis?: CaroBorrowingDataBasis | null;
  /** The aggregate peak when entered directly (with its data basis). */
  peakBankFiBorrowings: number | null;
  revenueFromOperations?: number | null;
  otherIncome?: number | null;
  discontinuedOperationsRevenue?: number | null;
  totalRevenue: number | null;
  /** 02.6: whether consolidated FS are in scope (null = 02.6 not concluded). */
  cfsInScope?: boolean | null;
  cfsBasis?: string | null;
}

/** The 02.4-specific facts captured on the sub-assessment (not held by 02.1). */
export interface CaroCapturedFacts {
  /** null = not yet answered (Information Pending). */
  isHoldingOrSubsidiaryOfPublic: boolean | null;
  publicGroupNote?: string | null;
  paidUpCapital?: number | null;
  reservesAndSurplus?: number | null;
  capitalPlusReserves: number | null;
  borrowingSchedule?: CaroBorrowingPoint[] | null;
  borrowingDataBasis?: CaroBorrowingDataBasis | null;
  peakBankFiBorrowings: number | null;
  revenueFromOperations?: number | null;
  otherIncome?: number | null;
  discontinuedOperationsRevenue?: number | null;
  totalRevenue: number | null;
  /** CARO-06 override extras (stored with the facts, frozen by the decision). */
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
}

/** CARO-01..05 — one direct exemption test (spec §5). */
export interface CaroDirectTest {
  /** 'CARO-01' … 'CARO-05'. */
  code: string;
  key: CaroDirectTestKey;
  question: string;
  answer: CaroAnswer;
  /** Why — e.g. "02.1 special entity types include Banking company". */
  basis: string;
  /** Where the fact came from (Open Source Assessment). */
  sourceSection: '02.1' | 'master' | null;
  /** Provision Library codes for View CARO 2020 paragraph 1 | View Section 8 … */
  provisionCodes: string[];
  /** Whether this test decided the route (the first Yes). */
  decisive: boolean;
}

/** One cumulative private-company condition with its traceable measurement (spec §6–§8). */
export interface CaroCondition {
  key: CaroConditionKey;
  label: string;
  /** The requirement rendered from the rule, e.g. "≤ ₹1.00 cr as on balance sheet date". */
  requirement: string;
  result: CaroConditionResult;
  ruleCode: string | null;
  ruleVersionId: string | null;
  ruleVersion: number | null;
  ruleEffectiveFrom: string | null;
  operator: string | null;
  threshold: number | null;
  unit: string | null;
  measurementBasis: string | null;
  /** The measured value (₹; for the group test 1 = relationship exists, 0 = none). */
  actual: number | null;
  actualDisplay: string | null;
  limitDisplay: string | null;
  /** How the value was computed from its source values (preserved, spec §7). */
  calculation: string | null;
  pendingReason: string | null;
  authorityProvisionId: string | null;
  guidanceReference: string | null;
}

export interface CaroPrivateTest {
  /** Whether the private-company route was reached (private company, no direct exemption). */
  tested: boolean;
  /** Qualified only if EVERY condition is satisfied; null while any is pending. */
  qualified: boolean | null;
  conditions: CaroCondition[];
}

/** A source fact shown read-only under "Facts Used" (spec §2, §4). */
export interface CaroFactUsed {
  key: string;
  label: string;
  value: string;
  source: string;
  /** Where Open Source Assessment goes. */
  sourceSection: '02.1' | '02.4' | '02.6' | 'master';
}

/** A fact the conclusion is blocked on (Information Pending, spec §9). */
export interface CaroMissingFact {
  key: string;
  label: string;
  source: string;
}

/** The structured applicability conclusion (spec §8). */
export interface CaroConclusionSummary {
  result: CaroOutcome;
  entityRoute: CaroEntityRoute;
  /** The direct exemption that decided it, e.g. "Banking company", or null. */
  directExemption: string | null;
  privateExemption: 'qualified' | 'not_qualified' | 'pending' | 'not_required';
  failedConditions: CaroConditionKey[];
  /** First failed condition, its actual value and the configured limit (spec §8 example). */
  failedCondition: string | null;
  actualValue: string | null;
  configuredLimit: string | null;
  /** e.g. "CARO 2020 (effective 2021-04-01)". */
  orderVersion: string | null;
}

/** CARO reporting scope for one report context (spec §10). */
export interface CaroReportContextResult {
  context: CaroReportContext;
  status: CaroContextStatus;
  /** Whether CARO work is required for this context (null while pending). */
  applies: boolean | null;
  /** standalone → paragraph 3 programme; consolidated → clause 3(xxi) only. */
  scope: 'paragraph_3' | 'clause_3_xxi' | null;
  basis: string;
}

/** Structured engine extras stored in `systemDetail`. */
export interface CaroDetail {
  /** Level 1: whether CARO applies to the audit report. */
  level1Applies: boolean;
  /** Why the report is exempt (direct or cumulative), or null when CARO applies. */
  exemptionReason: string | null;
  /** The CARO Order version resolved for the period (spec §19), null when none. */
  orderVersion: { code: string; effectiveFrom: string } | null;
  directTests: CaroDirectTest[];
  /** The cumulative private-company test, or null when never reached. */
  privateTest: CaroPrivateTest | null;
  conclusion: CaroConclusionSummary;
  factsUsed: CaroFactUsed[];
  missingFacts: CaroMissingFact[];
  reportContexts: CaroReportContextResult[];
  /** When applicable, the standalone paragraph-3 clause programme is instantiated (Level 2). */
  instantiatesClauseProgramme: boolean;
  caroScope: 'standalone_paragraph_3' | null;
  /** Every Provision Library code the result cites (View all triggered provisions). */
  provisionCodes: string[];
}

/** The result of the pure 02.4 engine (guide §7 signature). */
export interface CaroResult {
  outcome: CaroOutcome;
  state: FrameworkState;
  basis: string;
  /** The rule version frozen onto the conclusion (the deciding one), when one drove it. */
  ruleVersionId: string | null;
  /** The CARO 2020 provision (period-correct), frozen by the service. */
  authorityProvisionId: string | null;
  detail: CaroDetail;
}

export interface CaroCompletionItem {
  key: string;
  label: string;
  /** null = not relevant for this engagement. */
  met: boolean | null;
  detail: string | null;
}

/** §19 completion criteria — 02.4 COMPLETE per resolved report context. */
export interface CaroCompletion {
  complete: boolean;
  status: 'not_started' | 'in_progress' | 'complete';
  items: CaroCompletionItem[];
  /** Per-context COMPLETE (consolidated null when no CFS is in scope). */
  contexts: { standalone: boolean; consolidated: boolean | null };
}

export interface CaroPartnerApproval {
  /** A significant override / complex conclusion needs the Engagement Partner (CARO-06). */
  required: boolean;
  reason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
}

/** A source fact that changed since the conclusion, with the rules it feeds (spec §2). */
export interface CaroReevaluationChange {
  key: string;
  label: string;
  before: string;
  after: string;
  /** Rule IDs / tests affected, e.g. ['CARO_PVT_REVENUE'] or ['CARO-03']. */
  affectedRules: string[];
}

/** Prior-year CARO context — display only; current-year rules always rerun (spec §15). */
export interface CaroPriorYear {
  workflowInstanceId: string;
  financialYear: string;
  outcome: CaroOutcome | null;
  isOverridden: boolean;
  exemptionBasis: string | null;
  decidedAt: string | null;
  /** Prior exemption-basis facts that differ this year (flagged). */
  changedFacts: Array<{ label: string; prior: string; current: string }>;
}

/** The 02.4 read shape for one statutory-audit workflow instance. */
export interface StatutoryAuditCaro {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail. */
  detail: CaroDetail | null;
  capturedFacts: CaroCapturedFacts;
  /** The base facts assembled from 02.1 + 02.6 + masters + captured facts. */
  baseFacts: CaroFacts;
  /**
   * What the client master says for these facts, with its source — filled in
   * on first open so the team confirms rather than types (Guide §1).
   */
  masterFacts: MasterFact[];
  /** True once 02.1 is confirmed — 02.4 reads its frozen classifications. */
  upstreamReady: boolean;
  auditFinancialYear?: string;
  professionalAction?: CaroProfessionalAction | null;
  pendingReason?: string | null;
  partnerApproval?: CaroPartnerApproval;
  completion?: CaroCompletion;
  reevaluation?: { required: boolean; changes: CaroReevaluationChange[] };
  priorYear?: CaroPriorYear | null;
  /** Section 02 approved — 02.4 is frozen until a controlled reopen. */
  approved?: boolean;
  viewerIsPartner?: boolean;
  /** A technical memo is suggested (override, complexity, consultation — spec §16). */
  memoSuggested?: boolean;
}

/**
 * The 02.4 result downstream reads (Track B clause programme, 3(xxi), Section 08):
 * the frozen conclusion when decided, else the live suggestion.
 */
export interface CaroContextResult {
  applies: boolean | null;
  status: CaroContextStatus;
}

export interface CaroApprovedResult {
  workflowInstanceId: string;
  /** Conclusion when decided, else the live suggestion. */
  outcome: CaroOutcome | null;
  /** A professional conclusion is recorded (confirm / override). */
  decided: boolean;
  /** 02.4 COMPLETE (§19). */
  complete: boolean;
  standalone: CaroContextResult;
  consolidated: CaroContextResult & { cfsInScope: boolean };
  financialYear: string | null;
  /** ISO date — resolve the clause library version in force with it. */
  periodStart: string;
}

/** Capture the 02.4-specific CARO measurement facts (spec §6, §7). */
export interface SetCaroFactsInput {
  isHoldingOrSubsidiaryOfPublic?: boolean | null;
  publicGroupNote?: string | null;
  paidUpCapital?: number | null;
  reservesAndSurplus?: number | null;
  capitalPlusReserves?: number | null;
  borrowingSchedule?: CaroBorrowingPoint[] | null;
  borrowingDataBasis?: CaroBorrowingDataBasis | null;
  peakBankFiBorrowings?: number | null;
  revenueFromOperations?: number | null;
  otherIncome?: number | null;
  discontinuedOperationsRevenue?: number | null;
  totalRevenue?: number | null;
  version: number;
}

/**
 * CARO-06 professional conclusion (spec §9): Confirm the system assessment;
 * Override with the final selection, reason, technical basis and supporting
 * evidence; or Information Pending naming the blocking fact(s).
 */
export interface RecordCaroDecisionInput {
  action?: CaroProfessionalAction;
  conclusion?: CaroOutcome;
  /** The override reason. */
  basis?: string | null;
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
  pendingReason?: string | null;
  impact?: string | null;
  version: number;
}

/** CARO-06 Engagement Partner approval of a significant override / complex conclusion. */
export interface PartnerApproveCaroInput {
  note?: string | null;
  version: number;
}

/** Result of filling 02.4 facts from the client master. */
export interface StatutoryAuditCaroMasterFillResult {
  caro: StatutoryAuditCaro;
  /** What was filled (empty when the master had nothing new to add). */
  filled: string[];
}
