/**
 * 02.4 — CARO 2020 clause work programme (Level 2), the clause library and the
 * draft CARO annexure (DHVAJ Section 02.4 spec §11–§15, §18).
 *
 * Level 1 (does CARO apply to the report) is decided by the 02.4 applicability
 * assessment. Once it concludes CARO applies to the standalone report, the
 * versioned clause library in force for the audit period is instantiated as
 * clause work items — the team never creates clause workpapers by hand. If the
 * consolidated financial statements are in scope, only clause 3(xxi) is
 * configured for them. A later "not applicable" conclusion withdraws the items
 * (never deletes them).
 *
 * Level 2 is each clause's relevance to the entity's facts. A clause marked
 * Not Applicable to Facts NEVER changes the Level-1 conclusion.
 *
 * Nothing about the clauses lives in code: the clause list, requirement text,
 * provision and guidance codes, related Schedule III disclosures, audit areas
 * and procedures all come from `caro_clause_library`.
 */

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const CARO_REPORT_CONTEXT = {
  standalone: 'standalone',
  consolidated: 'consolidated',
} as const;
export type CaroReportContext = (typeof CARO_REPORT_CONTEXT)[keyof typeof CARO_REPORT_CONTEXT];

export const CARO_REPORT_CONTEXT_LABEL: Record<CaroReportContext, string> = {
  standalone: 'Standalone financial statements',
  consolidated: 'Consolidated financial statements',
};

/** Level 2 — the clause's relevance to the entity's facts (spec §11, §12). */
export const CARO_RELEVANCE = {
  applicable: 'applicable',
  notApplicableToFacts: 'not_applicable_to_facts',
  assessmentRequired: 'assessment_required',
} as const;
export type CaroRelevance = (typeof CARO_RELEVANCE)[keyof typeof CARO_RELEVANCE];
export const CARO_RELEVANCES: CaroRelevance[] = Object.values(CARO_RELEVANCE);

export const CARO_RELEVANCE_LABEL: Record<CaroRelevance, string> = {
  applicable: 'Applicable',
  not_applicable_to_facts: 'Not Applicable to Facts',
  assessment_required: 'Assessment Required',
};

/** The clause conclusion (spec §11). */
export const CARO_CLAUSE_CONCLUSION = {
  noReportableException: 'no_reportable_exception',
  reportableMatter: 'reportable_matter',
  notApplicableToFacts: 'not_applicable_to_facts',
  furtherWorkRequired: 'further_work_required',
} as const;
export type CaroClauseConclusion =
  (typeof CARO_CLAUSE_CONCLUSION)[keyof typeof CARO_CLAUSE_CONCLUSION];
export const CARO_CLAUSE_CONCLUSIONS: CaroClauseConclusion[] = Object.values(
  CARO_CLAUSE_CONCLUSION,
);

export const CARO_CLAUSE_CONCLUSION_LABEL: Record<CaroClauseConclusion, string> = {
  no_reportable_exception: 'No reportable exception',
  reportable_matter: 'Reportable matter',
  not_applicable_to_facts: 'Not applicable to facts',
  further_work_required: 'Further work required',
};

/** Preparer → reviewer flow of a clause conclusion (spec §13). */
export const CARO_REVIEW_STATE = {
  open: 'open',
  submitted: 'submitted',
  returned: 'returned',
  approved: 'approved',
} as const;
export type CaroReviewState = (typeof CARO_REVIEW_STATE)[keyof typeof CARO_REVIEW_STATE];

export const CARO_REVIEW_STATE_LABEL: Record<CaroReviewState, string> = {
  open: 'Open',
  submitted: 'Submitted for review',
  returned: 'Returned',
  approved: 'Approved',
};

export const CARO_FINDING_SEVERITIES = ['low', 'medium', 'high'] as const;
export type CaroFindingSeverity = (typeof CARO_FINDING_SEVERITIES)[number];

export const CARO_COMPONENT_APPLICABLE = ['yes', 'no', 'pending'] as const;
export type CaroComponentApplicable = (typeof CARO_COMPONENT_APPLICABLE)[number];

