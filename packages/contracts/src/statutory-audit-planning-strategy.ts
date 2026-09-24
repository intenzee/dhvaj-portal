/**
 * Statutory Audit — 03.1 remaining sub-sections (DHVAJ 03.1 §13.2–§13.3, §14–§16,
 * §18, §20; see docs/section-03-planning-build-spec.md).
 *
 *   • Strategic timing / resource considerations — generated from signals,
 *     assessed by the Manager, routed to 03.11 / 03.8 (no dates, no staff here).
 *   • 03.1.6 Prior-year intelligence — reassessed, never blindly rolled forward.
 *   • 03.1.7 Acceptance matters carried forward from Section 01.
 *   • 03.1.8 Initial engagement-team planning discussion.
 *   • §18 Planning Matter / Action register.
 *   • §20 completion checklist shown in the control room.
 */

// ── §13.2–13.3 Strategic considerations ──────────────────────────────────────

export const PLANNING_CONSIDERATION_KIND = {
  timing: 'timing',
  resource: 'resource',
} as const;
export type PlanningConsiderationKind =
  (typeof PLANNING_CONSIDERATION_KIND)[keyof typeof PLANNING_CONSIDERATION_KIND];
export const PLANNING_CONSIDERATION_KINDS: PlanningConsiderationKind[] = Object.values(
  PLANNING_CONSIDERATION_KIND,
);

/** Manager assessment of a timing (§13.2) or resource (§13.3) consideration. */
export const PLANNING_CONSIDERATION_ASSESSMENT = {
  relevant: 'relevant',
  notRelevant: 'not_relevant',
  furtherAssessment: 'further_assessment',
  likelyRequired: 'likely_required',
  considerIn0308: 'consider_in_03_8',
  notRequired: 'not_required',
} as const;
export type PlanningConsiderationAssessment =
  (typeof PLANNING_CONSIDERATION_ASSESSMENT)[keyof typeof PLANNING_CONSIDERATION_ASSESSMENT];

/** Assessments valid for each kind. */
export const PLANNING_CONSIDERATION_ASSESSMENTS_BY_KIND: Record<
  PlanningConsiderationKind,
  PlanningConsiderationAssessment[]
> = {
  timing: ['relevant', 'not_relevant', 'further_assessment'],
  resource: ['likely_required', 'consider_in_03_8', 'not_required'],
};
export const PLANNING_CONSIDERATION_ASSESSMENTS: PlanningConsiderationAssessment[] = Object.values(
  PLANNING_CONSIDERATION_ASSESSMENT,
);

export const PLANNING_CONSIDERATION_ASSESSMENT_LABEL: Record<
  PlanningConsiderationAssessment,
  string
> = {
  relevant: 'Relevant',
  not_relevant: 'Not relevant',
  further_assessment: 'Further assessment',
  likely_required: 'Likely required',
  consider_in_03_8: 'Consider in 03.8',
  not_required: 'Not required',
};

export interface PlanningConsiderationRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  kind: PlanningConsiderationKind;
  /** Stable key when generated (e.g. `interim_control_testing`); null when Manager-added. */
  considerationKey: string | null;
  label: string;
  /** Why the consideration was generated. */
  basis: string | null;
  signalId: string | null;
  /** Code of the prompting signal, e.g. `PS-003`, for traceability. */
  signalCode: string | null;
  /** Effective attention of the prompting signal (drives the rationale gate). */
  signalAttention: 'standard' | 'enhanced' | 'immediate_partner' | null;
  isAuto: boolean;
  assessment: PlanningConsiderationAssessment | null;
  rationale: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanningConsiderationInput {
  kind: PlanningConsiderationKind;
  label: string;
  basis?: string | null;
  signalId?: string | null;
}

export interface AssessPlanningConsiderationInput {
  assessment: PlanningConsiderationAssessment;
  rationale?: string | null;
  version: number;
}

// ── 03.1.6 Prior-year intelligence ───────────────────────────────────────────

export const PRIOR_YEAR_MATTER_TYPE = {
  modifiedOpinion: 'modified_opinion',
  caroException: 'caro_exception',
  controlDeficiency: 'control_deficiency',
  unadjustedMisstatement: 'unadjusted_misstatement',
  significantRisk: 'significant_risk',
  majorReviewPoint: 'major_review_point',
  significantEstimate: 'significant_estimate',
  partnerFocusArea: 'partner_focus_area',
} as const;
export type PriorYearMatterType =
  (typeof PRIOR_YEAR_MATTER_TYPE)[keyof typeof PRIOR_YEAR_MATTER_TYPE];
