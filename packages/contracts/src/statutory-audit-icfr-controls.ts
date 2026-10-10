/**
 * 02.5 — the Section 05 ICFR workstream, the integrated control record, the
 * deficiency register, prior-year follow-up and the Consolidated ICFR Reporting
 * Consideration (DHVAJ Section 02.5 spec §13–§17, §19, §22).
 *
 * 02.5 decides whether section 143(3)(i) reporting applies (statutory-audit-icfr);
 * this is what that decision configures. When reporting applies, the versioned
 * DHVAJ process-area framework is instantiated — Entity-Level Controls and
 * Financial Close & Reporting always, the other processes only where the
 * significant accounts / risks / IT dependency call for them; never "every
 * process mandatory". A later Exempt conclusion withdraws the workstream, never
 * deletes it, and never touches normal Section 05 control work.
 *
 * One control record serves the financial-statement audit, ICFR, or both (§14);
 * design, implementation and operating effectiveness are separate conclusions
 * (§15). Deficiencies are classified Control Deficiency / Significant Deficiency
 * / Material Weakness under the DHVAJ methodology the server supplies (§16) and
 * feed Section 07 / 08 (§22).
 */

import type { RiskAssertion } from './statutory-audit-risk';
import type { IcfrContextStatus, IcfrOutcome } from './statutory-audit-icfr';

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** How a process area is activated (spec §13). */
export const ICFR_ACTIVATION = {
  always: 'always',
  factRisk: 'fact_risk',
  itDependency: 'it_dependency',
  scoping: 'scoping',
} as const;
export type IcfrActivation = (typeof ICFR_ACTIVATION)[keyof typeof ICFR_ACTIVATION];

export const ICFR_ACTIVATION_LABEL: Record<IcfrActivation, string> = {
  always: 'Always — create framework, scope later',
  fact_risk: 'Fact / risk-driven',
  it_dependency: 'System / IT dependency-driven',
  scoping: 'Added by risk / scoping',
};

export const ICFR_SCOPING = {
  inScope: 'in_scope',
  notInScope: 'not_in_scope',
  toBeScoped: 'to_be_scoped',
} as const;
export type IcfrScoping = (typeof ICFR_SCOPING)[keyof typeof ICFR_SCOPING];
export const ICFR_SCOPINGS: IcfrScoping[] = Object.values(ICFR_SCOPING);

export const ICFR_SCOPING_LABEL: Record<IcfrScoping, string> = {
  in_scope: 'In scope',
  not_in_scope: 'Not in scope',
  to_be_scoped: 'To be scoped',
};

/** §14 — what a control is relied on for. */
export const ICFR_CONTROL_PURPOSE_LABEL = {
  fsAudit: 'FS Audit',
  icfr: 'ICFR',
  both: 'FS Audit + ICFR',
} as const;

/** §15 — three separate conclusions, never collapsed into one Yes / No. */
export const ICFR_DESIGN = { adequate: 'adequate', deficiency: 'deficiency' } as const;
export type IcfrDesign = (typeof ICFR_DESIGN)[keyof typeof ICFR_DESIGN];
export const ICFR_DESIGN_LABEL: Record<IcfrDesign, string> = {
  adequate: 'Adequate',
  deficiency: 'Deficiency',
};

export const ICFR_IMPLEMENTATION = {
  implemented: 'implemented',
  notImplemented: 'not_implemented',
} as const;
export type IcfrImplementation = (typeof ICFR_IMPLEMENTATION)[keyof typeof ICFR_IMPLEMENTATION];
export const ICFR_IMPLEMENTATION_LABEL: Record<IcfrImplementation, string> = {
  implemented: 'Implemented',
  not_implemented: 'Not Implemented',
};

export const ICFR_OPERATING = {
  effective: 'effective',
  exceptionIdentified: 'exception_identified',
  notTested: 'not_tested',
} as const;
export type IcfrOperating = (typeof ICFR_OPERATING)[keyof typeof ICFR_OPERATING];
export const ICFR_OPERATING_LABEL: Record<IcfrOperating, string> = {
  effective: 'Effective',
  exception_identified: 'Exception Identified',
  not_tested: 'Not Tested',
};

