/**
 * 02.3 — Schedule III & Presentation Framework (Implementation Guide §9.3;
 * DHVAJ Section 02.3 Developer Specification).
 *
 * Decides the applicable Schedule III **Division** (I = Accounting Standards,
 * II = Ind AS non-NBFC, III = Ind AS NBFC) — or a **specialised statutory
 * format** for a bank / insurer / regulated entity — by routing from the 02.2
 * reporting-framework conclusion (never re-deciding it). It then loads, from the
 * versioned presentation framework for the audit period, the required FS
 * components, the cash-flow requirement/exemption (which **consumes** the 02.1
 * OPC / small-company / dormant classifications — never re-asked), the rounding
 * framework, the presentation-materiality threshold, the comparative-information
 * status and the disclosure library.
 *
 * NO statutory number, unit, requirement or template id lives in code (spec §8):
 * the Schedule III framework versions, disclosure requirements and specialised
 * format rules are library tables, the rounding band / units and presentation
 * materiality resolve from the Audit Rules Library, and every reference opens
 * through the central Provision Library. A concluded 02.3 freezes all of it, so
 * a later amendment never changes a historical engagement (spec §4, §21 test 11).
 */

import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';
import type {
  FrfCompletion,
  FrfPartnerApproval,
  ReportingFrameworkOutcome,
} from './statutory-audit-financial-reporting';

/** The Schedule III presentation framework the engine concludes (§9.3). */
export const SCHEDULE_III_OUTCOME = {
  /** Division I — Accounting Standards. */
  divisionI: 'division_i',
  /** Division II — Ind AS, non-NBFC. */
  divisionII: 'division_ii',
  /** Division III — Ind AS, NBFC. */
  divisionIII: 'division_iii',
  /** Bank / insurer / regulated — a specialised statutory format applies (no Division forced). */
  specialisedFormat: 'specialised_format',
  /** 02.2 is not concluded yet, or a deciding fact is absent — never a guess (guide §4.3). */
  informationInsufficient: 'information_insufficient',
  /** The system cannot safely decide; a professional must. */
  professionalReview: 'professional_review_required',
} as const;
export type ScheduleIiiOutcome =
  (typeof SCHEDULE_III_OUTCOME)[keyof typeof SCHEDULE_III_OUTCOME];
export const SCHEDULE_III_OUTCOMES: ScheduleIiiOutcome[] = Object.values(SCHEDULE_III_OUTCOME);

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const SCHEDULE_III_CONCLUSIONS: ScheduleIiiOutcome[] = [
  SCHEDULE_III_OUTCOME.divisionI,
  SCHEDULE_III_OUTCOME.divisionII,
  SCHEDULE_III_OUTCOME.divisionIII,
  SCHEDULE_III_OUTCOME.specialisedFormat,
];

export const SCHEDULE_III_OUTCOME_LABEL: Record<ScheduleIiiOutcome, string> = {
  division_i: 'Schedule III Division I',
  division_ii: 'Schedule III Division II',
  division_iii: 'Schedule III Division III',
  specialised_format: 'Specialised statutory format',
  information_insufficient: 'Further assessment required',
  professional_review_required: 'Professional review required',
};

/** A financial-statement component Schedule III requires. */
export const FS_COMPONENT = {
  balanceSheet: 'balance_sheet',
  statementOfProfitAndLoss: 'statement_of_profit_and_loss',
  cashFlowStatement: 'cash_flow_statement',
  statementOfChangesInEquity: 'statement_of_changes_in_equity',
  notes: 'notes_to_accounts',
} as const;
export type FsComponent = (typeof FS_COMPONENT)[keyof typeof FS_COMPONENT];
export const FS_COMPONENTS: FsComponent[] = Object.values(FS_COMPONENT);

// ── Checklist enums (SCH-01 .. SCH-06) ─────────────────────────────────────

/** SCH-01 — is Schedule III the applicable presentation framework? */
export const SCH01_RESULT = {
  yes: 'yes',
  specialised: 'specialised_format',
  furtherAssessment: 'further_assessment',
} as const;
export type Sch01Result = (typeof SCH01_RESULT)[keyof typeof SCH01_RESULT];
export const SCH01_RESULT_LABEL: Record<Sch01Result, string> = {
  yes: 'Yes — Schedule III applies',
  specialised_format: 'Specialised statutory format applies',
  further_assessment: 'Further assessment required',
};

