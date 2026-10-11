import type {
  PlanningAttention,
  PlanningSignalAssessment,
} from './statutory-audit-planning-signal';
import type {
  PlanningAffectedModule,
  PlanningMatterCategory,
} from './statutory-audit-planning-strategy';

/**
 * Statutory Audit — 03.1 governance & dynamics (DHVAJ 03.1 §10, §19, §20,
 * §23, §24). Who may do what in 03.1, the Immediate Partner Attention queue the
 * Engagement Partner works from, SharePoint-backed evidence on 03.1 records,
 * the controlled revision of 03.1 after Planning approval (03.12) and the
 * structured actions of the team planning discussion.
 */

// ── §23 Suggested permissions ────────────────────────────────────────────────

/** The acting user's 03.1 role on THIS engagement (never a firm role alone). */
export const PLANNING_ACTOR_ROLE = {
  /** Engagement Partner. */
  partner: 'partner',
  /** Engagement Manager (or the EP when no Manager is assigned). */
  manager: 'manager',
  /** Managing Partner / authorised firm-wide oversight per security policy. */
  oversight: 'oversight',
  /** Article / Senior / other engagement-team member. */
  team: 'team',
  /** No engagement assignment (e.g. Platform Admin) — no client-data access. */
  none: 'none',
} as const;
export type PlanningActorRole = (typeof PLANNING_ACTOR_ROLE)[keyof typeof PLANNING_ACTOR_ROLE];

export const PLANNING_ACTOR_ROLE_LABEL: Record<PlanningActorRole, string> = {
  partner: 'Engagement Partner',
  manager: 'Engagement Manager',
  oversight: 'Firm oversight',
  team: 'Engagement team',
  none: 'No engagement access',
};

/** What the acting user may do in 03.1 (the API enforces the same matrix). */
export interface PlanningCapabilities {
  /** Propose a Planning Signal for the Manager to assess (Article / Senior up). */
  proposeSignals: boolean;
  /** Record factual information — PI-01 changes, prior-year matters — and link evidence. */
  addFacts: boolean;
  /** Assess signals, AS-01/AS-02, considerations, prior-year / acceptance, complete 03.1. */
  assess: boolean;
  /** Create / update Areas of Focus (Manager; Partner focus areas for the EP). */
  focusAreas: boolean;
  /** Record the team planning discussion, its actions and Planning Matters. */
  discussion: boolean;
  /** Raise Partner signals. */
  partnerSignals: boolean;
  /** Acknowledge / challenge / flag Immediate Partner Attention (EP). */
  partnerReview: boolean;
  /** Answer an EP challenge (Manager). */
  respondToChallenge: boolean;
  /** Reopen 03.1 for a controlled revision after Planning approval. */
  reopen: boolean;
}

export type PlanningCapability = keyof PlanningCapabilities;

// ── §19 controlled revision after Planning approval (03.12) ─────────────────

export interface PlanningRevisionRecord {
  id: string;
  fromVersionLabel: string;
  toVersionLabel: string;
  reason: string;
  status: 'open' | 'completed';
  openedByName: string | null;
  openedAt: string;
  completedByName: string | null;
  completedAt: string | null;
}

/** One frozen 03.1 baseline, as preserved when the revision was opened. */
export interface PlanningRevisionBaseline extends PlanningRevisionRecord {
  baseline: Record<string, unknown>;
}

export interface ReopenPlanningIntelligenceInput {
  reason: string;
}

/** `v1.0`, `v1.1`, … for 03.1 version number 1, 2, … */
export function planningVersionLabel(versionNo: number): string {
  return `v1.${Math.max(0, versionNo - 1)}`;
}

/** The acting user's 03.1 access + lock state. */
export interface PlanningAccess {
  role: PlanningActorRole;
  roleLabel: string;
  /** The EP is acting as Manager because no Engagement Manager is assigned. */
  actingAsManager: boolean;
  /** The caller's employee id (owner checks on discussion actions). */
  employeeId: string | null;
  capabilities: PlanningCapabilities;
  /** Planning has been approved in 03.12. */
  approved: boolean;
  /** 03.1 is frozen: approved and no revision open. */
  locked: boolean;
  lockReason: string | null;
  versionNo: number;
  versionLabel: string;
  openRevision: PlanningRevisionRecord | null;
  revisions: PlanningRevisionRecord[];
}

// ── §10 / §20 Immediate Partner Attention queue ─────────────────────────────

export const PARTNER_ATTENTION_STATUS = {
  surfaced: 'surfaced',
  acknowledged: 'acknowledged',
  challenged: 'challenged',
  responded: 'responded',
} as const;
export type PartnerAttentionStatus =
  (typeof PARTNER_ATTENTION_STATUS)[keyof typeof PARTNER_ATTENTION_STATUS];

