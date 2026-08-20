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
  engagementPartnerId: string | null;
  engagementPartnerName: string | null;
  engagementManagerId: string | null;
  engagementManagerName: string | null;
  plannedEndDate: string | null;
  isSignedOff: boolean;
  openReviewPointCount: number;
  isWaitingForClient: boolean;
  internallyOverdueTaskCount: number;
  effectiveReviewModel: { slug: string; name: string; requiresEpSignoff: boolean };
  version: number;
}

/** The caller's role on an engagement, for "My Engagements — At a Glance". */
export function myEngagementRole(e: EngagementRow, employeeId: string | null): string {
  if (!employeeId) return 'Member';
  if (e.engagementPartnerId === employeeId) return 'EP';
  if (e.engagementManagerId === employeeId) return 'Manager';
  return 'Member';
}

export interface TeamMember {
  id: string;
  employeeId: string;
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
  engagementId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  isOverdue: boolean;
  blockedByOpenCount: number;
  assignedToName?: string | null;
  version: number;
  engagementCode: string;
  entityName: string;
}

export interface MyClientDependency {
  id: string;
  engagementId: string;
  requestedInfo: string;
  status: ClientDependencyStatus;
  escalationDate: string | null;
  isOverdue: boolean;
  isOpen: boolean;
  version: number;
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

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  gradeSlug: string;
  gradeName: string;
  officeCode: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  documentType: string;
  classification: string;
  status: string;
  currentVersionNo: number;
  currentFilename: string | null;
  createdByName: string | null;
  version: number;
  updatedAt: string;
}

export interface ServiceRow {
  id: string;
  code: string;
  name: string;
  serviceLineName: string;
  requiredReviewModelSlug: string;
  isActive: boolean;
}
