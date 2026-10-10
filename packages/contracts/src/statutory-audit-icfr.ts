/**
 * 02.5 — Internal Financial Controls / ICFR Reporting (Implementation Guide §9.5;
 * DHVAJ 02.5 spec v1.1).
 *
 * Decides whether the auditor must report under Section 143(3)(i) on internal
 * financial controls with reference to financial statements (ICFR):
 * Applicable / Exempt / Further Assessment Required.
 *
 * Decision flow (spec §5): resolve the exemption-notification version for the
 * period → a non-private company reports → a private company tests the OPC route,
 * then the approved Small Company route, then BOTH monetary conditions (turnover
 * per the latest audited financial statements < ₹50cr AND maximum aggregate
 * covered borrowings from banks + FIs + any body corporate at any point in the
 * year < ₹25cr) → the §92 / §137 filing-default condition gates every route.
 *
 * Critical separations (spec §1, §12, §18): an ICFR *reporting* exemption never
 * disables Section 05 normal control work; Rule 11(g) audit-trail reporting is a
 * SEPARATE conclusion (02.7).
 *
 * NO statutory number lives in code: limits, operators, the monetary AND/OR join,
 * the covered borrowing sources, the turnover period and the route / filing
 * prerequisites resolve from the Audit Rules Library for the audit period.
 */

import type { MasterFact } from './statutory-audit';
import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

/** The Section 143(3)(i) ICFR-reporting outcome the engine concludes (§1). */
export const ICFR_OUTCOME = {
  /** The auditor must report on ICFR under §143(3)(i). */
  applicable: 'applicable',
  /** Exempt from ICFR reporting (private-company MCA exemption). */
  exempt: 'exempt',
  /** The system cannot decide (e.g. no exemption-notification version for the period). */
  furtherAssessment: 'further_assessment',
  /** A deciding fact is absent — never a guess (Information Pending). */
  informationInsufficient: 'information_insufficient',
} as const;
export type IcfrOutcome = (typeof ICFR_OUTCOME)[keyof typeof ICFR_OUTCOME];
export const ICFR_OUTCOMES: IcfrOutcome[] = Object.values(ICFR_OUTCOME);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const ICFR_CONCLUSIONS: IcfrOutcome[] = [
  ICFR_OUTCOME.applicable,
  ICFR_OUTCOME.exempt,
  ICFR_OUTCOME.furtherAssessment,
];

export const ICFR_OUTCOME_LABEL: Record<IcfrOutcome, string> = {
  applicable: 'Section 143(3)(i) Reporting Applicable',
  exempt: 'Reporting Exempt',
  further_assessment: 'Further Assessment Required',
  information_insufficient: 'Information Pending',
};

/** IFC-04 Manager action (spec §11). */
export const ICFR_PROFESSIONAL_ACTION = {
  confirm: 'confirm',
  override: 'override',
  informationPending: 'information_pending',
} as const;
export type IcfrProfessionalAction =
  (typeof ICFR_PROFESSIONAL_ACTION)[keyof typeof ICFR_PROFESSIONAL_ACTION];
export const ICFR_PROFESSIONAL_ACTIONS: IcfrProfessionalAction[] =
  Object.values(ICFR_PROFESSIONAL_ACTION);

/** The entity route that decided the assessment (spec §10). */
export const ICFR_ENTITY_ROUTE = {
  notCompany: 'not_company',
  publicCompany: 'public_company',
  privateCompany: 'private_company',
  unknown: 'unknown',
} as const;
export type IcfrEntityRoute = (typeof ICFR_ENTITY_ROUTE)[keyof typeof ICFR_ENTITY_ROUTE];

/** An exemption route (OPC / Small Company) result (spec §6). */
export const ICFR_ROUTE_RESULT = {
  exemptRoute: 'exempt_route',
  no: 'no',
  pending: 'pending',
  /** Not reached — an earlier route already resolved, or not a private company. */
  notTested: 'not_tested',
  /** No rule version for this route is in force for the period. */
  notAvailable: 'not_available',
} as const;
export type IcfrRouteResult = (typeof ICFR_ROUTE_RESULT)[keyof typeof ICFR_ROUTE_RESULT];

/** A monetary / filing condition result (spec §6). */
export const ICFR_CONDITION_RESULT = {
  satisfied: 'satisfied',
  failed: 'failed',
  pending: 'pending',
  notTested: 'not_tested',
} as const;
export type IcfrConditionResult =
  (typeof ICFR_CONDITION_RESULT)[keyof typeof ICFR_CONDITION_RESULT];