export const PARTNER_ATTENTION_STATUS_LABEL: Record<PartnerAttentionStatus, string> = {
  surfaced: 'Awaiting EP',
  acknowledged: 'Acknowledged by EP',
  challenged: 'Challenged by EP',
  responded: 'Manager responded',
};

export interface PartnerAttentionItem {
  /** The governance row id (acknowledge / challenge / respond address it). */
  id: string;
  kind: 'signal' | 'focus_area';
  /** The signal / Area of Focus id. */
  targetId: string;
  /** PS-00n / FA-00n. */
  code: string;
  title: string;
  detail: string | null;
  attention: PlanningAttention | null;
  managerAssessment: PlanningSignalAssessment | null;
  surfacedAt: string | null;
  status: PartnerAttentionStatus;
  raisedByPartner: boolean;
  partnerNote: string | null;
  challenge: string | null;
  challengedAt: string | null;
  managerResponse: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  version: number;
}

export interface PartnerAttentionQueue {
  engagementPartnerName: string | null;
  items: PartnerAttentionItem[];
  /** Items the EP has not yet acknowledged. */
  outstanding: number;
}

export interface AcknowledgePartnerAttentionInput {
  note?: string | null;
  version: number;
}

export interface ChallengePartnerAttentionInput {
  challenge: string;
  version: number;
}

export interface RespondPartnerAttentionInput {
  response: string;
  version: number;
}

/** EP flags a signal (raises it to Immediate Partner Attention) or a focus area. */
export interface FlagPartnerAttentionInput {
  signalId?: string | null;
  focusId?: string | null;
  note: string;
}

// ── §24 SharePoint evidence on 03.1 records ─────────────────────────────────

export const PLANNING_EVIDENCE_TARGET = {
  signal: 'signal',
  change: 'change',
  priorYear: 'prior_year',
  acceptance: 'acceptance',
  discussion: 'discussion',
} as const;
export type PlanningEvidenceTarget =
  (typeof PLANNING_EVIDENCE_TARGET)[keyof typeof PLANNING_EVIDENCE_TARGET];
export const PLANNING_EVIDENCE_TARGETS: PlanningEvidenceTarget[] =
  Object.values(PLANNING_EVIDENCE_TARGET);

export interface PlanningEvidenceFile {
  id: string;
  targetType: PlanningEvidenceTarget;
  targetId: string;
  documentId: string;
  title: string;
  filename: string | null;
  currentVersionNo: number;
  lastEditedBy: string | null;
  linkedByName: string | null;
  linkedAt: string;
  inSharePoint: boolean;
  editLocked: boolean;
  /** The acting user may remove this link (lead, or the member who linked it). */
  removable: boolean;
}

export interface PlanningEvidenceView {
  targetType: PlanningEvidenceTarget;
  targetId: string;
  files: PlanningEvidenceFile[];
  /** May link here (03.1 not frozen and the user may record facts). */
  canAdd: boolean;
  /**
   * May upload a new file (Add File). Engagement documents are created by the
   * EP / Manager (platform document rule); the team links existing files.
   */
  canUpload: boolean;
  m365Enabled: boolean;
}

export interface LinkPlanningEvidenceInput {
  targetType: PlanningEvidenceTarget;
  targetId: string;
  documentId: string;
}

export interface AddPlanningEvidenceInput {
  targetType: PlanningEvidenceTarget;
  targetId: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
  title?: string;
}

// ── 03.1.8 team discussion — actions + new signals (§16, §18) ───────────────

export interface CreateDiscussionActionInput {
  title: string;
  ownerEmployeeId: string;
  dueDate?: string | null;
  category?: PlanningMatterCategory;
  affectedModule?: PlanningAffectedModule | null;
  partnerAttention?: boolean;
}

export interface CreateDiscussionSignalInput {
  observation: string;
  whyMayMatter?: string | null;
  suggestedAttention?: PlanningAttention;
}

export interface DiscussionSignalCreated {
  id: string;
  signalCode: string;
}

// ── The governance read the 03.1 control room loads once ────────────────────

/** A downstream planning sub-area flagged for reassessment by a 03.1 change (§19). */
export interface PlanningDownstreamFlag {
  itemKey: string;
  title: string;
  /** e.g. `03.4`, `03.6`. */
  module: string;
}

export interface PlanningGovernanceView {
  access: PlanningAccess;
  partnerAttention: PartnerAttentionQueue;
  /** Signals proposed by the engagement team and not yet assessed, by signal id. */
  proposals: Record<string, { proposedByName: string | null; proposedAt: string }>;
  /** Evidence links per 03.1 record id (signal / change / prior-year / acceptance / discussion). */
  evidenceCounts: Record<string, number>;
  /** Downstream sub-areas currently flagged Needs Attention. */
  downstreamFlags: PlanningDownstreamFlag[];
}
