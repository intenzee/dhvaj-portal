/**
 * 02.2 — Applicable Financial Reporting Framework (Section 02.2 Web Developer
 * Specification v1.0; Implementation Guide §9.2).
 *
 * Decides Ind AS / Accounting Standards / a specialised framework, with legal
 * basis, by running the Rule-4 roadmap engine (02.2D) over the confirmed 02.1
 * facts — never re-asking a fact 02.1 already holds. Where the engine concludes
 * Accounting Standards it also computes the SMC sub-assessment; where it concludes
 * Ind AS for the first time it flags Ind AS 101 downstream (no transition testing
 * here). NO statutory number lives in code (spec §2): every roadmap threshold,
 * effective date, exception and SMC ceiling resolves from the Audit Rules Library
 * by the engagement's audit period, so a future change affects future periods only.
 */

import type { MasterFact } from './statutory-audit';
import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

/** The applicable reporting framework the engine concludes. */
export const REPORTING_FRAMEWORK_OUTCOME = {
  indAs: 'ind_as',
  accountingStandards: 'accounting_standards',
  /** Bank/insurance/regulated — a specialised statutory framework applies. */
  specialised: 'specialised_framework',
  /** A deciding fact / rule is absent — never a guess (guide §4.3). */
  informationInsufficient: 'information_insufficient',
  /** The system cannot safely decide; a professional must. */
  professionalReview: 'professional_review_required',
} as const;
export type ReportingFrameworkOutcome =
  (typeof REPORTING_FRAMEWORK_OUTCOME)[keyof typeof REPORTING_FRAMEWORK_OUTCOME];
export const REPORTING_FRAMEWORK_OUTCOMES: ReportingFrameworkOutcome[] = Object.values(
  REPORTING_FRAMEWORK_OUTCOME,
);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const REPORTING_FRAMEWORK_CONCLUSIONS: ReportingFrameworkOutcome[] = [
  REPORTING_FRAMEWORK_OUTCOME.indAs,
  REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
  REPORTING_FRAMEWORK_OUTCOME.specialised,
];

export const REPORTING_FRAMEWORK_LABEL: Record<ReportingFrameworkOutcome, string> = {
  ind_as: 'Ind AS',
  accounting_standards: 'Accounting Standards (AS)',
  specialised_framework: 'Specialised / Further Assessment Required',
  information_insufficient: 'Information Insufficient',
  professional_review_required: 'Professional Review Required',
};

/** The SMC (Small & Medium Sized Company) sub-status when Accounting Standards apply. */
export const SMC_STATUS = {
  smc: 'smc',
  nonSmc: 'non_smc',
  informationInsufficient: 'information_insufficient',
  notApplicable: 'not_applicable',
} as const;
export type SmcStatus = (typeof SMC_STATUS)[keyof typeof SMC_STATUS];
export const SMC_STATUS_LABEL: Record<SmcStatus, string> = {
  smc: 'SMC',
  non_smc: 'Non-SMC',
  information_insufficient: 'Information Insufficient',
  not_applicable: 'Not applicable',
};

/** §14 Applicability type of an Ind AS conclusion. */
export const APPLICABILITY_TYPE = {
  mandatory: 'mandatory',
  voluntary: 'voluntary',
  continuing: 'continuing',
} as const;
export type ApplicabilityType = (typeof APPLICABILITY_TYPE)[keyof typeof APPLICABILITY_TYPE];
export const APPLICABILITY_TYPE_LABEL: Record<ApplicabilityType, string> = {
  mandatory: 'Mandatory',
  voluntary: 'Voluntary',
  continuing: 'Continuing',
};

/** §8 Entity category branch the engine routes through. */
export const ENTITY_BRANCH = {
  nonCompany: 'non_company',
  ordinary: 'ordinary',
  nbfc: 'nbfc',
  bank: 'bank',
  insurance: 'insurance',
  otherSpecial: 'other_special',
} as const;
export type EntityBranch = (typeof ENTITY_BRANCH)[keyof typeof ENTITY_BRANCH];
export const ENTITY_BRANCH_LABEL: Record<EntityBranch, string> = {
  non_company: 'Not a company',
  ordinary: 'Ordinary corporate entity',
  nbfc: 'NBFC',
  bank: 'Banking company',
  insurance: 'Insurance company',
  other_special: 'Other special entity',
};

/** §12 Listing status used for the Ind AS assessment (FRF-04). */
export const FRF_LISTING_STATUS = {
  listed: 'listed',
  inProcess: 'in_process',
  unlisted: 'unlisted',
} as const;
export type FrfListingStatus = (typeof FRF_LISTING_STATUS)[keyof typeof FRF_LISTING_STATUS];

