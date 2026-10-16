/**
 * Practice Services Phase 1 (PS-102 … PS-105) — the web side of the notice
 * register: list filters → GET /notices query, the clock badge, the PDF intake
 * pre-fill, the create request and the partners' report CSV. Everything here is
 * pure (tested); the API calls live in `notices-api.ts`.
 */
import {
  NOTICE_OUTCOME_LABEL,
  NOTICE_STATUS_LABEL,
  NOTICE_STREAM_LABEL,
  noticeTypeLabel,
  type CreateNoticeRequest,
  type NoticeClock,
  type NoticeIntakeField,
  type NoticeIntakeResponse,
  type NoticeServedVia,
  type NoticeStatus,
  type NoticeStream,
  type NoticesReport,
} from '@hsdg/contracts';
import { formatDate } from './format';

// ── list filters ────────────────────────────────────────────────────────────

/** The /notices list's filters, as kept in the URL. */
export interface NoticeFilters {
  /** 'open' (the default), 'all', or one status. */
  status: NoticeStatus | 'open' | 'all';
  stream: NoticeStream | '';
  owner: 'me' | 'anyone';
  /** Clock due within 7 / 30 days (overdue included), or any date. */
  due: '7' | '30' | '';
  search: string;
}

export const DEFAULT_NOTICE_FILTERS: NoticeFilters = {
  status: 'open',
  stream: '',
  owner: 'anyone',
  due: '',
  search: '',
};

/** `2026-10-16` + 7 → `2026-10-23` (calendar days, no time zone). Pure. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Read the filters from URL params (anything unknown falls back to the default). Pure. */
export function noticeFiltersFrom(get: (key: string) => string | null): NoticeFilters {
  const status = get('status');
  const stream = get('stream');
  const due = get('due');
  return {
    status:
      status === 'all' || (status && status in NOTICE_STATUS_LABEL)
        ? (status as NoticeFilters['status'])
        : 'open',
    stream: stream && stream in NOTICE_STREAM_LABEL ? (stream as NoticeStream) : '',
    owner: get('owner') === 'me' ? 'me' : 'anyone',
    due: due === '7' || due === '30' ? due : '',
    search: get('q') ?? '',
  };
}

/** The filters as a URL patch for `useUrlState().set` (defaults drop out). Pure. */
export function noticeFiltersPatch(f: NoticeFilters): Record<string, string | null> {
  return {
    status: f.status === 'open' ? null : f.status,
    stream: f.stream || null,
    owner: f.owner === 'me' ? 'me' : null,
    due: f.due || null,
    q: f.search.trim() || null,
  };
}

/**
 * GET /notices path for the filters. `today` is the IST date; "due in 7 days"
 * becomes `dueBefore = today + 7`. Pure — tested.
 */
export function noticeListPath(
  f: NoticeFilters,
  today: string,
  opts: { cursor?: string | null; limit?: number } = {},
): string {
  const p = new URLSearchParams();
  if (f.status !== 'all') p.set('status', f.status);
  if (f.stream) p.set('stream', f.stream);
  if (f.owner === 'me') p.set('ownerId', 'me');
  if (f.due) p.set('dueBefore', addDaysIso(today, Number(f.due)));
  const search = f.search.trim();
  if (search) p.set('search', search);
  if (opts.cursor) p.set('cursor', opts.cursor);
  p.set('limit', String(opts.limit ?? 50));
  return `/notices?${p.toString()}`;
}

// ── the clock badge ─────────────────────────────────────────────────────────

export type ClockTone = 'danger' | 'warn' | 'info' | 'neutral';

export interface ClockBadgeModel {
  label: string;
  date: string;
  /** "3 days overdue", "due today", "12 days left". */
  left: string;
  tone: ClockTone;
}

/** How a notice's clock reads in a badge; null when the notice has no clock. Pure — tested. */
export function clockBadge(clock: NoticeClock | null | undefined): ClockBadgeModel | null {
  if (!clock) return null;
  const n = clock.daysLeft;
  const left =
    n < 0
      ? `${-n} day${n === -1 ? '' : 's'} overdue`
      : n === 0
        ? 'due today'
        : `${n} day${n === 1 ? '' : 's'} left`;
  const tone: ClockTone =
    clock.overdue || n < 0 ? 'danger' : n <= 3 ? 'warn' : n <= 7 ? 'info' : 'neutral';
  return { label: clock.label, date: formatDate(clock.due), left, tone };
}

