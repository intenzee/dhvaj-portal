/**
 * Component vocabulary (Service Configuration spec §11–§13, §16, §23–§24, §36)
 * shared by the API and web.
 *
 * A Component is a specific scope/obligation available under a Service. The
 * catalogue (service_components) declares each component's DEFAULT applicability
 * and frequency; the per-client CONFIGURATION (engagement_components) records the
 * professional applicability determination, frequency, owner/reviewer and
 * lifecycle status for one engagement.
 */

import type { Recurrence } from './services';

/** The default applicability a catalogue component starts from (spec §11). */
export const COMPONENT_APPLICABILITY_DEFAULT = {
  mandatory: 'mandatory',
  recommended: 'recommended',
  optional: 'optional',
} as const;
export type ComponentApplicabilityDefault =
  (typeof COMPONENT_APPLICABILITY_DEFAULT)[keyof typeof COMPONENT_APPLICABILITY_DEFAULT];
export const COMPONENT_APPLICABILITY_DEFAULTS: ComponentApplicabilityDefault[] = Object.values(
  COMPONENT_APPLICABILITY_DEFAULT,
);

/**
 * The professional applicability determination for a component on a specific
 * engagement — the §11 OUTPUT categories. `mandatory`/`applicable`/`optional`
 * are in-scope; `pending_review` needs professional determination;
 * `not_applicable` is explicitly excluded (with a reason).
 */
export const COMPONENT_APPLICABILITY_STATUS = {
  mandatory: 'mandatory',
  applicable: 'applicable',
  optional: 'optional',
  pendingReview: 'pending_review',
  notApplicable: 'not_applicable',
} as const;
export type ComponentApplicabilityStatus =
  (typeof COMPONENT_APPLICABILITY_STATUS)[keyof typeof COMPONENT_APPLICABILITY_STATUS];
export const COMPONENT_APPLICABILITY_STATUSES: ComponentApplicabilityStatus[] = Object.values(
  COMPONENT_APPLICABILITY_STATUS,
);

/** Lifecycle status of a component configuration (spec §23, pragmatic subset). */
export const COMPONENT_CONFIG_STATUS = {
  draft: 'draft',
  active: 'active',
  onHold: 'on_hold',
  completed: 'completed',
  cancelled: 'cancelled',
  superseded: 'superseded',
} as const;
export type ComponentConfigStatus =
  (typeof COMPONENT_CONFIG_STATUS)[keyof typeof COMPONENT_CONFIG_STATUS];
export const COMPONENT_CONFIG_STATUSES: ComponentConfigStatus[] =
  Object.values(COMPONENT_CONFIG_STATUS);

/** Discovery categories the selection screen groups components by (spec §11/§12). */
export const COMPONENT_DISCOVERY_CATEGORY = {
  mandatory: 'mandatory',
  applicable: 'applicable',
  optional: 'optional',
  notApplicable: 'not_applicable',
  pendingReview: 'pending_review',
} as const;
export type ComponentDiscoveryCategory =
  (typeof COMPONENT_DISCOVERY_CATEGORY)[keyof typeof COMPONENT_DISCOVERY_CATEGORY];

