import type { PermissionSlug, RoleSlug } from '@hsdg/contracts';

/** The authenticated principal, as returned by `GET /auth/me`. */
export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  officeId: string;
  officeCode: string;
  employeeId: string | null;
  roles: RoleSlug[];
  effectiveRole: RoleSlug | undefined;
  permissions: PermissionSlug[];
  mfaRequired: boolean;
  mfaSatisfied: boolean;
}

/** Does the principal hold the given permission? */
export function can(principal: Principal | null, permission: PermissionSlug): boolean {
  return !!principal && principal.permissions.includes(permission);
}

/** Is the principal any of the given roles (by effective role or held roles)? */
export function hasRole(principal: Principal | null, ...roles: RoleSlug[]): boolean {
  if (!principal) return false;
  return roles.some((r) => principal.effectiveRole === r || principal.roles.includes(r));
}

const ROLE_LABELS: Record<RoleSlug, string> = {
  managing_partner: 'Managing Partner',
  admin: 'Administrator',
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article: 'Article',
};

export function roleLabel(role: RoleSlug | undefined): string {
  return role ? ROLE_LABELS[role] : 'No role';
}
