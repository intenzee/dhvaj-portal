import type {
  ClientVerdict,
  MergedInto,
  WorkSection,
  AccountingFramework,
  AddressType,
  ContactType,
  EntityStatus,
  Exchange,
  FinancialSource,
  LegalStatus,
  ListingLineStatus,
  ListingStatus,
  MissingFilter,
  MissingInfoItem,
  RegistrationApplicability,
  RegistrationSource,
  RegistrationStatus,
  RegistrationType,
  RegulatoryAttributeSource,
  RegulatoryProfileStatus,
  RelationshipStatus,
  RelationshipType,
  SecurityType,
  ClientTeamRef,
  EntityTypeSource,
  ClientBranch,
} from '@hsdg/contracts';

export interface EntityTypeRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
}

export interface RegistrationRecord {
  id: string;
  registrationType: RegistrationType;
  registrationNumber: string;
  stateCode: string | null;
  status: RegistrationStatus;
  validFrom: string | null;
  validTo: string | null;
  // §10 lifecycle / verification (Phase A schema, Phase B write path).
  jurisdiction: string | null;
  registrationDate: string | null;
  issuingAuthority: string | null;
  source: RegistrationSource;
  isPrincipal: boolean;
  applicability: RegistrationApplicability;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  documentRef: string | null;
  /** The office (CM-6) this registration is of; null = the whole client. */
  branchId: string | null;
}

export interface ContactRecord {
  id: string;
  fullName: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  isSignatory: boolean;
  department: string | null;
  contactType: ContactType | null;
  isPortalUser: boolean;
  portalRole: string | null;
  branchId: string | null;
}

/** Year-wise financial facts (§16/§17). Append-only: one current row per FY. */
export interface FinancialProfileRecord {
  id: string;
  financialYear: string;
  turnover: number | null;
  revenue: number | null;
  otherIncome: number | null;
  netProfit: number | null;
  profitBeforeTax: number | null;
  netWorth: number | null;
  paidUpCapital: number | null;
  reservesSurplus: number | null;
  totalAssets: number | null;
  totalBorrowings: number | null;
  bankPfiBorrowings: number | null;
  publicDeposits: number | null;
  debentures: number | null;
  outstandingLoans: number | null;
  source: FinancialSource;
  sourceFinancialYear: string | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  supportingDocumentRef: string | null;
  isCurrent: boolean;
  supersedesId: string | null;
  createdAt: string;
}

/** An entity as it appears in list responses. */
export interface EntitySummary {
  id: string;
  entityCode: string;
  legalName: string;
  displayName: string | null;
  tradeName: string | null;
  shortName: string | null;
  typeSlug: string;
  typeName: string;
  typeCategory: string;
  pan: string | null;
  status: EntityStatus;
  legalStatus: LegalStatus | null;
  regulatoryProfileStatus: RegulatoryProfileStatus;
  listingStatus: ListingStatus;
  currentAccountingFramework: AccountingFramework;
  countryOfIncorporation: string;
  clientId: string | null;
  officeId: string;
  officeCode: string;
  groupId: string | null;
  parentEntityId: string | null;
  incorporationDate: string | null;
  registrationCount: number;
  /** Live offices (CM-6); 0 = not set up. */
  branchCount: number;
  primaryContactName: string | null;
  /** Progressive-completion signal (§5/§27/§28); absence is never "N/A". */
  missingInfo: MissingInfoItem[];
  version: number;
  /** CM-8: the client's team, if any. */
  team: ClientTeamRef | null;
}

export interface AddressRecord {
  id: string;
  addressType: AddressType;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  isPrimary: boolean;
  branchId: string | null;
}

export interface RelationshipRecord {
  id: string;
  toEntityId: string;
  toEntityLegalName: string;
  toEntityCode: string;
  relationshipType: RelationshipType;
  shareholdingPct: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: RelationshipStatus;
  notes: string | null;
}

export interface BusinessActivityRecord {
  id: string;
  industryId: string;
  industrySlug: string;
  industryName: string;
  nicCodeId: string | null;
  nicCode: string | null;
  isPrimary: boolean;
  notes: string | null;
}

