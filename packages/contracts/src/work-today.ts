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
 * - waiting: my blocked tasks, and open client requests I am responsible for.
 * - due_soon: open filings on work I prepare, review or lead whose internal
 *   date is within a week (or past) — including filings with no task yet —
 *   less any already listed above.
 */
export const TODAY_GROUP = {
  prepare: 'prepare',
  review: 'review',
  notices: 'notices',
  waiting: 'waiting',
  dueSoon: 'due_soon',
} as const;
export type TodayGroup = (typeof TODAY_GROUP)[keyof typeof TODAY_GROUP];
export const TODAY_GROUPS: TodayGroup[] = Object.values(TODAY_GROUP);

export const TODAY_GROUP_LABEL: Record<TodayGroup, string> = {
  prepare: 'To prepare',
  review: 'To review',
  notices: 'Notices',
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
  /** Past its internal date (IST) and still open. */
  isOverdue: boolean;
  blockedByOpenCount: number;
  /** The task, when the row is one (or the filing has one). */
  task: TodayTask | null;
  /** The notice, on a "Notices" row (its `internalDate` is the clock's date). */
  notice?: TodayNotice;
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
 * Today's order inside a group: overdue first, then by internal date, undated
 * last, then title. Pure — shared by the API, web and mobile, and tested.
 */
export function compareTodayItems(a: TodayItem, b: TodayItem): number {
  if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
  const da = a.internalDate;
  const db = b.internalDate;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

/** Is a date (YYYY-MM-DD) before `today`? Null is never overdue. */
export function isPastDate(date: string | null, today: string): boolean {
  return date !== null && date < today;
}
