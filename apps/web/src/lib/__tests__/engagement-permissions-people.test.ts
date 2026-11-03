import { PERMISSION } from '@hsdg/contracts';
import { engagementAbilities } from '../engagement-permissions';
import type { Principal } from '../principal';

const facts = {
  status: 'active',
  engagementPartnerId: 'ep',
  engagementManagerId: 'em',
  isSignedOff: false,
  openReviewPointCount: 0,
  effectiveReviewModel: { requiresEpSignoff: false },
} as Parameters<typeof engagementAbilities>[1];

const person = (permissions: string[], employeeId: string): Principal =>
  ({ employeeId, permissions, roles: [], effectiveRole: 'partner' }) as unknown as Principal;

describe('canChangePeople', () => {
  it('follows engagement.assign, not being the partner or manager', () => {
    const ep = person([PERMISSION.engagementManage], 'ep');
    expect(engagementAbilities(ep, facts).canManage).toBe(true);
    expect(engagementAbilities(ep, facts).canChangePeople).toBe(false);
    expect(
      engagementAbilities(person([PERMISSION.engagementAssign], 'x'), facts).canChangePeople,
    ).toBe(true);
    expect(engagementAbilities(null, facts).canChangePeople).toBe(false);
  });
});
