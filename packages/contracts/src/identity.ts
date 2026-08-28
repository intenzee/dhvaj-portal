/**
 * Identity vocabulary shared by the API and (later) the web portal, so role and
 * permission names are defined exactly once.
 */

/** Assignable role slugs. Must match the `roles.slug` seed in migration 0002. */
export const ROLE = {
  managingPartner: 'managing_partner',
  admin: 'admin',
  partner: 'partner',
  manager: 'manager',
  senior: 'senior',
  article: 'article',
} as const;

export type RoleSlug = (typeof ROLE)[keyof typeof ROLE];

/**
 * The roles an administrator may assign to a user, highest authority first.
 * Every value is a real `roles.slug`; the reserved {@link SYSTEM_ROLE} is
 * deliberately absent and can never be assigned.
 */
export const ASSIGNABLE_ROLES: RoleSlug[] = [
  ROLE.managingPartner,
  ROLE.admin,
  ROLE.partner,
  ROLE.manager,
  ROLE.senior,
  ROLE.article,
];

/**
 * Precedence, highest first. The "effective role" placed into the database
 * security context (hsdg.role) is the highest-precedence role a user holds —
 * this is what RLS policies test for firm-wide vs office-scoped access.
 */
export const ROLE_PRECEDENCE: RoleSlug[] = [
  ROLE.managingPartner,
  ROLE.admin,
  ROLE.partner,
  ROLE.manager,
  ROLE.senior,
  ROLE.article,
];

/**
 * Reserved, non-assignable context role used only by the authentication
 * bootstrap to resolve a principal before a real context exists. It is never a
 * row in `roles` and can never be assigned to a user.
 */
export const SYSTEM_ROLE = 'system' as const;

/**
 * Permission slugs. Must match the `permissions.slug` rows in the database.
 *
 * Note: firm-wide vs office-scoped visibility is decided by RLS from the user's
 * effective ROLE, not by a permission — so there is intentionally no
 * "read everything" permission here.
 */
export const PERMISSION = {
  userRead: 'user.read',
  userManage: 'user.manage',
  officeRead: 'office.read',
  officeManage: 'office.manage',
  auditRead: 'audit.read',
  reportRead: 'report.read',
  employeeRead: 'employee.read',
  employeeManage: 'employee.manage',
  entityRead: 'entity.read',
  entityManage: 'entity.manage',
  serviceRead: 'service.read',
  serviceManage: 'service.manage',
  serviceManageOther: 'service.manage_other',
  engagementRead: 'engagement.read',
  engagementManage: 'engagement.manage',
  complianceRead: 'compliance.read',
  complianceManage: 'compliance.manage',
  taskUpdate: 'task.update',
  notificationRead: 'notification.read',
  notificationScan: 'notification.scan',
} as const;

export type PermissionSlug = (typeof PERMISSION)[keyof typeof PERMISSION];

/** Employee grades (HR/professional). Distinct from security {@link ROLE}s. */
export const GRADE = {
  partner: 'partner',
  manager: 'manager',
  senior: 'senior',
  article: 'article',
} as const;

export type GradeSlug = (typeof GRADE)[keyof typeof GRADE];

/** Employment status lifecycle values. */
export const EMPLOYMENT_STATUS = {
  active: 'active',
  onLeave: 'on_leave',
  noticePeriod: 'notice_period',
  exited: 'exited',
} as const;

export type EmploymentStatus = (typeof EMPLOYMENT_STATUS)[keyof typeof EMPLOYMENT_STATUS];

export const EMPLOYMENT_STATUSES: EmploymentStatus[] = Object.values(EMPLOYMENT_STATUS);
