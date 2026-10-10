/**
 * 02.7 — Other Companies Act & Statutory Reporting Requirements
 * (DHVAJ 02.7 spec v1.0; build split docs/02-7-other-reporting-build-split.md).
 *
 * A statutory reporting CONFIGURATOR, not a second audit (spec §22). It makes
 * every applicable reporting obligation visible as a requirement card, shows
 * the current numerical rule from the Rules Library, reuses evidence from the
 * underlying work and keeps separate conclusions for CARO, ICFR, Rule 11,
 * remuneration, fraud and branch reporting:
 *   • Section 143(3) core reporting matrix (spec §4).
 *   • Rule 11 matters instantiated separately by the version in force (§5–§11).
 *   • Rule 11(g) audit trail — a system-by-system register (§11).
 *   • Section 197(16) managerial remuneration — public companies, Section 198
 *     net profit, category limits and the versioned Schedule V bands (§13).
 *   • Section 143(12) fraud framework — central Fraud Matter records (§14, Track B).
 *   • Section 164(2) director workpaper (§12, Track B) and branch / CARO / ICFR /
 *     group cross-references without duplicate registers (§15, Track B).
 *
 * NO statutory number/date lives in code: every %, ₹ threshold, day count,
 * retention period and effective date resolves from the Audit Rules Library by
 * the audit period, and Schedule V bands from their versioned child table.
 *
 * Track A owns this file; Track B's own types live in
 * statutory-audit-reporting-records.ts and import these (never re-export them).
 */

import type { MasterFact } from './statutory-audit';
import type { FrameworkState } from './statutory-audit-framework';
import type { FrameworkSubAssessment } from './statutory-audit-subassessment';

// ── Top-level status and professional conclusion (spec §3, §20) ─────────────

/** The 02.7 framework status (spec §3: Complete / Attention Required / Pending Facts). */
export const OTHER_REPORTING_OUTCOME = {
  /** Every applicable obligation is identified and its work configured. */
  configured: 'configured',
  /** An obligation is identified with an exception the team must act on. */
  attentionRequired: 'attention_required',
  /** A blocking fact is missing — never a guess. */
  informationInsufficient: 'information_insufficient',
} as const;
export type OtherReportingOutcome =
  (typeof OTHER_REPORTING_OUTCOME)[keyof typeof OTHER_REPORTING_OUTCOME];
export const OTHER_REPORTING_OUTCOMES: OtherReportingOutcome[] =
  Object.values(OTHER_REPORTING_OUTCOME);
export const OTHER_REPORTING_OUTCOME_LABEL: Record<OtherReportingOutcome, string> = {
  configured: 'Framework configured',
  attention_required: 'Attention required',
  information_insufficient: 'Pending facts',
};

/** Outcomes a professional may record as the conclusion (decisive ones only). */
export const OTHER_REPORTING_CONCLUSIONS: OtherReportingOutcome[] = [
  OTHER_REPORTING_OUTCOME.configured,
  OTHER_REPORTING_OUTCOME.attentionRequired,
];

/** Professional conclusion action (spec §3: Confirm Framework / Override / Information Pending). */
export const OTHER_REPORTING_ACTION = {
  confirm: 'confirm',
  override: 'override',
  informationPending: 'information_pending',
} as const;
export type OtherReportingAction =
  (typeof OTHER_REPORTING_ACTION)[keyof typeof OTHER_REPORTING_ACTION];
export const OTHER_REPORTING_ACTIONS: OtherReportingAction[] =
  Object.values(OTHER_REPORTING_ACTION);

/** A three-way fact answer (Yes / No / Pending). */
export const TRI = { yes: 'yes', no: 'no', pending: 'pending' } as const;
export type Tri = (typeof TRI)[keyof typeof TRI];
export const TRIS: Tri[] = Object.values(TRI);
export const TRI_LABEL: Record<Tri, string> = { yes: 'Yes', no: 'No', pending: 'Pending' };

// ── Requirement cards (spec §4, §5, §16, §17) ───────────────────────────────

/** Every reporting requirement 02.7 configures — one card each. */
export const REPORTING_CARD = {
  // Section 143(3) core (spec §4)
  s143Information: 's143_3_a_information',
  s143Books: 's143_3_b_books',
  s143BranchReturns: 's143_3_b_branch_returns',
  s143BranchReport: 's143_3_c_branch_report',
  s143Agreement: 's143_3_d_agreement',
  s143Standards: 's143_3_e_standards',
  s143Adverse: 's143_3_f_adverse_comments',
  s143Directors: 's143_3_g_director_disqualification',
  s143AccountsQualification: 's143_3_h_accounts_qualification',
  s143Icfr: 's143_3_i_icfr',
  s143Other: 's143_3_j_other_prescribed',
  // Rule 11 (spec §5–§11)
  r11Litigation: 'rule_11_a_litigation',
  r11Losses: 'rule_11_b_foreseeable_losses',
  r11Iepf: 'rule_11_c_iepf',
  r11eAdvanced: 'rule_11_e_funds_advanced',
  r11eReceived: 'rule_11_e_funds_received',
  r11fDividend: 'rule_11_f_dividend',
  r11gAuditTrail: 'rule_11_g_audit_trail',
  // Other Companies Act reporting (spec §13–§15, §17)
  s197Remuneration: 's197_16_remuneration',
  s143_12Fraud: 's143_12_fraud',
  branchReporting: 'branch_reporting',
  caro: 'caro_2020',
} as const;
export type ReportingCardKey = (typeof REPORTING_CARD)[keyof typeof REPORTING_CARD];
export const REPORTING_CARD_KEYS: ReportingCardKey[] = Object.values(REPORTING_CARD);

