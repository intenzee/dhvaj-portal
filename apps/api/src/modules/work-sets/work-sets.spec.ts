import { defaultSetName, giveScope, setNotificationTitle } from './work-sets';

describe('giveScope', () => {
  it('lets a Partner and above give to anyone, a Manager to their tree, no one else', () => {
    expect(giveScope('admin')).toBe('anyone');
    expect(giveScope('managing_partner')).toBe('anyone');
    expect(giveScope('partner')).toBe('anyone');
    expect(giveScope('manager')).toBe('tree');
    expect(giveScope('senior')).toBeNull();
    expect(giveScope('article')).toBeNull();
    expect(giveScope(null)).toBeNull();
  });
});

describe('defaultSetName', () => {
  it('names a set of one form and period by both', () => {
    const tasks = Array.from({ length: 3 }, () => ({ formLabel: 'GSTR-1', periodKey: '2026-10' }));
    expect(defaultSetName(tasks, 'Arjun Mehta')).toBe('GSTR-1 Oct 2026 — Arjun');
  });

  it('counts the tasks of a mixed set', () => {
    expect(
      defaultSetName(
        [
          { formLabel: 'GSTR-1', periodKey: '2026-10' },
          { formLabel: 'GSTR-3B', periodKey: '2026-10' },
        ],
        'Arjun',
      ),
    ).toBe('2 tasks — Arjun');
    expect(defaultSetName([{ formLabel: null, periodKey: null }], 'Arjun')).toBe('1 task — Arjun');
  });
});

describe('setNotificationTitle', () => {
  it('says who gave how much, and when it is due', () => {
    expect(
      setNotificationTitle({
        giverName: 'Manager X',
        count: 8,
        setName: 'GSTR-1 Oct 2026 — Arjun',
        dueDate: '2026-11-09',
      }),
    ).toBe('Manager X gave you 8 tasks: GSTR-1 Oct 2026 — Arjun, due 9 Nov');
  });
});
