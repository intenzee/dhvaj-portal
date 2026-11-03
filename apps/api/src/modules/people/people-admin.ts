import {
  GRADE,
  MAIN_ROLES,
  PEOPLE_CHECK,
  ROLE,
  gradeRoleDisagree,
  type PeopleCheck,
  type PeopleRosterRow,
} from '@hsdg/contracts';

const GRADE_LABEL: Record<string, string> = {
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article: 'Article',
  staff: 'Staff',
};
const ROLE_LABEL: Record<string, string> = {
  managing_partner: 'Managing Partner',
  admin: 'Admin',
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article: 'Article',
};

const mainSet = new Set<string>(MAIN_ROLES);

/**
 * The day-one clean-up list (B-2), worked out from the people themselves —
 * no names are written down anywhere. Leavers count only towards duplicate
 * names (an old record under the same name is still confusing).
 */
export function peopleChecks(rows: readonly PeopleRosterRow[]): PeopleCheck[] {
  const here = rows.filter((r) => r.employmentStatus !== 'exited');
  const checks: PeopleCheck[] = [];
  const add = (
    key: PeopleCheck['key'],
    title: string,
    hint: string,
    people: PeopleCheck['people'],
  ): void => {
    if (people.length) checks.push({ key, title, hint, people });
  };

  add(
    PEOPLE_CHECK.gradeRole,
    'Grade and main role disagree',
    'Pick the grade they are paid at and the role they work as, so the two match.',
    here
      .filter((r) => gradeRoleDisagree(r.gradeSlug, r.mainRole, !!r.userId))
      .map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        detail: `Grade ${GRADE_LABEL[r.gradeSlug]}, role ${r.mainRole ? ROLE_LABEL[r.mainRole] : 'none'}`,
      })),
  );

  add(
    PEOPLE_CHECK.noReportsTo,
    'Reports to no one',
    'Everyone but the Managing Partner reports to someone.',
    here
      .filter((r) => !r.reportsToId && r.mainRole !== ROLE.managingPartner)
      .map((r) => ({ employeeId: r.employeeId, fullName: r.fullName, detail: r.employeeCode })),
  );

  const byName = new Map<string, PeopleRosterRow[]>();
  for (const r of rows) {
    const key = r.fullName.trim().replace(/\s+/g, ' ').toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), r]);
  }
  add(
    PEOPLE_CHECK.duplicateName,
    'Same name twice',
    'Two records for one person: keep one and deactivate or delete the other.',
    [...byName.values()]
      .filter((same) => same.length > 1)
      .flat()
      .map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        detail: `${r.employeeCode} · ${r.email ?? 'no login'}${r.employmentStatus === 'exited' ? ' · left' : ''}`,
      })),
  );

  add(
    PEOPLE_CHECK.nonPartnerEp,
    'Engagement Partner who is not a partner',
    'Only a partner by grade and role leads an engagement; move these to a partner.',
    here
      .filter(
        (r) =>
          r.ledEngagements > 0 &&
          (r.gradeSlug !== GRADE.partner ||
            (r.mainRole !== ROLE.partner && r.mainRole !== ROLE.managingPartner)),
      )
      .map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        detail: `Leads ${r.ledEngagements} open engagement${r.ledEngagements === 1 ? '' : 's'}`,
      })),
  );

  add(
    PEOPLE_CHECK.manyRoles,
    'Holds more than one main role',
    'A login has one main role; Accountant and HR are the only add-ons.',
    here
      .filter((r) => r.roles.filter((role) => mainSet.has(role)).length > 1)
      .map((r) => ({
        employeeId: r.employeeId,
        fullName: r.fullName,
        detail: r.roles
          .filter((role) => mainSet.has(role))
          .map((role) => ROLE_LABEL[role])
          .join(', '),
      })),
  );

  return checks;
}
