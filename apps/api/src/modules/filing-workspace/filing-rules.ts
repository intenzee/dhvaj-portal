/**
 * Change 5 — the rules of the filing workspace, pure and DI-free: who may do
 * what, when a filing is read-only, how a reference number and filing date are
 * checked, and the labels the year → period tree shows.
 */
import {
  FILING_REFERENCE_KIND,
  LODGE_UNDO_LEAD_HOURS,
  LODGE_UNDO_TEAM_DAYS,
  STRICT_FIRM_CHECKS,
  calendarHalfLabel,
  type CrossCheckWarning,
  type FilingReferenceKind,
  type FirmChecks,
} from '@hsdg/contracts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The reference a stream's portal issues on filing. Inward reconciliation,
 * Bookkeeping and MIS close inside the firm, so they carry an internal one.
 */
export function defaultReferenceKind(
  stream: string | null,
  section?: string | null,
): FilingReferenceKind {
  if (section === 'inward') return FILING_REFERENCE_KIND.internal;
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

/**
 * Filing date: not after today, not before the period ends. A meeting is held
 * during its period (a board meeting on 15 May is Apr–Jun's), so its held-on
 * date need only be on or after the period start.
 */
export function checkFiledOn(
  filedOn: string,
  today: string,
  periodEnd: string | null,
  meeting?: { periodStart: string | null },
): string | null {
  const what = meeting ? 'meeting date' : 'filing date';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn) || Number.isNaN(Date.parse(filedOn))) {
    return `The ${what} must be a date (YYYY-MM-DD).`;
  }
  if (filedOn > today) return `The ${what} cannot be in the future.`;
  if (meeting) {
    if (meeting.periodStart && filedOn < meeting.periodStart) {
      return 'The meeting date cannot be before the period starts.';
    }
    return null;
  }
  if (periodEnd && filedOn < periodEnd) return 'The filing date cannot be before the period ends.';
  return null;
}

/** A meeting's internal reference when none is given: MTG-<held on>. */
export function meetingReference(heldOn: string): string {
  return `MTG-${heldOn}`;
}

/**
 * Undo a lodge: a partner any time. With the firm's undo check on, a lead
 * within 24 hours; with it off, anyone on the filing within 7 days. Reason
 * required either way.
 */
