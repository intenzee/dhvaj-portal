/** Entity (client) vocabulary shared by the API and web. */

export const ENTITY_STATUS = {
  draft: 'draft',
  prospect: 'prospect',
  active: 'active',
  inactive: 'inactive',
  archived: 'archived',
} as const;
export type EntityStatus = (typeof ENTITY_STATUS)[keyof typeof ENTITY_STATUS];
export const ENTITY_STATUSES: EntityStatus[] = Object.values(ENTITY_STATUS);

/** Legal / operational status (§6) — independent of the lifecycle status above. */
export const LEGAL_STATUS = {
  active: 'active',
  under_incorporation: 'under_incorporation',
  dormant: 'dormant',
  struck_off: 'struck_off',
  under_liquidation: 'under_liquidation',
  cirp: 'cirp',
  closed: 'closed',
  other: 'other',
} as const;
export type LegalStatus = (typeof LEGAL_STATUS)[keyof typeof LEGAL_STATUS];
export const LEGAL_STATUSES: LegalStatus[] = Object.values(LEGAL_STATUS);

/** Regulatory profile status (§29) — independent of the entity lifecycle status. */
export const REGULATORY_PROFILE_STATUS = {
  incomplete: 'incomplete',
  under_review: 'under_review',
  complete: 'complete',
  needs_reassessment: 'needs_reassessment',
} as const;
export type RegulatoryProfileStatus =
  (typeof REGULATORY_PROFILE_STATUS)[keyof typeof REGULATORY_PROFILE_STATUS];
export const REGULATORY_PROFILE_STATUSES: RegulatoryProfileStatus[] =
  Object.values(REGULATORY_PROFILE_STATUS);

/** Listing status (§15). */
export const LISTING_STATUS = {
  unlisted: 'unlisted',
  listed_equity: 'listed_equity',
  listed_debt: 'listed_debt',
  listed_equity_debt: 'listed_equity_debt',
  sme_equity: 'sme_equity',
  in_process: 'in_process',
} as const;
export type ListingStatus = (typeof LISTING_STATUS)[keyof typeof LISTING_STATUS];
export const LISTING_STATUSES: ListingStatus[] = Object.values(LISTING_STATUS);

/** Currently-known accounting framework (§19) — final call is the engine's. */
export const ACCOUNTING_FRAMEWORK = {
  not_assessed: 'not_assessed',
  ind_as: 'ind_as',
  accounting_standards: 'accounting_standards',
  other: 'other',
} as const;
export type AccountingFramework = (typeof ACCOUNTING_FRAMEWORK)[keyof typeof ACCOUNTING_FRAMEWORK];
export const ACCOUNTING_FRAMEWORKS: AccountingFramework[] = Object.values(ACCOUNTING_FRAMEWORK);

/** Client entry-point kind (§3). */
export const CLIENT_KIND = {
  individual: 'individual',
  legal_entity: 'legal_entity',
  group: 'group',
} as const;
export type ClientKind = (typeof CLIENT_KIND)[keyof typeof CLIENT_KIND];
export const CLIENT_KINDS: ClientKind[] = Object.values(CLIENT_KIND);

/** Client relationship lifecycle status. */
export const CLIENT_STATUS = {
  active: 'active',
  inactive: 'inactive',
  archived: 'archived',
} as const;
export type ClientStatus = (typeof CLIENT_STATUS)[keyof typeof CLIENT_STATUS];
export const CLIENT_STATUSES: ClientStatus[] = Object.values(CLIENT_STATUS);

/** Address kinds (§8/§31). */
export const ADDRESS_TYPE = {
  registered: 'registered',
  business: 'business',
  branch: 'branch',
  communication: 'communication',
  other: 'other',
} as const;
export type AddressType = (typeof ADDRESS_TYPE)[keyof typeof ADDRESS_TYPE];
export const ADDRESS_TYPES: AddressType[] = Object.values(ADDRESS_TYPE);

/** Structured ownership/group relationships (§13). */
export const RELATIONSHIP_TYPE = {
  holding: 'holding',
  subsidiary: 'subsidiary',
  wholly_owned_subsidiary: 'wholly_owned_subsidiary',
  associate: 'associate',
  joint_venture: 'joint_venture',
  step_down_subsidiary: 'step_down_subsidiary',
  fellow_subsidiary: 'fellow_subsidiary',
  ultimate_holding: 'ultimate_holding',
  intermediate_holding: 'intermediate_holding',
  other: 'other',
} as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPE)[keyof typeof RELATIONSHIP_TYPE];
export const RELATIONSHIP_TYPES: RelationshipType[] = Object.values(RELATIONSHIP_TYPE);

export const RELATIONSHIP_STATUS = {
  active: 'active',
  ended: 'ended',
} as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUS)[keyof typeof RELATIONSHIP_STATUS];
export const RELATIONSHIP_STATUSES: RelationshipStatus[] = Object.values(RELATIONSHIP_STATUS);

/** Listing lines (§15). */
export const EXCHANGE = {
  nse: 'nse',
  bse: 'bse',
  sme: 'sme',
  other: 'other',
} as const;
export type Exchange = (typeof EXCHANGE)[keyof typeof EXCHANGE];
export const EXCHANGES: Exchange[] = Object.values(EXCHANGE);

