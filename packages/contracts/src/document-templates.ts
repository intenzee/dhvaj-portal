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
  /** 02.2 §18 — only for complex cases, overrides or consultations. */
  financialReportingFrameworkMemo: 'financial_reporting_framework_memo',
  /** 02.3 §17 — complex or overridden presentation-framework cases. */
  scheduleIiiPresentationMemo: 'schedule_iii_presentation_memo',
  /** 02.4 §16 — complex, overridden or consulted CARO applicability. */
  caroApplicabilityMemo: 'caro_applicability_memo',
  /** 02.5 §20 — complex, overridden or consulted ICFR reporting applicability. */
  icfrApplicabilityMemo: 'icfr_applicability_memo',
  /** 02.6 — complex, overridden or EP-approved consolidation / group-audit framework. */
  consolidationGroupAuditMemo: 'consolidation_group_audit_memo',
  /** 02.6 §14 — group instructions to another component auditor (SA 600). */
  componentAuditorInstructions: 'component_auditor_instructions',
  /**
   * 02.3 §16 — the Financial Statements Workbook (Excel), one key per Schedule
   * III framework; each framework version names its key (`templateKey`).
   */
  fsWorkbookAsDivI: 'fs_workbook_as_div_i',
  fsWorkbookIndAsDivII: 'fs_workbook_indas_div_ii',
  fsWorkbookIndAsDivIII: 'fs_workbook_indas_div_iii',
} as const;
export type DocumentTemplateKey =
  (typeof DOCUMENT_TEMPLATE_KEY)[keyof typeof DOCUMENT_TEMPLATE_KEY];
export const DOCUMENT_TEMPLATE_KEYS: DocumentTemplateKey[] = Object.values(DOCUMENT_TEMPLATE_KEY);

export interface DocumentTemplateDefinition {
  templateKey: DocumentTemplateKey;
  title: string;
  /** File name of a created document; `{client}` is replaced with the client's name. */
  filenamePattern: string;
  /** The audit-file section that creates it (Section 01 lists only its own). */
  section: '01' | '02.2' | '02.3' | '02.4' | '02.5' | '02.6';
  /** The file the firm uploads: a Word document (merged) or an Excel workbook. */
  format: TemplateFormat;
}

/** Template file formats. Word templates are merged; Excel workbooks fill `{{…}}` text cells. */
export type TemplateFormat = 'docx' | 'xlsx';
export const TEMPLATE_CONTENT_TYPE: Record<TemplateFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The formats created from a template (Section 01 spec §10.2; 02.2 §18; 02.3 §16, §17). */
export const DOCUMENT_TEMPLATE_DEFINITIONS: readonly DocumentTemplateDefinition[] = [
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.previousAuditorCommunication,
    title: 'Communication to Previous Auditor',
    filenamePattern: 'Communication to Previous Auditor - {client}.docx',
    section: '01',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.auditorConsentCertificate,
    title: 'Auditor Consent / Eligibility Certificate',
    filenamePattern: 'Auditor Consent and Eligibility Certificate - {client}.docx',
    section: '01',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.engagementLetter,
    title: 'Statutory Audit Engagement Letter',
    filenamePattern: 'Statutory Audit Engagement Letter - {client}.docx',
    section: '01',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.clientAcknowledgement,
    title: 'Client Acknowledgement / Acceptance',
    filenamePattern: 'Client Acknowledgement - {client}.docx',
    section: '01',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.financialReportingFrameworkMemo,
    title: 'Financial Reporting Framework Technical Memo',
    filenamePattern: 'Financial Reporting Framework Memo - {client}.docx',
    section: '02.2',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.scheduleIiiPresentationMemo,
    title: 'Schedule III Presentation Framework Technical Memo',
    filenamePattern: 'Schedule III Presentation Framework Memo - {client}.docx',
    section: '02.3',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.caroApplicabilityMemo,
    title: 'CARO 2020 Applicability Memo',
    filenamePattern: 'CARO 2020 Applicability Memo - {client}.docx',
    section: '02.4',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.icfrApplicabilityMemo,
    title: 'ICFR Reporting Applicability Memo',
    filenamePattern: 'ICFR Reporting Applicability Memo - {client}.docx',
    section: '02.5',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.consolidationGroupAuditMemo,
    title: 'Consolidation & Group Audit Memo',
    filenamePattern: 'Consolidation and Group Audit Memo - {client}.docx',
    section: '02.6',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.componentAuditorInstructions,
    title: 'Component Auditor Instructions',
    filenamePattern: 'Component Auditor Instructions - {component} - {client}.docx',
    section: '02.6',
    format: 'docx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.fsWorkbookAsDivI,
    title: 'Financial Statements Workbook — AS / Schedule III Division I',
    filenamePattern: 'Financial Statements Workbook {fy} - {client}.xlsx',
    section: '02.3',
    format: 'xlsx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.fsWorkbookIndAsDivII,
    title: 'Financial Statements Workbook — Ind AS / Schedule III Division II',
    filenamePattern: 'Financial Statements Workbook {fy} - {client}.xlsx',
    section: '02.3',
    format: 'xlsx',
  },
  {
    templateKey: DOCUMENT_TEMPLATE_KEY.fsWorkbookIndAsDivIII,
    title: 'Financial Statements Workbook — Ind AS NBFC / Schedule III Division III',
    filenamePattern: 'Financial Statements Workbook {fy} - {client}.xlsx',
    section: '02.3',
    format: 'xlsx',
  },
] as const;