export const CARO_COMPONENT_APPLICABLE_LABEL: Record<CaroComponentApplicable, string> = {
  yes: 'Yes',
  no: 'No',
  pending: 'Pending',
};

// ── Library ──────────────────────────────────────────────────────────────────

/** A methodology procedure linked to a clause (library data). */
export interface CaroClauseProcedure {
  key: string;
  title: string;
  objective: string;
  evidence: string | null;
}

/** One notified version of the Order (library). */
export interface CaroOrderVersion {
  id: string;
  orderCode: string;
  title: string;
  versionLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  notificationReference: string | null;
  provisionCode: string;
  applicabilityProvisionCode: string | null;
  guidanceProvisionCode: string | null;
  guidanceVersion: string | null;
}

/** One clause or sub-clause row of the versioned library (spec §11). */
export interface CaroLibraryClause {
  id: string;
  orderCode: string;
  clauseCode: string;
  parentClauseCode: string | null;
  clauseRef: string;
  title: string;
  requirement: string;
  reportContext: CaroReportContext;
  provisionCode: string;
  guidanceProvisionCode: string | null;
  guidanceReference: string | null;
  relevanceHint: string | null;
  /** Division-agnostic Schedule III disclosure keys (02.3 resolves `SCH3_<division>_<key>`). */
  scheduleIiiKeys: string[];
  /** 03.5 audit-area library codes. */
  auditAreaCodes: string[];
  procedures: CaroClauseProcedure[];
  requiresPartnerReview: boolean;
  sortOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** The library in force for a date: the Order version and its clauses. */
export interface CaroClauseLibraryView {
  on: string;
  orderVersion: CaroOrderVersion | null;
  clauses: CaroLibraryClause[];
}

// ── Level 1 as Level 2 sees it ───────────────────────────────────────────────

/** Why the programme is (or is not) instantiated. */
export const CARO_PROGRAMME_STATE = {
  /** 02.4 has no professional conclusion yet — nothing is generated. */
  awaitingConclusion: 'awaiting_conclusion',
  /** CARO does not apply to any report context — no programme. */
  notApplicable: 'not_applicable',
  /** Instantiated and live. */
  active: 'active',
  /** Instantiated earlier; the current conclusion withdrew it (kept for the record). */
  withdrawn: 'withdrawn',
  /** CARO applies but no library version is in force for the audit period. */
  noLibrary: 'no_library',
} as const;
export type CaroProgrammeState = (typeof CARO_PROGRAMME_STATE)[keyof typeof CARO_PROGRAMME_STATE];

export const CARO_PROGRAMME_STATE_LABEL: Record<CaroProgrammeState, string> = {
  awaiting_conclusion: 'Generated after applicability is confirmed',
  not_applicable: 'Not required — CARO does not apply',
  active: 'Instantiated',
  withdrawn: 'Withdrawn',
  no_library: 'No CARO clause library for this period',
};

/** The consolidated (3(xxi)) side of the programme. */
export const CARO_CONSOLIDATED_STATE = {
  /** No consolidated financial statements in scope. */
  notRequired: 'not_required',
  /** CFS in scope but 02.6 has not concluded — the 3(xxi) item waits. */
  pending: 'pending',
  /** The 3(xxi) item is configured. */
  configured: 'configured',
} as const;
export type CaroConsolidatedState =
  (typeof CARO_CONSOLIDATED_STATE)[keyof typeof CARO_CONSOLIDATED_STATE];

export const CARO_CONSOLIDATED_STATE_LABEL: Record<CaroConsolidatedState, string> = {
  not_required: 'Not required — no consolidated financial statements',
  pending: 'Pending 02.6 — consolidated scope not yet concluded',
  configured: 'Clause 3(xxi) configured',
};

/** The Level-1 inputs the programme acted on (from the 02.4 approved result). */
export interface CaroProgrammeLevel1 {
  outcome: string | null;
  decided: boolean;
  complete: boolean;
  standaloneApplies: boolean | null;
  consolidatedApplies: boolean | null;
  consolidatedStatus: 'applicable' | 'not_applicable' | 'pending';
  cfsInScope: boolean;
  financialYear: string | null;
  periodStart: string;
}

// ── Clause work ──────────────────────────────────────────────────────────────

export interface CaroClauseEvidenceLink {
  id: string;
  documentId: string | null;
  auditEvidenceId: string | null;
  title: string;
  filename: string | null;
  inSharePoint: boolean;
  note: string | null;
  linkedByName: string | null;
  linkedAt: string;
}

export interface CaroFinding {
  id: string;
  /** Display code, CF-001. */
  code: string;
  itemId: string;
  clauseRef: string;
  description: string;
  severity: CaroFindingSeverity;
  workAreaKey: string | null;
  workAreaTitle: string | null;
  procedureId: string | null;
  procedureRef: string | null;
  amount: number | null;
  includeInReport: boolean;
  managementResponse: string | null;
  status: 'open' | 'resolved';
  resolution: string | null;
  raisedByName: string | null;
  withdrawn: boolean;
  createdAt: string;
  version: number;
}

/** One company included in the CFS, for clause 3(xxi) (spec §14). */
export interface CaroComponent {
  id: string;
  source: '02.6' | 'manual';
  componentName: string;
  relationship: string | null;
  caroApplicable: CaroComponentApplicable;
  auditorName: string | null;
  auditorReportDocumentId: string | null;
  auditorReportTitle: string | null;
  qualificationIdentified: boolean | null;
  paragraphRefs: string | null;
  remarks: string | null;
  /** No longer in the 02.6 perimeter (kept for the record). */
  withdrawn: boolean;
  version: number;
}

/** Prior-year context for a clause (spec §15) — reference only. */
export interface CaroPriorClause {
  financialYear: string;
  conclusion: CaroClauseConclusion | null;
  reportingLanguage: string | null;
  findings: string[];
}

export interface CaroRelatedWorkArea {
  workAreaKey: string;
  title: string;
}

export interface CaroClauseItem {
  id: string;
  clauseCode: string;
  parentClauseCode: string | null;
  clauseRef: string;
  parentTitle: string | null;
  title: string;
  requirement: string;
  reportContext: CaroReportContext;
  provisionCode: string;
  guidanceProvisionCode: string | null;
  guidanceReference: string | null;
  relevanceHint: string | null;
  scheduleIiiKeys: string[];
  /** The 02.3 disclosure requirement IDs the keys resolve to for this engagement's Division. */
  scheduleIiiRequirementCodes: string[];
  auditAreaCodes: string[];
  /** The Section 06 work areas of this file the clause cross-refers to. */
  relatedWorkAreas: CaroRelatedWorkArea[];
  procedures: CaroClauseProcedure[];
  requiresPartnerReview: boolean;
  relevance: CaroRelevance;
  relevanceReason: string | null;
  workPerformed: string | null;
  managementResponse: string | null;
  draftReporting: string | null;
  conclusion: CaroClauseConclusion | null;
  conclusionNote: string | null;
  reviewState: CaroReviewState;
  returnNote: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  partnerReviewedByName: string | null;
  partnerReviewedAt: string | null;
  /** The Section 06 procedure generated for the clause. */
  procedureId: string | null;
  procedureRef: string | null;
  withdrawn: boolean;
  evidence: CaroClauseEvidenceLink[];
  findings: CaroFinding[];
  /** Clause 3(xxi) only. */
  components: CaroComponent[];
  priorYear: CaroPriorClause | null;
  /** What still stops approval (empty when it can be approved). */
  approvalBlockers: string[];
  version: number;
}

export interface CaroProgrammeSummary {
  total: number;
  applicable: number;
  notApplicableToFacts: number;
  assessmentRequired: number;
  approved: number;
  reportable: number;
  openFindings: number;
}

export interface CaroProgrammeRecord {
  id: string;
  orderCode: string;
  orderTitle: string;
  orderVersionLabel: string;
  periodStart: string;
  status: 'active' | 'withdrawn';
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  instantiatedAt: string;
}

/** Prior-year CARO context (spec §15). */
export interface CaroPriorYearContext {
  financialYear: string;
  /** Prior-year Level-1 conclusion (display only — the current year reruns the rules). */
  applicability: string | null;
  /** Prior-year reportable clauses — highlight for current-year planning. */
  reportableClauses: Array<{ clauseRef: string; title: string; reportingLanguage: string | null }>;
}

/** The 02.4 CARO Work Programme panel. */
export interface StatutoryAuditCaroProgramme {
  workflowInstanceId: string;
  engagementId: string;
  state: CaroProgrammeState;
  /** Plain-language reason for the state. */
  reason: string;
  level1: CaroProgrammeLevel1 | null;
  programme: CaroProgrammeRecord | null;
  orderVersion: CaroOrderVersion | null;
  /** Standalone paragraph-3 clause items (withdrawn ones only when the programme is). */
  standalone: CaroClauseItem[];
  consolidatedState: CaroConsolidatedState;
  /** The clause 3(xxi) item (null unless configured). */
  consolidated: CaroClauseItem | null;
  summary: CaroProgrammeSummary;
  priorYear: CaroPriorYearContext | null;
  /** Section 02 is approved, or the caller cannot change the file. */
  readOnly: boolean;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface UpdateCaroClauseInput {
  relevance?: CaroRelevance;
  relevanceReason?: string | null;
  workPerformed?: string | null;
  managementResponse?: string | null;
  draftReporting?: string | null;
  conclusion?: CaroClauseConclusion | null;
  conclusionNote?: string | null;
  version: number;
}

export const CARO_REVIEW_ACTIONS = ['submit', 'approve', 'return', 'reopen', 'partner_review'] as const;
export type CaroReviewAction = (typeof CARO_REVIEW_ACTIONS)[number];

export interface CaroClauseReviewInput {
  action: CaroReviewAction;
  /** Required when returning. */
  note?: string | null;
  version: number;
}

export interface LinkCaroClauseEvidenceInput {
  /** An engagement document (SharePoint-backed when Microsoft 365 is on). */
  documentId?: string;
  /** A Section 06 evidence record. */
  auditEvidenceId?: string;
  note?: string | null;
}

export interface CreateCaroFindingInput {
  description: string;
  severity?: CaroFindingSeverity;
  workAreaKey?: string | null;
  procedureId?: string | null;
  amount?: number | null;
  includeInReport?: boolean;
  managementResponse?: string | null;
}

export interface UpdateCaroFindingInput {
  description?: string;
  severity?: CaroFindingSeverity;
  workAreaKey?: string | null;
  procedureId?: string | null;
  amount?: number | null;
  includeInReport?: boolean;
  managementResponse?: string | null;
  status?: 'open' | 'resolved';
  resolution?: string | null;
  version: number;
}

export interface AddCaroComponentInput {
  componentName: string;
  relationship?: string | null;
}

export interface UpdateCaroComponentInput {
  caroApplicable?: CaroComponentApplicable;
  auditorName?: string | null;
  auditorReportDocumentId?: string | null;
  qualificationIdentified?: boolean | null;
  paragraphRefs?: string | null;
  remarks?: string | null;
  version: number;
}

// ── Draft CARO annexure (spec §18) ───────────────────────────────────────────

export interface CaroAnnexureParagraph {
  clauseCode: string;
  clauseRef: string;
  title: string;
  /** Approved reporting text; null while the clause is not yet approved. */
  text: string | null;
  conclusion: CaroClauseConclusion | null;
  approved: boolean;
  reportable: boolean;
}

export interface CaroAnnexureDraft {
  workflowInstanceId: string;
  reportContext: CaroReportContext;
  /** Annexure heading (from the Order title). */
  heading: string;
  orderVersionLabel: string | null;
  paragraphs: CaroAnnexureParagraph[];
  /** Every clause approved — the draft is complete. */
  complete: boolean;
  approvedCount: number;
  totalCount: number;
  reportableCount: number;
}

/** What Section 08 / completion reads (one per report context). */
export interface CaroReportingSummary {
  standalone: CaroAnnexureDraft | null;
  consolidated: CaroAnnexureDraft | null;
}
