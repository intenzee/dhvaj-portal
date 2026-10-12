/**
 * Change 5 — the rules of the filing workspace, pure and DI-free: who may do
 * what, when a filing is read-only, how a reference number and filing date are
 * checked, and the labels the year → period tree shows.
 */
import {
  FILING_REFERENCE_KIND,
  LODGE_UNDO_LEAD_HOURS,
  type FilingReferenceKind,
} from '@hsdg/contracts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The reference a stream's portal issues on filing. */
export function defaultReferenceKind(stream: string | null): FilingReferenceKind {
  switch (stream) {
    case 'gst':
      return FILING_REFERENCE_KIND.arn;
    case 'roc':
      return FILING_REFERENCE_KIND.srn;
    case 'tds':
      return FILING_REFERENCE_KIND.token;
    case 'income_tax':
      return FILING_REFERENCE_KIND.ack;
    default:
      return FILING_REFERENCE_KIND.internal;
  }
}

/** Normalise and check a reference number. Returns the clean value or an error. */
export function checkReference(
  kind: FilingReferenceKind,
  raw: string,
  stream: string | null,
): { value: string } | { error: string } {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (kind === FILING_REFERENCE_KIND.arn && stream === 'gst') {
    if (!/^[A-Z0-9]{15}$/.test(value)) {
      return { error: 'A GST ARN is 15 characters, letters and digits only.' };
    }
    return { value };
  }
  if (!/^[A-Z0-9/-]{3,40}$/.test(value)) {
    return { error: 'The reference number is 3–40 letters, digits, "/" or "-".' };
  }
  return { value };
}

/** Filing date: not after today, not before the period ends. */
export function checkFiledOn(
  filedOn: string,
  today: string,
  periodEnd: string | null,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn) || Number.isNaN(Date.parse(filedOn))) {
    return 'The filing date must be a date (YYYY-MM-DD).';
  }
  if (filedOn > today) return 'The filing date cannot be in the future.';
  if (periodEnd && filedOn < periodEnd) return 'The filing date cannot be before the period ends.';
  return null;
}

/** Undo a lodge: a lead within 24 hours, a partner any time. Reason required. */
export function undoAllowed(input: {
  isLead: boolean;
  isPartner: boolean;
  recordedAt: Date;
  now: Date;
}): { ok: true } | { ok: false; why: string } {
  if (input.isPartner) return { ok: true };
  if (!input.isLead)
    return { ok: false, why: 'Only the engagement manager or partner can undo a lodge.' };
  const hours = (input.now.getTime() - input.recordedAt.getTime()) / 3_600_000;
  if (hours > LODGE_UNDO_LEAD_HOURS) {
    return {
      ok: false,
      why: `After ${LODGE_UNDO_LEAD_HOURS} hours only a partner can undo a lodge.`,
    };
  }
  return { ok: true };
}

/**
 * A filing is read-only once it is filed or waived; a month's Outward and
 * Inward become read-only for slots and figures once that month's 3B is filed.
 */
export function lockState(input: {
  workflowStatus: string;
  section: string | null;
  summaryFiledLabel: string | null;
}): { isLocked: boolean; reason: string | null } {
  if (input.workflowStatus === 'filed')
    return { isLocked: true, reason: 'Filed — undo the lodge to change it.' };
  if (input.workflowStatus === 'not_applicable') {
    return { isLocked: true, reason: 'Marked not applicable.' };
  }
  if ((input.section === 'outward' || input.section === 'inward') && input.summaryFiledLabel) {
    return { isLocked: true, reason: `${input.summaryFiledLabel} is filed for this period.` };
  }
  return { isLocked: false, reason: null };
}

