import type { AuthorityReference } from './authority';
import type { MasterFact, MasterFactFix } from './statutory-audit';

/**
 * 02.1 — Entity & Regulatory Profile (Implementation Guide §9.1, §6; DHVAJ 02.1
 * web developer specification).
 *
 * THE FACT FOUNDATION of Section 02. It captures the confirmed fact set that
 * drives 02.2–02.9 (guide §1: "a fact is captured once and reused"). Its outcome
 * is NOT an applicability conclusion — it is the reusable profile that the
 * downstream framework engines read, so nothing they conclude is re-asked here.
 *
 * What it uniquely decides (the rest is confirmation of masters):
 *   • Small Company system assessment — COMPUTED from the Companies Act §2(85)
 *     rule version (never a manual checkbox), with a `View Provision` reference;
 *     the Manager confirms it or overrides it with a reason, and both the system
 *     result and the professional conclusion are kept.
 *   • The SA triggers carried forward to 02.8 & Planning: SA 510 (initial audit),
 *     SA 402 (a service organisation) and SA 299 (joint audit).
 *
 * Confirming the profile (`CONFIRM PROFILE`) records the preparer, timestamp,
 * methodology version, the accepted statement and a data snapshot, and makes
 * the fact set available to 02.2–02.9. Masters are pre-populated and read-only;
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

export const SPECIAL_ENTITY_LABEL: Record<SpecialEntityType, string> = {
  bank: 'Banking company',
  insurance: 'Insurance company',
  nbfc: 'NBFC',
  hfc: 'Housing Finance Company',
  section_8: 'Section 8 company',
  government: 'Government company',
  nidhi: 'Nidhi company',
  producer: 'Producer company',
  dormant: 'Dormant company',
  other_regulator: 'Other regulated entity',
};

/**
 * Special types whose value comes from the Entity Master (spec Card B "System
 * value + Confirm") — corrected on the master, not toggled on the profile.
 */
export const MASTER_OWNED_SPECIAL_TYPES: SpecialEntityType[] = [
  SPECIAL_ENTITY_TYPE.section_8,
  SPECIAL_ENTITY_TYPE.government,
];

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

export const ACCOUNTING_ENVIRONMENT_LABEL: Record<AccountingEnvironment, string> = {
  in_house: 'In-house',
  outsourced_service_organisation: 'Outsourced to a service organisation',
  hybrid: 'Hybrid (partly outsourced)',
};

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
export const PROFILE_FINANCIAL_PARAMETERS: ProfileFinancialParameter[] = Object.values(
  PROFILE_FINANCIAL_PARAMETER,
);

export const PROFILE_FINANCIAL_LABEL: Record<ProfileFinancialParameter, string> = {
  paid_up_capital: 'Paid-up Share Capital',
  turnover: 'Turnover / Revenue',
  net_worth: 'Net Worth',
  total_assets: 'Total Assets',
  borrowings: 'Outstanding Borrowings',
  bank_fi_borrowings: 'Borrowings from Banks / Financial Institutions',
  public_deposits: 'Deposits, where relevant',
};

/**
 * The figures the next applicability assessments need (Ind AS / CARO / IFC /
 * Small Company). Missing ones show in Card J; the two the §2(85) test reads
 * block confirmation through the Small Company assessment itself.
 */
export const REQUIRED_PROFILE_FINANCIALS: ProfileFinancialParameter[] = [
  PROFILE_FINANCIAL_PARAMETER.paidUpCapital,
  PROFILE_FINANCIAL_PARAMETER.turnover,
  PROFILE_FINANCIAL_PARAMETER.netWorth,
  PROFILE_FINANCIAL_PARAMETER.totalAssets,
  PROFILE_FINANCIAL_PARAMETER.borrowings,
];

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

export const PROFILE_FINANCIAL_SOURCE_LABEL: Record<ProfileFinancialSource, string> = {
  audited_financials: 'Audited financial statements',
  provisional_financials: 'Provisional financial statements',
  management_accounts: 'Management accounts',
  tax_return: 'Tax return',
  other: 'Other',
};

