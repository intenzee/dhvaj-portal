import type {
  CalculationBasis,
  ComplianceCategory,
  ComplianceClock,
  ComplianceStatus,
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
  referenceDate: string;
  /** Computed snapshot from the rule version (immutable). */
  statutoryDeadline: string;
  statutoryDeadlineOverride: string | null;
  /** COALESCE(override, computed) — what the two clocks actually read. */
  effectiveStatutoryDeadline: string;
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

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateComplianceRuleInput {
  code: string;
  name: string;
  description?: string;
  serviceCode?: string;
  category?: ComplianceCategory;
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
