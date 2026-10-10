/**
 * 02.6 — Consolidation / Group Audit Framework (spec v1.0; Implementation Guide §9.6).
 *
 * Part A (this file's core): decides whether Consolidated Financial Statements
 * are required (CFS-01 — Section 129(3) trigger, less the Rule 6 exemption tested
 * condition-by-condition, CFS-02), assesses each relationship (§5), establishes
 * the consolidation perimeter and accounting method per component (§8, §9), the
 * component reporting date (CFS-03) and accounting-policy alignment (CFS-04), and
 * records the professional conclusion (CFS-05) with Engagement Partner approval of
 * a significant override.
 *
 * Percentages are inputs / rebuttable presumptions, NEVER the whole test (spec
 * §5): AS 21 control = more than one-half of the VOTING POWER or control of the
 * board composition; Ind AS 110 control is principle-based (a percentage is only
 * an indicator — control must be confirmed); significant influence is a 20%
 * presumption rebuttable BOTH ways; joint control arises only from a contractual
 * arrangement. The Rule 6 exemption is cumulative — no ownership % alone creates
 * it; silence is never consent; missing parent-filing evidence leaves it pending.
 * There is NO fixed materiality % here — the perimeter passes to Section 03.3 —
 * and the ONE group structure feeds CARO 3(xxi) (02.4) and consolidated ICFR
 * (02.5) with no duplicate component entry.
 *
 * NO statutory number lives in code: the control / significant-influence
 * presumptions and the maximum reporting-date gaps resolve from the Audit Rules
 * Library by the engagement's audit period, so historical versions freeze.
 */

import type { MasterFact } from './statutory-audit';
import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';
import type { ReportingFrameworkOutcome } from './statutory-audit-financial-reporting';

/** The Level-1 CFS-requirement outcome the engine concludes (CFS-01). */
export const CONSOLIDATION_OUTCOME = {
  /** CFS must be prepared (§129(3) triggers and no Rule 6 exemption). */
  cfsRequired: 'cfs_required',
  /** §129(3) triggers but the Rule 6 exemption holds — CFS not required. */
  cfsExempt: 'cfs_exempt',
  /** No subsidiary/associate/JV — §129(3) does not trigger CFS. */
  notApplicable: 'not_applicable',
  /** The system cannot decide — a professional must (Further Assessment Required). */
  furtherAssessment: 'further_assessment',
  /** A deciding fact is absent (e.g. parent CFS filing status) — never a guess. */
  informationInsufficient: 'information_insufficient',
} as const;
export type ConsolidationOutcome =
  (typeof CONSOLIDATION_OUTCOME)[keyof typeof CONSOLIDATION_OUTCOME];
export const CONSOLIDATION_OUTCOMES: ConsolidationOutcome[] = Object.values(CONSOLIDATION_OUTCOME);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const CONSOLIDATION_CONCLUSIONS: ConsolidationOutcome[] = [
  CONSOLIDATION_OUTCOME.cfsRequired,
  CONSOLIDATION_OUTCOME.cfsExempt,
  CONSOLIDATION_OUTCOME.notApplicable,
  CONSOLIDATION_OUTCOME.furtherAssessment,
];

export const CONSOLIDATION_OUTCOME_LABEL: Record<ConsolidationOutcome, string> = {
  cfs_required: 'CFS Required',
  cfs_exempt: 'CFS Not Required — Rule 6 exemption',
  not_applicable: 'CFS Not Required',
  further_assessment: 'Further Assessment Required',
  information_insufficient: 'Information Pending',
};

/** CFS-05 professional action (spec §22). */
export const CONSOLIDATION_PROFESSIONAL_ACTION = {
  confirm: 'confirm',
  override: 'override',
  informationPending: 'information_pending',
} as const;
export type ConsolidationProfessionalAction =
  (typeof CONSOLIDATION_PROFESSIONAL_ACTION)[keyof typeof CONSOLIDATION_PROFESSIONAL_ACTION];
export const CONSOLIDATION_PROFESSIONAL_ACTIONS: ConsolidationProfessionalAction[] = Object.values(
  CONSOLIDATION_PROFESSIONAL_ACTION,
);