export const ICFR_ROUTE = { opc: 'opc', smallCompany: 'small_company' } as const;
export type IcfrRouteKey = (typeof ICFR_ROUTE)[keyof typeof ICFR_ROUTE];

export const ICFR_CONDITION = {
  turnover: 'turnover',
  borrowings: 'borrowings',
  filing: 'filing',
} as const;
export type IcfrConditionKey = (typeof ICFR_CONDITION)[keyof typeof ICFR_CONDITION];

/** IFC-03 filing-condition status (spec §9) — unknown is never "no default". */
export const ICFR_FILING_STATUS = {
  noDefault: 'no_default',
  defaultIdentified: 'default_identified',
  pending: 'pending',
} as const;
export type IcfrFilingStatus = (typeof ICFR_FILING_STATUS)[keyof typeof ICFR_FILING_STATUS];

export const ICFR_FILING_STATUS_LABEL: Record<IcfrFilingStatus, string> = {
  no_default: 'No Default Identified',
  default_identified: 'Default Identified',
  pending: 'Information Pending',
};

/** Covered-borrowing source of one balance (spec §8) — inclusion is rule data. */
export const ICFR_BORROWING_SOURCE = {
  bank: 'bank',
  financialInstitution: 'financial_institution',
  bodyCorporate: 'body_corporate',
  other: 'other',
} as const;
export type IcfrBorrowingSource =
  (typeof ICFR_BORROWING_SOURCE)[keyof typeof ICFR_BORROWING_SOURCE];
export const ICFR_BORROWING_SOURCES: IcfrBorrowingSource[] = Object.values(ICFR_BORROWING_SOURCE);

export const ICFR_BORROWING_SOURCE_LABEL: Record<IcfrBorrowingSource, string> = {
  bank: 'Bank',
  financial_institution: 'Financial institution',
  body_corporate: 'Body corporate',
  other: 'Other',
};

/** How the borrowing figures were obtained — "any point" needs more than year end. */
export const ICFR_BORROWING_DATA_BASIS = {
  daily: 'daily',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearEndOnly: 'year_end_only',
} as const;
export type IcfrBorrowingDataBasis =
  (typeof ICFR_BORROWING_DATA_BASIS)[keyof typeof ICFR_BORROWING_DATA_BASIS];
export const ICFR_BORROWING_DATA_BASES: IcfrBorrowingDataBasis[] =
  Object.values(ICFR_BORROWING_DATA_BASIS);

/** Report-context status (spec §17). */
export const ICFR_CONTEXT_STATUS = {
  applicable: 'applicable',
  notApplicable: 'not_applicable',
  pending: 'pending',
} as const;
export type IcfrContextStatus = (typeof ICFR_CONTEXT_STATUS)[keyof typeof ICFR_CONTEXT_STATUS];

/**
 * Provision codes (spec §21) — resolved through the central Provision Library,
 * never a URL in a component. Track B seeds the ones not yet in the library.
 */
export const ICFR_PROVISION_CODE = {
  section143_3_i: 'COS_ACT_143_3_I',
  exemptionNotification: 'MCA_ICFR_PVT_EXEMPTION',
  section92: 'COS_ACT_92',
  section137: 'COS_ACT_137',
  guidanceNote: 'ICAI_GN_ICFR',
  implementationGuide: 'ICAI_IG_ICFR_SMALL',
  rule11g: 'AUDIT_RULE_11G',
} as const;

/** `authority_reference_link` anchors under context '02.5' (spec §21). */
export const ICFR_REFERENCE_CONTEXT = '02.5';
export const ICFR_REFERENCE_ANCHOR = {
  section143_3_i: 'section_143_3_i',
  mcaExemption: 'mca_exemption',
  section92: 'section_92',
  section137: 'section_137',
  guidanceNote: 'icai_gn_icfr',
  implementationGuide: 'icai_impl_guidance',
  rule11g: 'rule_11g',
} as const;

/** The persistent professional message when reporting is exempt (spec §12). */
export const ICFR_CONTROL_REMINDER =
  "Statutory ICFR reporting exemption does not remove the auditor's responsibility to understand and evaluate controls relevant to the financial statement audit under the applicable Standards on Auditing.";

