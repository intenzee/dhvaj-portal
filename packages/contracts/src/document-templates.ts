/**
 * Firm document templates (Section 01 spec §2, §10.2).
 *
 * The approved DHVAJ Word templates that "Create from Template" merges engagement
 * data into. Each template key can carry VARIANTS (e.g. a listed-company
 * engagement letter) chosen by the facts of the engagement, and every template
 * keeps an append-only VERSION history: an engagement records the exact
 * template version it was created from, so historical files never change when
 * the firm approves new wording.
 *
 * Merge fields are written in the .docx as `{{client.name}}` — Word may split
 * them across formatting runs; the merge engine joins them back.
 */

export const DOCUMENT_TEMPLATE_KEY = {
  previousAuditorCommunication: 'previous_auditor_communication',
  auditorConsentCertificate: 'auditor_consent_certificate',
  engagementLetter: 'engagement_letter',
  clientAcknowledgement: 'client_acknowledgement',
} as const;
export type DocumentTemplateKey = (typeof DOCUMENT_TEMPLATE_KEY)[keyof typeof DOCUMENT_TEMPLATE_KEY];
export const DOCUMENT_TEMPLATE_KEYS: DocumentTemplateKey[] = Object.values(DOCUMENT_TEMPLATE_KEY);

export interface DocumentTemplateDefinition {
  templateKey: DocumentTemplateKey;
  title: string;
  /** File name of a created document; `{client}` is replaced with the client's name. */
  filenamePattern: string;
}

/** The formats Section 01 creates from a template (spec §10.2). */
export const DOCUMENT_TEMPLATE_DEFINITIONS: readonly DocumentTemplateDefinition[] = [
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.previousAuditorCommunication,
    title: 'Communication to Previous Auditor',
    filenamePattern: 'Communication to Previous Auditor - {client}.docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.auditorConsentCertificate,
    title: 'Auditor Consent / Eligibility Certificate',
    filenamePattern: 'Auditor Consent and Eligibility Certificate - {client}.docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.engagementLetter,
    title: 'Statutory Audit Engagement Letter',
    filenamePattern: 'Statutory Audit Engagement Letter - {client}.docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.clientAcknowledgement,
    title: 'Client Acknowledgement / Acceptance',
    filenamePattern: 'Client Acknowledgement - {client}.docx',
  },
] as const;

export function templateDefinition(key: string): DocumentTemplateDefinition | undefined {
  return DOCUMENT_TEMPLATE_DEFINITIONS.find((d) => d.templateKey === key);
}

/** The default variant every template key has; others carry conditions. */
export const DEFAULT_TEMPLATE_VARIANT = 'standard';

/**
 * When a variant applies. Every condition set must hold; an empty set is the
 * default. The most specific matching variant wins.
 */
export interface TemplateConditions {
  /** The client has a security listed on an exchange. */
  listed?: boolean;
  /** The client's entity type is one of these (e.g. `public_limited`). */
  entityTypeSlugs?: string[];
  /** The client has subsidiaries, associates or joint ventures (group audit wording). */
  hasGroup?: boolean;
}

/** The facts a variant is chosen against. */
export interface TemplateSelectionFacts {
  listed: boolean;
  entityTypeSlug: string | null;
  hasGroup: boolean;
}

export function templateConditionsMatch(c: TemplateConditions, f: TemplateSelectionFacts): boolean {
  if (c.listed !== undefined && c.listed !== f.listed) return false;
  if (c.hasGroup !== undefined && c.hasGroup !== f.hasGroup) return false;
  if (c.entityTypeSlugs && c.entityTypeSlugs.length > 0) {
    if (!f.entityTypeSlug || !c.entityTypeSlugs.includes(f.entityTypeSlug)) return false;
  }
  return true;
}

export function templateSpecificity(c: TemplateConditions): number {
  return (
    (c.listed !== undefined ? 1 : 0) +
    (c.hasGroup !== undefined ? 1 : 0) +
    (c.entityTypeSlugs && c.entityTypeSlugs.length > 0 ? 1 : 0)
  );
}

/** Pick the applicable variant: the most specific one whose conditions hold. */
export function selectTemplateVariant<T extends { appliesWhen: TemplateConditions; variantKey: string }>(
  variants: readonly T[],
  facts: TemplateSelectionFacts,
): T | null {
  const matching = variants.filter((v) => templateConditionsMatch(v.appliesWhen, facts));
  matching.sort(
    (a, b) =>
      templateSpecificity(b.appliesWhen) - templateSpecificity(a.appliesWhen) ||
      (a.variantKey === DEFAULT_TEMPLATE_VARIANT ? 1 : 0) -
        (b.variantKey === DEFAULT_TEMPLATE_VARIANT ? 1 : 0),
  );
  return matching[0] ?? null;
}

