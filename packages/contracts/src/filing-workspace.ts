/**
 * Change 5 / 6 — the filing workspace behind the GST, TDS, Income Tax and ROC
 * tabs: the stream tree (registration → year → period → section) and one
 * filing's workspace (checklist, document slots, figures, lodge, corrections).
 */
import type { FilingStatus, PeriodSection, Stream } from './engagement-restructure';
import type { LateChargeEstimate } from './roc-mca';

export const CHECKLIST_ITEM_STATUS = {
  open: 'open',
  done: 'done',
  notApplicable: 'not_applicable',
} as const;
export type ChecklistItemStatus =
  (typeof CHECKLIST_ITEM_STATUS)[keyof typeof CHECKLIST_ITEM_STATUS];
export const CHECKLIST_ITEM_STATUSES: ChecklistItemStatus[] = Object.values(CHECKLIST_ITEM_STATUS);

/**
 * 'event': ticks when the compliance event it waits on is recorded (AOC-4's AGM held).
 * 'meetings': ticks when the FY's board-meeting items are all recorded (MGT-7's "Meetings").
 */
export type ChecklistAutoTick = 'document' | 'figure' | 'review' | 'lodge' | 'event' | 'meetings';
/** Who may tick a line by hand: 'partner' lines need a partner and a note (the UDIN). */
export type ChecklistTickedBy = 'partner';

export const FILING_REFERENCE_KIND = {
  arn: 'arn',
  srn: 'srn',
  token: 'token',
  ack: 'ack',
  challan: 'challan',
  internal: 'internal',
} as const;
export type FilingReferenceKind =
  (typeof FILING_REFERENCE_KIND)[keyof typeof FILING_REFERENCE_KIND];
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
  /** 'partner': only a partner ticks it, with the UDIN in the note. */
  tickedBy: ChecklistTickedBy | null;
  note: string | null;
  status: ChecklistItemStatus;
  doneByName: string | null;
  doneAt: string | null;
  /** The note given on ticking (the UDIN on a partner's certification). */
  doneNote: string | null;
  naReason: string | null;
  documentId: string | null;
  clientDependencyId: string | null;
  version: number;
  /** A 'meetings' line: the FY's board meetings — held-on dates, of how many. */
  boardMeetings?: { financialYear: string | null; heldOn: string[]; total: number } | null;
  /** WF-303: the template marks this line as one that starts from last period's answer. */
  carriesOver?: boolean;
  /** WF-303: last period's answer, pre-filled for the preparer to confirm (open lines only). */
  carried?: CarriedAnswer | null;
}

/** WF-303: last period's answer on a line that carries over, awaiting confirmation. */
export interface CarriedAnswer {
  status: 'done' | 'not_applicable';
  note: string | null;
  naReason: string | null;
  instanceId: string;
  periodKey: string | null;
  /** "Aug 2026", "Q1 2026-27" … */
  periodLabel: string;
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
  openRequest: {
    dependencyId: string;
    requestedAt: string;
    escalationDate: string | null;
    /** An upload link was created (a request raised with the checklist has none yet). */
    hasLink?: boolean;
  } | null;
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
  /** ROC: the normal filing fee (the additional fee is lateFeePaid). */
  normalFeePaid: number | null;
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
  code:
    | 'gstr3b_before_gstr1'
    | 'outward_tax_mismatch'
    | 'itc_exceeds_2b'
    | 'lut_missing'
    | 'required_open'
    | 'dsc_expiring';
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
  /** "Sep 2026" — from the period key, else (a filing added by hand) its reference month. */
  periodLabel: string | null;
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
  /**
   * Indicative late fee (and GST interest) — a hint, never posted. GST: while
   * past due and unfiled. ROC: ₹100/day forms and normal-fee slabs, against the
   * filing date once lodged so it can be compared with the fee paid.
   */
  lateCharges: LateChargeEstimate | null;
  /** Not applicable: the reason recorded. */
  notApplicableReason: string | null;
  /**
   * CHG-1 while unfiled (roc-mca P2-3): due 30 days from the charge, then a
   * further 60 days with the additional fee, then beyond the window.
   */
  chargeWindow?: {
    status: 'on_time' | 'fee_window' | 'beyond_window';
    feeWindowEnds: string;
    day: number;
  } | null;
  /** A government extension in force: statutoryDueDate is the revised date. */
  extension?: { reference: string; originalDueDate: string; notes: string | null } | null;
  /**
   * AOC-4 when the firm is also the statutory auditor (roc-mca §5.3): the audit
   * report date from the Statutory Audit file for the same entity and FY (null
   * while unsigned). Read-only; it never blocks. Null when there is no such
   * audit (or it is not visible to you).
   */
  statutoryAudit?: { engagementId: string; reportDate: string | null } | null;
}

