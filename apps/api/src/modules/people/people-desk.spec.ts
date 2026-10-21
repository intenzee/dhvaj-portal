import { PEOPLE_DESK_QUEUE } from '@hsdg/contracts';
import { addMonths } from './articleship.service';
import {
  addDays,
  buildQueues,
  lastWorkingDay,
  monthRange,
  weekStartOf,
  type DeskEmployee,
  type LoginFlag,
} from './people-desk';

const base: DeskEmployee = {
  id: 'e1',
  employeeCode: 'E001',
  fullName: 'Asha Rao',
  officeCode: 'MUM',
  gradeSlug: 'senior',
  gradeName: 'Senior',
  employmentStatus: 'active',
  dateOfJoining: '2025-04-01',
  dateOfExit: null,
  userId: 'u1',
  userActive: true,
  articleshipCompletes: null,
};
const emp = (over: Partial<DeskEmployee>): DeskEmployee => ({ ...base, ...over });

// Wednesday 21 Oct 2026, 10:00 IST.
const today = '2026-10-21';
const now = new Date('2026-10-21T04:30:00Z');

function queues(
  employees: DeskEmployee[],
  flags: Array<[string, LoginFlag]> = [],
  logged: string[] = employees.map((e) => e.id),
) {
  const out = buildQueues({
    today,
    now,
    employees,
    flags: new Map(flags),
    loggedOnLastWorkingDay: new Set(logged),
  });
  return Object.fromEntries(out.map((q) => [q.key, q.people.map((p) => p.employeeId)]));
}

describe('people desk dates', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('finds the Monday of the week', () => {
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19');
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19'); // Sunday
  });

  it('skips Sunday for the last working day (Saturdays are worked)', () => {
    expect(lastWorkingDay('2026-10-21')).toBe('2026-10-20');
    expect(lastWorkingDay('2026-10-26')).toBe('2026-10-24'); // Monday → Saturday
    expect(lastWorkingDay('2026-10-25')).toBe('2026-10-24'); // Sunday → Saturday
  });

  it('gives a month’s first and last day, leap years included', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('articleship completion', () => {
  it('adds whole months', () => {
    expect(addMonths('2026-07-01', 36)).toBe('2029-07-01');
    expect(addMonths('2026-07-15', 24)).toBe('2028-07-15');
  });

  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
  });
});

describe('people desk queues', () => {
  it('lists current people without a login, never the exited', () => {
    const q = queues([
      emp({ id: 'a', userId: null, userActive: null }),
      emp({ id: 'b', userId: null, userActive: null, employmentStatus: 'exited' }),
      emp({ id: 'c' }),
    ]);
    expect(q[PEOPLE_DESK_QUEUE.noLogin]).toEqual(['a']);
  });

  it('flags locked logins and temporary passwords older than three days', () => {
    const q = queues(
      [
        emp({ id: 'a', userId: 'ua' }),
        emp({ id: 'b', userId: 'ub' }),
        emp({ id: 'c', userId: 'uc' }),
        emp({ id: 'd', userId: 'ud', userActive: false }),
      ],
      [
        ['ua', { locked: true, mustChange: false, setAt: '2026-01-01T00:00:00Z' }],
        ['ub', { locked: false, mustChange: true, setAt: '2026-10-10T00:00:00Z' }],
        ['uc', { locked: false, mustChange: true, setAt: '2026-10-20T00:00:00Z' }],
        ['ud', { locked: true, mustChange: true, setAt: '2026-01-01T00:00:00Z' }],
      ],
    );
    expect(q[PEOPLE_DESK_QUEUE.locked]).toEqual(['a']);
    expect(q[PEOPLE_DESK_QUEUE.temporaryPassword]).toEqual(['b']);
  });

  it('lists articleships completing in the next 90 days, soonest first', () => {
    const q = queues([
      emp({ id: 'late', gradeSlug: 'article', articleshipCompletes: '2027-01-10' }),
      emp({ id: 'soon', gradeSlug: 'article', articleshipCompletes: '2026-11-01' }),
      emp({ id: 'far', gradeSlug: 'article', articleshipCompletes: '2027-06-01' }),
      emp({ id: 'past', gradeSlug: 'article', articleshipCompletes: '2026-10-01' }),
    ]);
    expect(q[PEOPLE_DESK_QUEUE.articlesCompleting]).toEqual(['soon', 'late']);
  });

  it('catches a leaver whose exit date has passed but whose login is still on', () => {
    const q = queues([
      emp({ id: 'a', employmentStatus: 'exited', dateOfExit: '2026-10-15' }),
      emp({ id: 'b', employmentStatus: 'exited', dateOfExit: '2026-10-15', userActive: false }),
      emp({ id: 'c', employmentStatus: 'notice_period', dateOfExit: '2026-11-15' }),
    ]);
    expect(q[PEOPLE_DESK_QUEUE.exitPassedLoginOn]).toEqual(['a']);
  });

  it('chases missing hours, but not partners, people on leave or joiners from today', () => {
    const q = queues(
      [
        emp({ id: 'missing' }),
        emp({ id: 'logged' }),
        emp({ id: 'partner', gradeSlug: 'partner' }),
        emp({ id: 'leave', employmentStatus: 'on_leave' }),
        emp({ id: 'new', dateOfJoining: today }),
      ],
      [],
      ['logged'],
    );
    expect(q[PEOPLE_DESK_QUEUE.noHoursYesterday]).toEqual(['missing']);
  });
});
