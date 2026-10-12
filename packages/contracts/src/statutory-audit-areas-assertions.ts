/**
 * Statutory Audit — 03.5 Audit Areas & Assertions (DHVAJ 03.5 spec — FROZEN;
 * build doc §5.5).
 *
 * The completeness and structuring step for the audit universe: the engagement
 * receives every active area of the applicable DHVAJ Audit Area Library
 * (default Retained); the Manager removes what is not required, adds what is
 * missing and reviews the suggested SA 315 assertions. 03.5 never assesses RMM,
 * designs procedures or depends on a TB. Its output — the Audit Area &
 * Assertion Matrix — is structured data consumed by 03.6.
 *
 * Values, labels, validation IDs and assertion IDs are implemented exactly as
 * the frozen specification states them.
 */
import type { FinancialUnit } from './statutory-audit-planning-analytics';
import type { PlanningAttention } from './statutory-audit-planning-signal';

const labels = <T extends string>(m: Record<T, string>) => m;

export const areaReviewVersionLabel = (versionNo: number): string => `v${versionNo}`;

// ── §3 Section status ───────────────────────────────────────────────────────

export const AREA_SECTION_STATUSES = [
  'not_started',
  'in_progress',
  'requires_review',
  'complete',
  'update_required',
] as const;
export type AreaSectionStatus = (typeof AREA_SECTION_STATUSES)[number];
export const AREA_SECTION_STATUS_LABEL = labels<AreaSectionStatus>({
  not_started: 'Not Started',
  in_progress: 'In Progress',
  requires_review: 'Requires Review',
  complete: 'Complete',
  update_required: 'Update Required',
});
/** What is stored; Not Started / Requires Review are derived. */
export type StoredAreaReviewStatus = 'in_progress' | 'complete' | 'update_required';

// ── §6 / §11 Area master vocabulary ─────────────────────────────────────────

export const AREA_TYPES = ['balance_sheet', 'profit_loss', 'disclosure', 'cross_cutting'] as const;
export type AreaType = (typeof AREA_TYPES)[number];
export const AREA_TYPE_LABEL = labels<AreaType>({
  balance_sheet: 'Balance Sheet',
  profit_loss: 'Profit & Loss',
  disclosure: 'Disclosure',
  cross_cutting: 'Cross-cutting',
});
export const AREA_TYPE_MEANING = labels<AreaType>({
  balance_sheet: 'Primarily an account-balance area.',
  profit_loss: 'Primarily a class of transactions/events area.',
  disclosure: 'Primarily presentation/disclosure focused.',
  cross_cutting: 'Matter can affect multiple balances, transactions or disclosures.',
});

export const AREA_CATEGORIES = [
  'assets',
  'liabilities_equity',
  'income_expenses',
  'disclosure_cross_cutting',
] as const;
export type AreaCategory = (typeof AREA_CATEGORIES)[number];
export const AREA_CATEGORY_LABEL = labels<AreaCategory>({
  assets: 'Assets',
  liabilities_equity: 'Liabilities & Equity',
  income_expenses: 'Income & Expenses',
  disclosure_cross_cutting: 'Disclosure / Cross-cutting',
});

export const AREA_CONDITION_KEYS = [
  'cfs_applicable',
  'initial_audit',
  'caro_applicable',
  'ifc_applicable',
  'ind_as_transition',
] as const;
export type AreaConditionKey = (typeof AREA_CONDITION_KEYS)[number];
/** §4 library selection conditions — the area joins the population only when the fact holds. */
export const AREA_CONDITION_LABEL = labels<AreaConditionKey>({
  cfs_applicable: 'Consolidated financial statements applicable (Section 02)',
  initial_audit: 'Initial audit (Section 01 / 02)',
  caro_applicable: 'CARO 2020 applicable (Section 02)',
  ifc_applicable: 'IFC reporting applicable (Section 02)',
  ind_as_transition: 'First-time Ind AS adoption (02.2)',
});
/** Library industry profile every engagement receives (the 03.2 `generic` profile maps here). */
export const GENERAL_CORPORATE_INDUSTRY = 'general_corporate';

export const AREA_DISPOSITIONS = ['retained', 'removed'] as const;
export type AreaDisposition = (typeof AREA_DISPOSITIONS)[number];
export const AREA_DISPOSITION_LABEL = labels<AreaDisposition>({
  retained: 'Retained',
  removed: 'Removed',
});