/** SCH-02 / SCH-03 / SCH-04 tri-state answers. */
export const SCH_ANSWER = {
  yes: 'yes',
  no: 'no',
  furtherAssessment: 'further_assessment',
} as const;
export type SchAnswer = (typeof SCH_ANSWER)[keyof typeof SCH_ANSWER];
export const SCH_ANSWERS: SchAnswer[] = Object.values(SCH_ANSWER);
export const SCH_ANSWER_LABEL: Record<SchAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  further_assessment: 'Further assessment required',
};

/** SCH-02 — how the governing statute affects Schedule III. */
export const SPECIALISED_EFFECT = {
  replaces: 'replaces',
  modifies: 'modifies',
  supplements: 'supplements',
} as const;
export type SpecialisedEffect = (typeof SPECIALISED_EFFECT)[keyof typeof SPECIALISED_EFFECT];
export const SPECIALISED_EFFECTS: SpecialisedEffect[] = Object.values(SPECIALISED_EFFECT);
export const SPECIALISED_EFFECT_LABEL: Record<SpecialisedEffect, string> = {
  replaces: 'Replaces Schedule III',
  modifies: 'Modifies Schedule III',
  supplements: 'Supplements Schedule III',
};

/** SCH-03 — cash-flow statement. */
export const CASH_FLOW_STATUS = {
  required: 'required',
  exempt: 'exempt',
  furtherAssessment: 'further_assessment',
} as const;
export type CashFlowStatus = (typeof CASH_FLOW_STATUS)[keyof typeof CASH_FLOW_STATUS];
export const CASH_FLOW_STATUS_LABEL: Record<CashFlowStatus, string> = {
  required: 'Required',
  exempt: 'Exempt',
  further_assessment: 'Further assessment required',
};

/** SCH-04 — comparative information. */
export const COMPARATIVES_STATUS = {
  required: 'required',
  notApplicable: 'not_applicable',
  furtherAssessment: 'further_assessment',
} as const;
export type ComparativesStatus = (typeof COMPARATIVES_STATUS)[keyof typeof COMPARATIVES_STATUS];
export const COMPARATIVES_STATUSES: ComparativesStatus[] = Object.values(COMPARATIVES_STATUS);
export const COMPARATIVES_STATUS_LABEL: Record<ComparativesStatus, string> = {
  required: 'Required',
  not_applicable: 'Not applicable',
  further_assessment: 'Further assessment required',
};

/** SCH-06 — the manager's professional action. */
export const SCH_PROFESSIONAL_ACTION = {
  confirm: 'confirm',
  override: 'override',
  informationPending: 'information_pending',
} as const;
export type SchProfessionalAction =
  (typeof SCH_PROFESSIONAL_ACTION)[keyof typeof SCH_PROFESSIONAL_ACTION];
export const SCH_PROFESSIONAL_ACTIONS: SchProfessionalAction[] =
  Object.values(SCH_PROFESSIONAL_ACTION);

// ── Disclosure library (spec §11, §12) ──────────────────────────────────────

/** Disclosure-library categories (spec §11). Requirements themselves are library data. */
export const DISCLOSURE_CATEGORY = {
  balanceSheet: 'balance_sheet',
  profitAndLoss: 'profit_and_loss',
  additionalRegulatory: 'additional_regulatory_information',
  ratios: 'ratios',
  property: 'property_title_deeds',
  loans: 'loans_advances',
  borrowings: 'borrowings_charges',
  benami: 'benami_property',
  undisclosedIncome: 'undisclosed_income',
  crypto: 'crypto_virtual_currency',
  csr: 'csr',
  promoterShareholding: 'promoter_shareholding',
  struckOff: 'struck_off_companies',
  consolidated: 'consolidated',
  transition: 'transition',
  other: 'other',
} as const;
export type DisclosureCategory = (typeof DISCLOSURE_CATEGORY)[keyof typeof DISCLOSURE_CATEGORY];
export const DISCLOSURE_CATEGORIES: DisclosureCategory[] = Object.values(DISCLOSURE_CATEGORY);
export const DISCLOSURE_CATEGORY_LABEL: Record<DisclosureCategory, string> = {
  balance_sheet: 'Balance Sheet',
  profit_and_loss: 'Statement of Profit & Loss',
  additional_regulatory_information: 'Additional Regulatory Information',
  ratios: 'Ratios',
  property_title_deeds: 'Property / title deeds',
  loans_advances: 'Loans / advances',
  borrowings_charges: 'Borrowings / charges',
  benami_property: 'Benami property',
  undisclosed_income: 'Undisclosed income',
  crypto_virtual_currency: 'Crypto / virtual currency',
  csr: 'CSR',
  promoter_shareholding: 'Promoter shareholding',
  struck_off_companies: 'Struck-off companies',
  consolidated: 'Consolidated presentation',
  transition: 'First-time adoption / transition',
  other: 'Other',
};

