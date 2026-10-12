/**
 * Engagement Restructure vocabulary (spec "Engagement Restructure, GST
 * Workspace & Compliance Calendar") shared by the API, web and — through the
 * regenerated OpenAPI spec — the Dhvaj mobile app.
 *
 * Every engagement has a KIND. A Compliance engagement is one standing
 * engagement per entity, made of six STREAMS, with its years in scope on
 * compliance_engagement_years. Every row in a stream tab is a compliance
 * instance carrying a FILING_STATUS and, for GST, a PERIOD_SECTION.
 */

/** What kind of engagement this is (engagements.kind). */
export const ENGAGEMENT_KIND = {
  statutoryAudit: 'statutory_audit',
  compliance: 'compliance',
  /** One-off work (certification, due diligence, valuation, advisory, …). */
  assignment: 'assignment',
} as const;
export type EngagementKind = (typeof ENGAGEMENT_KIND)[keyof typeof ENGAGEMENT_KIND];
export const ENGAGEMENT_KINDS: EngagementKind[] = Object.values(ENGAGEMENT_KIND);

/** Engagement code prefix per kind (SA/00123, CR/00123, AS/00123). */
export const ENGAGEMENT_KIND_CODE_PREFIX: Record<EngagementKind, string> = {
  statutory_audit: 'SA',
  compliance: 'CR',
  assignment: 'AS',
};

export const ENGAGEMENT_KIND_LABEL: Record<EngagementKind, string> = {
  statutory_audit: 'Statutory Audit',
  compliance: 'Compliance',
  assignment: 'Other assignment',
};

/** The six compliance streams (services.stream, rule version stream). */
export const STREAM = {
  gst: 'gst',
  tds: 'tds',
  incomeTax: 'income_tax',
  roc: 'roc',
  bookkeeping: 'bookkeeping',
  mis: 'mis',
} as const;
export type Stream = (typeof STREAM)[keyof typeof STREAM];
/** In tab order (spec Change 3: MIS, Bookkeeping, GST, TDS, Income Tax, ROC). */
export const STREAMS: Stream[] = ['mis', 'bookkeeping', 'gst', 'tds', 'income_tax', 'roc'];

export const STREAM_LABEL: Record<Stream, string> = {
  gst: 'GST',
  tds: 'TDS / TCS',
  income_tax: 'Income Tax',
  roc: 'ROC / MCA',
  bookkeeping: 'Bookkeeping',
  mis: 'MIS',
};

/** The live catalogue service for each stream. */
export const STREAM_SERVICE_CODE: Record<Stream, string> = {
  gst: 'STREAM_GST',
  tds: 'STREAM_TDS',
  income_tax: 'STREAM_INCOME_TAX',
  roc: 'STREAM_ROC',
  bookkeeping: 'STREAM_BOOKKEEPING',
  mis: 'STREAM_MIS',
};

/** What a stream runs on (one set of instances per registration). */
export const REGISTRATION_SCOPE = {
  gstin: 'gstin',
  tan: 'tan',
  pan: 'pan',
  cin: 'cin',
  llpin: 'llpin',
  /** The entity as a whole (Bookkeeping, MIS). */
  entity: 'entity',
  /** Per director (DIR-3 KYC) — instances keyed by DIN on the CIN. */
  din: 'din',
} as const;
export type RegistrationScope = (typeof REGISTRATION_SCOPE)[keyof typeof REGISTRATION_SCOPE];
export const REGISTRATION_SCOPES: RegistrationScope[] = Object.values(REGISTRATION_SCOPE);

/** The registration types each stream runs on (entity_registrations.registration_type,
 *  or 'pan' / 'entity' for the entity itself). */
export const STREAM_REGISTRATION_TYPES: Record<Stream, readonly string[]> = {
  gst: ['gstin'],
  tds: ['tan'],
  income_tax: ['pan'],
  roc: ['cin', 'llpin'],
  bookkeeping: ['entity'],
  mis: ['entity'],
};

/** Workflow status of every filing item, shared by GST, TDS, Income Tax and ROC
 *  (compliance_instances.workflow_status). "Filed late" is not a status — it is
 *  shown whenever the filing date is after the statutory date (as extended). */
export const FILING_STATUS = {
  notStarted: 'not_started',
  awaitingData: 'awaiting_data',
  inPreparation: 'in_preparation',
  inReview: 'in_review',
  readyToFile: 'ready_to_file',
  filed: 'filed',
  notApplicable: 'not_applicable',
} as const;
export type FilingStatus = (typeof FILING_STATUS)[keyof typeof FILING_STATUS];
export const FILING_STATUSES: FilingStatus[] = Object.values(FILING_STATUS);

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  not_started: 'Not started',
  awaiting_data: 'Awaiting data',
  in_preparation: 'In preparation',
  in_review: 'In review',
  ready_to_file: 'Ready to file',
  filed: 'Filed',
  not_applicable: 'Not applicable',
};