/** The FS workbook template keys (02.3 §16). */
export const FS_WORKBOOK_TEMPLATE_KEYS: DocumentTemplateKey[] = [
  DOCUMENT_TEMPLATE_KEY.fsWorkbookAsDivI,
  DOCUMENT_TEMPLATE_KEY.fsWorkbookIndAsDivII,
  DOCUMENT_TEMPLATE_KEY.fsWorkbookIndAsDivIII,
];

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
  /**
   * Template effective version (02.3 §16): the variant applies to audit periods
   * starting on/after `periodFrom` and on/before `periodTo` (YYYY-MM-DD). A
   * dated variant never matches when the audit period is unknown.
   */
  periodFrom?: string;
  periodTo?: string;
}

/** The facts a variant is chosen against. */
export interface TemplateSelectionFacts {
  listed: boolean;
  entityTypeSlug: string | null;
  hasGroup: boolean;
  /** Audit period start (YYYY-MM-DD) — selects dated variants. */
  periodStart?: string | null;
}

export function templateConditionsMatch(c: TemplateConditions, f: TemplateSelectionFacts): boolean {
  if (c.listed !== undefined && c.listed !== f.listed) return false;
  if (c.hasGroup !== undefined && c.hasGroup !== f.hasGroup) return false;
  if (c.entityTypeSlugs && c.entityTypeSlugs.length > 0) {
    if (!f.entityTypeSlug || !c.entityTypeSlugs.includes(f.entityTypeSlug)) return false;
  }
  if (c.periodFrom && (!f.periodStart || f.periodStart < c.periodFrom)) return false;
  if (c.periodTo && (!f.periodStart || f.periodStart > c.periodTo)) return false;
  return true;
}

export function templateSpecificity(c: TemplateConditions): number {
  return (
    (c.listed !== undefined ? 1 : 0) +
    (c.hasGroup !== undefined ? 1 : 0) +
    (c.entityTypeSlugs && c.entityTypeSlugs.length > 0 ? 1 : 0) +
    (c.periodFrom || c.periodTo ? 1 : 0)
  );
}

/** Pick the applicable variant: the most specific one whose conditions hold. */
export function selectTemplateVariant<
  T extends { appliesWhen: TemplateConditions; variantKey: string },
