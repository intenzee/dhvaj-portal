import { ForbiddenException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  PLANNING_ACTOR_ROLE_LABEL,
  type AreaPermissionLevel,
  type AreaReviewAccess,
  type AreaReviewCapabilities,
} from '@hsdg/contracts';
import { resolvePlanningActor } from './planning-governance';

const NONE: AreaReviewCapabilities = {
  prepare: false,
  complete: false,
  respond: false,
  manageGrants: false,
  partnerReview: false,
  requestArea: false,
};

const MANAGER: AreaReviewCapabilities = {
  prepare: true,
  complete: true,
  respond: true,
  manageGrants: true,
  partnerReview: false,
  requestArea: true,
};

/**
 * DHVAJ 03.5 §27 role matrix. The Engagement Manager (or the EP acting as
 * Manager when none is assigned) prepares and completes; the EP views,
 * comments, challenges and requests reassessment; a Senior / Article prepares
 * only with an explicit grant and completes only with a Manager-equivalent
 * grant; any team member may ask for a missing area from the risk assessment.
 * Oversight leads (e.g. a Platform Admin on the file) get no automatic access.
 */
export function areaCapabilities(
  role: AreaReviewAccess['role'],
  actingAsManager: boolean,
  grant: AreaPermissionLevel | null,
): AreaReviewCapabilities {
  switch (role) {
    case 'manager':
      return MANAGER;
    case 'partner':
      return actingAsManager
        ? { ...MANAGER, partnerReview: true }
        : { ...NONE, partnerReview: true, requestArea: true };
    case 'team':
      if (grant === 'manager_equivalent') return { ...MANAGER, manageGrants: false };
      if (grant === 'prepare') return { ...NONE, prepare: true, requestArea: true };
      return { ...NONE, requestArea: true };
    default:
      return NONE;
  }
}

/** The acting user's 03.5 access on an engagement (one round trip beyond the planning actor). */
export async function resolveAreaAccess(
  client: PoolClient,
  engagementId: string,
): Promise<AreaReviewAccess> {
  const actor = await resolvePlanningActor(client, engagementId);
  let grant: AreaPermissionLevel | null = null;
  if (actor.role === 'team' && actor.employeeId) {
    const { rows } = await client.query<{ level: AreaPermissionLevel }>(
      `SELECT level FROM hsdg.audit_area_review_permission
        WHERE engagement_id = $1 AND employee_id = $2`,
      [engagementId, actor.employeeId],
    );
    grant = rows[0]?.level ?? null;
  }
  const label = PLANNING_ACTOR_ROLE_LABEL[actor.role];
  return {
    role: actor.role,
    roleLabel: actor.actingAsManager
      ? `${label} (acting as Manager)`
      : grant
        ? `${label} — ${grant === 'manager_equivalent' ? 'Manager-equivalent' : 'may prepare'} 03.5`
        : label,
    actingAsManager: actor.actingAsManager,
    employeeId: actor.employeeId,
    grant,
    capabilities: areaCapabilities(actor.role, actor.actingAsManager, grant),
  };
}

const DENIED: Record<keyof AreaReviewCapabilities, string> = {
  prepare:
    'Only the Engagement Manager — or a Senior / Article the Manager has authorised — prepares 03.5.',
  complete:
    'Completing, reopening and refreshing 03.5 needs the Engagement Manager or a Manager-equivalent authorisation.',
  respond:
    'Answering review points needs the Engagement Manager or a Manager-equivalent authorisation.',
  manageGrants: 'Only the Engagement Manager authorises Seniors / Articles on 03.5.',
  partnerReview: 'Challenges and reassessment requests are raised by the Engagement Partner.',
  requestArea: 'Only the engagement team may ask 03.5 for an area.',
};

export function assertAreaCapability(
  access: AreaReviewAccess,
  capability: keyof AreaReviewCapabilities,
): void {
  if (!access.capabilities[capability]) {
    throw new ForbiddenException(`${DENIED[capability]} (You are: ${access.roleLabel}.)`);
  }
}
