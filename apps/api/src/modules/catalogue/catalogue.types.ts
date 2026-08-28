import type { Recurrence, TemplateType } from '@hsdg/contracts';

export interface ReviewModelRecord {
  id: string;
  slug: string;
  name: string;
  rank: number;
  description: string | null;
}

export interface WorkflowStateRecord {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  isInitial: boolean;
  isTerminal: boolean;
}

export interface WorkflowFamilyRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  states: WorkflowStateRecord[];
}

export interface ServiceLineRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  version: number;
}

/** A service as it appears in list responses (references by code/slug). */
export interface ServiceSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  serviceLineId: string;
  serviceLineCode: string;
  serviceLineName: string;
  requiredReviewModelSlug: string;
  requiredReviewModelRank: number;
  workflowFamilyId: string;
  workflowFamilySlug: string;
  defaultRecurrence: Recurrence;
  isActive: boolean;
  version: number;
  /** Authorised-approval reference recorded for OTHER-line services (spec §17). */
  approvalReference: string | null;
}

/** Full service view: the summary plus the workflow family's states. */
export interface ServiceDetail extends ServiceSummary {
  workflowStates: WorkflowStateRecord[];
}

export interface ServiceFilter {
  serviceLineCode?: string;
  active?: boolean;
  search?: string;
}

export interface CreateServiceInput {
  serviceLineCode: string;
  code: string;
  name: string;
  description?: string;
  requiredReviewModel: string;
  workflowFamily: string;
  defaultRecurrence?: Recurrence;
  isActive?: boolean;
  approvalReference?: string;
}

export interface UpdateServiceInput {
  serviceLineCode?: string;
  name?: string;
  description?: string | null;
  requiredReviewModel?: string;
  workflowFamily?: string;
  defaultRecurrence?: Recurrence;
  isActive?: boolean;
  version?: number;
}

export interface CreateServiceLineInput {
  code: string;
  name: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateServiceLineInput {
  name?: string;
  description?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  version?: number;
}

// ── Reusable, versioned catalogue templates (§18/§25/§27) ────────────────────

/** One item in a template version's body (shape is loose across the 3 types). */
export interface TemplateItem {
  label: string;
  sequence?: number;
  mandatory?: boolean;
  description?: string | null;
}

/** A template's identity (the reusable master). */
export interface CatalogueTemplateRecord {
  id: string;
  templateType: TemplateType;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** An effective-dated, append-only version of a template. */
export interface CatalogueTemplateVersionRecord {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  items: TemplateItem[];
  notes: string | null;
  createdAt: Date;
}

/** A template plus its versions (newest effective first). */
export interface CatalogueTemplateDetail extends CatalogueTemplateRecord {
  versions: CatalogueTemplateVersionRecord[];
}

export interface TemplateFilter {
  templateType?: TemplateType;
  active?: boolean;
  search?: string;
}

export interface CreateTemplateInput {
  templateType: TemplateType;
  code: string;
  name: string;
  description?: string;
  isActive?: boolean;
}

export interface AddTemplateVersionInput {
  effectiveFrom: string;
  effectiveTo?: string | null;
  items?: TemplateItem[];
  notes?: string;
}
