/**
 * Statutory Audit — Framework (Phase 02) vocabulary (Audit Spec §18–§20, §33).
 *
 * The Framework layer determines WHAT applies (§1). It is a structured
 * applicability/assessment layer: for each regulatory area the system may offer a
 * SUGGESTION from the entity's facts, but the professional records the CONCLUSION.
 * The Framework Memo approval freezes the conclusions and marks Phase 02 complete,
 * which is the gate for meaningful Planning and (later) dynamic work generation
 * (§20 "APPROVED FRAMEWORK + APPROVED PLAN → APPLICABLE WORK AREAS").
 *
 * This module is the single source of truth for the assessment areas, the
 * applicability state model and the conclusion vocabulary, shared by the seed,
 * the service, the suggestion engine and the Framework screen.
 */

/** Stable machine keys for the framework assessment areas (§18). */
export const FRAMEWORK_AREA_KEY = {
  entityRegulatoryProfile: 'entity_regulatory_profile',
  financialReportingFramework: 'financial_reporting_framework',
  indAsAs: 'ind_as_as',
  scheduleIii: 'schedule_iii',
  caro: 'caro',
  ifc: 'ifc',
  cfs: 'cfs',
  internalAudit: 'internal_audit',
  costRecords: 'cost_records',
  secretarialAudit: 'secretarial_audit',
  csr: 'csr',
  rule11: 'rule_11',
  section143: 'section_143',
  saMatrix: 'sa_matrix',
  otherRegulatory: 'other_regulatory',
  auditReportingFramework: 'audit_reporting_framework',
} as const;
export type FrameworkAreaKey = (typeof FRAMEWORK_AREA_KEY)[keyof typeof FRAMEWORK_AREA_KEY];

/**
 * The professional conclusion for an area — and the value a system suggestion
 * carries. For the descriptive areas (profile, reporting framework, audit
 * reporting framework) `applicable` reads as "addressed/confirmed".
 */
export const FRAMEWORK_CONCLUSION = {
  applicable: 'applicable',
  notApplicable: 'not_applicable',
} as const;
export type FrameworkConclusion =
  (typeof FRAMEWORK_CONCLUSION)[keyof typeof FRAMEWORK_CONCLUSION];

/**
 * Applicability state model (§19). Lifecycle:
 *   not_assessed
 *     → (pending_information | system_suggested_applicable |
 *        system_suggested_not_applicable | professional_judgement_required)   [suggestion engine]
 *     → (applicable | not_applicable | overridden)                            [professional decision]
 *     → approved                                                              [framework memo approval]
 * `overridden` = the professional conclusion differs from the system suggestion
 * (a basis is then required, §19). `reassessment_required` is set by change-impact
 * triggers (§29/§30) and does not rewrite the prior conclusion.
 */
export const FRAMEWORK_STATE = {
  notAssessed: 'not_assessed',
  pendingInformation: 'pending_information',
  systemSuggestedApplicable: 'system_suggested_applicable',
  systemSuggestedNotApplicable: 'system_suggested_not_applicable',
  professionalJudgementRequired: 'professional_judgement_required',
  applicable: 'applicable',
  notApplicable: 'not_applicable',
  overridden: 'overridden',
  reassessmentRequired: 'reassessment_required',
  approved: 'approved',
} as const;
export type FrameworkState = (typeof FRAMEWORK_STATE)[keyof typeof FRAMEWORK_STATE];

/** The states in which an area is considered DECIDED (a conclusion exists). */
export const FRAMEWORK_DECIDED_STATES: readonly FrameworkState[] = [
  'applicable',
  'not_applicable',
  'overridden',
  'approved',
];

export interface FrameworkAreaDefinition {
  areaKey: FrameworkAreaKey;
  title: string;
  sortOrder: number;
  /**
   * `applicability` areas are a genuine applicable/not-applicable question the
   * suggestion engine can weigh in on; `descriptive` areas are documented
   * professional narrative (confirmed as addressed).
   */
  kind: 'applicability' | 'descriptive';
}

