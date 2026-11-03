import { mainRoleForGrade, mainRoleOf, type PeopleRosterRow } from '@hsdg/contracts';
import { peopleChecks } from './people-admin';

const row = (over: Partial<PeopleRosterRow>): PeopleRosterRow => ({
  employeeId: over.employeeCode ?? 'e',
  employeeCode: 'E',
  fullName: over.employeeCode ? `Person ${over.employeeCode}` : 'Someone',
  userId: 'u',
  email: 'someone@dhvaj.in',
  loginActive: true,
  gradeSlug: 'senior',
  mainRole: 'senior',
  addOns: [],
  roles: ['senior'],
  reportsToId: 'boss',
  reportsToName: 'Boss',
  officeCode: 'NORTH',
  employmentStatus: 'active',
  dateOfExit: null,
  openTasks: 0,
  ledEngagements: 0,
  version: 1,
  ...over,
});

const keysFor = (rows: PeopleRosterRow[], key: string) =>
  peopleChecks(rows)
    .find((c) => c.key === key)
    ?.people.map((p) => p.employeeId) ?? [];

describe('peopleChecks (B-2 day-one clean-up list)', () => {
  it('lists nothing for a tidy firm', () => {
    expect(
      peopleChecks([
        row({
          employeeCode: 'MP',
          gradeSlug: 'partner',
          mainRole: 'managing_partner',
          roles: ['managing_partner'],
          reportsToId: null,
        }),
        row({ employeeCode: 'S1', fullName: 'Senior One' }),
      ]),
    ).toEqual([]);
  });

  it('flags grade and main role disagreeing, but not someone without a login', () => {
    const rows = [
      row({ employeeCode: 'K', gradeSlug: 'partner', mainRole: 'article', roles: ['article'] }),
      row({ employeeCode: 'N', gradeSlug: 'partner', mainRole: null, roles: [], userId: null }),
    ];
    expect(keysFor(rows, 'grade_role')).toEqual(['K']);
  });

  it('flags reporting to no one, except the Managing Partner, and ignores leavers', () => {
    const rows = [
      row({ employeeCode: 'A', reportsToId: null }),
      row({
        employeeCode: 'MP',
        gradeSlug: 'partner',
        mainRole: 'managing_partner',
        roles: ['managing_partner'],
        reportsToId: null,
      }),
      row({ employeeCode: 'L', reportsToId: null, employmentStatus: 'exited' }),
    ];
    expect(keysFor(rows, 'no_reports_to')).toEqual(['A']);
  });

  it('flags the same name twice, counting a leaver', () => {
    const rows = [
      row({ employeeCode: 'D1', fullName: 'Deepak Gupta' }),
      row({ employeeCode: 'D2', fullName: ' deepak  gupta', employmentStatus: 'exited' }),
      row({ employeeCode: 'X', fullName: 'Someone Else' }),
    ];
    expect(keysFor(rows, 'duplicate_name')).toEqual(['D1', 'D2']);
  });

  it('flags an Engagement Partner who is not a partner by grade and role', () => {
    const rows = [
      row({
        employeeCode: 'KD',
        gradeSlug: 'partner',
        mainRole: 'article',
        roles: ['article'],
        ledEngagements: 1,
      }),
      row({
        employeeCode: 'P',
        gradeSlug: 'partner',
        mainRole: 'partner',
        roles: ['partner'],
        ledEngagements: 3,
      }),
    ];
    expect(keysFor(rows, 'non_partner_ep')).toEqual(['KD']);
  });

  it('flags a login holding more than one main role; desk add-ons do not count', () => {
    const rows = [
      row({
        employeeCode: 'T',
        mainRole: 'managing_partner',
        roles: ['managing_partner', 'admin', 'partner', 'accountant', 'hr'],
      }),
      row({ employeeCode: 'H', roles: ['senior', 'hr'], addOns: ['hr'] }),
    ];
    expect(keysFor(rows, 'many_roles')).toEqual(['T']);
  });
});

describe('main role helpers', () => {
  it('reads the highest main role, the Managing Partner before the administrator', () => {
    expect(mainRoleOf(['admin', 'managing_partner', 'hr'])).toBe('managing_partner');
    expect(mainRoleOf(['hr', 'accountant'])).toBeNull();
  });

  it('offers the role that fits a new grade, and nothing when it already fits', () => {
    expect(mainRoleForGrade('article', 'partner')).toBe('article');
    expect(mainRoleForGrade('partner', 'managing_partner')).toBeNull();
    expect(mainRoleForGrade('staff', 'senior')).toBeNull();
  });
});
