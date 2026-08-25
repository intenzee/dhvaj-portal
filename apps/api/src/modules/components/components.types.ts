import type {
  ComponentApplicabilityDefault,
  ComponentApplicabilityStatus,
  ComponentConfigStatus,
  Recurrence,
} from '@hsdg/contracts';

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateServiceComponentInput {
  serviceCode: string;
  code: string;
  name: string;
  description?: string;
  defaultApplicability?: ComponentApplicabilityDefault;
  defaultFrequency?: Recurrence;
  complianceRuleCode?: string;
  displayOrder?: number;
}

export interface UpdateServiceComponentInput {
  name?: string;
  description?: string | null;
  defaultApplicability?: ComponentApplicabilityDefault;
  defaultFrequency?: Recurrence;
  complianceRuleCode?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

/** Select/configure a component on an engagement (spec §12/§13). */
export interface ConfigureComponentInput {
  serviceComponentCode: string;
  applicabilityStatus?: ComponentApplicabilityStatus;
  applicabilityReason?: string;
  frequency?: Recurrence;
  ownerEmployeeId?: string | null;
  reviewerEmployeeId?: string | null;
  epReviewRequired?: boolean;
  status?: ComponentConfigStatus;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

/** Amend an existing component configuration (spec §24). */
export interface UpdateEngagementComponentInput {
  applicabilityStatus?: ComponentApplicabilityStatus;
  applicabilityReason?: string | null;
  frequency?: Recurrence;
  ownerEmployeeId?: string | null;
  reviewerEmployeeId?: string | null;
  epReviewRequired?: boolean;
  status?: ComponentConfigStatus;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  version?: number;
}
