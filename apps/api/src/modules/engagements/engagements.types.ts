import type { EngagementStatus, TeamRole } from '@hsdg/contracts';

export interface EngagementSummary {
  id: string;
  engagementCode: string;
  entityId: string;
  entityCode: string;
  entityName: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  financialYear: string;
  periodLabel: string;
  officeId: string;
  officeCode: string;
  status: EngagementStatus;
  engagementPartnerId: string | null;
  engagementPartnerName: string | null;
  engagementManagerId: string | null;
  engagementManagerName: string | null;
  predecessorEngagementId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  acceptedAt: string | null;
  teamCount: number;
  version: number;
}

export interface EngagementTeamMember {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  roleOnEngagement: TeamRole;
  assignedAt: string;
}

export interface EngagementDetail extends EngagementSummary {
  team: EngagementTeamMember[];
}

export interface EngagementFilter {
  status?: EngagementStatus;
  entityId?: string;
  serviceCode?: string;
  officeCode?: string;
  /** Limit to engagements the caller is personally assigned to. */
  mine?: boolean;
}

export interface CreateEngagementInput {
  entityId: string;
  serviceId: string;
  financialYear: string;
  periodLabel?: string;
  officeCode?: string;
  engagementPartnerEmployeeId?: string;
  engagementManagerEmployeeId?: string;
  status?: EngagementStatus;
  plannedStartDate?: string;
  plannedEndDate?: string;
  predecessorEngagementId?: string;
}

export interface UpdateEngagementInput {
  status?: EngagementStatus;
  engagementManagerEmployeeId?: string | null;
  officeCode?: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  version?: number;
}

export interface AssignTeamMemberInput {
  employeeId: string;
  roleOnEngagement?: TeamRole;
}
