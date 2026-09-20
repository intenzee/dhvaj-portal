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

/** Professional state of a segment. */
export const SEGMENT_STATE = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  complete: 'complete',
  notApplicable: 'not_applicable',
} as const;
export type SegmentState = (typeof SEGMENT_STATE)[keyof typeof SEGMENT_STATE];
export const SEGMENT_STATES: SegmentState[] = Object.values(SEGMENT_STATE);
/** States that count a segment as resolved for approval. */
export const SEGMENT_RESOLVED_STATES: SegmentState[] = [
  SEGMENT_STATE.complete,
  SEGMENT_STATE.notApplicable,
];

/** A Yes/No/NA answer to a checklist question. */
export const ACCEPTANCE_ANSWER = { yes: 'yes', no: 'no', na: 'na' } as const;
export type AcceptanceAnswer = (typeof ACCEPTANCE_ANSWER)[keyof typeof ACCEPTANCE_ANSWER];
export const ACCEPTANCE_ANSWERS: AcceptanceAnswer[] = Object.values(ACCEPTANCE_ANSWER);

/** The final professional conclusion recorded at partner approval. */
export const ACCEPTANCE_CONCLUSION = {
  accept: 'accept',
  acceptWithConditions: 'accept_with_conditions',
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

/**
 * A checklist question. `adverseAnswer` is the response that raises an
 * Acceptance Matter (§8.4); `severity` / `isBlocking` classify that matter.
 * A blocking matter prevents Section 01 completion until resolved or
 * accepted-with-approval.
 */
export interface AcceptanceQuestionDefinition {
  segmentKey: AcceptanceSegmentKey;
  questionKey: string;
  prompt: string;
  adverseAnswer: AcceptanceAnswer;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  isBlocking: boolean;
}

/** The methodology question catalogue for Section 01 (guide §8.1/§8.3). */
export const ACCEPTANCE_QUESTIONS: readonly AcceptanceQuestionDefinition[] = [
  // 01.1 Engagement Profile — read-only confirmation of the master facts.
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.engagementProfile, questionKey: 'profile_confirmed', prompt: 'The entity, group and engagement master facts are confirmed correct.', adverseAnswer: 'no', category: 'profile', severity: 'low', isBlocking: true },
  // 01.2 Appointment & Eligibility.
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.appointmentEligibility, questionKey: 'properly_appointed', prompt: 'The firm is validly appointed as auditor (Sec 139).', adverseAnswer: 'no', category: 'eligibility', severity: 'critical', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.appointmentEligibility, questionKey: 'eligible_141', prompt: 'No disqualification under Sec 141 applies to the firm or its partners.', adverseAnswer: 'no', category: 'eligibility', severity: 'critical', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.appointmentEligibility, questionKey: 'within_ceiling', prompt: 'The audit is within the Sec 141(3)(g) ceiling on number of audits.', adverseAnswer: 'no', category: 'eligibility', severity: 'high', isBlocking: true },
  // 01.3 Previous Auditor Communication (NA when continuing).
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.previousAuditor, questionKey: 'communication_sent', prompt: 'Communication with the previous auditor has been made (Clause 8, First Schedule).', adverseAnswer: 'no', category: 'previous_auditor', severity: 'high', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.previousAuditor, questionKey: 'no_professional_objection', prompt: 'No professional reason from the previous auditor prevents acceptance.', adverseAnswer: 'no', category: 'previous_auditor', severity: 'high', isBlocking: true },
  // 01.4 Acceptance / Continuance.
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.acceptanceContinuance, questionKey: 'management_integrity_concern', prompt: 'There are concerns over management integrity.', adverseAnswer: 'yes', category: 'acceptance', severity: 'high', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.acceptanceContinuance, questionKey: 'resources_competence', prompt: 'The firm has the competence, resources and time to perform the audit.', adverseAnswer: 'no', category: 'acceptance', severity: 'high', isBlocking: true },
  // 01.5 Independence & Ethics.
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.independenceEthics, questionKey: 'independence_threats', prompt: 'Threats to independence have been identified that need safeguards.', adverseAnswer: 'yes', category: 'independence', severity: 'high', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.independenceEthics, questionKey: 'prohibited_services', prompt: 'The firm provides services prohibited under Sec 144 to this client.', adverseAnswer: 'yes', category: 'independence', severity: 'critical', isBlocking: true },
  // 01.6 Audit Preconditions (SA 210).
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.auditPreconditions, questionKey: 'acceptable_framework', prompt: 'The financial reporting framework to be applied is acceptable (SA 210).', adverseAnswer: 'no', category: 'preconditions', severity: 'critical', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.auditPreconditions, questionKey: 'management_responsibilities', prompt: 'Management acknowledges its responsibilities (premise of the audit).', adverseAnswer: 'no', category: 'preconditions', severity: 'critical', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.auditPreconditions, questionKey: 'no_scope_limitation', prompt: 'Management imposes a scope limitation precluding an opinion.', adverseAnswer: 'yes', category: 'preconditions', severity: 'high', isBlocking: true },
  // 01.7 Engagement Letter & Required Documents.
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.engagementLetter, questionKey: 'engagement_letter_issued', prompt: 'The engagement letter has been issued (SA 210).', adverseAnswer: 'no', category: 'engagement_letter', severity: 'medium', isBlocking: true },
  { segmentKey: ACCEPTANCE_SEGMENT_KEY.engagementLetter, questionKey: 'client_acknowledged', prompt: 'The client has acknowledged the engagement letter.', adverseAnswer: 'no', category: 'engagement_letter', severity: 'medium', isBlocking: false },
] as const;

export interface AcceptanceAnswerRecord {
  id: string;
  segmentId: string;
  questionKey: string;
  answer: AcceptanceAnswer | null;
  narrative: string | null;
  documentId: string | null;
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
}

export interface AcceptanceApproval {
  id: string;
  version: number;
  conclusion: AcceptanceConclusion;
  memo: string | null;
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
  segments: AcceptanceSegment[];
  approval: AcceptanceApproval | null;
  /** Segments not yet complete/NA. */
  unresolvedSegmentCount: number;
  /** Open blocking acceptance matters that gate approval. */
  openBlockingMatterCount: number;
  /** True when every segment is resolved and no blocking matter is open. */
  readyForApproval: boolean;
}

/** Record one Yes/No/NA answer (with narrative on exception). */
export interface RecordAcceptanceAnswerInput {
  questionKey: string;
  answer: AcceptanceAnswer;
  narrative?: string | null;
  documentId?: string | null;
}
