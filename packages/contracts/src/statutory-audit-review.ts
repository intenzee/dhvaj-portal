/**
 * Statutory Audit — Review vocabulary (Audit Spec §25, §29, §344).
 *
 * Review is FIRST-CLASS (§37): a review note is a reviewer's comment on a
 * specific professional object (a procedure/workpaper, an audit area or a piece
 * of evidence — §344) that requires a preparer response and, ultimately, a
 * reviewer clearance. Each note retains author, timestamp, status, response and
 * clearance history (§344) — the mutation trail is kept in the immutable §32
 * event log. An OPEN BLOCKING note prevents configured completion (§29, feeds
 * SA-8).
 *
 * The Review dashboard (§25) is a derived view: the pending-review queue is the
 * set of professional objects awaiting review (procedures Ready for Review, areas
 * with a submitted conclusion), split by reviewer level (partner where the
 * reviewer is the EP, otherwise manager), plus the open-note and overdue counts.
 *
 * This module is the single source of truth for the SA-7 review vocabulary and is
 * shared by the pure helpers, the service and the screen.
 */

/**
 * A review note's lifecycle (§344). `open` — raised, awaiting the preparer;
 * `responded` — the preparer answered, awaiting the reviewer; `cleared` — the
 * reviewer accepted the response and closed the point.
 */
export const REVIEW_NOTE_STATUS = {
  open: 'open',
  responded: 'responded',
  cleared: 'cleared',
} as const;
export type ReviewNoteStatus = (typeof REVIEW_NOTE_STATUS)[keyof typeof REVIEW_NOTE_STATUS];

/** Statuses in which a note is still live (not yet cleared) (§25 "Open Review Notes"). */
export const REVIEW_NOTE_OPEN_STATUSES: readonly ReviewNoteStatus[] = ['open', 'responded'];

/**
 * The two-tier review model (§24, §25). A note / pending review is at partner
 * level when its reviewer is the engagement's EP, otherwise at manager level.
 */
export const REVIEW_LEVEL = {
  manager: 'manager',
  partner: 'partner',
} as const;
export type ReviewLevel = (typeof REVIEW_LEVEL)[keyof typeof REVIEW_LEVEL];

/** The kind of professional object a review note is anchored to (§344). */
export const REVIEW_TARGET_TYPE = {
  procedure: 'procedure',
  workArea: 'work_area',
  evidence: 'evidence',
} as const;
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPE)[keyof typeof REVIEW_TARGET_TYPE];

/** One review note (§344). */
export interface AuditReviewNote {
  id: string;
  /** The object under review (§344 — the underlying workpaper/procedure/evidence). */
  targetType: ReviewTargetType;
  targetId: string;
  /** A human label for the target (procedure ref+title / area title / evidence title). */
  targetLabel: string | null;
  reviewLevel: ReviewLevel;
  /** The reviewer's comment requiring response/clearance (§156). */
  body: string;
  status: ReviewNoteStatus;
  /** A blocking open note prevents configured completion (§29). */
  isBlocking: boolean;
  raisedByName: string | null;
  /** The preparer's response, once given (§344). */
  response: string | null;
  respondedByName: string | null;
  respondedAt: string | null;
  clearedByName: string | null;
  clearedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of the pending-review queue (§25) — a professional object awaiting
 * review. Derived from procedure/area state, never stored.
 */
export interface ReviewQueueItem {
  targetType: ReviewTargetType;
  targetId: string;
  /** Human label — procedure ref+title, or area title. */
  label: string;
  /** The audit area this sits under (for context in the queue). */
  workAreaTitle: string | null;
  preparerName: string | null;
  reviewerName: string | null;
  reviewLevel: ReviewLevel;
  /** The underlying professional state (e.g. 'ready_for_review', 'submitted'). */
  state: string;
  dueDate: string | null;
  /** True when the review is past its due date (§25 "Overdue Reviews"). */
  isOverdue: boolean;
}

/** The four headline counts of the Review dashboard (§25). */
export interface ReviewSummary {
  pendingManagerReview: number;
  pendingPartnerReview: number;
  openReviewNotes: number;
  overdueReviews: number;
  /** Open notes flagged blocking — the completion gate (§29, feeds SA-8). */
  blockingOpenNotes: number;
}

/** The Review dashboard for one statutory-audit shell — the shape the screen reads (§25). */
export interface StatutoryAuditReview {
  workflowInstanceId: string;
  engagementServiceId: string;
  engagementId: string;
  summary: ReviewSummary;
  queue: ReviewQueueItem[];
  notes: AuditReviewNote[];
}

/** Whether a review note is still live (§25 "Open Review Notes"). */
export function reviewNoteIsOpen(note: { status: ReviewNoteStatus }): boolean {
  return REVIEW_NOTE_OPEN_STATUSES.includes(note.status);
}

/**
 * Whether a queued review is overdue: it has a due date and it is past. `today`
 * is an ISO 'YYYY-MM-DD' date so the comparison is timezone-free (DATE columns
 * come back as raw date strings). Pure and DB-free.
 */
export function isReviewOverdue(
  item: { dueDate: string | null },
  today: string,
): boolean {
  if (!item.dueDate) return false;
  return item.dueDate < today;
}

/**
 * The reviewer level for a review whose reviewer is `reviewerEmployeeId`, given
 * the engagement's EP (partner). Reviews the EP owns are partner-level; all
 * others are manager-level (§24, §25). Pure.
 */
export function reviewLevelFor(
  reviewerEmployeeId: string | null,
  engagementPartnerId: string | null,
): ReviewLevel {
  if (reviewerEmployeeId && engagementPartnerId && reviewerEmployeeId === engagementPartnerId) {
    return REVIEW_LEVEL.partner;
  }
  return REVIEW_LEVEL.manager;
}

/**
 * Fold a pending-review queue and the note list into the §25 headline counts.
 * Pure so the dashboard maths is unit-tested independent of the DB.
 */
export function summarizeReview(
  queue: readonly ReviewQueueItem[],
  notes: readonly { status: ReviewNoteStatus; isBlocking: boolean }[],
): ReviewSummary {
  return {
    pendingManagerReview: queue.filter((q) => q.reviewLevel === REVIEW_LEVEL.manager).length,
    pendingPartnerReview: queue.filter((q) => q.reviewLevel === REVIEW_LEVEL.partner).length,
    openReviewNotes: notes.filter((n) => reviewNoteIsOpen(n)).length,
    overdueReviews: queue.filter((q) => q.isOverdue).length,
    blockingOpenNotes: notes.filter((n) => n.isBlocking && reviewNoteIsOpen(n)).length,
  };
}