/** GST month workspace sections; 'annual' hangs off the year (GSTR-9, 9C, ITC-04, …). */
export const PERIOD_SECTION = {
  outward: 'outward',
  inward: 'inward',
  summary: 'summary',
  annual: 'annual',
} as const;
export type PeriodSection = (typeof PERIOD_SECTION)[keyof typeof PERIOD_SECTION];
export const PERIOD_SECTIONS: PeriodSection[] = Object.values(PERIOD_SECTION);

/** How often a rule recurs (compliance_rule_versions.frequency). */
export const RULE_FREQUENCY = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  halfYearly: 'half_yearly',
  annual: 'annual',
  /** Once every three financial years (DIR-3 KYC per DIN). */
  triennial: 'triennial',
  /** Created when a manager records the event. */
  event: 'event',
  /** Created by hand (belated / revised ITR). */
  onDemand: 'on_demand',
} as const;
export type RuleFrequency = (typeof RULE_FREQUENCY)[keyof typeof RULE_FREQUENCY];
export const RULE_FREQUENCIES: RuleFrequency[] = Object.values(RULE_FREQUENCY);

/** A rule the sheet marks "Verify" shows a badge until a partner confirms it. */
export const RULE_VERIFICATION = { verified: 'verified', verify: 'verify' } as const;
export type RuleVerification = (typeof RULE_VERIFICATION)[keyof typeof RULE_VERIFICATION];

/** GST filing scheme of a GSTIN (registration_compliance_profiles.gst_scheme). */
export const GST_SCHEME = {
  regular: 'regular',
  qrmp: 'qrmp',
  composition: 'composition',
  isd: 'isd',
  gstTds: 'gst_tds',
  ecoTcs: 'eco_tcs',
  nrtp: 'nrtp',
  oidar: 'oidar',
  uin: 'uin',
} as const;
export type GstScheme = (typeof GST_SCHEME)[keyof typeof GST_SCHEME];
export const GST_SCHEMES: GstScheme[] = Object.values(GST_SCHEME);

export const GST_SCHEME_LABEL: Record<GstScheme, string> = {
  regular: 'Regular',
  qrmp: 'QRMP',
  composition: 'Composition',
  isd: 'Input Service Distributor',
  gst_tds: 'GST TDS deductor',
  eco_tcs: 'E-commerce operator (TCS)',
  nrtp: 'Non-resident taxable person',
  oidar: 'OIDAR',
  uin: 'UIN holder',
};

/** QRMP GSTR-3B due-date category, by the GSTIN's state (22nd / 24th). */
export const QRMP_CATEGORY = { x: 'X', y: 'Y' } as const;
export type QrmpCategory = (typeof QRMP_CATEGORY)[keyof typeof QRMP_CATEGORY];

/**
 * GST state codes in QRMP Category X (GSTR-3B due on the 22nd) — the rest are
 * Category Y (24th). Category X: Chhattisgarh, MP, Gujarat, Maharashtra,
 * Karnataka, Goa, Kerala, Tamil Nadu, Telangana, Andhra Pradesh and the UTs of
 * Daman & Diu / DNH, Puducherry, Andaman & Nicobar, Lakshadweep.
 */
export const QRMP_CATEGORY_X_STATE_CODES: readonly string[] = [
  '22', '23', '24', '25', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37',
];

/** Derive the QRMP category from a GSTIN's first two digits (state code). */
export function qrmpCategoryForGstin(gstinOrStateCode: string): QrmpCategory {
  const code = gstinOrStateCode.slice(0, 2);
  return QRMP_CATEGORY_X_STATE_CODES.includes(code) ? 'X' : 'Y';
}

/** Company sub-type on a CIN profile (drives AGM / AOC-4 / PAS-6 / board meetings). */
export const COMPANY_SUBTYPE = {
  private: 'private',
  unlistedPublic: 'unlisted_public',
  listed: 'listed',
  opc: 'opc',
  small: 'small',
} as const;
export type CompanySubtype = (typeof COMPANY_SUBTYPE)[keyof typeof COMPANY_SUBTYPE];
export const COMPANY_SUBTYPES: CompanySubtype[] = Object.values(COMPANY_SUBTYPE);

/**
 * Profile attributes per scope (registration_compliance_profiles.attributes),
 * validated by the API. Every key is optional; a rule whose condition tests a
 * key the profile lacks treats it as false / not applicable.
 */