/** How an investee relates to the group (drives the accounting method). */
export const INVESTEE_RELATIONSHIP = {
  subsidiary: 'subsidiary',
  associate: 'associate',
  jointVenture: 'joint_venture',
  jointOperation: 'joint_operation',
  /** Control / influence / joint control still under professional assessment. */
  furtherAssessment: 'further_assessment',
  none: 'none',
} as const;
export type InvesteeRelationship =
  (typeof INVESTEE_RELATIONSHIP)[keyof typeof INVESTEE_RELATIONSHIP];
export const INVESTEE_RELATIONSHIP_LABEL: Record<InvesteeRelationship, string> = {
  subsidiary: 'Subsidiary',
  associate: 'Associate',
  joint_venture: 'Joint venture',
  joint_operation: 'Joint operation',
  further_assessment: 'Further assessment',
  none: 'Other / outside perimeter',
};

/** The relationship as recorded / suggested before the professional conclusion (spec §5). */
export const RELATIONSHIP_KIND = {
  subsidiary: 'subsidiary',
  associate: 'associate',
  jointVenture: 'joint_venture',
  other: 'other',
} as const;
export type RelationshipKind = (typeof RELATIONSHIP_KIND)[keyof typeof RELATIONSHIP_KIND];
export const RELATIONSHIP_KINDS: RelationshipKind[] = Object.values(RELATIONSHIP_KIND);

/** A professional relationship conclusion: Yes / No / Further assessment (spec §5). */
export const ASSESSMENT_ANSWER = {
  yes: 'yes',
  no: 'no',
  furtherAssessment: 'further_assessment',
} as const;
export type AssessmentAnswer = (typeof ASSESSMENT_ANSWER)[keyof typeof ASSESSMENT_ANSWER];
export const ASSESSMENT_ANSWERS: AssessmentAnswer[] = Object.values(ASSESSMENT_ANSWER);

/** The consolidation / equity accounting method applied to an investee. */
export const CONSOLIDATION_METHOD = {
  fullConsolidation: 'full_consolidation',
  equityMethod: 'equity_method',
  proportionateConsolidation: 'proportionate_consolidation',
  jointOperationLineByLine: 'joint_operation_line_by_line',
  none: 'none',
} as const;
export type ConsolidationMethod = (typeof CONSOLIDATION_METHOD)[keyof typeof CONSOLIDATION_METHOD];
export const CONSOLIDATION_METHOD_LABEL: Record<ConsolidationMethod, string> = {
  full_consolidation: 'Full consolidation',
  equity_method: 'Equity method',
  proportionate_consolidation: 'Proportionate consolidation',
  joint_operation_line_by_line: 'Share of assets / liabilities (line by line)',
  none: '—',
};

/** A component's local accounting framework (spec §8, CFS-04). */
export const LOCAL_FRAMEWORK = {
  indAs: 'ind_as',
  as: 'as',
  ifrs: 'ifrs',
  localGaap: 'local_gaap',
  other: 'other',
} as const;
export type LocalFramework = (typeof LOCAL_FRAMEWORK)[keyof typeof LOCAL_FRAMEWORK];
export const LOCAL_FRAMEWORKS: LocalFramework[] = Object.values(LOCAL_FRAMEWORK);
export const LOCAL_FRAMEWORK_LABEL: Record<LocalFramework, string> = {
  ind_as: 'Ind AS',
  as: 'AS (Companies (Accounting Standards) Rules)',
  ifrs: 'IFRS',
  local_gaap: 'Local GAAP',
  other: 'Other',
};

/** CFS-04 result: component policies / framework vs the group framework. */
export const POLICY_ALIGNMENT = {
  aligned: 'aligned',
  conversionRequired: 'conversion_required',
  furtherAssessment: 'further_assessment',
} as const;
export type PolicyAlignment = (typeof POLICY_ALIGNMENT)[keyof typeof POLICY_ALIGNMENT];
export const POLICY_ALIGNMENTS: PolicyAlignment[] = Object.values(POLICY_ALIGNMENT);
export const POLICY_ALIGNMENT_LABEL: Record<PolicyAlignment, string> = {
  aligned: 'Aligned',
  conversion_required: 'Conversion Required',
  further_assessment: 'Further Assessment',
};

/** Whether a perimeter entity is included in the CFS (spec §8). */
export const PERIMETER_INCLUSION = { yes: 'yes', no: 'no', pending: 'pending' } as const;
export type PerimeterInclusion = (typeof PERIMETER_INCLUSION)[keyof typeof PERIMETER_INCLUSION];

