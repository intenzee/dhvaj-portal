import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LIFECYCLE_ACTION, ROLE } from '@hsdg/contracts';
import {
  epRequiredGuard,
  LIFECYCLE_GUARDS,
  managingPartnerOnlyGuard,
  reasonRequiredGuard,
  workflowTerminalGuard,
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
      teamCount: 0,
      version: 1,
      currentWorkflowState: null,
      onHoldReason: null,
      onHoldPreviousStatus: null,
      onHoldAt: null,
      onHoldExpectedResumeDate: null,
      team: [],
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

  describe('workflowTerminalGuard', () => {
    const terminalState = {
      id: 'ws1',
      slug: 'completed',
      name: 'Completed',
      sequence: 5,
      isInitial: false,
      isTerminal: true,
    };
    const nonTerminalState = { ...terminalState, slug: 'fieldwork', isTerminal: false };

    it('passes when the workflow state is terminal', () => {
      const c = ctx({ engagement: { ...ctx().engagement, currentWorkflowState: terminalState } });
      expect(() => workflowTerminalGuard.check(c)).not.toThrow();
    });

    it('rejects when the workflow state is not terminal', () => {
      const c = ctx({
        engagement: { ...ctx().engagement, currentWorkflowState: nonTerminalState },
      });
      expect(() => workflowTerminalGuard.check(c)).toThrow(BadRequestException);
    });

    it('rejects when the workflow has not started (null state)', () => {
      const c = ctx({ engagement: { ...ctx().engagement, currentWorkflowState: null } });
      expect(() => workflowTerminalGuard.check(c)).toThrow(BadRequestException);
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
