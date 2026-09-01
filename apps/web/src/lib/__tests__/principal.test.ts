import { PERMISSION } from '@hsdg/contracts';
import { can, hasRole, roleLabel, type Principal } from '../principal';

const base: Principal = {
  userId: 'u1',
  email: 'p@dhvaj.in',
  displayName: 'Partner A',
  officeId: 'o1',
  officeCode: 'NORTH',
  employeeId: 'e1',
  roles: ['partner'],
  effectiveRole: 'partner',
  permissions: [PERMISSION.engagementRead, PERMISSION.engagementManage],
  mfaRequired: true,
  mfaSatisfied: true,
};

describe('principal helpers', () => {
  it('checks permissions', () => {
    expect(can(base, PERMISSION.engagementManage)).toBe(true);
    expect(can(base, PERMISSION.userManage)).toBe(false);
    expect(can(null, PERMISSION.engagementRead)).toBe(false);
  });

  it('checks roles by effective or held roles', () => {
    expect(hasRole(base, 'partner')).toBe(true);
    expect(hasRole(base, 'manager', 'partner')).toBe(true);
    expect(hasRole(base, 'admin')).toBe(false);
    expect(hasRole(null, 'partner')).toBe(false);
  });

  it('labels roles for display', () => {
    expect(roleLabel('managing_partner')).toBe('Managing Partner');
    expect(roleLabel(undefined)).toBe('No role');
  });
});