export const REPORTING_CARD_GROUP = {
  section143: 'section_143_3',
  rule11: 'rule_11',
  remuneration: 'remuneration',
  fraud: 'fraud',
  crossReference: 'cross_reference',
} as const;
export type ReportingCardGroup = (typeof REPORTING_CARD_GROUP)[keyof typeof REPORTING_CARD_GROUP];
export const REPORTING_CARD_GROUP_LABEL: Record<ReportingCardGroup, string> = {
  section_143_3: 'Section 143(3) core',
  rule_11: 'Rule 11',
  remuneration: 'Managerial remuneration',
  fraud: 'Fraud framework',
  cross_reference: 'Cross-references',
};

export const REPORTING_APPLICABILITY = {
  applicable: 'applicable',
  conditional: 'conditional',
  notApplicable: 'not_applicable',
  notApplicableToFacts: 'not_applicable_to_facts',
  crossReference: 'cross_reference',
  pending: 'pending',
} as const;
export type ReportingApplicability =
  (typeof REPORTING_APPLICABILITY)[keyof typeof REPORTING_APPLICABILITY];
export const REPORTING_APPLICABILITIES: ReportingApplicability[] =
  Object.values(REPORTING_APPLICABILITY);
export const REPORTING_APPLICABILITY_LABEL: Record<ReportingApplicability, string> = {
  applicable: 'Applicable',
  conditional: 'Conditional',
  not_applicable: 'Not applicable',
  not_applicable_to_facts: 'Not applicable to facts',
  cross_reference: 'Cross-reference',
  pending: 'Pending facts',
};

/** A card's work status (spec §16). 02.7 can be COMPLETE while cards are Work Pending (§20). */
export const REPORTING_WORK_STATUS = {
  notStarted: 'not_started',
  workPending: 'work_pending',
  inProgress: 'in_progress',
  complete: 'complete',
  notRequired: 'not_required',
} as const;
export type ReportingWorkStatus =
  (typeof REPORTING_WORK_STATUS)[keyof typeof REPORTING_WORK_STATUS];
export const REPORTING_WORK_STATUSES: ReportingWorkStatus[] = Object.values(REPORTING_WORK_STATUS);
export const REPORTING_WORK_STATUS_LABEL: Record<ReportingWorkStatus, string> = {
  not_started: 'Not started',
  work_pending: 'Work pending',
  in_progress: 'In progress',
  complete: 'Complete',
  not_required: 'Not required',
};

/** The expected reporting wording (spec §16 "Reporting status"). */
export const REPORTING_STATUS = {
  notDetermined: 'not_determined',
  unmodifiedExpected: 'unmodified_expected',
  modifiedExpected: 'modified_wording_expected',
  notApplicable: 'not_applicable',
  crossReference: 'cross_reference',
} as const;
export type ReportingStatus = (typeof REPORTING_STATUS)[keyof typeof REPORTING_STATUS];
export const REPORTING_STATUSES: ReportingStatus[] = Object.values(REPORTING_STATUS);
export const REPORTING_STATUS_LABEL: Record<ReportingStatus, string> = {
  not_determined: 'Not determined',
  unmodified_expected: 'Unmodified wording expected',
  modified_wording_expected: 'Modified wording expected',
  not_applicable: 'Not applicable',
  cross_reference: 'Reported via cross-reference',
};

/** §17 "work configured" column. */
export const REPORTING_WORK_CONFIGURED = {
  yes: 'yes',
  conditional: 'conditional',
  crossReference: 'cross_reference',
  alwaysAvailable: 'framework_always_available',
  no: 'no',
} as const;
export type ReportingWorkConfigured =
  (typeof REPORTING_WORK_CONFIGURED)[keyof typeof REPORTING_WORK_CONFIGURED];
export const REPORTING_WORK_CONFIGURED_LABEL: Record<ReportingWorkConfigured, string> = {
  yes: 'Yes',
  conditional: 'Conditional',
  cross_reference: 'Cross-reference',
  framework_always_available: 'Framework always available',
  no: 'No',
};

/** The team's per-card work state (stored per card; editable after 02.7 is approved). */
export interface ReportingCardState {
  workStatus: ReportingWorkStatus;
  /** A team override of the system reporting status (null = system). */
  reportingStatus: ReportingStatus | null;
  proposedConclusion: string | null;
  exceptions: number;
  exceptionNote: string | null;
  sourceWorkpaper: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  version: number;
}