/**
 * Outcome of the Small Company system assessment (guide §9.1 Card E). Computed
 * from the §2(85) rule version, never entered:
 *   • `not_applicable` — not a company (§2(85) does not apply).
 *   • `pending`        — a deciding fact (paid-up capital / turnover) is absent
 *                        ("Information Insufficient").
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
export const SMALL_COMPANY_OUTCOMES: SmallCompanyOutcome[] = Object.values(SMALL_COMPANY_OUTCOME);

export const SMALL_COMPANY_OUTCOME_LABEL: Record<SmallCompanyOutcome, string> = {
  small: 'Small Company',
  not_small: 'Not a Small Company',
  not_applicable: 'Not applicable (not a company)',
  pending: 'Information Insufficient',
};

/** The SA triggers 02.1 carries forward to 02.8 and Planning (guide §9.1). */
export const SA_TRIGGER_CODE = {
  sa510: 'SA 510',
  sa402: 'SA 402',
  sa299: 'SA 299',
} as const;
export type SaTriggerCode = (typeof SA_TRIGGER_CODE)[keyof typeof SA_TRIGGER_CODE];

// ── Workspace (DHVAJ 02.1 web developer specification §2–§20) ────────────────

/** The cards of the 02.1 workspace (spec §4–§13). */
export const PROFILE_CARD = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  F: 'F',
  G: 'G',
  H: 'H',
  I: 'I',
  J: 'J',
} as const;
export type ProfileCardKey = (typeof PROFILE_CARD)[keyof typeof PROFILE_CARD];
export const PROFILE_CARDS: ProfileCardKey[] = Object.values(PROFILE_CARD);

export const PROFILE_CARD_TITLE: Record<ProfileCardKey, string> = {
  A: 'Basic Company Classification',
  B: 'Special Entity Classification',
  C: 'Group Structure',
  D: 'Applicability Financial Data',
  E: 'Small Company Assessment',
  F: 'Financial Year',
  G: 'Initial / Continuing Audit',
  H: 'Accounting Environment',
  I: 'Joint Audit',
  J: 'Information Completeness',
};

/**
 * Cards the Manager confirms one by one. D is confirmed figure by figure, G is
 * system-derived and J is system-calculated — none of those takes a "Confirm".
 * Card E is confirmed through its own Confirm Assessment / Override action.
 */
export const CONFIRMABLE_PROFILE_CARDS = ['A', 'B', 'C', 'E', 'F', 'H', 'I'] as const;
export type ConfirmableProfileCard = (typeof CONFIRMABLE_PROFILE_CARDS)[number];

/** A card's state on the workspace. */
export const PROFILE_CARD_STATUS = {
  /** System-populated, not yet confirmed by the Manager. */
  systemSuggested: 'system_suggested',
  /** A fact the card needs is missing or still "Information Pending". */
  incomplete: 'incomplete',
  confirmed: 'confirmed',
  /** Confirmed, but the facts changed since — or a source conflict is open. */
  attention: 'attention',
  /** Derived by the system; nothing to confirm (Cards D, G). */
  derived: 'derived',
} as const;
export type ProfileCardStatus = (typeof PROFILE_CARD_STATUS)[keyof typeof PROFILE_CARD_STATUS];

/** Yes / No / Information Pending (spec ERP-03). */
export const YES_NO_PENDING = { yes: 'yes', no: 'no', pending: 'pending' } as const;
export type YesNoPending = (typeof YES_NO_PENDING)[keyof typeof YES_NO_PENDING];
export const YES_NO_PENDING_VALUES: YesNoPending[] = Object.values(YES_NO_PENDING);

export type YesNo = 'yes' | 'no';
export const YES_NO_VALUES: YesNo[] = ['yes', 'no'];

