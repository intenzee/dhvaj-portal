import { ROLE, type FirmChecks } from '@hsdg/contracts';
import { hasRole } from './principal';
import type { EngagementDetail, TeamMember } from './types';
import type { TaskActionContext } from './work-types';

type Principal = Parameters<typeof hasRole>[0];

/**
 * Who may move the engagement's tasks: me, whether I lead it (EP / manager /
 * MP), and the firm's checks that decide how much that matters.
 */
export function taskContextFor(
  principal: Principal,
  e: Partial<Pick<EngagementDetail, 'engagementPartnerId' | 'engagementManagerId'>>,
  checks?: FirmChecks,
): TaskActionContext {
  const me = principal?.employeeId ?? null;
  return {
    me,
    checks,
    isLead:
      hasRole(principal, ROLE.managingPartner) ||
      (!!me && (me === e.engagementPartnerId || me === e.engagementManagerId)),
  };
}

/**
 * The engagement team plus the EP and Manager (held on the engagement itself,
 * not in `team`), so planning owners and discussion participants can include them.
 */
export function planningTeam(e: EngagementDetail): TeamMember[] {
  const leads: TeamMember[] = [];
  if (e.engagementPartnerId && e.engagementPartnerName) {
    leads.push({
      id: `ep-${e.engagementPartnerId}`,
      employeeId: e.engagementPartnerId,
      employeeCode: '',
      employeeName: e.engagementPartnerName,
      roleOnEngagement: 'engagement_partner',
    });
  }
  if (e.engagementManagerId && e.engagementManagerName) {
    leads.push({
      id: `em-${e.engagementManagerId}`,
      employeeId: e.engagementManagerId,
      employeeCode: '',
      employeeName: e.engagementManagerName,
      roleOnEngagement: 'engagement_manager',
    });
  }
  const seen = new Set(leads.map((m) => m.employeeId));
  return [...leads, ...e.team.filter((m) => !seen.has(m.employeeId))];
}
