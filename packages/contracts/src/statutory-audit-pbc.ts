/**
 * Statutory Audit — PBC Master Client Information Tracker vocabulary (Audit Spec §16).
 *
 * PBC ("Provided/Prepared By Client") is the client information-request layer,
 * not the audit workpaper (§0). It is one master tracker per audit file: each
 * item is a distinct requirement asked of the client, with a client owner, an
 * agreed due date, a professional status and an optional link to the WORK AREA
 * it supports and the DHVAJ document that was received. A received file is
 * surfaced in the linked area BY REFERENCE — "the same file must not be uploaded
 * again simply to make it visible there" (§16); the document is linked, never
 * duplicated.
 *
 * This module is the single source of truth for the SA-6 vocabulary and the
 * shapes the PBC tracker reads — shared by the pure helpers, the service and the
 * screen.
 */

/**
 * The §16 seven-state professional status model. A fresh request is `requested`;
 * `rejected` means "not usable; reason required"; `closed` is the resolved /
 * dispositioned terminal state.
 */
export const PBC_STATUS = {
  requested: 'requested',
  received: 'received',
  underReview: 'under_review',
  accepted: 'accepted',
  rejected: 'rejected',
  clarificationRequired: 'clarification_required',
  closed: 'closed',
} as const;
export type PbcStatus = (typeof PBC_STATUS)[keyof typeof PBC_STATUS];

/**
 * Statuses in which the client information is still OUTSTANDING (not yet
 * usefully in hand). An item in one of these past its due date is overdue (§29
 * "PBC overdue"). `rejected` and `clarification_required` are outstanding
 * because the client still owes a usable response.
 */
export const PBC_OUTSTANDING_STATUSES: readonly PbcStatus[] = [
  'requested',
  'rejected',
  'clarification_required',
];

/** Statuses that represent a settled/closed request (no further client action). */
export const PBC_SETTLED_STATUSES: readonly PbcStatus[] = ['accepted', 'closed'];

/** One PBC master tracker item (§16). */
export interface AuditPbcItem {
  id: string;
  pbcRef: string;
  requirement: string;
  clientOwner: string | null;
  /** The work area this request supports (§16 LINKED WORK), when linked. */
  workAreaId: string | null;
  workAreaTitle: string | null;
  status: PbcStatus;
  /** Required when `status` is `rejected` (§16). */
  rejectionReason: string | null;
  requestedDate: string | null;
  dueDate: string | null;
  receivedDate: string | null;
  /** The received DHVAJ document, surfaced in the linked area by reference (§16). */
  documentId: string | null;
  documentTitle: string | null;
  note: string | null;
  requestedByName: string | null;
  /** True when the request is outstanding and past its due date (§29). */
  isOverdue: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The PBC master tracker for one statutory-audit shell — the shape the PBC
 * screen reads (§16).
 */
export interface StatutoryAuditPbc {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  /** Whether Planning is approved — the gate for populating the tracker (§7, step 13). */
  planningApproved: boolean;
  items: AuditPbcItem[];
  /** How many items are outstanding and past their due date (§29 "PBC overdue"). */
  overdueCount: number;
}

/**
 * The next human-facing PBC reference ("PBC-001", "PBC-002", …), one past the
 * highest existing PBC-<n>, zero-padded to three digits (§16). Pure so the ref
 * numbering is unit-tested; non-conforming refs are ignored.
 */
export function nextPbcRef(existingRefs: readonly string[]): string {
  let max = 0;
  for (const ref of existingRefs) {
    const m = /^PBC-(\d+)$/.exec(ref.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `PBC-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Whether a PBC item is overdue: outstanding (client still owes a usable
 * response) and past its agreed due date (§29 "PBC overdue"). `today` is an
 * ISO 'YYYY-MM-DD' date so the comparison is timezone-free (DATE columns come
 * back as raw date strings). Pure and DB-free.
 */
export function isPbcOverdue(
  item: { status: PbcStatus; dueDate: string | null },
  today: string,
): boolean {
  if (!item.dueDate) return false;
  if (!PBC_OUTSTANDING_STATUSES.includes(item.status)) return false;
  return item.dueDate < today;
}