/**
 * Facts a disclosure requirement can be triggered by (spec §12). A requirement
 * with no trigger is baseline-mandatory. A fact that is not yet known keeps the
 * requirement IN the library — a zero/unknown balance never suppresses it.
 */
export const DISCLOSURE_TRIGGER = {
  ppeExists: 'ppe_exists',
  immovablePropertyExists: 'immovable_property_exists',
  intangiblesExist: 'intangibles_exist',
  borrowingsExist: 'borrowings_exist',
  loansGiven: 'loans_given',
  investmentsExist: 'investments_exist',
  csrApplicable: 'csr_applicable',
  cfsRequired: 'cfs_required',
  firstTimeIndAs: 'first_time_ind_as',
} as const;
export type DisclosureTrigger = (typeof DISCLOSURE_TRIGGER)[keyof typeof DISCLOSURE_TRIGGER];
export const DISCLOSURE_TRIGGER_LABEL: Record<DisclosureTrigger, string> = {
  ppe_exists: 'Property, plant & equipment exists',
  immovable_property_exists: 'Immovable property exists',
  intangibles_exist: 'Intangible assets exist',
  borrowings_exist: 'Borrowings exist',
  loans_given: 'Loans / advances given',
  investments_exist: 'Investments exist',
  csr_applicable: 'CSR applicable (Section 02 / 02.7)',
  cfs_required: 'Consolidated FS required (02.6)',
  first_time_ind_as: 'First-time Ind AS adoption (02.2)',
};

/** Why a requirement is in (or out of) the loaded library. */
export type DisclosureApplicability =
  | 'baseline'
  | 'triggered'
  | 'included_pending_fact'
  | 'not_triggered';

/** One disclosure requirement of the applicable Schedule III version. */
export interface ScheduleIiiDisclosure {
  /** Stable requirement id, e.g. `SCH3_D2_ARI_TITLE_DEEDS`. */
  code: string;
  category: DisclosureCategory;
  label: string;
  description: string | null;
  trigger: DisclosureTrigger | null;
  applicability: DisclosureApplicability;
  /** Human reason, e.g. "Borrowings exist (02.1 borrowings ₹12.00 cr)". */
  reason: string;
  /** Provision Library code the requirement cites (opened via View Provision). */
  provisionCode: string | null;
  provisionId: string | null;
  /** Cross-linked sub-section, e.g. '02.7' for CSR, '02.6' for consolidation. */
  crossLink: string | null;
  effectiveFrom: string;
}

// ── Versioned framework (spec §8, §9) ───────────────────────────────────────

/** One component line of the versioned framework (spec §9). */
export interface ScheduleIiiComponentLine {
  /** `FsComponent` for routine statements; free key for other statements/schedules. */
  key: string;
  label: string;
  required: boolean;
  /** Why loaded / not loaded, e.g. "Exempt under the §2(40) proviso — small company". */
  basis: string;
  /** P&L includes the Other Comprehensive Income section (Ind AS). */
  includesOci?: boolean;
}

/** The Schedule III framework version applicable to the audit period (spec §8). */
export interface ScheduleIiiFrameworkVersion {
  id: string;
  /** e.g. `SCHEDULE_III_DIVISION_II`. */
  frameworkId: string;
  division: 'I' | 'II' | 'III';
  title: string;
  /** e.g. "As amended by G.S.R. 207(E), 24 March 2021". */
  versionLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  notificationReference: string | null;
  /** The Division's Schedule III provision (View Schedule III). */
  provisionCode: string | null;
  provisionId: string | null;
  /** The ICAI Guidance Note on this Division (View ICAI Guidance Note). */
  guidanceProvisionCode: string | null;
  guidanceProvisionId: string | null;
  guidanceVersion: string | null;
  /** Central FS-workbook template key mapped to this framework version (spec §16). */
  templateKey: string | null;
  status: 'active' | 'superseded';
}