/** How the relationship's effective dates sit against the audit period (spec §8, §21). */
export const PERIOD_IMPACT = {
  fullPeriod: 'full_period',
  acquiredInPeriod: 'acquired_in_period',
  disposedInPeriod: 'disposed_in_period',
  outsidePeriod: 'outside_period',
} as const;
export type PeriodImpact = (typeof PERIOD_IMPACT)[keyof typeof PERIOD_IMPACT];

/** One investee / related entity captured on 02.6 (spec §5, §8, §10, §11). */
export interface InvesteeInput {
  /** Stable id (assigned by the service; kept across edits and roll-forward). */
  id?: string;
  name: string;
  /** The relationship as recorded on the master / suggested (Subsidiary / Associate / JV / Other). */
  suggestedRelationship?: RelationshipKind | null;
  /** Total ownership interest % (direct + indirect when those are captured). */
  ownershipPercent: number | null;
  ownershipDirect?: number | null;
  ownershipIndirect?: number | null;
  /** Voting power % (direct + indirect). Null = not captured (ownership is then used as the indicator). */
  votingDirect?: number | null;
  votingIndirect?: number | null;
  /** Control of the composition of the board of directors / governing body. */
  boardCompositionControl?: boolean | null;
  boardRightsDetails?: string | null;
  /** Contractual rights / agreement key terms (e.g. shareholders' agreement, JV agreement). */
  contractualRights?: string | null;
  /**
   * Legacy captured control judgment (`true`/`false`); superseded by
   * `controlConclusion` when that is given.
   */
  hasControl: boolean | null;
  /** Professional control conclusion: Control / No control / Further assessment. */
  controlConclusion?: AssessmentAnswer | null;
  /** Legacy joint-arrangement flag; superseded by `jointControl`. */
  isJointArrangement: boolean;
  /** A joint operation (line-by-line), as opposed to a joint venture (equity / proportionate). */
  jointArrangementIsOperation: boolean;
  /** Joint control conclusion (contractually agreed sharing of control). */
  jointControl?: AssessmentAnswer | null;
  /**
   * Legacy 20% presumption rebuttal: `true` = rebutted; `false` = SI despite
   * <20%; superseded by `significantInfluence`.
   */
  significantInfluenceRebutted: boolean | null;
  /** Significant influence conclusion: Yes / No / Further assessment. */
  significantInfluence?: AssessmentAnswer | null;
  /** Legacy indicator only — Track B's auditor matrix owns the component auditor. */
  auditedByOtherAuditor: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  country?: string | null;
  isIndianCompany?: boolean | null;
  /** Professional inclusion decision; null = take the system proposal. */
  included?: PerimeterInclusion | null;
  /** Reason for the inclusion decision (required when it differs from the proposal). */
  inclusionReason?: string | null;
  /** CFS-03 component reporting date (YYYY-MM-DD); null = not captured. */
  reportingDate?: string | null;
  reportingDateReason?: string | null;
  interimInformation?: string | null;
  interveningTransactions?: string | null;
  /** CFS-04 component local framework. */
  localFramework?: LocalFramework | null;
  /** CFS-04 professional alignment answer; null = take the system result. */
  policyAlignment?: PolicyAlignment | null;
  notes?: string | null;
}

/** CFS-03 result for one component. */
export interface ReportingDateAssessment {
  /** true = same date as the group; false = different; null = not captured. */
  sameAsGroup: boolean | null;
  componentDate: string | null;
  groupDate: string | null;
  /** Whole months between the dates (absolute). */
  gapMonths: number | null;
  /** The maximum gap from the selected standard's rule (null = none configured). */
  maxGapMonths: number | null;
  standard: string | null;
  ruleCode: string | null;
  ruleVersion: number | null;
  /** true / false when a limit applies; null = no limit configured or not captured. */
  withinLimit: boolean | null;
  /** What still has to be captured for a different date (reason, interim info, intervening events). */
  missing: string[];
  basis: string;
}

/** CFS-04 result for one component. */
export interface PolicyAssessment {
  localFramework: LocalFramework | null;
  groupFramework: LocalFramework | null;
  systemResult: PolicyAlignment;
  result: PolicyAlignment;
  basis: string;
}