export function canFlags(input: {
  isLead: boolean;
  isPartner: boolean;
  isAssignee: boolean;
  isMember: boolean;
  workflowStatus: string;
  isLocked: boolean;
  hasLiveFiling: boolean;
  liveRecordedAt: Date | null;
  now: Date;
}): { lodge: boolean; undo: boolean; waive: boolean; edit: boolean } {
  const open = !input.hasLiveFiling && input.workflowStatus !== 'not_applicable';
  return {
    lodge: open && (input.isLead || (input.isAssignee && input.workflowStatus === 'ready_to_file')),
    undo:
      input.hasLiveFiling &&
      !!input.liveRecordedAt &&
      undoAllowed({
        isLead: input.isLead,
        isPartner: input.isPartner,
        recordedAt: input.liveRecordedAt,
        now: input.now,
      }).ok,
    waive: input.isLead && !input.hasLiveFiling,
    edit: input.isMember && !input.isLocked,
  };
}

/** The twelve month keys of a financial year '2026-27', April to March. */
export function fyMonths(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = i < 9 ? start : start + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}

/** The quarter (Q1 = Apr–Jun) a month key falls in. */
export function quarterOfMonth(monthKey: string): string {
  const m = Number(monthKey.slice(5, 7));
  return `Q${Math.floor(((m + 8) % 12) / 3) + 1}`;
}

/** The month key a quarterly period shows on (the quarter's last month). */
export function lastMonthOfQuarter(fy: string, quarter: string): string | null {
  const n = Number(quarter.replace(/^Q/, ''));
  if (!(n >= 1 && n <= 4)) return null;
  return fyMonths(fy)[n * 3 - 1] ?? null;
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const FY_KEY = /^\d{4}-\d{2}$/;

/** Human label for a period key. */
export function periodLabel(periodKey: string | null): string {
  if (!periodKey) return '';
  const month = MONTH_KEY.exec(periodKey);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  if (FY_KEY.test(periodKey)) return `FY ${periodKey}`;
  const sub = /^(\d{4}-\d{2}):(Q[1-4]|H[1-2])$/.exec(periodKey);
  if (sub) return `${sub[2]} ${sub[1]}`;
  const din = /^(\d{4}-\d{2}):DIN:(.+)$/.exec(periodKey);
  if (din) return `FY ${din[1]} · DIN ${din[2]}`;
  if (periodKey.startsWith('EVT:')) return 'Event';
  return periodKey;
}

/** Year-level keys ('2026-27', '2026-27:H1', '2026-27:DIN:…') hang off the annual strip. */
export function isAnnualKey(periodKey: string | null): boolean {
  if (!periodKey || MONTH_KEY.test(periodKey)) return false;
  return /^\d{4}-\d{2}(:H[1-2]|:DIN:.+)?$/.test(periodKey);
}

/** "3B due in 4 days — ITC reconciliation pending". */
export function nextActionText(input: {
  label: string;
  dueDate: string;
  today: string;
  pendingLabel: string | null;
  workflowStatus: string;
}): string {
  const days = Math.round((Date.parse(input.dueDate) - Date.parse(input.today)) / 86_400_000);
  const when =
    days < 0
      ? `overdue by ${-days} day${days === -1 ? '' : 's'}`
      : days === 0
        ? 'due today'
        : `due in ${days} day${days === 1 ? '' : 's'}`;
  const tail =
    input.workflowStatus === 'ready_to_file'
      ? 'ready to file'
      : input.workflowStatus === 'in_review'
        ? 'in review'
        : input.workflowStatus === 'awaiting_data'
          ? 'waiting on client data'
          : input.pendingLabel
            ? `${input.pendingLabel} pending`
            : null;
  return tail ? `${input.label} ${when} — ${tail}` : `${input.label} ${when}`;
}

/**
 * Indicative GST late fee and interest for an item past its due date (spec:
 * ₹50/day, ₹20 if nil; 18% p.a. on tax). Shown as a hint, never posted.
 */
export function indicativeLateCharges(input: {
  dueDate: string;
  asOf: string;
  isNil: boolean;
  taxPayable: number | null;
}): { daysLate: number; lateFee: number; interest: number | null } | null {
  const days = Math.round((Date.parse(input.asOf) - Date.parse(input.dueDate)) / 86_400_000);
  if (days <= 0) return null;
  const lateFee = days * (input.isNil ? 20 : 50);
  const interest =
    input.taxPayable !== null
      ? Math.round(((input.taxPayable * 0.18 * days) / 365) * 100) / 100
      : null;
  return { daysLate: days, lateFee, interest };
}