/** Company type (spec ERP-02) — derived from the Entity Master, never stored locally. */
export const COMPANY_TYPE = {
  private: 'private',
  public: 'public',
  opc: 'opc',
  section8: 'section_8',
  government: 'government',
  other: 'other',
} as const;
export type CompanyType = (typeof COMPANY_TYPE)[keyof typeof COMPANY_TYPE];
export const COMPANY_TYPE_LABEL: Record<CompanyType, string> = {
  private: 'Private Company',
  public: 'Public Company',
  opc: 'One Person Company',
  section_8: 'Section 8 Company',
  government: 'Government Company',
  other: 'Other',
};

/** Regulator of an "other regulated entity" (spec Card B). */
export const REGULATOR = { rbi: 'rbi', sebi: 'sebi', irdai: 'irdai', other: 'other' } as const;
export type Regulator = (typeof REGULATOR)[keyof typeof REGULATOR];
export const REGULATORS: Regulator[] = Object.values(REGULATOR);
export const REGULATOR_LABEL: Record<Regulator, string> = {
  rbi: 'RBI',
  sebi: 'SEBI',
  irdai: 'IRDAI',
  other: 'Other',
};

/** Primary accounting software / ERP (spec ERP-AE-01). */
export const ACCOUNTING_SOFTWARE = {
  tally: 'tally',
  sap: 'sap',
  oracle: 'oracle',
  dynamics: 'dynamics',
  zoho: 'zoho',
  other: 'other',
} as const;
export type AccountingSoftware = (typeof ACCOUNTING_SOFTWARE)[keyof typeof ACCOUNTING_SOFTWARE];
export const ACCOUNTING_SOFTWARES: AccountingSoftware[] = Object.values(ACCOUNTING_SOFTWARE);
export const ACCOUNTING_SOFTWARE_LABEL: Record<AccountingSoftware, string> = {
  tally: 'Tally',
  sap: 'SAP',
  oracle: 'Oracle',
  dynamics: 'Microsoft Dynamics',
  zoho: 'Zoho',
  other: 'Other',
};

/** External service organisation for financial reporting (spec ERP-AE-03). */
export const SERVICE_ORG_ANSWER = {
  yes: 'yes',
  no: 'no',
  toBeAssessed: 'to_be_assessed',
} as const;
export type ServiceOrgAnswer = (typeof SERVICE_ORG_ANSWER)[keyof typeof SERVICE_ORG_ANSWER];
export const SERVICE_ORG_ANSWERS: ServiceOrgAnswer[] = Object.values(SERVICE_ORG_ANSWER);

/** One other joint auditor (spec ERP-JA-01). */
export interface JointAuditor {
  firmName: string;
  /** ICAI Firm Registration Number. */
  frn: string | null;
  contact: string | null;
}

/** Card J — the system-calculated completeness status (spec §13). */
export const COMPLETENESS_STATUS = {
  complete: 'complete',
  incomplete: 'information_incomplete',
  attention: 'attention_required',
} as const;
export type CompletenessStatus = (typeof COMPLETENESS_STATUS)[keyof typeof COMPLETENESS_STATUS];
export const COMPLETENESS_STATUS_LABEL: Record<CompletenessStatus, string> = {
  complete: 'Complete',
  information_incomplete: 'Information Incomplete',
  attention_required: 'Attention Required',
};

/** The statement the Manager accepts on CONFIRM PROFILE (spec §13). */
export const PROFILE_CONFIRMATION_STATEMENT =
  'I confirm that the above entity and regulatory profile is appropriate for determining the applicable audit framework.';

/**
 * Supporting-file slots (spec §7 Card D source documents, §9 approval evidence,
 * §11 service-organisation agreement/report, §12 work-allocation
 * documentation). `financial:<parameter>` holds a figure's source file.
 */
export const PROFILE_FILE_SLOT = {
  differentFy: 'different_fy',
  serviceOrg: 'service_org',
  jointAudit: 'joint_audit',
} as const;
export type ProfileFileSlot =
  | (typeof PROFILE_FILE_SLOT)[keyof typeof PROFILE_FILE_SLOT]
  | `financial:${ProfileFinancialParameter}`;