/** One requirement card (spec §16) — system applicability + the team's work state. */
export interface ReportingCard {
  key: ReportingCardKey;
  group: ReportingCardGroup;
  requirement: string;
  /** Statutory reference shown on the card, e.g. "Section 143(3)(b)". */
  clause: string;
  applicability: ReportingApplicability;
  applicabilityBasis: string;
  /** Where the applicability comes from (spec §17 column 2). */
  applicabilitySource: string;
  /** Primary evidence / work source (spec §4 column 3). */
  workSource: string;
  workConfigured: ReportingWorkConfigured;
  /** Final conclusion stage (spec §17 column 4). */
  finalStage: string;
  /** System exceptions detected from the facts (team exceptions are in `state`). */
  systemExceptions: string[];
  /** System-suggested reporting status from the facts. */
  systemReportingStatus: ReportingStatus;
  /** Evidence items linked to this card (Track B evidence links). */
  evidenceCount: number;
  /** `authority_reference_link` anchors under context '02.7' (View Provision / Guidance). */
  anchors: string[];
  state: ReportingCardState;
}

/** Set a card's work state (spec §16). */
export interface UpdateReportingCardInput {
  workStatus?: ReportingWorkStatus;
  reportingStatus?: ReportingStatus | null;
  proposedConclusion?: string | null;
  exceptions?: number;
  exceptionNote?: string | null;
  sourceWorkpaper?: string | null;
  /** true marks the card reviewed by the caller; false clears the review. */
  reviewed?: boolean;
  version: number;
}

/** A team applicability override of one card (significant ones route to the EP). */
export interface ReportingApplicabilityOverride {
  applicability: ReportingApplicability;
  reason: string;
}

// ── Rule 11 matters (spec §6–§10) ───────────────────────────────────────────

/** R11-01 pending litigations — consumed from the legal / litigation work (spec §6). */
export interface LitigationFacts {
  /** Have pending litigations been identified requiring Rule 11 consideration? */
  identified: Tri;
  totalMatters: number | null;
  materialMatters: number | null;
  disclosure: 'disclosed' | 'partially_disclosed' | 'not_disclosed' | 'pending';
  exceptions: number | null;
  sourceWorkpaper: string | null;
}

/** R11-02 long-term contracts incl. derivatives — material foreseeable losses (spec §7). */
export interface ForeseeableLossFacts {
  hasLongTermContracts: Tri;
  hasDerivativeContracts: Tri;
  /** Provision for material foreseeable losses made as required. */
  provisionAdequate: Tri;
  linkedWorkpapers: string[];
}

export const IEPF_STATUS = {
  noDelay: 'no_delay',
  delay: 'delay',
  notApplicable: 'not_applicable',
  pending: 'pending',
} as const;
export type IepfStatus = (typeof IEPF_STATUS)[keyof typeof IEPF_STATUS];
export const IEPF_STATUS_LABEL: Record<IepfStatus, string> = {
  no_delay: 'No delay identified',
  delay: 'Delay identified',
  not_applicable: 'Not applicable',
  pending: 'Pending',
};

/** R11-03 IEPF transfers (spec §8). */
export interface IepfFacts {
  status: IepfStatus;
  delayAmount: number | null;
  delayPeriod: string | null;
  sourceWorkpaper: string | null;
}

export const RULE11E_CONCLUSION = {
  noException: 'no_exception',
  exception: 'exception',
  pending: 'pending',
} as const;
export type Rule11eConclusion = (typeof RULE11E_CONCLUSION)[keyof typeof RULE11E_CONCLUSION];
export const RULE11E_CONCLUSION_LABEL: Record<Rule11eConclusion, string> = {
  no_exception: 'Nothing contrary noticed',
  exception: 'Contrary matter — modified reporting',
  pending: 'Pending',
};

/**
 * One Rule 11(e) mirrored assessment (spec §9) — (i) funds advanced / loaned /
 * invested by the company, (ii) funds received by the company. Linked to the
 * Section 07 Management Representation Letter. No monetary exemption exists.
 */
export interface Rule11eAssessment {
  representationObtained: Tri;
  transactionsIdentified: Tri;
  /** (i) intermediaries / (ii) funding parties. */
  parties: string | null;
  /** (i) ultimate beneficiaries / (ii) onward funding, guarantee or security understanding. */
  beneficiaries: string | null;
  auditProcedures: string | null;
  contraryMatter: Tri;
  contraryNote: string | null;
  conclusion: Rule11eConclusion;
}

/** R11-04 dividend — Section 123 compliance (spec §10). */
export interface DividendFacts {
  /** Dividend declared or paid during the year (null = not answered). */
  declaredOrPaid: boolean | null;
  kind: 'interim' | 'final' | 'both' | null;
  section123Compliant: Tri;
  note: string | null;
  sourceWorkpaper: string | null;
}

// ── Rule 11(g) audit-trail register (spec §11) ──────────────────────────────

export const SOFTWARE_MODULE = {
  gl: 'gl',
  billing: 'billing',
  inventory: 'inventory',
  payroll: 'payroll',
  other: 'other',
} as const;
export type SoftwareModule = (typeof SOFTWARE_MODULE)[keyof typeof SOFTWARE_MODULE];
export const SOFTWARE_MODULES: SoftwareModule[] = Object.values(SOFTWARE_MODULE);
export const SOFTWARE_MODULE_LABEL: Record<SoftwareModule, string> = {
  gl: 'General ledger',
  billing: 'Billing',
  inventory: 'Inventory',
  payroll: 'Payroll',
  other: 'Other',
};