export type AreaSource = 'library' | 'custom';
export const AREA_SOURCE_LABEL = labels<AreaSource>({ library: 'Library', custom: 'Custom' });
export type AreaOrigin =
  | 'population'
  | 'added_from_library'
  | 'methodology_refresh'
  | 'custom'
  /** Converted from a 03.4 Preliminary Audit Approach Map area (03.4 §23). */
  | 'scope_map';

// ── §14 Attention model — never a risk rating ───────────────────────────────

/** Stored attention (Manager / portal). */
export const AREA_ATTENTIONS = ['standard', 'enhanced'] as const;
export type AreaAttention = (typeof AREA_ATTENTIONS)[number];
/** Displayed attention: Requires Review is raised by validation / impact rules. */
export type AreaDisplayAttention = AreaAttention | 'requires_review';
export const AREA_ATTENTION_LABEL = labels<AreaDisplayAttention>({
  standard: 'Standard',
  enhanced: 'Enhanced Attention',
  requires_review: 'Requires Review',
});
export const AREA_ATTENTION_DEFINITION = labels<AreaDisplayAttention>({
  standard: 'No particular planning matter presently identified beyond normal audit consideration.',
  enhanced:
    'Existing information indicates particular attention should be carried into risk assessment.',
  requires_review:
    'Information/decision is incomplete, conflicting or impacted and must be resolved before completion.',
});

// ── §9.1 Removal reasons ────────────────────────────────────────────────────

export const REMOVAL_REASON_CODES = [
  'NO_BALANCE_ACTIVITY',
  'NOT_APPLICABLE',
  'COVERED_ELSEWHERE',
  'NOT_SEPARATELY_SCOPED',
  'OTHER',
] as const;
export type RemovalReasonCode = (typeof REMOVAL_REASON_CODES)[number];
export const REMOVAL_REASON_LABEL = labels<RemovalReasonCode>({
  NO_BALANCE_ACTIVITY: 'No such balance/transaction/disclosure',
  NOT_APPLICABLE: 'Not applicable to the entity',
  COVERED_ELSEWHERE: 'Covered under another Audit Area',
  NOT_SEPARATELY_SCOPED: 'Not separately scoped considering amount and nature',
  OTHER: 'Other',
});
/** Codes that always need a short rationale. */
export const REMOVAL_REASON_NEEDS_TEXT: RemovalReasonCode[] = ['NOT_SEPARATELY_SCOPED', 'OTHER'];

export const REMOVE_MODAL_TITLE = 'Remove Audit Area';
export const REMOVE_MODAL_PROMPT = 'Why is this Audit Area not required for this engagement?';
export const REMOVAL_WARNING_TEXT =
  'Existing engagement information indicates that this Audit Area may be relevant. Review the indicators below and confirm the removal reason.';

// ── §15 Canonical assertion master ──────────────────────────────────────────

export const ASSERTION_IDS = [
  'TX_OCC',
  'TX_COMP',
  'TX_ACC',
  'TX_CUTOFF',
  'TX_CLASS',
  'BAL_EXIST',
  'BAL_RO',
  'BAL_COMP',
  'BAL_VAL',
  'PD_OCC_RO',
  'PD_COMP',
  'PD_CLASS_UND',
  'PD_ACC_VAL',
] as const;
export type AssertionId = (typeof ASSERTION_IDS)[number];
export type AssertionGroup = 'transactions' | 'balances' | 'presentation';
export const ASSERTION_GROUP_LABEL = labels<AssertionGroup>({
  transactions: 'Transactions / events',
  balances: 'Account balances',
  presentation: 'Presentation / disclosure',
});
export interface AssertionMasterItem {
  id: AssertionId;
  group: AssertionGroup;
  label: string;
}

export type AssertionOrigin = 'suggested' | 'user_added';
export const ASSERTION_ORIGIN_LABEL = labels<AssertionOrigin>({
  suggested: 'Portal-suggested',
  user_added: 'User-added',
});

// ── §5 Information-available indicators ─────────────────────────────────────

export const AREA_INDICATOR_KEYS = [
  'financial_data',
  'planning_signal',
  'specific_materiality',
  'statutory',
  'cfs',
  'caro',
  'prior_year',
] as const;
export type AreaIndicatorKey = (typeof AREA_INDICATOR_KEYS)[number];
export const AREA_INDICATOR_LABEL = labels<AreaIndicatorKey>({
  financial_data: 'Financial Data',
  planning_signal: 'Planning Signal',
  specific_materiality: 'Specific Materiality',
  statutory: 'Statutory',
  cfs: 'CFS',
  caro: 'CARO',
  prior_year: 'Prior-Year Area',
});