export function isProfileFileSlot(slot: string): slot is ProfileFileSlot {
  if ((Object.values(PROFILE_FILE_SLOT) as string[]).includes(slot)) return true;
  const m = /^financial:(.+)$/.exec(slot);
  return !!m && (PROFILE_FINANCIAL_PARAMETERS as string[]).includes(m[1]!);
}

/** The Section 02 sub-sections shown in the left navigation (spec §2). */
export const SECTION_02_NAV: Array<{ key: string; title: string }> = [
  { key: '02.1', title: 'Entity & Regulatory Profile' },
  { key: '02.2', title: 'Financial Reporting Framework' },
  { key: '02.3', title: 'Schedule III & Presentation' },
  { key: '02.4', title: 'CARO 2020' },
  { key: '02.5', title: 'Internal Financial Controls' },
  { key: '02.6', title: 'Consolidation / Group Audit' },
  { key: '02.7', title: 'Other Companies Act Requirements' },
  { key: '02.8', title: 'Standards on Auditing' },
  { key: '02.9', title: 'Auditor Reporting Framework' },
  { key: '02.10', title: 'Framework Summary & Approval' },
];

export const SECTION_NAV_STATUS = {
  notStarted: 'not_started',
  inProgress: 'in_progress',
  complete: 'complete',
  needsAttention: 'needs_attention',
} as const;
export type SectionNavStatus = (typeof SECTION_NAV_STATUS)[keyof typeof SECTION_NAV_STATUS];

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
  /** The statement the Manager accepted. */
  statement: string | null;
  note: string | null;
}

/** Who confirmed a card, and whether its facts changed since. */
export interface ProfileCardConfirmation {
  confirmedAt: string;
  confirmedByName: string | null;
  /** True when the facts the Manager confirmed have changed since (re-confirm). */
  stale: boolean;
}

export interface ProfileCardState {
  key: ProfileCardKey;
  title: string;
  status: ProfileCardStatus;
  confirmation: ProfileCardConfirmation | null;
}

/** One Card J item: a missing fact, a pending answer, an unconfirmed card or a conflict. */
export interface CompletenessItem {
  key: string;
  card: ProfileCardKey;
  label: string;
  kind: 'missing' | 'pending' | 'conflict' | 'unconfirmed';
  /** Blocks CONFIRM PROFILE (a downstream rule cannot be determined without it). */
  blocking: boolean;
  /** Where the fact is corrected, when it lives on the client master. */
  fix: MasterFactFix | null;
}

export interface ProfileCompleteness {
  status: CompletenessStatus;
  /** Share of the 02.1 completion criteria met (0–100). */
  percent: number;
  satisfied: number;
  total: number;
  items: CompletenessItem[];
}

/** Card A — listing (ERP-03). */
export interface ProfileListing {
  /** What the Entity Master shows (live listing lines or a listed status). */
  masterListed: boolean;
  masterInProcess: boolean;
  /** The Manager's answer; null = not yet answered (the master suggestion stands). */
  answer: YesNoPending | null;
  inProcess: YesNoPending | null;
  lines: Array<{ exchange: string; securityType: string; symbol: string | null }>;
}

/** Card C — the system-suggested group flags (from the relationships master). */
export interface ProfileGroupFlags {
  isHolding: boolean;
  isSubsidiary: boolean;
  isAssociate: boolean;
  isJointVenture: boolean;
  hasInvestees: boolean;
}

export interface ProfileGroupEntity {
  entity: string;
  relationship: string;
  interestPct: number | null;
  country: string | null;
  /** 'DHVAJ' when the firm audits that entity for the same year, else 'Other auditor'. */
  auditor: string;
}

