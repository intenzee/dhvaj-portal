/**
 * 02.8 — Audit Framework Summary & Approval (spec v1.0 §1–§21).
 *
 * The closure / control layer for Section 02. It decides nothing new: it
 * aggregates every 02.x conclusion into a dashboard (each linking to its source
 * assessment), lists the circumstance-driven auditing requirements, previews the
 * downstream configuration, surfaces the aggregated Framework Matters and the
 * prior-year changes, and drives the two-gate approval: Manager review (AF-01) →
 * Audit Framework Memorandum → Engagement Partner conclusion (AF-02). Approval
 * freezes the Audit Framework Baseline v1.0 (methodology + every cited rule
 * version + an immutable snapshot), marks Section 02 APPROVED and unlocks
 * Planning. A controlled reopen (§15) preserves v1.0, opens v1.1 in the
 * originating sections, runs change-impact analysis and never deletes completed
 * downstream work.
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkMatterCategory } from './statutory-audit-matters';
import type { SubSectionKey } from './statutory-audit-subassessment';

// ── Shared keys ──────────────────────────────────────────────────────────────

/** The Audit Framework Baseline lifecycle (stored). */
export const FRAMEWORK_BASELINE_STATUS = {
  draft: 'draft',
  managerConfirmed: 'manager_confirmed',
  approved: 'approved',
  superseded: 'superseded',
} as const;
export type FrameworkBaselineStatus =
  (typeof FRAMEWORK_BASELINE_STATUS)[keyof typeof FRAMEWORK_BASELINE_STATUS];

/** The displayed Framework Status (§3). */
export const FRAMEWORK_SUMMARY_STATUS = {
  draft: 'draft',
  readyForManagerReview: 'ready_for_manager_review',
  partnerReview: 'partner_review',
  approved: 'approved',
  reopened: 'reopened',
} as const;
export type FrameworkSummaryStatus =
  (typeof FRAMEWORK_SUMMARY_STATUS)[keyof typeof FRAMEWORK_SUMMARY_STATUS];

export const FRAMEWORK_SUMMARY_STATUS_LABEL: Record<FrameworkSummaryStatus, string> = {
  draft: 'Draft',
  ready_for_manager_review: 'Ready for Manager Review',
  partner_review: 'Partner Review',
  approved: 'Approved',
  reopened: 'Reopened',
};

/**
 * A Section 02 source the summary reads: 02.1 (the profile), 02.2–02.7 (the
 * sub-assessments) and the remaining Phase-02 framework area cards (internal
 * audit, cost records, secretarial, CSR, SA matrix, audit reporting framework)
 * that have no 02.x workspace of their own.
 */
export const FRAMEWORK_SOURCE_SECTION = {
  profile: '02.1',
  financialReporting: '02.2',
  scheduleIii: '02.3',
  caro: '02.4',
  icfr: '02.5',
  consolidation: '02.6',
  otherReporting: '02.7',
  otherAreas: 'other_areas',
} as const;
export type FrameworkSourceSection =
  (typeof FRAMEWORK_SOURCE_SECTION)[keyof typeof FRAMEWORK_SOURCE_SECTION];

export const FRAMEWORK_SOURCE_SECTIONS: readonly FrameworkSourceSection[] = [
  '02.1',
  '02.2',
  '02.3',
  '02.4',
  '02.5',
  '02.6',
  '02.7',
  'other_areas',
];

export const FRAMEWORK_SOURCE_SECTION_LABEL: Record<FrameworkSourceSection, string> = {
  '02.1': '02.1 Entity & Regulatory Profile',
  '02.2': '02.2 Financial Reporting Framework',
  '02.3': '02.3 Schedule III',
  '02.4': '02.4 CARO 2020',
  '02.5': '02.5 ICFR',
  '02.6': '02.6 CFS / Group Audit',
  '02.7': '02.7 Other Statutory Reporting',
  other_areas: 'Other framework areas',
};

/** The DOM anchor of each source section inside the Section 02 panel (§4 "View 02.x"). */
export const FRAMEWORK_SOURCE_ANCHOR: Record<FrameworkSourceSection, string> = {
  '02.1': 'framework-02-1',
  '02.2': 'framework-02-2',
  '02.3': 'framework-02-2',
  '02.4': 'framework-02-4',
  '02.5': 'framework-02-5',
  '02.6': 'framework-02-4',
  '02.7': 'framework-02-5',
  other_areas: 'framework-02-areas',
};