/** The classified perimeter entry the engine produces for an investee (spec §8). */
export interface InvesteeClassification {
  id: string;
  name: string;
  ownershipPercent: number | null;
  votingPercent: number | null;
  relationship: InvesteeRelationship;
  method: ConsolidationMethod;
  /** The standard routing the method (e.g. 'AS 21', 'Ind AS 110', 'Ind AS 28', 'AS 27'). */
  standard: string | null;
  auditedByOtherAuditor: boolean;
  basis: string;
  /** The rule presumptions / factors used (spec §5 — never the % alone). */
  factors: string[];
  /** A professional control / influence / joint-control judgment is still required. */
  judgementRequired: boolean;
  /**
   * The professional conclusion rebuts a rule presumption (e.g. no control
   * despite voting power above the control presumption) — a control dispute
   * that needs Engagement Partner approval (spec §22). Null = none.
   */
  presumptionRebutted?: string | null;
  systemIncluded: PerimeterInclusion;
  included: PerimeterInclusion;
  inclusionReason: string;
  periodImpact: PeriodImpact | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  country: string | null;
  isIndianCompany: boolean | null;
  reportingDate: ReportingDateAssessment | null;
  policy: PolicyAssessment | null;
}

/** One cumulative Rule 6 condition (spec §7). */
export const CONDITION_RESULT = {
  satisfied: 'satisfied',
  failed: 'failed',
  pending: 'pending',
  notApplicable: 'not_applicable',
} as const;
export type ConditionResult = (typeof CONDITION_RESULT)[keyof typeof CONDITION_RESULT];
export const CONDITION_RESULT_LABEL: Record<ConditionResult, string> = {
  satisfied: 'Satisfied',
  failed: 'Failed',
  pending: 'Pending',
  not_applicable: 'Not applicable',
};

export const RULE6_CONDITION = {
  ownership: 'ownership',
  otherMembers: 'other_members',
  listing: 'listing',
  parentFiling: 'parent_filing',
} as const;
export type Rule6ConditionKey = (typeof RULE6_CONDITION)[keyof typeof RULE6_CONDITION];

export interface Rule6Condition {
  key: Rule6ConditionKey;
  label: string;
  requirement: string;
  result: ConditionResult;
  /** The portal evidence / facts behind the result. */
  evidence: string;
}

/** CFS-02 result. */
export const RULE6_RESULT = {
  available: 'available',
  notAvailable: 'not_available',
  pending: 'pending',
} as const;
export type Rule6Result = (typeof RULE6_RESULT)[keyof typeof RULE6_RESULT];
export const RULE6_RESULT_LABEL: Record<Rule6Result, string> = {
  available: 'Exemption Available',
  not_available: 'Exemption Not Available',
  pending: 'Information Pending',
};

/** The Rule 6 CFS-exemption assessment, condition-by-condition (CFS-02). */
export interface Rule6Assessment {
  /** true = exempt; false = not exempt; null = cannot determine (pending). */
  applies: boolean | null;
  /** Wholly-owned, or partially-owned with all other members intimated & no objection. */
  ownershipCondition: boolean | null;
  /** Securities not listed or in the process of listing. */
  notListedCondition: boolean | null;
  /** An intermediate/ultimate parent files Companies-Act-compliant CFS. */
  parentFilesCfsCondition: boolean | null;
  basis: string;
  result?: Rule6Result;
  conditions?: Rule6Condition[];
}

/** Written-intimation objection status for a partially-owned subsidiary (spec §7). */
export const MEMBER_OBJECTION_STATUS = {
  noObjection: 'no_objection',
  objectionReceived: 'objection_received',
  awaiting: 'awaiting',
} as const;
export type MemberObjectionStatus =
  (typeof MEMBER_OBJECTION_STATUS)[keyof typeof MEMBER_OBJECTION_STATUS];

/** Rule 6 evidence captured on 02.6 (spec §7). */
export interface Rule6Evidence {
  /** All other members (including those not otherwise entitled to vote) intimated in writing. */
  otherMembersIntimatedInWriting: boolean | null;
  intimationDate: string | null;
  /** Proof of delivery of the intimation retained. */
  proofOfDeliveryRetained: boolean | null;
  objectionStatus: MemberObjectionStatus | null;
  /** The ultimate / intermediate holding company filing compliant CFS. */
  parentName: string | null;
  parentFilingSrn: string | null;
  parentFilingDate: string | null;
}

