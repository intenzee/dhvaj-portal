import { PERMISSION } from '@hsdg/contracts';
import {
  NAV_ITEMS,
  activeNavHref,
  foldedHref,
  isNavActive,
  landingPath,
  visibleNav,
  visibleNavSections,
} from '../nav';
import type { RoleSlug } from '@hsdg/contracts';
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
    expect(labels).toEqual(
      expect.arrayContaining(['Engagements', 'My Work', 'Reviews & Sign-offs']),
    );
    expect(labels).not.toContain('Administration');
  });

  it('shows Administration to a partner who sets the workflow policy, without user.manage', () => {
    expect(visibleNav(principal([PERMISSION.workflowManage])).map((i) => i.label)).toContain(
      'Administration',
    );
    expect(visibleNav(principal([PERMISSION.userManage])).map((i) => i.label)).toContain(
      'Administration',
    );
  });
});

describe('visibleNavSections', () => {
  it('drops sections with nothing visible', () => {
    const sections = visibleNavSections(principal([]));
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items.map((i) => i.label)).toEqual(['Home']);
  });

  it('groups client work under its own heading', () => {
    const sections = visibleNavSections(
      principal([PERMISSION.engagementRead, PERMISSION.entityRead]),
    );
    const clientWork = sections.find((s) => s.title === 'Client work');
    expect(clientWork?.items.map((i) => i.label)).toEqual(
      expect.arrayContaining(['Engagements', 'Clients']),
    );
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

describe('visibleNav with ff_work_links (WF-106, WF-107)', () => {
  // What the seeded roles hold (hsdg.role_permissions): preparers keep
  // service.read / employee.read / report.read for other screens.
  const STAFF = [
    PERMISSION.engagementRead,
    PERMISSION.notificationRead,
    PERMISSION.entityRead,
    PERMISSION.complianceRead,
    PERMISSION.serviceRead,
    PERMISSION.employeeRead,
    PERMISSION.reportRead,
  ];
  const as = (roles: RoleSlug[], permissions: string[] = STAFF, effectiveRole?: RoleSlug) => ({
    ...principal(permissions),
    roles,
    effectiveRole,
  });
  const labels = (p: Principal, workLinks = true) =>
    visibleNav(p, { workLinks }).map((i) => i.label);

  it.each(['article', 'senior'] as RoleSlug[])(
    'a %s sees at most 7 items: the client work',
    (role) => {
      expect(labels(as([role]))).toEqual([
        'Home',
        'My Work',
        'Notifications',
        'Engagements',
        'Clients',
        'Compliance',
        'Documents',
      ]);
    },
  );

  it.each(['manager', 'partner', 'managing_partner', 'admin'] as RoleSlug[])(
    'a %s keeps the back-office, minus the lists folded into My Work',
    (role) => {
      const all = [...STAFF, PERMISSION.userManage];
      const off = labels(as([role], all), false);
      const on = labels(as([role], all));
      expect(off.filter((l) => !on.includes(l)).sort()).toEqual(
        ['Client Dependencies', 'Reviews & Sign-offs', 'Tasks'].sort(),
      );
      expect(on).toEqual(
        expect.arrayContaining(['Services', 'Resource Management', 'Reports & MIS']),
      );
    },
  );

  it('a senior who is also a manager keeps the manager’s sidebar', () => {
    expect(labels(as(['senior', 'manager']))).toContain('Resource Management');
  });

  it('judges by the effective role when one is set', () => {
    expect(labels(as(['senior', 'manager'], STAFF, 'senior'))).not.toContain('Resource Management');
  });

  it('never shows what the permissions hide', () => {
    expect(labels(as(['senior'], [PERMISSION.engagementRead]))).toEqual([
      'Home',
      'My Work',
      'Engagements',
      'Documents',
    ]);
  });

  it('with the flag off nothing changes for anyone', () => {
    expect(labels(as(['senior']), false)).toEqual(visibleNav(as(['senior'])).map((i) => i.label));
    expect(labels(as(['senior']), false)).toContain('Services');
  });

  it('each folded item names the My Work tab it moved to', () => {
    for (const item of NAV_ITEMS.filter((i) => i.foldedInto)) {
      expect(item.foldedInto).toMatch(/^\/my-work\?tab=/);
    }
  });
});

describe('Today (WF-201)', () => {
  const STAFF = [PERMISSION.engagementRead, PERMISSION.notificationRead];
  const as = (roles: RoleSlug[], permissions: string[] = STAFF): Principal => ({
    ...principal(permissions),
    roles,
  });

  it('heads the sidebar only with ff_today_view on', () => {
    const p = as(['manager']);
    expect(visibleNav(p, { todayView: true }).map((i) => i.label)[0]).toBe('Today');
    expect(visibleNav(p).map((i) => i.label)).not.toContain('Today');
  });

  it.each(['article', 'senior'] as RoleSlug[])(
    'a %s lands on Today; Home stays in the sidebar',
    (role) => {
      expect(landingPath(as([role]), { todayView: true })).toBe('/today');
      expect(visibleNav(as([role]), { todayView: true }).map((i) => i.label)).toContain('Home');
    },
  );

  it('everyone else, or anyone with the flag off, lands on Home', () => {
    expect(landingPath(as(['manager']), { todayView: true })).toBe('/');
    expect(landingPath(as(['senior', 'manager']), { todayView: true })).toBe('/');
    expect(landingPath(as(['senior']))).toBe('/');
    expect(landingPath(as(['senior'], []), { todayView: true })).toBe('/');
    expect(landingPath(null, { todayView: true })).toBe('/');
  });
});

describe('Filing runs (WF-301)', () => {
  const STAFF = [PERMISSION.engagementRead, PERMISSION.complianceRead];
  const as = (roles: RoleSlug[]): Principal => ({ ...principal(STAFF), roles });

  it('shows only with ff_filing_runs on, to preparers too', () => {
    expect(visibleNav(as(['senior']), { workLinks: true }).map((i) => i.label)).not.toContain(
      'Filing runs',
    );
    expect(
      visibleNav(as(['senior']), { workLinks: true, filingRuns: true }).map((i) => i.label),
    ).toContain('Filing runs');
  });

  it('marks Filing runs current on /compliance/runs, not Compliance', () => {
    const items = visibleNav(as(['manager']), { filingRuns: true });
    expect(activeNavHref(items, '/compliance/runs')).toBe('/compliance/runs');
    expect(activeNavHref(items, '/compliance')).toBe('/compliance');
    expect(activeNavHref(items, '/compliance/rules')).toBe('/compliance');
    expect(activeNavHref(items, '/nowhere')).toBeNull();
  });
});

describe('foldedHref', () => {
  it('sends links to the old list routes straight to their My Work tab with ff_work_links', () => {
    expect(foldedHref('/tasks', true)).toBe('/my-work?tab=tasks');
    expect(foldedHref('/client-dependencies', true)).toBe('/my-work?tab=client-dependencies');
    expect(foldedHref('/reviews?filter=signoff', true)).toBe(
      '/my-work?filter=signoff&tab=to-review',
    );
    expect(foldedHref('/reviews?filter=high-risk', true)).toBe(
      '/my-work?filter=high-risk&tab=to-review',
    );
  });

  it('leaves every link alone with the flag off, and other routes always', () => {
    expect(foldedHref('/tasks', false)).toBe('/tasks');
    expect(foldedHref('/reviews?filter=signoff', false)).toBe('/reviews?filter=signoff');
    expect(foldedHref('/engagements/new', true)).toBe('/engagements/new');
    expect(foldedHref('/my-work?tab=tasks', true)).toBe('/my-work?tab=tasks');
  });
});

describe('Notices (PS-102)', () => {
  it('shows only with ff_notices on, to readers and to notice managers', () => {
    expect(visibleNav(principal([PERMISSION.engagementRead])).map((i) => i.label)).not.toContain(
      'Notices',
    );
    expect(
      visibleNav(principal([PERMISSION.engagementRead]), { notices: true }).map((i) => i.label),
    ).toContain('Notices');
    expect(
      visibleNav(principal([PERMISSION.noticeManage]), { notices: true }).map((i) => i.label),
    ).toContain('Notices');
    expect(visibleNav(principal([]), { notices: true }).map((i) => i.label)).not.toContain(
      'Notices',
    );
  });

  it('marks Notices current on a notice', () => {
    const items = visibleNav(principal([PERMISSION.engagementRead]), { notices: true });
    expect(activeNavHref(items, '/notices/abc')).toBe('/notices');
  });
});
