/**
 * Statutory Audit — 03.3 governance (DHVAJ 03.3 §20, §21, §23).
 *
 * Who may do what on 03.3 (the §23 role matrix shared with 03.1 / 03.2): the
 * engagement team prepares source data and supporting drafts, the Engagement
 * Manager determines and completes, the Engagement Partner views, challenges,
 * revises and may require reassessment. Plus the "reassessment required" flag
 * on a completed version (03.2 figures moved / EP required it) and the EP's
 * comments / challenges with the Manager's response.
 */

import type {
  PlanningActorRole,
  PlanningCapabilities,
} from './statutory-audit-planning-governance';
import type { UpdateMaterialityInput } from './statutory-audit-materiality';

// ── §23 access ───────────────────────────────────────────────────────────────

/**
 * Determination fields the engagement team (Article / Senior) may prepare:
 * user context (MAT-01 / MAT-02 drafts the Manager confirms), prior-year
 * materiality and the normalisation rationale draft. Every other field is a
 * materiality judgment for the Engagement Manager.
 */
export const MATERIALITY_TEAM_FIELDS = [
  'principalUsers',
  'principalUsersOther',
  'userFocus',
  'userFocusOther',
  'pyOverallMateriality',
  'pyPerformanceMateriality',
  'pyClearlyTrivial',
  'pyBenchmark',
  'pySource',
  'pyAuditDifferences',
  'normalisationRationale',
] as const satisfies readonly (keyof UpdateMaterialityInput)[];
export type MaterialityTeamField = (typeof MATERIALITY_TEAM_FIELDS)[number];

export interface MaterialityAccess {
  role: PlanningActorRole;
  roleLabel: string;
  /** The EP stands in for an unassigned Engagement Manager. */
  actingAsManager: boolean;
  capabilities: PlanningCapabilities;
  /** Planning is approved in 03.12 — only a revision (03.3.11) changes materiality now. */
  planningApproved: boolean;
}

// ── §20 / §23 reassessment of a completed version ────────────────────────────

export type MaterialityReassessmentSource = 'source_change' | 'partner';

export const MATERIALITY_REASSESSMENT_SOURCE_LABEL: Record<MaterialityReassessmentSource, string> = {
  source_change: '03.2 source figures changed',
  partner: 'Required by the Engagement Partner',
};

export interface MaterialityReassessment {
  /** True until the Manager resolves it (or a revision takes it over). */
  open: boolean;
  source: MaterialityReassessmentSource;
  reason: string;
  flaggedAt: string;
  flaggedByName: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
}

export interface RequireMaterialityReassessmentInput {
  reason: string;
  /** Optimistic lock on the determination. */
  version: number;
}

/** "Reassessed — no change": the Manager's reasoned decision to keep the version in force. */
export interface ResolveMaterialityReassessmentInput {
  resolution: string;
  version: number;
}

// ── §23 Engagement Partner comments / challenges ─────────────────────────────

export const MATERIALITY_CHALLENGE_TARGET = {
  context: 'context',
  benchmarks: 'benchmarks',
  normalisation: 'normalisation',
  overall: 'overall',
  performance: 'performance',
  specific: 'specific',
  clearlyTrivial: 'clearly_trivial',
  qualitative: 'qualitative',
  sensitivity: 'sensitivity',
  revision: 'revision',
  conclusion: 'conclusion',
} as const;
export type MaterialityChallengeTarget =
  (typeof MATERIALITY_CHALLENGE_TARGET)[keyof typeof MATERIALITY_CHALLENGE_TARGET];
export const MATERIALITY_CHALLENGE_TARGETS: MaterialityChallengeTarget[] = Object.values(
  MATERIALITY_CHALLENGE_TARGET,
);

export const MATERIALITY_CHALLENGE_TARGET_LABEL: Record<MaterialityChallengeTarget, string> = {
  context: '03.3.1 Materiality context',
  benchmarks: '03.3.2 Benchmark assessment',
  normalisation: '03.3.3 Normalised benchmark',
  overall: '03.3.5 Overall materiality',
  performance: '03.3.6 Performance materiality',
  specific: '03.3.7 Specific materiality',
  clearly_trivial: '03.3.8 Clearly trivial threshold',
  qualitative: '03.3.9 Qualitative challenge',
  sensitivity: '03.3.10 Sensitivity',
  revision: '03.3.11 Revision',
  conclusion: '03.3.12 Conclusion',
};

export const MATERIALITY_CHALLENGE_KINDS = ['comment', 'challenge'] as const;
export type MaterialityChallengeKind = (typeof MATERIALITY_CHALLENGE_KINDS)[number];

export type MaterialityChallengeStatus = 'open' | 'responded' | 'closed';

export interface MaterialityChallengeRecord {
  id: string;
  /** `PC-001` … */
  code: string;
  targetType: MaterialityChallengeTarget;
  /** Candidate benchmark key, SM-00n code, consideration key … or null for the whole area. */
  targetRef: string | null;
  /** Human label of what the comment is about. */
  targetLabel: string;
  /** The 03.3 version it was raised on (`v1.0`, …). */
  versionLabel: string;
  kind: MaterialityChallengeKind;
  body: string;
  raisedByName: string | null;
  raisedAt: string;
  response: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
  status: MaterialityChallengeStatus;
  version: number;
}

export interface CreateMaterialityChallengeInput {
  targetType: MaterialityChallengeTarget;
  targetRef?: string | null;
  kind: MaterialityChallengeKind;
  body: string;
}

export interface RespondMaterialityChallengeInput {
  response: string;
  version: number;
}

export interface CloseMaterialityChallengeInput {
  version: number;
}

// ── Summary block ────────────────────────────────────────────────────────────

export interface MaterialityGovernance {
  access: MaterialityAccess;
  challenges: MaterialityChallengeRecord[];
  /** The latest reassessment flag on the version in force (open or resolved), if any. */
  reassessment: MaterialityReassessment | null;
  /** §21 — live evidence files per 03.3 record id (determination / adjustment / specific / qualitative). */
  evidenceCounts: Record<string, number>;
}
