/**
 * View-model types for the fields the portal renders. These mirror the API JSON
 * responses (the backend types are internal to the API service); the portal only
 * declares the subset it displays.
 */
import type {
  BillingModel,
  ClientDependencyStatus,
  ComplianceStatus,
  EngagementConfidentiality,
  EngagementCoveredEntity,
  EngagementPriority,
  EngagementServiceLine,
  EngagementStatus,
  EngagementType,
  RoleSlug,
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
  /** Every service line the engagement carries (multi-service, §9–§10). */
  services: EngagementServiceLine[];
  /** Every entity the engagement covers (multi-entity / group, §30). */
  coveredEntities: EngagementCoveredEntity[];
  signedOffByName: string | null;
  clientOverdueCount: number;
  openTaskCount: number;
  // ── Type & commercial/governance fields (§3/§7) ─────────────────────────
  engagementType: EngagementType;
  priority: EngagementPriority;
  confidentiality: EngagementConfidentiality;
  currency: string;
  billingModel: BillingModel | null;
  mandateLetterReference: string | null;
  mandateLetterDate: string | null;
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

export interface EntityType {
  id: string;
  slug: string;
  name: string;
  category: string;
}

export interface DuplicateCandidate {
  id: string;
  entityCode: string;
  legalName: string;
  pan: string | null;
  score: number;
  matchReason: 'pan' | 'name';
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
  displayName: string | null;
  typeSlug: string;
  officeCode: string;
  incorporationDate: string | null;
  version: number;
  registrations: Registration[];
  contacts: Contact[];
}

export interface ComplianceRow {
  id: string;
  engagementId: string;
  engagementCode: string;
  entityName: string;
  serviceCode: string;
  complianceRuleId: string;
  complianceRuleCode: string;
  complianceRuleName: string;
  /** Frozen due-date category (§2) — how the deadline is generated. */
  dueDateCategory: string;
  /** Due-date source (§3) — where the deadline's authority comes from. */
  dueDateSource: string | null;
  statutoryDeadline: string;
  effectiveStatutoryDeadline: string;
  /** Government-notified revised operative date (§19 overlay), if applied. */
  revisedStatutoryDeadline: string | null;
  effectiveInternalSlaDate: string;
  status: ComplianceStatus;
  isStatutoryOverdue: boolean;
  isInternallyOverdue: boolean;
  /** True when a government extension overlay is applied (§24 "Extended"). */
  isExtended: boolean;
}

/** One additional deadline layer on an obligation (§16). */
export interface ComplianceDeadlineLayer {
  id: string;
  layerType: string;
  label: string;
  dueDateCategory: string;
  dueDate: string;
  ownerName: string | null;
  status: ComplianceStatus;
  isOverdue: boolean;
  version: number;
}

/** An obligation with its override history and deadline layers (detail view). */
export interface ComplianceInstanceDetail {
  id: string;
  complianceRuleName: string;
  effectiveStatutoryDeadline: string;
  effectiveInternalSlaDate: string;
  status: ComplianceStatus;
  isExtended: boolean;
  deadlines: ComplianceDeadlineLayer[];
}

/** One flattened calendar event (§16): statutory / internal-SLA / layer. */
export interface ComplianceEvent {
  eventId: string;
  kind: 'statutory' | 'internal_sla' | 'layer';
  complianceInstanceId: string;
  layerType: string | null;
  engagementCode: string;
  entityName: string;
  complianceRuleName: string;
  label: string;
  dueDateCategory: string;
  dueDate: string;
  status: ComplianceStatus;
  isOverdue: boolean;
}

// ── Compliance configuration (Phase 8 admin) ────────────────────────────────

export interface ComplianceRuleVersion {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  calculationBasis: string;
  offsetMonths: number;
  offsetDays: number;
  fixedMonth: number | null;
  fixedDay: number | null;
  workingDayAdjustment: string;
  internalSlaOffsetDays: number;
  condition: unknown | null;
  notes: string | null;
  createdAt: string;
}

export interface ComplianceRule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  serviceId: string | null;
  serviceCode: string | null;
  category: string;
  /** Frozen due-date category (§2) — how the deadline is generated. */
  dueDateCategory: string;
  /** Due-date source (§3) — where the deadline's authority comes from. */
  dueDateSource: string | null;
  isActive: boolean;
  version: number;
  versions: ComplianceRuleVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface Holiday {
  id: string;
  holidayDate: string;
  name: string;
}

/** A government extension (§19) — a firm-wide overlay on a statutory rule's date. */
export interface GovernmentExtension {
  id: string;
  complianceRuleId: string;
  complianceRuleCode: string;
  complianceRuleName: string;
  originalDueDate: string;
  revisedDueDate: string;
  notificationReference: string;
  applicablePopulation: string;
  effectiveDate: string;
  notes: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  engagementId: string | null;
  status: string;
  readAt: string | null;
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

/** A document in the cross-engagement view (adds engagement/client context). */
export interface GlobalDocumentRow extends DocumentRow {
  engagementId: string;
  engagementCode: string;
  entityName: string | null;
  currentSizeBytes: number | null;
  createdAt: string;
}

export interface ServiceRow {
  id: string;
  code: string;
  name: string;
  serviceLineName: string;
  requiredReviewModelSlug: string;
  isActive: boolean;
}

// ── Administration (Phase 13) ───────────────────────────────────────────────

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  officeId: string;
  officeCode: string;
  isActive: boolean;
  roles: RoleSlug[];
}

export interface OfficeRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface RoleRow {
  id: string;
  slug: RoleSlug;
  name: string;
  description: string | null;
}