/** A Rules Library rule the engine used (spec §3 "Rule Basis"). */
export interface ScheduleIiiRuleApplied {
  ruleCode: string;
  ruleVersionId: string;
  label: string;
  effectiveFrom: string;
  /** The condition that fired, e.g. "Turnover ₹80.00 cr < ₹100.00 cr". */
  condition: string;
  provisionId: string | null;
}

/** A fact 02.3 used, read-only, with its source (spec §2). */
export interface ScheduleIiiFactUsed {
  key: string;
  label: string;
  value: string;
  /** '02.1' | '02.2' | '02.6' | 'Section 02' | 'Engagement'. */
  source: string;
  /** DOM anchor of the source field when on the same page (Open Source Assessment). */
  anchor: string | null;
}

/** A fact that blocks the assessment (SCH-06 Information Pending). */
export interface ScheduleIiiMissingFact {
  key: string;
  label: string;
  source: string;
  anchor: string | null;
}

/** SCH-02 — specialised-format rule from the central library (spec §7). */
export interface ScheduleIiiSpecialisedRule {
  code: string;
  /** The 02.1 special-entity slug it matches, e.g. 'bank', 'insurance'. */
  entityCategory: string;
  governingAuthority: string;
  frameworkName: string;
  effect: SpecialisedEffect;
  provisionCode: string | null;
  provisionId: string | null;
  effectiveFrom: string;
}

/** SCH-01 / SCH-02 — specialised-format assessment (system + captured). */
export interface ScheduleIiiSpecialisedFormat {
  /** SCH-01 system result. */
  sch01: Sch01Result;
  /** SCH-02 system suggestion. */
  systemSuggested: SchAnswer;
  /** Library rules matched by the 02.1 classification. */
  matchedRules: ScheduleIiiSpecialisedRule[];
  /** SCH-02 answer recorded by the team (null until answered). */
  answer: SchAnswer | null;
  governingAuthority: string | null;
  frameworkName: string | null;
  effect: SpecialisedEffect | null;
  effectiveVersion: string | null;
  provisionId: string | null;
  reference: string | null;
  /** All required SCH-02 fields captured — or SCH-02 = No. Blocks completion otherwise. */
  resolved: boolean;
}

/** SCH-03 — cash-flow statement applicability (spec §10). */
export interface ScheduleIiiCashFlow {
  status: CashFlowStatus;
  /** Exact exemption basis, or why required. */
  basis: string;
  /** The 02.1 classifications consumed (never re-asked). */
  classifications: string[];
  provisionCode: string | null;
  provisionId: string | null;
}

/** SCH-04 — comparative information (spec §13). */
export interface ScheduleIiiComparatives {
  system: ComparativesStatus;
  /** confirmed ?? system. */
  status: ComparativesStatus;
  confirmed: ComparativesStatus | null;
  reason: string | null;
  /** First financial year of the entity (from incorporation date) → no prior-year file forced. */
  firstFinancialYear: boolean;
  incorporationDate: string | null;
  /** Prior period label, e.g. '2024-25'. */
  priorPeriod: string | null;
  /** The prior-year engagement on the portal, when one exists. */
  priorEngagementId: string | null;
  /** Prior-year FS files filed under question `sch_04` (SharePoint-backed). */
  priorYearFileCount: number;
  basis: string;
}

/** SCH-05 — rounding framework (spec §14). */
export interface ScheduleIiiRounding {
  /** The measure the rule tests, e.g. 'Turnover (02.1)'. */
  sourceLabel: string;
  sourceAmount: number | null;
  ruleCode: string | null;
  ruleVersionId: string | null;
  effectiveFrom: string | null;
  threshold: number | null;
  /** 'below' / 'at_or_above' the band, null when not determinable. */
  band: 'below' | 'at_or_above' | null;
  /** Units the applicable version permits — from rule data, never code. */
  permittedUnits: string[];
  /** The system's suggested unit (first permitted). */
  systemUnit: string | null;
  /** The unit the manager confirmed / overrode to (null until set). */
  selectedUnit: string | null;
  overridden: boolean;
  reason: string | null;
  provisionId: string | null;
  basis: string;
}

