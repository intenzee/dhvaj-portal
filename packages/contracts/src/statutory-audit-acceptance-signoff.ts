import type { AcceptanceConclusion } from './statutory-audit-acceptance';

/**
 * Section 01.8 — Final Acceptance & Partner Approval (spec §12, §14).
 *
 * A readiness summary, never a repeat of the questionnaires: the Manager
 * records a recommendation (FINAL-01) and submits it to the Engagement Partner,
 * who concludes (FINAL-02). Approval locks Section 01 and unlocks Section 02;
 * any later material change needs a controlled Reopen with a reason.
 */

/** FINAL-01 — the Manager's recommendation. */
export const ACCEPTANCE_RECOMMENDATION = {
  accept: 'accept',
  continue: 'continue',
  acceptWithSafeguards: 'accept_with_safeguards',
  partnerReviewRequired: 'partner_review_required',
  decline: 'decline',
} as const;
export type AcceptanceRecommendation =
  (typeof ACCEPTANCE_RECOMMENDATION)[keyof typeof ACCEPTANCE_RECOMMENDATION];
export const ACCEPTANCE_RECOMMENDATIONS: AcceptanceRecommendation[] =
  Object.values(ACCEPTANCE_RECOMMENDATION);

export const ACCEPTANCE_RECOMMENDATION_LABEL: Record<AcceptanceRecommendation, string> = {
  accept: 'Accept Engagement',
  continue: 'Continue Engagement',
  accept_with_safeguards: 'Accept or Continue Subject to Safeguards',
  partner_review_required: 'Partner Review Required',
  decline: 'Decline Engagement',
};

/** Comments are optional when clear, mandatory otherwise (FINAL-01). */
export function recommendationNeedsComment(r: AcceptanceRecommendation): boolean {
  return r !== 'accept' && r !== 'continue';
}

export const ACCEPTANCE_CONCLUSION_LABEL: Record<AcceptanceConclusion, string> = {
  accept: 'Accept Engagement',
  continue: 'Continue Engagement',
  accept_with_conditions: 'Accept or Continue Subject to Safeguards',
  return: 'Return for Further Work',
  decline: 'Decline Engagement',
};

/** Conclusions that approve the engagement and complete Section 01. */
export const APPROVING_CONCLUSIONS: AcceptanceConclusion[] = [
  'accept',
  'continue',
  'accept_with_conditions',
];

export function isApprovingConclusion(c: AcceptanceConclusion): boolean {
  return APPROVING_CONCLUSIONS.includes(c);
}

/**
 * FINAL-02 rules: safeguards are mandatory for a conditional acceptance; a
 * reason is mandatory to return or decline. Returns why it is refused, or null.
 */
export function partnerConclusionError(input: {
  conclusion: AcceptanceConclusion;
  reason?: string | null;
  safeguards?: string | null;
}): string | null {
  const blank = (v?: string | null) => !v || v.trim() === '';
  if (input.conclusion === 'accept_with_conditions' && blank(input.safeguards)) {
    return 'Record the safeguards / conditions the acceptance is subject to.';
  }
  if ((input.conclusion === 'return' || input.conclusion === 'decline') && blank(input.reason)) {
    return input.conclusion === 'return'
      ? 'Give the reason for returning the file for further work.'
      : 'Give the reason for declining the engagement.';
  }
  return null;
}

/** The Section 01 header status (spec §3). */
export const SECTION01_STATUS = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  readyForReview: 'ready_for_review',
  complete: 'complete',
  attentionRequired: 'attention_required',
} as const;
export type Section01Status = (typeof SECTION01_STATUS)[keyof typeof SECTION01_STATUS];
export const SECTION01_STATUS_LABEL: Record<Section01Status, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  ready_for_review: 'Ready for Review',
  complete: 'Complete',
  attention_required: 'Attention Required',
};

/** 01.8's own status (spec §3): derived, never stored by the segments. */
export const FINAL_SEGMENT_STATE = {
  locked: 'locked',
  readyForApproval: 'ready_for_approval',
  complete: 'complete',
} as const;
export type FinalSegmentState = (typeof FINAL_SEGMENT_STATE)[keyof typeof FINAL_SEGMENT_STATE];
export const FINAL_SEGMENT_STATE_LABEL: Record<FinalSegmentState, string> = {
  locked: 'Locked',
  ready_for_approval: 'Ready for Approval',
  complete: 'Complete',
};

/** The landing-screen header (spec §3). */
export interface Section01Header {
  status: Section01Status;
  /** Applicable segments (01.1–01.7, excluding Not Applicable) and how many are complete. */
  completedSegments: number;
  applicableSegments: number;
  preparedByName: string | null;
  engagementPartnerName: string | null;
  openMatterCount: number;
  openBlockingMatterCount: number;
}

/** One row of the readiness summary (spec §12). */
export interface AcceptanceReadinessItem {
  key: string;
  label: string;
  /** Display status, e.g. "Complete", "In Progress", "Not Applicable", "Issued". */
  statusLabel: string;
  ok: boolean;
  /** Anchor the item navigates to (the source segment / card / matter). */
  anchor: string;
}

/** An open matter as the readiness summary lists it, linking to its source. */
export interface AcceptanceOpenMatterLink {
  id: string;
  code: string;
  title: string;
  severity: string | null;
  isBlocking: boolean;
  anchor: string;
}

export interface AcceptanceRecommendationRecord {
  id: string;
  cycle: number;
  recommendation: AcceptanceRecommendation;
  comments: string | null;
  status: 'submitted' | 'decided' | 'returned' | 'superseded';
  submittedByName: string | null;
  submittedAt: string;
}

/** One Engagement Partner decision, live or history. */
export interface AcceptanceDecisionRecord {
  id: string;
  version: number;
  conclusion: AcceptanceConclusion;
  reason: string | null;
  safeguards: string | null;
  memo: string | null;
  decidedByName: string | null;
  decidedAt: string;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
}

/** GET …/acceptance/signoff */
export interface AcceptanceSignoffView {
  workflowInstanceId: string;
  header: Section01Header;
  finalSegmentState: FinalSegmentState;
  readiness: AcceptanceReadinessItem[];
  openMatters: AcceptanceOpenMatterLink[];
  /** Why the engagement cannot yet be accepted (null when nothing blocks). */
  blockers: string[];
  /** The live (or most recent) Manager recommendation. */
  recommendation: AcceptanceRecommendationRecord | null;
  /** Every partner decision, newest first. */
  decisions: AcceptanceDecisionRecord[];
  callerIsEngagementPartner: boolean;
  /** The Manager may submit (nothing approved, no live submission). */
  canSubmit: boolean;
  /** The Engagement Partner may conclude (a submission is waiting). */
  canDecide: boolean;
  /** Section 01 is approved and may be reopened by the Engagement Partner. */
  canReopen: boolean;
  /** A draft memo from the file, recorded unless the partner writes one. */
  draftMemo: string;
}

export interface SubmitAcceptanceRecommendationInput {
  recommendation: AcceptanceRecommendation;
  comments?: string | null;
}

export interface DecideAcceptanceInput {
  conclusion: AcceptanceConclusion;
  reason?: string | null;
  safeguards?: string | null;
  memo?: string | null;
}

export interface ReopenAcceptanceInput {
  reason: string;
}
