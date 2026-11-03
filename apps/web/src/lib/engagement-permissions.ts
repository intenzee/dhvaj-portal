import { PERMISSION } from '@hsdg/contracts';
import { can, type Principal } from './principal';
import type { EngagementDetail } from './types';

/** Past doing: only engagement.assign changes its people (mirrors the API). */
const FINISHED_STATUSES: readonly string[] = [
  'completed',
  'closed',
  'declined',
  'withdrawn',
  'cancelled',
  'merged',
];

/**
 * What the current user may do to an engagement — a UI mirror of the server's
 * rules, used only to hide buttons that would be refused. The server stays the
 * source of truth:
 *  - every review/lifecycle endpoint requires `engagement.manage`;
 *  - the `engagements_update` RLS policy admits only a "lead": the Managing
 *    Partner (by effective role — `ctx_is_business_firmwide()`), or the
 *    engagement's EP or manager (`is_engagement_lead`);
 *  - an EP review, and sign-off under an EP-required review model, must be the
 *    accountable EP (EngagementReviewsService);
 *  - reopen is Managing-Partner-only by effective role (managingPartnerOnlyGuard);
 *  - `engagement.assign` (Managing Partner, administrator) changes the
 *    partner, manager and team at any stage; while the engagement is open its
 *    own EP changes the manager and team and its manager the team; everyone
 *    else only sees them (EngagementsService.assertMayChange);
 *  - complete needs a current sign-off and no open review points
 *    (reviewSignedOffGuard).
 */
export interface EngagementAbilities {
  /** May change status and record reviews at all (permission + lead). */
  canManage: boolean;
  canRecordReview: boolean;
  canRecordEpReview: boolean;
  canSignOff: boolean;
  /** A lead who cannot sign off only because the review model needs the EP. */
  awaitingEpSignOff: boolean;
  canReopen: boolean;
  /** May change the Engagement Partner (engagement.assign). */
  canChangePartner: boolean;
  /** May change the manager: engagement.assign, or the EP while it is open. */
  canChangeManager: boolean;
  /** May add and remove team: engagement.assign, or the EP or manager while it is open. */
  canChangeTeam: boolean;
  /** Why Complete would be refused right now, or null if it would pass. */
  completeBlockedReason: string | null;
}

type EngagementFacts = Pick<
  EngagementDetail,
  | 'status'
  | 'engagementPartnerId'
  | 'engagementManagerId'
  | 'isSignedOff'
  | 'openReviewPointCount'
  | 'effectiveReviewModel'
>;

export function engagementAbilities(
  principal: Principal | null,
  e: EngagementFacts,
): EngagementAbilities {
  const employeeId = principal?.employeeId ?? null;
  // The server keys firm-wide authority off the *effective* role, not held roles.
  const isMp = principal?.effectiveRole === 'managing_partner';
  const isEp = !!employeeId && e.engagementPartnerId === employeeId;
  const isManager = !!employeeId && e.engagementManagerId === employeeId;
  const canManage = can(principal, PERMISSION.engagementManage) && (isMp || isEp || isManager);

  const reviewOpen = canManage && e.status === 'active' && !e.isSignedOff;
  const canAssign = can(principal, PERMISSION.engagementAssign);
  const open = !FINISHED_STATUSES.includes(e.status);
  const epGateBlocks = e.effectiveReviewModel.requiresEpSignoff && !isEp;

  let completeBlockedReason: string | null = null;
  if (!e.isSignedOff) {
    completeBlockedReason = e.effectiveReviewModel.requiresEpSignoff
      ? 'The Engagement Partner must sign off first.'
      : 'The engagement must be signed off first.';
  } else if (e.openReviewPointCount > 0) {
    completeBlockedReason = `Resolve the ${e.openReviewPointCount} open review point(s) first.`;
  }

  return {
    canManage,
    canRecordReview: reviewOpen,
    canRecordEpReview: reviewOpen && isEp,
    canSignOff: reviewOpen && !epGateBlocks,
    awaitingEpSignOff: reviewOpen && epGateBlocks,
    canReopen: canManage && isMp,
    canChangePartner: canAssign,
    canChangeManager: canAssign || (open && isEp),
    canChangeTeam: canAssign || (open && (isEp || isManager)),
    completeBlockedReason,
  };
}