/** A Yes / No / Information Pending answer (FRF-02, FRF-03, group, SMC group). */
export const FRF_ANSWER = { yes: 'yes', no: 'no', pending: 'pending' } as const;
export type FrfAnswer = (typeof FRF_ANSWER)[keyof typeof FRF_ANSWER];

/** FRF-01 framework followed in the immediately preceding financial year. */
export const PRIOR_FRAMEWORK = {
  indAs: 'ind_as',
  accountingStandards: 'accounting_standards',
  notAvailable: 'not_available',
} as const;
export type PriorFramework = (typeof PRIOR_FRAMEWORK)[keyof typeof PRIOR_FRAMEWORK];

/** Result of one test (net worth, listing, SMC condition, …). */
export const FRF_TEST_RESULT = {
  met: 'met',
  notMet: 'not_met',
  insufficient: 'information_insufficient',
  notApplicable: 'not_applicable',
  reviewRequired: 'review_required',
} as const;
export type FrfTestResult = (typeof FRF_TEST_RESULT)[keyof typeof FRF_TEST_RESULT];

/** §14 Confidence / status of the system conclusion. */
export const FRF_CONFIDENCE = {
  determined: 'determined',
  informationPending: 'information_pending',
  professionalReview: 'professional_review_required',
} as const;
export type FrfConfidence = (typeof FRF_CONFIDENCE)[keyof typeof FRF_CONFIDENCE];

/** §11 Effect of a related entity on the subject company. */
export const GROUP_EFFECT = {
  triggers: 'triggers',
  noTrigger: 'no_trigger',
  reviewRequired: 'review_required',
} as const;
export type GroupEffect = (typeof GROUP_EFFECT)[keyof typeof GROUP_EFFECT];

export type GroupRelationship = 'holding' | 'subsidiary' | 'joint_venture' | 'associate';
export type RelatedFramework = 'ind_as' | 'accounting_standards' | 'unknown';

/** FRF-05 auditor conclusion action. */
export const FRF_PROFESSIONAL_ACTION = {
  confirm: 'confirm',
  override: 'override',
  informationPending: 'information_pending',
} as const;
export type FrfProfessionalAction =
  (typeof FRF_PROFESSIONAL_ACTION)[keyof typeof FRF_PROFESSIONAL_ACTION];

// ── Facts ──────────────────────────────────────────────────────────────────

/** One measured net-worth figure (standalone audited FS at a financial-year end). */
export interface NetWorthPoint {
  /** The year-end date the figure is measured at (ISO date). */
  asAt: string;
  /** The financial year it closes, 'YYYY-YY'. */
  financialYear: string;
  value: number;
  source: string;
  /** The engagement document holding the financial statements (02.1 Card D), when linked. */
  sourceDocumentId?: string | null;
  /** An https link to the statements (client master's supporting reference), when given. */
  sourceUrl?: string | null;
}

/** A group company confirmed in 02.1 / the client master (no duplicate entry, §11). */
export interface RelatedEntityFact {
  name: string;
  relationship: GroupRelationship;
  framework: RelatedFramework;
  /** Why the framework is known (e.g. "Listed on NSE/BSE", "Its FY 2024-25 audit file"). */
  frameworkSource: string | null;
}

/**
 * The normalised facts the 02.2 engine reads. The masters/02.1-derived facts are
 * assembled server-side; the 02.2-specific answers are captured once on the
 * sub-assessment (see {@link FinancialReportingCapturedFacts}).
 */
export interface FinancialReportingFacts {
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  /** Listed OR in process of listing (kept for older callers). */
  isListed: boolean;
  /** §12 listing status from 02.1 / the listings master. */
  listingStatus?: FrfListingStatus;
  /** Exchanges of the live / in-process listings (`nse`, `bse`, `sme`, `other`). */
  listingExchanges?: string[];
  /** Listed / in process only on an SME exchange or the ITP — the Rule 4 proviso. */
  isListedOnSmeExchange: boolean;
  isNbfc: boolean;
  isBankOrInsurance: boolean;
  isBank?: boolean;
  isInsurance?: boolean;
  /** 02.1 special entity types (for the "other special entity" route, §8). */
  specialEntityTypes?: string[];
  /** Already applying Ind AS in a prior year — continuing status wins. */
  priorIndAs: boolean;
  /** Voluntarily adopted Ind AS. */
  voluntaryIndAs: boolean;
  /** The team confirmed that a group relationship pulls the entity into Ind AS. */
  groupTriggersIndAs: boolean;
  /** Applicable net worth (standalone, at the end of the preceding year). */
  netWorth: number | null;
  /** Net worth series used for the Rule 4 timing mechanics (§10), oldest first. */
  netWorthHistory?: NetWorthPoint[];
  /** Turnover of the immediately preceding year, excluding other income (SMC). */
  turnover: number | null;
  /** Maximum borrowings during the preceding year incl. public deposits (SMC). */
  borrowings: number | null;