// ── the new-notice form and the PDF intake ──────────────────────────────────

/** The new-notice form's values (strings, '' = not given). */
export interface NoticeFormValues {
  engagementId: string;
  noticeTypeCode: string;
  registrationId: string;
  referenceNo: string;
  issuedOn: string;
  receivedOn: string;
  servedVia: NoticeServedVia;
  financialYear: string;
  assessmentYear: string;
  periodFrom: string;
  periodTo: string;
  amountDemanded: string;
  replyDueOn: string;
  ownerId: string;
  reviewerId: string;
  summary: string;
}

export function emptyNoticeForm(today: string): NoticeFormValues {
  return {
    engagementId: '',
    noticeTypeCode: '',
    registrationId: '',
    referenceNo: '',
    issuedOn: '',
    receivedOn: today,
    servedVia: 'portal',
    financialYear: '',
    assessmentYear: '',
    periodFrom: '',
    periodTo: '',
    amountDemanded: '',
    replyDueOn: '',
    ownerId: '',
    reviewerId: '',
    summary: '',
  };
}

/** Reply due = issued on + the type's default reply days, when both are known. Pure. */
export function defaultReplyDue(
  issuedOn: string,
  defaultReplyDays: number | null | undefined,
): string {
  if (!issuedOn || defaultReplyDays == null) return '';
  return addDaysIso(issuedOn, defaultReplyDays);
}

/** The form → POST /notices (blanks dropped, amounts normalised). Pure. */
export function toCreateNoticeRequest(
  v: NoticeFormValues,
  documentId?: string | null,
): CreateNoticeRequest {
  const opt = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);
  const amount = v.amountDemanded.replace(/[,\s₹]/g, '');
  const req: CreateNoticeRequest = {
    engagementId: v.engagementId,
    noticeTypeCode: v.noticeTypeCode,
    referenceNo: v.referenceNo.trim(),
    issuedOn: v.issuedOn,
    receivedOn: v.receivedOn,
    servedVia: v.servedVia,
  };
  const optional: Partial<CreateNoticeRequest> = {
    registrationId: opt(v.registrationId),
    financialYear: opt(v.financialYear),
    assessmentYear: opt(v.assessmentYear),
    periodFrom: opt(v.periodFrom),
    periodTo: opt(v.periodTo),
    amountDemanded: amount ? amount : undefined,
    replyDueOn: opt(v.replyDueOn),
    ownerId: opt(v.ownerId),
    reviewerId: opt(v.reviewerId),
    summary: opt(v.summary),
    documentId: documentId ?? undefined,
  };
  for (const [k, val] of Object.entries(optional)) {
    if (val !== undefined) (req as unknown as Record<string, unknown>)[k] = val;
  }
  return req;
}

/** The form pre-fills a suggestion at or above this confidence … */
export const INTAKE_PREFILL_AT = 0.5;
/** … and asks the person to check anything below this. */
export const INTAKE_CHECK_BELOW = 0.8;

/** Intake fields that land straight in a form field of the same name. */
const INTAKE_FORM_FIELDS = [
  'referenceNo',
  'issuedOn',
  'replyDueOn',
  'amountDemanded',
  'financialYear',
  'assessmentYear',
  'periodFrom',
  'periodTo',
] as const satisfies readonly (NoticeIntakeField & keyof NoticeFormValues)[];

export type IntakeFormField = (typeof INTAKE_FORM_FIELDS)[number] | 'noticeTypeCode';

export interface IntakeNote {
  value: string;
  confidence: number;
  snippet: string | null;
}

export interface IntakePrefill {
  /** Values to put in the form (confidence ≥ 0.5). */
  values: Partial<Pick<NoticeFormValues, IntakeFormField>>;
  /** Pre-filled but below 0.8: shown as "check this" with the snippet. */
  check: Partial<Record<IntakeFormField, IntakeNote>>;
  /** Read but too unsure to pre-fill (< 0.5): shown as a hint only. */
  unsure: Partial<Record<IntakeFormField, IntakeNote>>;
  /** What the PDF says that is not a form field (GSTIN, PAN, form, section). */
  read: Partial<Record<'gstin' | 'pan' | 'form' | 'section', IntakeNote>>;
}

