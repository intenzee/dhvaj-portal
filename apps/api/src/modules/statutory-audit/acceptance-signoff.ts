import {
  ACCEPTANCE_FILE_STATUS_LABEL,
  SEGMENT_STATE_LABEL,
  isApprovingConclusion,
  type AcceptanceDecisionRecord,
  type AcceptanceFileStatus,
  type AcceptanceOpenMatterLink,
  type AcceptanceReadinessItem,
  type AcceptanceRecommendationRecord,
  type FinalSegmentState,
  type Section01Header,
  type Section01Status,
  type SegmentState,
} from '@hsdg/contracts';

/**
 * Section 01.8 readiness engine (spec §12, §14). Pure: given the segment
 * states, open matters, file statuses and the recommendation/decision history,
 * it derives the header, 01.8's own state, the readiness summary and what
 * still blocks acceptance — so the screen and the approval gate agree.
 */

/** Readiness rows in spec §12 order (01.8 itself is not one). */
const READINESS_SEGMENTS: Array<{ key: string; label: string }> = [
  { key: 'engagement_profile', label: 'Engagement Profile' },
  { key: 'appointment_eligibility', label: 'Appointment & Eligibility' },
  { key: 'previous_auditor', label: 'Previous Auditor Communication' },
  { key: 'acceptance_continuance', label: 'Acceptance / Continuance' },
  { key: 'independence_ethics', label: 'Independence & Ethics' },
  { key: 'audit_preconditions', label: 'Audit Preconditions' },
  { key: 'engagement_letter', label: 'Engagement Letter & Documents' },
];

/** Letter statuses that count as "prepared and appropriately progressed" (§14). */
const LETTER_PROGRESSED: AcceptanceFileStatus[] = ['approved', 'issued', 'accepted'];

export interface SignoffFacts {
  segments: Array<{ segmentKey: string; title: string; state: SegmentState; hasAnswers: boolean }>;
  openMatters: Array<{
    id: string;
    seq: number;
    title: string;
    source: string;
    severity: string | null;
    isBlocking: boolean;
  }>;
  /** Status of the engagement letter slot, null when not created yet. */
  engagementLetterStatus: AcceptanceFileStatus | null;
  recommendation: AcceptanceRecommendationRecord | null;
  /** Newest first. */
  decisions: AcceptanceDecisionRecord[];
  /** Segment-side §14 checks that fail (from the question engine), if any. */
  completionFailures: string[];
  preparedByName: string | null;
  engagementPartnerName: string | null;
}

export interface SignoffDerived {
  header: Section01Header;
  finalSegmentState: FinalSegmentState;
  readiness: AcceptanceReadinessItem[];
  openMatters: AcceptanceOpenMatterLink[];
  /** What prevents an approving conclusion (empty = ready). */
  blockers: string[];
  /** The live approving decision, if any. */
  liveApproval: AcceptanceDecisionRecord | null;
}

const resolved = (s: SegmentState) => s === 'complete' || s === 'not_applicable';

/** Where a matter's source lives in the panel (`acceptance:<segment>:<question>`). */
export function matterAnchor(source: string): string {
  const [, segmentKey] = source.split(':');
  return segmentKey ? `segment-${segmentKey}` : 'acceptance-matters';
}

export function deriveSignoff(f: SignoffFacts): SignoffDerived {
  const liveApproval =
    f.decisions.find((d) => isApprovingConclusion(d.conclusion) && !d.reopenedAt) ?? null;

  const readiness: AcceptanceReadinessItem[] = [];
  const blockers: string[] = [];
  for (const def of READINESS_SEGMENTS) {
    const seg = f.segments.find((s) => s.segmentKey === def.key);
    const state = seg?.state ?? 'not_started';
    const ok = resolved(state);
    readiness.push({
      key: def.key,
      label: def.label,
      statusLabel: SEGMENT_STATE_LABEL[state] ?? state,
      ok,
      anchor: `segment-${def.key}`,
    });
    if (!ok)
      blockers.push(`${def.label} is ${(SEGMENT_STATE_LABEL[state] ?? state).toLowerCase()}.`);
  }

  const letterOk =
    f.engagementLetterStatus !== null && LETTER_PROGRESSED.includes(f.engagementLetterStatus);
  readiness.push({
    key: 'engagement_letter_file',
    label: 'Statutory Audit Engagement Letter',
    statusLabel: f.engagementLetterStatus
      ? ACCEPTANCE_FILE_STATUS_LABEL[f.engagementLetterStatus]
      : 'Not Created',
    ok: letterOk,
    anchor: 'segment-engagement_letter',
  });
  if (!letterOk) {
    blockers.push(
      f.engagementLetterStatus
        ? `The engagement letter is ${ACCEPTANCE_FILE_STATUS_LABEL[f.engagementLetterStatus]}; it must be approved by the partner before acceptance.`
        : 'The engagement letter has not been created yet.',
    );
  }

  const blocking = f.openMatters.filter((m) => m.isBlocking);
  readiness.push({
    key: 'open_matters',
    label: 'Open Acceptance Matters',
    statusLabel:
      f.openMatters.length === 0
        ? 'None'
        : `${f.openMatters.length} open${blocking.length ? ` · ${blocking.length} blocking` : ''}`,
    ok: blocking.length === 0,
    anchor: 'acceptance-matters',
  });
  if (blocking.length > 0) {
    blockers.push(
      `${blocking.length} blocking acceptance matter${blocking.length === 1 ? '' : 's'} must be resolved or accepted with approval.`,
    );
  }
  for (const c of f.completionFailures) if (!blockers.includes(c)) blockers.push(c);

  const finalSegmentState: FinalSegmentState = liveApproval
    ? 'complete'
    : blockers.length === 0
      ? 'ready_for_approval'
      : 'locked';

  const applicable = f.segments.filter(
    (s) => s.segmentKey !== 'final_acceptance' && s.state !== 'not_applicable',
  );
  const lastDecision = f.decisions[0] ?? null;
  const sentBack =
    lastDecision !== null &&
    !lastDecision.reopenedAt &&
    (lastDecision.conclusion === 'return' || lastDecision.conclusion === 'decline') &&
    f.recommendation?.status !== 'submitted';
  const started =
    f.segments.some((s) => s.hasAnswers || (s.state !== 'not_started' && s.state !== 'locked')) ||
    f.decisions.length > 0;
  const status: Section01Status = liveApproval
    ? 'complete'
    : sentBack || blocking.length > 0 || f.segments.some((s) => s.state === 'attention_required')
      ? 'attention_required'
      : f.recommendation?.status === 'submitted'
        ? 'ready_for_review'
        : started
          ? 'in_progress'
          : 'not_started';

  return {
    header: {
      status,
      completedSegments: applicable.filter((s) => s.state === 'complete').length,
      applicableSegments: applicable.length,
      preparedByName: f.preparedByName,
      engagementPartnerName: f.engagementPartnerName,
      openMatterCount: f.openMatters.length,
      openBlockingMatterCount: blocking.length,
    },
    finalSegmentState,
    readiness,
    openMatters: f.openMatters.map((m) => ({
      id: m.id,
      code: `M-${String(m.seq).padStart(3, '0')}`,
      title: m.title,
      severity: m.severity,
      isBlocking: m.isBlocking,
      anchor: matterAnchor(m.source),
    })),
    blockers,
    liveApproval,
  };
}