/** The canonical framework assessment areas, in order (§18). */
export const FRAMEWORK_AREAS: readonly FrameworkAreaDefinition[] = [
  { areaKey: 'entity_regulatory_profile', title: 'Entity & Regulatory Profile', sortOrder: 1, kind: 'descriptive' },
  { areaKey: 'financial_reporting_framework', title: 'Applicable Financial Reporting Framework', sortOrder: 2, kind: 'descriptive' },
  { areaKey: 'ind_as_as', title: 'Ind AS / AS Assessment', sortOrder: 3, kind: 'applicability' },
  { areaKey: 'schedule_iii', title: 'Schedule III Assessment', sortOrder: 4, kind: 'applicability' },
  { areaKey: 'caro', title: 'CARO Applicability', sortOrder: 5, kind: 'applicability' },
  { areaKey: 'ifc', title: 'IFC Applicability', sortOrder: 6, kind: 'applicability' },
  { areaKey: 'cfs', title: 'Consolidation / CFS Applicability', sortOrder: 7, kind: 'applicability' },
  { areaKey: 'internal_audit', title: 'Internal Audit Applicability', sortOrder: 8, kind: 'applicability' },
  { areaKey: 'cost_records', title: 'Cost Records / Cost Audit', sortOrder: 9, kind: 'applicability' },
  { areaKey: 'secretarial_audit', title: 'Secretarial Audit', sortOrder: 10, kind: 'applicability' },
  { areaKey: 'csr', title: 'CSR / Governance Matters', sortOrder: 11, kind: 'applicability' },
  { areaKey: 'rule_11', title: 'Rule 11 Reporting', sortOrder: 12, kind: 'applicability' },
  { areaKey: 'section_143', title: 'Section 143 Reporting', sortOrder: 13, kind: 'applicability' },
  { areaKey: 'sa_matrix', title: 'SA Applicability / Consideration Matrix', sortOrder: 14, kind: 'descriptive' },
  { areaKey: 'other_regulatory', title: 'Other Regulatory / Industry Requirements', sortOrder: 15, kind: 'applicability' },
  { areaKey: 'audit_reporting_framework', title: 'Audit Reporting Framework', sortOrder: 16, kind: 'descriptive' },
] as const;

/** One piece of evidence supporting an assessment (§18 Evidence, §33). */
export interface FrameworkEvidence {
  id: string;
  documentId: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** One framework assessment area with its professional state (§18, §19). */
export interface FrameworkAssessment {
  id: string;
  areaKey: string;
  title: string;
  kind: 'applicability' | 'descriptive';
  state: FrameworkState;
  /** The rule engine's advisory suggestion, if any (§19). */
  systemSuggestion: FrameworkConclusion | null;
  systemBasis: string | null;
  /** The professional conclusion, once decided. */
  conclusion: FrameworkConclusion | null;
  /** True when the conclusion differs from the system suggestion (§19). */
  isOverridden: boolean;
  /** Professional basis; required when overridden (§19). */
  basis: string | null;
  /** Downstream impact note (§18). */
  impact: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  sortOrder: number;
  version: number;
  evidence: FrameworkEvidence[];
}

/** A framework memo approval — versioned, immutable history (§18, §30, §33). */
export interface FrameworkApproval {
  id: string;
  version: number;
  memo: string | null;
  approvedByName: string | null;
  approvedAt: string;
}

/** The whole Framework view for one statutory-audit workflow instance (§18). */
export interface StatutoryAuditFramework {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessments: FrameworkAssessment[];
  /** The current (latest) approval, or null while the framework is unapproved. */
  approval: FrameworkApproval | null;
  /** How many areas still lack a professional conclusion (0 ⇒ ready to approve). */
  undecidedCount: number;
}