export interface ListingRecord {
  id: string;
  exchange: Exchange;
  securityType: SecurityType;
  listingDate: string | null;
  status: ListingLineStatus;
  symbol: string | null;
  notes: string | null;
}

export interface RegulatoryAttributeRecord {
  id: string;
  attributeCode: string;
  attributeName: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  effectiveFrom: string | null;
  source: RegulatoryAttributeSource;
  notes: string | null;
}

/** Full entity view: summary plus children and derived missing-info. */
export interface EntityDetail extends EntitySummary {
  // Constitution / business scalars (§8/§18).
  roc: string | null;
  authorisedCapital: number | null;
  paidUpCapital: number | null;
  llpContribution: number | null;
  businessDescription: string | null;
  activities: {
    manufacturing: boolean;
    trading: boolean;
    services: boolean;
    import: boolean;
    export: boolean;
    ecommerce: boolean;
    regulated: boolean;
  };
  registrations: RegistrationRecord[];
  contacts: ContactRecord[];
  financialProfiles: FinancialProfileRecord[];
  addresses: AddressRecord[];
  relationships: RelationshipRecord[];
  businessActivities: BusinessActivityRecord[];
  listings: ListingRecord[];
  regulatoryAttributes: RegulatoryAttributeRecord[];
  /** Set when this client was merged into another and archived. */
  mergedInto: MergedInto | null;
  /** Where the firm type came from (CM-3), and who set it by hand and when. */
  entityTypeSource: EntityTypeSource;
  entityTypeSetBy: string | null;
  entityTypeSetAt: string | null;
  /** Live and closed offices (CM-6); head office first. */
  branches: ClientBranch[];
}

export interface DuplicateCandidate {
  id: string;
  entityCode: string;
  legalName: string;
  pan: string | null;
  score: number;
  matchReason: 'pan' | 'name';
  /** How sure the name / PAN reading is that it is the same client. */
  verdict: ClientVerdict;
  reasons: string[];
}

export interface RegistrationInput {
  registrationType: RegistrationType;
  registrationNumber: string;
  stateCode?: string;
  status?: RegistrationStatus;
  validFrom?: string;
  validTo?: string;
  jurisdiction?: string;
  registrationDate?: string;
  issuingAuthority?: string;
  source?: RegistrationSource;
  isPrincipal?: boolean;
  applicability?: RegistrationApplicability;
  documentRef?: string;
}

/** Partial update to an existing registration (the §34 "obtained later" flow). */
export interface UpdateRegistrationInput {
  registrationNumber?: string;
  stateCode?: string | null;
  status?: RegistrationStatus;
  validFrom?: string | null;
  validTo?: string | null;
  jurisdiction?: string | null;
  registrationDate?: string | null;
  issuingAuthority?: string | null;
  source?: RegistrationSource;
  isPrincipal?: boolean;
  applicability?: RegistrationApplicability;
  documentRef?: string | null;
}

export interface ContactInput {
  fullName: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  isSignatory?: boolean;
  department?: string;
  contactType?: ContactType;
  isPortalUser?: boolean;
  portalRole?: string;
}

/** New/updated year-wise financial figures (§16/§17). */
export interface FinancialProfileInput {
  financialYear: string;
  turnover?: number;
  revenue?: number;
  otherIncome?: number;
  netProfit?: number;
  profitBeforeTax?: number;
  netWorth?: number;
  paidUpCapital?: number;
  reservesSurplus?: number;
  totalAssets?: number;
  totalBorrowings?: number;
  bankPfiBorrowings?: number;
  publicDeposits?: number;
  debentures?: number;
  outstandingLoans?: number;
  source?: FinancialSource;
  sourceFinancialYear?: string;
  supportingDocumentRef?: string;
}

export interface AddressInput {
  addressType?: AddressType;
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  isPrimary?: boolean;
}

export interface RelationshipInput {
  toEntityId: string;
  relationshipType: RelationshipType;
  shareholdingPct?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  status?: RelationshipStatus;
  notes?: string;
}