/**
 * The client dependency code for the director's DSC (roc-mca Decision 5): it
 * has no upload slot; the item shows Awaiting data until it is received.
 */
export const DSC_REQUEST_CODE = 'DSC';

/** An open client request on the filing (a slot's, or one with no slot such as the DSC). */
export interface WorkspaceClientRequest {
  dependencyId: string;
  /** The slot it fills, or DSC_REQUEST_CODE; null for a free-text request. */
  slotCode: string | null;
  requestedInfo: string;
  requestedAt: string;
  escalationDate: string | null;
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
  /** Open client requests (roc-mca §10: MGT-8, MR-3, the director's DSC …). */
  clientRequests?: WorkspaceClientRequest[];
  /** certify: tick a partner's line (CERT, with the UDIN). */
  can: { lodge: boolean; undo: boolean; waive: boolean; edit: boolean; certify: boolean };
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
  /** WF-203: its open task is mine to prepare or review (the stream tab opens on its period). */
  mine: boolean;
  /** Taken off the portal by "Remove this month" / Start fresh (Restore brings it back). */
  removed?: boolean;
  /** ROC: a director's DSC lapses before the due date ("DSC of A Kumar expires 12 Nov 2026"). */
  dscWarning?: string | null;
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

/**
 * Staff Workflow WF-303 — last period beside this one: the same return for the
 * client's previous period (same rule, registration and section), read-only.
 */
export interface LastPeriodView {
  /** Null for the first period, or when the previous one is not visible to you. */
  previous: {
    instanceId: string;
    engagementId: string;
    formLabel: string | null;
    ruleName: string;
    financialYear: string | null;
    periodKey: string | null;
    /** "Sep 2026", "Q2", "FY 2025-26" … */
    periodLabel: string;
    statutoryDueDate: string;
    workflowStatus: FilingStatus;
    /** The filed reference (the latest lodge not undone). */
    filing: {
      referenceKind: FilingReferenceKind;
      referenceNo: string;
      filedOn: string;
      filedByName: string | null;
      isNil: boolean;
      ackDocumentId: string;
    } | null;
    checklist: {
      itemCode: string;
      label: string;
      status: ChecklistItemStatus;
      doneNote: string | null;
      naReason: string | null;
      doneByName: string | null;
      doneAt: string | null;
    }[];
    /** Uploads by slot, in checklist order; slots with none are left out. */
    slots: { slotCode: string; label: string; documents: SlotDocument[] }[];
    /** The review points given each time the filing's task was returned. */
    reviewPoints: { at: string; byName: string | null; note: string }[];
  } | null;
}

/**
 * Removing old filings from the portal: a period ("Remove this month") or,
 * firm-wide, every overdue filing for a period that ended before a date
 * ("Start fresh"). Nothing is deleted — open filings are waived (shown Not
 * applicable), their open tasks cancelled and their open client requests
 * waived; a removed period can be restored.
 */
export interface FilingCleanupResult {
  filings: number;
  tasks: number;
  requests: number;
  /** Start fresh only: true when nothing was changed (a preview). */
  dryRun?: boolean;
  /** Start fresh only: the first day kept; periods ending before it went. */
  from?: string;
}