export interface GstinProfileAttributes {
  eInvoicing?: boolean;
  exporter?: boolean;
  jobWork?: boolean;
  importer?: boolean;
  /** Annual turnover band for GSTR-9 (> ₹2 cr) and 9C (> ₹5 cr), in rupees. */
  annualTurnover?: number;
  optingCompositionNextFy?: boolean;
  /** Send the client the monthly data request on the 1st. */
  monthlyDataRequest?: boolean;
}
export interface TanProfileAttributes {
  employer?: boolean;
  paysNonResidents?: boolean;
  tcsCollector?: boolean;
  /** Buyer / tenant deducting under s.194-IA/IB/M, not under audit (Form 141). */
  propertyOrRentDeductor?: boolean;
}
export interface PanProfileAttributes {
  auditCase?: boolean;
  tpTransactions?: boolean;
  advanceTaxLiable?: boolean;
  trustOrInstitution?: boolean;
}
export interface CompanyDirector {
  din: string;
  name: string;
  /** FY in which the director's current three-year KYC cycle starts ('2025-26'). */
  kycCycleStartFy: string;
}
export interface CinProfileAttributes {
  companySubtype?: CompanySubtype;
  msmeDuesOver45Days?: boolean;
  depositsOrExemptedLoans?: boolean;
  auditorAppointedAtAgm?: boolean;
  directors?: CompanyDirector[];
}
export type LlpinProfileAttributes = Record<string, never>;

export const PROFILE_SCOPE = {
  gstin: 'gstin',
  tan: 'tan',
  pan: 'pan',
  cin: 'cin',
  llpin: 'llpin',
} as const;
export type ProfileScope = (typeof PROFILE_SCOPE)[keyof typeof PROFILE_SCOPE];
export const PROFILE_SCOPES: ProfileScope[] = Object.values(PROFILE_SCOPE);

/** Independence / conflict rules (spec Change 1). */
export const INDEPENDENCE_RULE = {
  /** s.144: no Bookkeeping / MIS / internal audit for a company we audit. */
  s144Prohibited: 'S144_PROHIBITED_SERVICE',
  /** s.144 reverse: no audit while Bookkeeping / MIS is in scope. */
  s144Reverse: 'S144_AUDIT_WITH_PROHIBITED_SERVICE',
  /** s.144 permitted non-audit services — record the approval ref. */
  s144Permitted: 'S144_PERMITTED_SERVICE_APPROVAL',
  /** 44AB tax audit by the firm that keeps the books. */
  taxAuditBookkeeper: 'TAX_AUDIT_BY_BOOKKEEPER',
  /** Statutory audit of a non-company entity — partner acknowledges. */
  nonCompanyAudit: 'NON_COMPANY_AUDIT_ACK',
} as const;
export type IndependenceRule = (typeof INDEPENDENCE_RULE)[keyof typeof INDEPENDENCE_RULE];

export const INDEPENDENCE_OUTCOME = { pass: 'pass', warn: 'warn', block: 'block' } as const;
export type IndependenceOutcome = (typeof INDEPENDENCE_OUTCOME)[keyof typeof INDEPENDENCE_OUTCOME];

export interface IndependenceFinding {
  rule: IndependenceRule;
  outcome: IndependenceOutcome;
  message: string;
  financialYear?: string | null;
  /** Warnings that need a partner acknowledgement before submit. */
  requiresAcknowledgement?: boolean;
}

/** Feature flags — each phase ships behind its own flag (GET /meta/features). */
export const FEATURE_FLAG = {
  engagementKinds: 'ff_engagement_kinds',
  calendarV2: 'ff_calendar_v2',
  gstTab: 'ff_gst_tab',
  complianceTabs: 'ff_compliance_tabs',
  autoTime: 'ff_auto_time',
} as const;
export type FeatureFlag = (typeof FEATURE_FLAG)[keyof typeof FEATURE_FLAG];
export const FEATURE_FLAGS: FeatureFlag[] = Object.values(FEATURE_FLAG);

export interface FeatureFlagsResponse {
  flags: Record<FeatureFlag, boolean>;
}

/** Years in scope on a Compliance engagement (compliance_engagement_years). */
export interface ComplianceEngagementYear {
  id: string;
  engagementId: string;
  financialYear: string;
  streams: Stream[];
  /** {stream: registration ids} */
  streamRegistrations: Partial<Record<Stream, string[]>>;
  feeAmount: number | null;
  billingModel: string | null;
  budgetHours: Partial<Record<Stream, number>>;
  engagementLetterRef: string | null;
  engagementLetterDate: string | null;
  s144ApprovalRef: string | null;
  status: 'open' | 'closed';
  closedAt: string | null;
  version: number;
  /** Server-computed: true when the company has a statutory audit with us for
   *  an overlapping FY and s144ApprovalRef is empty (spec: warn). */
  s144ApprovalMissing?: boolean;
}

/**
 * period_key formats on compliance_instances (generator v2):
 *   month       'YYYY-MM'            (calendar month, e.g. '2026-10')
 *   quarter     'YYYY-YY:Q1'..':Q4'  (FY quarter)
 *   half-year   'YYYY-YY:H1' / ':H2'
 *   year        'YYYY-YY'
 *   triennial   'YYYY-YY:DIN:<din>'  (per director)
 *   event       'EVT:<compliance_event id>'
 */
export type PeriodKey = string;
