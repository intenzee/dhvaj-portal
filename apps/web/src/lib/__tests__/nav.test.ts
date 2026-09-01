import { PERMISSION } from '@hsdg/contracts';
import { visibleNav } from '../nav';
import type { Principal } from '../principal';

const principal = (permissions: string[]): Principal => ({
  userId: 'u',
  email: 'x@dhvaj.in',
  displayName: 'X',
  officeId: 'o',
  officeCode: 'NORTH',
  employeeId: 'e',
  roles: [],
  effectiveRole: undefined,
  permissions: permissions as Principal['permissions'],
  mfaRequired: false,
  mfaSatisfied: false,
});

describe('visibleNav', () => {
  it('always shows Home', () => {
    expect(visibleNav(null).map((i) => i.label)).toContain('Home');
  });

  it('hides permissioned items without the permission', () => {
    const labels = visibleNav(principal([])).map((i) => i.label);
    expect(labels).toContain('Home');
    expect(labels).not.toContain('Engagements');
    expect(labels).not.toContain('Administration');
  });

  it('shows engagement items to a user with engagement.read', () => {
    const labels = visibleNav(principal([PERMISSION.engagementRead])).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Engagements', 'My Work', 'Reviews & Sign-offs']));
    expect(labels).not.toContain('Administration');
  });
});