/** Card D — one figure and where it came from. */
export interface ProfileFinancialValue {
  value: number | null;
  /** 'captured' = entered on 02.1; 'master' = linked financial data. */
  origin: 'captured' | 'master' | null;
  sourceLabel: string | null;
  asOf: string | null;
}

export interface ProfileFinancialRow {
  parameter: ProfileFinancialParameter;
  label: string;
  current: ProfileFinancialValue;
  prior: ProfileFinancialValue;
  /** The 02.1 capture (value, period, source type, preparer, date/time), if any. */
  captured: ProfileFinancialRecord | null;
  /** Set when the linked financial data changed after a figure was keyed over it. */
  conflict: string | null;
  /** Needed for the next applicability assessments (feeds Card J). */
  required: boolean;
}

/** Card E — the professional conclusion beside the system assessment. */
export interface SmallCompanyConclusion {
  systemOutcome: SmallCompanyOutcome;
  /** The outcome downstream engines use: the override when present, else the system result. */
  finalOutcome: SmallCompanyOutcome;
  override: {
    outcome: SmallCompanyOutcome;
    reason: string;
    systemOutcomeAtOverride: SmallCompanyOutcome | null;
    byName: string | null;
    at: string;
  } | null;
  /** The facts considered (spec §8) with their values. */
  factsConsidered: Array<{ label: string; value: string }>;
}

/** Card F — the audit period. */
export interface ProfilePeriod {
  from: string;
  to: string;
  /** The period is not the standard 1 April – 31 March (e.g. a first financial year). */
  nonStandard: boolean;
  firstFinancialYear: boolean;
  differentFyApproved: YesNo | null;
}

/** Card H — accounting environment answers. */
export interface ProfileAccountingEnvironment {
  software: AccountingSoftware | null;
  softwareOther: string | null;
  recordsElectronic: YesNo | null;
  recordsDescription: string | null;
  serviceOrg: ServiceOrgAnswer | null;
  serviceOrgService: string | null;
  serviceOrgProvider: string | null;
}

/** A file added or linked to a 02.1 field (spec §15). */
export interface ProfileFileRecord {
  id: string;
  slot: string;
  documentId: string;
  title: string;
  filename: string | null;
  linkedAt: string;
  linkedByName: string | null;
  /** The document has a live SharePoint copy (opened in Microsoft 365). */
  inSharePoint: boolean;
}

/** A tracked fact compared with last year's 02.1 (spec §14). */
export interface ProfilePriorYearChange {
  field: string;
  label: string;
  prior: string | null;
  current: string | null;
  changed: boolean;
}