/** The DOM anchor of the 02.8 workspace itself. */
export const FRAMEWORK_SUMMARY_ANCHOR = 'framework-02-8';

/** The methodology version recorded when the Engagement Partner names none (§13). */
export const DEFAULT_METHODOLOGY_VERSION = 'DHVAJ Statutory Audit Methodology v1.0';

// ── Track A — header, dashboard, gates (§3, §4, §18) ─────────────────────────

export interface FrameworkSummaryHeader {
  status: FrameworkSummaryStatus;
  /** Current preparer: whoever last recorded a Section 02 conclusion. */
  preparedByName: string | null;
  engagementManagerName: string | null;
  engagementPartnerName: string | null;
  /** e.g. "FY 2025-26 (01 Apr 2025 – 31 Mar 2026)". */
  periodLabel: string;
  /** "Draft v1.1" while in progress, "v1.0" once approved. */
  frameworkVersion: string;
  methodologyVersion: string;
  openMatterCount: number;
  blockingMatterCount: number;
  viewerIsPartner: boolean;
  viewerIsManager: boolean;
}

/** One dashboard row (§4) — every conclusion links back to its source. */
export interface FrameworkDashboardRow {
  section: FrameworkSourceSection;
  title: string;
  /** The displayed conclusion, e.g. "Ind AS", "Division II", "CARO Applicable". */
  conclusion: string | null;
  /** Secondary detail, e.g. "2 components · 1 branch". */
  detail: string | null;
  status: 'complete' | 'attention_required';
  /** Why the row needs attention (undecided, re-evaluation, returned, open matter…). */
  attention: string[];
  state: FrameworkState | null;
  decided: boolean;
  isOverridden: boolean;
  ruleVersionId: string | null;
  anchor: string;
}

/** One sub-section conclusion (02.2–02.7) — kept in the frozen snapshot. */
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
  isOverridden: boolean;
  /** True when the section has reached a decided state. */
  decided: boolean;
}

/** One Section 02 completion rule (§18). */
export interface FrameworkCompletionCheck {
  key:
    | 'sections_complete'
    | 'conclusions_exist'
    | 'no_blocking_matter'
    | 'overrides_documented'
    | 'consultations_complete'
    | 'preview_reviewed'
    | 'manager_confirmed'
    | 'memo_submitted'
    | 'partner_approved'
    | 'versions_stored';
  label: string;
  met: boolean;
  detail: string | null;
}

export interface FrameworkSummaryGates {
  allSectionsDecided: boolean;
  profileConfirmed: boolean;
  hasBlockingMatter: boolean;
  /** Open AF-01 / AF-02 return items not yet cleared by the source section. */
  openReturnCount: number;
  /** A reopened revision needs its impact analysis professionally confirmed (§15). */
  impactConfirmed: boolean;
  canConfirm: boolean;
  canCreateMemo: boolean;
  canApprove: boolean;
  canReopen: boolean;
  /** Why AF-01 / AF-02 are disabled, in plain words (empty when enabled). */
  confirmBlockers: string[];
  approveBlockers: string[];
  checks: FrameworkCompletionCheck[];
}

/** Section 03 access (§13, §20) — locked until approval or an approved condition permits. */
export interface FrameworkPlanningGate {
  unlocked: boolean;
  route: 'approved' | 'conditional' | 'locked';
  reason: string;
}

// ── Track A — AF-01 / AF-02 / approval record / reopen (§9, §12–§15) ────────

export const AF01_DECISION = {
  submit: 'submit_for_partner_approval',
  furtherWork: 'further_work_required',
} as const;
export type Af01Decision = (typeof AF01_DECISION)[keyof typeof AF01_DECISION];

export const AF02_DECISION = {
  approve: 'approve',
  approveWithConditions: 'approve_subject_to_conditions',
  returnForFurtherWork: 'return_for_further_work',
} as const;
export type Af02Decision = (typeof AF02_DECISION)[keyof typeof AF02_DECISION];

export const AF02_DECISION_LABEL: Record<Af02Decision, string> = {
  approve: 'Approve Audit Framework',
  approve_subject_to_conditions: 'Approve Subject to Conditions',
  return_for_further_work: 'Return for Further Work',
};