  // FRF-01..03 answers, normalised (null = not answered yet).
  priorFramework?: PriorFramework | null;
  priorFrameworkSource?: string | null;
  indAsAlreadyApplicable?: FrfAnswer | null;
  firstIndAsFy?: string | null;
  originalTrigger?: string | null;
  voluntaryAnswer?: FrfAnswer | null;
  voluntaryFirstIndAsFy?: string | null;
  /** §11 group companies from 02.1 / the master. */
  relatedEntities?: RelatedEntityFact[];
  /** Team's answer on the group test when a relationship needs review. */
  groupAnswer?: FrfAnswer | null;
  /** SMC group condition: is the company a holding/subsidiary of a non-SMC? */
  groupNonSmc?: FrfAnswer | null;
  /** The audit year, 'YYYY-YY', and its first day (ISO). */
  auditFinancialYear?: string;
  auditPeriodStart?: string;
}

/** The 02.2-specific facts captured on the sub-assessment (not held by 02.1). */
export interface FinancialReportingCapturedFacts {
  isListedOnSmeExchange: boolean;
  priorIndAs: boolean;
  voluntaryIndAs: boolean;
  groupTriggersIndAs: boolean;
  /** FRF-01 — set by the team when no prior portal file holds it. */
  priorFramework?: PriorFramework | null;
  priorFrameworkSource?: string | null;
  /** FRF-02 — Ind AS already applicable/adopted in an earlier year. */
  indAsAlreadyApplicable?: FrfAnswer | null;
  firstIndAsFy?: string | null;
  originalTrigger?: string | null;
  /** FRF-03 — voluntary adoption; the first Ind AS FY is required when Yes. */
  voluntaryAnswer?: FrfAnswer | null;
  voluntaryFirstIndAsFy?: string | null;
  /** §11 — the team's answer when a group relationship needs review. */
  groupAnswer?: FrfAnswer | null;
  /** §16 — SMC group condition (holding/subsidiary of a non-SMC company). */
  groupNonSmc?: FrfAnswer | null;
  /** §16 — maximum borrowings at any time in the preceding year (overrides the balance). */
  smcMaxBorrowings?: number | null;
  /** FRF-06 — the team's confirm/override of the first-time adoption suggestion. */
  firstTimeAdoption?: boolean | null;
  firstTimeAdoptionReason?: string | null;
}

// ── Engine output ──────────────────────────────────────────────────────────

/** A Rules Library rule the engine evaluated (§9 "UI must show the actual rule used"). */
export interface FrfAppliedRule {
  ruleCode: string;
  ruleVersionId: string;
  authorityProvisionId: string | null;
  /** Human label, e.g. "Unlisted company — net worth ≥ ₹250.00 cr". */
  label: string;
  operator: string | null;
  threshold: number | null;
  effectiveFrom: string;
  /** Whether the rule fired, did not fire, or is an exception that was applied. */
  result: 'triggered' | 'not_triggered' | 'exception_applied';
}

/** A fact the conclusion used, clickable to its source field (§14). */
export interface FrfFactUsed {
  key: string;
  label: string;
  value: string;
  source: string;
  /** DOM anchor of the source field (02.1 card or a 02.2 control), when on screen. */
  anchor: string | null;
}

/** A fact that prevents determination (§15 "show exactly which fact"). */
export interface FrfMissingFact {
  key: string;
  label: string;
  source: string;
  anchor: string | null;
}

/** §10 net-worth assessment. */
export interface FrfNetWorthAssessment {
  value: number | null;
  /** The measurement date the rules engine selected. */
  measurementDate: string | null;
  source: string | null;
  /** "Open Source" (§10): the linked financial statements in the engagement workspace. */
  sourceDocumentId?: string | null;
  /** "Open Source" when the statements live outside the portal (https only). */
  sourceUrl?: string | null;
  threshold: number | null;
  ruleCode: string | null;
  result: FrfTestResult;
  /** The FY in which the threshold was first met, and the FY Ind AS then applies from. */
  firstMetFy: string | null;
  appliesFromFy: string | null;
  note: string | null;
}