// ── §13 Amounts ─────────────────────────────────────────────────────────────

export type AreaAmountSource = '03.2' | 'manual' | 'other';
export const AREA_AMOUNT_SOURCE_LABEL = labels<AreaAmountSource>({
  '03.2': '03.2 financial dataset',
  manual: 'Manual entry',
  other: 'Other source',
});
export const FINANCIAL_INFO_NOT_AVAILABLE = 'Financial information not available';

// ── §21 Validations ─────────────────────────────────────────────────────────

export const AREA_VALIDATION_IDS = [
  'VAL-01',
  'VAL-02',
  'VAL-03',
  'VAL-04',
  'VAL-05',
  'VAL-06',
  'VAL-07',
  'VAL-08',
  'VAL-09',
  'VAL-10',
  'VAL-11',
] as const;
export type AreaValidationId = (typeof AREA_VALIDATION_IDS)[number];
export const AREA_VALIDATION_LABEL = labels<AreaValidationId>({
  'VAL-01': 'All library areas resolved',
  'VAL-02': 'Removal reason complete',
  'VAL-03': 'Assertions present',
  'VAL-04': 'Specific materiality mapped',
  'VAL-05': 'Planning Signal resolution',
  'VAL-06': 'CFS consistency',
  'VAL-07': 'Initial audit consistency',
  'VAL-08': 'Significant removal documentation',
  'VAL-09': 'No Requires Review',
  'VAL-10': 'No broken coverage link',
  'VAL-11': '03.4 Approach Map areas carried into 03.5',
});

// ── §22 Completion ──────────────────────────────────────────────────────────

export const AA01_TITLE = 'AA-01 — Manager Confirmation';
export const AA01_TEXT =
  'I confirm that the applicable DHVAJ Audit Area Library has been reviewed and that the retained Audit Areas and relevant assertions appropriately represent the areas requiring further risk assessment for this engagement.';
export const AREA_COMPLETE_BUTTON = 'Complete Audit Area Review';
export const AREA_CONFIRM_BUTTON = 'Confirm & Complete 03.5';
export const AREA_RETURN_BUTTON = 'Return to Review';

// ── §27 Partner review comments ─────────────────────────────────────────────

export const AREA_COMMENT_KINDS = [
  'comment',
  'challenge',
  'reassessment_request',
  'downstream_request',
] as const;
export type AreaCommentKind = (typeof AREA_COMMENT_KINDS)[number];
export const AREA_COMMENT_KIND_LABEL = labels<AreaCommentKind>({
  comment: 'Review comment',
  challenge: 'Challenge',
  reassessment_request: 'Request reassessment',
  downstream_request: 'Area requested by risk assessment',
});
/** Kinds the Engagement Partner raises (§27). */
export const PARTNER_AREA_COMMENT_KINDS: AreaCommentKind[] = [
  'comment',
  'challenge',
  'reassessment_request',
];
/** Open items of these kinds keep 03.5 in Requires Review (VAL-09) until the Manager answers. */
export const BLOCKING_AREA_COMMENT_KINDS: AreaCommentKind[] = [
  'challenge',
  'reassessment_request',
  'downstream_request',
];

// ── §27 Roles and permissions ───────────────────────────────────────────────

/**
 * Explicit engagement permission for a Senior / Article (§27): `prepare` lets
 * them retain / remove / add areas and edit assertions, attention, links and
 * amounts; `manager_equivalent` also completes AA-01, reopens and answers the
 * Engagement Partner.
 */
export const AREA_PERMISSION_LEVELS = ['prepare', 'manager_equivalent'] as const;
export type AreaPermissionLevel = (typeof AREA_PERMISSION_LEVELS)[number];
export const AREA_PERMISSION_LEVEL_LABEL = labels<AreaPermissionLevel>({
  prepare: 'May prepare 03.5',
  manager_equivalent: 'Manager-equivalent (may complete AA-01)',
});

