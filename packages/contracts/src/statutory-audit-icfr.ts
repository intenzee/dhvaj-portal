/**
 * 02.5 — Internal Financial Controls / ICFR Reporting (Implementation Guide §9.5).
 *
 * Decides whether the auditor must report on the adequacy and operating
 * effectiveness of Internal Financial Controls over Financial Reporting under
 * Section 143(3)(i): Applicable / Exempt / Further Assessment.
 *
 * Decision flow: a non-private company always reports (applicable). A private
 * company is exempt only under the MCA exemption — it is an OPC or a small
 * company (consumed from 02.1), OR both its turnover is below ₹50cr AND its peak
 * aggregate covered borrowings (banks + FIs + ANY body corporate, at any point in
 * the year) are below ₹25cr — AND it has not defaulted in filing its financial
 * statements (§137) or annual return (§92). A filing default blocks the exemption
 * even when the monetary conditions pass.
 *
 * Critical separations (guide §9.5): an ICFR *reporting* exemption does NOT
 * disable the Controls phase — ordinary SA control work continues. Rule 11(g)
 * audit-trail reporting is a SEPARATE conclusion (§9.7). An integrated audit uses
 * ONE control record for both FS and ICFR purposes — no duplicate tests.
 *
 * NO statutory number lives in code (guide §1): the ₹50cr / ₹25cr limits (strict
 * `<`) resolve from the Audit Rules Library by the engagement's audit period.
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

/** The Section 143(3)(i) ICFR-reporting outcome the engine concludes (§9.5). */
export const ICFR_OUTCOME = {
  /** The auditor must report on ICFR under §143(3)(i). */
  applicable: 'applicable',
  /** Exempt from ICFR reporting (private-company MCA exemption). */
  exempt: 'exempt',
  /** The system cannot decide (e.g. period predates the exemption framework) — a professional must. */
  furtherAssessment: 'further_assessment',
  /** A deciding fact is absent — never a guess (guide §4.3). */
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

/**
 * The normalised facts the 02.5 engine reads. Classification + OPC/small come
 * from the confirmed 02.1 profile + masters; the peak covered borrowings and the
 * filing-default status are captured on the sub-assessment (different bases /
 * not held by 02.1). Turnover is reused from 02.1.
 */
export interface IcfrFacts {
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  /** OPC (02.1) — a direct private-company ICFR exemption. */
  isOpc: boolean;
  /** Small company per the confirmed 02.1 §2(85) assessment — a direct exemption. */
  isSmallCompany: boolean;
  /** Turnover (02.1) — tested strictly below the ₹50cr exemption limit. */
  turnover: number | null;
  /** Peak aggregate covered borrowings — banks + FIs + ANY body corporate, at any point in the year. */
  peakCoveredBorrowings: number | null;
  /** Default in filing FS (§137) or annual return (§92) — blocks the exemption. */
  filingDefault: boolean;
}

/** The 02.5-specific facts captured on the sub-assessment (not held by 02.1). */
export interface IcfrCapturedFacts {
  peakCoveredBorrowings: number | null;
  filingDefault: boolean;
}

/** The pass/fail of the two cumulative monetary conditions (both required). */
export interface IcfrMonetaryTest {
  tested: boolean;
  turnoverWithinLimit: boolean | null;
  borrowingsWithinLimit: boolean | null;
}

/** Structured engine extras stored in `systemDetail`. */
export interface IcfrDetail {
  /** Whether §143(3)(i) ICFR reporting applies. */
  reportingApplies: boolean;
  /** Why ICFR reporting is exempt, or null when it applies. */
  exemptionReason: string | null;
  /** The cumulative monetary test result, or null when never reached. */
  monetaryTest: IcfrMonetaryTest | null;
  /** True when a §92/§137 filing default removed an otherwise-available exemption. */
  filingDefaultBlocks: boolean;
  /** When applicable, the ICFR workstream is configured in the Controls phase. */
  configuresIcfrWorkstream: boolean;
  /** ALWAYS true — an ICFR reporting exemption never disables the Controls phase (guide §9.5). */
  controlsPhaseUnaffected: boolean;
  /** ALWAYS true — Rule 11(g) audit-trail reporting is a separate conclusion (§9.7). */
  rule11gSeparate: boolean;
}

/** The result of the pure 02.5 engine (guide §7 signature). */
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

/** The 02.5 read shape for one statutory-audit workflow instance. */
export interface StatutoryAuditIcfr {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail (reporting / exemption / monetary test). */
  detail: IcfrDetail | null;
  capturedFacts: IcfrCapturedFacts;
  /** The base facts assembled from confirmed 02.1 + masters + captured facts. */
  baseFacts: IcfrFacts;
  /** True once 02.1 is confirmed — 02.5 reads its frozen classifications. */
  upstreamReady: boolean;
}

/** Capture the two 02.5-specific facts (guide §9.5). */
export interface SetIcfrFactsInput {
  peakCoveredBorrowings?: number | null;
  filingDefault?: boolean;
  version: number;
}

/** Record the professional ICFR conclusion for 02.5 (override needs a basis, §19). */
export interface RecordIcfrDecisionInput {
  conclusion: IcfrOutcome;
  basis?: string | null;
  impact?: string | null;
  version: number;
}