/** §12 listing / SME-exchange assessment (FRF-04). */
export interface FrfListingAssessment {
  status: FrfListingStatus;
  exchanges: string[];
  smeOrItp: boolean;
  /** True when the Rule 4 SME/ITP proviso removes the mandatory roadmap. */
  provisoApplies: boolean;
  provisoRuleCode: string | null;
  note: string | null;
}

/** §11 one row of the group relationship test. */
export interface FrfGroupRow {
  relatedEntity: string;
  relationship: GroupRelationship;
  relatedFramework: RelatedFramework;
  relatedFrameworkSource: string | null;
  effect: GroupEffect;
}

export interface FrfGroupAssessment {
  rows: FrfGroupRow[];
  result: GroupEffect | 'none';
  /** Relationship path shown when the group triggers Ind AS. */
  path: string | null;
  ruleCode: string | null;
}

export interface FrfSmcCondition {
  key: 'listing' | 'entity_type' | 'turnover' | 'borrowings' | 'group';
  label: string;
  result: FrfTestResult;
  detail: string;
}

/** §16 SMC sub-assessment (only when AS applies). */
export interface FrfSmcAssessment {
  status: SmcStatus;
  turnover: number | null;
  turnoverThreshold: number | null;
  borrowings: number | null;
  borrowingsThreshold: number | null;
  conditions: FrfSmcCondition[];
  ruleCodes: string[];
  authorityProvisionId: string | null;
}

/** Structured engine extras stored in `systemDetail`. */
export interface FinancialReportingDetail {
  smcStatus: SmcStatus;
  /** True when Ind AS is concluded for the first time → flag Ind AS 101 downstream. */
  firstTimeIndAs: boolean;
  /** The net-worth roadmap threshold that decided Ind AS applicability (rupees). */
  indAsThreshold: number | null;
  isNbfc: boolean;
  applicabilityType?: ApplicabilityType | null;
  /** The FY Ind AS applies from, 'YYYY-YY'. */
  effectiveFromFy?: string | null;
  primaryTrigger?: string | null;
  secondaryTriggers?: string[];
  entityBranch?: EntityBranch;
  confidence?: FrfConfidence;
  rulesApplied?: FrfAppliedRule[];
  /** e.g. "₹250.00 cr" / "₹500.00 cr" / "Not applicable". */
  limitApplied?: string | null;
  factsUsed?: FrfFactUsed[];
  missingFacts?: FrfMissingFact[];
  netWorth?: FrfNetWorthAssessment | null;
  listing?: FrfListingAssessment | null;
  group?: FrfGroupAssessment | null;
  smc?: FrfSmcAssessment | null;
  /** Specialised / further assessment → a blocking Framework Review (§19). */
  blockingReview?: boolean;
}

/** The result of the pure 02.2 engine. */
export interface FinancialReportingResult {
  outcome: ReportingFrameworkOutcome;
  state: FrameworkState;
  basis: string;
  ruleVersionId: string | null;
  authorityProvisionId: string | null;
  detail: FinancialReportingDetail;
}

// ── Read shape ─────────────────────────────────────────────────────────────

export interface FrfCompletionItem {
  key: string;
  label: string;
  /** null = not relevant for this engagement. */
  met: boolean | null;
  detail: string | null;
}

export interface FrfCompletion {
  complete: boolean;
  status: 'not_started' | 'in_progress' | 'complete';
  items: FrfCompletionItem[];
}

export interface FrfPartnerApproval {
  /** Significant override / complex conclusion needs the Engagement Partner (FRF-05). */
  required: boolean;
  reason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
}

export interface FrfFirstTimeAdoption {
  /** The system suggestion (FRF-06). */
  system: boolean;
  /** The team's confirm/override, null until answered. */
  confirmed: boolean | null;
  /** What downstream uses: confirmed ?? system (only when the framework is Ind AS). */
  effective: boolean;
  reason: string | null;
}

/**
 * The 02.2 read shape for one statutory-audit workflow instance: the shared
 * sub-assessment plus the typed 02.2 detail, the captured facts and the base
 * facts the engine used (for display + traceability).
 */
