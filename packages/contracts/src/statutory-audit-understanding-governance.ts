/**
 * Statutory Audit — 03.2 governance (DHVAJ 03.2 §18, §20, §21, §23, §25).
 *
 * Who may do what on 03.2 (the same §23 role matrix as 03.1), the completion
 * lock and controlled revision of a completed 03.2 (v1.0 → v1.1 with a
 * frozen baseline), the Engagement Partner's comments / challenges, and the
 * Manager's confirmation of the suggested industry considerations.
 */

import type {
  PlanningActorRole,
  PlanningCapabilities,
} from './statutory-audit-planning-governance';

// ── §23 access ───────────────────────────────────────────────────────────────

export interface UnderstandingAccess {
  role: PlanningActorRole;
  roleLabel: string;
  /** The EP stands in for an unassigned Engagement Manager. */
  actingAsManager: boolean;
  capabilities: PlanningCapabilities;
  /** True when 03.2 cannot be edited now (completed, or Planning approved in 03.12). */
  locked: boolean;
  lockReason: string | null;
  /** Planning is approved in 03.12 and frozen (03.2 cannot be reopened from here). */
  planningLocked: boolean;
}

// ── §20 version + controlled revision ────────────────────────────────────────

export interface UnderstandingVersionInfo {
  versionNo: number;
  /** `v1.0`, `v1.1`, … */
  versionLabel: string;
  completedAt: string | null;
  completedByName: string | null;
  /** Why a completed 03.2 needs reassessment (system-flagged), when it does. */
  reassessmentReason: string | null;
  reassessmentFlaggedAt: string | null;
}

export interface UnderstandingRevisionRecord {
  id: string;
  fromVersionNo: number;
  toVersionNo: number;
  fromLabel: string;
  toLabel: string;
  reason: string;
  status: 'open' | 'completed';
  openedByName: string | null;
  openedAt: string;
  completedByName: string | null;
  completedAt: string | null;
}

/** One figure, card or section as it stood in the completed version. */
export interface UnderstandingRevisionChange {
  area: 'figure' | 'section' | 'exception' | 'conclusion';
  label: string;
  before: string | null;
  after: string | null;
}

export interface UnderstandingRevisionDetail extends UnderstandingRevisionRecord {
  /** What differs between the frozen baseline and 03.2 as it is now. */
  changes: UnderstandingRevisionChange[];
}

export interface ReopenUnderstandingInput {
  reason: string;
  version: number;
}

// ── §23 Engagement Partner comments / challenges ─────────────────────────────

export const UNDERSTANDING_CHALLENGE_TARGET = {
  section: 'section',
  dataset: 'dataset',
  analytics: 'analytics',
  exception: 'exception',
  expectation: 'expectation',
  conclusion: 'conclusion',
} as const;
export type UnderstandingChallengeTarget =
  (typeof UNDERSTANDING_CHALLENGE_TARGET)[keyof typeof UNDERSTANDING_CHALLENGE_TARGET];
export const UNDERSTANDING_CHALLENGE_TARGETS: UnderstandingChallengeTarget[] = Object.values(
  UNDERSTANDING_CHALLENGE_TARGET,
);

export const UNDERSTANDING_CHALLENGE_KINDS = ['comment', 'challenge'] as const;
export type UnderstandingChallengeKind = (typeof UNDERSTANDING_CHALLENGE_KINDS)[number];

export type UnderstandingChallengeStatus = 'open' | 'responded' | 'closed';

export interface UnderstandingChallengeRecord {
  id: string;
  /** `PC-001` … */
  code: string;
  targetType: UnderstandingChallengeTarget;
  /** Section key, card / expectation id, or null for the whole area. */
  targetRef: string | null;
  /** Human label of what the comment is about (e.g. `03.2.3 Industry…`, `AX-002`). */
  targetLabel: string;
  kind: UnderstandingChallengeKind;
  body: string;
  raisedByName: string | null;
  raisedAt: string;
  response: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
  status: UnderstandingChallengeStatus;
  version: number;
}

export interface CreateUnderstandingChallengeInput {
  targetType: UnderstandingChallengeTarget;
  targetRef?: string | null;
  kind: UnderstandingChallengeKind;
  body: string;
}

export interface RespondUnderstandingChallengeInput {
  response: string;
  version: number;
}

export interface CloseUnderstandingChallengeInput {
  version: number;
}

// ── §7 Manager confirmation of suggested industry considerations ─────────────

export interface IndustryConsiderationDecision {
  relevant: boolean;
  note: string | null;
  byName: string | null;
  at: string;
}

export interface DecideIndustryConsiderationInput {
  /** The suggested consideration's text, as listed in the summary. */
  consideration: string;
  /** `null` clears the decision. */
  relevant: boolean | null;
  note?: string | null;
}

// ── §18 Areas of Focus the analytics findings feed ───────────────────────────

export interface UnderstandingFocusLink {
  id: string;
  code: string;
  name: string;
}

// ── §21 prior-year protection ────────────────────────────────────────────────

export interface RolledForwardInfo {
  /** FY label of the file the figure came from. */
  fromFinancialYear: string | null;
  amount: number;
  /** Last year's 03.2 was completed — changing the figure needs a reason. */
  approved: boolean;
}
