import { DEFAULT_REVIEWER, type DefaultReviewer } from '@hsdg/contracts';

export interface ReviewerCandidates {
  streamLead: string | null;
  manager: string | null;
  partner: string | null;
}

/**
 * Who reviews work sent for review without a reviewer named, in the order the
 * firm prefers (Questions for the partners, 2); the first one who is not the
 * preparer wins. The others stay as fallbacks so a send never stalls on a gap.
 */
export function reviewerCandidates(
  policy: DefaultReviewer,
  c: ReviewerCandidates,
  preparerId: string | null,
): string | null {
  const order =
    policy === DEFAULT_REVIEWER.streamLead
      ? [c.streamLead, c.manager, c.partner]
      : policy === DEFAULT_REVIEWER.engagementPartner
        ? [c.partner, c.manager, c.streamLead]
        : [c.manager, c.partner, c.streamLead];
  return order.find((id): id is string => !!id && id !== preparerId) ?? null;
}
