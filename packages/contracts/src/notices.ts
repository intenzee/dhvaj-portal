/**
 * Practice Services PS-101 — the notice register: every notice the firm
 * handles for a client (GST ASMT-10, income-tax 143(2), TDS 200A, ROC s.206 …)
 * as a tracked item with an owner, dates, documents and an outcome. Shared by
 * the API, the web app and the mobile app; `noticeClock` is the one rule for
 * "what date matters now" on every list.
 *
 * Tables: hsdg.notice_types (the library), hsdg.notices, hsdg.notice_events
 * (migration 1772300600000_notices.sql). Read through RLS: the team of the
 * engagement a notice is worked under sees it, nobody else.
 */

export const NOTICE_STREAM = {
  gst: 'gst',
  incomeTax: 'income_tax',
  tds: 'tds',
  roc: 'roc',
  other: 'other',
} as const;
export type NoticeStream = (typeof NOTICE_STREAM)[keyof typeof NOTICE_STREAM];
export const NOTICE_STREAMS: NoticeStream[] = Object.values(NOTICE_STREAM);
export const NOTICE_STREAM_LABEL: Record<NoticeStream, string> = {
  gst: 'GST',
  income_tax: 'Income tax',
  tds: 'TDS',
  roc: 'ROC',
  other: 'Other',
};

export const NOTICE_STATUS = {
  received: 'received',
  inProgress: 'in_progress',
  replyFiled: 'reply_filed',
  hearingScheduled: 'hearing_scheduled',
  orderReceived: 'order_received',
  appealed: 'appealed',
  closed: 'closed',
  withdrawn: 'withdrawn',
} as const;
export type NoticeStatus = (typeof NOTICE_STATUS)[keyof typeof NOTICE_STATUS];
export const NOTICE_STATUSES: NoticeStatus[] = Object.values(NOTICE_STATUS);
export const NOTICE_STATUS_LABEL: Record<NoticeStatus, string> = {
  received: 'Received',
  in_progress: 'Reply in progress',
  reply_filed: 'Reply filed',
  hearing_scheduled: 'Hearing scheduled',
  order_received: 'Order received',
  appealed: 'Appealed',
  closed: 'Closed',
  withdrawn: 'Withdrawn',
};
/** Statuses a notice is finished in: no clock, off Today and the open lists. */
export const NOTICE_DONE_STATUSES: readonly NoticeStatus[] = ['closed', 'withdrawn'];
export function isNoticeOpen(status: NoticeStatus): boolean {
  return !NOTICE_DONE_STATUSES.includes(status);
}

export const NOTICE_OUTCOME = {
  dropped: 'dropped',
  demandConfirmed: 'demand_confirmed',
  demandReduced: 'demand_reduced',
  rectified: 'rectified',
} as const;
export type NoticeOutcome = (typeof NOTICE_OUTCOME)[keyof typeof NOTICE_OUTCOME];
export const NOTICE_OUTCOMES: NoticeOutcome[] = Object.values(NOTICE_OUTCOME);
export const NOTICE_OUTCOME_LABEL: Record<NoticeOutcome, string> = {
  dropped: 'Dropped',
  demand_confirmed: 'Demand confirmed',
  demand_reduced: 'Demand reduced',
  rectified: 'Rectified',
};

export const NOTICE_SERVED_VIA = {
  portal: 'portal',
  email: 'email',
  post: 'post',
  inPerson: 'in_person',
} as const;
export type NoticeServedVia = (typeof NOTICE_SERVED_VIA)[keyof typeof NOTICE_SERVED_VIA];
export const NOTICE_SERVED_VIAS: NoticeServedVia[] = Object.values(NOTICE_SERVED_VIA);
export const NOTICE_SERVED_VIA_LABEL: Record<NoticeServedVia, string> = {
  portal: 'Portal',
  email: 'E-mail',
  post: 'Post',
  in_person: 'In person',
};

export const NOTICE_EVENT_KIND = {
  replyFiled: 'reply_filed',
  adjournmentSought: 'adjournment_sought',
  adjournmentGranted: 'adjournment_granted',
  hearing: 'hearing',
  submission: 'submission',
  order: 'order',
  rectification: 'rectification',
  note: 'note',
} as const;
export type NoticeEventKind = (typeof NOTICE_EVENT_KIND)[keyof typeof NOTICE_EVENT_KIND];
export const NOTICE_EVENT_KINDS: NoticeEventKind[] = Object.values(NOTICE_EVENT_KIND);
export const NOTICE_EVENT_KIND_LABEL: Record<NoticeEventKind, string> = {
  reply_filed: 'Reply filed',
  adjournment_sought: 'Adjournment sought',
  adjournment_granted: 'Adjournment granted',
  hearing: 'Hearing',
  submission: 'Submission',
  order: 'Order',
  rectification: 'Rectification',
  note: 'Note',
};

