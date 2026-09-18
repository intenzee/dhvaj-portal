/**
 * Statutory Audit — Planning (Phase 03) vocabulary (Audit Spec §21, §30).
 *
 * Planning consumes the APPROVED framework outputs and determines audit
 * strategy, materiality, risks, areas, responses, resources, PBC and timing
 * (§21). It is a structured file of planning sub-areas plus a first-class
 * MATERIALITY record. Approving Planning freezes it in a versioned snapshot,
 * marks Phase 03 complete and UNLOCKS Risk (Phase 04) — the progressive unlock
 * of §7. This module is the single source of truth for the planning sub-areas,
 * the planning-item state model and the shapes the Planning screen reads.
 */

/**
 * Professional state of a planning sub-area — the same first-class model as an
 * audit-file phase (§8, §31), not a task status. A freshly seeded item is
 * `not_started`; `needs_attention` is an actionable professional issue.
 */
export const PLANNING_ITEM_STATE = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  complete: 'complete',
  needsAttention: 'needs_attention',
} as const;
export type PlanningItemState =
  (typeof PLANNING_ITEM_STATE)[keyof typeof PLANNING_ITEM_STATE];

/** States in which a planning item counts as done (contributes to readiness). */
export const PLANNING_ITEM_DONE_STATES: readonly PlanningItemState[] = ['complete'];

/** Stable machine keys for the planning sub-areas (§21). */
export const PLANNING_ITEM_KEY = {
  auditStrategy: 'audit_strategy',
  engagementUnderstanding: 'engagement_understanding',
  materiality: 'materiality',
  overallAuditPlan: 'overall_audit_plan',
  auditApproach: 'audit_approach',
  areasAndAssertions: 'areas_and_assertions',
  riskToResponse: 'risk_to_response',
  auditProgramme: 'audit_programme',
  teamAllocation: 'team_allocation',
  specialistPlanning: 'specialist_planning',
  componentPlanning: 'component_planning',
  useOfInternalAudit: 'use_of_internal_audit',
  pbcStrategy: 'pbc_strategy',
  timelineMilestones: 'timeline_milestones',
  communicationReviewPlan: 'communication_review_plan',
  significantMatters: 'significant_matters',
} as const;
export type PlanningItemKey = (typeof PLANNING_ITEM_KEY)[keyof typeof PLANNING_ITEM_KEY];

export interface PlanningItemDefinition {
  itemKey: PlanningItemKey;
  title: string;
  sortOrder: number;
}

/** The canonical planning sub-areas, in order (§21). "Materiality" links to the
 * structured materiality record below; "Planning Completion & Approval" is the
 * approval action (not a documented item), so it is not seeded here. */
export const PLANNING_ITEMS: readonly PlanningItemDefinition[] = [
  { itemKey: 'audit_strategy', title: 'Audit Strategy', sortOrder: 1 },
  { itemKey: 'engagement_understanding', title: 'Preliminary Engagement Understanding', sortOrder: 2 },
  { itemKey: 'materiality', title: 'Materiality', sortOrder: 3 },
  { itemKey: 'overall_audit_plan', title: 'Overall Audit Plan', sortOrder: 4 },
  { itemKey: 'audit_approach', title: 'Audit Approach', sortOrder: 5 },
  { itemKey: 'areas_and_assertions', title: 'Audit Areas & Assertions', sortOrder: 6 },
  { itemKey: 'risk_to_response', title: 'Risk-to-Response Planning', sortOrder: 7 },
  { itemKey: 'audit_programme', title: 'Audit Procedures / Audit Programme', sortOrder: 8 },
  { itemKey: 'team_allocation', title: 'Team & Responsibility Allocation', sortOrder: 9 },
  { itemKey: 'specialist_planning', title: 'Specialist / Expert Planning', sortOrder: 10 },
  { itemKey: 'component_planning', title: 'Component / Branch Planning', sortOrder: 11 },
  { itemKey: 'use_of_internal_audit', title: 'Use of Internal Audit Work', sortOrder: 12 },
  { itemKey: 'pbc_strategy', title: 'PBC Strategy', sortOrder: 13 },
  { itemKey: 'timeline_milestones', title: 'Timeline & Milestones', sortOrder: 14 },
  { itemKey: 'communication_review_plan', title: 'Communication & Review Plan', sortOrder: 15 },
  { itemKey: 'significant_matters', title: 'Significant Matters / Consultation Plan', sortOrder: 16 },
] as const;

/** One planning sub-area on a live audit file (§21). */
export interface PlanningItem {
  id: string;
  itemKey: string;
  title: string;
  state: PlanningItemState;
  /** The professional's planning narrative for the sub-area. */
  narrative: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  sortOrder: number;
  version: number;
}

/**
 * The structured materiality record (§21, §30). Amounts are rupees. Overall and
 * performance materiality plus the clearly-trivial threshold drive sampling and
 * evaluation; a later revision (§30) flags affected work (SA-9).
 */
export interface Materiality {
  overallMateriality: number | null;
  performanceMateriality: number | null;
  clearlyTrivialThreshold: number | null;
  /** The benchmark the figures are based on, e.g. "5% of profit before tax". */
  benchmark: string | null;
  basis: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  version: number;
}

/** A planning approval — versioned, immutable history (§21, §30). */
export interface PlanningApproval {
  id: string;
  version: number;
  memo: string | null;
  approvedByName: string | null;
  approvedAt: string;
}

/** The whole Planning view for one statutory-audit workflow instance (§21). */
export interface StatutoryAuditPlanning {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  /** Whether the Framework Memo is approved — the gate for planning approval (§21). */
  frameworkApproved: boolean;
  items: PlanningItem[];
  materiality: Materiality | null;
  /** The current (latest) planning approval, or null while unapproved. */
  approval: PlanningApproval | null;
  /** How many sub-areas are not yet complete (0 ⇒ every area documented). */
  incompleteCount: number;
}