export function undoAllowed(
  input: {
    isLead: boolean;
    isPartner: boolean;
    isMember?: boolean;
    recordedAt: Date;
    now: Date;
  },
  checks: Pick<FirmChecks, 'undo_lead_only'> = STRICT_FIRM_CHECKS,
): { ok: true } | { ok: false; why: string } {
  if (input.isPartner) return { ok: true };
  const hours = (input.now.getTime() - input.recordedAt.getTime()) / 3_600_000;
  if (!checks.undo_lead_only) {
    if (!input.isLead && !input.isMember) {
      return { ok: false, why: 'Only someone working on this engagement can undo a lodge.' };
    }
    if (hours > LODGE_UNDO_TEAM_DAYS * 24) {
      return {
        ok: false,
        why: `After ${LODGE_UNDO_TEAM_DAYS} days only a partner can undo a lodge.`,
      };
    }
    return { ok: true };
  }
  if (!input.isLead)
    return { ok: false, why: 'Only the engagement manager or partner can undo a lodge.' };
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
 * Inward become read-only for slots and figures once that month's 3B is filed
 * — while the firm's lock_after_summary check is on.
 */
export function lockState(
  input: {
    workflowStatus: string;
    section: string | null;
    summaryFiledLabel: string | null;
  },
  checks: Pick<FirmChecks, 'lock_after_summary'> = STRICT_FIRM_CHECKS,
): { isLocked: boolean; reason: string | null } {
  if (input.workflowStatus === 'filed')
    return { isLocked: true, reason: 'Filed — undo the lodge to change it.' };
  if (input.workflowStatus === 'not_applicable') {
    return { isLocked: true, reason: 'Marked not applicable.' };
  }
  if (
    checks.lock_after_summary &&
    (input.section === 'outward' || input.section === 'inward') &&
    input.summaryFiledLabel
  ) {
    return { isLocked: true, reason: `${input.summaryFiledLabel} is filed for this period.` };
  }
  return { isLocked: false, reason: null };
}

/**
 * Who may lodge: with lodge_assignee_only on, the assignee or a lead (else
 * anyone on the filing); with lodge_ready_to_file on, staff only once it is
 * Ready to file (a lead any time).
 */
export function mayLodge(
  input: { isLead: boolean; isAssignee: boolean; isMember: boolean; workflowStatus: string },
  checks: Pick<FirmChecks, 'lodge_assignee_only' | 'lodge_ready_to_file'> = STRICT_FIRM_CHECKS,
): { ok: true } | { ok: false; why: string } {
  if (checks.lodge_assignee_only ? !input.isLead && !input.isAssignee : !input.isMember) {
    return {
      ok: false,
      why: checks.lodge_assignee_only
        ? 'Only the person this filing is assigned to, or the engagement partner or manager, ' +
          'can lodge it. Ask the engagement manager to assign the filing to you.'
        : 'Only someone working on this engagement can lodge it.',
    };
  }
  if (checks.lodge_ready_to_file && !input.isLead && input.workflowStatus !== 'ready_to_file') {
    return {
      ok: false,
      why: 'This filing is not Ready to file yet — it needs the reviewer’s approval first.',
    };
  }
  return { ok: true };
}

export function canFlags(
  input: {
    isLead: boolean;
    isPartner: boolean;
    isAssignee: boolean;
    isMember: boolean;
    workflowStatus: string;
    isLocked: boolean;
    hasLiveFiling: boolean;
    liveRecordedAt: Date | null;
    now: Date;
  },
  checks: FirmChecks = STRICT_FIRM_CHECKS,
): { lodge: boolean; undo: boolean; waive: boolean; edit: boolean; certify: boolean } {
  const open = !input.hasLiveFiling && input.workflowStatus !== 'not_applicable';
  return {
    lodge: open && mayLodge(input, checks).ok,
    undo:
      input.hasLiveFiling &&
      !!input.liveRecordedAt &&
      undoAllowed(
        {
          isLead: input.isLead,
          isPartner: input.isPartner,
          isMember: input.isMember,
          recordedAt: input.liveRecordedAt,
          now: input.now,
        },
        checks,
      ).ok,
    waive:
      (checks.waive_lead_only ? input.isLead : input.isMember || input.isLead) &&
      !input.hasLiveFiling,
    edit: input.isMember && !input.isLocked,
    certify: input.isPartner && input.isMember && !input.isLocked,
  };
}

/**
 * What a live lodge still lacks — recorded while the firm's checks were off —
 * so the team can tidy it up: the acknowledgement, the reference, a reference
 * in the wrong shape, a filing date outside the period's rules, the figures.
 */
export function lodgeWarnings(input: {
  referenceKind: FilingReferenceKind;
  referenceNo: string | null;
  ackDocumentId: string | null;
  filedOn: string;
  today: string;
  periodEnd: string | null;
  periodStart: string | null;
  stream: string | null;
  isMeeting: boolean;
  figuresMissing: boolean;
}): CrossCheckWarning[] {
  const out: CrossCheckWarning[] = [];
  if (!input.ackDocumentId) {
    out.push({
      code: 'ack_missing',
      message: 'Filed — the acknowledgement is still to be added.',
    });
  }
  if (!input.referenceNo) {
    out.push({
      code: 'reference_missing',
      message: 'Filed — the reference number is still to be added.',
    });
  } else {
    const ref = checkReference(input.referenceKind, input.referenceNo, input.stream);
    if ('error' in ref)
      out.push({ code: 'reference_format', message: `Check the reference: ${ref.error}` });
  }
  const dateRule = checkFiledOn(
    input.filedOn,
    input.today,
    input.periodEnd,
    input.isMeeting ? { periodStart: input.periodStart } : undefined,
  );
  if (dateRule) out.push({ code: 'filed_date', message: `Check the date: ${dateRule}` });
  if (input.figuresMissing) {
    out.push({ code: 'figures_missing', message: 'Filed — the figures are still to be entered.' });
  }
  return out;
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
  const ch = /^(\d{4}-\d{2}):(CH[12])$/.exec(periodKey);
  if (ch) return calendarHalfLabel(ch[1]!, ch[2] as 'CH1' | 'CH2');
  const din = /^(\d{4}-\d{2}):DIN:(.+)$/.exec(periodKey);
  if (din) return `FY ${din[1]} · DIN ${din[2]}`;
  if (periodKey.startsWith('EVT:')) return 'Event';
  return periodKey;
}

/**
 * The filing's period as read: its key's label, else — a filing added by hand
 * carries no key — its reference month's; null when it has neither.
 */
export function workspacePeriodLabel(
  periodKey: string | null,
  referenceMonth: string | null,
): string | null {
  return periodLabel(periodKey ?? referenceMonth) || null;
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
