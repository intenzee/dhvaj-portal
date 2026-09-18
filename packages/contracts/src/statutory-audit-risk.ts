/**
 * Statutory Audit — Risk Assessment (Phase 04) vocabulary (Audit Spec §22, §30).
 *
 * The risk register records each identified risk with its source, the financial-
 * statement area and assertion it touches, its rating, whether it is a
 * significant / fraud risk, the planned response, owner, reviewer, status and
 * conclusion (§22). Risk ↔ procedure two-way navigation (§22) is completed in
 * SA-5 once procedures exist; the register here holds the response narrative and
 * is the anchor those links attach to.
 *
 * This module is the single source of truth for the risk register vocabulary,
 * shared by the seed-free service, the DTOs and the Risk screen.
 */

/** Where a risk was identified (§22 Source). */
export const RISK_SOURCE = {
  fraud: 'fraud',
  error: 'error',
  controlDeficiency: 'control_deficiency',
  analyticalReview: 'analytical_review',
  inquiry: 'inquiry',
  priorYear: 'prior_year',
  industry: 'industry',
  goingConcern: 'going_concern',
  relatedParty: 'related_party',
  estimate: 'estimate',
  regulatory: 'regulatory',
  other: 'other',
} as const;
export type RiskSource = (typeof RISK_SOURCE)[keyof typeof RISK_SOURCE];

/** The financial-statement assertion a risk bears on (§22 Assertion). */
export const RISK_ASSERTION = {
  existence: 'existence',
  occurrence: 'occurrence',
  completeness: 'completeness',
  accuracy: 'accuracy',
  valuation: 'valuation',
  rightsAndObligations: 'rights_and_obligations',
  cutoff: 'cutoff',
  classification: 'classification',
  presentationAndDisclosure: 'presentation_and_disclosure',
} as const;
export type RiskAssertion = (typeof RISK_ASSERTION)[keyof typeof RISK_ASSERTION];

/** Risk rating (§22 Risk Rating). `significant` is the highest, and mirrors the
 * Significant Risk? flag; a significant risk requires an explicit response (§29). */
export const RISK_RATING = {
  low: 'low',
  moderate: 'moderate',
  high: 'high',
  significant: 'significant',
} as const;
export type RiskRating = (typeof RISK_RATING)[keyof typeof RISK_RATING];

/** Lifecycle status of a risk's treatment (§22 Status). */
export const RISK_STATUS = {
  identified: 'identified',
  responsePlanned: 'response_planned',
  inProgress: 'in_progress',
  addressed: 'addressed',
  concluded: 'concluded',
} as const;
export type RiskStatus = (typeof RISK_STATUS)[keyof typeof RISK_STATUS];

/** One risk-register row (§22). */
export interface AuditRisk {
  id: string;
  /** Human-facing reference, e.g. "R1" (assigned in creation order). */
  riskRef: string;
  description: string;
  source: RiskSource;
  /** The financial-statement area, e.g. "Revenue", free text. */
  fsArea: string | null;
  assertion: RiskAssertion | null;
  rating: RiskRating;
  isSignificant: boolean;
  isFraudRisk: boolean;
  /** The planned audit response (the anchor for linked procedures in SA-5). */
  response: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  reviewerEmployeeId: string | null;
  reviewerName: string | null;
  status: RiskStatus;
  conclusion: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The whole Risk view for one statutory-audit workflow instance (§22). */
export interface StatutoryAuditRiskRegister {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  /** Whether Planning is approved — the gate that unlocks the risk register (§7). */
  planningApproved: boolean;
  risks: AuditRisk[];
  /** Significant risks that still lack a planned response — a blocking issue (§29). */
  significantRisksWithoutResponse: number;
}