export const AUDIT_TRAIL_CONCLUSION = {
  compliant: 'compliant',
  modifiedExpected: 'modified_reporting_expected',
  furtherWork: 'further_work',
  pending: 'pending',
} as const;
export type AuditTrailConclusion =
  (typeof AUDIT_TRAIL_CONCLUSION)[keyof typeof AUDIT_TRAIL_CONCLUSION];
export const AUDIT_TRAIL_CONCLUSION_LABEL: Record<AuditTrailConclusion, string> = {
  compliant: 'Compliant',
  modified_reporting_expected: 'Modified reporting expected',
  further_work: 'Further work',
  pending: 'Pending',
};

/**
 * One accounting software / module assessed for the Rule 11(g) audit trail.
 * `hasAuditTrailFeature` / `auditTrailOperatedAllYear` are the original two
 * booleans (kept: prior-year files and the master fill carry them); the spec §11
 * register fields are optional so older rows still read.
 */
export interface SoftwareSystemInput {
  id?: string;
  name: string;
  hasAuditTrailFeature: boolean;
  auditTrailOperatedAllYear: boolean;
  module?: SoftwareModule;
  moduleOther?: string | null;
  booksAffected?: string | null;
  featureStatus?: 'available' | 'not_available' | 'pending';
  enabledThroughout?: 'yes' | 'no' | 'exceptions' | 'pending';
  enabledNote?: string | null;
  transactionsCovered?: 'complete' | 'gaps' | 'pending';
  privilegedUsers?: string | null;
  canAlterOrDisable?: Tri;
  tampering?: Tri;
  preservation?: 'compliant' | 'exception' | 'pending';
  evidence?: string | null;
  conclusion?: AuditTrailConclusion;
  /** Cross-reference to an ICFR / ITGC deficiency (never copies its conclusion, spec §11). */
  icfrCrossRef?: string | null;
  /** The failure also bears on proper-books reporting (Section 143(3)(b)/(h)). */
  booksCrossRef?: boolean;
}

/** Rule 11(g) per-system result. */
export interface AuditTrailSystemResult {
  id: string;
  name: string;
  module: SoftwareModule | null;
  /** System-suggested conclusion from the register facts. */
  suggestedConclusion: AuditTrailConclusion;
  conclusion: AuditTrailConclusion;
  exceptions: string[];
  pendingFields: string[];
  /** Legacy summary: feature present and operated throughout. */
  adequate: boolean;
  basis: string;
}

export interface Rule11gResult {
  applicable: boolean;
  /** The Rule 11(g) version in force for the audit period (null = before it applied). */
  effectiveFrom: string | null;
  systems: AuditTrailSystemResult[];
  retentionYears: number | null;
  allAdequate: boolean;
  basis: string;
}

// ── Section 197(16) managerial remuneration (spec §13) ──────────────────────

export const MANAGERIAL_CATEGORY = {
  managingDirector: 'managing_director',
  wholeTimeDirector: 'whole_time_director',
  manager: 'manager',
  nonExecutiveDirector: 'non_executive_director',
} as const;
export type ManagerialCategory = (typeof MANAGERIAL_CATEGORY)[keyof typeof MANAGERIAL_CATEGORY];
export const MANAGERIAL_CATEGORIES: ManagerialCategory[] = Object.values(MANAGERIAL_CATEGORY);
export const MANAGERIAL_CATEGORY_LABEL: Record<ManagerialCategory, string> = {
  managing_director: 'Managing Director',
  whole_time_director: 'Whole-time Director',
  manager: 'Manager',
  non_executive_director: 'Director (neither MD nor WTD)',
};

/** One managerial person on the remuneration workpaper. */
export interface ManagerialPersonInput {
  id?: string;
  name: string;
  din?: string | null;
  category: ManagerialCategory;
  remuneration: number | null;
}

/** Shareholder approvals relevant to the ordinary-route limits. */
export interface RemunerationApprovals {
  /** Special resolution approving overall remuneration beyond the overall limit. */
  overallSpecialResolution: boolean;
  /** Special resolution approving MD/WTD/Manager remuneration beyond the sub-limit. */
  executiveSpecialResolution: boolean;
  /** Special resolution approving non-executive remuneration beyond the sub-limit. */
  nonExecutiveSpecialResolution: boolean;
  /** Schedule V route: the resolution passed is a special resolution (ceilings doubled where the version allows). */
  scheduleVSpecialResolution: boolean;
  note: string | null;
}

export const REMUNERATION_OUTCOME = {
  notApplicable: 'not_applicable',
  withinLimit: 'within_limit',
  exceedsLimit: 'exceeds_limit',
  scheduleVRoute: 'schedule_v_route',
  informationInsufficient: 'information_insufficient',
} as const;
export type RemunerationOutcome = (typeof REMUNERATION_OUTCOME)[keyof typeof REMUNERATION_OUTCOME];
export const REMUNERATION_OUTCOME_LABEL: Record<RemunerationOutcome, string> = {
  not_applicable: 'Not applicable (not a public company)',
  within_limit: 'Within the Section 197 limits',
  exceeds_limit: 'Exceeds a limit without the approval route',
  schedule_v_route: 'Schedule V route (no / inadequate profits)',
  information_insufficient: 'Pending facts',
};