export interface StatutoryAuditFinancialReporting {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail. */
  detail: FinancialReportingDetail | null;
  /**
   * What the client master and earlier audit files say for these facts, with
   * the source — filled in on first open so the team confirms rather than types.
   */
  masterFacts: MasterFact[];
  capturedFacts: FinancialReportingCapturedFacts;
  /** The base facts assembled from confirmed 02.1 + masters (read-only display). */
  baseFacts: FinancialReportingFacts;
  /** True once 02.1 is confirmed — 02.2 reads its frozen fact set. */
  profileConfirmed: boolean;
  auditFinancialYear?: string;
  /** FRF-05 action last recorded, and the reason when Information Pending. */
  professionalAction?: FrfProfessionalAction | null;
  pendingReason?: string | null;
  partnerApproval?: FrfPartnerApproval;
  firstTimeAdoption?: FrfFirstTimeAdoption;
  /** §21 completion rules; complete ⇒ 02.2 COMPLETE. */
  completion?: FrfCompletion;
  /** Show "Create Financial Reporting Framework Memo" (§18). */
  memoSuggested?: boolean;
  /** A blocking Framework Review matter is open (§19). */
  blockingReviewOpen?: boolean;
  /** Section 02 approved (AF-02) — 02.2 is frozen. */
  approved?: boolean;
  /** The viewer is the engagement partner (may give FRF-05 partner approval). */
  viewerIsPartner?: boolean;
}

/**
 * The approved/current 02.2 result handed to downstream sections (02.3–02.9,
 * work generation). Read through `readFinancialReportingResult` — never parse
 * `system_detail` directly.
 */
export interface FinancialReportingApprovedResult {
  workflowInstanceId: string;
  /** The professional conclusion when decided, else null. */
  framework: ReportingFrameworkOutcome | null;
  systemOutcome: ReportingFrameworkOutcome | null;
  applicabilityType: ApplicabilityType | null;
  effectiveFromFy: string | null;
  isNbfc: boolean;
  smcStatus: SmcStatus;
  /** FRF-06 effective value (confirmed ?? system), false unless Ind AS. */
  firstTimeAdoption: boolean;
  /** §21 completion met. */
  complete: boolean;
  /** Section 02 approved (AF-02). */
  approved: boolean;
  ruleVersionId: string | null;
  authorityProvisionId: string | null;
}

/** Display strings of the CURRENT 02.2 assessment, for the technical memo merge (§18). */
export interface FinancialReportingMemoFacts {
  entityName: string;
  financialYear: string;
  framework: string;
  applicabilityType: string;
  effectiveFromFy: string;
  primaryTrigger: string;
  secondaryTriggers: string;
  ruleApplied: string;
  limitApplied: string;
  factsUsed: Array<{ label: string; value: string }>;
  systemConclusion: string;
  systemBasis: string;
  professionalConclusion: string;
  isOverridden: boolean;
  overrideReason: string;
  smcStatus: string;
  firstTimeAdoption: string;
  decidedBy: string;
  decidedAt: string;
  partnerApproval: string;
  pendingReason: string;
}

// ── Inputs ─────────────────────────────────────────────────────────────────

/** Capture the 02.2-specific facts (FRF-01..04, 06, group, SMC). */
export interface SetFinancialReportingFactsInput {
  isListedOnSmeExchange?: boolean;
  priorIndAs?: boolean;
  voluntaryIndAs?: boolean;
  groupTriggersIndAs?: boolean;
  priorFramework?: PriorFramework | null;
  priorFrameworkSource?: string | null;
  indAsAlreadyApplicable?: FrfAnswer | null;
  firstIndAsFy?: string | null;
  originalTrigger?: string | null;
  voluntaryAnswer?: FrfAnswer | null;
  voluntaryFirstIndAsFy?: string | null;
  groupAnswer?: FrfAnswer | null;
  groupNonSmc?: FrfAnswer | null;
  smcMaxBorrowings?: number | null;
  firstTimeAdoption?: boolean | null;
  firstTimeAdoptionReason?: string | null;
  version: number;
}

/**
 * FRF-05 — record the professional conclusion. `action` confirm takes the system
 * outcome; override needs `conclusion` + `basis`; information_pending needs
 * `pendingReason`. Omitting `action` keeps the older conclusion-only call.
 */
export interface RecordFinancialReportingDecisionInput {
  action?: FrfProfessionalAction;
  conclusion?: ReportingFrameworkOutcome;
  basis?: string | null;
  impact?: string | null;
  pendingReason?: string | null;
  version: number;
}

/** FRF-05 — Engagement Partner approval of a significant override / complex conclusion. */
export interface PartnerApproveFinancialReportingInput {
  note?: string | null;
  version: number;
}

/** Result of filling the 02.2 facts from the client master and earlier files. */
export interface StatutoryAuditFinancialReportingMasterFillResult {
  financialReporting: StatutoryAuditFinancialReporting;
  /** What was filled (empty when there was nothing new to add). */
  filled: string[];
}