/** What the acting user may do in 03.5 (the API enforces the same matrix). */
export interface AreaReviewCapabilities {
  /** Retain / remove / restore / add areas; assertions; attention; links; amounts; evidence. */
  prepare: boolean;
  /** Complete AA-01, reopen, refresh the library, resolve Requires Review. */
  complete: boolean;
  /** Answer an EP challenge / reassessment / downstream request. */
  respond: boolean;
  /** Grant / revoke 03.5 permission to Seniors / Articles. */
  manageGrants: boolean;
  /** Comment, challenge and request reassessment (Engagement Partner). */
  partnerReview: boolean;
  /** Ask for a missing area from the risk assessment (any team member). */
  requestArea: boolean;
}

export type AreaReviewRole = 'partner' | 'manager' | 'oversight' | 'team' | 'none';

export interface AreaReviewAccess {
  role: AreaReviewRole;
  roleLabel: string;
  /** The EP is acting as Manager because no Engagement Manager is assigned. */
  actingAsManager: boolean;
  employeeId: string | null;
  /** The caller's explicit 03.5 permission, when a team member holds one. */
  grant: AreaPermissionLevel | null;
  capabilities: AreaReviewCapabilities;
}

export interface AreaReviewGrant {
  id: string;
  employeeId: string;
  employeeName: string | null;
  level: AreaPermissionLevel;
  note: string | null;
  grantedByName: string | null;
  grantedAt: string;
}

/** A team member the Manager may grant 03.5 permission to. */
export interface AreaGrantCandidate {
  employeeId: string;
  name: string;
  roleOnEngagement: string;
}

// ── Entities ────────────────────────────────────────────────────────────────

export interface AuditAreaLibraryItem {
  id: string;
  libraryVersion: string;
  areaCode: string;
  areaName: string;
  areaType: AreaType;
  category: AreaCategory;
  conditionKey: AreaConditionKey | null;
  defaultAssertions: AssertionId[];
  aliases: string[];
}

export interface AreaAssertion {
  id: string;
  assertionId: AssertionId;
  group: AssertionGroup;
  label: string;
  origin: AssertionOrigin;
  active: boolean;
  removalReason: string | null;
  attention: AreaAttention;
  suggestedAttention: AreaAttention | null;
  suggestionBasis: string | null;
  attentionReason: string | null;
  version: number;
}

export interface AreaSignalLink {
  signalId: string;
  code: string;
  observation: string;
  attention: PlanningAttention;
  origin: 'auto' | 'manual';
  active: boolean;
}

export interface AreaSpecificLink {
  specificKey: string;
  label: string;
  origin: 'auto' | 'manual';
  active: boolean;
  /** False when the matter is no longer in the materiality in force. */
  current: boolean;
}

export interface AreaIndicator {
  key: AreaIndicatorKey;
  label: string;
  detail: string;
}

export interface AreaWarning {
  key: string;
  text: string;
  /** High = specific materiality / framework inconsistency. */
  severity: 'high' | 'normal';
}

export type AuthorityCategory =
  'accounting' | 'auditing' | 'companies_act_caro' | 'schedule_iii' | 'other';
export const AUTHORITY_CATEGORY_LABEL = labels<AuthorityCategory>({
  accounting: 'Accounting',
  auditing: 'Auditing',
  companies_act_caro: 'Companies Act / CARO',
  schedule_iii: 'Schedule III',
  other: 'Other configured authority',
});
export interface AreaAuthorityRef {
  code: string;
  label: string;
  title: string;
  category: AuthorityCategory;
}

/** A prior-year matter (03.1 register) whose wording points at this area (§20). */
export interface AreaPriorYearMatter {
  id: string;
  code: string;
  matterType: string;
  description: string;
}

export interface AreaPriorYear {
  /** The area was in last year's 03.5 matrix (else only prior-year matters match it). */
  inPriorMatrix: boolean;
  retained: boolean;
  attention: AreaAttention | null;
  assertions: string[];
  cy: number | null;
  unit: string | null;
  /** Significant matters / findings carried from last year, matched to the area. */
  matters: AreaPriorYearMatter[];
}

/** §9.1 / §24 — downstream work that references the area. */
export interface AreaDownstreamWork {
  risks: number;
  procedures: number;
  /** Work areas already started (not just generated). */
  workAreas: number;
}