/** One borrowing balance on the IFC-02 schedule (spec §8). */
export interface IcfrBorrowingPoint {
  /** ISO date of the balance. */
  asOn: string;
  lender: string;
  source: IcfrBorrowingSource;
  /** Outstanding (₹) on that date. */
  amount: number;
}

/** One §137 / §92 filing on the IFC-03 record (spec §9). */
export interface IcfrFilingRecord {
  form: 'AOC-4' | 'MGT-7' | string;
  section: '137' | '92';
  /** The financial year / period the filing relates to, e.g. "2023-24". */
  period: string | null;
  dueDate: string | null;
  /** ISO date filed; null = not filed. */
  filedOn: string | null;
  srn: string | null;
  source: 'compliance_calendar' | 'mca' | 'manual';
  note?: string | null;
}

/**
 * The normalised facts the 02.5 engine reads. Classification and the OPC /
 * Small Company results come from 02.1 (never recalculated); turnover from the
 * latest audited financial statements; borrowings and filings are captured on
 * the sub-assessment.
 */
export interface IcfrFacts {
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  /** OPC (02.1 classification). */
  isOpc: boolean | null;
  /** The approved 02.1 §2(85) small-company result (null = 02.1 not concluded). */
  isSmallCompany: boolean | null;
  smallCompanyBasis?: string | null;
  /** Turnover per the latest audited financial statements (IFC-01). */
  turnover: number | null;
  turnoverPeriod?: string | null;
  turnoverSource?: string | null;
  /** The source is audited (a provisional figure is never substituted, spec §7). */
  turnoverAudited?: boolean | null;
  /** IFC-02: balance schedule (preferred) or a documented peak. */
  borrowingSchedule?: IcfrBorrowingPoint[] | null;
  borrowingDataBasis?: IcfrBorrowingDataBasis | null;
  /** A documented maximum aggregate covered borrowings amount (no schedule). */
  peakCoveredBorrowings: number | null;
  peakDate?: string | null;
  /** IFC-03: per-filing records, or the team's documented answer. */
  filings?: IcfrFilingRecord[] | null;
  /** The team's documented answer when no filing record exists (null = unknown). */
  filingDefault: boolean | null;
  filingEvidence?: string | null;
  /** The date filings are tested against (defaults to today). */
  today?: string;
  /** 02.6 consolidated FS scope (null = 02.6 not concluded). */
  cfsInScope?: boolean | null;
  cfsBasis?: string | null;
}

/** The 02.5-specific facts captured on the sub-assessment. */
export interface IcfrCapturedFacts {
  /** IFC-02 documented maximum aggregate covered borrowings (no schedule). */
  peakCoveredBorrowings: number | null;
  peakDate?: string | null;
  borrowingSchedule?: IcfrBorrowingPoint[] | null;
  borrowingDataBasis?: IcfrBorrowingDataBasis | null;
  /** IFC-03 documented answer (null = unknown → Information Pending). */
  filingDefault: boolean | null;
  filings?: IcfrFilingRecord[] | null;
  filingEvidence?: string | null;
  /** IFC-01 team-entered audited turnover (overrides the 02.1 figure). */
  auditedTurnover?: number | null;
  auditedTurnoverPeriod?: string | null;
  auditedTurnoverSource?: string | null;
  /** IFC-04 override support (stored with the conclusion). */
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
}

/** The pass/fail of the monetary conditions (kept for downstream readers). */
export interface IcfrMonetaryTest {
  tested: boolean;
  turnoverWithinLimit: boolean | null;
  borrowingsWithinLimit: boolean | null;
}

/** One exemption route row (spec §6). */
export interface IcfrRouteTest {
  key: IcfrRouteKey;
  label: string;
  actual: string;
  result: IcfrRouteResult;
  basis: string;
  sourceSection: '02.1';
  ruleCode: string | null;
  ruleVersionId: string | null;
  provisionCodes: string[];
}

/** One condition row (turnover / borrowings / filing), spec §6–§9. */
export interface IcfrCondition {
  key: IcfrConditionKey;
  label: string;
  requirement: string;
  result: IcfrConditionResult;
  ruleCode: string | null;
  ruleVersionId: string | null;
  ruleVersion: number | null;
  ruleEffectiveFrom: string | null;
  operator: string | null;
  threshold: number | null;
  unit: string | null;
  measurementBasis: string | null;
  actual: number | null;
  actualDisplay: string;
  limitDisplay: string | null;
  calculation: string | null;
  pendingReason: string | null;
  guidanceReference: string | null;
  provisionCodes: string[];
}

