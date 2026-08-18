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

/** Permission slugs. Must match the `permissions.slug` seed in migration 0002. */
export const PERMISSION = {
  userRead: 'user.read',
  userReadAll: 'user.read.all',
  userManage: 'user.manage',
  officeRead: 'office.read',
  auditRead: 'audit.read',
} as const;

export type PermissionSlug = (typeof PERMISSION)[keyof typeof PERMISSION];