export interface EngagementAuditArea {
  id: string;
  seq: number;
  source: AreaSource;
  origin: AreaOrigin;
  sourceAuditAreaId: string | null;
  areaCode: string | null;
  libraryVersion: string | null;
  areaName: string;
  areaType: AreaType;
  category: AreaCategory | null;
  aliases: string[];
  conditionKey: AreaConditionKey | null;
  additionReason: string | null;
  disposition: AreaDisposition;
  /** Stored attention. */
  attention: AreaAttention;
  /** Displayed attention (Requires Review overrides). */
  displayAttention: AreaDisplayAttention;
  attentionSource: 'default' | 'portal' | 'manager';
  attentionReason: string | null;
  /** Portal suggestion from linked Enhanced / Immediate signals. */
  suggestedAttention: AreaAttention;
  suggestionBasis: string | null;
  removalReasonCode: RemovalReasonCode | null;
  removalReasonText: string | null;
  coveredUnderAreaId: string | null;
  coveredUnderName: string | null;
  removedAt: string | null;
  removedByName: string | null;
  /** Amounts as displayed: manual when entered, else live from 03.2. */
  cyAmount: number | null;
  pyAmount: number | null;
  currency: string | null;
  unit: FinancialUnit | null;
  amountSource: AreaAmountSource | null;
  amountNote: string | null;
  /** Manual figures stored on the area (null → none). */
  manualAmount: {
    cy: number | null;
    py: number | null;
    currency: string;
    unit: FinancialUnit;
  } | null;
  /** 'Above OM' / 'Below OM' — informational only (§13). */
  omComparison: 'above_om' | 'below_om' | null;
  planningOwnerEmployeeId: string | null;
  planningOwnerName: string | null;
  reviewFlag: string | null;
  reviewFlagSource: string | null;
  inconsistencyResolution: string | null;
  requiresReviewReasons: string[];
  indicators: AreaIndicator[];
  warnings: AreaWarning[];
  /** Strong applicability indicators (VAL-08). */
  strongIndicators: string[];
  assertions: AreaAssertion[];
  signals: AreaSignalLink[];
  specific: AreaSpecificLink[];
  /** Portal suggestions not yet linked (library mapping tags / matter names). */
  suggestedSignals: {
    signalId: string;
    code: string;
    observation: string;
    attention: PlanningAttention;
  }[];
  suggestedSpecific: { specificKey: string; label: string }[];
  authorities: AreaAuthorityRef[];
  priorYear: AreaPriorYear | null;
  /** Downstream work items that block removal (§9.1): risks + procedures + started work areas. */
  downstreamWork: number;
  downstreamDetail: AreaDownstreamWork;
  /** Supporting files linked to the area (§28). */
  evidenceCount: number;
  /** The 03.4 Approach Map area this area carries (read-only strategy context). */
  scopeStrategy: AreaScopeStrategy | null;
  version: number;
}

/** 03.4 §23 — the preliminary strategy of the Approach Map area linked to a 03.5 area. */
export interface AreaScopeStrategy {
  mapItemId: string;
  /** AM-00n. */
  code: string;
  name: string;
  controlsStrategy: string | null;
  timing: string | null;
  evidenceChannels: string[];
  specialConsiderations: string[];
  /** The map area is flagged Reassessment Required in 03.4. */
  reassessmentRequired: boolean;
}

export interface AreaSpecificMatter {
  key: string;
  label: string;
  scopeType: string;
  amount: number | null;
  mappedAreaIds: string[];
}

export interface AreaSignalRef {
  id: string;
  code: string;
  observation: string;
  attention: PlanningAttention;
  status: string;
  /** Unresolved Enhanced / Immediate — VAL-05 applies. */
  requiresMapping: boolean;
  mappedAreaIds: string[];
  resolution: string | null;
}

export interface AreaValidation {
  id: AreaValidationId;
  label: string;
  met: boolean;
  detail: string | null;
  areaIds: string[];
}

export interface AreaMatrixRow {
  areaId: string;
  areaCode: string | null;
  areaName: string;
  source: AreaSource;
  areaType: AreaType;
  cy: number | null;
  py: number | null;
  unit: FinancialUnit | null;
  currency: string | null;
  attention: AreaAttention;
  assertions: {
    assertionId: AssertionId;
    label: string;
    group: AssertionGroup;
    attention: AreaAttention;
  }[];
  signals: { id: string; code: string; observation: string }[];
}

export interface AreaCompletenessSummary {
  libraryAreasReviewed: number;
  retained: number;
  removed: number;
  customRetained: number;
  customRemoved: number;
  enhanced: number;
  requiresReview: number;
  unresolvedSignals: number;
}

