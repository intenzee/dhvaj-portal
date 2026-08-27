import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LIFECYCLE_ACTION, ROLE } from '@hsdg/contracts';
import {
  epRequiredGuard,
  LIFECYCLE_GUARDS,
  managingPartnerOnlyGuard,
  reasonRequiredGuard,
  reviewSignedOffGuard,
} from './lifecycle-guards';
import type { LifecycleGuardContext } from './lifecycle.types';

function ctx(overrides: Partial<LifecycleGuardContext> = {}): LifecycleGuardContext {
  return {
    ctx: { userId: 'u1', role: ROLE.partner },
    engagement: {
      id: 'e1',
      engagementCode: 'ENG00001',
      entityId: 'ent1',
      entityCode: 'ENT001',
      entityName: 'Acme',
      serviceId: 's1',
      serviceCode: 'STAT_AUDIT',
      serviceName: 'Statutory Audit',
      financialYear: '2024-25',
      periodLabel: 'FY',
      officeId: 'o1',
      officeCode: 'NORTH',
      status: 'accepted',
      engagementPartnerId: 'ep1',
      engagementPartnerName: 'Partner A',
      engagementManagerId: null,
      engagementManagerName: null,
      predecessorEngagementId: null,
      plannedStartDate: null,
      plannedEndDate: null,
      acceptedAt: null,
      engagementType: 'recurring_compliance',
      priority: 'normal',
      confidentiality: 'normal',
      currency: 'INR',
      billingModel: null,
      mandateLetterReference: null,
      mandateLetterDate: null,
      teamCount: 0,
      version: 1,
      currentWorkflowState: null,
      onHoldReason: null,
      onHoldPreviousStatus: null,
      onHoldAt: null,
      onHoldExpectedResumeDate: null,
      effectiveReviewModel: {
        slug: 'full_ep_review',
        name: 'Full EP Review',
        rank: 30,
        requiresEpSignoff: true,
      },
      reviewPlanModel: null,
      isSignedOff: false,
      signedOffById: null,
      signedOffByName: null,
      signedOffAt: null,
      openReviewPointCount: 0,
      isWaitingForClient: false,
      openTaskCount: 0,
      internallyOverdueTaskCount: 0,
      clientOverdueCount: 0,
      team: [],
      services: [],
    },
    action: LIFECYCLE_ACTION.accept,
    toStatus: 'accepted',
    input: {},
    ...overrides,
  };
}

describe('lifecycle guards', () => {
  describe('epRequiredGuard', () => {
    it('passes when the engagement has an EP', () => {
      expect(() => epRequiredGuard.check(ctx())).not.toThrow();
    });

    it('rejects when there is no EP', () => {
      const c = ctx({ engagement: { ...ctx().engagement, engagementPartnerId: null } });
      expect(() => epRequiredGuard.check(c)).toThrow(BadRequestException);
    });
  });

  describe('managingPartnerOnlyGuard', () => {
    it('passes for the Managing Partner', () => {
      const c = ctx({ ctx: { userId: 'u1', role: ROLE.managingPartner } });
      expect(() => managingPartnerOnlyGuard.check(c)).not.toThrow();
    });

    it.each([ROLE.partner, ROLE.manager, ROLE.admin, ROLE.senior, ROLE.article])(
      'rejects role "%s"',
      (role) => {
        const c = ctx({ ctx: { userId: 'u1', role } });
        expect(() => managingPartnerOnlyGuard.check(c)).toThrow(ForbiddenException);
      },
    );
  });

  describe('reasonRequiredGuard', () => {
    it('passes with a non-empty reason', () => {
      expect(() => reasonRequiredGuard.check(ctx({ input: { reason: 'because' } }))).not.toThrow();
    });

    it.each([undefined, '', '   '])('rejects reason %p', (reason) => {
      expect(() => reasonRequiredGuard.check(ctx({ input: { reason } }))).toThrow(
        BadRequestException,
      );
    });
  });

  describe('reviewSignedOffGuard', () => {
    it('passes when signed off with no open review points', () => {
      const c = ctx({
        engagement: { ...ctx().engagement, isSignedOff: true, openReviewPointCount: 0 },
      });
      expect(() => reviewSignedOffGuard.check(c)).not.toThrow();
    });

    it('rejects when the engagement is not signed off', () => {
      const c = ctx({ engagement: { ...ctx().engagement, isSignedOff: false } });
      expect(() => reviewSignedOffGuard.check(c)).toThrow(BadRequestException);
    });

    it('rejects when signed off but review points remain open', () => {
      const c = ctx({
        engagement: { ...ctx().engagement, isSignedOff: true, openReviewPointCount: 2 },
      });
      expect(() => reviewSignedOffGuard.check(c)).toThrow(BadRequestException);
    });
  });

  it('LIFECYCLE_GUARDS is exhaustive over every contract action', () => {
    // Exhaustiveness is also enforced at compile time (Record<LifecycleAction, …>);
    // this proves it at runtime too, e.g. against a stale build.
    expect(Object.keys(LIFECYCLE_GUARDS).sort()).toEqual(
      [
        'submit_for_acceptance',
        'accept',
        'start',
        'put_on_hold',
        'resume',
        'complete',
        'close',
        'decline',
        'withdraw',
        'cancel',
        'reopen',
      ].sort(),
    );
  });
});
