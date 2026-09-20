/**
 * 02.2 — Applicable Financial Reporting Framework (Implementation Guide §9.2).
 *
 * Decides Ind AS / Accounting Standards / a specialised framework, with legal
 * basis, by running the Rule-4 roadmap engine (02.2D) over the confirmed 02.1
 * facts — never re-asking a fact 02.1 already holds. Where the engine concludes
 * Accounting Standards it also computes the SMC sub-status; where it concludes
 * Ind AS for the first time it flags Ind AS 101 downstream (no transition testing
 * here). NO statutory number lives in code (guide §1): the ₹500cr/₹250cr roadmap
 * thresholds and the SMC ceilings resolve from the Audit Rules Library by the
 * engagement's audit period, so a future change affects future periods only.
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

/** The applicable reporting framework the engine concludes. */
export const REPORTING_FRAMEWORK_OUTCOME = {
  indAs: 'ind_as',
  accountingStandards: 'accounting_standards',
  /** Bank/insurance/regulated — a specialised statutory framework applies. */
  specialised: 'specialised_framework',
  /** A deciding fact / rule is absent — never a guess (guide §4.3). */
  informationInsufficient: 'information_insufficient',
  /** The system cannot safely decide; a professional must. */
  professionalReview: 'professional_review_required',
} as const;
export type ReportingFrameworkOutcome =
  (typeof REPORTING_FRAMEWORK_OUTCOME)[keyof typeof REPORTING_FRAMEWORK_OUTCOME];
export const REPORTING_FRAMEWORK_OUTCOMES: ReportingFrameworkOutcome[] =
  Object.values(REPORTING_FRAMEWORK_OUTCOME);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const REPORTING_FRAMEWORK_CONCLUSIONS: ReportingFrameworkOutcome[] = [
  REPORTING_FRAMEWORK_OUTCOME.indAs,
  REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
  REPORTING_FRAMEWORK_OUTCOME.specialised,
];

/** The SMC (Small & Medium Company) sub-status when Accounting Standards apply. */
export const SMC_STATUS = {
  smc: 'smc',
  nonSmc: 'non_smc',
  notApplicable: 'not_applicable',
} as const;
export type SmcStatus = (typeof SMC_STATUS)[keyof typeof SMC_STATUS];

/**
 * The normalised facts the 02.2 engine reads. The masters/02.1-derived facts are
 * assembled server-side; the 02.2-specific facts (prior/voluntary Ind AS, SME
 * exchange, group trigger) are captured once on the sub-assessment.
 */
export interface FinancialReportingFacts {
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  isListed: boolean;
  /** Listed only on an SME exchange — the roadmap listing trigger does not apply. */
  isListedOnSmeExchange: boolean;
  isNbfc: boolean;
  isBankOrInsurance: boolean;
  /** Already applying Ind AS in a prior year — continuing status wins (irrevocable). */
  priorIndAs: boolean;
  /** Voluntarily adopted Ind AS. */
  voluntaryIndAs: boolean;
  /** A group relationship pulls the entity into Ind AS (holding/subsidiary applies it). */
  groupTriggersIndAs: boolean;
  netWorth: number | null;
  turnover: number | null;
  borrowings: number | null;
}

/** The 02.2-specific facts captured on the sub-assessment (not held by 02.1). */
export interface FinancialReportingCapturedFacts {
  isListedOnSmeExchange: boolean;
  priorIndAs: boolean;
  voluntaryIndAs: boolean;
  groupTriggersIndAs: boolean;
}

/** Structured engine extras stored in `systemDetail`. */
export interface FinancialReportingDetail {
  smcStatus: SmcStatus;
  /** True when Ind AS is concluded for the first time → flag Ind AS 101 downstream. */
  firstTimeIndAs: boolean;
  /** The net-worth roadmap threshold that decided Ind AS applicability (rupees). */
  indAsThreshold: number | null;
  isNbfc: boolean;
}

/** The result of the pure 02.2 engine (guide §7 signature). */
export interface FinancialReportingResult {
  outcome: ReportingFrameworkOutcome;
  state: FrameworkState;
  basis: string;
  ruleVersionId: string | null;
  authorityProvisionId: string | null;
  detail: FinancialReportingDetail;
}

/**
 * The 02.2 read shape for one statutory-audit workflow instance: the shared
 * sub-assessment plus the typed 02.2 detail, the captured facts and the base
 * facts the engine used (for display + traceability).
 */
export interface StatutoryAuditFinancialReporting {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail (SMC / first-time / threshold). */
  detail: FinancialReportingDetail | null;
  capturedFacts: FinancialReportingCapturedFacts;
  /** The base facts assembled from confirmed 02.1 + masters (read-only display). */
  baseFacts: FinancialReportingFacts;
  /** True once 02.1 is confirmed — 02.2 reads its frozen fact set. */
  profileConfirmed: boolean;
}

/** Capture the 02.2-specific facts (guide §9.2 — captured once here). */
export interface SetFinancialReportingFactsInput {
  isListedOnSmeExchange?: boolean;
  priorIndAs?: boolean;
  voluntaryIndAs?: boolean;
  groupTriggersIndAs?: boolean;
  version: number;
}

/** Record the professional conclusion for 02.2 (override needs a basis, §19). */
export interface RecordFinancialReportingDecisionInput {
  conclusion: ReportingFrameworkOutcome;
  basis?: string | null;
  impact?: string | null;
  version: number;
}