/** One Section 197 category test (only the legally relevant ones are applicable). */
export interface RemunerationCategoryTest {
  key: 'overall' | 'one_executive' | 'multiple_executives' | 'non_exec_with_mgmt' | 'non_exec_without_mgmt';
  label: string;
  ruleCode: string;
  applicable: boolean;
  limitPercent: number | null;
  permittedAmount: number | null;
  paidAmount: number | null;
  /** Percentage of Section 198 net profit actually paid. */
  paidPercent: number | null;
  within: boolean | null;
  /** The limit is exceeded but the approval route is recorded. */
  approvalRoute: boolean;
  basis: string;
}

/** One Schedule V band of the version in force (spec §13, §19 child table). */
export interface ScheduleVBand {
  id: string;
  version: number;
  effectiveFrom: string;
  /** Effective capital lower bound in ₹ (inclusive); null = negative / no lower bound. */
  capitalFrom: number | null;
  /** Effective capital upper bound in ₹ (exclusive); null = no upper bound. */
  capitalTo: number | null;
  /** Annual ceiling in ₹. */
  annualCeiling: number;
  /** Additional % of effective capital above `capitalFrom` (top band). */
  excessPercent: number | null;
  /** The version doubles the ceiling where the resolution is a special resolution. */
  doubledBySpecialResolution: boolean;
  label: string;
}

export interface ScheduleVResult {
  triggered: boolean;
  reason: string | null;
  effectiveCapital: number | null;
  bands: ScheduleVBand[];
  band: ScheduleVBand | null;
  /** Per-person annual ceiling in ₹ for the band (doubled when applicable). */
  ceiling: number | null;
  doubled: boolean;
  /** Persons paid above the ceiling (Schedule V applies per managerial person). */
  exceeding: string[];
  basis: string;
}

export interface RemunerationResult {
  applicable: boolean;
  outcome: RemunerationOutcome;
  /** Overall ceiling % (kept for older readers). */
  limitPercent: number | null;
  section198NetProfit: number | null;
  /** Overall permitted amount (kept for older readers). */
  permittedAmount: number | null;
  paidAmount: number | null;
  scheduleVRoute: boolean;
  categories: RemunerationCategoryTest[];
  scheduleV: ScheduleVResult;
  basis: string;
}

// ── Track B status types A reads (DI-free, other-reporting-records-read.ts) ─

/** Section 143(12) framework status from the central Fraud Matter records (Track B). */
export interface FraudFrameworkStatus {
  /** The framework is always available (spec §17) — false only when Rule 13 rules are missing. */
  active: boolean;
  matters: number;
  open: number;
  centralGovernmentRoute: number;
  belowThreshold: number;
  overdue: number;
  /** The next statutory deadline (ISO yyyy-mm-dd) across open matters. */
  nextDeadline: string | null;
  /** The ₹ threshold in force for the audit period (Rules Library). */
  thresholdAmount: number | null;
  initialNoticeDays: number | null;
  responseDays: number | null;
  forwardDays: number | null;
}

/** Section 164(2) director workpaper status (Track B, spec §12). */
export interface DirectorDisqualificationStatus {
  total: number;
  pending: number;
  disqualified: number;
  cleared: number;
  /** none_found = every director concluded "No"; identified = at least one "Yes". */
  conclusion: 'not_started' | 'pending' | 'none_found' | 'identified';
}

/** Cross-references consumed from 02.4 / 02.5 / 02.6 — never a second register (Track B, spec §15, §17). */
export interface ReportingCrossRefs {
  caro: {
    applicable: boolean | null;
    conclusion: string | null;
    complete: boolean;
    reportableClauses: number;
  };
  icfr: {
    reportingRequired: boolean | null;
    conclusion: string | null;
    complete: boolean;
    deficiencies: number;
  };
  group: {
    cfsConclusion: string | null;
    /** Branches exist (02.6 BR-01) — null when 02.6 has not answered. */
    branchesExist: boolean | null;
    branchAuditors: number;
    /** Branch auditor reports dealt with (principal-auditor response recorded). */
    branchReportsDealt: number;
    branchReportsPending: number;
    /** Branches not visited by DHVAJ whose returns are received (proper returns). */
    branchReturnsReceived: boolean | null;
  };
}

/** Evidence items linked per card (Track B). */
export type ReportingEvidenceCounts = Partial<Record<ReportingCardKey, number>>;

// ── Facts ───────────────────────────────────────────────────────────────────

