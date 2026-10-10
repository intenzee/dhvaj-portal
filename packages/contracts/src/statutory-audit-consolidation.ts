/**
 * 02.6 — Consolidation / Group Audit Framework (Implementation Guide §9.6).
 *
 * Decides whether Consolidated Financial Statements are required (Section 129(3)
 * trigger, less the Rule 6 exemption tested condition-by-condition), classifies
 * the consolidation perimeter and accounting method per investee, and frames the
 * SA 600 component / Section 143(8) branch-auditor work.
 *
 * Percentages are inputs / rebuttable presumptions, NEVER the whole test (guide
 * §9.6): control is a captured judgment (Ind AS 110 is principle-based) that
 * overrides the >50% presumption; significant influence is a 20% presumption
 * rebuttable BOTH ways. The Rule 6 exemption is cumulative — no ownership % alone
 * creates it; a missing parent-CFS-filing status leaves it pending. There is NO
 * fixed materiality % here — the perimeter passes to Section 03.3 — and the ONE
 * group structure feeds CARO 3(xxi) (02.4) and consolidated ICFR (02.5) with no
 * duplicate component entry.
 *
 * NO statutory number lives in code (guide §1): the >50% control and 20%
 * significant-influence presumptions resolve from the Audit Rules Library by the
 * engagement's audit period, so historical versions freeze.
 */

import type { MasterFact } from './statutory-audit';
import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';
import type { ReportingFrameworkOutcome } from './statutory-audit-financial-reporting';

/** The Level-1 CFS-requirement outcome the engine concludes (§9.6). */
export const CONSOLIDATION_OUTCOME = {
  /** CFS must be prepared (§129(3) triggers and no Rule 6 exemption). */
  cfsRequired: 'cfs_required',
  /** §129(3) triggers but the Rule 6 exemption holds — CFS not required. */
  cfsExempt: 'cfs_exempt',
  /** No subsidiary/associate/JV — §129(3) does not trigger CFS. */
  notApplicable: 'not_applicable',
  /** The system cannot decide — a professional must. */
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

/** How an investee relates to the group (drives the accounting method). */
export const INVESTEE_RELATIONSHIP = {
  subsidiary: 'subsidiary',
  associate: 'associate',
  jointVenture: 'joint_venture',
  jointOperation: 'joint_operation',
  none: 'none',
} as const;
export type InvesteeRelationship =
  (typeof INVESTEE_RELATIONSHIP)[keyof typeof INVESTEE_RELATIONSHIP];

/** The consolidation / equity accounting method applied to an investee. */
export const CONSOLIDATION_METHOD = {
  fullConsolidation: 'full_consolidation',
  equityMethod: 'equity_method',
  proportionateConsolidation: 'proportionate_consolidation',
  jointOperationLineByLine: 'joint_operation_line_by_line',
  none: 'none',
} as const;
export type ConsolidationMethod = (typeof CONSOLIDATION_METHOD)[keyof typeof CONSOLIDATION_METHOD];

/** One investee input captured on the sub-assessment (guide §9.6). */
export interface InvesteeInput {
  name: string;
  ownershipPercent: number | null;
  /**
   * The captured control judgment (Ind AS 110 principle-based). `true`/`false`
   * overrides the ownership presumption; `null` falls back to the >50% presumption.
   */
  hasControl: boolean | null;
  /** A contractual joint arrangement (Ind AS 111 / AS 27). */
  isJointArrangement: boolean;
  /** A joint operation (line-by-line), as opposed to a joint venture (equity). */
  jointArrangementIsOperation: boolean;
  /**
   * The 20% significant-influence presumption rebuttal: `true` = rebutted (no SI
   * despite ≥20%); `false` = SI established despite <20%; `null` = presumption stands.
   */
  significantInfluenceRebutted: boolean | null;
  /** The component is audited by another auditor → SA 600 framework. */
  auditedByOtherAuditor: boolean;
}

/** The classified perimeter entry the engine produces for an investee. */
export interface InvesteeClassification {
  name: string;
  ownershipPercent: number | null;
  relationship: InvesteeRelationship;
  method: ConsolidationMethod;
  auditedByOtherAuditor: boolean;
  basis: string;
}

/** The Rule 6 CFS-exemption assessment, condition-by-condition (guide §9.6). */
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
}