export const EMPTY_RULE6_EVIDENCE: Rule6Evidence = {
  otherMembersIntimatedInWriting: null,
  intimationDate: null,
  proofOfDeliveryRetained: null,
  objectionStatus: null,
  parentName: null,
  parentFilingSrn: null,
  parentFilingDate: null,
};

/** The facts the 02.6 engine reads. Investees + Rule 6 facts are captured on 02.6; framework from 02.2. */
export interface ConsolidationFacts {
  /** The 02.2 reporting-framework conclusion — selects Ind AS vs AS standards. */
  reportingFramework: ReportingFrameworkOutcome | null;
  investees: InvesteeInput[];
  /** This company is itself a wholly-owned subsidiary (Rule 6 ownership condition). */
  isWhollyOwnedSubsidiary: boolean;
  /** This company is a partially-owned subsidiary (Rule 6, needs the no-objection proof). */
  isPartiallyOwnedSubsidiary: boolean;
  /** Legacy: all other members intimated in writing and do not object (superseded by rule6Evidence). */
  otherMembersIntimatedNoObjection: boolean;
  /** The company's securities are listed or in the process of listing (in/outside India). */
  securitiesListedOrInProcess: boolean;
  /** An intermediate/ultimate parent files compliant CFS with the Registrar (null = unknown). */
  parentFilesCompliantCfs: boolean | null;
  /** The master shows branch addresses (Track B's BR-01 suggestion). */
  hasBranches: boolean;
  rule6Evidence?: Rule6Evidence;
  /** Audit period (YYYY-MM-DD) — effective dates and the group reporting date. */
  periodStart?: string | null;
  periodEnd?: string | null;
}

/** The 02.6-specific facts captured on the sub-assessment (not held by 02.1/02.2). */
export interface ConsolidationCapturedFacts {
  investees: InvesteeInput[];
  isWhollyOwnedSubsidiary: boolean;
  isPartiallyOwnedSubsidiary: boolean;
  otherMembersIntimatedNoObjection: boolean;
  securitiesListedOrInProcess: boolean;
  parentFilesCompliantCfs: boolean | null;
  hasBranches: boolean;
  rule6Evidence?: Rule6Evidence;
  /** CFS-05 override technical basis / supporting evidence note (spec §22). */
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
}

/** A fact the engine used, with its source (spec §6 "show facts/rules used"). */
export interface ConsolidationFactUsed {
  key: string;
  label: string;
  value: string;
  source: string;
}

/** A rule version the engine used (spec §6, §25 frozen versions). */
export interface ConsolidationRuleUsed {
  code: string;
  version: number;
  label: string;
  value: string;
  effectiveFrom: string;
}

/** An Outstanding Information line (spec §4). */
export interface ConsolidationMissingFact {
  key: string;
  label: string;
  /** Component the item belongs to (null = group level). */
  componentId: string | null;
  /** Blocks the CFS-01 / CFS-02 conclusion (vs. completion only). */
  blocking: boolean;
}

/** Structured engine extras stored in `systemDetail`. */
export interface ConsolidationDetail {
  /** §129(3): the entity has at least one subsidiary/associate/JV. */
  cfsTriggered: boolean;
  /** The Rule 6 exemption assessment, or null when never reached. */
  rule6: Rule6Assessment | null;
  /** The classified consolidation perimeter. */
  perimeter: InvesteeClassification[];
  /** Any component audited by another auditor → SA 600 framework applies (legacy indicator). */
  usesOtherAuditors: boolean;
  /** The component-auditor standard: 'SA 600' when other auditors are used, else null. */
  saFramework: 'SA 600' | null;
  /** The master shows branch addresses (§143(8) suggestion for BR-01). */
  hasBranches: boolean;
  /** No fixed materiality % here — the perimeter passes to Section 03.3. */
  materialityNote: string;
  /** ONE group structure feeds CARO 3(xxi) and consolidated ICFR — no duplicate component entry. */
  crossLinkNote: string;
  /** 'ind_as' | 'as' — the group framework route (null until 02.2 concludes). */
  groupFramework?: 'ind_as' | 'as' | null;
  groupReportingDate?: string | null;
  factsUsed?: ConsolidationFactUsed[];
  rulesUsed?: ConsolidationRuleUsed[];
  missingFacts?: ConsolidationMissingFact[];
  /** Counts of perimeter relationships (included = yes). */
  counts?: Partial<Record<InvesteeRelationship, number>>;
  /** Components with a different reporting date / needing conversion. */
  reportingDateDifferences?: number;
  conversionsRequired?: number;
}