/**
 * What recording an event does to the notice (the API applies it in the same
 * transaction): the status it moves to, and whether `next_date` becomes the
 * next hearing. Null status ⇒ unchanged. Pure — tested.
 */
export function noticeEventEffect(
  kind: NoticeEventKind,
  current: NoticeStatus,
): { status: NoticeStatus | null; setsHearing: boolean } {
  if (!isNoticeOpen(current)) return { status: null, setsHearing: false };
  switch (kind) {
    case 'reply_filed':
      return { status: 'reply_filed', setsHearing: false };
    case 'hearing':
    case 'adjournment_granted':
      return { status: 'hearing_scheduled', setsHearing: true };
    case 'order':
      return { status: 'order_received', setsHearing: false };
    case 'submission':
    case 'adjournment_sought':
      return { status: current === 'received' ? 'in_progress' : null, setsHearing: false };
    default:
      return { status: null, setsHearing: false };
  }
}

/** A row of the library (GET /notice-types). */
export interface NoticeType {
  id: string;
  code: string;
  stream: NoticeStream;
  form: string | null;
  section: string | null;
  title: string;
  defaultReplyDays: number | null;
  appealable: boolean;
  /** The limitation rule an order of this type starts (PS-103), e.g. GST_APPEAL_LIMITATION. */
  appealRuleCode: string | null;
  isActive: boolean;
  version: number;
}

/** "ASMT-10 · s.61 · Scrutiny of returns" — the type as a person names it. Pure. */
export function noticeTypeLabel(t: Pick<NoticeType, 'form' | 'section' | 'title'>): string {
  return [t.form, t.section, t.title].filter(Boolean).join(' · ');
}

/** PUT /notice-types/:code (workflow.manage). */
export interface UpsertNoticeTypeRequest {
  stream: NoticeStream;
  form?: string | null;
  section?: string | null;
  title: string;
  defaultReplyDays?: number | null;
  appealable: boolean;
  appealRuleCode?: string | null;
  isActive?: boolean;
  /** Required when updating an existing type (409 on stale). */
  version?: number;
}

/** The fields `noticeClock` reads. */
export interface NoticeClockInput {
  status: NoticeStatus;
  /** The firm's date (reply date less the buffer, on a working day). */
  internalDueOn: string | null;
  /** The department's date. */
  replyDueOn: string | null;
  nextHearingOn: string | null;
  /** PS-103: the appeal limitation date an appealable order set. */
  appealDueOn: string | null;
}

export type NoticeClockLabel = 'Reply due' | 'Hearing' | 'Appeal by';

export interface NoticeClock {
  /** YYYY-MM-DD. */
  due: string;
  label: NoticeClockLabel;
  /** Days from `today` to `due` (negative when past). */
  daysLeft: number;
  overdue: boolean;
}

function daysBetweenIso(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * The date that matters on a notice now, for every list and badge:
 * - a reply still to file: "Reply due" on the firm's internal date (else the
 *   department's);
 * - a hearing ahead (any open status before the order): "Hearing" — the
 *   earlier of the two when both apply;
 * - an order received with an appeal clock (PS-103): "Appeal by";
 * - closed, withdrawn, appealed, or nothing dated: null.
 * `today` is the IST date (YYYY-MM-DD). Pure — tested.
 */
export function noticeClock(n: NoticeClockInput, today: string): NoticeClock | null {
  if (!isNoticeOpen(n.status) || n.status === 'appealed') return null;
  const at = (due: string, label: NoticeClockLabel): NoticeClock => {
    const daysLeft = daysBetweenIso(today, due);
    return { due, label, daysLeft, overdue: daysLeft < 0 };
  };
  if (n.status === 'order_received') return n.appealDueOn ? at(n.appealDueOn, 'Appeal by') : null;

  const candidates: NoticeClock[] = [];
  const replyDate = n.internalDueOn ?? n.replyDueOn;
  if ((n.status === 'received' || n.status === 'in_progress') && replyDate)
    candidates.push(at(replyDate, 'Reply due'));
  if (n.nextHearingOn) candidates.push(at(n.nextHearingOn, 'Hearing'));
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.due < a.due ? b : a));
}