export const SECURITY_TYPE = {
  equity: 'equity',
  preference: 'preference',
  debt: 'debt',
  other: 'other',
} as const;
export type SecurityType = (typeof SECURITY_TYPE)[keyof typeof SECURITY_TYPE];
export const SECURITY_TYPES: SecurityType[] = Object.values(SECURITY_TYPE);

export const LISTING_LINE_STATUS = {
  listed: 'listed',
  in_process: 'in_process',
  delisted: 'delisted',
  suspended: 'suspended',
} as const;
export type ListingLineStatus = (typeof LISTING_LINE_STATUS)[keyof typeof LISTING_LINE_STATUS];
export const LISTING_LINE_STATUSES: ListingLineStatus[] = Object.values(LISTING_LINE_STATUS);

/** Provenance of a structured regulatory fact (§19). */
export const REGULATORY_ATTRIBUTE_SOURCE = {
  client: 'client',
  hsdg: 'hsdg',
  government_portal: 'government_portal',
  system_derived: 'system_derived',
  other: 'other',
} as const;
export type RegulatoryAttributeSource =
  (typeof REGULATORY_ATTRIBUTE_SOURCE)[keyof typeof REGULATORY_ATTRIBUTE_SOURCE];
export const REGULATORY_ATTRIBUTE_SOURCES: RegulatoryAttributeSource[] = Object.values(
  REGULATORY_ATTRIBUTE_SOURCE,
);

/** Statutory registration kinds. PAN lives on the entity itself. */
export const REGISTRATION_TYPE = {
  gstin: 'gstin',
  cin: 'cin',
  llpin: 'llpin',
  tan: 'tan',
  iec: 'iec',
  pt: 'pt',
  esic: 'esic',
  pf: 'pf',
  other: 'other',
} as const;
export type RegistrationType = (typeof REGISTRATION_TYPE)[keyof typeof REGISTRATION_TYPE];
export const REGISTRATION_TYPES: RegistrationType[] = Object.values(REGISTRATION_TYPE);

export const REGISTRATION_STATUS = {
  pending: 'pending',
  active: 'active',
  inactive: 'inactive',
  cancelled: 'cancelled',
  suspended: 'suspended',
  expired: 'expired',
} as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUS)[keyof typeof REGISTRATION_STATUS];
export const REGISTRATION_STATUSES: RegistrationStatus[] = Object.values(REGISTRATION_STATUS);

/**
 * Registration applicability (§12) — a SEPARATE axis from status. A pending
 * application (a status) must never be read as "not required" (an applicability).
 */
export const REGISTRATION_APPLICABILITY = {
  unknown: 'unknown',
  under_assessment: 'under_assessment',
  applicable: 'applicable',
  not_applicable: 'not_applicable',
} as const;
export type RegistrationApplicability =
  (typeof REGISTRATION_APPLICABILITY)[keyof typeof REGISTRATION_APPLICABILITY];
export const REGISTRATION_APPLICABILITIES: RegistrationApplicability[] = Object.values(
  REGISTRATION_APPLICABILITY,
);

/** Where a registration fact came from (§10). */
export const REGISTRATION_SOURCE = {
  client: 'client',
  hsdg: 'hsdg',
  government_portal: 'government_portal',
  other: 'other',
} as const;
export type RegistrationSource = (typeof REGISTRATION_SOURCE)[keyof typeof REGISTRATION_SOURCE];
export const REGISTRATION_SOURCES: RegistrationSource[] = Object.values(REGISTRATION_SOURCE);

/** Financial figures source (§17). */
export const FINANCIAL_SOURCE = {
  audited_financials: 'audited_financials',
  provisional_financials: 'provisional_financials',
  tax_return: 'tax_return',
  books: 'books',
  management_representation: 'management_representation',
  other: 'other',
} as const;
export type FinancialSource = (typeof FINANCIAL_SOURCE)[keyof typeof FINANCIAL_SOURCE];
export const FINANCIAL_SOURCES: FinancialSource[] = Object.values(FINANCIAL_SOURCE);

/** Contact classification (§24). */
export const CONTACT_TYPE = {
  promoter: 'promoter',
  director: 'director',
  cfo: 'cfo',
  finance_head: 'finance_head',
  accounts: 'accounts',
  cs: 'cs',
  hr: 'hr',
  gst: 'gst',
  tax: 'tax',
  authorised_signatory: 'authorised_signatory',
  other: 'other',
} as const;
export type ContactType = (typeof CONTACT_TYPE)[keyof typeof CONTACT_TYPE];
export const CONTACT_TYPES: ContactType[] = Object.values(CONTACT_TYPE);

/** Financial-year format shared across the portal, e.g. "2024-25". */
export const FINANCIAL_YEAR_REGEX = /^[0-9]{4}-[0-9]{2}$/;

/**
 * A single item of missing / pending master information (§5, §27, §28).
 * `severity` distinguishes a blocker for creation from progressive enrichment.
 * A missing item is NEVER "not applicable" — absence is just absence.
 */
export interface MissingInfoItem {
  code: string;
  label: string;
  severity: 'required' | 'recommended';
}

/** Indian identifier formats (uppercase). */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
export const TAN_REGEX = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
