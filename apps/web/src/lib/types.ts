/**
 * View-model types for the fields the portal renders. These mirror the API JSON
 * responses (the backend types are internal to the API service); the portal only
 * declares the subset it displays.
 */
import type {
  BillingModel,
  ClientVerdict,
  MergedInto,
  EntityTypeSource,
  ClientBranch,
  ClientDependencyStatus,
  ComplianceStatus,
  EngagementConfidentiality,
  EngagementCoveredEntity,
  EngagementKind,
  EngagementPriority,
  EngagementServiceLine,
  EngagementStatus,
  EngagementType,
  RoleSlug,
  EmploymentStatus,
  Stream,
  TaskPriority,
  TaskStatus,
  WorkItemRef,
} from '@hsdg/contracts';

import type { PeriodSection, WorkFilingContext } from '@hsdg/contracts';

export interface EngagementRow {
  id: string;
  engagementCode: string;
  kind: EngagementKind;
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
  /** WF-102 — the engagement's kind and the filing the task produces (nulls with no filing). */
  engagementKind?: EngagementKind;
  section?: PeriodSection | null;
  financialYear?: string | null;
  /** Raw period key: '2026-09', '2026-27:Q2', '2026-27'. */
  periodKey?: string | null;
  registrationNumber?: string | null;
  /** Form, period label and both dates of the task's filing; null with no filing. */
  filing?: WorkFilingContext | null;
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
  /** The stream of the task's engagement service (gst, …); null otherwise. */
  stream?: string | null;
  /** Where the row opens (Staff Workflow WF-102); absent from older APIs. */
  link?: WorkItemRef | null;
}

export interface MyClientDependency {
  id: string;
  engagementId: string;
  /** WF-102 — the filing (and upload slot) the request is for, when it is for one. */
  engagementKind?: EngagementKind;
  complianceInstanceId?: string | null;
  periodSection?: PeriodSection | null;
  slotCode?: string | null;
  requestedInfo: string;
  status: ClientDependencyStatus;
  escalationDate: string | null;
  isOverdue: boolean;
  isOpen: boolean;
  version: number;
  engagementCode: string;
  entityName: string;
  /** Where the row opens (Staff Workflow WF-102); absent from older APIs. */
  link?: WorkItemRef | null;
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
  branchCount?: number;
  legalStatus?: string | null;
  regulatoryProfileStatus?: string;
  listingStatus?: string;
  clientId?: string | null;
  /** What the client's master still lacks (the list's marker, the client page's card). */
  missingInfo: MissingInfoItem[];
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
  /** The API's reading of the two names and identifiers; `different` still listed when the PAN or name matched. */
  verdict: ClientVerdict;
  reasons: string[];
}

export interface Registration {
  id: string;
  registrationType: string;
  registrationNumber: string;
  status: string;
  stateCode?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  jurisdiction?: string | null;
  registrationDate?: string | null;
  issuingAuthority?: string | null;
  source?: string;
  isPrincipal?: boolean;
  applicability?: string;
  verified?: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  documentRef?: string | null;
  branchId?: string | null;
}
export interface Contact {
  id: string;
  fullName: string;
  designation: string | null;
  email: string | null;
  phone?: string | null;
  isPrimary: boolean;
  isSignatory: boolean;
  department?: string | null;
  contactType?: string | null;
  isPortalUser?: boolean;
  portalRole?: string | null;
  branchId?: string | null;
}
export interface FinancialProfile {
  id: string;
  financialYear: string;
  turnover: number | null;
  revenue?: number | null;
  otherIncome?: number | null;
  netWorth: number | null;
  netProfit: number | null;
  profitBeforeTax?: number | null;
  reservesSurplus?: number | null;
  totalAssets?: number | null;
  totalBorrowings: number | null;
  bankPfiBorrowings?: number | null;
  publicDeposits?: number | null;
  debentures?: number | null;
  outstandingLoans?: number | null;
  paidUpCapital: number | null;
  source: string;
  verified: boolean;
  isCurrent: boolean;
  supersedesId: string | null;
  createdAt: string;
}
export interface Address {
  id: string;
  addressType: string;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  isPrimary: boolean;
  branchId?: string | null;
}
export interface EntityRelationship {
  id: string;
  toEntityId: string;
  toEntityLegalName: string;
  toEntityCode: string;
  relationshipType: string;
  shareholdingPct: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
  notes: string | null;
}
export interface BusinessActivity {
  id: string;
  industryId: string;
  industrySlug: string;
  industryName: string;
  nicCodeId: string | null;
  nicCode: string | null;
  isPrimary: boolean;
  notes: string | null;
}
export interface Listing {
  id: string;
  exchange: string;
  securityType: string;
  listingDate: string | null;
  status: string;
  symbol: string | null;
  notes: string | null;
}
export interface RegulatoryAttribute {
  id: string;
  attributeCode: string;
  attributeName: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  effectiveFrom: string | null;
  source: string;
  notes: string | null;
}
export interface MissingInfoItem {
  code: string;
  label: string;
  severity: 'required' | 'recommended';
}
export interface EntityDetail extends EntityRow {
  /** Set once this client was merged into another and archived. */
  mergedInto: MergedInto | null;
  displayName: string | null;
  tradeName: string | null;
  shortName: string | null;
  typeSlug: string;
  typeCategory: string;
  officeCode: string;
  countryOfIncorporation: string;
  currentAccountingFramework: string;
  incorporationDate: string | null;
  roc: string | null;
  authorisedCapital: number | null;
  paidUpCapital: number | null;
  llpContribution: number | null;
  businessDescription: string | null;
  groupId: string | null;
  parentEntityId: string | null;
  version: number;
  activities: {
    manufacturing: boolean;
    trading: boolean;
    services: boolean;
    import: boolean;
    export: boolean;
    ecommerce: boolean;
    regulated: boolean;
  };
  registrations: Registration[];
  contacts: Contact[];
  financialProfiles: FinancialProfile[];
  addresses: Address[];
  relationships: EntityRelationship[];
  businessActivities: BusinessActivity[];
  listings: Listing[];
  regulatoryAttributes: RegulatoryAttribute[];
  /** Where the firm type came from (CM-3), and who set it by hand and when. */
  entityTypeSource: EntityTypeSource;
  entityTypeSetBy: string | null;
  entityTypeSetAt: string | null;
  /** Offices (CM-6): live first, head office first. */
  branches: ClientBranch[];
}

