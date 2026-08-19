import { BadRequestException } from '@nestjs/common';
import {
  CALCULATION_BASIS,
  WORKING_DAY_ADJUSTMENT,
  type CalculationBasis,
  type WorkingDayAdjustment,
} from '@hsdg/contracts';

/**
 * The pure compliance-date engine (Phase 8, ADR-0013). Deliberately free of any
 * database or framework state so every calculation rule is unit-testable in
 * isolation. All arithmetic is in UTC to keep results independent of the host
 * timezone; dates cross the boundary as 'YYYY-MM-DD' strings.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseISODate(value: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new BadRequestException(`Invalid date "${value}" (expected YYYY-MM-DD).`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  // Reject impossible dates that JS would have rolled over (e.g. 2026-02-30).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m! - 1 || date.getUTCDate() !== d) {
    throw new BadRequestException(`Invalid calendar date "${value}".`);
  }
  return date;
}

export function toISODate(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Add whole months, clamping the day to the target month's length. */
export function addMonthsUTC(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, day));
}

export function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

/**
 * Nudge a date off weekends and holidays in the given direction. `none` returns
 * the date untouched; `next`/`previous` step one day at a time until a working
 * day is found. `holidays` is a set of 'YYYY-MM-DD' strings.
 */
export function adjustWorkingDay(
  date: Date,
  adjustment: WorkingDayAdjustment,
  holidays: ReadonlySet<string>,
): Date {
  if (adjustment === WORKING_DAY_ADJUSTMENT.none) return date;
  const step = adjustment === WORKING_DAY_ADJUSTMENT.previous ? -1 : 1;
  let d = date;
  // Bounded to a fortnight of steps — no realistic run of non-working days is
  // longer, and it guarantees termination against a misconfigured holiday set.
  for (let i = 0; i < 14; i += 1) {
    if (!isWeekend(d) && !holidays.has(toISODate(d))) return d;
    d = addDaysUTC(d, step);
  }
  return d;
}

export interface ReferenceContext {
  /** 'YYYY-YY' — used by fy_end and fixed_date to find the relevant year. */
  financialYear?: string | null;
  /** Explicit basis date (period_end / month_end), or an fy_end override. */
  referenceDate?: string | null;
  /** Event date (event_date basis). */
  eventDate?: string | null;
  fixedMonth?: number | null;
  fixedDay?: number | null;
}

const FY = /^\d{4}-\d{2}$/;

/** The financial year's ending calendar year (Indian FY: 2026-27 ⇒ 2027). */
export function financialYearEndYear(financialYear: string): number {
  if (!FY.test(financialYear)) {
    throw new BadRequestException(`Invalid financial year "${financialYear}" (expected YYYY-YY).`);
  }
  return Number(financialYear.slice(0, 4)) + 1;
}

/**
 * Resolve the basis (reference) date the deadline is measured from. This is
 * where each {@link CalculationBasis} is interpreted; the offset/working-day
 * arithmetic that follows is basis-agnostic.
 */
export function resolveReferenceDate(basis: CalculationBasis, ctx: ReferenceContext): Date {
  switch (basis) {
    case CALCULATION_BASIS.fyEnd: {
      if (ctx.referenceDate) return parseISODate(ctx.referenceDate);
      if (!ctx.financialYear) {
        throw new BadRequestException('fy_end basis requires the engagement financial year.');
      }
      return new Date(Date.UTC(financialYearEndYear(ctx.financialYear), 2, 31)); // 31 March
    }
    case CALCULATION_BASIS.periodEnd:
    case CALCULATION_BASIS.monthEnd: {
      if (!ctx.referenceDate) {
        throw new BadRequestException(`${basis} basis requires an explicit referenceDate.`);
      }
      return parseISODate(ctx.referenceDate);
    }
    case CALCULATION_BASIS.fixedDate: {
      if (!ctx.fixedMonth || !ctx.fixedDay) {
        throw new BadRequestException('fixed_date basis requires fixedMonth and fixedDay.');
      }
      const year = ctx.referenceDate
        ? parseISODate(ctx.referenceDate).getUTCFullYear()
        : ctx.financialYear
          ? financialYearEndYear(ctx.financialYear)
          : undefined;
      if (year === undefined) {
        throw new BadRequestException(
          'fixed_date basis requires a financial year (or referenceDate) to anchor the year.',
        );
      }
      const day = Math.min(ctx.fixedDay, daysInMonth(year, ctx.fixedMonth - 1));
      return new Date(Date.UTC(year, ctx.fixedMonth - 1, day));
    }
    case CALCULATION_BASIS.eventDate: {
      if (!ctx.eventDate) {
        throw new BadRequestException('event_date basis requires an eventDate.');
      }
      return parseISODate(ctx.eventDate);
    }
    default:
      throw new BadRequestException(`Unknown calculation basis "${basis as string}".`);
  }
}

export interface ComputeInput {
  referenceDate: Date;
  offsetMonths: number;
  offsetDays: number;
  workingDayAdjustment: WorkingDayAdjustment;
  internalSlaOffsetDays: number;
}

export interface ComputedDeadlines {
  statutoryDeadline: string;
  internalSlaDate: string;
}

/**
 * Both clocks from one reference date. The statutory deadline is reference +
 * offset (months then days), working-day adjusted per the rule. The internal
 * SLA is the statutory deadline minus the firm's buffer, always pulled back to
 * a working day — so it lands on or before the statutory date, never after.
 */
export function computeDeadlines(
  input: ComputeInput,
  holidays: ReadonlySet<string>,
): ComputedDeadlines {
  const withMonths = addMonthsUTC(input.referenceDate, input.offsetMonths);
  const raw = addDaysUTC(withMonths, input.offsetDays);
  const statutory = adjustWorkingDay(raw, input.workingDayAdjustment, holidays);

  const slaRaw = addDaysUTC(statutory, -input.internalSlaOffsetDays);
  const sla = adjustWorkingDay(slaRaw, WORKING_DAY_ADJUSTMENT.previous, holidays);

  return { statutoryDeadline: toISODate(statutory), internalSlaDate: toISODate(sla) };
}

// ── Conditional applicability ───────────────────────────────────────────────

type Comparison = { field: string; op: string; value: number | string | boolean };
type ConditionNode =
  Comparison | { all: ConditionNode[] } | { any: ConditionNode[] } | { not: ConditionNode };

/**
 * Evaluate a rule's configurable condition against context supplied at
 * generation time. Supports comparisons ({field, op, value}) and all/any/not
 * combinators. A missing referenced field is an error (a conditional rule must
 * be given the data it needs — never silently skipped). No condition ⇒ applies.
 */
export function evaluateCondition(condition: unknown, context: Record<string, unknown>): boolean {
  if (condition === null || condition === undefined) return true;
  return evalNode(condition as ConditionNode, context);
}

function evalNode(node: ConditionNode, context: Record<string, unknown>): boolean {
  if ('all' in node) return node.all.every((n) => evalNode(n, context));
  if ('any' in node) return node.any.some((n) => evalNode(n, context));
  if ('not' in node) return !evalNode(node.not, context);
  if ('field' in node) return evalComparison(node, context);
  throw new BadRequestException('Invalid compliance condition shape.');
}

function evalComparison(cmp: Comparison, context: Record<string, unknown>): boolean {
  if (!(cmp.field in context)) {
    throw new BadRequestException(
      `Compliance condition needs context field "${cmp.field}", which was not supplied.`,
    );
  }
  const left = context[cmp.field];
  const right = cmp.value;
  switch (cmp.op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      throw new BadRequestException(`Unsupported condition operator "${cmp.op}".`);
  }
}