/** The overall control conclusion, derived by the methodology (§15). */
export const ICFR_CONTROL_OVERALL = {
  notAssessed: 'not_assessed',
  inProgress: 'in_progress',
  effective: 'effective',
  designImplementationOnly: 'design_implementation_only',
  designDeficiency: 'design_deficiency',
  notImplemented: 'not_implemented',
  operatingException: 'operating_exception',
} as const;
export type IcfrControlOverall = (typeof ICFR_CONTROL_OVERALL)[keyof typeof ICFR_CONTROL_OVERALL];
export const ICFR_CONTROL_OVERALL_LABEL: Record<IcfrControlOverall, string> = {
  not_assessed: 'Not assessed',
  in_progress: 'Assessment in progress',
  effective: 'Designed, implemented and operating effectively',
  design_implementation_only: 'Designed and implemented — operating effectiveness not tested',
  design_deficiency: 'Design deficiency',
  not_implemented: 'Not implemented',
  operating_exception: 'Operating exception',
};

export const ICFR_CONTROL_NATURES = ['manual', 'automated', 'it_dependent_manual'] as const;
export type IcfrControlNature = (typeof ICFR_CONTROL_NATURES)[number];
export const ICFR_CONTROL_NATURE_LABEL: Record<IcfrControlNature, string> = {
  manual: 'Manual',
  automated: 'Automated',
  it_dependent_manual: 'IT-dependent manual',
};

export const ICFR_CONTROL_FREQUENCIES = [
  'transactional',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
  'ad_hoc',
] as const;
export type IcfrControlFrequency = (typeof ICFR_CONTROL_FREQUENCIES)[number];
export const ICFR_CONTROL_FREQUENCY_LABEL: Record<IcfrControlFrequency, string> = {
  transactional: 'Each transaction',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  ad_hoc: 'Ad hoc',
};

export const ICFR_CONTROL_REVIEW_STATE = {
  open: 'open',
  submitted: 'submitted',
  returned: 'returned',
  reviewed: 'reviewed',
} as const;
export type IcfrControlReviewState =
  (typeof ICFR_CONTROL_REVIEW_STATE)[keyof typeof ICFR_CONTROL_REVIEW_STATE];
export const ICFR_CONTROL_REVIEW_STATE_LABEL: Record<IcfrControlReviewState, string> = {
  open: 'Open',
  submitted: 'Submitted for review',
  returned: 'Returned',
  reviewed: 'Reviewed',
};

/** §16 deficiency classification. */
export const ICFR_DEFICIENCY_CLASS = {
  controlDeficiency: 'control_deficiency',
  significantDeficiency: 'significant_deficiency',
  materialWeakness: 'material_weakness',
} as const;
export type IcfrDeficiencyClass =
  (typeof ICFR_DEFICIENCY_CLASS)[keyof typeof ICFR_DEFICIENCY_CLASS];
export const ICFR_DEFICIENCY_CLASSES: IcfrDeficiencyClass[] = Object.values(ICFR_DEFICIENCY_CLASS);
export const ICFR_DEFICIENCY_CLASS_LABEL: Record<IcfrDeficiencyClass, string> = {
  control_deficiency: 'Control Deficiency',
  significant_deficiency: 'Significant Deficiency',
  material_weakness: 'Material Weakness',
};

export const ICFR_MAGNITUDES = [
  'inconsequential',
  'more_than_inconsequential',
  'material',
] as const;
export type IcfrMagnitude = (typeof ICFR_MAGNITUDES)[number];
export const ICFR_MAGNITUDE_LABEL: Record<IcfrMagnitude, string> = {
  inconsequential: 'Inconsequential',
  more_than_inconsequential: 'More than inconsequential',
  material: 'Material',
};

export const ICFR_LIKELIHOODS = ['remote', 'reasonably_possible', 'probable'] as const;
export type IcfrLikelihood = (typeof ICFR_LIKELIHOODS)[number];
export const ICFR_LIKELIHOOD_LABEL: Record<IcfrLikelihood, string> = {
  remote: 'Remote',
  reasonably_possible: 'Reasonably possible',
  probable: 'Probable',
};