export interface AreaMatrixVersion {
  versionNo: number;
  versionLabel: string;
  libraryVersion: string;
  confirmedAt: string;
  confirmedByName: string | null;
  rows: AreaMatrixRow[];
  summary: AreaCompletenessSummary;
}

export type AreaImpactKind =
  | 'materiality_decrease'
  | 'new_specific_materiality'
  | 'new_signal'
  | 'cfs_change'
  | 'initial_audit_change'
  | 'new_financial_area'
  | 'new_disclosure_area'
  | 'downstream_area_missing'
  | 'partner_reassessment';
export const AREA_IMPACT_KIND_LABEL = labels<AreaImpactKind>({
  materiality_decrease: 'Materiality revised downward',
  new_specific_materiality: 'New specific materiality',
  new_signal: 'New Enhanced/Immediate Planning Signal',
  cfs_change: 'CFS status changed',
  initial_audit_change: 'Initial-audit status corrected',
  new_financial_area: 'New financial statement area identified',
  new_disclosure_area: 'New material disclosure / applicability identified',
  downstream_area_missing: 'Risk assessment needs an area not in 03.5',
  partner_reassessment: 'Engagement Partner requested reassessment',
});
export interface AreaImpact {
  key: string;
  kind: AreaImpactKind;
  message: string;
  areaIds: string[];
}

export interface AreaReviewComment {
  id: string;
  areaId: string | null;
  areaName: string | null;
  kind: AreaCommentKind;
  body: string;
  status: 'open' | 'addressed';
  response: string | null;
  createdByName: string | null;
  createdAt: string;
  respondedByName: string | null;
  respondedAt: string | null;
  /** downstream_request: the area the risk work needs, where from, and what answered it. */
  proposedAreaName: string | null;
  sourceModule: '03.6' | 'section_04' | null;
  sourceRiskId: string | null;
  resolvedAreaId: string | null;
  version: number;
}

export interface AreaReviewRecord {
  id: string;
  versionNo: number;
  versionLabel: string;
  status: StoredAreaReviewStatus;
  libraryVersion: string;
  libraryProfile: AreaLibraryProfile;
  initialPopulationCount: number;
  updateReason: string | null;
  reopenReason: string | null;
  completedByName: string | null;
  completedAt: string | null;
  version: number;
}

export interface AreaLibraryProfile {
  frf: 'as' | 'ind_as' | 'unknown';
  /** 03.2 industry profile (`general_corporate` when none / generic). */
  industry: string;
  cfsApplicable: boolean;
  initialAudit: boolean;
  /** Section 02 conclusions (optional: profiles stored before 2026.2 omit them). */
  caroApplicable?: boolean;
  ifcApplicable?: boolean;
  /** 02.2 — first-time adoption of Ind AS (Ind AS 101 transition). */
  indAsTransition?: boolean;
}

export interface AreaReviewTiles {
  applicableLibraryAreas: number;
  retained: number;
  removed: number;
  enhanced: number;
  requiresReview: number;
}

