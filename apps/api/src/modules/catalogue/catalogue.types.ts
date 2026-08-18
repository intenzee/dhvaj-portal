import type { Recurrence } from '@hsdg/contracts';

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
