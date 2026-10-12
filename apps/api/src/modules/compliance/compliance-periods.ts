import {
  CALCULATION_BASIS,
  type CalculationBasis,
  type RuleFrequency,
  type WorkingDayAdjustment,
} from '@hsdg/contracts';
import {
  computeDeadlines,
  evaluateCondition,
  financialYearEndYear,
  parseISODate,
  resolveReferenceDate,
  toISODate,
} from './compliance-calc';

/**
 * Calendar v2 period engine (spec Change 4). Pure, like compliance-calc: it
 * turns a rule version + a financial year into the periods the rule runs for
 * and the due date of each, covering what offsets alone cannot express —
 * per-period schedules (TDS statements, advance tax), one-month exceptions
 * (TDS challan in March), period filters (IFF / PMT-06 in M1, M2), profile
 * variants (QRMP 3B on the 22nd or 24th), provisional event dates (AOC-4
 * before the AGM is held) and three-year cycles (DIR-3 KYC).
 */

/** One row of a `schedule` basis: due on day/month of (FY start year + year_offset). */
export interface ScheduleEntry {
  /** Period tag: 'Q1'..'Q4', 'H1'/'H2', 'M1'..'M3', a month '04'..'03', or 'FY'. */
  period: string;
  month: number;
  day: number;
  year_offset?: number;
}

/** A one-period exception to an offset rule, keyed by period-end month ('03') or tag ('Q4'). */
export interface PeriodOverride {
  month: number;
  day: number;
  /** Years after the period-end year; omitted ⇒ the first such date after the period end. */
  year_offset?: number;
}

/** Assumed event date (FY start year + year_offset) until the real event is recorded. */
export interface ProvisionalEventRule {
  month: number;
  day: number;
  year_offset?: number;
}

/** The scheduling fields of one compliance_rule_versions row (snake_case JSON kept as stored). */
export interface PeriodRuleVersion {
  calculationBasis: CalculationBasis;
  frequency: RuleFrequency | null;
  offsetMonths: number;
  offsetDays: number;
  offsetWorkingDays?: boolean;
  fixedMonth: number | null;
  fixedDay: number | null;
  workingDayAdjustment: WorkingDayAdjustment;
  internalSlaOffsetDays: number;
  schedule: ScheduleEntry[] | null;
  periodOverrides: Record<string, PeriodOverride> | null;
  periodFilter: string[] | null;
  provisionalEventRule: ProvisionalEventRule | null;
  eventType: string | null;
  formLabel: string | null;
  section: string | null;
  isOptional: boolean;
  condition: unknown;
  variants: RuleVariant[] | null;
}

/** `{when, set}` — when the condition holds, the listed fields replace the version's. */
export interface RuleVariant {
  when: unknown;
  set: Record<string, unknown>;
}

