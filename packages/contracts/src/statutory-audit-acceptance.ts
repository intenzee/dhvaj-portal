import type { AcceptancePack } from './statutory-audit-section-pack';
import type { MasterFact } from './statutory-audit';
import type { AcceptanceContext } from './statutory-audit-acceptance-context';
import type { AttentionItem } from './statutory-audit-acceptance-engine';

/**
 * Section 01 — Engagement & Acceptance (Implementation Guide §8).
 *
 * The 8-segment acceptance workflow that decides whether DHVAJ can accept /
 * continue the audit, ending in an Engagement Partner approval (FINAL-02) that
 * unlocks Section 02 (Framework). Compact dashboards, Yes/No/NA controls,
 * narrative only on exception. Facts are prefilled from the masters (read-only);
 * adverse answers generate Acceptance Matters through the ONE Matters engine
 * (§10 — section = 'acceptance'), never a separate register.
 */

/** The 8 acceptance segments (guide §8.3). */
export const ACCEPTANCE_SEGMENT_KEY = {
  engagementProfile: 'engagement_profile', // 01.1 read-only master confirm
  appointmentEligibility: 'appointment_eligibility', // 01.2
  previousAuditor: 'previous_auditor', // 01.3 conditional (continuing ⇒ NA)
  acceptanceContinuance: 'acceptance_continuance', // 01.4
  independenceEthics: 'independence_ethics', // 01.5
  auditPreconditions: 'audit_preconditions', // 01.6
  engagementLetter: 'engagement_letter', // 01.7
  finalAcceptance: 'final_acceptance', // 01.8 readiness + partner approval
} as const;
export type AcceptanceSegmentKey =
  (typeof ACCEPTANCE_SEGMENT_KEY)[keyof typeof ACCEPTANCE_SEGMENT_KEY];

/**
 * Status of a segment (spec §3). 01.1–01.7 are derived from their answers by
 * the question engine; 01.8 moves Locked → Ready for Approval → Complete.
 */
export const SEGMENT_STATE = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  attentionRequired: 'attention_required',
  complete: 'complete',
  notApplicable: 'not_applicable',
  locked: 'locked',
  readyForApproval: 'ready_for_approval',
} as const;
export type SegmentState = (typeof SEGMENT_STATE)[keyof typeof SEGMENT_STATE];
export const SEGMENT_STATES: SegmentState[] = Object.values(SEGMENT_STATE);
/** States that count a segment as resolved for approval. */
export const SEGMENT_RESOLVED_STATES: SegmentState[] = [
  SEGMENT_STATE.complete,
  SEGMENT_STATE.notApplicable,
];
export const SEGMENT_STATE_LABEL: Record<SegmentState, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  attention_required: 'Attention Required',
  complete: 'Complete',
  not_applicable: 'Not Applicable',
  locked: 'Locked',
  ready_for_approval: 'Ready for Approval',
};

/**
 * An answer: the chosen option's value (`yes`, `no`, `pending`, `agm` …) or,
 * for a date question, an ISO date. Detail fields travel in `details`.
 */
export type AcceptanceAnswer = string;

/**
 * The Engagement Partner's conclusion (FINAL-02, spec §12.2). Accept / Continue
 * / Accept-or-Continue-subject-to-safeguards complete Section 01; Return sends
 * the file back to the preparer; Decline leaves Section 02 locked.
 */
export const ACCEPTANCE_CONCLUSION = {
  accept: 'accept',
  continue: 'continue',
  acceptWithConditions: 'accept_with_conditions',
  return: 'return',
  decline: 'decline',
} as const;
export type AcceptanceConclusion =
  (typeof ACCEPTANCE_CONCLUSION)[keyof typeof ACCEPTANCE_CONCLUSION];
export const ACCEPTANCE_CONCLUSIONS: AcceptanceConclusion[] = Object.values(ACCEPTANCE_CONCLUSION);

