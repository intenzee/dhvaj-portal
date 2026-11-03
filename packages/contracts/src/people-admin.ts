/**
 * The People screen (B-2) and leaving the firm (B-3): one row per person with
 * their grade, main role and add-ons side by side, the day-one clean-up list,
 * moving someone's open work, deactivating and deleting permanently. The
 * Managing Partner and the administrator; deleting is the administrator's alone.
 */
import { GRADE, ROLE, type EmploymentStatus, type GradeSlug, type RoleSlug } from './identity';

/** The one role that says what someone does, highest authority first. */
export const MAIN_ROLES = [
  ROLE.admin,
  ROLE.managingPartner,
  ROLE.partner,
  ROLE.manager,
  ROLE.senior,
  ROLE.article,
] as const satisfies readonly RoleSlug[];
export type MainRole = (typeof MAIN_ROLES)[number];

/** Desk roles ticked on top of the main role. */
export const ADD_ON_ROLES = [ROLE.accountant, ROLE.hr] as const satisfies readonly RoleSlug[];
export type AddOnRole = (typeof ADD_ON_ROLES)[number];

export const MAIN_ROLE_LABEL: Record<MainRole, string> = {
  admin: 'Admin',
  managing_partner: 'Managing Partner',
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article: 'Article',
};

/**
 * Which main role a role set amounts to: the highest held, by the same order
 * the security context uses (the Managing Partner before the administrator).
 * Null for a login holding only desk roles, or none.
 */
const MAIN_ORDER: readonly MainRole[] = [
  ROLE.managingPartner,
  ROLE.admin,
  ROLE.partner,
  ROLE.manager,
  ROLE.senior,
  ROLE.article,
];
export function mainRoleOf(roles: readonly string[]): MainRole | null {
  return MAIN_ORDER.find((r) => roles.includes(r)) ?? null;
}

/** The main roles that sit with each grade; Staff (support) is the administrator or a desk role. */
export const GRADE_MAIN_ROLES: Record<GradeSlug, readonly (MainRole | null)[]> = {
  [GRADE.partner]: [ROLE.partner, ROLE.managingPartner],
  [GRADE.manager]: [ROLE.manager],
  [GRADE.senior]: [ROLE.senior],
  [GRADE.article]: [ROLE.article],
  [GRADE.staff]: [ROLE.admin, null],
};

/** True when a person's grade and main role disagree (people without a login have no role to disagree). */
export function gradeRoleDisagree(
  grade: GradeSlug,
  mainRole: MainRole | null,
  hasLogin: boolean,
): boolean {
  if (!hasLogin) return false;
  return !GRADE_MAIN_ROLES[grade].includes(mainRole);
}

/**
 * The main role to offer when a grade changes ("Make Khushi's role Article
 * too?"); null when the current role already fits or the grade has no single
 * matching role (Staff).
 */
export function mainRoleForGrade(grade: GradeSlug, current: MainRole | null): MainRole | null {
  const fits = GRADE_MAIN_ROLES[grade];
  if (fits.includes(current)) return null;
  const first = fits[0];
  return grade === GRADE.staff || !first ? null : first;
}

/** GET /people/admin/roster — one row per person (deleted people are left out). */
export interface PeopleRosterRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  userId: string | null;
  email: string | null;
  loginActive: boolean;
  gradeSlug: GradeSlug;
  mainRole: MainRole | null;
  addOns: AddOnRole[];
  /** Every role the login holds, so the "many roles" check and a save can see them. */
  roles: RoleSlug[];
  reportsToId: string | null;
  reportsToName: string | null;
  officeCode: string;
  employmentStatus: EmploymentStatus;
  dateOfExit: string | null;
  /** Tasks assigned to them or awaiting their review, not done or cancelled. */
  openTasks: number;
  /** Open engagements where they are the Engagement Partner. */
  ledEngagements: number;
  version: number;
}

export const PEOPLE_CHECK = {
  gradeRole: 'grade_role',
  noReportsTo: 'no_reports_to',
  duplicateName: 'duplicate_name',
  nonPartnerEp: 'non_partner_ep',
  manyRoles: 'many_roles',
} as const;
export type PeopleCheckKey = (typeof PEOPLE_CHECK)[keyof typeof PEOPLE_CHECK];

/** One line of the day-one clean-up list, worked out from the data each time. */
export interface PeopleCheck {
  key: PeopleCheckKey;
  title: string;
  hint: string;
  people: { employeeId: string; fullName: string; detail: string }[];
}

export interface PeopleRoster {
  people: PeopleRosterRow[];
  checks: PeopleCheck[];
}

/** POST /people/admin/move-work — every open task of one person to another. */
export interface MoveWorkInput {
  fromEmployeeId: string;
  toEmployeeId: string;
  reason: string;
}
export interface MoveWorkResult {
  /** Tasks now assigned to the new person. */
  assigned: number;
  /** Tasks whose review now sits with the new person. */
  reviews: number;
}

/** POST /people/employees/:id/deactivate */
export interface DeactivateInput {
  /** Defaults to today; never in the future (deactivating is now). */
  dateOfExit?: string;
  reason?: string;
}

export const DELETE_BLOCKER = {
  openTasks: 'open_tasks',
  ledEngagements: 'led_engagements',
  unpaidPayroll: 'unpaid_payroll',
} as const;
export type DeleteBlockerKind = (typeof DELETE_BLOCKER)[keyof typeof DELETE_BLOCKER];

/** What stops a permanent delete, each with where to fix it. */
export interface DeleteBlocker {
  kind: DeleteBlockerKind;
  count: number;
  message: string;
}

/** GET /people/employees/:id/delete-check */
export interface DeletePersonCheck {
  employeeId: string;
  fullName: string;
  /**
   * True when past work names them (tasks, filings, sign-offs, time…): the
   * record stays as "Name (former employee)" and only their personal data goes.
   * False: the record and login are removed outright.
   */
  hasHistory: boolean;
  blockers: DeleteBlocker[];
}

/** DELETE /people/employees/:id */
export interface DeletePersonInput {
  /** Their full name, typed to confirm. */
  confirmName: string;
  reason?: string;
}
export interface DeletePersonResult {
  employeeId: string;
  /** 'removed': no history, gone outright. 'erased': kept as a former employee. */
  outcome: 'removed' | 'erased';
}

/** How a deleted person's name reads wherever past work shows it. */
export const FORMER_EMPLOYEE_SUFFIX = ' (former employee)';
