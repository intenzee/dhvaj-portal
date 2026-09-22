/**
 * 02.8 — Audit Framework Summary & Approval (Implementation Guide §9.8, §13).
 *
 * The closure / control layer for Section 02. It decides nothing new: it
 * aggregates every 02.x conclusion into a dashboard (each linking to its source
 * sub-assessment), lists the triggered SAs, previews the downstream
 * configuration, surfaces the aggregated Framework Matters, and drives the
 * two-gate approval: Manager confirmation (AF-01) → Audit Framework Memorandum →
 * Engagement Partner approval (AF-02). On approval it freezes the Audit Framework
 * Baseline v1.0 (methodology version + all cited rule versions + an immutable
 * snapshot), marks Section 02 approved and unlocks Planning. A controlled reopen
 * (§13) preserves v1.0, opens v1.1 in the originating sub-section, runs
 * change-impact analysis and never deletes completed downstream work.
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { SubSectionKey } from './statutory-audit-subassessment';

/** The Audit Framework Baseline lifecycle. */
export const FRAMEWORK_BASELINE_STATUS = {
  draft: 'draft',
  managerConfirmed: 'manager_confirmed',
  approved: 'approved',
  superseded: 'superseded',
} as const;
export type FrameworkBaselineStatus =
  (typeof FRAMEWORK_BASELINE_STATUS)[keyof typeof FRAMEWORK_BASELINE_STATUS];

/** One sub-section conclusion on the dashboard (links back to its source). */
export interface FrameworkSummarySection {
  subSectionKey: SubSectionKey;
  areaKey: string;
  title: string;
  state: FrameworkState;
  systemOutcome: string | null;
  conclusion: string | null;
  ruleVersionId: string | null;
  authorityProvisionId: string | null;
  needsReevaluation: boolean;
  /** True when the section has reached a decided state (guide §19). */
  decided: boolean;
}

/** A triggered Standard on Auditing carried into Planning / execution. */
export interface FrameworkTriggeredSa {
  code: string;
  source: string;
  basis: string;
}

/** An aggregated Framework/Acceptance matter surfaced on the summary. */
export interface FrameworkSummaryMatter {
  code: string;
  severity: string | null;
  message: string;
  source: string;
  blocking: boolean;
}

/** One item the downstream-configuration preview will create/activate/deactivate. */
export interface DownstreamPreviewItem {
  area: string;
  action: 'create' | 'activate' | 'deactivate';
  description: string;
}

/** The frozen (or in-progress) Audit Framework Baseline record. */
export interface FrameworkBaselineRecord {
  id: string;
  version: string;
  status: FrameworkBaselineStatus;
  methodologyVersion: string | null;
  managerConfirmedByName: string | null;
  managerConfirmedAt: string | null;
  epApprovedByName: string | null;
  epApprovedAt: string | null;
  memoDocumentId: string | null;
  reopenReason: string | null;
  recordVersion: number;
}

/** The two-gate approval readiness. */
export interface FrameworkSummaryGates {
  allSectionsDecided: boolean;
  profileConfirmed: boolean;
  hasBlockingMatter: boolean;
  canConfirm: boolean;
  canApprove: boolean;
}

/** The whole 02.8 summary view for one statutory-audit workflow instance. */
export interface StatutoryAuditFrameworkSummary {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  profileConfirmed: boolean;
  sections: FrameworkSummarySection[];
  triggeredSAs: FrameworkTriggeredSa[];
  matters: FrameworkSummaryMatter[];
  downstreamPreview: DownstreamPreviewItem[];
  baseline: FrameworkBaselineRecord | null;
  gates: FrameworkSummaryGates;
  /** True once the baseline is approved — Planning is unlocked. */
  planningUnlocked: boolean;
  /** Optimistic-concurrency version of the current baseline (0 when none). */
  recordVersion: number;
}

/**
 * Compute the two-gate approval readiness (pure, guide §9.8). AF-01 (confirm)
 * needs every sub-section decided, the 02.1 profile confirmed, no blocking matter
 * and no already-approved baseline; AF-02 (approve) needs a Manager-confirmed
 * baseline and no blocking matter.
 */
export function computeFrameworkGates(input: {
  sections: Pick<FrameworkSummarySection, 'decided'>[];
  profileConfirmed: boolean;
  hasBlockingMatter: boolean;
  baselineStatus: FrameworkBaselineStatus | null;
}): FrameworkSummaryGates {
  const allSectionsDecided = input.sections.length > 0 && input.sections.every((s) => s.decided);
  const isApproved = input.baselineStatus === FRAMEWORK_BASELINE_STATUS.approved;
  return {
    allSectionsDecided,
    profileConfirmed: input.profileConfirmed,
    hasBlockingMatter: input.hasBlockingMatter,
    canConfirm:
      allSectionsDecided && input.profileConfirmed && !input.hasBlockingMatter && !isApproved,
    canApprove:
      input.baselineStatus === FRAMEWORK_BASELINE_STATUS.managerConfirmed &&
      !input.hasBlockingMatter,
  };
}

/** AF-01 — Manager confirmation of the framework. */
export interface ConfirmFrameworkInput {
  note?: string | null;
  recordVersion: number;
}

/** AF-02 — Engagement Partner approval; freezes the baseline. */
export interface ApproveFrameworkInput {
  methodologyVersion?: string | null;
  recordVersion: number;
}

/** Controlled reopen (§13) — preserves the approved baseline, opens the next version. */
export interface ReopenFrameworkInput {
  reason: string;
  recordVersion: number;
}
