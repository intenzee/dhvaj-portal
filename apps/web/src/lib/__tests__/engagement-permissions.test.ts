import { PERMISSION } from '@hsdg/contracts';
import { engagementAbilities } from '../engagement-permissions';
import type { Principal } from '../principal';

const user = (overrides: Partial<Principal> = {}): Principal => ({
  userId: 'u',
  email: 'x@dhvaj.in',
  displayName: 'X',
  officeId: 'o',
  officeCode: 'NORTH',
  employeeId: 'emp-me',
  roles: [],
  effectiveRole: 'senior',
  permissions: [PERMISSION.engagementRead, PERMISSION.engagementManage],
  mfaRequired: false,
  mfaSatisfied: false,
  ...overrides,
});

const engagement = (overrides = {}) => ({
  status: 'active' as const,
  engagementPartnerId: 'emp-ep',
  engagementManagerId: 'emp-mgr',
  isSignedOff: false,
  openReviewPointCount: 0,
  effectiveReviewModel: {
    slug: 'manager_review',
    name: 'Manager Review',
    requiresEpSignoff: false,
  },
  ...overrides,
});

describe('engagementAbilities', () => {
  it('gives a team member who is not a lead nothing, even with engagement.manage', () => {
    const a = engagementAbilities(user(), engagement());
    expect(a.canManage).toBe(false);
    expect(a.canRecordReview).toBe(false);
    expect(a.canSignOff).toBe(false);
  });

  it('requires engagement.manage even for the EP', () => {
    const a = engagementAbilities(
      user({ employeeId: 'emp-ep', permissions: [PERMISSION.engagementRead] }),
      engagement(),
    );
    expect(a.canManage).toBe(false);
  });

  it('lets the manager review and sign off under a manager-review model', () => {
    const a = engagementAbilities(
      user({ employeeId: 'emp-mgr', effectiveRole: 'manager' }),
      engagement(),
    );
    expect(a.canManage).toBe(true);
    expect(a.canRecordReview).toBe(true);
    expect(a.canRecordEpReview).toBe(false);
    expect(a.canSignOff).toBe(true);
    expect(a.canReopen).toBe(false);
  });

  it('reserves sign-off for the EP when the model requires it — even over the Managing Partner', () => {
    const epModel = engagement({
      effectiveReviewModel: { slug: 'full_ep', name: 'Full EP', requiresEpSignoff: true },
    });
    const mgr = engagementAbilities(
      user({ employeeId: 'emp-mgr', effectiveRole: 'manager' }),
      epModel,
    );
    expect(mgr.canSignOff).toBe(false);
    expect(mgr.awaitingEpSignOff).toBe(true);
    const mp = engagementAbilities(user({ effectiveRole: 'managing_partner' }), epModel);
    expect(mp.canManage).toBe(true);
    expect(mp.canSignOff).toBe(false);
    const ep = engagementAbilities(
      user({ employeeId: 'emp-ep', effectiveRole: 'partner' }),
      epModel,
    );
    expect(ep.canSignOff).toBe(true);
    expect(ep.canRecordEpReview).toBe(true);
  });

  it('treats the Managing Partner as a lead by effective role only', () => {
    expect(
      engagementAbilities(user({ effectiveRole: 'managing_partner' }), engagement()).canReopen,
    ).toBe(true);
    const heldOnly = engagementAbilities(
      user({ effectiveRole: 'partner', roles: ['managing_partner', 'partner'] }),
      engagement(),
    );
    expect(heldOnly.canManage).toBe(false);
    expect(heldOnly.canReopen).toBe(false);
  });

  it('closes review once signed off or not active', () => {
    const lead = user({ employeeId: 'emp-ep' });
    expect(engagementAbilities(lead, engagement({ isSignedOff: true })).canRecordReview).toBe(
      false,
    );
    expect(engagementAbilities(lead, engagement({ status: 'on_hold' })).canSignOff).toBe(false);
  });

  it('explains why Complete is blocked', () => {
    const lead = user({ employeeId: 'emp-ep' });
    expect(engagementAbilities(lead, engagement()).completeBlockedReason).toMatch(/signed off/);
    expect(
      engagementAbilities(lead, engagement({ isSignedOff: true, openReviewPointCount: 2 }))
        .completeBlockedReason,
    ).toMatch(/2 open review point/);
    expect(
      engagementAbilities(lead, engagement({ isSignedOff: true })).completeBlockedReason,
    ).toBeNull();
  });
});