export const ICFR_REMEDIATION_STATUSES = [
  'not_started',
  'in_progress',
  'remediated',
  'not_remediated',
] as const;
export type IcfrRemediationStatus = (typeof ICFR_REMEDIATION_STATUSES)[number];
export const ICFR_REMEDIATION_STATUS_LABEL: Record<IcfrRemediationStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  remediated: 'Remediated',
  not_remediated: 'Not remediated',
};

export const ICFR_REPORTING_IMPACTS = [
  'none',
  'management_letter',
  'tcwg_communication',
  'icfr_opinion_modified',
] as const;
export type IcfrReportingImpact = (typeof ICFR_REPORTING_IMPACTS)[number];
export const ICFR_REPORTING_IMPACT_LABEL: Record<IcfrReportingImpact, string> = {
  none: 'No reporting impact',
  management_letter: 'Communicate to management (management letter)',
  tcwg_communication: 'Communicate to those charged with governance (SA 265)',
  icfr_opinion_modified: 'Modified ICFR opinion (section 143(3)(i))',
};

/** §19 — what became of a prior-year deficiency this year. */
export const ICFR_FOLLOWUP_STATUSES = ['open', 'remediated', 'persists', 'not_relevant'] as const;
export type IcfrFollowUpStatus = (typeof ICFR_FOLLOWUP_STATUSES)[number];
export const ICFR_FOLLOWUP_STATUS_LABEL: Record<IcfrFollowUpStatus, string> = {
  open: 'Follow-up open',
  remediated: 'Remediated this year',
  persists: 'Persists — raised as a current-year deficiency',
  not_relevant: 'No longer relevant',
};

/** The ICFR workstream's conclusion (→ Section 08 ICFR report). */
export const ICFR_WORKSTREAM_CONCLUSIONS = [
  'unmodified',
  'modified_material_weakness',
  'disclaimer',
] as const;
export type IcfrWorkstreamConclusion = (typeof ICFR_WORKSTREAM_CONCLUSIONS)[number];
export const ICFR_WORKSTREAM_CONCLUSION_LABEL: Record<IcfrWorkstreamConclusion, string> = {
  unmodified: 'Unmodified — adequate and operating effectively',
  modified_material_weakness: 'Modified — material weakness(es) identified',
  disclaimer: 'Disclaimer — unable to obtain sufficient appropriate evidence',
};

/** Where the workstream stands against the 02.5 result. */
export const ICFR_WORKSTREAM_STATE = {
  /** 02.5 not yet concluded or suggested Applicable. */
  awaitingConclusion: 'awaiting_conclusion',
  /** Section 143(3)(i) reporting does not apply — normal Section 05 work only. */
  notRequired: 'not_required',
  active: 'active',
  withdrawn: 'withdrawn',
} as const;
export type IcfrWorkstreamState =
  (typeof ICFR_WORKSTREAM_STATE)[keyof typeof ICFR_WORKSTREAM_STATE];
export const ICFR_WORKSTREAM_STATE_LABEL: Record<IcfrWorkstreamState, string> = {
  awaiting_conclusion: 'Awaiting the 02.5 conclusion',
  not_required: 'Not required — reporting exempt',
  active: 'Active',
  withdrawn: 'Withdrawn',
};

// ── §17 consolidated consideration ───────────────────────────────────────────

export const ICFR_COMPONENT_ICFR = ['applicable', 'exempt', 'pending'] as const;
export type IcfrComponentIcfr = (typeof ICFR_COMPONENT_ICFR)[number];
export const ICFR_COMPONENT_ICFR_LABEL: Record<IcfrComponentIcfr, string> = {
  applicable: 'Applicable',
  exempt: 'Exempt',
  pending: 'Pending',
};

export const ICFR_COMPONENT_AUDITORS = ['dhvaj', 'other'] as const;
export type IcfrComponentAuditor = (typeof ICFR_COMPONENT_AUDITORS)[number];
export const ICFR_COMPONENT_AUDITOR_LABEL: Record<IcfrComponentAuditor, string> = {
  dhvaj: 'DHVAJ',
  other: 'Other auditor',
};