/** Presentation materiality / disclosure threshold (spec §15) — NOT SA 320 materiality. */
export interface ScheduleIiiPresentationMateriality {
  label: string;
  ruleCode: string | null;
  ruleVersionId: string | null;
  /** e.g. 1 (% of revenue from operations). */
  percentOfRevenue: number | null;
  /** The absolute floor (rupees) — "whichever is higher". */
  floor: number | null;
  measureLabel: string;
  measureAmount: number | null;
  /** The computed threshold in rupees, null when not determinable. */
  amount: number | null;
  basis: string;
  provisionId: string | null;
  /** Cross-reference: audit materiality (SA 320) is determined in Section 03. */
  auditMaterialityNote: string;
}

/** A 02.3 output and its consumer (spec §19). */
export interface ScheduleIiiDownstreamOutput {
  key: string;
  label: string;
  value: string;
  usedBy: string;
}

/**
 * The normalised facts the 02.3 engine reads. Every one is assembled server-side
 * from the confirmed 02.1 profile, the 02.2 conclusion and the other Section 02
 * assessments — 02.3 captures nothing of its own beyond its checklist answers.
 */
export interface ScheduleIiiFacts {
  /** The 02.2 reporting-framework conclusion that routes the Division (null ⇒ 02.2 not concluded). */
  reportingFramework: ReportingFrameworkOutcome | null;
  /** NBFC/HFC (02.1) — routes Ind AS to Division III. */
  isNbfc: boolean;
  /** Bank / insurer (02.1) — a specialised statutory format applies. */
  isBankOrInsurance: boolean;
  /** One Person Company (02.1 entity type) — cash-flow exemption input (§2(40) proviso). */
  isOpc: boolean;
  /** Small company per the confirmed 02.1 §2(85) assessment — cash-flow exemption input. */
  isSmallCompany: boolean;
  /** Dormant company (02.1 special entity) — cash-flow exemption input. */
  isDormant: boolean;
  /** First-time Ind AS (02.2 detail) — triggers the Ind AS 101 reconciliation disclosure. */
  firstTimeIndAs: boolean;
  /** Turnover (02.1) — selects the Schedule III rounding band. */
  turnover: number | null;
  /** All 02.1 special-entity slugs (matched against the specialised-format rules). */
  specialEntityTypes?: string[];
  /** Borrowings (02.1), rupees. */
  borrowings?: number | null;
  /** Disclosure-trigger facts; null = not yet known (never suppresses). */
  triggers?: Partial<Record<DisclosureTrigger, boolean | null>>;
  /** Entity incorporation date (comparatives: first financial year). */
  incorporationDate?: string | null;
  /** Audit financial year, 'YYYY-YY'. */
  financialYear?: string | null;
  /** 02.1 profile confirmed. */
  profileConfirmed?: boolean;
}

/** Structured engine extras stored in `systemDetail` (frozen on conclusion). */
export interface ScheduleIiiDetail {
  /** The concluded Division, or null for a specialised/insufficient outcome. */
  division: ScheduleIiiOutcome | null;
  /** The Schedule III provision code the Division cites (`SCH_III_DIV_*`), or null. */
  divisionProvisionCode: string | null;
  /** Whether a Cash Flow Statement is required, after the §2(40) exemption test. */
  cashFlowRequired: boolean;
  /** Why the cash-flow statement is exempt (OPC / small / dormant), or null when required. */
  cashFlowExemptionReason: string | null;
  /** The §2(40) proviso provision id, frozen by the service when the exemption applies. */
  cashFlowProvisionId: string | null;
  /** The FS components the framework requires. */
  requiredComponents: FsComponent[];
  /** The Schedule III rounding turnover band threshold (rupees), resolved from the library. */
  roundingThreshold: number | null;
  /** The presentation rounding units permitted for the entity's turnover band. */
  roundingUnits: string[];
  /** Labels of the loaded disclosure library (applicable requirements only). */
  disclosures: string[];

