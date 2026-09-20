/**
 * 02.1 — Entity & Regulatory Profile (Implementation Guide §9.1, §6).
 *
 * THE FACT FOUNDATION of Section 02. It captures the confirmed fact set that
 * drives 02.2–02.9 (guide §1: "a fact is captured once and reused"). Its outcome
 * is NOT an applicability conclusion — it is the reusable profile that the
 * downstream framework engines read, so nothing they conclude is re-asked here.
 *
 * What it uniquely decides (the rest is confirmation of masters):
 *   • Small Company system assessment — COMPUTED from the Companies Act §2(85)
 *     rule version (never a manual checkbox), with a `View Provision` reference.
 *   • The SA triggers carried forward to 02.8 & Planning: SA 510 (initial audit),
 *     SA 402 (a service organisation in the accounting environment) and SA 299
 *     (joint audit).
 *
 * Confirming the profile (`CONFIRM PROFILE`) records the preparer, timestamp,
 * methodology version and a data snapshot, and makes the fact set available to
 * 02.2–02.9 (guide §9.1 Completion). Masters are pre-populated and read-only;
 * corrections route to the source master, never a duplicate audit-only copy.
 */

/** Professional state of the profile. */
export const PROFILE_STATE = {
  draft: 'draft',
  confirmed: 'confirmed',
} as const;
export type ProfileState = (typeof PROFILE_STATE)[keyof typeof PROFILE_STATE];
export const PROFILE_STATES: ProfileState[] = Object.values(PROFILE_STATE);

/**
 * The special-entity matrix (guide §9.1 Card B). A profile may carry zero or
 * more; several (bank/insurance/§8/…) exclude a company from the small-company
 * definition and route downstream areas to a specialised methodology.
 */
export const SPECIAL_ENTITY_TYPE = {
  bank: 'bank',
  insurance: 'insurance',
  nbfc: 'nbfc',
  hfc: 'hfc',
  section_8: 'section_8',
  government: 'government',
  nidhi: 'nidhi',
  producer: 'producer',
  dormant: 'dormant',
  other_regulator: 'other_regulator',
} as const;
export type SpecialEntityType = (typeof SPECIAL_ENTITY_TYPE)[keyof typeof SPECIAL_ENTITY_TYPE];
export const SPECIAL_ENTITY_TYPES: SpecialEntityType[] = Object.values(SPECIAL_ENTITY_TYPE);

/**
 * The accounting environment (guide §9.1 Card H). An outsourced/hybrid
 * environment means a service organisation is involved and auto-flags SA 402.
 */
export const ACCOUNTING_ENVIRONMENT = {
  inHouse: 'in_house',
  outsourced: 'outsourced_service_organisation',
  hybrid: 'hybrid',
} as const;
export type AccountingEnvironment =
  (typeof ACCOUNTING_ENVIRONMENT)[keyof typeof ACCOUNTING_ENVIRONMENT];
export const ACCOUNTING_ENVIRONMENTS: AccountingEnvironment[] =
  Object.values(ACCOUNTING_ENVIRONMENT);

/** Environments in which a service organisation is present (SA 402 trigger). */
export const SERVICE_ORGANISATION_ENVIRONMENTS: AccountingEnvironment[] = [
  ACCOUNTING_ENVIRONMENT.outsourced,
  ACCOUNTING_ENVIRONMENT.hybrid,
];

/**
 * The one reusable financial-data block (guide §9.1 Card D). Each parameter is
 * captured once for the current and prior FY, with source/preparer/evidence, and
 * is reused by every downstream engine — never re-asked.
 */
export const PROFILE_FINANCIAL_PARAMETER = {
  paidUpCapital: 'paid_up_capital',
  turnover: 'turnover',
  netWorth: 'net_worth',
  totalAssets: 'total_assets',
  borrowings: 'borrowings',
  bankFiBorrowings: 'bank_fi_borrowings',
  publicDeposits: 'public_deposits',
} as const;
export type ProfileFinancialParameter =
  (typeof PROFILE_FINANCIAL_PARAMETER)[keyof typeof PROFILE_FINANCIAL_PARAMETER];
export const PROFILE_FINANCIAL_PARAMETERS: ProfileFinancialParameter[] =
  Object.values(PROFILE_FINANCIAL_PARAMETER);

/** Where a captured figure came from (guide §9.1 Card D — source/preparer). */
export const PROFILE_FINANCIAL_SOURCE = {
  auditedFinancials: 'audited_financials',
  provisionalFinancials: 'provisional_financials',
  managementAccounts: 'management_accounts',
  taxReturn: 'tax_return',
  other: 'other',
} as const;
export type ProfileFinancialSource =
  (typeof PROFILE_FINANCIAL_SOURCE)[keyof typeof PROFILE_FINANCIAL_SOURCE];
export const PROFILE_FINANCIAL_SOURCES: ProfileFinancialSource[] =
  Object.values(PROFILE_FINANCIAL_SOURCE);

/**
 * Outcome of the Small Company system assessment (guide §9.1 Card E). Computed
 * from the §2(85) rule version, never entered:
 *   • `not_applicable` — not a company (§2(85) does not apply).
 *   • `pending`        — a deciding fact (paid-up capital / turnover) is absent.
 *   • `small` / `not_small` — the computed conclusion.
 */