/** The result of the pure 02.6 engine. */
export interface ConsolidationResult {
  outcome: ConsolidationOutcome;
  state: FrameworkState;
  basis: string;
  ruleVersionId: string | null;
  /** The §129(3) provision (period-correct), frozen by the service. */
  authorityProvisionId: string | null;
  detail: ConsolidationDetail;
}

/** CFS-04 conversion work item status (spec §11). */
export const CONVERSION_STATUS = {
  open: 'open',
  inReview: 'in_review',
  completed: 'completed',
  withdrawn: 'withdrawn',
} as const;
export type ConversionStatus = (typeof CONVERSION_STATUS)[keyof typeof CONVERSION_STATUS];
export const CONVERSION_STATUS_LABEL: Record<ConversionStatus, string> = {
  open: 'Open',
  in_review: 'In review',
  completed: 'Completed',
  withdrawn: 'Withdrawn',
};

/** One GAAP / policy difference on a conversion work item. */
export interface ConversionDifference {
  area: string;
  description: string;
  /** Journal / workpaper reference for the conversion adjustment. */
  adjustmentReference: string | null;
  amount: number | null;
}

/**
 * A CFS-04 conversion work item for one component (spec §11). The component's
 * statutory accounts are never altered — the conversion is a separate layer.
 * Files (reporting package, final adjusted group TB) are SharePoint-backed
 * engagement documents.
 */
export interface ConsolidationConversion {
  id: string;
  componentId: string;
  componentName: string;
  localFramework: LocalFramework | null;
  groupFramework: LocalFramework | null;
  status: ConversionStatus;
  differences: ConversionDifference[];
  reviewerEmployeeId: string | null;
  reviewerName: string | null;
  reportingPackageDocumentId: string | null;
  reportingPackageName: string | null;
  adjustedTbDocumentId: string | null;
  adjustedTbName: string | null;
  reviewedAt: string | null;
  version: number;
}

export interface ConsolidationCompletionItem {
  key: string;
  label: string;
  /** null = not relevant for this engagement. */
  met: boolean | null;
  detail: string | null;
}

export interface ConsolidationCompletion {
  complete: boolean;
  status: 'not_started' | 'in_progress' | 'complete';
  items: ConsolidationCompletionItem[];
}

export interface ConsolidationPartnerApproval {
  required: boolean;
  reason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
}

/** CFS-05 summary (spec §22). */
export interface ConsolidationSummary {
  cfsRequired: boolean | null;
  counts: Partial<Record<InvesteeRelationship, number>>;
  dhvajComponents: number;
  otherAuditorComponents: number;
  branchAuditors: number;
  pendingReports: number;
  framework: string | null;
  workProgrammeGenerated: boolean;
}

/** A §21 roll-forward change indicator against the prior-year 02.6. */
export interface ConsolidationPriorYearChange {
  kind:
    | 'new_component'
    | 'disposed_component'
    | 'ownership_change'
    | 'reporting_date_change'
    | 'framework_change'
    | 'conclusion_change';
  componentId: string | null;
  componentName: string | null;
  message: string;
}

export interface ConsolidationPriorYear {
  financialYear: string;
  outcome: ConsolidationOutcome | null;
  basis: string | null;
  components: number;
  changes: ConsolidationPriorYearChange[];
}