  // ── Spec 02.3 additions (all optional so older frozen rows still read) ──
  /** SCH-01 result. */
  sch01?: Sch01Result;
  /** The framework version resolved for the audit period (spec §8). */
  frameworkVersion?: ScheduleIiiFrameworkVersion | null;
  /** Component lines from the versioned framework (spec §9). */
  componentLines?: ScheduleIiiComponentLine[];
  cashFlow?: ScheduleIiiCashFlow;
  rounding?: ScheduleIiiRounding;
  presentationMateriality?: ScheduleIiiPresentationMateriality;
  /** Full disclosure library of the version, with applicability (spec §11, §12). */
  disclosureLibrary?: ScheduleIiiDisclosure[];
  specialised?: ScheduleIiiSpecialisedFormat;
  comparatives?: ScheduleIiiComparatives;
  rulesApplied?: ScheduleIiiRuleApplied[];
  factsUsed?: ScheduleIiiFactUsed[];
  missingFacts?: ScheduleIiiMissingFact[];
  downstream?: ScheduleIiiDownstreamOutput[];
  /** Consolidated-FS presentation flag passed to 02.6 (spec §19). */
  cfsPresentationRequired?: boolean;
  /** An unresolved specialised format / further assessment blocks completion. */
  blockingReview?: boolean;
}

/** The result of the pure 02.3 engine (guide §7 signature). */
export interface ScheduleIiiResult {
  outcome: ScheduleIiiOutcome;
  state: FrameworkState;
  basis: string;
  /** The Schedule III rounding rule version frozen onto the conclusion, when resolved. */
  ruleVersionId: string | null;
  /** The Division's Schedule III provision (period-correct), frozen by the service. */
  authorityProvisionId: string | null;
  detail: ScheduleIiiDetail;
}

/** The 02.3 checklist answers the team records (stored in the sub-assessment `facts`). */
export interface ScheduleIiiCapturedFacts {
  specialisedAnswer?: SchAnswer | null;
  governingAuthority?: string | null;
  frameworkName?: string | null;
  specialisedEffect?: SpecialisedEffect | null;
  specialisedVersion?: string | null;
  specialisedProvisionId?: string | null;
  specialisedReference?: string | null;
  comparativesStatus?: ComparativesStatus | null;
  comparativesReason?: string | null;
  roundingUnit?: string | null;
  roundingReason?: string | null;
  /** SCH-06 override: the technical basis (separate from the reason). */
  technicalBasis?: string | null;
}

/**
 * The 02.3 read shape for one statutory-audit workflow instance: the shared
 * sub-assessment plus the typed 02.3 detail and the base facts the engine used.
 */
export interface StatutoryAuditScheduleIii {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  /** Typed view of the engine's structured detail (Division / components / rounding). */
  detail: ScheduleIiiDetail | null;
  /** The base facts assembled from confirmed 02.1 + concluded 02.2 (read-only display). */
  baseFacts: ScheduleIiiFacts;
  /** True once 02.1 is confirmed AND 02.2 concluded — 02.3 routes from their frozen outputs. */
  upstreamReady: boolean;

  // ── Spec 02.3 additions ──
  auditFinancialYear?: string;
  capturedFacts?: ScheduleIiiCapturedFacts;
  /** SCH-06 action last recorded, and the reason when Information Pending. */
  professionalAction?: SchProfessionalAction | null;
  pendingReason?: string | null;
  partnerApproval?: FrfPartnerApproval;
  /** Spec §20 completion rules; complete ⇒ 02.3 COMPLETE. */
  completion?: FrfCompletion;
  /** Show Create Technical Memo / Add File / Link Existing File (complex or overridden). */
  memoSuggested?: boolean;
  /** Offer Create Financial Statements Workbook (02.2 + 02.3 established, spec §16). */
  workbookAvailable?: boolean;
  /** Section 02 approved (AF-02) — 02.3 is frozen. */
  approved?: boolean;
  /** The viewer is the engagement partner (may give SCH-06 partner approval). */
  viewerIsPartner?: boolean;
}

/**
 * The approved/current 02.3 result handed to downstream work (FS workbook,
 * 02.6, Audit Areas, completion). Read through `AuditScheduleIiiService.readResultOn`.
 */