export interface Period {
  /** See PeriodKey in contracts: 'YYYY-MM', 'YYYY-YY:Q1', 'YYYY-YY:H1', 'YYYY-YY'. */
  key: string;
  financialYear: string;
  start: string;
  end: string;
  /** Tags a schedule / filter / override can match, most specific first. */
  tags: string[];
  label: string;
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad2 = (n: number): string => n.toString().padStart(2, '0');

export function fyStartYear(financialYear: string): number {
  return financialYearEndYear(financialYear) - 1;
}

/** '2026-27' for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYearOf(isoDate: string): string {
  const d = parseISODate(isoDate);
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${pad2((y + 1) % 100)}`;
}

function monthEnd(year: number, monthIndex0: number): Date {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0));
}

function clampedDate(year: number, month1: number, day: number): Date {
  const last = monthEnd(year, month1 - 1).getUTCDate();
  return new Date(Date.UTC(year, month1 - 1, Math.min(day, last)));
}

/** FY month n (0 = April … 11 = March) as [year, monthIndex0]. */
function fyMonth(financialYear: string, n: number): [number, number] {
  const start = fyStartYear(financialYear);
  const m = 3 + n;
  return [start + Math.floor(m / 12), m % 12];
}

function span(
  financialYear: string,
  firstMonth: number,
  months: number,
): { start: Date; end: Date } {
  const [sy, sm] = fyMonth(financialYear, firstMonth);
  const [ey, em] = fyMonth(financialYear, firstMonth + months - 1);
  return { start: new Date(Date.UTC(sy, sm, 1)), end: monthEnd(ey, em) };
}

/**
 * The periods a recurring rule runs for inside one financial year. Event and
 * on-demand rules have none (they are created when the event is recorded or by
 * hand); triennial rules run on the year itself and are filtered per director.
 */
export function periodsForFrequency(
  frequency: RuleFrequency | null,
  financialYear: string,
): Period[] {
  switch (frequency) {
    case 'monthly':
      return Array.from({ length: 12 }, (_, n) => {
        const { start, end } = span(financialYear, n, 1);
        const mm = pad2(start.getUTCMonth() + 1);
        return {
          key: `${start.getUTCFullYear()}-${mm}`,
          financialYear,
          start: toISODate(start),
          end: toISODate(end),
          tags: [mm, `M${(n % 3) + 1}`],
          label: `${MONTH_SHORT[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
        };
      });
    case 'quarterly':
      return Array.from({ length: 4 }, (_, q) => {
        const { start, end } = span(financialYear, q * 3, 3);
        return {
          key: `${financialYear}:Q${q + 1}`,
          financialYear,
          start: toISODate(start),
          end: toISODate(end),
          tags: [`Q${q + 1}`],
          label: `Q${q + 1} ${financialYear} (${MONTH_SHORT[start.getUTCMonth()]}–${MONTH_SHORT[end.getUTCMonth()]})`,
        };
      });
    case 'half_yearly':
      return Array.from({ length: 2 }, (_, h) => {
        const { start, end } = span(financialYear, h * 6, 6);
        return {
          key: `${financialYear}:H${h + 1}`,
          financialYear,
          start: toISODate(start),
          end: toISODate(end),
          tags: [`H${h + 1}`],
          label: `H${h + 1} ${financialYear} (${MONTH_SHORT[start.getUTCMonth()]}–${MONTH_SHORT[end.getUTCMonth()]})`,
        };
      });
    case 'annual':
    case 'triennial': {
      const { start, end } = span(financialYear, 0, 12);
      return [
        {
          key: financialYear,
          financialYear,
          start: toISODate(start),
          end: toISODate(end),
          tags: ['FY'],
          label: `FY ${financialYear}`,
        },
      ];
    }
    default:
      return [];
  }
}

/** The period of `frequency` that contains `isoDate` (used for event instances). */
export function periodContaining(frequency: RuleFrequency, isoDate: string): Period | null {
  const fy = financialYearOf(isoDate);
  return (
    periodsForFrequency(frequency, fy).find((p) => p.start <= isoDate && isoDate <= p.end) ?? null
  );
}

/** Does `period` pass the rule's period_filter (e.g. ['M1','M2'] for IFF)? */
export function passesPeriodFilter(filter: readonly string[] | null, period: Period): boolean {
  if (!filter || filter.length === 0) return true;
  return period.tags.some((t) => filter.includes(t));
}

/** True when a director's three-year KYC cycle falls due in `financialYear`. */
export function isTriennialDue(cycleStartFy: string, financialYear: string): boolean {
  const diff = fyStartYear(financialYear) - fyStartYear(cycleStartFy);
  return diff >= 0 && diff % 3 === 0;
}

/** Evaluate a condition, reading a field the context lacks as "does not apply". */
export function conditionHolds(condition: unknown, context: Record<string, unknown>): boolean {
  try {
    return evaluateCondition(condition, context);
  } catch {
    return false;
  }
}

const VARIANT_FIELDS: Record<string, keyof PeriodRuleVersion> = {
  calculation_basis: 'calculationBasis',
  offset_months: 'offsetMonths',
  offset_days: 'offsetDays',
  fixed_month: 'fixedMonth',
  fixed_day: 'fixedDay',
  internal_sla_offset_days: 'internalSlaOffsetDays',
  schedule: 'schedule',
  period_overrides: 'periodOverrides',
  period_filter: 'periodFilter',
  provisional_event_rule: 'provisionalEventRule',
  event_type: 'eventType',
  form_label: 'formLabel',
  is_optional: 'isOptional',
};

/** Apply every matching variant in order (later ones win). Unknown keys are ignored. */
export function applyVariants(
  version: PeriodRuleVersion,
  context: Record<string, unknown>,
): PeriodRuleVersion {
  if (!version.variants?.length) return version;
  let out: PeriodRuleVersion = version;
  for (const v of version.variants) {
    if (!conditionHolds(v.when, context)) continue;
    const patch: Partial<PeriodRuleVersion> = {};
    for (const [k, value] of Object.entries(v.set ?? {})) {
      const field = VARIANT_FIELDS[k];
      if (field) (patch as Record<string, unknown>)[field] = value;
    }
    out = { ...out, ...patch };
  }
  return out;
}

export interface PeriodDue {
  referenceDate: string;
  statutoryDeadline: string;
  internalSlaDate: string;
  /** Computed from the provisional event date (no event recorded yet). */
  isProvisional: boolean;
}

function scheduleDate(entry: ScheduleEntry, financialYear: string): Date {
  return clampedDate(fyStartYear(financialYear) + (entry.year_offset ?? 0), entry.month, entry.day);
}

function overrideDate(o: PeriodOverride, periodEnd: Date): Date {
  const endYear = periodEnd.getUTCFullYear();
  if (o.year_offset !== undefined) return clampedDate(endYear + o.year_offset, o.month, o.day);
  const sameYear = clampedDate(endYear, o.month, o.day);
  return sameYear > periodEnd ? sameYear : clampedDate(endYear + 1, o.month, o.day);
}

/** The deadlines for a date fixed by schedule or override: the statutory date as
 *  given (adjusted per the rule), the SLA pulled back to a working day. */
function fromDueDate(
  due: Date,
  referenceDate: Date,
  version: PeriodRuleVersion,
  holidays: ReadonlySet<string>,
): PeriodDue {
  const d = computeDeadlines(
    {
      referenceDate: due,
      offsetMonths: 0,
      offsetDays: 0,
      workingDayAdjustment: version.workingDayAdjustment,
      internalSlaOffsetDays: version.internalSlaOffsetDays,
    },
    holidays,
  );
  return { referenceDate: toISODate(referenceDate), ...d, isProvisional: false };
}

/**
 * The due dates of one period, or null when the rule has no date for it (a
 * schedule without a row for the period, or an event rule with neither a
 * recorded nor a provisional event date).
 */
export function dueForPeriod(
  version: PeriodRuleVersion,
  period: Period,
  holidays: ReadonlySet<string>,
  eventDate?: string | null,
): PeriodDue | null {
  const periodEnd = parseISODate(period.end);

  if (version.calculationBasis === CALCULATION_BASIS.schedule) {
    const entry = version.schedule?.find((e) => period.tags.includes(e.period));
    if (!entry) return null;
    return fromDueDate(scheduleDate(entry, period.financialYear), periodEnd, version, holidays);
  }

  if (version.calculationBasis === CALCULATION_BASIS.eventDate) {
    let ref: Date;
    let isProvisional = false;
    if (eventDate) {
      ref = parseISODate(eventDate);
    } else if (version.provisionalEventRule) {
      const p = version.provisionalEventRule;
      ref = clampedDate(fyStartYear(period.financialYear) + (p.year_offset ?? 0), p.month, p.day);
      isProvisional = true;
    } else {
      return null;
    }
    const d = computeDeadlines(
      {
        referenceDate: ref,
        offsetMonths: version.offsetMonths,
        offsetDays: version.offsetDays,
        offsetWorkingDays: version.offsetWorkingDays ?? false,
        workingDayAdjustment: version.workingDayAdjustment,
        internalSlaOffsetDays: version.internalSlaOffsetDays,
      },
      holidays,
    );
    return { referenceDate: toISODate(ref), ...d, isProvisional };
  }

  const overrides = version.periodOverrides;
  if (overrides) {
    const key = [pad2(periodEnd.getUTCMonth() + 1), ...period.tags].find((k) => overrides[k]);
    if (key)
      return fromDueDate(overrideDate(overrides[key]!, periodEnd), periodEnd, version, holidays);
  }

  const ref =
    version.calculationBasis === CALCULATION_BASIS.periodStart
      ? parseISODate(period.start)
      : version.calculationBasis === CALCULATION_BASIS.periodEnd ||
          version.calculationBasis === CALCULATION_BASIS.monthEnd
        ? periodEnd
        : resolveReferenceDate(version.calculationBasis, {
            financialYear: period.financialYear,
            fixedMonth: version.fixedMonth,
            fixedDay: version.fixedDay,
          });
  const d = computeDeadlines(
    {
      referenceDate: ref,
      offsetMonths: version.offsetMonths,
      offsetDays: version.offsetDays,
      offsetWorkingDays: version.offsetWorkingDays ?? false,
      workingDayAdjustment: version.workingDayAdjustment,
      internalSlaOffsetDays: version.internalSlaOffsetDays,
    },
    holidays,
  );
  return { referenceDate: toISODate(ref), ...d, isProvisional: false };
}

/** Days from `today` to `due` (negative when past). */
export function daysUntil(due: string, today: string): number {
  return Math.round((parseISODate(due).getTime() - parseISODate(today).getTime()) / 86_400_000);
}

/** Sheet colours: red ≤ 7 days or overdue, amber ≤ 30, grey when filed / waived / passed. */
export type DueBand = 'red' | 'amber' | 'none' | 'grey';

export function dueBand(
  due: string,
  today: string,
  workflowStatus: string,
): { band: DueBand; daysLeft: number } {
  const daysLeft = daysUntil(due, today);
  if (workflowStatus === 'filed' || workflowStatus === 'not_applicable') {
    return { band: 'grey', daysLeft };
  }
  if (daysLeft <= 7) return { band: 'red', daysLeft };
  if (daysLeft <= 30) return { band: 'amber', daysLeft };
  return { band: 'none', daysLeft };
}

/**
 * Single-instance generation (POST /engagements/:id/compliance) on a version
 * the plain offset engine cannot express — a schedule, a one-month override or
 * a provisional event date. The period is the one containing the caller's
 * reference / event date, else the year (FY end). Null when the version needs
 * no period engine (the caller keeps the classic path).
 */
export function legacyPeriodDue(
  version: PeriodRuleVersion,
  financialYear: string,
  anchor: { referenceDate?: string | null; eventDate?: string | null },
  holidays: ReadonlySet<string>,
): PeriodDue | null {
  const needsPeriods =
    version.calculationBasis === CALCULATION_BASIS.schedule ||
    (version.periodOverrides !== null && Object.keys(version.periodOverrides).length > 0) ||
    version.provisionalEventRule !== null;
  if (!needsPeriods) return null;
  const date =
    anchor.referenceDate ?? anchor.eventDate ?? `${financialYearEndYear(financialYear)}-03-31`;
  const frequency =
    version.frequency && version.frequency !== 'event' && version.frequency !== 'on_demand'
      ? version.frequency === 'triennial'
        ? 'annual'
        : version.frequency
      : 'annual';
  const period = periodContaining(frequency, date);
  if (!period) return null;
  return dueForPeriod(version, period, holidays, anchor.eventDate ?? null);
}