>(variants: readonly T[], facts: TemplateSelectionFacts): T | null {
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

/**
 * Every merge field available to the firm's templates (the `frf.*` ones fill the
 * 02.2 memo; the `sch.*` ones the 02.3 memo and the FS workbook).
 */
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
  {
    key: 'previousAuditor.membershipNo',
    label: 'Previous auditor membership no.',
    source: '01.3 details',
  },
  { key: 'previousAuditor.email', label: 'Previous auditor email', source: '01.3 details' },
  { key: 'previousAuditor.address', label: 'Previous auditor address', source: '01.3 details' },
  {
    key: 'previousAuditor.lastAuditPeriod',
    label: 'Previous auditor last period',
    source: '01.3 details',
  },
  { key: 'frf.framework', label: 'Applicable framework', source: '02.2 conclusion' },
  { key: 'frf.applicabilityType', label: 'Applicability type', source: '02.2 system conclusion' },
  { key: 'frf.effectiveFrom', label: 'Framework effective from', source: '02.2 system conclusion' },
  { key: 'frf.primaryTrigger', label: 'Primary trigger', source: '02.2 system conclusion' },
  { key: 'frf.secondaryTriggers', label: 'Secondary triggers', source: '02.2 system conclusion' },
  { key: 'frf.ruleApplied', label: 'Rule applied', source: '02.2 rule basis' },
  { key: 'frf.limitApplied', label: 'Limit applied', source: '02.2 rule basis' },
  { key: 'frf.factsUsed', label: 'Facts used', source: '02.1 / 02.2 facts' },
  { key: 'frf.systemConclusion', label: 'System conclusion', source: '02.2 system conclusion' },
  { key: 'frf.systemBasis', label: 'System basis', source: '02.2 system conclusion' },
  { key: 'frf.professionalConclusion', label: 'Professional conclusion', source: '02.2 FRF-05' },
  { key: 'frf.overridden', label: 'Overridden (Yes / No)', source: '02.2 FRF-05' },
  { key: 'frf.overrideReason', label: 'Override reason', source: '02.2 FRF-05' },
  { key: 'frf.smcStatus', label: 'SMC status', source: '02.2 SMC sub-assessment' },
  { key: 'frf.firstTimeAdoption', label: 'First-time Ind AS adoption', source: '02.2 FRF-06' },
  { key: 'frf.partnerApproval', label: 'Partner approval', source: '02.2 FRF-05' },
  { key: 'frf.pendingReason', label: 'Information pending', source: '02.2 FRF-05' },
  { key: 'frf.decidedBy', label: 'Concluded by', source: '02.2 FRF-05' },
  { key: 'frf.decidedAt', label: 'Concluded on', source: '02.2 FRF-05' },
  { key: 'sch.presentationFramework', label: 'Presentation framework', source: '02.3 conclusion' },
  { key: 'sch.systemConclusion', label: 'Schedule III system conclusion', source: '02.3 system' },
  { key: 'sch.systemBasis', label: 'Schedule III system basis', source: '02.3 system' },
  { key: 'sch.frameworkVersion', label: 'Schedule III version', source: '02.3 version control' },
  {
    key: 'sch.guidanceVersion',
    label: 'ICAI Guidance Note version',
    source: '02.3 version control',
  },
  { key: 'sch.components', label: 'Financial statement components', source: '02.3 components' },
  { key: 'sch.cashFlow', label: 'Cash flow statement', source: '02.3 SCH-03' },
  { key: 'sch.rounding', label: 'Rounding framework', source: '02.3 SCH-05' },
  {
    key: 'sch.presentationMateriality',
    label: 'Presentation materiality',
    source: '02.3 presentation materiality',
  },
  { key: 'sch.specialisedFormat', label: 'Specialised statutory format', source: '02.3 SCH-02' },
  { key: 'sch.comparatives', label: 'Comparative information', source: '02.3 SCH-04' },
  { key: 'sch.disclosureLibrary', label: 'Disclosure library', source: '02.3 disclosure library' },
  { key: 'sch.factsUsed', label: 'Schedule III facts used', source: '02.1 / 02.2 facts' },
  { key: 'sch.rulesApplied', label: 'Schedule III rules applied', source: '02.3 rule basis' },
  { key: 'sch.professionalConclusion', label: 'Schedule III conclusion', source: '02.3 SCH-06' },
  { key: 'sch.overridden', label: 'Schedule III overridden (Yes / No)', source: '02.3 SCH-06' },
  { key: 'sch.overrideReason', label: 'Schedule III override reason', source: '02.3 SCH-06' },
  { key: 'sch.technicalBasis', label: 'Schedule III technical basis', source: '02.3 SCH-06' },
  { key: 'sch.partnerApproval', label: 'Schedule III partner approval', source: '02.3 SCH-06' },
  { key: 'sch.pendingReason', label: 'Schedule III information pending', source: '02.3 SCH-06' },
  { key: 'sch.decidedBy', label: 'Schedule III concluded by', source: '02.3 SCH-06' },
  { key: 'sch.decidedAt', label: 'Schedule III concluded on', source: '02.3 SCH-06' },
  { key: 'caro.applicability', label: 'CARO applicability', source: '02.4 conclusion' },
  { key: 'caro.systemConclusion', label: 'CARO system conclusion', source: '02.4 system' },
  { key: 'caro.systemBasis', label: 'CARO system basis', source: '02.4 system' },
  { key: 'caro.exemptionBasis', label: 'CARO exemption basis', source: '02.4 exemption tests' },
  { key: 'caro.entityRoute', label: 'CARO entity route', source: '02.4 conclusion' },
  { key: 'caro.directExemption', label: 'CARO direct exemption', source: '02.4 CARO-01..05' },
  { key: 'caro.privateExemption', label: 'CARO private-company exemption', source: '02.4 §6' },
  {
    key: 'caro.failedCondition',
    label: 'CARO failed condition (actual vs limit)',
    source: '02.4 §6–§8',
  },
  { key: 'caro.orderVersion', label: 'CARO Order version', source: '02.4 clause library' },
  { key: 'caro.standaloneScope', label: 'CARO standalone scope', source: '02.4 work programme' },
  {
    key: 'caro.consolidatedScope',
    label: 'CARO consolidated scope (3(xxi))',
    source: '02.4 work programme',
  },
  { key: 'caro.clauseProgress', label: 'CARO clause progress', source: '02.4 work programme' },
  { key: 'caro.reportableClauses', label: 'CARO reportable clauses', source: '02.4 clause work' },
  { key: 'caro.professionalConclusion', label: 'CARO conclusion', source: '02.4 CARO-06' },
  { key: 'caro.overridden', label: 'CARO overridden (Yes / No)', source: '02.4 CARO-06' },
  { key: 'caro.overrideReason', label: 'CARO override reason', source: '02.4 CARO-06' },
  { key: 'caro.technicalBasis', label: 'CARO technical basis', source: '02.4 CARO-06' },
  { key: 'caro.supportingEvidence', label: 'CARO override evidence', source: '02.4 CARO-06' },
  { key: 'caro.partnerApproval', label: 'CARO partner approval', source: '02.4 CARO-06' },
  { key: 'caro.pendingReason', label: 'CARO information pending', source: '02.4 CARO-06' },
  { key: 'caro.decidedBy', label: 'CARO concluded by', source: '02.4 CARO-06' },
  { key: 'caro.decidedAt', label: 'CARO concluded on', source: '02.4 CARO-06' },
  { key: 'icfr.applicability', label: 'ICFR reporting applicability', source: '02.5 conclusion' },
  { key: 'icfr.systemConclusion', label: 'ICFR system conclusion', source: '02.5 system' },
  { key: 'icfr.systemReason', label: 'ICFR system reason', source: '02.5 §10' },
  { key: 'icfr.entityRoute', label: 'ICFR entity route', source: '02.5 §5' },
  { key: 'icfr.opcRoute', label: 'ICFR OPC route', source: '02.5 §6 (02.1)' },
  { key: 'icfr.smallCompanyRoute', label: 'ICFR small company route', source: '02.5 §6 (02.1)' },
  { key: 'icfr.turnover', label: 'ICFR turnover (actual vs limit)', source: '02.5 IFC-01' },
  {
    key: 'icfr.borrowings',
    label: 'ICFR peak covered borrowings (actual vs limit)',
    source: '02.5 IFC-02',
  },
  { key: 'icfr.filingCondition', label: 'ICFR filing-default condition', source: '02.5 IFC-03' },
  {
    key: 'icfr.notificationVersion',
    label: 'ICFR exemption notification version',
    source: '02.5 rule basis',
  },
  { key: 'icfr.workstream', label: 'ICFR workstream configuration', source: '02.5 §13' },
  { key: 'icfr.deficiencies', label: 'ICFR deficiencies identified', source: '02.5 §16' },
  { key: 'icfr.consolidated', label: 'ICFR consolidated consideration', source: '02.5 §17' },
  { key: 'icfr.controlReminder', label: 'ICFR control audit reminder', source: '02.5 §12' },
  { key: 'icfr.professionalConclusion', label: 'ICFR conclusion', source: '02.5 IFC-04' },
  { key: 'icfr.overridden', label: 'ICFR overridden (Yes / No)', source: '02.5 IFC-04' },
  { key: 'icfr.overrideReason', label: 'ICFR override reason', source: '02.5 IFC-04' },
  { key: 'icfr.technicalBasis', label: 'ICFR technical basis', source: '02.5 IFC-04' },
  { key: 'icfr.supportingEvidence', label: 'ICFR override evidence', source: '02.5 IFC-04' },
  { key: 'icfr.partnerApproval', label: 'ICFR partner approval', source: '02.5 IFC-04' },
  { key: 'icfr.pendingReason', label: 'ICFR information pending', source: '02.5 IFC-04' },
  { key: 'icfr.decidedBy', label: 'ICFR concluded by', source: '02.5 IFC-04' },
  { key: 'icfr.decidedAt', label: 'ICFR concluded on', source: '02.5 IFC-04' },
  { key: 'cfs.requirement', label: 'CFS requirement (conclusion)', source: '02.6 CFS-05' },
  { key: 'cfs.systemConclusion', label: 'CFS system conclusion', source: '02.6 CFS-01' },
  { key: 'cfs.systemBasis', label: 'CFS system basis', source: '02.6 CFS-01' },
  { key: 'cfs.rule6', label: 'Rule 6 exemption — condition by condition', source: '02.6 CFS-02' },
  { key: 'cfs.perimeter', label: 'Consolidation perimeter', source: '02.6 §8' },
  { key: 'cfs.groupFramework', label: 'Group financial reporting framework', source: '02.2' },
  { key: 'cfs.componentAuditors', label: 'Component / other auditor matrix', source: '02.6 §12' },
  { key: 'cfs.sa600', label: 'SA 600 assessment (GA-01 to GA-04)', source: '02.6 §13' },
  { key: 'cfs.reportingPackages', label: 'Component reporting packages', source: '02.6 §15' },
  { key: 'cfs.otherAuditorFindings', label: 'Other-auditor findings', source: '02.6 §16' },
  { key: 'cfs.branchAuditors', label: 'Branch auditors (BR-01)', source: '02.6 §17' },
  { key: 'cfs.workProgramme', label: 'Consolidation work programme', source: '02.6 §19' },
  { key: 'cfs.materialityNote', label: 'Group materiality note', source: '02.6 §18' },
  { key: 'cfs.professionalConclusion', label: 'CFS-05 conclusion', source: '02.6 CFS-05' },
  { key: 'cfs.overridden', label: 'CFS-05 overridden (Yes / No)', source: '02.6 CFS-05' },
  { key: 'cfs.overrideReason', label: 'CFS-05 override reason', source: '02.6 CFS-05' },
  { key: 'cfs.technicalBasis', label: 'CFS-05 technical basis', source: '02.6 CFS-05' },
  { key: 'cfs.supportingEvidence', label: 'CFS-05 override evidence', source: '02.6 CFS-05' },
  { key: 'cfs.partnerApproval', label: 'CFS-05 EP approval', source: '02.6 CFS-05' },
  { key: 'cfs.pendingReason', label: 'CFS-05 information pending', source: '02.6 CFS-05' },
  { key: 'cfs.decidedBy', label: 'CFS-05 concluded by', source: '02.6 CFS-05' },
  { key: 'cfs.decidedAt', label: 'CFS-05 concluded on', source: '02.6 CFS-05' },
  { key: 'ga.componentName', label: 'Component name', source: '02.6 §12' },
  { key: 'ga.relationship', label: 'Component relationship', source: '02.6 §5' },
  { key: 'ga.componentCountry', label: 'Component country', source: '02.6 §12' },
  { key: 'ga.auditorFirm', label: 'Component auditor firm', source: '02.6 §12' },
  { key: 'ga.auditorFrn', label: 'Component auditor FRN / professional body', source: '02.6 §12' },
  { key: 'ga.auditorPartner', label: 'Component auditor partner / contact', source: '02.6 §12' },
  { key: 'ga.auditPeriod', label: 'Component audit / reporting period', source: '02.6 §12' },
  { key: 'ga.reportingFramework', label: 'Group reporting framework / package', source: '02.2 / 02.6 §14' },
  { key: 'ga.materiality', label: 'Materiality for the component', source: '03.3 (after approval)' },
  { key: 'ga.clearlyTrivial', label: 'Clearly trivial threshold', source: '03.3 (after approval)' },
  { key: 'ga.significantRisks', label: 'Group-identified significant risks', source: 'Section 04' },
  { key: 'ga.groupComponents', label: 'Other group components (inter-company)', source: '02.6 perimeter' },
  { key: 'ga.reportingPackage', label: 'Reporting package required', source: '02.6 §15' },
  { key: 'ga.icfrReporting', label: 'ICFR reporting required of the component', source: '02.5 / 02.6' },
  { key: 'ga.caroReporting', label: 'CARO reporting required of the component', source: '02.4 / 02.6' },
  { key: 'ga.deadline', label: 'Group reporting deadline', source: '02.6 §14' },
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