/** The facts the 02.6 engine reads. Investees + Rule 6 facts are captured on 02.6; framework from 02.2. */
export interface ConsolidationFacts {
  /** The 02.2 reporting-framework conclusion — selects Ind AS vs AS standards. */
  reportingFramework: ReportingFrameworkOutcome | null;
  investees: InvesteeInput[];
  /** This company is itself a wholly-owned subsidiary (Rule 6 ownership condition). */
  isWhollyOwnedSubsidiary: boolean;
  /** This company is a partially-owned subsidiary (Rule 6, needs the no-objection proof). */
  isPartiallyOwnedSubsidiary: boolean;
  /** All other members intimated in writing and do not object (proof retained). */
  otherMembersIntimatedNoObjection: boolean;
  /** The company's securities are listed or in the process of listing (in/outside India). */
  securitiesListedOrInProcess: boolean;
  /** An intermediate/ultimate parent files compliant CFS with the Registrar (null = unknown). */
  parentFilesCompliantCfs: boolean | null;
  /** The entity has branches whose audit is by a branch auditor (§143(8)). */
  hasBranches: boolean;
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
}

/** Structured engine extras stored in `systemDetail`. */
export interface ConsolidationDetail {
  /** §129(3): the entity has at least one subsidiary/associate/JV. */
  cfsTriggered: boolean;
  /** The Rule 6 exemption assessment, or null when never reached. */
  rule6: Rule6Assessment | null;
  /** The classified consolidation perimeter. */
  perimeter: InvesteeClassification[];
  /** Any component audited by another auditor → SA 600 framework applies. */
  usesOtherAuditors: boolean;
  /** The component-auditor standard: 'SA 600' when other auditors are used, else null. */
  saFramework: 'SA 600' | null;
  /** Branches present → Section 143(8) branch-auditor framework. */
  hasBranches: boolean;
  /** No fixed materiality % here — the perimeter passes to Section 03.3 (guide §9.6). */
  materialityNote: string;
  /** ONE group structure feeds CARO 3(xxi) and consolidated ICFR — no duplicate component entry. */
  crossLinkNote: string;
}

/** The result of the pure 02.6 engine (guide §7 signature). */
export interface ConsolidationResult {
  outcome: ConsolidationOutcome;
  state: FrameworkState;
  basis: string;
  ruleVersionId: string | null;
  /** The §129(3) provision (period-correct), frozen by the service. */
  authorityProvisionId: string | null;
  detail: ConsolidationDetail;
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
   * on first open so the team confirms rather than types (Guide §1).
   */
  masterFacts: MasterFact[];
  /** True once 02.1 is confirmed AND 02.2 concluded — 02.6 reads their frozen outputs. */
  upstreamReady: boolean;
  /** A technical memo is suggested (override / further assessment / EP approval required). */
  memoSuggested?: boolean;
}

/** Capture the 02.6-specific facts (guide §9.6). */
export interface SetConsolidationFactsInput {
  investees?: InvesteeInput[];
  isWhollyOwnedSubsidiary?: boolean;
  isPartiallyOwnedSubsidiary?: boolean;
  otherMembersIntimatedNoObjection?: boolean;
  securitiesListedOrInProcess?: boolean;
  parentFilesCompliantCfs?: boolean | null;
  hasBranches?: boolean;
  version: number;
}

/** Record the professional CFS conclusion for 02.6 (override needs a basis, §19). */
export interface RecordConsolidationDecisionInput {
  conclusion: ConsolidationOutcome;
  basis?: string | null;
  impact?: string | null;
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

/** Whether a perimeter entity is included in the CFS (spec §8). */
export const PERIMETER_INCLUSION = { yes: 'yes', no: 'no', pending: 'pending' } as const;
export type PerimeterInclusion = (typeof PERIMETER_INCLUSION)[keyof typeof PERIMETER_INCLUSION];

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
  /** 02.6 COMPLETE (spec §24). */
  complete: boolean;
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
