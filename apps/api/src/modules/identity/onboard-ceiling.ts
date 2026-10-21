import { ForbiddenException } from '@nestjs/common';
import { ONBOARD_ASSIGNABLE_ROLES, PERMISSION, type RoleSlug } from '@hsdg/contracts';
import type { Principal } from '../auth/principal';

/**
 * The limit on what HR may do to logins (spec §4.5, §7.5). `undefined` means no
 * limit — the caller holds `user.manage` (Administrator, Managing Partner).
 * The database holds the same rule (hsdg.ctx_may_onboard_user); this copy
 * gives a clear message instead of a silent no-op.
 */
export interface OnboardCeiling {
  actorUserId: string;
}

const assignable = new Set<RoleSlug>(ONBOARD_ASSIGNABLE_ROLES);

export function onboardCeiling(principal: Principal): OnboardCeiling | undefined {
  if (principal.permissions.includes(PERMISSION.userManage)) return undefined;
  if (principal.permissions.includes(PERMISSION.userOnboard)) {
    return { actorUserId: principal.userId };
  }
  throw new ForbiddenException('Requires one of: user.manage, user.onboard.');
}

/** Roles HR is giving: only Article, Senior or Manager. */
export function assertAssignable(ceiling: OnboardCeiling | undefined, roles: readonly RoleSlug[]) {
  if (!ceiling) return;
  if (roles.some((r) => !assignable.has(r))) {
    throw new ForbiddenException('HR can give Article, Senior or Manager only.');
  }
}

/** The user HR is changing: someone else, holding nothing above Manager. */
export function assertOnboardable(
  ceiling: OnboardCeiling | undefined,
  target: { id: string; roles: readonly string[] },
) {
  if (!ceiling) return;
  if (target.id === ceiling.actorUserId) {
    throw new ForbiddenException('You cannot change your own access.');
  }
  if (target.roles.some((r) => !assignable.has(r as RoleSlug))) {
    throw new ForbiddenException('This person holds a role above Manager; ask an administrator.');
  }
}
