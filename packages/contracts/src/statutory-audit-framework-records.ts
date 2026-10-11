/**
 * 02.8 Track B — the records behind the Audit Framework Summary (spec v1.0 §5–§8,
 * §10–§11, §14–§17): matter actions, the Audit Framework Memorandum lifecycle,
 * the change-impact confirmation and the downstream-work links that keep
 * completed work tied to the baseline that configured it. The summary view
 * types themselves live in `statutory-audit-framework-summary.ts` (Track A).
 */

import type { FrameworkMatterCategory } from './statutory-audit-matters';
import type {
  FrameworkImpactAnalysis,
  FrameworkMemoCard,
  FrameworkSourceSection,
} from './statutory-audit-framework-summary';

// ── Framework Matters (§7) ───────────────────────────────────────────────────

/** The §7 category wording. */
export const FRAMEWORK_MATTER_CATEGORY_LABEL: Record<FrameworkMatterCategory, string> = {
  information_pending: 'Information Pending',
  technical_judgment: 'Technical Judgment',
  framework_override: 'Framework Override',
  legal_interpretation: 'Legal / Regulatory Interpretation',
  partner_consultation: 'Partner Consultation',
  blocking: 'Blocking Matter',
};

/**
 * Record what 02.8 may add to an aggregated matter: impact, Partner Attention,
 * the resolution, owner and due date. The matter itself (category, blocking,
 * status) stays owned by the 02.x section that raised it.
 */
export interface UpdateFrameworkMatterInput {
  partnerAttention?: boolean;
  impact?: string | null;
  resolution?: string | null;
  ownerEmployeeId?: string | null;
  dueDate?: string | null;
}

/**
 * Send a matter back to its originating section (§7, §9): the same matter is
 * re-assigned and set Under Review — never recreated.
 */
export interface ReturnFrameworkMatterInput {
  note: string;
  ownerEmployeeId?: string | null;
}

// ── Audit Framework Memorandum (§10–§11) ─────────────────────────────────────

export const FRAMEWORK_MEMO_STATUS = {
  draft: 'draft',
  submitted: 'submitted',
  approved: 'approved',
  superseded: 'superseded',
} as const;
export type FrameworkMemoStatus =
  (typeof FRAMEWORK_MEMO_STATUS)[keyof typeof FRAMEWORK_MEMO_STATUS];

export const FRAMEWORK_MEMO_STATUS_LABEL: Record<FrameworkMemoStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted for Review',
  approved: 'Approved (controlled)',
  superseded: 'Superseded',
};

/** The 16 memorandum sections (§10), in document order. */
export const FRAMEWORK_MEMO_SECTIONS = [
  'Engagement Details',
  'Entity & Regulatory Classification',
  'Financial Reporting Framework',
  'Schedule III / Presentation',
  'CARO',
  'ICFR',
  'CFS / Consolidation',
  'Component / Branch Auditors',
  'Other Statutory Reporting',
  'Triggered Audit Considerations',
  'Significant Framework Judgments',
  'System Overrides',
  'Prior-Year Changes',
  'Open Non-blocking Matters',
  'Manager Conclusion',
  'Engagement Partner Approval',
] as const;

export interface CreateFrameworkMemorandumInput {
  /** A specific template variant; the selection rules pick one when omitted. */
  variantKey?: string;
}

/** The memo just generated from the approved DHVAJ template. */
export interface FrameworkMemorandumCreated {
  memo: FrameworkMemoCard;
  memoId: string;
  /** Microsoft 365 editor (AutoSave) when the tenant is connected. */
  editorUrl: string | null;
  /** Template fields the framework had no value for (left visible in the document). */
  missingFields: string[];
}

/** Every memorandum of the audit file — approved ones are preserved per revision (§11, §14). */
export interface FrameworkMemoHistoryItem {
  memoId: string;
  documentId: string;
  fileName: string;
  baselineVersion: string;
  status: FrameworkMemoStatus;
  preparedByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  controlledVersionNo: number | null;
}

// ── Change impact and downstream links (§14–§17) ─────────────────────────────

/** How a downstream work item relates to a baseline (§14, §17). */
export const FRAMEWORK_WORK_RELATION = {
  configuredBy: 'configured_by',
  superseded: 'superseded',
} as const;
export type FrameworkWorkRelation =
  (typeof FRAMEWORK_WORK_RELATION)[keyof typeof FRAMEWORK_WORK_RELATION];

export const FRAMEWORK_WORK_KIND = {
  workArea: 'work_area',
  caroProgramme: 'caro_programme',
  icfrWorkstream: 'icfr_workstream',
  groupComponent: 'group_component',
  groupBranch: 'group_branch',
  reportingCard: 'reporting_card',
} as const;
export type FrameworkWorkKind = (typeof FRAMEWORK_WORK_KIND)[keyof typeof FRAMEWORK_WORK_KIND];

/** One downstream work item linked to an Audit Framework baseline. */
export interface FrameworkWorkLink {
  workKind: FrameworkWorkKind;
  workRef: string;
  label: string;
  section: string;
  ownerName: string | null;
  completed: boolean;
  relation: FrameworkWorkRelation;
  reassessmentRequired: boolean;
  reassessmentReason: string | null;
}

/** The impact view with the work preserved against the superseded baseline (§17). */
export interface FrameworkImpactView {
  analysis: FrameworkImpactAnalysis | null;
  supersededWork: FrameworkWorkLink[];
}

/**
 * A reopened framework revision as Section 07 Completion and Section 08
 * Reporting see it (§17): where reporting implications arise, the change is
 * surfaced there until the revision is re-approved.
 */
export interface FrameworkRevisionNotice {
  baselineVersion: string;
  comparedToVersion: string;
  reason: string | null;
  reopenedAt: string | null;
  affectedSections: FrameworkSourceSection[];
  /** Plain-words reporting implications, e.g. "CARO: Exempt → Applicable". */
  reportingImpacts: string[];
  impactConfirmed: boolean;
  /** True once the revision is re-approved (the notice then becomes history). */
  reapproved: boolean;
}
