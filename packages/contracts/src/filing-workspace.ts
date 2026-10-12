/**
 * Change 5 / 6 — the filing workspace behind the GST, TDS, Income Tax and ROC
 * tabs: the stream tree (registration → year → period → section) and one
 * filing's workspace (checklist, document slots, figures, lodge, corrections).
 */
import type { FilingStatus, PeriodSection, Stream } from './engagement-restructure';

export const CHECKLIST_ITEM_STATUS = {
  open: 'open',
  done: 'done',
  notApplicable: 'not_applicable',
} as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUS)[keyof typeof CHECKLIST_ITEM_STATUS];
export const CHECKLIST_ITEM_STATUSES: ChecklistItemStatus[] = Object.values(CHECKLIST_ITEM_STATUS);

export type ChecklistAutoTick = 'document' | 'figure' | 'review' | 'lodge';

export const FILING_REFERENCE_KIND = {
  arn: 'arn',
  srn: 'srn',
  token: 'token',
  ack: 'ack',
  challan: 'challan',
  internal: 'internal',
} as const;
export type FilingReferenceKind = (typeof FILING_REFERENCE_KIND)[keyof typeof FILING_REFERENCE_KIND];
export const FILING_REFERENCE_KINDS: FilingReferenceKind[] = Object.values(FILING_REFERENCE_KIND);

/** A lead may undo a lodge within this many hours; after that only a partner. */
export const LODGE_UNDO_LEAD_HOURS = 24;

export interface ChecklistItem {
  id: string;
  itemCode: string;
  label: string;
  slotCode: string | null;
  required: boolean;
  sequence: number;
  autoTick: ChecklistAutoTick | null;
  note: string | null;
  status: ChecklistItemStatus;
  doneByName: string | null;
  doneAt: string | null;
  naReason: string | null;
  documentId: string | null;
  clientDependencyId: string | null;
  version: number;
}

export interface SlotDocument {
  id: string;
  title: string;
  filename: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
  /** Uploaded by the client through a secure link. */
  fromClient: boolean;
}

export interface WorkspaceSlot {
  slotCode: string;
  label: string;
  required: boolean;
  documents: SlotDocument[];
  /** The open client request for this slot, if any. */
  openRequest: { dependencyId: string; requestedAt: string; escalationDate: string | null } | null;
}

export type FigureKind = 'amount' | 'integer' | 'text' | 'date';

export interface FigureField {
  key: string;
  label: string;
  kind: FigureKind;
  required: boolean;
  /** Column heading for by-head groups (IGST / CGST / SGST / Cess). */
  group?: string;
}

export interface FilingRecordView {
  id: string;
  referenceKind: FilingReferenceKind;
  referenceNo: string;
  filedOn: string;
  filedById: string | null;
  filedByName: string | null;
  isNil: boolean;
  figures: Record<string, string | number | null>;
  lateFeePaid: number | null;
  interestPaid: number | null;
  ackDocumentId: string;
  remarks: string | null;
  recordedAt: string;
  /** Filed after the statutory date (as extended). Not a status. */
  isLate: boolean;
  undoneAt: string | null;
  undoneByName: string | null;
  undoReason: string | null;
}

export interface FilingCorrectionView {
  id: string;
  correctedInInstanceId: string | null;
  correctedInLabel: string | null;
  note: string;
  createdByName: string | null;
  createdAt: string;
}

export interface CrossCheckWarning {
  code: 'gstr3b_before_gstr1' | 'outward_tax_mismatch' | 'itc_exceeds_2b' | 'lut_missing' | 'required_open';
  message: string;
}

export interface WorkspaceInstance {
  id: string;
  engagementId: string;
  ruleCode: string;
  ruleName: string;
  formLabel: string | null;
  stream: Stream | null;
  section: PeriodSection | null;
  financialYear: string | null;
  periodKey: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  statutoryDueDate: string;
  internalDate: string;
  daysLeft: number;
  workflowStatus: FilingStatus;
  isProvisional: boolean;
  verify: boolean;
  registrationId: string | null;
  registrationNumber: string | null;
  /** Slots, items and figures are read-only (filed, or the month's 3B filed). */
  isLocked: boolean;
  lockedReason: string | null;
  /** The rule's late-fee note (Verify rules carry a caution). */
  lateFeeNote: string | null;
  /** Indicative GST late fee / interest while past due and unfiled — a hint, never posted. */
  lateCharges: { daysLate: number; lateFee: number; interest: number | null } | null;
  /** Not applicable: the reason recorded. */
  notApplicableReason: string | null;
}

export interface WorkspaceTask {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewStartedAt?: string | null;
  version: number;
}

export interface InstanceWorkspace {
  instance: WorkspaceInstance;
  task: WorkspaceTask | null;
  checklist: ChecklistItem[];
  slots: WorkspaceSlot[];
  figureSchema: FigureField[];
  figures: Record<string, string | number | null>;
  figuresVersion: number;
  /** Figures must be entered to lodge (GSTR-3B, PMT-06, CMP-08). */
  figuresRequiredToLodge: boolean;
  filing: FilingRecordView | null;
  filingHistory: FilingRecordView[];
  corrections: FilingCorrectionView[];
  warnings: CrossCheckWarning[];
  can: { lodge: boolean; undo: boolean; waive: boolean; edit: boolean };
}

/** One filing in the stream tree. */
export interface TreeItem {
  instanceId: string;
  ruleCode: string;
  label: string;
  section: PeriodSection | null;
  dueDate: string;
  workflowStatus: FilingStatus;
  filedOn: string | null;
  isLate: boolean;
  isOverdue: boolean;
  isProvisional: boolean;
  verify: boolean;
  /** Checklist progress, e.g. 3 of 8 required items done. */
  requiredDone: number;
  requiredTotal: number;
}

export interface TreePeriod {
  periodKey: string;
  label: string;
  /** For QRMP: the quarter a month belongs to (Q1 …), else null. */
  quarter: string | null;
  sections: Partial<Record<PeriodSection, TreeItem[]>>;
  /** Items with no section (TDS / IT / ROC). */
  items: TreeItem[];
  nextAction: string | null;
}

export interface TreeRegistration {
  id: string;
  number: string;
  type: string;
  stateCode: string | null;
  label: string;
  gstScheme: string | null;
  qrmpCategory: string | null;
}

export interface StreamTree {
  stream: Stream;
  registrations: TreeRegistration[];
  registrationId: string | null;
  financialYears: string[];
  financialYear: string | null;
  annual: TreeItem[];
  periods: TreePeriod[];
}
