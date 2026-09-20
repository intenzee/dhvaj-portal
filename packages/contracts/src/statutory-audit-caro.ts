/**
 * 02.4 — CARO 2020 Applicability (Implementation Guide §9.4).
 *
 * Decides whether the Companies (Auditor's Report) Order 2020 applies to the
 * audit report (Level 1), by taking the **direct exemptions first** (banking,
 * insurance, Section 8, OPC, small company — consuming the 02.1 classifications,
 * never recomputing them), then the **cumulative private-company test**: a
 * private company is exempt only when it is NOT a holding/subsidiary of a public
 * company AND its paid-up capital + reserves, its aggregate bank/FI borrowings
 * (peak at any point in the year, not year-end), and its total revenue are each
 * within the CARO limits. Any one condition failing → CARO may apply.
 *
 * Two-level model: Level 1 (this assessment) decides whether CARO applies to the
 * report; Level 2 (the clause work programme) decides each clause's relevance to
 * the facts. A clause being "Not Applicable to Facts" NEVER changes Level 1.
 *
 * NO statutory number lives in code (guide §1): CARO 2020 is effective FY 2021-22
 * onward and its ₹1cr / ₹1cr / ₹10cr limits resolve from the Audit Rules Library
 * by the engagement's audit period, so a future change affects future periods
 * only and a pre-2021 period gets no CARO 2020 rule.
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

/** The CARO 2020 Level-1 applicability outcome the engine concludes (§9.4). */
export const CARO_OUTCOME = {
  /** CARO 2020 applies to the audit report. */
  applicable: 'applicable',
  /** Directly exempt, or exempt via the private-company cumulative test. */
  notApplicableExempt: 'not_applicable_exempt',
  /** The system cannot decide (e.g. period predates CARO 2020) — a professional must. */
  furtherAssessment: 'further_assessment',
  /** A deciding fact is absent — never a guess (guide §4.3). */
  informationInsufficient: 'information_insufficient',
} as const;
export type CaroOutcome = (typeof CARO_OUTCOME)[keyof typeof CARO_OUTCOME];
export const CARO_OUTCOMES: CaroOutcome[] = Object.values(CARO_OUTCOME);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const CARO_CONCLUSIONS: CaroOutcome[] = [
  CARO_OUTCOME.applicable,
  CARO_OUTCOME.notApplicableExempt,
  CARO_OUTCOME.furtherAssessment,
];

/**
 * The normalised facts the 02.4 engine reads. The direct-exemption and
 * classification facts are assembled from the confirmed 02.1 profile + masters;
 * the four CARO-measurement facts (different bases from 02.1) are captured on the
 * sub-assessment.
 */
export interface CaroFacts {
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  /** Banking company (02.1) — a direct CARO exemption, no threshold test. */
  isBanking: boolean;
  /** Insurance company (02.1) — a direct CARO exemption. */
  isInsurance: boolean;
  /** Section 8 (not-for-profit) company (02.1) — a direct CARO exemption. */
  isSection8: boolean;
  /** One Person Company (02.1) — a direct CARO exemption. */
  isOpc: boolean;
  /** Small company per the confirmed 02.1 §2(85) assessment — a direct CARO exemption. */
  isSmallCompany: boolean;
  /** A private company that is a holding/subsidiary of a public company — exemption unavailable. */
  isHoldingOrSubsidiaryOfPublic: boolean;
  /** Paid-up capital + reserves at the balance-sheet date (CARO private-company test). */
  capitalPlusReserves: number | null;
  /** Aggregate bank/FI borrowings — peak at ANY point in the year, not year-end. */
  peakBankFiBorrowings: number | null;
  /** Total revenue on the CARO measurement basis. */
  totalRevenue: number | null;
}

/** The 02.4-specific facts captured on the sub-assessment (not held by 02.1). */
export interface CaroCapturedFacts {
  isHoldingOrSubsidiaryOfPublic: boolean;
  capitalPlusReserves: number | null;
  peakBankFiBorrowings: number | null;
  totalRevenue: number | null;
}

/** The pass/fail of each cumulative private-company condition (traceability). */
export interface CaroPrivateTest {
  /** Whether the private-company cumulative test was reached and run. */
  tested: boolean;
  /** Not a holding/subsidiary of a public company. */
  noPublicGroupRelationship: boolean | null;
  capitalWithinLimit: boolean | null;
  borrowingsWithinLimit: boolean | null;
  revenueWithinLimit: boolean | null;
}

/** Structured engine extras stored in `systemDetail`. */
export interface CaroDetail {
  /** Level 1: whether CARO applies to the audit report. */
  level1Applies: boolean;
  /** Why the report is exempt (direct or cumulative), or null when CARO applies. */
  exemptionReason: string | null;
  /** The cumulative private-company test result, or null when never reached. */
  privateTest: CaroPrivateTest | null;
  /** When applicable, the standalone paragraph-3 clause programme is instantiated (Level 2). */
  instantiatesClauseProgramme: boolean;
  /** Scope of the CARO work when applicable (standalone paragraph 3; CFS → clause 3(xxi) is 02.6). */
  caroScope: 'standalone_paragraph_3' | null;
}

/** The result of the pure 02.4 engine (guide §7 signature). */
export interface CaroResult {
  outcome: CaroOutcome;
  state: FrameworkState;
  basis: string;
  /** The threshold rule version frozen onto the conclusion, when one drove it. */
  ruleVersionId: string | null;
  /** The CARO 2020 provision (period-correct), frozen by the service. */
  authorityProvisionId: string | null;
  detail: CaroDetail;
}

/** The 02.4 read shape for one statutory-audit workflow instance. */
export interface StatutoryAuditCaro {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail (Level 1 / exemption / private test). */
  detail: CaroDetail | null;
  capturedFacts: CaroCapturedFacts;
  /** The base facts assembled from confirmed 02.1 + masters + captured facts. */
  baseFacts: CaroFacts;
  /** True once 02.1 is confirmed — 02.4 reads its frozen classifications. */
  upstreamReady: boolean;
}

/** Capture the four 02.4-specific CARO-measurement facts (guide §9.4). */
export interface SetCaroFactsInput {
  isHoldingOrSubsidiaryOfPublic?: boolean;
  capitalPlusReserves?: number | null;
  peakBankFiBorrowings?: number | null;
  totalRevenue?: number | null;
  version: number;
}

/** Record the professional CARO conclusion for 02.4 (override needs a basis, §19). */
export interface RecordCaroDecisionInput {
  conclusion: CaroOutcome;
  basis?: string | null;
  impact?: string | null;
  version: number;
}
