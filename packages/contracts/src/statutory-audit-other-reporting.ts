/**
 * 02.7 — Other Companies Act & Statutory Reporting (Implementation Guide §9.7).
 *
 * Configures the statutory reporting MATRIX — it is not a second audit. It
 * decides, each from library-resolved rules by audit period:
 *   • Rule 11(g) audit trail — applies for FYs commencing on/after 1 Apr 2023,
 *     assessed PER software system (not one Yes/No), with the Sec 128(5)
 *     preservation period as rule data.
 *   • Section 197(16) managerial remuneration — public company only, compared
 *     against the ceiling on Section 198 net profit; no/inadequate profit routes
 *     to the (versioned) Schedule V band table, not the ratio alone.
 *   • Section 143(12) fraud — one central determination: the ₹1cr threshold routes
 *     Central-Government vs Audit-Committee/Board, and a deadline engine computes
 *     the Rule 13 dates from the legally relevant event date.
 *   • Rule 11(e)/(f) intermediary / ultimate-beneficiary representations, and the
 *     dividend (Sec 123) and Rule 11(a)-(c) items.
 *
 * NO statutory number/date lives in code (guide §1): the 11% ceiling, the ₹1cr
 * threshold, the 45/15-day offsets and the 8-year retention resolve from the
 * Audit Rules Library, and Rule 11(g)'s effective date is the provision's.
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

/** The top-level 02.7 outcome (the matrix is always computed; a breach raises attention). */
export const OTHER_REPORTING_OUTCOME = {
  /** The reporting matrix is configured with no outstanding attention item. */
  configured: 'configured',
  /** A reporting item raised a matter (fraud, a remuneration breach, missing representation). */
  attentionRequired: 'attention_required',
  /** A deciding fact is absent — never a guess (guide §4.3). */
  informationInsufficient: 'information_insufficient',
} as const;
export type OtherReportingOutcome =
  (typeof OTHER_REPORTING_OUTCOME)[keyof typeof OTHER_REPORTING_OUTCOME];
export const OTHER_REPORTING_OUTCOMES: OtherReportingOutcome[] =
  Object.values(OTHER_REPORTING_OUTCOME);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const OTHER_REPORTING_CONCLUSIONS: OtherReportingOutcome[] = [
  OTHER_REPORTING_OUTCOME.configured,
  OTHER_REPORTING_OUTCOME.attentionRequired,
];

/** The §197(16) managerial-remuneration reporting outcome. */
export const REMUNERATION_OUTCOME = {
  notApplicable: 'not_applicable',
  withinLimit: 'within_limit',
  exceedsLimit: 'exceeds_limit',
  scheduleVRoute: 'schedule_v_route',
  informationInsufficient: 'information_insufficient',
} as const;
export type RemunerationOutcome = (typeof REMUNERATION_OUTCOME)[keyof typeof REMUNERATION_OUTCOME];

/** The §143(12) fraud reporting route. */
export const FRAUD_ROUTE = {
  centralGovernment: 'central_government',
  auditCommitteeBoard: 'audit_committee_board',
  none: 'none',
} as const;
export type FraudRoute = (typeof FRAUD_ROUTE)[keyof typeof FRAUD_ROUTE];

/** One software/module assessed for the Rule 11(g) audit trail. */
export interface SoftwareSystemInput {
  name: string;
  /** The accounting software has an audit-trail (edit-log) feature. */
  hasAuditTrailFeature: boolean;
  /** The audit trail operated throughout the year and was not tampered with. */
  auditTrailOperatedAllYear: boolean;
}

/** The 02.7-specific facts captured on the sub-assessment. */
export interface OtherReportingCapturedFacts {
  softwareSystems: SoftwareSystemInput[];
  // §197(16)
  managerialRemunerationPaid: number | null;
  section198NetProfit: number | null;
  hasManagingOrWholeTimeDirector: boolean;
  // §143(12)
  fraudIdentified: boolean;
  fraudAmount: number | null;
  /** The legally relevant event date (ISO yyyy-mm-dd) the Rule 13 deadlines run from. */
  fraudEventDate: string | null;
  // Rule 11(e)/(f)
  intermediaryFundsAdvanced: boolean;
  ultimateBeneficiaryFundsReceived: boolean;
  fundingRepresentationsObtained: boolean;
  // dividend + 11(a)-(c)
  dividendCompliesSec123: boolean | null;
  pendingLitigationDisclosed: boolean | null;
  foreseeableLossesProvided: boolean | null;
  iepfTransferDelay: boolean | null;
}

