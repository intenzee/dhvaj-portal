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
import type { WorkItemRef } from './work-links';

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
  /** Halves of the calendar year, Jul–Dec and Jan–Jun (s.173(5) board meetings of a small company / OPC). */
  calendarHalfYearly: 'calendar_half_yearly',
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
  /** Accounts audited under any law (ITR due 31 Oct). Default: company, or under tax audit. */
  auditCase?: boolean;
  /** s.44AB tax audit (Form 3CA/3CB-3CD). Default: turnover over ₹1 crore. */
  taxAudit?: boolean;
  tpTransactions?: boolean;
  advanceTaxLiable?: boolean;
  trustOrInstitution?: boolean;
}
export interface CompanyDirector {
  din: string;
  name: string;
  /** FY in which the director's current three-year KYC cycle starts ('2025-26'). */
  kycCycleStartFy: string;
  /** The director's DSC expires on this date (YYYY-MM-DD); due ROC items warn before it lapses. */
  dscExpiresOn?: string;
}
export interface CinProfileAttributes {
  companySubtype?: CompanySubtype;
  msmeDuesOver45Days?: boolean;
  /** DPT-3: unknown keeps the item (many firms file nil); only false drops it. */
  depositsOrExemptedLoans?: boolean;
  /** Retired (spec G5): ADT-1 now follows the AGM event's "auditor appointed" flag. Still read
   *  so old profiles validate; the card no longer offers it. */
  auditorAppointedAtAgm?: boolean;
  /** AOC-4 filed in XBRL. Default from the thresholds in roc-mca.ts when capital / turnover are known. */
  xbrlRequired?: boolean;
  /** Consolidated statements (AOC-4 CFS) are filed with the AOC-4. */
  hasSubsidiaries?: boolean;
  /** MGT-8 certificate by a CS in practice on the annual return. */
  mgt8Required?: boolean;
  /** CSR annual report on the AOC-4 (s.135). */
  csrApplicable?: boolean;
  /** Secretarial audit report MR-3 on the AOC-4 (s.204). */
  secretarialAuditRequired?: boolean;
  /** Paid-up share capital in rupees (small-company test, XBRL / MGT-8 thresholds). */
  paidUpCapital?: number;
  /** Authorised (nominal) share capital in rupees (ROC normal-fee table). */
  authorisedCapital?: number;
  /** Turnover of the last FY in rupees; else the client's annual turnover. */
  turnover?: number;
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
  /** Staff Workflow Phase 1: rows open the exact work, review queue, trimmed sidebar. */
  workLinks: 'ff_work_links',
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
 *   cal. half   'YYYY-YY:CH2' (Jul–Dec of the FY start year) / ':CH1' (Jan–Jun after it)
 *   year        'YYYY-YY'
 *   triennial   'YYYY-YY:DIN:<din>'  (per director)
 *   event       'EVT:<compliance_event id>'
 */
export type PeriodKey = string;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Jul–Dec 2026' for '2026-27' CH2; 'Jan–Jun 2027' for CH1. */
export function calendarHalfLabel(financialYear: string, half: 'CH1' | 'CH2'): string {
  const start = Number(financialYear.slice(0, 4));
  return half === 'CH2' ? `Jul–Dec ${start}` : `Jan–Jun ${start + 1}`;
}

/** Human label for a period_key: 'Oct 2026', 'Q3 2026-27', 'FY 2026-27 · DIN 01234567'. */
export function periodKeyLabel(periodKey: string | null | undefined): string {
  if (!periodKey) return '—';
  if (periodKey.startsWith('EVT:')) return 'Event';
  const month = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const [fy, part, din] = periodKey.split(':');
  if (part === 'DIN') return `FY ${fy} · DIN ${din}`;
  if (fy && (part === 'CH1' || part === 'CH2')) return calendarHalfLabel(fy, part);
  if (part) return `${part} ${fy}`;
  return `FY ${fy}`;
}

// ── Calendar v2 (spec Change 4) ─────────────────────────────────────────────

/** Sheet colours: red ≤ 7 days or overdue, amber ≤ 30, grey when filed / not applicable. */
export type DueBand = 'red' | 'amber' | 'none' | 'grey';

/** One row of the firm calendar (GET /compliance/calendar). */
export interface ComplianceCalendarRow {
  id: string;
  engagementId: string;
  engagementCode: string;
  entityId: string;
  entityName: string;
  officeCode: string;
  stream: Stream | null;
  ruleCode: string;
  ruleName: string;
  formLabel: string | null;
  registrationId: string | null;
  registrationType: string | null;
  registrationNumber: string | null;
  financialYear: string | null;
  periodKey: string | null;
  periodLabel: string;
  /** Operative statutory date (override → extension → computed). */
  dueDate: string;
  /** The computed date when an extension / override moved it. */
  originalDueDate: string | null;
  extensionReference: string | null;
  internalDate: string;
  workflowStatus: FilingStatus;
  daysLeft: number;
  band: DueBand;
  isProvisional: boolean;
  isOptional: boolean;
  /** Rule marked "Verify" on the sheet and not yet confirmed by a partner. */
  needsVerification: boolean;
  profileChanged: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  partnerName: string | null;
  managerName: string | null;
  /** The filing's part of its period (GST: outward / inward / summary / annual). */
  section: PeriodSection | null;
  /** Where the row opens (WF-102): the filing in its stream tab. */
  link: WorkItemRef;
}

export interface ComplianceCalendarResponse {
  items: ComplianceCalendarRow[];
  total: number;
  from: string;
  to: string;
}

/** A client registration a stream can run on (via hsdg.entity_compliance_registrations). */
export interface EntityRegistrationOption {
  id: string;
  registrationType: string;
  registrationNumber: string;
  stateCode: string | null;
  status: string;
  isPrincipal: boolean;
}

/** One effective-dated compliance profile row. */
export interface ComplianceProfileRecord {
  id: string;
  entityId: string;
  registrationId: string | null;
  scope: ProfileScope;
  effectiveFrom: string;
  effectiveTo: string | null;
  gstScheme: GstScheme | null;
  qrmpCategory: QrmpCategory | null;
  attributes: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface EntityComplianceProfiles {
  entityId: string;
  /** The client's entity type ('private_limited', 'opc', …): the CIN sub-type defaults from it. */
  entityTypeSlug?: string | null;
  /** The client's annual turnover in rupees, when on record (G12 small-company test). */
  annualTurnover?: number | null;
  registrations: EntityRegistrationOption[];
  profiles: ComplianceProfileRecord[];
}

export interface SaveComplianceProfileInput {
  scope: ProfileScope;
  /** Required for every scope but 'pan'. */
  registrationId?: string | null;
  effectiveFrom: string;
  gstScheme?: GstScheme | null;
  qrmpCategory?: QrmpCategory | null;
  attributes?: Record<string, unknown>;
}

export interface SaveComplianceProfileResult {
  profile: ComplianceProfileRecord;
  /** Instances regenerated in the client's open Compliance engagements. */
  regenerated: { engagementId: string; created: number; moved: number; flagged: number; notApplicable: number }[];
}

/** Event types a manager can record (REG-01, DIR-12, the AGM, …). */
export const COMPLIANCE_EVENT_TYPE = {
  agm: 'agm',
  agmExtension: 'agm_extension',
  incorporation: 'incorporation',
  firstFyEnd: 'first_fy_end',
  firstAuditorAppointment: 'first_auditor_appointment',
  directorChange: 'director_change',
  allotment: 'allotment',
  registeredOfficeChange: 'registered_office_change',
  resolution: 'resolution',
  chargeCreation: 'charge_creation',
  capitalAlteration: 'capital_alteration',
  gstLiability: 'gst_liability',
  gstCancellation: 'gst_cancellation',
  firstDeductionMonthEnd: 'first_deduction_month_end',
  tdsMonthEnd: 'tds_month_end',
} as const;
export type ComplianceEventType = (typeof COMPLIANCE_EVENT_TYPE)[keyof typeof COMPLIANCE_EVENT_TYPE];
export const COMPLIANCE_EVENT_TYPES: ComplianceEventType[] = Object.values(COMPLIANCE_EVENT_TYPE);

export const COMPLIANCE_EVENT_TYPE_LABEL: Record<ComplianceEventType, string> = {
  agm: 'AGM held',
  agm_extension: 'AGM extended (ROC approval)',
  incorporation: 'Incorporation',
  first_fy_end: 'End of first financial year',
  first_auditor_appointment: 'First auditor appointed',
  director_change: 'Director appointed / ceased',
  allotment: 'Shares allotted',
  registered_office_change: 'Registered office changed',
  resolution: 'Resolution passed (MGT-14)',
  charge_creation: 'Charge created / modified',
  capital_alteration: 'Share capital altered',
  gst_liability: 'Became liable to GST registration',
  gst_cancellation: 'GST registration cancelled',
  first_deduction_month_end: 'First TDS deduction (month end)',
  tds_month_end: 'Property / rent TDS deducted (month end)',
};

/** The events recorded from the ROC tab (spec roc-mca §6–§7). */
export const ROC_EVENT_TYPES: ComplianceEventType[] = [
  'agm',
  'agm_extension',
  'incorporation',
  'first_fy_end',
  'first_auditor_appointment',
  'director_change',
  'allotment',
  'registered_office_change',
  'resolution',
  'charge_creation',
  'capital_alteration',
];

/**
 * Event facts (spec roc-mca §6.2). The rules read them as
 * `<event_type>_<snake_case key>` (agm.auditorAppointed → agm_auditor_appointed).
 */
export interface AgmEventDetails {
  /** The auditor was appointed or re-appointed at this AGM → ADT-1. */
  auditorAppointed?: boolean;
}
export interface AgmExtensionEventDetails {
  /** Months the ROC extended the AGM by (1–3; never the first AGM). */
  months: number;
  approvalRef?: string;
}
export interface AllotmentEventDetails {
  /** Private placement (s.42) → PAS-3 in 15 days, else 30. */
  privatePlacement?: boolean;
}
export interface DirectorChangeEventDetails {
  din: string;
  name?: string;
  change: 'appointed' | 'ceased';
}
export interface ChargeEventDetails {
  chargeHolder?: string;
  amount?: number;
}
export type ComplianceEventDetails =
  | AgmEventDetails
  | AgmExtensionEventDetails
  | AllotmentEventDetails
  | DirectorChangeEventDetails
  | ChargeEventDetails
  | Record<string, never>;

/** What recording / correcting / voiding an event changed on the calendar. */
export interface ComplianceEventChanges {
  created: { instanceId: string; label: string; dueDate: string }[];
  moved: { instanceId: string; label: string; from: string; to: string }[];
  /** Started items whose dates no longer match ("Profile changed — check"). */
  flagged: { instanceId: string; label: string }[];
  notApplicable: { instanceId: string; label: string }[];
}

/** An item an event created or dated. */
export interface ComplianceEventItem {
  instanceId: string;
  label: string;
  dueDate: string;
  workflowStatus: string;
}

export interface ComplianceEventRecord {
  id: string;
  engagementId: string;
  registrationId: string | null;
  registrationNumber?: string | null;
  eventType: string;
  financialYear: string | null;
  eventDate: string;
  notes: string | null;
  details: Record<string, unknown>;
  recordedByName: string | null;
  createdAt: string;
  updatedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /** The AGM item whose "Record meeting" created this event. */
  sourceInstanceId: string | null;
  /** Items this event created or dates (DIR-12, or AOC-4 / MGT-7 / ADT-1 from the AGM). */
  items?: ComplianceEventItem[];
}

export interface RecordComplianceEventInput {
  eventType: ComplianceEventType;
  eventDate: string;
  registrationId?: string | null;
  /** Defaults to the FY of the event date (the previous FY for an AGM). */
  financialYear?: string;
  notes?: string;
  details?: Record<string, unknown>;
}

export interface CorrectComplianceEventInput {
  eventDate?: string;
  financialYear?: string;
  notes?: string | null;
  details?: Record<string, unknown>;
  /** Why the event is being corrected. */
  reason: string;
}

export interface RecordComplianceEventResult {
  event: ComplianceEventRecord;
  /** Event-triggered instances created (DIR-12, PAS-3, …). */
  created: number;
  /** AGM-linked items moved from the provisional date. */
  moved: number;
  changes: ComplianceEventChanges;
}

/** Board meeting cadence for one CIN (spec roc-mca §5.2, P2-6). */
export interface BoardMeetingCadence {
  registrationId: string;
  registrationNumber: string;
  lastHeldOn: string | null;
  /** Latest date for the next meeting (last + 120 days); null before any is held. */
  dueBy: string | null;
  /** Small company / OPC: not before last + 90 days, one in each calendar half. */
  notBefore: string | null;
  rule: 'every_120_days' | 'calendar_half';
}

/** The ROC tab's header facts (spec roc-mca P1-10 / G13, P2-6). */
export interface RocOverview {
  /** CIN / LLPIN registrations on the client. */
  registrations: { id: string; type: 'cin' | 'llpin'; number: string }[];
  /** Why the tab is empty, when it is (no CIN / LLPIN, or not an MCA entity). */
  message: string | null;
  boardMeetings: BoardMeetingCadence[];
}

/** Rules that close as a meeting (held-on date, minutes) instead of a filing (SRN). */
export const ROC_MEETING_RULES = [
  'ROC_AGM',
  'ROC_BOARD_MEETING',
  'ROC_FIRST_BOARD',
  'ROC_FIRST_AGM',
] as const;
export function isMeetingRule(ruleCode: string | null | undefined): boolean {
  return !!ruleCode && (ROC_MEETING_RULES as readonly string[]).includes(ruleCode);
}

export interface GenerateCalendarResult {
  created: number;
  moved: number;
  flagged: number;
  notApplicable: number;
}

// ── Change 1: creating and scoping engagements by kind ─────────────────────

/** One stream as the new-engagement wizard offers it (GET /streams). */
export interface StreamCatalogueEntry {
  stream: Stream;
  label: string;
  /** The live STREAM_* catalogue service the stream's line carries. */
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  /** What it runs on: registration types, or 'pan' / 'entity'. */
  registrationTypes: readonly string[];
}

/** A year in scope, as given when creating or adding it. */
export interface ComplianceYearInput {
  financialYear: string;
  feeAmount?: number | null;
  billingModel?: string | null;
  budgetHours?: Partial<Record<Stream, number>>;
  engagementLetterRef?: string | null;
  engagementLetterDate?: string | null;
  s144ApprovalRef?: string | null;
}

/** POST /engagements/:id/years — add a year (and its streams) to the scope. */
export interface AddComplianceYearInput extends ComplianceYearInput {
  /** Defaults to the streams of the latest year in scope. */
  streams?: Stream[];
  /** Defaults to the latest year's registrations per stream. */
  streamRegistrations?: Partial<Record<Stream, string[]>>;
  acknowledgedIndependenceRules?: IndependenceRule[];
}

/** PATCH /engagements/:id/years/:fy */
export interface UpdateComplianceYearInput extends Omit<ComplianceYearInput, 'financialYear'> {
  status?: 'open' | 'closed';
  version: number;
}

/** PATCH /engagements/:id/years/:fy/streams — add or end streams for a year. */
export interface UpdateYearStreamsInput {
  add?: Stream[];
  end?: Stream[];
  /** Registrations per stream (replaces the stream's list when given). */
  streamRegistrations?: Partial<Record<Stream, string[]>>;
  /** Lead for a newly added stream's line. */
  streamLeads?: Partial<Record<Stream, string>>;
  acknowledgedIndependenceRules?: IndependenceRule[];
  version: number;
}

/** POST /engagements/independence-check — preview the rules before submit. */
export interface IndependenceCheckInput {
  entityId: string;
  kind: EngagementKind;
  financialYears: string[];
  streams?: Stream[];
  /** Assignment: the service it carries. */
  serviceId?: string;
  s144ApprovalRef?: string | null;
  /** Adding to an existing engagement (its own facts are no conflict). */
  engagementId?: string;
}

export interface IndependenceCheckResult {
  isCompany: boolean;
  findings: IndependenceFinding[];
  /** The first hard block, if any (submit returns 409 with its rule). */
  block: IndependenceFinding | null;
  /** The client's open Compliance engagement — "Add a year / stream to CR/…". */
  openComplianceEngagement: { id: string; engagementCode: string } | null;
}

/** Body of the 409 a blocked create / add-year / add-stream returns. */
export interface IndependenceBlockedError {
  statusCode: 409;
  message: string;
  rule: IndependenceRule | 'COMPLIANCE_ENGAGEMENT_EXISTS' | 'ACKNOWLEDGEMENT_REQUIRED';
  findings?: IndependenceFinding[];
  /** For COMPLIANCE_ENGAGEMENT_EXISTS: the engagement to open instead. */
  engagementId?: string;
  engagementCode?: string;
}