/** A row of GET /notices. */
export interface NoticeListItem extends NoticeClockInput {
  id: string;
  entityId: string;
  entityName: string;
  engagementId: string;
  engagementCode: string;
  registrationNumber: string | null;
  noticeType: Pick<
    NoticeType,
    'id' | 'code' | 'stream' | 'form' | 'section' | 'title' | 'appealable'
  >;
  referenceNo: string;
  issuedOn: string;
  receivedOn: string;
  financialYear: string | null;
  assessmentYear: string | null;
  amountDemanded: string | null;
  ownerId: string;
  ownerName: string;
  reviewerId: string | null;
  reviewerName: string | null;
  outcome: NoticeOutcome | null;
  version: number;
  /** noticeClock(row, today) as of the API's IST today — lists sort on it. */
  clock: NoticeClock | null;
}

export interface NoticeListResponse {
  items: NoticeListItem[];
  /** Opaque; pass back as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null;
}

/** GET /notices query. */
export interface NoticeListQuery {
  /** One status, or 'open' (every status but closed / withdrawn). */
  status?: NoticeStatus | 'open';
  stream?: NoticeStream;
  ownerId?: string;
  /** Clock due on or before this date (YYYY-MM-DD) — "due in 7 / 30 days". */
  dueBefore?: string;
  entityId?: string;
  engagementId?: string;
  /** Reference number or client name. */
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface NoticeEvent {
  id: string;
  kind: NoticeEventKind;
  occurredOn: string;
  nextDate: string | null;
  ackReference: string | null;
  documentId: string | null;
  body: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface NoticeDocument {
  id: string;
  title: string;
  filename: string | null;
  documentType: 'notice' | 'reply' | 'order';
  uploadedAt: string;
  uploadedByName: string | null;
}

/** GET /notices/:id. */
export interface Notice extends NoticeListItem {
  servedVia: NoticeServedVia;
  periodFrom: string | null;
  periodTo: string | null;
  internalDueOverride: string | null;
  outcomeAmount: string | null;
  closedOn: string | null;
  summary: string | null;
  appealInstanceId: string | null;
  events: NoticeEvent[];
  documents: NoticeDocument[];
  /** What the caller may do (notice.manage and on the team). */
  can: { edit: boolean };
  createdAt: string;
  updatedAt: string;
}

/** POST /notices (notice.manage). Amounts are decimal strings ("125000.00"). */
export interface CreateNoticeRequest {
  engagementId: string;
  noticeTypeCode: string;
  registrationId?: string | null;
  referenceNo: string;
  issuedOn: string;
  receivedOn: string;
  servedVia?: NoticeServedVia;
  financialYear?: string | null;
  assessmentYear?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  amountDemanded?: string | null;
  /** Defaults to issuedOn + the type's default reply days, when it has them. */
  replyDueOn?: string | null;
  internalDueOverride?: string | null;
  /** Defaults to the caller. */
  ownerId?: string;
  reviewerId?: string | null;
  summary?: string | null;
  /** A notice PDF already uploaded (PS-104), filed under the notice. */
  documentId?: string | null;
}

/** PATCH /notices/:id — any subset, with the version read (409 when stale). */
export interface UpdateNoticeRequest {
  version: number;
  registrationId?: string | null;
  referenceNo?: string;
  issuedOn?: string;
  receivedOn?: string;
  servedVia?: NoticeServedVia;
  financialYear?: string | null;
  assessmentYear?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  amountDemanded?: string | null;
  replyDueOn?: string | null;
  internalDueOverride?: string | null;
  ownerId?: string;
  reviewerId?: string | null;
  summary?: string | null;
  /** Only received ↔ in_progress, or withdrawn; the rest follow events and close. */
  status?: 'received' | 'in_progress' | 'withdrawn';
}

/** POST /notices/:id/events. A hearing needs `nextDate` (the hearing date). */
export interface AddNoticeEventRequest {
  version: number;
  kind: NoticeEventKind;
  occurredOn: string;
  nextDate?: string | null;
  ackReference?: string | null;
  documentId?: string | null;
  body?: string | null;
}

/** POST /notices/:id/events/:eventId/void. */
export interface VoidNoticeEventRequest {
  version: number;
  reason: string;
}

/** POST /notices/:id/close. */
export interface CloseNoticeRequest {
  version: number;
  outcome: NoticeOutcome;
  outcomeAmount?: string | null;
  closedOn: string;
}