/** Lifecycle of one uploaded template file. */
export const TEMPLATE_VERSION_STATUS = {
  draft: 'draft',
  approved: 'approved',
  superseded: 'superseded',
} as const;
export type TemplateVersionStatus =
  (typeof TEMPLATE_VERSION_STATUS)[keyof typeof TEMPLATE_VERSION_STATUS];

/** A merge field the engine fills, with where its value comes from. */
export interface TemplateMergeField {
  key: string;
  label: string;
  source: string;
}

/** Every merge field available to Section 01 templates. */
export const TEMPLATE_MERGE_FIELDS: readonly TemplateMergeField[] = [
  { key: 'firm.name', label: 'Firm name', source: 'Firm settings' },
  { key: 'firm.frn', label: 'Firm registration number (FRN)', source: 'Firm settings' },
  { key: 'firm.address', label: 'Firm address', source: 'Firm settings' },
  { key: 'firm.office', label: 'Engagement office', source: 'Engagement' },
  { key: 'client.name', label: 'Client name', source: 'Entity master' },
  { key: 'client.cin', label: 'CIN / LLPIN', source: 'Entity master' },
  { key: 'client.pan', label: 'PAN', source: 'Entity master' },
  { key: 'client.companyType', label: 'Company type', source: 'Entity master' },
  { key: 'client.registeredOffice', label: 'Registered office', source: 'Entity master' },
  { key: 'engagement.code', label: 'Engagement code', source: 'Engagement' },
  { key: 'engagement.financialYear', label: 'Financial year', source: 'Engagement' },
  { key: 'engagement.auditPeriod', label: 'Audit period', source: 'Engagement' },
  { key: 'engagement.periodEnd', label: 'Period end', source: 'Engagement' },
  { key: 'partner.name', label: 'Engagement partner', source: 'Engagement' },
  { key: 'partner.membershipNo', label: 'Partner membership no.', source: 'Partner profile' },
  { key: 'manager.name', label: 'Engagement manager', source: 'Engagement' },
  { key: 'appointment.basis', label: 'Basis of appointment', source: '01.2 APP-01' },
  { key: 'appointment.date', label: 'Date of appointment', source: '01.2 APP-02' },
  { key: 'appointment.periodFrom', label: 'Appointed from', source: '01.2 APP-03' },
  { key: 'appointment.periodTo', label: 'Appointed to', source: '01.2 APP-03' },
  { key: 'previousAuditor.firmName', label: 'Previous auditor firm', source: '01.3 details' },
  { key: 'previousAuditor.frn', label: 'Previous auditor FRN', source: '01.3 details' },
  { key: 'previousAuditor.partnerName', label: 'Previous auditor partner', source: '01.3 details' },
  { key: 'previousAuditor.membershipNo', label: 'Previous auditor membership no.', source: '01.3 details' },
  { key: 'previousAuditor.email', label: 'Previous auditor email', source: '01.3 details' },
  { key: 'previousAuditor.address', label: 'Previous auditor address', source: '01.3 details' },
  { key: 'previousAuditor.lastAuditPeriod', label: 'Previous auditor last period', source: '01.3 details' },
  { key: 'today', label: "Today's date", source: 'System' },
] as const;

export interface DocumentTemplateVersionRecord {
  id: string;
  templateId: string;
  versionNo: number;
  filename: string;
  sizeBytes: number;
  checksumSha256: string;
  status: TemplateVersionStatus;
  notes: string | null;
  /** Merge fields found in the file. */
  fieldsFound: string[];
  /** Fields in the file the engine does not know — they are left as written. */
  unknownFields: string[];
  uploadedByName: string | null;
  uploadedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
}

export interface DocumentTemplateRecord {
  id: string;
  templateKey: DocumentTemplateKey;
  variantKey: string;
  title: string;
  appliesWhen: TemplateConditions;
  isActive: boolean;
  /** The approved version "Create from Template" uses; null until one is approved. */
  currentVersion: DocumentTemplateVersionRecord | null;
  versions: DocumentTemplateVersionRecord[];
  version: number;
}

export interface CreateTemplateVariantInput {
  templateKey: DocumentTemplateKey;
  variantKey: string;
  title?: string;
  appliesWhen?: TemplateConditions;
}

export interface UploadTemplateVersionInput {
  filename: string;
  contentBase64: string;
  notes?: string;
}