/** An item AF-01 "No" or AF-02 "Return" sends back to its source section. */
export interface FrameworkReturnItem {
  id: string;
  gate: 'AF-01' | 'AF-02';
  section: FrameworkSourceSection;
  action: string;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  status: 'open' | 'resolved';
  raisedByName: string | null;
  raisedAt: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

/** An Approve-Subject-to-Conditions condition (§12). */
export interface FrameworkApprovalCondition {
  id: string;
  condition: string;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueDate: string;
  impact: string;
  planningMayCommence: boolean;
  status: 'open' | 'resolved';
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

/** A rule version the approved framework relied on (§13). */
export interface FrameworkRuleVersionRef {
  ruleVersionId: string;
  ruleCode: string | null;
  versionLabel: string | null;
  section: FrameworkSourceSection;
}

/** The immutable approval record (§13). */
export interface FrameworkApprovalRecord {
  decision: Af02Decision;
  partnerName: string | null;
  approvedAt: string;
  auditPeriod: string;
  baselineVersion: string;
  methodologyVersion: string;
  ruleVersions: FrameworkRuleVersionRef[];
  memoDocumentId: string | null;
  memoVersion: string | null;
  memoReference: string | null;
  conditions: FrameworkApprovalCondition[];
}

/** One Audit Framework Baseline version (current or historical). */
export interface FrameworkBaselineRecord {
  id: string;
  version: string;
  status: FrameworkBaselineStatus;
  methodologyVersion: string | null;
  previewReviewedByName: string | null;
  previewReviewedAt: string | null;
  managerConfirmedByName: string | null;
  managerConfirmedAt: string | null;
  managerNote: string | null;
  epApprovedByName: string | null;
  epApprovedAt: string | null;
  epDecision: Af02Decision | null;
  memoDocumentId: string | null;
  reopen: FrameworkReopenRecord | null;
  recordVersion: number;
}

/** The mandatory reopen fields (§15). */
export interface FrameworkReopenRecord {
  reason: string;
  affectedSections: FrameworkSourceSection[];
  identifiedAt: string;
  identifiedByName: string | null;
  evidenceNote: string | null;
  evidenceDocumentId: string | null;
  reapprovalRequired: boolean;
  reopenedByName: string | null;
  reopenedAt: string;
  fromVersion: string;
}

// ── Track B — triggered requirements, preview, matters, prior year, memo, impact ─

/** A circumstance-driven auditing requirement (§5) — never a full SA checklist. */
export interface FrameworkTriggeredRequirement {
  key: string;
  requirement: string;
  trigger: string;
  source: FrameworkSourceSection;
  downstreamWork: string;
  /** Central Authority/Provision Library link (applicable version). */
  provisionCode: string | null;
  authorityProvisionId: string | null;
}

/** One rule-driven downstream configuration result (§6). */
export interface DownstreamPreviewItem {
  key: string;
  item: string;
  /** e.g. "Required", "Not Required", "AS + Schedule III Division I", "2 components". */
  result: string;
  action: 'create' | 'activate' | 'deactivate' | 'parameterise' | 'none';
  /** The originating assessment — incorrect output is fixed there, never here. */
  source: FrameworkSourceSection;
  ruleKey: string;
}

/** An aggregated Framework Matter (§7) — raised in 02.1–02.7, never recreated here. */
export interface FrameworkSummaryMatter {
  id: string;
  /** Display id, e.g. "M-004". */
  code: string;
  source: FrameworkSourceSection;
  category: FrameworkMatterCategory;
  title: string;
  description: string | null;
  impact: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: 'open' | 'under_review' | 'resolved' | 'accepted_with_approval' | 'blocking';
  partnerAttention: boolean;
  resolution: string | null;
  evidenceDocumentId: string | null;
  /** True while unresolved and blocking (prevents AF-01 / AF-02). */
  blocking: boolean;
  /** Still open (anything but resolved / accepted with approval). */
  open: boolean;
}

export const FRAMEWORK_CHANGE_TYPE = {
  entityClassification: 'entity_classification',
  reportingFramework: 'reporting_framework',
  scheduleIii: 'schedule_iii',
  caro: 'caro',
  icfr: 'icfr',
  groupStructure: 'group_structure',
  otherAuditor: 'other_auditor',
  statutoryReporting: 'statutory_reporting',
  systems: 'systems',
  lawMethodology: 'law_methodology',
} as const;
export type FrameworkChangeType =
  (typeof FRAMEWORK_CHANGE_TYPE)[keyof typeof FRAMEWORK_CHANGE_TYPE];

/** One meaningful prior-year change (§8). */
export interface FrameworkPriorYearChange {
  changeType: FrameworkChangeType;
  label: string;
  previous: string | null;
  current: string | null;
  source: FrameworkSourceSection;
}

export interface FrameworkPriorYearComparison {
  /** False for an initial audit or when no prior approved framework exists. */
  available: boolean;
  reason: string | null;
  priorEngagementId: string | null;
  priorPeriodLabel: string | null;
  priorBaselineVersion: string | null;
  changes: FrameworkPriorYearChange[];
}

/** The Audit Framework Memorandum file card (§10–§11). */
export interface FrameworkMemoCard {
  documentId: string;
  fileName: string;
  workItem: string;
  version: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'superseded';
  preparedByName: string | null;
  lastEditorName: string | null;
  lastSavedAt: string | null;
  webUrl: string | null;
  baselineVersion: string;
  submittedAt: string | null;
}

/** One automatic change-impact item (§16). */
export interface FrameworkImpactItem {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  affectedSection: string;
  existingWorkAffected: string[];
  newWorkRequired: string[];
  completedWorkToReassess: string[];
  ownerName: string | null;
  approvalRequired: boolean;
}

export interface FrameworkImpactAnalysis {
  /** The revision being analysed (e.g. "1.1") against the approved baseline it supersedes. */
  baselineVersion: string;
  comparedToVersion: string;
  items: FrameworkImpactItem[];
  confirmedByName: string | null;
  confirmedAt: string | null;
  confirmationNote: string | null;
}

/**
 * Comparable facts frozen into every approved snapshot (Track B fills) — what the
 * next year's prior-year comparison and a revision's impact analysis diff against.
 */
export interface FrameworkSnapshotFacts {
  entityClass: string | null;
  listed: boolean | null;
  smallCompany: boolean | null;
  reportingFramework: string | null;
  smcStatus: string | null;
  scheduleIiiRoute: string | null;
  caro: string | null;
  icfr: string | null;
  cfsRequired: boolean | null;
  groupEntities: Array<{ name: string; relationship: string }>;
  componentAuditors: Array<{ component: string; auditor: string }>;
  branchAuditors: Array<{ branch: string; auditor: string }>;
  rule11Items: string[];
  section197Applicable: boolean | null;
  accountingSoftware: string[];
  auditTrailApplicable: boolean | null;
  ruleVersions: Array<{ ruleCode: string; versionLabel: string | null }>;
  methodologyVersion: string | null;
}

/** The frozen approved snapshot (§14) — historical baselines are preserved permanently. */
export interface FrameworkBaselineSnapshot {
  generatedAt: string;
  dashboard: FrameworkDashboardRow[];
  sections: FrameworkSummarySection[];
  triggeredRequirements: FrameworkTriggeredRequirement[];
  downstreamPreview: DownstreamPreviewItem[];
  facts: FrameworkSnapshotFacts;
}

// ── The whole 02.8 view ──────────────────────────────────────────────────────

/** The whole 02.8 summary for one statutory-audit workflow instance. */
export interface StatutoryAuditFrameworkSummary {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  header: FrameworkSummaryHeader;
  profileConfirmed: boolean;
  dashboard: FrameworkDashboardRow[];
  sections: FrameworkSummarySection[];
  triggeredRequirements: FrameworkTriggeredRequirement[];
  downstreamPreview: DownstreamPreviewItem[];
  matters: FrameworkSummaryMatter[];
  priorYear: FrameworkPriorYearComparison;
  memo: FrameworkMemoCard | null;
  impact: FrameworkImpactAnalysis | null;
  returns: FrameworkReturnItem[];
  baseline: FrameworkBaselineRecord | null;
  /** Every baseline version, newest first (superseded ones preserved). */
  history: FrameworkBaselineRecord[];
  /** The latest approval record (current or, while reopened, the superseded one). */
  approval: FrameworkApprovalRecord | null;
  gates: FrameworkSummaryGates;
  planning: FrameworkPlanningGate;
  /** True once Planning may proceed (approved, or an approved condition permits). */
  planningUnlocked: boolean;
  /** Optimistic-concurrency version of the current baseline (0 when none). */
  recordVersion: number;
}

/**
 * The two-gate approval readiness (pure, §9, §12, §18). AF-01 needs every source
 * decided, the 02.1 profile confirmed, no blocking matter, no open return item, a
 * reviewed preview and (on a revision) a confirmed impact analysis; AF-02 needs a
 * Manager-confirmed baseline, a submitted memorandum and no blocking matter.
 */
export function computeFrameworkGates(input: {
  sections: Pick<FrameworkSummarySection, 'decided'>[];
  profileConfirmed: boolean;
  hasBlockingMatter: boolean;
  baselineStatus: FrameworkBaselineStatus | null;
  openReturnCount?: number;
  impactConfirmed?: boolean;
  memoSubmitted?: boolean;
}): Pick<
  FrameworkSummaryGates,
  | 'allSectionsDecided'
  | 'profileConfirmed'
  | 'hasBlockingMatter'
  | 'openReturnCount'
  | 'impactConfirmed'
  | 'canConfirm'
  | 'canCreateMemo'
  | 'canApprove'
  | 'canReopen'
> {
  const allSectionsDecided = input.sections.length > 0 && input.sections.every((s) => s.decided);
  const openReturnCount = input.openReturnCount ?? 0;
  const impactConfirmed = input.impactConfirmed ?? true;
  const status = input.baselineStatus;
  const isApproved = status === FRAMEWORK_BASELINE_STATUS.approved;
  const isConfirmed = status === FRAMEWORK_BASELINE_STATUS.managerConfirmed;
  return {
    allSectionsDecided,
    profileConfirmed: input.profileConfirmed,
    hasBlockingMatter: input.hasBlockingMatter,
    openReturnCount,
    impactConfirmed,
    canConfirm:
      allSectionsDecided &&
      input.profileConfirmed &&
      !input.hasBlockingMatter &&
      openReturnCount === 0 &&
      impactConfirmed &&
      !isApproved &&
      !isConfirmed,
    canCreateMemo: isConfirmed,
    canApprove: isConfirmed && !input.hasBlockingMatter && (input.memoSubmitted ?? false),
    canReopen: isApproved,
  };
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** AF-01 — Manager review and confirmation (§9). */
export interface ConfirmFrameworkInput {
  decision: Af01Decision;
  note?: string | null;
  /** The Downstream Configuration Preview has been reviewed (§6, §18). Required for Yes. */
  previewReviewed?: boolean;
  /** Required for No: one item per affected source section. */
  returnItems?: Array<{
    section: FrameworkSourceSection;
    action: string;
    ownerEmployeeId?: string | null;
  }>;
  recordVersion: number;
}

/** AF-02 — Engagement Partner conclusion (§12). */
export interface ApproveFrameworkInput {
  decision: Af02Decision;
  methodologyVersion?: string | null;
  /** Required for Approve Subject to Conditions. */
  conditions?: Array<{
    condition: string;
    ownerEmployeeId?: string | null;
    dueDate: string;
    impact: string;
    planningMayCommence: boolean;
  }>;
  /** Required for Return for Further Work. */
  returnReason?: string | null;
  returnSections?: FrameworkSourceSection[];
  recordVersion: number;
}

/** Controlled reopen (§15) — preserves the approved baseline, opens the next revision. */
export interface ReopenFrameworkInput {
  reason: string;
  affectedSections: FrameworkSourceSection[];
  /** ISO date-time the change was identified. */
  identifiedAt: string;
  identifiedByEmployeeId?: string | null;
  evidenceNote?: string | null;
  evidenceDocumentId?: string | null;
  reapprovalRequired: boolean;
  recordVersion: number;
}

/** Clear a return item once the source section has addressed it. */
export interface ResolveFrameworkReturnInput {
  resolution: string;
}

/** Resolve an approval condition (§12). */
export interface ResolveFrameworkConditionInput {
  resolution: string;
}

/** Track B — professional confirmation of the system impact first pass (§15). */
export interface ConfirmFrameworkImpactInput {
  note?: string | null;
}
