import type { EngagementStatus, ReviewModelSlug, TeamRole } from '@hsdg/contracts';

/** The service-workflow state instance an engagement currently sits in (Phase 6, §16-19). */
export interface WorkflowStateRef {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  isInitial: boolean;
  isTerminal: boolean;
}

/** A review model, ranked by rigour (Phase 7). */
export interface ReviewModelRef {
  slug: ReviewModelSlug;
  name: string;
  rank: number;
  /** Whether the accountable EP's personal sign-off is mandatory before completion. */
  requiresEpSignoff: boolean;
}

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
  /** Independent of lifecycle status (§17) — null until the service workflow is initialised (on 'start'). */
  currentWorkflowState: WorkflowStateRef | null;
  onHoldReason: string | null;
  onHoldPreviousStatus: EngagementStatus | null;
  onHoldAt: string | null;
  onHoldExpectedResumeDate: string | null;
  // ── Review state (Phase 7) ──────────────────────────────────────────────
  /** The service's required model, escalated by the review plan when set. */
  effectiveReviewModel: ReviewModelRef;
  /** The explicit review-plan escalation (rank ≥ required), or null when inheriting the service default. */
  reviewPlanModel: Omit<ReviewModelRef, 'requiresEpSignoff'> | null;
  /** A current (non-superseded) sign-off exists — the professional gate for completion. */
  isSignedOff: boolean;
  signedOffById: string | null;
  signedOffByName: string | null;
  signedOffAt: string | null;
  /** Unresolved review points; completion is blocked while this is > 0. */
  openReviewPointCount: number;
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

/**
 * Partial update of non-lifecycle fields. Status has no place here from
 * Phase 6 onward — it moves only through the guarded transition endpoints
 * (POST /engagements/:id/<action>), never a generic PATCH.
 */
export interface UpdateEngagementInput {
  engagementManagerEmployeeId?: string | null;
  officeCode?: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  version?: number;
}

/** One row of hsdg.engagement_lifecycle_history — the engagement's business journey. */
export interface LifecycleHistoryRecord {
  id: string;
  action: string;
  fromStatus: EngagementStatus;
  toStatus: EngagementStatus;
  actorUserId: string | null;
  actorRole: string | null;
  reason: string | null;
  correlationId: string | null;
  previousVersion: number;
  resultingVersion: number;
  createdAt: string;
}

export interface AssignTeamMemberInput {
  employeeId: string;
  roleOnEngagement?: TeamRole;
}