/** The 02.7-specific facts captured on the sub-assessment. */
export interface OtherReportingCapturedFacts {
  softwareSystems: SoftwareSystemInput[];
  // §197(16)
  managerialRemunerationPaid: number | null;
  section198NetProfit: number | null;
  hasManagingOrWholeTimeDirector: boolean;
  managerialPersons: ManagerialPersonInput[];
  approvals: RemunerationApprovals;
  /** Effective capital (₹) for the Schedule V band, when the route is triggered. */
  effectiveCapital: number | null;
  /** The team records that profits are inadequate for the ordinary limits (Schedule V route). */
  inadequateProfits: boolean;
  /** §143(12) — legacy single-fraud fields; superseded by Track B Fraud Matter records. */
  fraudIdentified: boolean;
  fraudAmount: number | null;
  fraudEventDate: string | null;
  // Rule 11(e) — legacy flags, kept in step with the two assessments below.
  intermediaryFundsAdvanced: boolean;
  ultimateBeneficiaryFundsReceived: boolean;
  fundingRepresentationsObtained: boolean;
  rule11eAdvanced: Rule11eAssessment;
  rule11eReceived: Rule11eAssessment;
  // dividend + 11(a)-(c) — legacy booleans, kept in step with the structured facts.
  dividendCompliesSec123: boolean | null;
  pendingLitigationDisclosed: boolean | null;
  foreseeableLossesProvided: boolean | null;
  iepfTransferDelay: boolean | null;
  litigation: LitigationFacts;
  foreseeableLosses: ForeseeableLossFacts;
  iepf: IepfFacts;
  dividend: DividendFacts;
  /** Section 143(3) core facts the team confirms (spec §4). */
  booksProper: Tri;
  informationObtained: Tri;
  adverseObservations: Tri;
  accountsQualification: Tri;
  /** Team applicability overrides per card (significant ones route to the EP). */
  applicabilityOverrides: Partial<Record<ReportingCardKey, ReportingApplicabilityOverride>>;
  /** Override / conclusion support recorded with the decision. */
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
}

/** Base facts assembled server-side (not captured on 02.7). */
export interface OtherReportingBaseFacts extends OtherReportingCapturedFacts {
  isCompany: boolean | null;
  isPublicCompany: boolean | null;
  /** Where the public-company answer came from (02.1 profile / entity type). */
  publicCompanySource: string | null;
  /** Rule 11(g) is in force for the engagement's audit period. */
  auditTrailInForce: boolean;
  /** The Rule 11(g) effective date resolved for the period (null = before). */
  auditTrailEffectiveFrom: string | null;
  periodStart: string | null;
  /** The Rule 11 version in force (provision code + effective date) — spec §20. */
  rule11Version: { code: string; effectiveFrom: string } | null;
  fraud: FraudFrameworkStatus;
  directors: DirectorDisqualificationStatus;
  crossRefs: ReportingCrossRefs;
  evidenceCounts: ReportingEvidenceCounts;
  scheduleVBands: ScheduleVBand[];
}

// ── Engine result ───────────────────────────────────────────────────────────

/** A matter the matrix raises (surfaced in detail; the Matters engine owns persistence). */
export interface ReportingMatter {
  code: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  cardKey?: ReportingCardKey;
}

export interface OtherReportingMissingFact {
  key: string;
  label: string;
  /** Blocks identification of required downstream work (spec §20). */
  blocking: boolean;
  cardKey?: ReportingCardKey;
}

/** §143(12) summary on the matrix (the framework detail is Track B's). */
export interface FraudResult {
  identified: boolean;
  route: FraudRoute;
  thresholdAmount: number | null;
  amount: number | null;
  boardReplyByDate: string | null;
  cgForwardByDate: string | null;
  formReference: string | null;
  basis: string;
}

export const FRAUD_ROUTE = {
  centralGovernment: 'central_government',
  auditCommitteeBoard: 'audit_committee_board',
  none: 'none',
} as const;
export type FraudRoute = (typeof FRAUD_ROUTE)[keyof typeof FRAUD_ROUTE];

/** Rule 11(e) summary over the two mirrored assessments. */
export interface Rule11efResult {
  intermediaryFundsAdvanced: boolean;
  ultimateBeneficiaryFundsReceived: boolean;
  representationsObtained: boolean;
  satisfied: boolean;
  basis: string;
}

/** A rule value used by the engine, shown in the UI (spec §20 "shown from Rules Library"). */
export interface OtherReportingRuleUsed {
  code: string;
  label: string;
  value: number | null;
  unit: string;
  effectiveFrom: string | null;
  ruleVersionId: string | null;
}

/** Structured engine extras stored in `systemDetail` — the reporting matrix. */
export interface OtherReportingDetail {
  cards: ReportingCard[];
  rule11g: Rule11gResult;
  remuneration: RemunerationResult;
  fraud: FraudResult;
  rule11ef: Rule11efResult;
  dividendCompliesSec123: boolean | null;
  pendingLitigationDisclosed: boolean | null;
  foreseeableLossesProvided: boolean | null;
  iepfTransferDelay: boolean | null;
  matters: ReportingMatter[];
  missingFacts: OtherReportingMissingFact[];
  rulesUsed: OtherReportingRuleUsed[];
  rule11Version: { code: string; effectiveFrom: string } | null;
}

/** The result of the pure 02.7 engine. */
export interface OtherReportingResult {
  outcome: OtherReportingOutcome;
  state: FrameworkState;
  basis: string;
  ruleVersionId: string | null;
  authorityProvisionId: string | null;
  detail: OtherReportingDetail;
}

// ── Read shape ──────────────────────────────────────────────────────────────