export const PRIOR_YEAR_MATTER_TYPES: PriorYearMatterType[] = Object.values(PRIOR_YEAR_MATTER_TYPE);

export const PRIOR_YEAR_MATTER_TYPE_LABEL: Record<PriorYearMatterType, string> = {
  modified_opinion: 'Modified opinion / Emphasis / Other Matter',
  caro_exception: 'CARO exception',
  control_deficiency: 'ICFR / control deficiency',
  unadjusted_misstatement: 'Unadjusted misstatement',
  significant_risk: 'Significant audit matter / significant risk',
  major_review_point: 'Major review point / difficult accounting matter',
  significant_estimate: 'Significant estimate',
  partner_focus_area: 'Prior Partner focus area',
};

export const PRIOR_YEAR_ASSESSMENT = {
  stillRelevant: 'still_relevant',
  changed: 'changed',
  resolved: 'resolved',
  furtherAssessment: 'further_assessment',
} as const;
export type PriorYearAssessment =
  (typeof PRIOR_YEAR_ASSESSMENT)[keyof typeof PRIOR_YEAR_ASSESSMENT];
export const PRIOR_YEAR_ASSESSMENTS: PriorYearAssessment[] = Object.values(PRIOR_YEAR_ASSESSMENT);

export const PRIOR_YEAR_ASSESSMENT_LABEL: Record<PriorYearAssessment, string> = {
  still_relevant: 'Still relevant',
  changed: 'Changed',
  resolved: 'Resolved',
  further_assessment: 'Further assessment',
};

/** Assessments that may create or link a current-year signal (§14). */
export const PRIOR_YEAR_SIGNAL_ASSESSMENTS: PriorYearAssessment[] = [
  PRIOR_YEAR_ASSESSMENT.stillRelevant,
  PRIOR_YEAR_ASSESSMENT.changed,
  PRIOR_YEAR_ASSESSMENT.furtherAssessment,
];

export interface PriorYearMatterRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  /** Human display code, e.g. `PY-001`. */
  matterCode: string;
  matterType: PriorYearMatterType;
  description: string;
  sourceEvidence: string | null;
  documentId: string | null;
  assessment: PriorYearAssessment | null;
  assessmentNote: string | null;
  signalId: string | null;
  signalCode: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePriorYearMatterInput {
  matterType: PriorYearMatterType;
  description: string;
  sourceEvidence?: string | null;
  documentId?: string | null;
}

export interface AssessPriorYearMatterInput {
  assessment: PriorYearAssessment;
  /** Required for `resolved`. */
  assessmentNote?: string | null;
  /** Generate a linked current-year signal (not with `resolved`). */
  createSignal?: boolean;
  /** Link to an existing signal instead (not with `resolved`). */
  linkSignalId?: string | null;
  version: number;
}

// ── 03.1.7 Acceptance matters carried forward ────────────────────────────────

export const ACCEPTANCE_CARRY_FORWARD_ACTION = {
  createSignal: 'create_signal',
  linkSignal: 'link_signal',
  noImplication: 'no_implication',
} as const;
export type AcceptanceCarryForwardAction =
  (typeof ACCEPTANCE_CARRY_FORWARD_ACTION)[keyof typeof ACCEPTANCE_CARRY_FORWARD_ACTION];
export const ACCEPTANCE_CARRY_FORWARD_ACTIONS: AcceptanceCarryForwardAction[] = Object.values(
  ACCEPTANCE_CARRY_FORWARD_ACTION,
);

export const ACCEPTANCE_CARRY_FORWARD_ACTION_LABEL: Record<AcceptanceCarryForwardAction, string> = {
  create_signal: 'Create Planning Signal',
  link_signal: 'Already addressed by existing signal',
  no_implication: 'No further planning implication',
};

/** An unresolved or conditional Section 01 acceptance matter, with its 03.1 conclusion. */
export interface AcceptanceCarryForwardRecord {
  matterId: string;
  /** Section 01 matter code, e.g. `M-002`. */
  matterCode: string;
  title: string;
  category: string;
  severity: string | null;
  /** Section 01 status (open / under_review / blocking / accepted_with_approval). */
  matterStatus: string;
  matterResolution: string | null;
  /** 03.1 conclusion; null until the Manager acts. */
  action: AcceptanceCarryForwardAction | null;
  signalId: string | null;
  signalCode: string | null;
  reason: string | null;
  /** Carry-forward row version (0 when not yet concluded). */
  version: number;
}