export interface ScheduleIiiApprovedResult {
  workflowInstanceId: string;
  /** Professional conclusion when decided, else the system outcome. */
  outcome: ScheduleIiiOutcome | null;
  /** True when a professional conclusion is recorded. */
  decided: boolean;
  /** Spec §20 completion met. */
  complete: boolean;
  /** Section 02 approved (AF-02). */
  approved: boolean;
  reportingFramework: ReportingFrameworkOutcome | null;
  frameworkVersion: ScheduleIiiFrameworkVersion | null;
  componentLines: ScheduleIiiComponentLine[];
  cashFlowRequired: boolean;
  roundingUnit: string | null;
  disclosureCodes: string[];
  cfsPresentationRequired: boolean;
  /** 02.1 entity type slug (template selection, spec §16). */
  entityTypeSlug: string | null;
  financialYear: string | null;
}

// ── Inputs ─────────────────────────────────────────────────────────────────

/** Record the SCH-02 / SCH-04 / SCH-05 answers (partial update). */
export interface SetScheduleIiiFactsInput {
  specialisedAnswer?: SchAnswer | null;
  governingAuthority?: string | null;
  frameworkName?: string | null;
  specialisedEffect?: SpecialisedEffect | null;
  specialisedVersion?: string | null;
  specialisedProvisionId?: string | null;
  specialisedReference?: string | null;
  comparativesStatus?: ComparativesStatus | null;
  comparativesReason?: string | null;
  /** SCH-05: a unit from the permitted units; a unit other than the system's needs a reason. */
  roundingUnit?: string | null;
  roundingReason?: string | null;
  version: number;
}

/**
 * SCH-06 — record the professional conclusion. `confirm` takes the system
 * outcome; `override` needs `conclusion` + `basis` (reason) + `technicalBasis`
 * and always needs Engagement Partner approval; `information_pending` needs
 * `pendingReason`. Omitting `action` keeps the older conclusion-only call.
 */
export interface RecordScheduleIiiDecisionInput {
  action?: SchProfessionalAction;
  conclusion?: ScheduleIiiOutcome;
  basis?: string | null;
  technicalBasis?: string | null;
  impact?: string | null;
  pendingReason?: string | null;
  version: number;
}

/** SCH-06 — Engagement Partner approval of a significant override / specialised format. */
export interface PartnerApproveScheduleIiiInput {
  note?: string | null;
  version: number;
}

/** Context key of the 02.3 authority links in the reference-link table (spec §4, §22). */
export const SCH_REFERENCE_CONTEXT = '02.3';

/**
 * The 02.3 "View …" anchors (spec §22). Seeded into
 * `hsdg.authority_reference_link` with context '02.3'; resolved period-correct
 * through the Provision Library — no URL in a component.
 */
export const SCH_REFERENCE_ANCHOR = {
  section129: 'section_129',
  divisionI: 'schedule_iii_div_i',
  divisionII: 'schedule_iii_div_ii',
  divisionIII: 'schedule_iii_div_iii',
  guidanceDivisionI: 'icai_gn_div_i',
  guidanceDivisionII: 'icai_gn_div_ii',
  guidanceDivisionIII: 'icai_gn_div_iii',
  cashFlowExemption: 'section_2_40',
  rounding: 'rounding',
} as const;
export type SchReferenceAnchor = (typeof SCH_REFERENCE_ANCHOR)[keyof typeof SCH_REFERENCE_ANCHOR];

/**
 * Provision Library codes 02.3 cites. The Division / §2(40) codes already
 * exist; the ICAI Guidance Notes, Section 129 and the rounding requirement are
 * seeded by the 02.3 references migration.
 */
export const SCH_PROVISION_CODE = {
  section129: 'COS_ACT_129',
  divisionI: 'SCH_III_DIV_I',
  divisionII: 'SCH_III_DIV_II',
  divisionIII: 'SCH_III_DIV_III',
  guidanceDivisionI: 'ICAI_GN_SCH_III_DIV_I',
  guidanceDivisionII: 'ICAI_GN_SCH_III_DIV_II',
  guidanceDivisionIII: 'ICAI_GN_SCH_III_DIV_III',
  cashFlowExemption: 'COS_ACT_2_40',
  rounding: 'SCH_III_ROUNDING_REQ',
} as const;