export interface ProfileSectionNavItem {
  key: string;
  title: string;
  status: SectionNavStatus;
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
  /** The reusable financial-data block (Card D) — the captured figures. */
  financials: ProfileFinancialRecord[];
  /**
   * Facts read from the entity master for this profile (Cards A/C/D), each
   * with its source — shown prefilled so the team confirms rather than keys.
   */
  masterFacts: MasterFact[];
  /** The computed Small Company assessment (Card E). */
  smallCompany: SmallCompanyAssessment;
  /** SA 510 / 402 / 299 carried forward (guide §9.1). */
  saTriggers: SaTrigger[];
  /** Confirmation record, or null while the profile is a draft. */
  confirmation: ProfileConfirmation | null;
  /** Set by a downstream change-impact trigger; does not rewrite the snapshot. */
  needsReevaluation: boolean;
  /** Blocking facts CONFIRM PROFILE still needs (empty ⇒ ready). */
  missingFacts: string[];
  /** For each missing fact (same order), the client-master form that supplies it. */
  missingFactFixes: Array<MasterFactFix | null>;
  /** True when no blocking item remains (Card J). */
  readyToConfirm: boolean;
  /** Header (spec §2): who manages and who last prepared the profile. */
  header: {
    managerName: string | null;
    partnerName: string | null;
    lastUpdatedByName: string | null;
    lastUpdatedAt: string | null;
  };
  /** Card A — company type derived from the Entity Master (ERP-02). */
  companyType: CompanyType | null;
  listing: ProfileListing;
  /** Card B — what the client master suggests, beside what the profile holds. */
  specialEntitySuggested: SpecialEntityType[];
  nbfcCategory: string | null;
  regulator: Regulator | null;
  regulatorName: string | null;
  regulatorDetails: string | null;
  /** Card C. */
  groupFlags: ProfileGroupFlags;
  groupEntities: ProfileGroupEntity[];
  /** Card D — all seven parameters, current and prior FY. */
  financialRows: ProfileFinancialRow[];
  /** Card E — professional conclusion (confirm / override) beside the system result. */
  smallCompanyConclusion: SmallCompanyConclusion;
  /** Card F. */
  period: ProfilePeriod;
  /** Card H. */
  accounting: ProfileAccountingEnvironment;
  /** Card I. */
  jointAuditors: JointAuditor[];
  /** Per-card status + confirmation. */
  cards: ProfileCardState[];
  /** Card J. */
  completeness: ProfileCompleteness;
  /** Provision / standard links for this engagement period (spec §3, §19). */
  references: AuthorityReference[];
  files: ProfileFileRecord[];
  /** Last year's 02.1 beside this year's, for a continuing audit (spec §14). */
  priorYear: { financialYear: string; changes: ProfilePriorYearChange[] } | null;
  /** Left navigation 02.1–02.10 (spec §2). */
  sectionNav: ProfileSectionNavItem[];
  /** The last controlled reopen of a confirmed profile. */
  reopen: { reason: string; at: string; byName: string | null } | null;
  version: number;
}

// ── Input shapes ─────────────────────────────────────────────────────────────

/** Update the professional facts captured on the profile (Save Draft). */
export interface UpdateEntityProfileInput {
  specialEntityTypes?: SpecialEntityType[];
  initialAudit?: boolean;
  jointAudit?: boolean;
  accountingEnvironment?: AccountingEnvironment | null;
  listingAnswer?: YesNoPending | null;
  listingInProcess?: YesNoPending | null;
  nbfcCategory?: string | null;
  regulator?: Regulator | null;
  regulatorName?: string | null;
  regulatorDetails?: string | null;
  differentFyApproved?: YesNo | null;
  accountingSoftware?: AccountingSoftware | null;
  accountingSoftwareOther?: string | null;
  recordsElectronic?: YesNo | null;
  recordsDescription?: string | null;
  serviceOrg?: ServiceOrgAnswer | null;
  serviceOrgService?: string | null;
  serviceOrgProvider?: string | null;
  jointAuditors?: Array<Pick<JointAuditor, 'firmName'> & Partial<Omit<JointAuditor, 'firmName'>>>;
  version: number;
}

/** Confirm one card's facts (spec: "Show Confirm"). */
export interface ConfirmProfileCardInput {
  card: ConfirmableProfileCard;
  version: number;
}

/** Card E professional action (spec §8). */
export interface SmallCompanyDecisionInput {
  action: 'confirm' | 'override' | 'clear_override';
  /** Required for `override`. */
  outcome?: 'small' | 'not_small';
  /** Mandatory for `override`. */
  reason?: string;
  version: number;
}

/** Controlled reopen of a confirmed profile. */
export interface ReopenProfileInput {
  reason: string;
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
  /** The Manager accepts {@link PROFILE_CONFIRMATION_STATEMENT}. */
  acknowledged: boolean;
}

/** Add a new file to a 02.1 field (stored in the engagement workspace). */
export interface AddProfileFileInput {
  slot: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
  title?: string;
}

/** Link an existing engagement document to a 02.1 field (never copied). */
export interface LinkProfileFileInput {
  slot: string;
  documentId: string;
}

/** Result of filling the special-entity matrix from the client master. */
export interface StatutoryAuditEntityProfileMasterFillResult {
  profile: StatutoryAuditEntityProfile;
  /** The special entity types added (empty when the master had nothing new). */
  filled: string[];
}
