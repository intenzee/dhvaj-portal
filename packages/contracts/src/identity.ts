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
  /** The firm's accounts executive: billing and collections, no client work. */
  accountant: 'accountant',
  /** People operations: employee master, logins up to Manager, payroll. */
  hr: 'hr',
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
  ROLE.accountant,
  ROLE.hr,
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
  // The desk roles sit below every professional role, so a Manager + HR still
  // acts as a Manager on client work; what they add reaches RLS through
  // hsdg.roles (every role held), not hsdg.role.
  ROLE.accountant,
  ROLE.hr,
];

/**
 * Roles HR may give with `user.onboard` (spec §4.5). Anyone holding a role
 * outside this list is managed by an administrator only.
 */
export const ONBOARD_ASSIGNABLE_ROLES: RoleSlug[] = [ROLE.article, ROLE.senior, ROLE.manager];

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
  /** Create an engagement — every staff role. Running it stays with engagement.manage. */
  engagementCreate: 'engagement.create',
  engagementManage: 'engagement.manage',
  complianceRead: 'compliance.read',
  complianceManage: 'compliance.manage',
  taskUpdate: 'task.update',
  notificationRead: 'notification.read',
  notificationScan: 'notification.scan',
  workflowManage: 'workflow.manage',
  /** ADR-0035: show a client's saved portal login. */
  credentialReveal: 'credential.reveal',
  /** ADR-0035: add, change, remove or import clients' portal logins. */
  credentialManage: 'credential.manage',
  /** PS-101: record notices, their replies, hearings and orders, and close them. */
  noticeManage: 'notice.manage',
  /** PS-201: draft, issue and chase the firm's invoices; record receipts. */
  billingManage: 'billing.manage',
  /** PS-201: void an issued invoice; approve credit notes and write-offs. */
  billingApprove: 'billing.approve',
  /** Agree a fee with a client: add or cancel fee milestones (split from billing.manage). */
  feeAgree: 'fee.agree',
  /** A client's billing profile only (name, PAN, GSTIN, address, billing contact). */
  entityReadBilling: 'entity.read_billing',
  /** An engagement's header, fee schedule and billable hours — not its work. */
  engagementReadCommercial: 'engagement.read_commercial',
  /** Create logins, set passwords and deactivate — only for ONBOARD_ASSIGNABLE_ROLES. */
  userOnboard: 'user.onboard',
  /** Workload and hours reports, without client or engagement names. */
  reportReadPeople: 'report.read_people',
  /** Per-person daily hours by kind, without client or engagement names. */
  timeReadAttendance: 'time.read_attendance',
  /** Salary structures (proposed), monthly runs, bank file, payslips, statutory working. */
  payrollPrepare: 'payroll.prepare',
  /** Everyone's pay, payslips, registers and bank/statutory IDs. */
  payrollRead: 'payroll.read',
  /** Approve a payroll run, a salary revision or a full and final. */
  payrollApprove: 'payroll.approve',
  /** Paid runs' totals by head, for the books — never a person's line. */
  payrollReadSummary: 'payroll.read_summary',
  /** One's own payslips, structure, tax and bank-change requests. */
  payrollReadOwn: 'payroll.read_own',
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