/** The 02.6 read shape for one statutory-audit workflow instance. */
export interface StatutoryAuditConsolidation {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  detail: ConsolidationDetail | null;
  capturedFacts: ConsolidationCapturedFacts;
  baseFacts: ConsolidationFacts;
  /**
   * What the client master says for these facts, with its source — filled in
   * on first open so the team confirms rather than types.
   */
  masterFacts: MasterFact[];
  /** True once 02.1 is confirmed AND 02.2 concluded — 02.6 reads their frozen outputs. */
  upstreamReady: boolean;
  /** A technical memo is suggested (override / further assessment / EP approval required). */
  memoSuggested?: boolean;
  professionalAction?: ConsolidationProfessionalAction | null;
  pendingReason?: string | null;
  partnerApproval?: ConsolidationPartnerApproval;
  completion?: ConsolidationCompletion;
  summary?: ConsolidationSummary;
  conversions?: ConsolidationConversion[];
  groupAudit?: GroupAuditStatus | null;
  priorYear?: ConsolidationPriorYear | null;
  /** The audit period start — the date references / rules resolve on. */
  periodStart?: string;
  /** CARO 3(xxi) / consolidated-ICFR component rows fed from this perimeter (spec §20). */
  crossLinks?: ConsolidationCrossLinks;
  /** The framework is approved (frozen) — 02.6 is read-only until a reassessment reopens it. */
  approved?: boolean;
  /** The viewer is the engagement's Engagement Partner (CFS-05 approval). */
  viewerIsPartner?: boolean;
}

/** CARO 3(xxi) / consolidated-ICFR component rows fed from 02.6 (null = that module is not in scope). */
export interface ConsolidationCrossLinks {
  caroComponents: number | null;
  icfrComponents: number | null;
}

/** Capture the 02.6-specific facts. */
export interface SetConsolidationFactsInput {
  investees?: InvesteeInput[];
  isWhollyOwnedSubsidiary?: boolean;
  isPartiallyOwnedSubsidiary?: boolean;
  otherMembersIntimatedNoObjection?: boolean;
  securitiesListedOrInProcess?: boolean;
  parentFilesCompliantCfs?: boolean | null;
  hasBranches?: boolean;
  rule6Evidence?: Partial<Rule6Evidence>;
  version: number;
}

/** CFS-05: Confirm / Override / Information Pending (spec §22). */
export interface RecordConsolidationDecisionInput {
  /** Omitted = legacy: confirm when it matches the suggestion, else override. */
  action?: ConsolidationProfessionalAction;
  conclusion?: ConsolidationOutcome;
  basis?: string | null;
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
  pendingReason?: string | null;
  impact?: string | null;
  version: number;
}

/** CFS-05 Engagement Partner approval. */
export interface PartnerApproveConsolidationInput {
  note?: string | null;
  version: number;
}

/** Update a CFS-04 conversion work item. */
export interface UpdateConsolidationConversionInput {
  status?: ConversionStatus;
  differences?: ConversionDifference[];
  reviewerEmployeeId?: string | null;
  reportingPackageDocumentId?: string | null;
  adjustedTbDocumentId?: string | null;
  version: number;
}