/** IFC-01 turnover measure (spec §7). */
export interface IcfrTurnoverMeasure {
  amount: number | null;
  period: string | null;
  source: string | null;
  audited: boolean | null;
  basis: string;
}

/** IFC-02 borrowing measure (spec §8). */
export interface IcfrBorrowingMeasure {
  maximumAggregate: number | null;
  peakDate: string | null;
  bySource: Record<IcfrBorrowingSource, number | null>;
  coveredSources: IcfrBorrowingSource[];
  excludedSources: IcfrBorrowingSource[];
  dataBasis: IcfrBorrowingDataBasis | null;
  balanceDates: number;
  lenders: number;
  method: 'schedule' | 'documented' | 'none';
}

/** IFC-03 filing assessment (spec §9). */
export interface IcfrFilingAssessment {
  status: IcfrFilingStatus;
  required: boolean;
  records: Array<IcfrFilingRecord & { defaulted: boolean | null }>;
  basis: string;
}

export interface IcfrFactUsed {
  key: string;
  label: string;
  value: string;
  source: string;
  /** Where Open Source goes. */
  sourceSection: '02.1' | '02.5' | '02.6' | 'master';
}

export interface IcfrMissingFact {
  key: string;
  label: string;
  source: string;
}

/** The structured system conclusion (spec §10). */
export interface IcfrConclusionSummary {
  result: IcfrOutcome;
  entityRoute: IcfrEntityRoute;
  opc: IcfrRouteResult;
  smallCompany: IcfrRouteResult;
  turnover: string | null;
  turnoverLimit: string | null;
  peakBorrowings: string | null;
  borrowingLimit: string | null;
  filingCondition: IcfrConditionResult;
  /** e.g. "Turnover condition failed; exemption unavailable". */
  reason: string;
  /** e.g. "MCA private-company exemption (effective 2016-04-01)". */
  notificationVersion: string | null;
}

/** Statutory ICFR reporting per report context (spec §17). */
export interface IcfrReportContextResult {
  context: 'standalone' | 'consolidated';
  status: IcfrContextStatus;
  applies: boolean | null;
  basis: string;
}

/** Structured engine detail stored in `systemDetail`. */
export interface IcfrDetail {
  /** Whether §143(3)(i) ICFR reporting applies. */
  reportingApplies: boolean;
  /** Why ICFR reporting is exempt, or null when it applies. */
  exemptionReason: string | null;
  /** The monetary test result, or null when never reached. */
  monetaryTest: IcfrMonetaryTest | null;
  /** True when a §92/§137 filing default removed an otherwise-available exemption. */
  filingDefaultBlocks: boolean;
  /** When applicable, the ICFR workstream is configured in Section 05. */
  configuresIcfrWorkstream: boolean;
  /** ALWAYS true — an exemption never disables Section 05 normal control work. */
  controlsPhaseUnaffected: boolean;
  /** ALWAYS true — Rule 11(g) audit-trail reporting is a separate conclusion. */
  rule11gSeparate: boolean;
  entityRoute?: IcfrEntityRoute;
  notificationVersion?: { code: string; effectiveFrom: string } | null;
  routes?: IcfrRouteTest[];
  conditions?: IcfrCondition[];
  /** The monetary join in force ('and' per the current spec). */
  monetaryJoin?: 'and' | 'or' | null;
  turnover?: IcfrTurnoverMeasure | null;
  borrowing?: IcfrBorrowingMeasure | null;
  filing?: IcfrFilingAssessment | null;
  conclusion?: IcfrConclusionSummary;
  factsUsed?: IcfrFactUsed[];
  missingFacts?: IcfrMissingFact[];
  reportContexts?: IcfrReportContextResult[];
  provisionCodes?: string[];
}

/** The result of the pure 02.5 engine. */
export interface IcfrResult {
  outcome: IcfrOutcome;
  state: FrameworkState;
  basis: string;
  /** The threshold rule version frozen onto the conclusion, when one drove it. */
  ruleVersionId: string | null;
  /** The §143(3)(i) provision (period-correct), frozen by the service. */
  authorityProvisionId: string | null;
  detail: IcfrDetail;
}

export interface IcfrCompletionItem {
  key: string;
  label: string;
  /** null = not relevant for this engagement. */
  met: boolean | null;
  detail: string | null;
}