export interface Industry {
  id: string;
  slug: string;
  name: string;
  sector: string | null;
}

export interface ClientRow {
  id: string;
  clientCode: string;
  name: string;
  shortName: string | null;
  clientKind: string;
  status: string;
  officeCode: string;
  groupId: string | null;
  entityCount: number;
  version: number;
}
export interface ClientDetail extends ClientRow {
  entities: { id: string; entityCode: string; legalName: string }[];
}

export interface ComplianceRow {
  id: string;
  engagementId: string;
  /** WF-102 — the filing's place in its stream tab. */
  engagementKind?: EngagementKind;
  stream?: Stream | null;
  financialYear?: string | null;
  periodKey?: string | null;
  section?: PeriodSection | null;
  registrationNumber?: string | null;
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
  /** Escalation band (§24): none | upcoming | due_soon | due_today | overdue | critical. */
  escalation: string;
  /** The distinct §24 action this band triggers (notify_owner, escalate_partner, …). */
  escalationAction: string;
  /** Where the row opens (Staff Workflow WF-102); absent from older APIs. */
  link?: WorkItemRef | null;
}

/**
 * One flattened compliance calendar EVENT (§16/§22) — an obligation fanned out
 * into its statutory event, internal-SLA event, or a deadline-layer milestone.
 */
export interface ComplianceEventRow {
  eventId: string;
  kind: 'statutory' | 'internal_sla' | 'layer';
  complianceInstanceId: string;
  layerType: string | null;
  engagementId: string;
  engagementCode: string;
  entityName: string;
  serviceCode: string;
  complianceRuleCode: string;
  complianceRuleName: string;
  label: string;
  dueDateCategory: string;
  dueDateSource: string | null;
  dueDate: string;
  ownerName: string | null;
  status: ComplianceStatus;
  isOverdue: boolean;
  isExtended: boolean;
  escalation: string;
  escalationAction: string;
  /** Where the row opens (Staff Workflow WF-102); absent from older APIs. */
  link?: WorkItemRef | null;
}

/**
 * An event-triggered rule on the engagement's service that needs an explicit
 * event date to generate (appeal/allotment/incorporation limitations, §7/§8/§11).
 */
export interface EventRuleOption {
  code: string;
  name: string;
  dueDateCategory: string;
  dueDateSource: string | null;
  /** Days added to the event date (the limitation period). */
  offsetDays: number;
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
  objectType: string | null;
  objectId: string | null;
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

/** GET /employees/leads — who can be Engagement Partner / Manager, any office. */
export interface EngagementLeadRow {
  id: string;
  fullName: string;
  gradeSlug: string;
  gradeName: string;
  isPartner: boolean;
  officeCode: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  taskId: string | null;
  componentInstanceId: string | null;
  documentType: string;
  classification: string;
  status: string;
  currentVersionNo: number;
  currentFilename: string | null;
  currentContentType: string | null;
  currentSizeBytes: number | null;
  createdByName: string | null;
  deletedAt: string | null;
  /** Approved work (e.g. a final Section 01 file): opens read-only until reopened. */
  editLocked?: boolean;
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
  /** Where the document's work lives (WF-103): its filing's part and task, else the engagement. */
  link?: WorkItemRef | null;
}

export interface ServiceRow {
  id: string;
  code: string;
  name: string;
  serviceLineName: string;
  requiredReviewModelSlug: string;
  isActive: boolean;
  /** Compliance stream (spec Change 2); null outside the six streams. */
  stream?: Stream | null;
  /** The STREAM_* service a folded service was replaced by. */
  foldedIntoServiceId?: string | null;
  engagementKind?: EngagementKind;
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

/** An employee record as Administration → People edits it. */
export interface AdminEmployeeRow extends EmployeeRow {
  userId: string | null;
  userEmail: string | null;
  isPartner: boolean;
  employmentStatus: EmploymentStatus;
  dateOfJoining: string;
  dateOfExit: string | null;
  membershipNo: string | null;
  partnerSince: string | null;
  version: number;
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
