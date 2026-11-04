import type { EngagementKind } from './engagement-restructure';
import type { NoticeClockLabel, NoticeStream } from './notices';
import type { TaskStatus } from './tasks';
import type { WorkItemRef } from './work-links';
import type { WorkFilingContext } from './work-queue';

/**
 * Staff Workflow WF-201 — Today: the day's work in one ordered list
 * (GET /work/today), read through the caller's RLS.
 *
 * - prepare: my tasks in todo / in_progress / paused (the My Work count).
 * - review: the WF-105 queue (GET /work/reviews).
 * - notices: open notices I own or review whose clock (reply, hearing or
 *   appeal date — noticeClock) is running, earliest first (PS-102). Present
 *   only when ff_notices is on for the caller's office.
 * - write_offs: write-offs and credit notes someone else asked for, on
 *   clients I bill, waiting for my decision (PS-205). Present only when
 *   ff_billing_v2 is on for my office and I hold billing.approve.
 * - waiting: my blocked tasks, and open client requests I am responsible for.
 * - due_soon: open filings on work I prepare, review or lead whose due date
 *   (the earlier of the internal and statutory dates) is within a week —
 *   including filings with no task yet — less any already listed above. The
 *   engagement's partner and manager also get its filings due today or past.
 *   With ff_itr_desk on, filed ITRs not yet e-verified whose 30-day window
 *   closes within a week (or has closed) join it (PS-403).
 * - overdue / due_today: the rows from prepare and due_soon whose due date is
 *   past / today, lifted to the top so the day's deadlines come first. A tax
 *   audit with a milestone of mine past its internal date (F-9) is Overdue too.
 */
export const TODAY_GROUP = {
  overdue: 'overdue',
  dueToday: 'due_today',
  prepare: 'prepare',
  review: 'review',
  notices: 'notices',
  writeOffs: 'write_offs',
  waiting: 'waiting',
  dueSoon: 'due_soon',
} as const;
export type TodayGroup = (typeof TODAY_GROUP)[keyof typeof TODAY_GROUP];
export const TODAY_GROUPS: TodayGroup[] = Object.values(TODAY_GROUP);

export const TODAY_GROUP_LABEL: Record<TodayGroup, string> = {
  overdue: 'Overdue',
  due_today: 'Due today',
  prepare: 'To prepare',
  review: 'To review',
  notices: 'Notices',
  write_offs: 'Write-offs to approve',
  waiting: 'Waiting on client',
  due_soon: 'Due this week',
};

/** How far ahead "Due this week" looks, in days. */
export const TODAY_DUE_WITHIN_DAYS = 7;

/**
 * Rows sent per Today group (plan risk "paginate every group"): the most
 * urgent ones, already sorted; `total` still counts them all, and the rest
 * are on My Work and the Compliance calendar.
 */
export const TODAY_GROUP_LIMIT = 100;

export const TODAY_ITEM_KIND = {
  task: 'task',
  clientRequest: 'client_request',
  filing: 'filing',
  reviewPoint: 'review_point',
  signOff: 'sign_off',
  notice: 'notice',
  writeOff: 'write_off',
  creditNote: 'credit_note',
  taxAuditMilestone: 'tax_audit_milestone',
  itrVerify: 'itr_verify',
} as const;
export type TodayItemKind = (typeof TODAY_ITEM_KIND)[keyof typeof TODAY_ITEM_KIND];

/** The task behind a row — enough to offer its next move (Start, Send for review …) in place. */
export interface TodayTask {
  id: string;
  title: string;
  status: TaskStatus;
  version: number;
  assignedToId: string | null;
  assignedToName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  sentForReviewAt: string | null;
  reviewStartedAt: string | null;
}

/** The notice behind a "Notices" row (PS-102). */
export interface TodayNotice {
  id: string;
  referenceNo: string;
  stream: NoticeStream;
  /** noticeTypeLabel — "ASMT-10 · s.61 · Scrutiny of returns". */
  typeLabel: string;
  /** What the row's date is: the reply, the hearing or the appeal. */
  clockLabel: NoticeClockLabel;
  amountDemanded: string | null;
}

/** The tax audit behind an Overdue milestone row (F-9): the milestones I missed on it. */
export interface TodayTaxAuditMilestones {
  auditId: string;
  financialYear: string;
  /** Labels of the missed milestones I own, earliest first. */
  missed: string[];
}

/** A filed ITR still to be e-verified (PS-403), dated by its e-verify due date. */
export interface TodayItrVerify {
  returnId: string;
  ackNo: string | null;
  filedOn: string;
  eVerifyDueOn: string;
}

/** The request behind a "Write-offs to approve" row (PS-205). */
export interface TodayAdjustment {
  id: string;
  kind: 'write_off' | 'credit_note';
  invoiceId: string;
  invoiceNumber: string | null;
  /** The write-off, or the credit note's total with GST. */
  amount: string;
  reason: string;
  requestedByName: string | null;
  version: number;
}

export interface TodayItem {
  /** Unique in the response: `${kind}:${id}`. */
  key: string;
  kind: TodayItemKind;
  group: TodayGroup;
  title: string;
  engagementId: string;
  engagementCode: string;
  engagementKind: EngagementKind;
  entityName: string;
  filing: WorkFilingContext | null;
  /** The firm's date: the filing's internal date, else the task's / request's own. */
  internalDate: string | null;
  statutoryDate: string | null;
  /** The task's / request's / filing's own status. */
  status: string;
  /** Past its due date (IST, see todayDueDate) and still open. */
  isOverdue: boolean;
  blockedByOpenCount: number;
  /** The task, when the row is one (or the filing has one). */
  task: TodayTask | null;
  /** The notice, on a "Notices" row (its `internalDate` is the clock's date). */
  notice?: TodayNotice;
  /** The write-off or credit note, on a "Write-offs to approve" row. */
  adjustment?: TodayAdjustment;
  /** The tax audit, on a missed-milestone row (always under Overdue). */
  taxAudit?: TodayTaxAuditMilestones;
  /** The return, on an ITR e-verification row (under Due this week, or Overdue). */
  itr?: TodayItrVerify;
  link: WorkItemRef;
  /**
   * Rows waiting on the client of a filing: offer a WhatsApp reminder beside
   * the firm's channel — the client has a usable phone and the firm reminds
   * another way (PS-001). Absent on other rows.
   */
  offersWhatsapp?: boolean;
}

export interface TodayGroupResult {
  group: TodayGroup;
  items: TodayItem[];
  total: number;
}

/** GET /work/today (?engagementId= narrows it to one engagement — WF-204). */
export interface TodayView {
  /** IST date the list was built for (YYYY-MM-DD). */
  today: string;
  groups: TodayGroupResult[];
}

/**
 * Today's order inside a group: overdue first, then by due date (todayDueDate),
 * undated last, then title. Pure — shared by the API, web and mobile, and tested.
 */
export function compareTodayItems(a: TodayItem, b: TodayItem): number {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  const da = todayDueDate(a);
  const db = todayDueDate(b);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

/**
 * The date a row is due by: the earlier of its internal and statutory dates,
 * whichever are set — the firm's date normally, the law's when it falls
 * first or the firm set none. Pure — shared by the API and web, and tested.
 */
export function todayDueDate(i: Pick<TodayItem, 'internalDate' | 'statutoryDate'>): string | null {
  const { internalDate: a, statutoryDate: b } = i;
  if (a === null) return b;
  if (b === null) return a;
  return b < a ? b : a;
}

/** Is a date (YYYY-MM-DD) before `today`? Null is never overdue. */
export function isPastDate(date: string | null, today: string): boolean {
  return date !== null && date < today;
}
