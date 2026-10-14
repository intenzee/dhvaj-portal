/**
 * ROC / MCA events (docs/roc-mca-filing-spec.md §6–§7) — the pure parts:
 * what details each event takes, how they reach the rules, the AGM extension,
 * the CHG-1 additional-fee window and the board-meeting cadence. DI-free and
 * DB-free so they are unit-tested on their own.
 */
import type { BoardMeetingCadence, ComplianceEventType } from '@hsdg/contracts';
import type { PeriodRuleVersion } from './compliance-periods';

const DIN = /^[0-9]{8}$/;

/**
 * Check and clean an event's details. Unknown keys are dropped; an event type
 * that takes no details gets {}. Returns the details or a message for a 400.
 */
export function validateEventDetails(
  eventType: ComplianceEventType | string,
  raw: unknown,
): { details: Record<string, unknown> } | { error: string } {
  const d = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const bool = (k: string): boolean | undefined =>
    typeof d[k] === 'boolean' ? (d[k] as boolean) : undefined;
  const text = (k: string, max: number): string | undefined =>
    typeof d[k] === 'string' && (d[k] as string).trim()
      ? (d[k] as string).trim().slice(0, max)
      : undefined;
  const clean = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

  switch (eventType) {
    case 'agm':
      return { details: clean({ auditorAppointed: bool('auditorAppointed') }) };
    case 'allotment':
      return { details: clean({ privatePlacement: bool('privatePlacement') }) };
    case 'agm_extension': {
      const months = d.months;
      if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 3) {
        return { error: 'An AGM extension is 1, 2 or 3 months.' };
      }
      return { details: clean({ months, approvalRef: text('approvalRef', 60) }) };
    }
    case 'director_change': {
      const din = typeof d.din === 'string' ? d.din.trim() : '';
      if (!DIN.test(din)) return { error: 'Enter the director’s 8-digit DIN.' };
      if (d.change !== 'appointed' && d.change !== 'ceased') {
        return { error: 'Say whether the director was appointed or ceased.' };
      }
      return { details: clean({ din, name: text('name', 120), change: d.change }) };
    }
    case 'charge_creation': {
      const amount = d.amount;
      if (amount !== undefined && (typeof amount !== 'number' || !(amount >= 0))) {
        return { error: 'The charge amount must be a positive number.' };
      }
      return {
        details: clean({ chargeHolder: text('chargeHolder', 160), amount }),
      };
    }
    default:
      return { details: {} };
  }
}

const snake = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * The rule context an event adds: `<event_type>_<snake_case detail>` for each
 * scalar detail (agm.auditorAppointed → agm_auditor_appointed = true).
 */
export function eventContext(
  event: { event_type: string; details?: Record<string, unknown> | null } | null | undefined,
): Record<string, unknown> {
  if (!event) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event.details ?? {})) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[`${event.event_type}_${snake(k)}`] = v;
    }
  }
  return out;
}

/**
 * The ROC's AGM extension (spec P2-2, up to three months, never the first
 * AGM): the AGM's own due date moves by the months granted, and so does the
 * provisional AGM date the AGM-linked forms (AOC-4, MGT-7, ADT-1) run from
 * until the AGM is recorded — to the end of the extended month.
 */
export function withAgmExtension(
  version: PeriodRuleVersion,
  ruleCode: string,
  months: number,
): PeriodRuleVersion {
  if (!months) return version;
  if (ruleCode === 'ROC_AGM') {
    return { ...version, offsetMonths: version.offsetMonths + months };
  }
  if (version.eventType === 'agm' && version.provisionalEventRule) {
    const p = version.provisionalEventRule;
    const raw = p.month + months;
    return {
      ...version,
      provisionalEventRule: {
        month: ((raw - 1) % 12) + 1,
        // the last day of the month (clamped by dueForPeriod)
        day: 31,
        year_offset: (p.year_offset ?? 0) + Math.floor((raw - 1) / 12),
      },
    };
  }
  return version;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * CHG-1 (spec P2-3): due in 30 days of the charge; the Registrar allows a
 * further 60 days with an additional fee; after day 90 it is beyond the window.
 */
export function chargeFilingWindow(
  eventDate: string,
  today: string,
): { status: 'on_time' | 'fee_window' | 'beyond_window'; feeWindowEnds: string; day: number } {
  const day = daysBetween(eventDate, today);
  const feeWindowEnds = addDays(eventDate, 90);
  return {
    status: day <= 30 ? 'on_time' : day <= 90 ? 'fee_window' : 'beyond_window',
    feeWindowEnds,
    day,
  };
}

/**
 * The next board meeting (spec §5.2 / P2-6): no more than 120 days after the
 * last one; a small company or OPC holds one in each half of the calendar year,
 * at least 90 days apart.
 */
export function boardMeetingCadence(
  reg: { id: string; number: string },
  heldOn: readonly string[],
  companySubtype: string | null | undefined,
): BoardMeetingCadence {
  const halves = companySubtype === 'small' || companySubtype === 'opc';
  const last = [...heldOn].sort().at(-1) ?? null;
  if (!last) {
    return {
      registrationId: reg.id,
      registrationNumber: reg.number,
      lastHeldOn: null,
      dueBy: null,
      notBefore: null,
      rule: halves ? 'calendar_half' : 'every_120_days',
    };
  }
  if (halves) {
    // One meeting in the next calendar half, not within 90 days of the last.
    const y = Number(last.slice(0, 4));
    const inFirstHalf = Number(last.slice(5, 7)) <= 6;
    return {
      registrationId: reg.id,
      registrationNumber: reg.number,
      lastHeldOn: last,
      dueBy: inFirstHalf ? `${y}-12-31` : `${y + 1}-06-30`,
      notBefore: addDays(last, 90),
      rule: 'calendar_half',
    };
  }
  return {
    registrationId: reg.id,
    registrationNumber: reg.number,
    lastHeldOn: last,
    dueBy: addDays(last, 120),
    notBefore: null,
    rule: 'every_120_days',
  };
}

/**
 * Why the ROC tab has nothing to show (spec G13): ROC applies to companies and
 * LLPs; a firm or proprietorship is not an MCA entity, and a company or LLP
 * needs its CIN / LLPIN on record.
 */
export function rocEmptyMessage(
  entityCategory: string | null,
  registrationCount: number,
): string | null {
  if (registrationCount > 0) return null;
  if (entityCategory === 'company' || entityCategory === 'llp') {
    return 'Add the CIN (or LLPIN) to the client to see its ROC filings.';
  }
  return 'ROC / MCA filings apply to companies and LLPs. This client is not registered with the MCA, so there is nothing to file with the ROC.';
}