/** §23 completion — 02.5 COMPLETE. */
export interface IcfrCompletion {
  complete: boolean;
  status: 'not_started' | 'in_progress' | 'complete';
  items: IcfrCompletionItem[];
}

export interface IcfrPartnerApproval {
  /** A significant override / complex assessment needs the Engagement Partner (IFC-04). */
  required: boolean;
  reason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
}

/** A source fact that changed since the conclusion, with the rules it feeds. */
export interface IcfrReevaluationChange {
  key: string;
  label: string;
  before: string;
  after: string;
  affectedRules: string[];
}

/** Prior-year ICFR applicability — context only; current-year rules rerun (spec §19). */
export interface IcfrPriorYear {
  workflowInstanceId: string;
  financialYear: string;
  outcome: IcfrOutcome | null;
  isOverridden: boolean;
  exemptionBasis: string | null;
  decidedAt: string | null;
  changedFacts: Array<{ label: string; prior: string; current: string }>;
}

/** The 02.5 read shape for one statutory-audit workflow instance. */
export interface StatutoryAuditIcfr {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail. */
  detail: IcfrDetail | null;
  /** What the portal already holds for these facts, with the source. */
  masterFacts: MasterFact[];
  capturedFacts: IcfrCapturedFacts;
  /** The base facts assembled from 02.1 + 02.6 + masters + captured facts. */
  baseFacts: IcfrFacts;
  /** True once 02.1 is confirmed — 02.5 reads its approved classifications. */
  upstreamReady: boolean;
  auditFinancialYear?: string;
  professionalAction?: IcfrProfessionalAction | null;
  pendingReason?: string | null;
  partnerApproval?: IcfrPartnerApproval;
  completion?: IcfrCompletion;
  reevaluation?: { required: boolean; changes: IcfrReevaluationChange[] };
  priorYear?: IcfrPriorYear | null;
  approved?: boolean;
  viewerIsPartner?: boolean;
  /** A technical memo is suggested (override / complex / consulted, spec §20). */
  memoSuggested?: boolean;
}

/**
 * The 02.5 result downstream reads (Track B: Section 05 workstream, consolidated
 * consideration, Section 07 / 08). Read via `readIcfrResultOn` (icfr-read.ts).
 */
export interface IcfrApprovedResult {
  workflowInstanceId: string;
  /** Conclusion when decided, else the stored system suggestion. */
  outcome: IcfrOutcome | null;
  /** A professional conclusion is recorded. */
  decided: boolean;
  /** 02.5 COMPLETE (§23). */
  complete: boolean;
  reportingApplies: boolean | null;
  consolidated: { cfsInScope: boolean | null; status: IcfrContextStatus };
  financialYear: string | null;
  /** Audit period start (rule / provision resolution date). */
  periodStart: string;
}

/** One IFC-03 filing as entered (optional fields default to null). */
export type IcfrFilingRecordInput = Pick<IcfrFilingRecord, 'form' | 'section' | 'source'> &
  Partial<Pick<IcfrFilingRecord, 'period' | 'dueDate' | 'filedOn' | 'srn' | 'note'>>;

/** Capture the 02.5-specific facts (IFC-01 / IFC-02 / IFC-03). */
export interface SetIcfrFactsInput {
  peakCoveredBorrowings?: number | null;
  peakDate?: string | null;
  borrowingSchedule?: IcfrBorrowingPoint[] | null;
  borrowingDataBasis?: IcfrBorrowingDataBasis | null;
  filingDefault?: boolean | null;
  filings?: IcfrFilingRecordInput[] | null;
  filingEvidence?: string | null;
  auditedTurnover?: number | null;
  auditedTurnoverPeriod?: string | null;
  auditedTurnoverSource?: string | null;
  version: number;
}

/** IFC-04: Confirm / Override / Information Pending (spec §11). */
export interface RecordIcfrDecisionInput {
  action?: IcfrProfessionalAction;
  conclusion?: IcfrOutcome;
  /** The override reason. */
  basis?: string | null;
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
  pendingReason?: string | null;
  impact?: string | null;
  version: number;
}

/** IFC-04 Engagement Partner approval of a significant override / complex assessment. */
export interface PartnerApproveIcfrInput {
  note?: string | null;
  version: number;
}

/** Result of filling 02.5 facts from the client master and portal records. */
export interface StatutoryAuditIcfrMasterFillResult {
  icfr: StatutoryAuditIcfr;
  /** What was filled (empty when there was nothing new to add). */
  filled: string[];
}
