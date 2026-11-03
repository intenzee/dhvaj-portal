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

describe('who changes the people', () => {
  const abilities = (p: Principal | null, over: Partial<typeof facts> = {}) =>
    engagementAbilities(p, { ...facts, ...over });

  it('the EP changes the manager and team, the manager the team, not the partner', () => {
    const ep = abilities(person([PERMISSION.engagementManage], 'ep'));
    expect(ep).toMatchObject({
      canChangePartner: false,
      canChangeManager: true,
      canChangeTeam: true,
    });
    const em = abilities(person([PERMISSION.engagementManage], 'em'));
    expect(em).toMatchObject({
      canChangePartner: false,
      canChangeManager: false,
      canChangeTeam: true,
    });
  });

  it('a finished engagement is the Managing Partner’s or an administrator’s to change', () => {
    const done = { status: 'completed' } as Partial<typeof facts>;
    expect(abilities(person([PERMISSION.engagementManage], 'ep'), done)).toMatchObject({
      canChangeManager: false,
      canChangeTeam: false,
    });
    expect(abilities(person([PERMISSION.engagementAssign], 'x'), done)).toMatchObject({
      canChangePartner: true,
      canChangeManager: true,
      canChangeTeam: true,
    });
  });

  it('anyone else only sees them', () => {
    expect(abilities(person([PERMISSION.engagementManage], 'sy'))).toMatchObject({
      canChangePartner: false,
      canChangeManager: false,
      canChangeTeam: false,
    });
    expect(abilities(null).canChangeTeam).toBe(false);
  });
});