export interface ConcludeAcceptanceMatterInput {
  action: AcceptanceCarryForwardAction;
  /** Required for `link_signal`. */
  signalId?: string | null;
  /** Required for `no_implication`. */
  reason?: string | null;
  /** 0 when concluding for the first time. */
  version: number;
}

// ── 03.1.8 Team planning discussion ──────────────────────────────────────────

export interface PlanningDiscussionRecord {
  id: string | null;
  discussionDate: string | null;
  participantEmployeeIds: string[];
  participantNames: string[];
  signalIds: string[];
  focusIds: string[];
  additionalMatters: string | null;
  skepticismAreas: string | null;
  observations: string | null;
  /** 0 when not yet recorded. */
  version: number;
  updatedAt: string | null;
}

export interface UpdatePlanningDiscussionInput {
  discussionDate?: string | null;
  participantEmployeeIds?: string[];
  signalIds?: string[];
  focusIds?: string[];
  additionalMatters?: string | null;
  skepticismAreas?: string | null;
  observations?: string | null;
  /** 0 when recording for the first time. */
  version: number;
}

// ── §18 Planning Matter / Action register ────────────────────────────────────

export const PLANNING_MATTER_ORIGIN = {
  signal: 'signal',
  focusArea: 'focus_area',
  discussion: 'discussion',
} as const;
export type PlanningMatterOrigin =
  (typeof PLANNING_MATTER_ORIGIN)[keyof typeof PLANNING_MATTER_ORIGIN];
export const PLANNING_MATTER_ORIGINS: PlanningMatterOrigin[] = Object.values(PLANNING_MATTER_ORIGIN);

export const PLANNING_MATTER_CATEGORY = {
  scope: 'scope',
  information: 'information',
  timing: 'timing',
  resource: 'resource',
  reporting: 'reporting',
  technology: 'technology',
  component: 'component',
  specialist: 'specialist',
  other: 'other',
} as const;
export type PlanningMatterCategory =
  (typeof PLANNING_MATTER_CATEGORY)[keyof typeof PLANNING_MATTER_CATEGORY];
export const PLANNING_MATTER_CATEGORIES: PlanningMatterCategory[] =
  Object.values(PLANNING_MATTER_CATEGORY);

export const PLANNING_MATTER_STATUS = {
  open: 'open',
  inProgress: 'in_progress',
  resolved: 'resolved',
  carriedForward: 'carried_forward',
} as const;
export type PlanningMatterStatus =
  (typeof PLANNING_MATTER_STATUS)[keyof typeof PLANNING_MATTER_STATUS];
export const PLANNING_MATTER_STATUSES: PlanningMatterStatus[] =
  Object.values(PLANNING_MATTER_STATUS);

/** Planning modules a matter may affect (03.2–03.11). */
export const PLANNING_AFFECTED_MODULES = [
  '03.2',
  '03.3',
  '03.4',
  '03.5',
  '03.6',
  '03.7',
  '03.8',
  '03.9',
  '03.10',
  '03.11',
] as const;
export type PlanningAffectedModule = (typeof PLANNING_AFFECTED_MODULES)[number];

export interface PlanningMatterRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  /** Human display code, e.g. `PM-001`. */
  matterCode: string;
  origin: PlanningMatterOrigin;
  signalId: string | null;
  focusId: string | null;
  title: string;
  category: PlanningMatterCategory;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  partnerAttention: boolean;
  affectedModule: PlanningAffectedModule | null;
  status: PlanningMatterStatus;
  resolution: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanningMatterInput {
  origin: PlanningMatterOrigin;
  /** Required for origin `signal`. */
  signalId?: string | null;
  /** Required for origin `focus_area`. */
  focusId?: string | null;
  title: string;
  category: PlanningMatterCategory;
  ownerEmployeeId?: string | null;
  dueDate?: string | null;
  partnerAttention?: boolean;
  affectedModule?: PlanningAffectedModule | null;
}

export interface UpdatePlanningMatterInput {
  title?: string;
  category?: PlanningMatterCategory;
  ownerEmployeeId?: string | null;
  dueDate?: string | null;
  partnerAttention?: boolean;
  affectedModule?: PlanningAffectedModule | null;
  status?: PlanningMatterStatus;
  /** Required when resolving. */
  resolution?: string | null;
  version: number;
}

// ── §20 Completion checklist ─────────────────────────────────────────────────

export interface PlanningCompletionCheck {
  key: string;
  label: string;
  met: boolean;
  /** What is still outstanding, when not met. */
  detail: string | null;
}
