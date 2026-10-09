/**
 * 02.3 §16 — the Financial Statements Workbook.
 *
 * Once 02.2 and 02.3 establish the framework, "Create Financial Statements
 * Workbook" creates the firm's approved Excel template directly in the
 * engagement's SharePoint workspace (opened from the portal in Microsoft 365,
 * AutoSave to the same file; no download / re-upload). The template is chosen
 * centrally — never in the UI — by:
 *   • framework + Division → the template key the Schedule III framework
 *     version names (`ScheduleIiiFrameworkVersion.templateKey`);
 *   • entity type → the variant whose conditions list the entity type;
 *   • financial year / template effective version → the variant dated for the
 *     audit period (`periodFrom` / `periodTo`), else the standard variant;
 * and the approved version of that variant. The workbook keeps the template
 * id, template version, framework version and creation date, so a later
 * template or Schedule III amendment never changes a historical engagement.
 */

import type { DocumentTemplateKey } from './document-templates';

/** What "Create Financial Statements Workbook" would use for this engagement. */
export interface FsWorkbookSelection {
  templateKey: DocumentTemplateKey;
  templateTitle: string;
  /** Schedule III framework version (id, e.g. `SCHEDULE_III_DIVISION_II`, label). */
  frameworkVersionId: string;
  frameworkId: string;
  frameworkVersionLabel: string;
  division: 'I' | 'II' | 'III';
  financialYear: string | null;
  /** Audit period start the template effective version is selected for. */
  periodStart: string;
  entityTypeSlug: string | null;
  /** The approved template chosen — null when none is approved yet. */
  templateId: string | null;
  templateVariantKey: string | null;
  templateVersionId: string | null;
  templateVersionNo: number | null;
}

/** The created workbook and its version metadata (§16 "Version metadata"). */
export interface FsWorkbookRecord {
  id: string;
  workflowInstanceId: string;
  engagementId: string;
  documentId: string;
  title: string;
  filename: string | null;
  templateKey: DocumentTemplateKey;
  templateId: string;
  templateVariantKey: string;
  templateVersionId: string;
  templateVersionNo: number;
  frameworkVersionId: string | null;
  frameworkId: string | null;
  frameworkVersionLabel: string | null;
  division: 'I' | 'II' | 'III' | null;
  financialYear: string | null;
  entityTypeSlug: string | null;
  createdByName: string | null;
  createdAt: string;
  /** The live SharePoint file (Microsoft 365 on). */
  inSharePoint: boolean;
  currentVersionNo: number;
  lastEditedBy: string | null;
  lastSavedAt: string | null;
}

/** GET /:wf/schedule-iii/workbook */
export interface FsWorkbookView {
  workflowInstanceId: string;
  /** The framework is established and a workbook may be created now. */
  available: boolean;
  /** Why it cannot be created (yet), or null. */
  reason: string | null;
  selection: FsWorkbookSelection | null;
  workbook: FsWorkbookRecord | null;
  m365Enabled: boolean;
  /** The viewer cannot create (not an engagement lead, or Section 02 approved). */
  readOnly: boolean;
}

/** POST /:wf/schedule-iii/workbook */
export interface CreateFsWorkbookInput {
  /** Use this template variant instead of the applicable one (administrators' escape hatch). */
  variantKey?: string;
}

export interface FsWorkbookCreated {
  view: FsWorkbookView;
  documentId: string;
  /** Microsoft 365 editor link when the tenant is connected. */
  editorUrl: string | null;
  /** Known merge fields with no value, left as `[Label]` in the workbook. */
  missingFields: string[];
}