export interface OtherReportingCompletionItem {
  key: string;
  label: string;
  /** null = not relevant for this engagement. */
  met: boolean | null;
  detail: string | null;
}

export interface OtherReportingCompletion {
  complete: boolean;
  status: 'not_started' | 'in_progress' | 'complete';
  items: OtherReportingCompletionItem[];
}

export interface OtherReportingPartnerApproval {
  required: boolean;
  reason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  note: string | null;
}

/** The 02.7 read shape for one statutory-audit workflow instance. */
export interface StatutoryAuditOtherReporting {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  assessment: FrameworkSubAssessment;
  detail: OtherReportingDetail | null;
  /**
   * What the client master and portal records say for these facts, with the
   * source — filled in on first open so the team confirms rather than types.
   */
  masterFacts: MasterFact[];
  capturedFacts: OtherReportingCapturedFacts;
  baseFacts: OtherReportingBaseFacts;
  upstreamReady: boolean;
  professionalAction?: OtherReportingAction | null;
  pendingReason?: string | null;
  partnerApproval?: OtherReportingPartnerApproval;
  completion?: OtherReportingCompletion;
  periodStart?: string;
  approved?: boolean;
  viewerIsPartner?: boolean;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Capture the 02.7-specific facts. Every field optional; omitted = unchanged. */
export interface SetOtherReportingFactsInput {
  softwareSystems?: SoftwareSystemInput[];
  managerialRemunerationPaid?: number | null;
  section198NetProfit?: number | null;
  hasManagingOrWholeTimeDirector?: boolean;
  managerialPersons?: ManagerialPersonInput[];
  approvals?: Partial<RemunerationApprovals>;
  effectiveCapital?: number | null;
  inadequateProfits?: boolean;
  fraudIdentified?: boolean;
  fraudAmount?: number | null;
  fraudEventDate?: string | null;
  intermediaryFundsAdvanced?: boolean;
  ultimateBeneficiaryFundsReceived?: boolean;
  fundingRepresentationsObtained?: boolean;
  rule11eAdvanced?: Partial<Rule11eAssessment>;
  rule11eReceived?: Partial<Rule11eAssessment>;
  dividendCompliesSec123?: boolean | null;
  pendingLitigationDisclosed?: boolean | null;
  foreseeableLossesProvided?: boolean | null;
  iepfTransferDelay?: boolean | null;
  litigation?: Partial<LitigationFacts>;
  foreseeableLosses?: Partial<ForeseeableLossFacts>;
  iepf?: Partial<IepfFacts>;
  dividend?: Partial<DividendFacts>;
  booksProper?: Tri;
  informationObtained?: Tri;
  adverseObservations?: Tri;
  accountsQualification?: Tri;
  /** Set (object) or clear (null) a card's applicability override. */
  applicabilityOverrides?: Partial<Record<ReportingCardKey, ReportingApplicabilityOverride | null>>;
  version: number;
}

/** Record the professional 02.7 conclusion (spec §3, §20). */
export interface RecordOtherReportingDecisionInput {
  /** Defaults: override when `conclusion` differs from the system, else confirm. */
  action?: OtherReportingAction;
  conclusion?: OtherReportingOutcome;
  basis?: string | null;
  technicalBasis?: string | null;
  supportingEvidence?: string | null;
  pendingReason?: string | null;
  impact?: string | null;
  version: number;
}

export interface PartnerApproveOtherReportingInput {
  note?: string | null;
  version: number;
}

/** Result of filling 02.7 facts from the client master and portal records. */
export interface StatutoryAuditOtherReportingMasterFillResult {
  otherReporting: StatutoryAuditOtherReporting;
  /** What was filled (empty when there was nothing new to add). */
  filled: string[];
}

// ── Provision library and reference anchors (spec §18) ──────────────────────

/**
 * Provision codes (spec §18) — resolved through the central Provision Library,
 * never a URL in a component. Track B seeds the ones not yet in the library and
 * the `authority_reference_link` rows under context '02.7'.
 */
export const OTHER_REPORTING_PROVISION_CODE = {
  section143_3: 'COS_ACT_143_3',
  rule11: 'AUDIT_RULE_11',
  rule11g: 'AUDIT_RULE_11G',
  section128_5: 'COS_ACT_128_5',
  section164_2: 'COS_ACT_164_2',
  section197: 'COS_ACT_197',
  section197_16: 'COS_ACT_197_16',
  section198: 'COS_ACT_198',
  scheduleV: 'SCH_V',
  section143_12: 'COS_ACT_143_12',
  rule13: 'AUDIT_RULE_13',
  formAdt4: 'FORM_ADT_4',
  section143_8: 'COS_ACT_143_8',
  section123: 'COS_ACT_123',
  section124_125: 'COS_ACT_124_125',
  section196: 'COS_ACT_196',
  icaiRule11Guide: 'ICAI_IG_RULE_11',
  icaiAuditTrailGuide: 'ICAI_IG_AUDIT_TRAIL',
  icai197Advisory: 'ICAI_ADVISORY_197_16',
} as const;

export const OTHER_REPORTING_REFERENCE_CONTEXT = '02.7';
export const OTHER_REPORTING_REFERENCE_ANCHOR = {
  section143_3: 'section_143_3',
  rule11: 'rule_11',
  rule11efGuidance: 'rule_11_ef_guidance',
  rule11g: 'rule_11_g',
  rule11gGuidance: 'rule_11_g_guidance',
  section128_5: 'section_128_5',
  section164_2: 'section_164_2',
  section197: 'section_197',
  section198: 'section_198',
  scheduleV: 'schedule_v',
  icai197Advisory: 'icai_197_16_advisory',
  section143_12: 'section_143_12',
  rule13: 'rule_13',
  formAdt4: 'form_adt_4',
  section143_8: 'section_143_8',
  section123: 'section_123',
  iepf: 'iepf',
  section196: 'section_196',
} as const;

/** Rules Library codes 02.7 resolves (spec §19). */
export const OTHER_REPORTING_RULE_CODE = {
  overallLimit: 'MGMT_REMUN_LIMIT',
  oneExecutive: 'REM_ONE_MDWTD_MANAGER',
  multipleExecutives: 'REM_MULTI_MDWTD_MANAGER',
  nonExecWithMgmt: 'REM_NONEXEC_WITH_MGMT',
  nonExecWithoutMgmt: 'REM_NONEXEC_WITHOUT_MGMT',
  fraudThreshold: 'FRAUD_CG_THRESHOLD',
  fraudInitialNoticeDays: 'FRAUD_INITIAL_NOTICE_DAYS',
  fraudResponseDays: 'FRAUD_BOARD_REPLY_DAYS',
  fraudForwardDays: 'FRAUD_CG_FORWARD_DAYS',
  auditTrailEffective: 'AUDIT_TRAIL_EFFECTIVE_DATE',
  booksRetention: 'AUDIT_TRAIL_RETENTION',
} as const;

/** Empty Track B statuses (before B's records exist). */
export const EMPTY_FRAUD_STATUS: FraudFrameworkStatus = {
  active: true,
  matters: 0,
  open: 0,
  centralGovernmentRoute: 0,
  belowThreshold: 0,
  overdue: 0,
  nextDeadline: null,
  thresholdAmount: null,
  initialNoticeDays: null,
  responseDays: null,
  forwardDays: null,
};
export const EMPTY_DIRECTOR_STATUS: DirectorDisqualificationStatus = {
  total: 0,
  pending: 0,
  disqualified: 0,
  cleared: 0,
  conclusion: 'not_started',
};
export const EMPTY_CROSS_REFS: ReportingCrossRefs = {
  caro: { applicable: null, conclusion: null, complete: false, reportableClauses: 0 },
  icfr: { reportingRequired: null, conclusion: null, complete: false, deficiencies: 0 },
  group: {
    cfsConclusion: null,
    branchesExist: null,
    branchAuditors: 0,
    branchReportsDealt: 0,
    branchReportsPending: 0,
    branchReturnsReceived: null,
  },
};

export const EMPTY_RULE11E: Rule11eAssessment = {
  representationObtained: 'pending',
  transactionsIdentified: 'pending',
  parties: null,
  beneficiaries: null,
  auditProcedures: null,
  contraryMatter: 'pending',
  contraryNote: null,
  conclusion: 'pending',
};

/** Blank captured facts (a never-touched 02.7). */
export const EMPTY_OTHER_REPORTING_CAPTURED: OtherReportingCapturedFacts = {
  softwareSystems: [],
  managerialRemunerationPaid: null,
  section198NetProfit: null,
  hasManagingOrWholeTimeDirector: false,
  managerialPersons: [],
  approvals: {
    overallSpecialResolution: false,
    executiveSpecialResolution: false,
    nonExecutiveSpecialResolution: false,
    scheduleVSpecialResolution: false,
    note: null,
  },
  effectiveCapital: null,
  inadequateProfits: false,
  fraudIdentified: false,
  fraudAmount: null,
  fraudEventDate: null,
  intermediaryFundsAdvanced: false,
  ultimateBeneficiaryFundsReceived: false,
  fundingRepresentationsObtained: false,
  rule11eAdvanced: EMPTY_RULE11E,
  rule11eReceived: EMPTY_RULE11E,
  dividendCompliesSec123: null,
  pendingLitigationDisclosed: null,
  foreseeableLossesProvided: null,
  iepfTransferDelay: null,
  litigation: {
    identified: 'pending',
    totalMatters: null,
    materialMatters: null,
    disclosure: 'pending',
    exceptions: null,
    sourceWorkpaper: null,
  },
  foreseeableLosses: {
    hasLongTermContracts: 'pending',
    hasDerivativeContracts: 'pending',
    provisionAdequate: 'pending',
    linkedWorkpapers: [],
  },
  iepf: { status: 'pending', delayAmount: null, delayPeriod: null, sourceWorkpaper: null },
  dividend: {
    declaredOrPaid: null,
    kind: null,
    section123Compliant: 'pending',
    note: null,
    sourceWorkpaper: null,
  },
  booksProper: 'pending',
  informationObtained: 'pending',
  adverseObservations: 'pending',
  accountsQualification: 'pending',
  applicabilityOverrides: {},
};
