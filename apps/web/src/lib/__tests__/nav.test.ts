import { PERMISSION } from '@hsdg/contracts';
import { NAV_ITEMS, isNavActive, visibleNav, visibleNavSections } from '../nav';
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

describe('visibleNavSections', () => {
  it('drops sections with nothing visible', () => {
    const sections = visibleNavSections(principal([]));
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items.map((i) => i.label)).toEqual(['Home']);
  });

  it('groups client work under its own heading', () => {
    const sections = visibleNavSections(principal([PERMISSION.engagementRead, PERMISSION.entityRead]));
    const clientWork = sections.find((s) => s.title === 'Client work');
    expect(clientWork?.items.map((i) => i.label)).toEqual(expect.arrayContaining(['Engagements', 'Clients']));
  });

  it('gives every item a plain-language hint', () => {
    for (const item of NAV_ITEMS) expect(item.hint.length).toBeGreaterThan(10);
  });
});

describe('isNavActive', () => {
  const home = NAV_ITEMS.find((i) => i.href === '/')!;
  const engagements = NAV_ITEMS.find((i) => i.href === '/engagements')!;

  it('matches Home only on the root', () => {
    expect(isNavActive(home, '/')).toBe(true);
    expect(isNavActive(home, '/engagements')).toBe(false);
  });

  it('matches a section and its sub-pages, not prefix look-alikes', () => {
    expect(isNavActive(engagements, '/engagements')).toBe(true);
    expect(isNavActive(engagements, '/engagements/abc')).toBe(true);
    expect(isNavActive(engagements, '/engagements-archive')).toBe(false);
  });
});
