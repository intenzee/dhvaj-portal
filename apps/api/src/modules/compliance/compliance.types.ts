import type {
  CalculationBasis,
  ComplianceCategory,
  ComplianceClock,
  ComplianceStatus,
  DueDateCategory,
  DueDateSource,
  WorkingDayAdjustment,
} from '@hsdg/contracts';

/** One effective-dated, append-only calculation snapshot for a rule. */
export interface ComplianceRuleVersionRecord {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  calculationBasis: CalculationBasis;
  offsetMonths: number;
  offsetDays: number;
  fixedMonth: number | null;
  fixedDay: number | null;
  workingDayAdjustment: WorkingDayAdjustment;
  internalSlaOffsetDays: number;
  condition: unknown | null;
  notes: string | null;
  createdAt: string;
}

/** A compliance rule with its version history. */
export interface ComplianceRuleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  serviceId: string | null;
  serviceCode: string | null;
  category: ComplianceCategory;
  /** Frozen due-date CATEGORY (§2) — how the deadline is generated. */
  dueDateCategory: DueDateCategory;
  /** Due-date SOURCE (§3) — where the deadline's authority comes from (optional). */
  dueDateSource: DueDateSource | null;
  isActive: boolean;
  version: number;
  versions: ComplianceRuleVersionRecord[];
  createdAt: string;
  updatedAt: string;
}

/** A per-engagement compliance obligation (a snapshot of the rule version used). */
export interface ComplianceInstanceRecord {
  id: string;
  engagementId: string;
  complianceRuleId: string;
  complianceRuleCode: string;
  complianceRuleName: string;
  complianceRuleVersionId: string;
  complianceRuleVersion: number;
  /** Frozen due-date CATEGORY of the governing rule (§2). */
  dueDateCategory: DueDateCategory;
  /** Due-date SOURCE of the governing rule (§3), if declared. */
  dueDateSource: DueDateSource | null;
  referenceDate: string;
  /** Computed snapshot from the rule version (immutable) — the ORIGINAL statutory date. */
  statutoryDeadline: string;
  statutoryDeadlineOverride: string | null;
  /** Government-notified revised operative date (§19 overlay), if one is applied. */
  revisedStatutoryDeadline: string | null;
  /**
   * COALESCE(manual override, government extension, computed) — the operative
   * statutory date. Precedence: §20 manual override ▸ §19 extension ▸ snapshot.
   */
  effectiveStatutoryDeadline: string;
  /** True when a government extension overlay is applied (§24 "Extended"). */
  isExtended: boolean;
  /** The applied government extension (§19), for calendar display; null if none. */
  governmentExtension: InstanceGovernmentExtension | null;
  internalSlaDate: string;
  internalSlaOverride: string | null;
  effectiveInternalSlaDate: string;
  status: ComplianceStatus;
  /** Derived: open and past the effective statutory deadline. */
  isStatutoryOverdue: boolean;
  /** Derived: open and past the effective internal SLA date (distinct clock). */
  isInternallyOverdue: boolean;
  completedAt: string | null;
  completedById: string | null;
  completedByName: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The government extension applied to an instance, embedded for display (§19/§24). */
export interface InstanceGovernmentExtension {
  id: string;
  originalDueDate: string;
  revisedDueDate: string;
  notificationReference: string;
  applicablePopulation: string;
  effectiveDate: string;
}

/**
 * A government extension (§19) — a firm-wide overlay on a statutory rule's date.
 * Append-only evidence; not an edit to the rule and not a manual override.
 */
export interface GovernmentExtensionRecord {
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

/** One recorded deadline override (append-only governance event). */
export interface ComplianceOverrideRecord {
  id: string;
  clock: ComplianceClock;
  previousDate: string | null;
  newDate: string;
  reason: string;
  evidenceReference: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  createdAt: string;
}

export interface ComplianceInstanceDetail extends ComplianceInstanceRecord {
  overrides: ComplianceOverrideRecord[];
}

/** A calendar row — an obligation enriched with its engagement/entity/service context. */
export interface ComplianceCalendarRecord extends ComplianceInstanceRecord {
  engagementCode: string;
  entityName: string;
  serviceCode: string;
}

/** Result of a bulk generate-for-service call. */
export interface BulkGenerateResult {
  generated: ComplianceInstanceRecord[];
  skipped: Array<{ rule: string; reason: string }>;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateComplianceRuleInput {
  code: string;
  name: string;
  description?: string;
  serviceCode?: string;
  category?: ComplianceCategory;
  dueDateCategory?: DueDateCategory;
  dueDateSource?: DueDateSource;
}

/** Amend a rule's classification (category/source) — identity fields only. */
export interface UpdateComplianceRuleInput {
  dueDateCategory?: DueDateCategory;
  dueDateSource?: DueDateSource | null;
}

export interface CreateGovernmentExtensionInput {
  complianceRuleCode: string;
  originalDueDate: string;
  revisedDueDate: string;
  notificationReference: string;
  applicablePopulation: string;
  effectiveDate: string;
  notes?: string;
}

export interface ApplyExtensionInput {
  governmentExtensionId: string;
  version?: number;
}

export interface AddRuleVersionInput {
  effectiveFrom: string;
  effectiveTo?: string | null;
  calculationBasis: CalculationBasis;
  offsetMonths?: number;
  offsetDays?: number;
  fixedMonth?: number;
  fixedDay?: number;
  workingDayAdjustment?: WorkingDayAdjustment;
  internalSlaOffsetDays?: number;
  condition?: unknown;
  notes?: string;
}

export interface GenerateInstanceInput {
  complianceRuleCode: string;
  referenceDate?: string;
  eventDate?: string;
  context?: Record<string, unknown>;
}

export interface OverrideInstanceInput {
  clock: ComplianceClock;
  newDate: string;
  reason: string;
  evidenceReference?: string;
  version?: number;
}

export interface CompleteInstanceInput {
  notes?: string;
  version?: number;
}

export interface WaiveInstanceInput {
  reason: string;
  version?: number;
}
