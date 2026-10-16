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
  /** An employee id, or 'me' for the caller. */
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
  /** The Assignment engagement opened when the partner chose "Appeal" (PS-103). */
  appealEngagementId: string | null;
  appealEngagementCode: string | null;
  events: NoticeEvent[];
  documents: NoticeDocument[];
  /**
   * What the caller may do. edit: notice.manage and on the team. appeal: an
   * order is on file for an appealable type and no appeal is open yet.
   */
  can: { edit: boolean; appeal: boolean };
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

// ── PS-103 · after the order ────────────────────────────────────────────────

/**
 * POST /notices/:id/appeal — the partner chose to appeal the order. Opens an
 * Assignment engagement (GST_APPEAL or TAX_APPEAL) on the client, linked to the
 * notice, with the limitation date as its internal due date; status → appealed.
 */
export interface AppealNoticeRequest {
  version: number;
  /** Defaults to the notice's engagement partner. */
  partnerId?: string;
  /** Defaults to the notice owner. */
  managerId?: string;
  note?: string | null;
}
export interface AppealNoticeResponse {
  notice: Notice;
  engagementId: string;
  engagementCode: string;
}
// "Accept" is POST /notices/:id/close with the outcome.

// ── PS-104 · intake from the PDF ────────────────────────────────────────────

/** Fields notice-extract can suggest from a notice's OCR text. */
export type NoticeIntakeField =
  | 'gstin'
  | 'pan'
  | 'referenceNo'
  | 'issuedOn'
  | 'replyDueOn'
  | 'section'
  | 'form'
  | 'amountDemanded'
  | 'financialYear'
  | 'assessmentYear'
  | 'periodFrom'
  | 'periodTo';

export interface NoticeIntakeSuggestion {
  value: string;
  /** 0–1. The form pre-fills at or above 0.5 and flags anything below 0.8. */
  confidence: number;
  /** The text the value was read from, for the person to check. */
  snippet: string | null;
}

/** A client (and its open engagements) whose GSTIN / PAN matches the notice. */
export interface NoticeIntakeClientMatch {
  entityId: string;
  entityName: string;
  matchedOn: 'gstin' | 'pan';
  registrationId: string | null;
  engagements: { id: string; code: string; name: string }[];
}

/**
 * POST /notices/intake { documentId } — read an uploaded notice PDF
 * (document_type 'notice') and suggest the form's fields. Nothing is saved;
 * the person confirms each field and creates the notice with POST /notices
 * passing the same documentId.
 */
export interface NoticeIntakeRequest {
  documentId: string;
}
export interface NoticeIntakeResponse {
  documentId: string;
  /** The OCR state of the document; 'pending' → poll again shortly. */
  ocrStatus: 'pending' | 'done' | 'failed' | 'not_applicable';
  fields: Partial<Record<NoticeIntakeField, NoticeIntakeSuggestion>>;
  /** The library code that best fits the form / section read, if any. */
  noticeTypeCode: NoticeIntakeSuggestion | null;
  clients: NoticeIntakeClientMatch[];
}

// ── PS-105 · the partners' report ──────────────────────────────────────────

/** GET /reports/notices?officeId= — scoped by row-level security. */
export interface NoticesReport {
  asOf: string;
  open: {
    total: number;
    amountDemanded: string;
    byStream: { stream: NoticeStream; count: number; amountDemanded: string }[];
    byStatus: { status: NoticeStatus; count: number }[];
    byOffice: { officeId: string; officeName: string; count: number; amountDemanded: string }[];
  };
  /** Open notices whose clock falls due in the next 7 days (or is overdue). */
  dueSoon: NoticeListItem[];
  closed: {
    count: number;
    amountDemanded: string;
    outcomeAmount: string;
    byOutcome: {
      outcome: NoticeOutcome;
      count: number;
      amountDemanded: string;
      outcomeAmount: string;
    }[];
  };
  /** Mean days from received_on to the first reply_filed event; null when none. */
  avgDaysToReply: number | null;
}
