import type { EngagementKind, FilingStatus, PeriodSection } from './engagement-restructure';
import type { TaskStatus } from './tasks';
import type { WorkItemRef } from './work-links';

/**
 * Staff Workflow WF-301 — filing runs: one form and period across every client
 * (GET /compliance/runs), with bulk assign and remind. Behind ff_filing_runs.
 */

/** A form-and-period the caller can run, for the picker (GET /compliance/runs/forms). */
export interface FilingRunForm {
  /** The rule's code, e.g. GST_GSTR1_M — the `rule` query parameter. */
  rule: string;
  formLabel: string;
  section: PeriodSection | null;
  periodKey: string;
  periodLabel: string;
  /** The earliest operative statutory date across the run. */
  statutoryDate: string | null;
  total: number;
  filed: number;
}

/** What the client has sent for one filing (the grid's Data column). */
export interface FilingRunData {
  /** Required upload slots on the filing's checklist, and how many hold a document. */
  slotsRequired: number;
  slotsFilled: number;
  /** Client requests raised on the filing, and how many are still waiting. */
  requestsTotal: number;
  requestsOpen: number;
  /** Open requests' slot labels ("Bank statement", …), for the tooltip. */
  waitingOn: string[];
}

export interface FilingRunRow {
  instanceId: string;
  engagementId: string;
  engagementCode: string;
  engagementKind: EngagementKind;
  entityName: string;
  registrationNumber: string | null;
  data: FilingRunData;
  taskId: string | null;
  taskStatus: TaskStatus | null;
  taskVersion: number | null;
  preparerId: string | null;
  preparerName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  workflowStatus: FilingStatus;
  internalDate: string | null;
  statutoryDate: string | null;
  /** The live filing record, once lodged. */
  filed: { referenceNo: string; filedOn: string } | null;
  /** The caller may lodge it inline (the preparer or an engagement lead). */
  canLodge: boolean;
  /** The caller may assign it (an engagement lead). */
  canAssign: boolean;
  link: WorkItemRef;
}

/** GET /compliance/runs — one row per filing (engagement × registration). */
export interface FilingRun {
  rule: string;
  formLabel: string;
  periodKey: string;
  periodLabel: string;
  total: number;
  filed: number;
  items: FilingRunRow[];
}

/** Bulk call outcome: one transaction per filing, so a bad row never blocks the rest. */
export interface FilingRunBulkResult {
  succeeded: string[];
  failed: { instanceId: string; message: string }[];
}
