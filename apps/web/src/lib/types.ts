/**
 * View-model types for the fields the portal renders. These mirror the API JSON
 * responses (the backend types are internal to the API service); the portal only
 * declares the subset it displays.
 */
import type {
  ClientDependencyStatus,
  ComplianceStatus,
  EngagementStatus,
  TaskPriority,
  TaskStatus,
} from '@hsdg/contracts';

export interface EngagementRow {
  id: string;
  engagementCode: string;
  entityId: string;
  entityName: string;
  serviceCode: string;
  serviceName: string;
  financialYear: string;
  periodLabel: string;
  status: EngagementStatus;
  engagementPartnerName: string | null;
  engagementManagerName: string | null;
  isSignedOff: boolean;
  openReviewPointCount: number;
  isWaitingForClient: boolean;
  internallyOverdueTaskCount: number;
  effectiveReviewModel: { slug: string; name: string; requiresEpSignoff: boolean };
}

export interface TeamMember {
  id: string;
  employeeCode: string;
  employeeName: string;
  roleOnEngagement: string;
}

export interface EngagementDetail extends EngagementRow {
  officeCode: string;
  team: TeamMember[];
  signedOffByName: string | null;
  clientOverdueCount: number;
  openTaskCount: number;
}

export interface MyTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  isOverdue: boolean;
  engagementCode: string;
  entityName: string;
}

export interface MyClientDependency {
  id: string;
  requestedInfo: string;
  status: ClientDependencyStatus;
  escalationDate: string | null;
  isOverdue: boolean;
  engagementCode: string;
  entityName: string;
}

export interface EntityRow {
  id: string;
  entityCode: string;
  legalName: string;
  typeName: string;
  status: string;
  pan: string | null;
  primaryContactName: string | null;
  registrationCount: number;
}

export interface Registration {
  id: string;
  registrationType: string;
  registrationNumber: string;
  status?: string;
}
export interface Contact {
  id: string;
  fullName: string;
  designation: string | null;
  email: string | null;
  isPrimary: boolean;
  isSignatory: boolean;
}
export interface EntityDetail extends EntityRow {
  registrations: Registration[];
  contacts: Contact[];
}

export interface ComplianceRow {
  id: string;
  engagementId: string;
  engagementCode: string;
  entityName: string;
  serviceCode: string;
  complianceRuleName: string;
  effectiveStatutoryDeadline: string;
  effectiveInternalSlaDate: string;
  status: ComplianceStatus;
  isStatutoryOverdue: boolean;
  isInternallyOverdue: boolean;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  status: string;
  createdAt: string;
}