export const SMALL_COMPANY_OUTCOME = {
  small: 'small',
  notSmall: 'not_small',
  notApplicable: 'not_applicable',
  pending: 'pending',
} as const;
export type SmallCompanyOutcome =
  (typeof SMALL_COMPANY_OUTCOME)[keyof typeof SMALL_COMPANY_OUTCOME];
export const SMALL_COMPANY_OUTCOMES: SmallCompanyOutcome[] =
  Object.values(SMALL_COMPANY_OUTCOME);

/** The SA triggers 02.1 carries forward to 02.8 and Planning (guide §9.1). */
export const SA_TRIGGER_CODE = {
  sa510: 'SA 510',
  sa402: 'SA 402',
  sa299: 'SA 299',
} as const;
export type SaTriggerCode = (typeof SA_TRIGGER_CODE)[keyof typeof SA_TRIGGER_CODE];

// ── Read shapes ──────────────────────────────────────────────────────────────

/**
 * The Small Company system assessment (guide §9.1 Card E). Carries the actual
 * rule version + provision used so the basis is fully traceable and the UI can
 * expose `View Provision`.
 */
export interface SmallCompanyAssessment {
  outcome: SmallCompanyOutcome;
  basis: string;
  /** The §2(85) rule version frozen onto the conclusion, when a rule drove it. */
  ruleVersionId: string | null;
  /** The provision (Section 2(85)) the conclusion rests on, for `View Provision`. */
  authorityProvisionId: string | null;
}

/** One SA trigger carried forward (guide §9.1). */
export interface SaTrigger {
  code: SaTriggerCode;
  triggered: boolean;
  basis: string;
}

/**
 * The entity classification, read-only from the masters (guide §9.1 Card A).
 * Corrections route to the source master; the profile never edits these.
 */
export interface ProfileClassification {
  entityTypeName: string | null;
  /** entity_types.category, e.g. 'company' | 'llp' | 'firm' | … */
  category: string | null;
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  isListed: boolean;
}

/** One captured financial figure (current + prior FY) — guide §9.1 Card D. */
export interface ProfileFinancialRecord {
  id: string;
  parameter: ProfileFinancialParameter;
  currentValue: number | null;
  priorValue: number | null;
  source: ProfileFinancialSource | null;
  preparer: string | null;
  documentId: string | null;
  version: number;
  updatedAt: string;
}

/** Record the confirmation of the profile (guide §9.1 Completion). */
export interface ProfileConfirmation {
  methodologyVersion: string | null;
  confirmedByName: string | null;
  confirmedAt: string;
}

/** The whole 02.1 profile view for one statutory-audit workflow instance. */
export interface StatutoryAuditEntityProfile {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  state: ProfileState;
  /** The audit financial year (Sec 2(41)) — from the engagement (Card F). */
  financialYear: string | null;
  /** Read-only master classification (Card A). */
  classification: ProfileClassification;
  /** Special-entity matrix captured on the profile (Card B). */
  specialEntityTypes: SpecialEntityType[];
  /** True when the entity has active group relationships on record (Card C). */
  groupHasRelationships: boolean;
  /** Initial (first-year) vs continuing audit; drives SA 510 (Card G). */
  initialAudit: boolean;
  /** Whether initialAudit was system-derived from engagement history (not yet overridden). */
  initialAuditSystemDerived: boolean;
  /** Joint audit; drives SA 299 (Card I). */
  jointAudit: boolean;
  /** Accounting environment; an outsourced/hybrid one drives SA 402 (Card H). */
  accountingEnvironment: AccountingEnvironment | null;
  /** The reusable financial-data block (Card D). */
  financials: ProfileFinancialRecord[];
  /** The computed Small Company assessment (Card E). */
  smallCompany: SmallCompanyAssessment;
  /** SA 510 / 402 / 299 carried forward (guide §9.1). */
  saTriggers: SaTrigger[];
  /** Confirmation record, or null while the profile is a draft. */
  confirmation: ProfileConfirmation | null;
  /** Set by a downstream change-impact trigger; does not rewrite the snapshot. */
  needsReevaluation: boolean;
  /** Facts still missing that CONFIRM PROFILE needs (empty ⇒ ready). */
  missingFacts: string[];
  /** True when the classification is known and no deciding fact is missing. */
  readyToConfirm: boolean;
  version: number;
}

// ── Input shapes ─────────────────────────────────────────────────────────────

/** Update the professional facts captured on the profile (Cards B/G/H/I). */
export interface UpdateEntityProfileInput {
  specialEntityTypes?: SpecialEntityType[];
  initialAudit?: boolean;
  jointAudit?: boolean;
  accountingEnvironment?: AccountingEnvironment | null;
  version: number;
}

/** Capture one financial parameter for the current and/or prior FY (Card D). */
export interface CaptureProfileFinancialInput {
  parameter: ProfileFinancialParameter;
  currentValue?: number | null;
  priorValue?: number | null;
  source?: ProfileFinancialSource | null;
  preparer?: string | null;
  documentId?: string | null;
}

/** Confirm the profile — freezes the fact set for 02.2–02.9 (Completion). */
export interface ConfirmProfileInput {
  note?: string | null;
}