export const ICFR_COMPONENT_MATERIALITY = ['significant', 'not_significant'] as const;
export type IcfrComponentMateriality = (typeof ICFR_COMPONENT_MATERIALITY)[number];
export const ICFR_COMPONENT_MATERIALITY_LABEL: Record<IcfrComponentMateriality, string> = {
  significant: 'Significant to the group',
  not_significant: 'Not significant',
};

export const ICFR_PARENT_CONCLUSIONS = [
  'unmodified',
  'modified_component_material_weakness',
  'modified_parent_material_weakness',
  'not_applicable',
] as const;
export type IcfrParentConclusion = (typeof ICFR_PARENT_CONCLUSIONS)[number];
export const ICFR_PARENT_CONCLUSION_LABEL: Record<IcfrParentConclusion, string> = {
  unmodified: 'Unmodified for the group',
  modified_component_material_weakness: 'Modified — material weakness at a component',
  modified_parent_material_weakness: 'Modified — material weakness at the parent',
  not_applicable: 'Not applicable — no Indian company in the group reports under 143(3)(i)',
};

export const ICFR_CONSOLIDATED_STATE = {
  /** 02.6 has not put consolidated financial statements in scope. */
  notRequired: 'not_required',
  /** Waiting for 02.6 — never blocks the standalone conclusion. */
  pending: 'pending',
  active: 'active',
  withdrawn: 'withdrawn',
} as const;
export type IcfrConsolidatedState =
  (typeof ICFR_CONSOLIDATED_STATE)[keyof typeof ICFR_CONSOLIDATED_STATE];
export const ICFR_CONSOLIDATED_STATE_LABEL: Record<IcfrConsolidatedState, string> = {
  not_required: 'Not required',
  pending: 'Pending — awaiting 02.6',
  active: 'Active',
  withdrawn: 'Withdrawn',
};

// ── Records ──────────────────────────────────────────────────────────────────

export interface IcfrProcedureTemplate {
  key: string;
  title: string;
  objective: string;
  evidence: string;
}