/**
 * PS-104: map the intake suggestions onto the form. ≥ 0.5 pre-fills; < 0.8 is
 * flagged "check this" with the text it was read from; < 0.5 is a hint only.
 * Nothing is saved — the person submits the form. Pure — tested.
 */
export function intakePrefill(
  r: Pick<NoticeIntakeResponse, 'fields' | 'noticeTypeCode'>,
): IntakePrefill {
  const out: IntakePrefill = { values: {}, check: {}, unsure: {}, read: {} };
  const take = (field: IntakeFormField, s: IntakeNote | null | undefined): void => {
    if (!s || !s.value) return;
    const note = { value: s.value, confidence: s.confidence, snippet: s.snippet };
    if (s.confidence >= INTAKE_PREFILL_AT) {
      out.values[field] = field === 'amountDemanded' ? s.value.replace(/[,\s₹]/g, '') : s.value;
      if (s.confidence < INTAKE_CHECK_BELOW) out.check[field] = note;
    } else {
      out.unsure[field] = note;
    }
  };
  for (const f of INTAKE_FORM_FIELDS) take(f, r.fields[f]);
  take('noticeTypeCode', r.noticeTypeCode);
  for (const f of ['gstin', 'pan', 'form', 'section'] as const) {
    const s = r.fields[f];
    if (s?.value) out.read[f] = { value: s.value, confidence: s.confidence, snippet: s.snippet };
  }
  return out;
}

// ── errors ──────────────────────────────────────────────────────────────────

export const STALE_NOTICE_MESSAGE =
  'Someone else changed this notice — reload to see their change.';

/**
 * A 409 on a versioned write is a stale copy; a duplicate reference is also a
 * 409 but says so. Pure — tested.
 */
export function isStaleNotice(status: number | undefined, message: string): boolean {
  return status === 409 && !/already|duplicate|exists/i.test(message);
}

// ── PS-105 report CSV ───────────────────────────────────────────────────────

/** The partners' report as one CSV (a Section column keeps the tables apart). Pure — tested. */
export function noticesReportCsv(r: NoticesReport): {
  headers: string[];
  rows: Array<Array<string | number | null>>;
} {
  const headers = [
    'Section',
    'Group',
    'Count',
    'Amount demanded',
    'Outcome amount',
    'Due',
    'Clock',
  ];
  const rows: Array<Array<string | number | null>> = [];
  rows.push(['Open', 'Total', r.open.total, r.open.amountDemanded, null, null, null]);
  for (const s of r.open.byStream)
    rows.push([
      'Open by stream',
      NOTICE_STREAM_LABEL[s.stream] ?? s.stream,
      s.count,
      s.amountDemanded,
      null,
      null,
      null,
    ]);
  for (const s of r.open.byStatus)
    rows.push([
      'Open by status',
      NOTICE_STATUS_LABEL[s.status] ?? s.status,
      s.count,
      null,
      null,
      null,
      null,
    ]);
  for (const o of r.open.byOffice)
    rows.push(['Open by office', o.officeName, o.count, o.amountDemanded, null, null, null]);
  rows.push([
    'Closed',
    'Total',
    r.closed.count,
    r.closed.amountDemanded,
    r.closed.outcomeAmount,
    null,
    null,
  ]);
  for (const o of r.closed.byOutcome)
    rows.push([
      'Closed by outcome',
      NOTICE_OUTCOME_LABEL[o.outcome] ?? o.outcome,
      o.count,
      o.amountDemanded,
      o.outcomeAmount,
      null,
      null,
    ]);
  for (const n of r.dueSoon)
    rows.push([
      'Due in 7 days',
      `${n.entityName} · ${noticeTypeLabel(n.noticeType)} · ${n.referenceNo}`,
      1,
      n.amountDemanded,
      null,
      n.clock?.due ?? null,
      n.clock?.label ?? null,
    ]);
  // The mean sits in the Count column: days, to one decimal.
  rows.push([
    'Average days to reply',
    'All',
    r.avgDaysToReply == null ? null : Math.round(r.avgDaysToReply * 10) / 10,
    null,
    null,
    null,
    null,
  ]);
  return { headers, rows };
}