export interface UpdateRelationshipInput {
  relationshipType?: RelationshipType;
  shareholdingPct?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  status?: RelationshipStatus;
  notes?: string | null;
}

export interface BusinessActivityInput {
  industrySlug: string;
  nicCode?: string;
  isPrimary?: boolean;
  notes?: string;
}

export interface ListingInput {
  exchange: Exchange;
  securityType?: SecurityType;
  listingDate?: string;
  status?: ListingLineStatus;
  symbol?: string;
  notes?: string;
}

export interface UpdateListingInput {
  securityType?: SecurityType;
  listingDate?: string | null;
  status?: ListingLineStatus;
  symbol?: string | null;
  notes?: string | null;
}

export interface UpdateAddressInput {
  addressType?: AddressType;
  line1?: string;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string;
  isPrimary?: boolean;
}

export interface RegulatoryAttributeInput {
  attributeCode: string;
  valueText?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueDate?: string;
  effectiveFrom?: string;
  source?: RegulatoryAttributeSource;
  notes?: string;
}

export interface ActivityFlags {
  manufacturing?: boolean;
  trading?: boolean;
  services?: boolean;
  import?: boolean;
  export?: boolean;
  ecommerce?: boolean;
  regulated?: boolean;
}

export interface CreateEntityInput {
  legalName: string;
  displayName?: string;
  tradeName?: string;
  shortName?: string;
  activities?: ActivityFlags;
  typeSlug: string;
  officeCode: string;
  clientId?: string;
  pan?: string;
  parentEntityId?: string;
  status?: EntityStatus;
  legalStatus?: LegalStatus;
  listingStatus?: ListingStatus;
  currentAccountingFramework?: AccountingFramework;
  countryOfIncorporation?: string;
  incorporationDate?: string;
  roc?: string;
  authorisedCapital?: number;
  paidUpCapital?: number;
  llpContribution?: number;
  businessDescription?: string;
  registrations?: RegistrationInput[];
  contacts?: ContactInput[];
  // Atomic wizard submit (§4): these children are created in the same
  // transaction as the entity. Relationships are excluded — they reference
  // other entities and are wired after creation.
  addresses?: AddressInput[];
  businessActivities?: BusinessActivityInput[];
  listings?: ListingInput[];
  regulatoryAttributes?: RegulatoryAttributeInput[];
  financialProfiles?: FinancialProfileInput[];
  /** Server-side callers only (imports): where typeSlug came from. Default: pan when it equals the PAN's type, else manual. */
  entityTypeSource?: EntityTypeSource;
}

export interface UpdateEntityInput {
  legalName?: string;
  displayName?: string | null;
  tradeName?: string | null;
  shortName?: string | null;
  activities?: ActivityFlags;
  typeSlug?: string;
  officeCode?: string;
  clientId?: string | null;
  pan?: string | null;
  parentEntityId?: string | null;
  status?: EntityStatus;
  legalStatus?: LegalStatus | null;
  regulatoryProfileStatus?: RegulatoryProfileStatus;
  listingStatus?: ListingStatus;
  currentAccountingFramework?: AccountingFramework;
  countryOfIncorporation?: string;
  incorporationDate?: string | null;
  roc?: string | null;
  authorisedCapital?: number | null;
  paidUpCapital?: number | null;
  llpContribution?: number | null;
  businessDescription?: string | null;
  version?: number;
  /** A person saving a type the PAN disagrees with, after the confirm (CM-3). */
  typeMismatchAcknowledged?: boolean;
  /** Server-side callers only (imports): where typeSlug came from; a person's change is manual. */
  entityTypeSource?: EntityTypeSource;
}

export interface EntityFilter {
  status?: EntityStatus;
  typeSlug?: string;
  officeCode?: string;
  search?: string;
  /** Any-of: a live engagement in one of these sections. */
  section?: WorkSection[];
  /** Something missing from the master ('any'), nothing ('none'), or one item. */
  missing?: MissingFilter;
  /** CM-8: a team id, 'none' (no team) or 'mine' (a team I am on). */
  team?: string;
}