/** A catalogue component available under a service. */
export interface ServiceComponentRecord {
  id: string;
  serviceId: string;
  serviceCode: string;
  code: string;
  name: string;
  description: string | null;
  defaultApplicability: ComponentApplicabilityDefault;
  defaultFrequency: Recurrence;
  complianceRuleId: string | null;
  complianceRuleCode: string | null;
  displayOrder: number;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A per-engagement component configuration. */
export interface EngagementComponentRecord {
  id: string;
  engagementId: string;
  /** The service line this component belongs to (multi-service, §9–§10). */
  engagementServiceId: string | null;
  /** Name of that service line's service, for display/grouping. */
  serviceName: string | null;
  serviceComponentId: string;
  componentCode: string;
  componentName: string;
  applicabilityStatus: ComponentApplicabilityStatus;
  applicabilityReason: string | null;
  frequency: Recurrence;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  reviewerEmployeeId: string | null;
  reviewerName: string | null;
  epReviewRequired: boolean;
  status: ComponentConfigStatus;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  complianceRuleVersionId: string | null;
  /** When superseded (e.g. by a frequency change), the id of the version that replaced this. */
  supersededById: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of the Component Discovery result (spec §11/§12): a catalogue
 * component, the category the engine placed it in, the reason, a deadline
 * preview where a compliance rule governs it, and — if already configured on
 * this engagement — a pointer to that live configuration.
 */
export interface ComponentDiscoveryRow {
  serviceComponentId: string;
  code: string;
  name: string;
  description: string | null;
  category: ComponentDiscoveryCategory;
  reason: string;
  frequency: Recurrence;
  /** Preview only — statutory deadline from the effective rule version (§12/§17). */
  statutoryDeadlinePreview: string | null;
  /** Preview only — internal SLA date from the effective rule version. */
  internalDeadlinePreview: string | null;
  /** The rule version id the preview used (null when no rule governs). */
  complianceRuleVersionId: string | null;
  alreadyConfigured: boolean;
  engagementComponentId: string | null;
  configuredStatus: ComponentConfigStatus | null;
}

/** Full discovery result for one engagement's service. */
export interface ComponentDiscoveryResult {
  engagementId: string;
  /** The service line discovery was run for (multi-service, §9–§10); primary by default. */
  engagementServiceId: string;
  serviceId: string;
  serviceCode: string;
  financialYear: string;
  rows: ComponentDiscoveryRow[];
  counts: Record<ComponentDiscoveryCategory, number>;
}

/** Status of a generated component work instance (spec §22/§23). */
export const COMPONENT_INSTANCE_STATUS = {
  scheduled: 'scheduled',
  active: 'active',
  completed: 'completed',
  waived: 'waived',
  cancelled: 'cancelled',
  /** Replaced by a new configuration version (e.g. a frequency change). */
  superseded: 'superseded',
} as const;
export type ComponentInstanceStatus =
  (typeof COMPONENT_INSTANCE_STATUS)[keyof typeof COMPONENT_INSTANCE_STATUS];
export const COMPONENT_INSTANCE_STATUSES: ComponentInstanceStatus[] =
  Object.values(COMPONENT_INSTANCE_STATUS);

/** A generated period-specific work instance of a configured component (§21/§22/§36). */
export interface ComponentInstanceRecord {
  id: string;
  engagementComponentId: string;
  engagementId: string;
  componentCode: string;
  componentName: string;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  statutoryDeadline: string | null;
  internalSlaDate: string | null;
  complianceRuleVersionId: string | null;
  status: ComponentInstanceStatus;
  /** Derived: the period has not started yet (§22 scheduled/future vs current). */
  isFuture: boolean;
  /** Derived: open and past the statutory deadline (only when a deadline exists). */
  isOverdue: boolean;
  completedAt: string | null;
  completedById: string | null;
  completedByName: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of a generate call. Generation RECONCILES to the current config
 * (frequency × active window): `generated` was created or revived to match,
 * `removed` was cancelled because it fell out of scope (window narrowed or
 * frequency changed) and was not yet finalised, and `skipped` already matched.
 */
export interface GenerateInstancesResult {
  generated: ComponentInstanceRecord[];
  removed: ComponentInstanceRecord[];
  skipped: Array<{ period: string; reason: string }>;
}

/** One step in a component's checklist (spec §13). */
export interface ComponentChecklistItem {
  id: string;
  label: string;
  sequence: number;
  isDone: boolean;
  doneByEmployeeId: string | null;
  doneByName: string | null;
  doneAt: string | null;
}

/**
 * Result of the engagement activation ceremony (spec §20/§37): the gated,
 * atomic step that confirms scope, activates its draft component configurations
 * and generates the recurring work — in one transaction.
 */
export interface EngagementActivationResult {
  /** Draft component configurations flipped to active. */
  activatedComponents: number;
  /** Work instances created. */
  generated: number;
  /** Work instances cancelled because they fell out of scope. */
  removed: number;
  /** Non-blocking notes (e.g. ad-hoc components that produced no periods). */
  warnings: string[];
}
