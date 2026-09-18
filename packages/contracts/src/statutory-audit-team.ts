/**
 * Statutory Audit — Team vocabulary (Audit Spec §24, §37).
 *
 * The Team layer "combines responsibility, workload and time" (§37). One row per
 * person on the audit file: their role, the count of professional work items they
 * own (procedures + audit areas), their PLANNED hours (an allocation set during
 * planning, §21 Team & Responsibility Allocation) and their ACTUAL hours —
 * aggregated from the existing engagement time-entry mechanism (§24 "Actual time
 * is aggregated from the time-entry mechanism. No separate engagement Time tab is
 * required."), plus whether they act as a reviewer anywhere on the file.
 *
 * This module is the single source of truth for the SA-7 team vocabulary and is
 * shared by the pure helpers, the service and the screen.
 */

/** One person's rollup on the audit file (§24). */
export interface AuditTeamMember {
  employeeId: string;
  name: string;
  /** Role on the engagement, e.g. "EP", "Manager", "Senior", "Article". */
  role: string;
  /** Professional work items this person owns (procedures + audit areas) (§24). */
  workItems: number;
  /** Planned hours allocated to this person (§21, §24). */
  plannedHours: number;
  /** Actual hours worked, from the engagement time-entry mechanism (§24). */
  actualHours: number;
  /** Whether this person reviews any procedure or area on the file (§24 "Review"). */
  isReviewer: boolean;
}

/** The Team dashboard for one statutory-audit shell — the shape the screen reads (§24). */
export interface StatutoryAuditTeam {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  engagementPartnerId: string | null;
  engagementPartnerName: string | null;
  engagementManagerId: string | null;
  engagementManagerName: string | null;
  members: AuditTeamMember[];
  totals: {
    plannedHours: number;
    actualHours: number;
    workItems: number;
  };
}

/** A work item assigned to a person, for the per-person drilldown (§24). */
export interface AuditTeamAssignment {
  id: string;
  ref: string | null;
  title: string;
  state: string;
}

/**
 * The per-person drilldown (§24 — "Click a person → assigned areas, workpapers,
 * procedures, reviews and time").
 */
export interface AuditTeamMemberDetail {
  employeeId: string;
  name: string;
  role: string;
  plannedHours: number;
  actualHours: number;
  responsibility: string | null;
  /** Audit areas this person owns. */
  ownedAreas: AuditTeamAssignment[];
  /** Procedures this person prepares (owns). */
  ownedProcedures: AuditTeamAssignment[];
  /** Procedures this person reviews. */
  reviewingProcedures: AuditTeamAssignment[];
  /** Open review notes raised against this person's work. */
  openReviewNotes: number;
}

/**
 * Convert a materialised duration in seconds to hours, rounded to one decimal
 * place. Time entries store `duration_seconds`; the Team rollup reports hours
 * (§24). Pure so the conversion is unit-tested.
 */
export function secondsToHours(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((seconds / 3600) * 10) / 10;
}

/** Sum a numeric field across the member rollup. Pure. */
export function sumMembers(
  members: readonly AuditTeamMember[],
  pick: (m: AuditTeamMember) => number,
): number {
  return Math.round(members.reduce((acc, m) => acc + pick(m), 0) * 10) / 10;
}