/** Base facts assembled server-side (not captured on 02.7). */
export interface OtherReportingBaseFacts extends OtherReportingCapturedFacts {
  isPublicCompany: boolean | null;
  /** Rule 11(g) is in force for the engagement's audit period (provision effective date). */
  auditTrailInForce: boolean;
}

/** A matter the matrix raises (surfaced in detail; the Matters engine owns persistence). */
export interface ReportingMatter {
  code: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

/** Rule 11(g) per-system audit-trail result. */
export interface Rule11gResult {
  applicable: boolean;
  systems: Array<{ name: string; adequate: boolean; basis: string }>;
  retentionYears: number | null;
  allAdequate: boolean;
  basis: string;
}

/** §197(16) managerial-remuneration result. */
export interface RemunerationResult {
  applicable: boolean;
  outcome: RemunerationOutcome;
  limitPercent: number | null;
  section198NetProfit: number | null;
  permittedAmount: number | null;
  paidAmount: number | null;
  scheduleVRoute: boolean;
  basis: string;
}

/** §143(12) fraud result with the Rule 13 deadline dates. */
export interface FraudResult {
  identified: boolean;
  route: FraudRoute;
  thresholdAmount: number | null;
  amount: number | null;
  boardReplyByDate: string | null;
  cgForwardByDate: string | null;
  formReference: string | null;
  basis: string;
}

/** Rule 11(e)/(f) intermediary / ultimate-beneficiary result. */
export interface Rule11efResult {
  intermediaryFundsAdvanced: boolean;
  ultimateBeneficiaryFundsReceived: boolean;
  representationsObtained: boolean;
  satisfied: boolean;
  basis: string;
}

/** Structured engine extras stored in `systemDetail` — the reporting matrix. */
export interface OtherReportingDetail {
  rule11g: Rule11gResult;
  remuneration: RemunerationResult;
  fraud: FraudResult;
  rule11ef: Rule11efResult;
  dividendCompliesSec123: boolean | null;
  pendingLitigationDisclosed: boolean | null;
  foreseeableLossesProvided: boolean | null;
  iepfTransferDelay: boolean | null;
  matters: ReportingMatter[];
}

/** The result of the pure 02.7 engine (guide §7 signature). */
export interface OtherReportingResult {
  outcome: OtherReportingOutcome;
  state: FrameworkState;
  basis: string;
  ruleVersionId: string | null;
  authorityProvisionId: string | null;
  detail: OtherReportingDetail;
}

/** The 02.7 read shape for one statutory-audit workflow instance. */
export interface StatutoryAuditOtherReporting {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  detail: OtherReportingDetail | null;
  capturedFacts: OtherReportingCapturedFacts;
  baseFacts: OtherReportingBaseFacts;
  upstreamReady: boolean;
}

/** Capture the 02.7-specific facts (guide §9.7). */
export interface SetOtherReportingFactsInput {
  softwareSystems?: SoftwareSystemInput[];
  managerialRemunerationPaid?: number | null;
  section198NetProfit?: number | null;
  hasManagingOrWholeTimeDirector?: boolean;
  fraudIdentified?: boolean;
  fraudAmount?: number | null;
  fraudEventDate?: string | null;
  intermediaryFundsAdvanced?: boolean;
  ultimateBeneficiaryFundsReceived?: boolean;
  fundingRepresentationsObtained?: boolean;
  dividendCompliesSec123?: boolean | null;
  pendingLitigationDisclosed?: boolean | null;
  foreseeableLossesProvided?: boolean | null;
  iepfTransferDelay?: boolean | null;
  version: number;
}

/** Record the professional conclusion for 02.7 (override needs a basis, §19). */
export interface RecordOtherReportingDecisionInput {
  conclusion: OtherReportingOutcome;
  basis?: string | null;
  impact?: string | null;
  version: number;
}