export interface AuditAreaReviewSummary {
  record: AreaReviewRecord | null;
  status: AreaSectionStatus;
  profile: AreaLibraryProfile;
  currentLibraryVersion: string | null;
  methodologyUpdateAvailable: boolean;
  scopeApproachStatus: string | null;
  materiality: { versionLabel: string; overallMateriality: number | null } | null;
  datasetUnit: FinancialUnit | null;
  tiles: AreaReviewTiles;
  areas: EngagementAuditArea[];
  /** Applicable library areas not in the engagement (Add from Library). */
  availableLibrary: AuditAreaLibraryItem[];
  specificMatters: AreaSpecificMatter[];
  signals: AreaSignalRef[];
  validations: AreaValidation[];
  completeness: AreaCompletenessSummary;
  matrix: AreaMatrixRow[];
  matrixVersions: AreaMatrixVersion[];
  impacts: AreaImpact[];
  comments: AreaReviewComment[];
  /** Open challenges / reassessment / downstream requests — VAL-09 until answered. */
  openReviewItems: number;
  assertionMaster: AssertionMasterItem[];
  /** §27 — the acting user's 03.5 role and what they may do. */
  access: AreaReviewAccess;
  /** Explicit 03.5 permissions on this engagement. */
  grants: AreaReviewGrant[];
  /** Team members the Manager may grant permission to (empty unless manageGrants). */
  grantCandidates: AreaGrantCandidate[];
  /** §28 — evidence links per assertion row id (`area_assertion` target). */
  assertionEvidenceCounts: Record<string, number>;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface RemoveAuditAreaInput {
  reasonCode: RemovalReasonCode;
  reasonText?: string | null;
  coveredUnderAreaId?: string | null;
  version: number;
}
export interface RestoreAuditAreaInput {
  version: number;
}
export interface AddLibraryAreasInput {
  libraryAreaIds: string[];
}
export interface AddCustomAreaInput {
  name: string;
  areaType: AreaType;
  reason: string;
  signalIds?: string[];
}
export interface UpdateAuditAreaInput {
  version: number;
  attention?: AreaAttention;
  attentionReason?: string | null;
  cyAmount?: number | null;
  pyAmount?: number | null;
  currency?: string | null;
  unit?: FinancialUnit | null;
  amountSource?: 'manual' | 'other' | null;
  amountNote?: string | null;
  planningOwnerEmployeeId?: string | null;
  inconsistencyResolution?: string | null;
  /** Resolve an impact / refresh Requires Review flag with a note. */
  resolveReviewFlag?: string | null;
}
export interface AssertionActionInput {
  action: 'add' | 'remove' | 'restore' | 'set_attention';
  reason?: string | null;
  attention?: AreaAttention;
}
export interface AreaLinkInput {
  action: 'link' | 'unlink';
  signalId?: string;
  specificKey?: string;
}
export interface SignalResolutionInput {
  signalId: string;
  /** null clears the resolution. */
  note: string | null;
}
export interface CompleteAreaReviewInput {
  confirm: boolean;
  version: number;
}
export interface ReopenAreaReviewInput {
  reason: string;
}
export interface AreaCommentInput {
  kind: AreaCommentKind;
  body: string;
  areaId?: string | null;
}
export interface RespondAreaCommentInput {
  response: string;
  /** downstream_request: the area (added / restored) that answers it. */
  resolvedAreaId?: string | null;
}
export interface GrantAreaPermissionInput {
  employeeId: string;
  level: AreaPermissionLevel;
  note?: string | null;
}
/** §25 — the risk assessment needs an area that is not in the retained population. */
export interface DownstreamAreaRequestInput {
  proposedAreaName: string;
  reason: string;
  riskId?: string | null;
}

// ── §4 / §7 Audit Area Library administration (methodology, versioned) ─────

export type AuditAreaLibraryReleaseStatus = 'draft' | 'released';

export interface AuditAreaLibraryRelease {
  libraryVersion: string;
  status: AuditAreaLibraryReleaseStatus;
  basedOn: string | null;
  note: string | null;
  areaCount: number;
  activeCount: number;
  releasedAt: string | null;
  createdAt: string;
  /** The release new engagements are populated from. */
  current: boolean;
  /** Engagement 03.5 reviews on this release. */
  engagementsUsing: number;
}

/** One library area as the admin edits it (all §6 master fields). */
export interface AuditAreaLibraryAdminRow {
  id: string;
  libraryVersion: string;
  areaCode: string;
  areaName: string;
  areaType: AreaType;
  category: AreaCategory;
  frameworkProfile: 'both' | 'as' | 'ind_as';
  industryProfile: string;
  conditionKey: AreaConditionKey | null;
  defaultAssertions: AssertionId[];
  nonAssertionWorkstream: boolean;
  defaultAttention: AreaAttention;
  relatedAuthorities: string[];
  signalMappingTags: string[];
  metricKeys: string[];
  indicatorTags: string[];
  aliases: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
  sortOrder: number;
}

export interface AuditAreaLibraryAdminView {
  releases: AuditAreaLibraryRelease[];
  /** The release shown. */
  selected: AuditAreaLibraryRelease | null;
  rows: AuditAreaLibraryAdminRow[];
  assertionMaster: AssertionMasterItem[];
  /** Industry profiles areas may target (03.2 profiles + general_corporate). */
  industryProfiles: { key: string; label: string }[];
}

export interface CreateLibraryDraftInput {
  /** New version id, e.g. `dhvaj-gc-2026.3`. */
  libraryVersion: string;
  note: string;
}

export type UpsertLibraryAreaInput = Omit<AuditAreaLibraryAdminRow, 'id' | 'libraryVersion'>;