/** One area of the versioned framework (library). */
export interface IcfrLibraryArea {
  id: string;
  frameworkCode: string;
  frameworkLabel: string;
  areaKey: string;
  title: string;
  description: string;
  activation: IcfrActivation;
  triggerAreaCodes: string[];
  triggerKeywords: string[];
  procedures: IcfrProcedureTemplate[];
  sortOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface IcfrProcessArea {
  id: string;
  areaKey: string;
  title: string;
  description: string | null;
  activation: IcfrActivation;
  source: 'framework' | 'manual';
  scoping: IcfrScoping;
  /** 'system' while the scoping follows the facts; 'team' once someone decided. */
  scopingSource: 'system' | 'team';
  /** What the facts suggest, and why (always shown, even after a team decision). */
  suggestedScoping: IcfrScoping;
  systemBasis: string | null;
  scopingReason: string | null;
  scopedByName: string | null;
  scopedAt: string | null;
  procedures: IcfrProcedureTemplate[];
  controls: number;
  keyIcfrControls: number;
  openDeficiencies: number;
  withdrawn: boolean;
  version: number;
}

export interface IcfrControlEvidence {
  id: string;
  documentId: string | null;
  auditEvidenceId: string | null;
  title: string;
  note: string | null;
  linkedByName: string | null;
  linkedAt: string;
  /** Other live controls the same file supports — reused, never re-uploaded. */
  alsoSupports: string[];
}

/** Prior-year control effectiveness — context only, never rolled forward (§19). */
export interface IcfrPriorControl {
  financialYear: string;
  /** The prior engagement (its documents open there, under its own access). */
  engagementId: string;
  /** Prior-year evidence — a cross-reference only, never current-year evidence (§19). */
  evidence: Array<{ documentId: string | null; title: string }>;
  design: IcfrDesign | null;
  implementation: IcfrImplementation | null;
  operatingEffectiveness: IcfrOperating | null;
  overall: IcfrControlOverall;
}

export interface IcfrControl {
  id: string;
  seq: number;
  controlRef: string;
  processAreaId: string | null;
  process: string;
  description: string;
  purposeFsAudit: boolean;
  purposeIcfr: boolean;
  assertions: RiskAssertion[];
  relatedRiskId: string | null;
  relatedRiskRef: string | null;
  relatedRisk: string | null;
  nature: IcfrControlNature | null;
  frequency: IcfrControlFrequency | null;
  isKey: boolean;
  owner: string | null;
  procedureId: string | null;
  procedureRef: string | null;
  design: IcfrDesign | null;
  implementation: IcfrImplementation | null;
  operatingEffectiveness: IcfrOperating | null;
  overall: IcfrControlOverall;
  testNote: string | null;
  reviewState: IcfrControlReviewState;
  returnNote: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  evidence: IcfrControlEvidence[];
  deficiencies: string[];
  priorYear: IcfrPriorControl | null;
  /** What still stops a submit / review. */
  blockers: string[];
  withdrawn: boolean;
  version: number;
}

export interface IcfrDeficiency {
  id: string;
  seq: number;
  ref: string;
  classification: IcfrDeficiencyClass;
  /** The methodology's suggestion from magnitude × likelihood (null until both are set). */
  suggestedClassification: IcfrDeficiencyClass | null;
  description: string;
  controlId: string | null;
  controlRef: string | null;
  processAreaId: string | null;
  processTitle: string | null;
  workAreaKey: string | null;
  affectedAccount: string | null;
  assertions: RiskAssertion[];
  magnitude: IcfrMagnitude | null;
  likelihood: IcfrLikelihood | null;
  compensatingControlIds: string[];
  compensatingControlRefs: string[];
  compensatingNote: string | null;
  remediationAction: string | null;
  remediationStatus: IcfrRemediationStatus;
  auditImpact: string | null;
  reportingImpact: IcfrReportingImpact | null;
  reportingNote: string | null;
  followUpId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** Significant deficiencies and material weaknesses need the Partner's conclusion. */
  partnerRequired: boolean;
  partnerConclusion: string | null;
  partnerByName: string | null;
  partnerAt: string | null;
  status: 'open' | 'closed';
  /** What still stops the Manager review / Partner conclusion. */
  blockers: string[];
  withdrawn: boolean;
  version: number;
}

export interface IcfrFollowUp {
  id: string;
  priorFinancialYear: string;
  priorRef: string;
  priorClassification: IcfrDeficiencyClass;
  priorDescription: string;
  priorProcess: string | null;
  priorRemediationAction: string | null;
  priorRemediationStatus: string;
  status: IcfrFollowUpStatus;
  conclusionNote: string | null;
  deficiencyId: string | null;
  deficiencyRef: string | null;
  concludedByName: string | null;
  concludedAt: string | null;
  version: number;
}

/** §19 — the prior year's ICFR picture (planning context). */
export interface IcfrControlsPriorYear {
  financialYear: string;
  /** The prior 02.5 result (display; this year's rules are rerun by 02.5). */
  applicability: IcfrOutcome | null;
  workstreamConclusion: IcfrWorkstreamConclusion | null;
  materialWeaknesses: Array<{ ref: string; description: string; remediationStatus: string }>;
  significantDeficiencies: Array<{ ref: string; description: string; remediationStatus: string }>;
}

export interface IcfrDeficiencySummary {
  total: number;
  open: number;
  controlDeficiencies: number;
  significantDeficiencies: number;
  materialWeaknesses: number;
  awaitingReview: number;
  awaitingPartner: number;
}

export interface IcfrWorkstreamSummary {
  processAreas: { inScope: number; notInScope: number; toBeScoped: number };
  controls: {
    total: number;
    icfr: number;
    fsAuditOnly: number;
    both: number;
    effective: number;
    deficient: number;
    notAssessed: number;
    awaitingReview: number;
  };
  deficiencies: IcfrDeficiencySummary;
  followUps: { total: number; open: number };
}

export interface IcfrWorkstreamRecord {
  id: string;
  frameworkCode: string;
  frameworkLabel: string;
  periodStart: string;
  status: 'active' | 'withdrawn';
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  conclusion: IcfrWorkstreamConclusion | null;
  conclusionNote: string | null;
  concludedByName: string | null;
  concludedAt: string | null;
  createdAt: string;
  version: number;
}

/** The 02.5 Level-1 result as the workstream reads it. */
export interface IcfrWorkstreamLevel1 {
  outcome: IcfrOutcome | null;
  decided: boolean;
  reportingApplies: boolean | null;
  consolidatedStatus: IcfrContextStatus;
  financialYear: string | null;
  periodStart: string;
}

/** The DHVAJ deficiency methodology the server applies (never a frontend assumption). */
export interface IcfrDeficiencyMethodology {
  basis: string;
  matrix: Array<{
    magnitude: IcfrMagnitude;
    likelihood: IcfrLikelihood;
    classification: IcfrDeficiencyClass;
  }>;
  partnerConclusionFor: IcfrDeficiencyClass[];
}

/** GET …/statutory-audit/:wf/icfr/workstream */
export interface StatutoryAuditIcfrWorkstream {
  workflowInstanceId: string;
  engagementId: string;
  state: IcfrWorkstreamState;
  reason: string;
  level1: IcfrWorkstreamLevel1 | null;
  workstream: IcfrWorkstreamRecord | null;
  processAreas: IcfrProcessArea[];
  /** The control register: FS-audit controls exist whether or not ICFR applies. */
  controls: IcfrControl[];
  deficiencies: IcfrDeficiency[];
  followUps: IcfrFollowUp[];
  priorYear: IcfrControlsPriorYear | null;
  summary: IcfrWorkstreamSummary;
  /** What still stops the workstream conclusion. */
  conclusionBlockers: string[];
  methodology: IcfrDeficiencyMethodology;
  /** Pickers. */
  risks: Array<{ id: string; ref: string; description: string; fsArea: string | null }>;
  workAreas: Array<{ key: string; title: string }>;
  readOnly: boolean;
}

export interface IcfrComponent {
  id: string;
  source: '02.6' | 'manual';
  componentName: string;
  relationship: string | null;
  indianCompany: 'yes' | 'no' | null;
  componentIcfr: IcfrComponentIcfr;
  auditor: IcfrComponentAuditor | null;
  auditorName: string | null;
  reportDocumentId: string | null;
  reportDocumentTitle: string | null;
  materiality: IcfrComponentMateriality | null;
  materialityNote: string | null;
  materialWeakness: boolean | null;
  materialWeaknessDetails: string | null;
  /** What this component still needs before the parent can conclude. */
  missing: string[];
  withdrawn: boolean;
  version: number;
}

export interface IcfrConsolidatedRecord {
  id: string;
  status: 'active' | 'withdrawn';
  withdrawnReason: string | null;
  parentConclusion: IcfrParentConclusion | null;
  parentConclusionNote: string | null;
  concludedByName: string | null;
  concludedAt: string | null;
  version: number;
}

/** GET …/statutory-audit/:wf/icfr/consolidated */
export interface StatutoryAuditIcfrConsolidated {
  workflowInstanceId: string;
  engagementId: string;
  state: IcfrConsolidatedState;
  reason: string;
  consolidated: IcfrConsolidatedRecord | null;
  components: IcfrComponent[];
  summary: {
    components: number;
    pending: number;
    indianCompanies: number;
    materialWeaknesses: number;
  };
  /** The structured conclusion the components point to (the parent auditor decides). */
  suggestedConclusion: IcfrParentConclusion | null;
  conclusionBlockers: string[];
  readOnly: boolean;
}

/** §22 — what Section 07 / 08 read. */
export interface IcfrReportingSummary {
  workstreamActive: boolean;
  conclusion: IcfrWorkstreamConclusion | null;
  concluded: boolean;
  deficiencies: IcfrDeficiencySummary;
  materialWeaknesses: Array<{ ref: string; description: string }>;
  significantDeficiencies: Array<{ ref: string; description: string }>;
  consolidated: {
    active: boolean;
    parentConclusion: IcfrParentConclusion | null;
    componentMaterialWeaknesses: number;
  };
}

/** B → A status for the §23 checklist (icfr-controls-read). */
export interface IcfrWorkstreamStatus {
  instantiated: boolean;
  processAreas: number;
  openDeficiencies: number;
  materialWeaknesses: number;
}
export interface IcfrConsolidatedStatus {
  configured: boolean;
  components: number;
  pending: number;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface UpdateIcfrProcessAreaInput {
  scoping: IcfrScoping;
  scopingReason?: string | null;
  version: number;
}

export interface AddIcfrProcessAreaInput {
  title: string;
  description?: string | null;
  scopingReason: string;
}

export interface CreateIcfrControlInput {
  processAreaId?: string | null;
  process?: string | null;
  controlRef?: string | null;
  description: string;
  purposeFsAudit: boolean;
  purposeIcfr: boolean;
  assertions?: RiskAssertion[];
  relatedRiskId?: string | null;
  relatedRisk?: string | null;
  nature?: IcfrControlNature | null;
  frequency?: IcfrControlFrequency | null;
  isKey?: boolean;
  owner?: string | null;
  procedureId?: string | null;
}

export interface UpdateIcfrControlInput extends Partial<Omit<CreateIcfrControlInput, 'process'>> {
  process?: string;
  design?: IcfrDesign | null;
  implementation?: IcfrImplementation | null;
  operatingEffectiveness?: IcfrOperating | null;
  testNote?: string | null;
  /** Withdraw a control raised in error (kept for the record). */
  withdrawn?: boolean;
  version: number;
}

export interface ReviewIcfrControlInput {
  action: 'submit' | 'return' | 'review' | 'reopen';
  note?: string | null;
  version: number;
}

export interface LinkIcfrControlEvidenceInput {
  documentId?: string | null;
  auditEvidenceId?: string | null;
  note?: string | null;
}

export interface CreateIcfrDeficiencyInput {
  classification: IcfrDeficiencyClass;
  description: string;
  controlId?: string | null;
  processAreaId?: string | null;
  workAreaKey?: string | null;
  affectedAccount?: string | null;
  assertions?: RiskAssertion[];
  magnitude?: IcfrMagnitude | null;
  likelihood?: IcfrLikelihood | null;
  compensatingControlIds?: string[];
  compensatingNote?: string | null;
  remediationAction?: string | null;
  remediationStatus?: IcfrRemediationStatus;
  auditImpact?: string | null;
  reportingImpact?: IcfrReportingImpact | null;
  reportingNote?: string | null;
  followUpId?: string | null;
}

export interface UpdateIcfrDeficiencyInput extends Partial<CreateIcfrDeficiencyInput> {
  status?: 'open' | 'closed';
  withdrawn?: boolean;
  version: number;
}

export interface ReviewIcfrDeficiencyInput {
  action: 'manager_review' | 'partner_conclude' | 'reopen';
  partnerConclusion?: string | null;
  version: number;
}

export interface UpdateIcfrFollowUpInput {
  status: IcfrFollowUpStatus;
  conclusionNote?: string | null;
  version: number;
}

export interface ConcludeIcfrWorkstreamInput {
  conclusion: IcfrWorkstreamConclusion | null;
  note?: string | null;
  version: number;
}

export interface AddIcfrComponentInput {
  componentName: string;
  relationship?: string | null;
}

export interface UpdateIcfrComponentInput {
  indianCompany?: 'yes' | 'no' | null;
  componentIcfr?: IcfrComponentIcfr;
  auditor?: IcfrComponentAuditor | null;
  auditorName?: string | null;
  reportDocumentId?: string | null;
  materiality?: IcfrComponentMateriality | null;
  materialityNote?: string | null;
  materialWeakness?: boolean | null;
  materialWeaknessDetails?: string | null;
  /** Withdraw a hand-added component (02.6 components follow 02.6). */
  withdrawn?: boolean;
  version: number;
}

export interface ConcludeIcfrConsolidatedInput {
  parentConclusion: IcfrParentConclusion | null;
  note?: string | null;
  version: number;
}