export interface AcceptanceSegmentDefinition {
  segmentKey: AcceptanceSegmentKey;
  title: string;
  sortOrder: number;
  /** Read-only segments (01.1) confirm master facts; they carry a confirm question only. */
  readOnly?: boolean;
}

/** The canonical 8 segments, seeded per shell (guide §8.3). */
export const ACCEPTANCE_SEGMENTS: readonly AcceptanceSegmentDefinition[] = [
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.engagementProfile, title: 'Engagement Profile', sortOrder: 1, readOnly: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.appointmentEligibility, title: 'Appointment & Eligibility', sortOrder: 2 },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.previousAuditor, title: 'Previous Auditor Communication', sortOrder: 3 },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.acceptanceContinuance, title: 'Acceptance / Continuance', sortOrder: 4 },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.independenceEthics, title: 'Independence & Ethics', sortOrder: 5 },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.auditPreconditions, title: 'Audit Preconditions', sortOrder: 6 },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.engagementLetter, title: 'Engagement Letter & Required Documents', sortOrder: 7 },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.finalAcceptance, title: 'Final Acceptance & Partner Approval', sortOrder: 8 },
] as const;

export interface AcceptanceAnswerRecord {
  id: string;
  segmentId: string;
  questionKey: string;
  answer: AcceptanceAnswer | null;
  /** Detail fields recorded with the answer (dates, explanations, forms). */
  details: Record<string, unknown>;
  narrative: string | null;
  documentId: string | null;
  /** Who recorded it (null for an answer the system derived). */
  answeredByName: string | null;
  version: number;
  updatedAt: string;
}

export interface AcceptanceSegment {
  id: string;
  segmentKey: AcceptanceSegmentKey;
  title: string;
  state: SegmentState;
  sortOrder: number;
  readOnly: boolean;
  decidedByName: string | null;
  decidedAt: string | null;
  version: number;
  answers: AcceptanceAnswerRecord[];
  /** Visible, required questions and how many are done (01.1–01.7). */
  required: number;
  answered: number;
  /** Needs Attention lines: information awaited, details still to record. */
  pending: string[];
  /** Items needing the Engagement Partner's attention. */
  attention: string[];
  /** Needs Attention lines linked to their question (spec §13 click-through). */
  attentionItems: AttentionItem[];
  /** Why the segment is Not Applicable (e.g. continuing engagement). */
  notApplicableReason: string | null;
}

/** The Engagement Partner's live approving decision (reopened ones are history). */
export interface AcceptanceApproval {
  id: string;
  version: number;
  conclusion: AcceptanceConclusion;
  memo: string | null;
  reason: string | null;
  safeguards: string | null;
  approvedByName: string | null;
  approvedAt: string;
}

/** The Section 01 read shape for a statutory-audit shell. */
export interface StatutoryAuditAcceptance {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  /** Phase state of `acceptance` (in_progress until approved, then complete). */
  phaseState: string;
  /** 01.1 Engagement Profile — prefilled read-only from the masters (spec §4). */
  engagementProfile: MasterFact[];
  segments: AcceptanceSegment[];
  approval: AcceptanceApproval | null;
  /** Segments not yet complete/NA. */
  unresolvedSegmentCount: number;
  /** Open blocking acceptance matters that gate approval. */
  openBlockingMatterCount: number;
  /** True when every segment is resolved and no blocking matter is open. */
  readyForApproval: boolean;
  /** What approval needs, what to know, a suggested conclusion and a draft memo. */
  pack: AcceptancePack;
  /** Facts the questions are evaluated against (first year, services, team, prior year). */
  context: AcceptanceContext;
}

/** Record one answer, with its detail fields. */
export interface RecordAcceptanceAnswerInput {
  questionKey: string;
  /** Null clears the answer (e.g. withdrawing a system-derived answer's override). */
  answer: AcceptanceAnswer | null;
  details?: Record<string, unknown>;
  narrative?: string | null;
  documentId?: string | null;
}