/** Result of filling 02.6 facts from the client master. */
export interface StatutoryAuditConsolidationMasterFillResult {
  consolidation: StatutoryAuditConsolidation;
  /** What was filled (empty when the master had nothing new to add). */
  filled: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec v1.0 build (two tracks, docs/02-6-consolidation-build-split.md).
// Track A owns this file; Track B's own types live in statutory-audit-group-audit.ts
// and import these (never re-export the same names).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provision codes (spec §23) — resolved through the central Provision Library,
 * never a URL in a component. Track B seeds the ones not yet in the library
 * (COS_ACT_2_6) and the `authority_reference_link` rows under context '02.6'.
 */
export const CONSOLIDATION_PROVISION_CODE = {
  section129_3: 'COS_ACT_129_3',
  section2_6: 'COS_ACT_2_6',
  rule6: 'ACCT_RULE_6',
  as21: 'AS_21',
  as23: 'AS_23',
  as27: 'AS_27',
  indAs110: 'INDAS_110',
  indAs111: 'INDAS_111',
  indAs28: 'INDAS_28',
  sa600: 'SA_600',
  section143_8: 'COS_ACT_143_8',
} as const;

/** `authority_reference_link` anchors under context '02.6' (spec §23). */
export const CONSOLIDATION_REFERENCE_CONTEXT = '02.6';
export const CONSOLIDATION_REFERENCE_ANCHOR = {
  section129_3: 'section_129_3',
  section2_6: 'section_2_6',
  rule6: 'rule_6',
  as21: 'as_21',
  as23: 'as_23',
  as27: 'as_27',
  indAs110: 'ind_as_110',
  indAs111: 'ind_as_111',
  indAs28: 'ind_as_28',
  sa600: 'sa_600',
  section143_8: 'section_143_8',
} as const;

/** Who audits a component (spec §8, §12) — Track B's auditor matrix owns the value. */
export const COMPONENT_AUDITOR_TYPE = {
  dhvaj: 'dhvaj',
  otherAuditor: 'other_auditor',
  unaudited: 'unaudited_special_purpose',
  none: 'none',
  tbd: 'tbd',
} as const;
export type ComponentAuditorType =
  (typeof COMPONENT_AUDITOR_TYPE)[keyof typeof COMPONENT_AUDITOR_TYPE];
export const COMPONENT_AUDITOR_TYPE_LABEL: Record<ComponentAuditorType, string> = {
  dhvaj: 'DHVAJ',
  other_auditor: 'Another auditor',
  unaudited_special_purpose: 'Unaudited / special purpose',
  none: 'None',
  tbd: 'TBD',
};

/**
 * One component of the 02.6 consolidation perimeter as other modules see it
 * (Track B's auditor matrix, instructions, packages; 02.4 3(xxi); 02.5
 * consolidated; 03.3). `id` is stable across edits and years (roll-forward keeps it).
 */
export interface ConsolidationComponentRef {
  id: string;
  name: string;
  /** Classified relationship (subsidiary / associate / joint_venture / joint_operation / none). */
  relationship: InvesteeRelationship;
  method: ConsolidationMethod;
  included: PerimeterInclusion;
  country: string | null;
  /** Incorporated in India (a company under the Companies Act) — null = unknown. */
  isIndianCompany: boolean | null;
  /** Component reporting date (CFS-03) — null = not captured. */
  reportingDate: string | null;
  /** Component local framework (CFS-04): 'ind_as' | 'as' | 'ifrs' | 'local_gaap' | 'other'. */
  localFramework: string | null;
}

/**
 * The 02.6 result for one workflow instance as downstream modules read it
 * (DI-free `consolidation-read.ts` → `readConsolidationResultOn`, Track A).
 */
export interface ConsolidationApprovedResult {
  workflowInstanceId: string;
  /** Conclusion when decided, else the stored system suggestion. */
  outcome: ConsolidationOutcome | null;
  decided: boolean;
  /**
   * 02.6 COMPLETE (spec §24). Null from `readConsolidationResultOn` (Track B's
   * group reader calls it); `readConsolidationStatusOn` fills it.
   */
  complete: boolean | null;
  /** true = CFS required; false = not required / exempt; null = not yet known. */
  cfsRequired: boolean | null;
  /** The group reporting framework from 02.2 (null until 02.2 concludes). */
  groupFramework: ReportingFrameworkOutcome | null;
  components: ConsolidationComponentRef[];
  /** The master shows branch addresses — Track B's BR-01 suggestion. */
  branchesOnMaster: boolean;
  financialYear: string | null;
  /** Audit period start (rule / provision resolution date). */
  periodStart: string;
}

/**
 * Track B's group-audit status (DI-free `consolidation-group-read.ts` →
 * `groupAuditStatusOn`), read by Track A for the landing screen (Other Auditors,
 * Outstanding Information, Workstream), the CFS-05 summary and the §24 checklist.
 */
export interface GroupAuditStatus {
  /** The auditor matrix has a row for every included component. */
  matrixComplete: boolean;
  dhvajComponents: number;
  otherAuditorComponents: number;
  tbdComponents: number;
  /** Per component id: the matrix auditor type + firm (A shows it on the perimeter). */
  byComponent: Record<
    string,
    { auditorType: ComponentAuditorType | null; auditorName: string | null }
  >;
  /** SA 600 applies (any other component auditor / branch auditor). */
  sa600Required: boolean;
  /** GA-01..GA-04 answers still Pending / Further Assessment. */
  sa600Pending: number;
  /** Other-auditor components with no component instructions issued. */
  instructionsPending: number;
  /** Required reporting-package documents not yet received (spec §15). */
  pendingReports: number;
  /** BR-01 answer. */
  branchAuditPresent: 'yes' | 'no' | 'pending';
  branchAuditors: number;
  /** Branch auditor records missing a report / principal-auditor response. */
  branchPending: number;
  /** Consolidation work programme generated (§19). */
  workProgrammeGenerated: boolean;
  /** Blocking matters (material GA-04 Pending, unresolved significant findings), as sentences. */
  blockingMatters: string[];
}
