import { BadRequestException } from '@nestjs/common';
import {
  addMonthsUTC,
  addWorkingDaysUTC,
  adjustWorkingDay,
  computeDeadlines,
  evaluateCondition,
  financialYearEndYear,
  parseISODate,
  resolveReferenceDate,
  toISODate,
} from './compliance-calc';

const NO_HOLIDAYS = new Set<string>();

describe('compliance-calc', () => {
  describe('parseISODate', () => {
    it('parses a valid UTC date', () => {
      expect(toISODate(parseISODate('2026-03-31'))).toBe('2026-03-31');
    });
    it.each(['2026-13-01', '2026-02-30', '26-1-1', 'not-a-date'])('rejects %p', (v) => {
      expect(() => parseISODate(v)).toThrow(BadRequestException);
    });
  });

  describe('addMonthsUTC (clamps to month length)', () => {
    it('Jan 31 + 1 month → Feb 28 (non-leap)', () => {
      expect(toISODate(addMonthsUTC(parseISODate('2026-01-31'), 1))).toBe('2026-02-28');
    });
    it('Mar 31 + 7 months → Oct 31', () => {
      expect(toISODate(addMonthsUTC(parseISODate('2027-03-31'), 7))).toBe('2027-10-31');
    });
  });

  describe('financialYearEndYear', () => {
    it('2026-27 → 2027', () => {
      expect(financialYearEndYear('2026-27')).toBe(2027);
    });
    it('rejects malformed FY', () => {
      expect(() => financialYearEndYear('2026')).toThrow(BadRequestException);
    });
  });

  describe('resolveReferenceDate', () => {
    it('fy_end derives 31 March of the FY end year', () => {
      expect(toISODate(resolveReferenceDate('fy_end', { financialYear: '2026-27' }))).toBe(
        '2027-03-31',
      );
    });
    it('fixed_date anchors month/day in the FY end year', () => {
      expect(
        toISODate(
          resolveReferenceDate('fixed_date', {
            financialYear: '2026-27',
            fixedMonth: 10,
            fixedDay: 31,
          }),
        ),
      ).toBe('2027-10-31');
    });
    it('fixed_date clamps an out-of-range day (Feb 31 → Feb 28)', () => {
      expect(
        toISODate(
          resolveReferenceDate('fixed_date', {
            financialYear: '2026-27',
            fixedMonth: 2,
            fixedDay: 31,
          }),
        ),
      ).toBe('2027-02-28');
    });
    it('period_end / event_date require their explicit input', () => {
      expect(() => resolveReferenceDate('period_end', {})).toThrow(BadRequestException);
      expect(() => resolveReferenceDate('event_date', {})).toThrow(BadRequestException);
      expect(toISODate(resolveReferenceDate('event_date', { eventDate: '2026-08-15' }))).toBe(
        '2026-08-15',
      );
    });
  });

  describe('adjustWorkingDay', () => {
    // 2026-01-03 is a Saturday; 01-02 Friday; 01-05 Monday.
    it('none leaves the date untouched', () => {
      expect(toISODate(adjustWorkingDay(parseISODate('2026-01-03'), 'none', NO_HOLIDAYS))).toBe(
        '2026-01-03',
      );
    });
    it('next moves a Saturday to Monday', () => {
      expect(toISODate(adjustWorkingDay(parseISODate('2026-01-03'), 'next', NO_HOLIDAYS))).toBe(
        '2026-01-05',
      );
    });
    it('previous moves a Saturday to Friday', () => {
      expect(toISODate(adjustWorkingDay(parseISODate('2026-01-03'), 'previous', NO_HOLIDAYS))).toBe(
        '2026-01-02',
      );
    });
    it('skips holidays as well as weekends', () => {
      // Mon 2026-01-05 is a holiday → next working day is Tue 2026-01-06.
      const holidays = new Set(['2026-01-05']);
      expect(toISODate(adjustWorkingDay(parseISODate('2026-01-03'), 'next', holidays))).toBe(
        '2026-01-06',
      );
    });
  });

  describe('computeDeadlines (two clocks)', () => {
    it('FY_END + 7 months (ITR-style), no working-day adjustment', () => {
      const ref = resolveReferenceDate('fy_end', { financialYear: '2026-27' });
      const { statutoryDeadline } = computeDeadlines(
        {
          referenceDate: ref,
          offsetMonths: 7,
          offsetDays: 0,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 0,
        },
        NO_HOLIDAYS,
      );
      expect(statutoryDeadline).toBe('2027-10-31');
    });

    it('PERIOD_END + 20 days (GST-style)', () => {
      const ref = resolveReferenceDate('period_end', { referenceDate: '2026-05-31' });
      const { statutoryDeadline } = computeDeadlines(
        {
          referenceDate: ref,
          offsetMonths: 0,
          offsetDays: 20,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 0,
        },
        NO_HOLIDAYS,
      );
      expect(statutoryDeadline).toBe('2026-06-20');
    });

    it('internal SLA = statutory − buffer, pulled back to a working day (before statutory)', () => {
      // Statutory Thu 2026-01-15; SLA raw = Sat 2026-01-10 → previous → Fri 2026-01-09.
      const { statutoryDeadline, internalSlaDate } = computeDeadlines(
        {
          referenceDate: parseISODate('2026-01-15'),
          offsetMonths: 0,
          offsetDays: 0,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 5,
        },
        NO_HOLIDAYS,
      );
      expect(statutoryDeadline).toBe('2026-01-15');
      expect(internalSlaDate).toBe('2026-01-09');
    });
  });

  describe('evaluateCondition', () => {
    it('no condition ⇒ applies', () => {
      expect(evaluateCondition(null, {})).toBe(true);
      expect(evaluateCondition(undefined, {})).toBe(true);
    });
    it('comparison operators', () => {
      const cond = { field: 'turnover', op: '>', value: 10_000_000 };
      expect(evaluateCondition(cond, { turnover: 20_000_000 })).toBe(true);
      expect(evaluateCondition(cond, { turnover: 5_000_000 })).toBe(false);
    });
    it('all / any / not combinators', () => {
      const ctx = { turnover: 20_000_000, audited: true };
      expect(
        evaluateCondition(
          {
            all: [
              { field: 'turnover', op: '>=', value: 10_000_000 },
              { field: 'audited', op: '==', value: true },
            ],
          },
          ctx,
        ),
      ).toBe(true);
      expect(evaluateCondition({ any: [{ field: 'turnover', op: '<', value: 1 }] }, ctx)).toBe(
        false,
      );
      expect(evaluateCondition({ not: { field: 'audited', op: '==', value: true } }, ctx)).toBe(
        false,
      );
    });
    it('throws when a referenced context field is missing (never silently skips)', () => {
      expect(() => evaluateCondition({ field: 'turnover', op: '>', value: 1 }, {})).toThrow(
        BadRequestException,
      );
    });
  });

  describe('§4 calculation methods', () => {
    it('period_start basis anchors on the supplied reference (period start)', () => {
      const ref = resolveReferenceDate('period_start', { referenceDate: '2026-04-01' });
      expect(toISODate(ref)).toBe('2026-04-01');
    });

    it('addWorkingDaysUTC skips weekends', () => {
      // Fri 2026-06-19 + 1 working day ⇒ Mon 2026-06-22 (skips Sat/Sun).
      expect(toISODate(addWorkingDaysUTC(parseISODate('2026-06-19'), 1, NO_HOLIDAYS))).toBe(
        '2026-06-22',
      );
      // + 3 working days ⇒ Wed 2026-06-24.
      expect(toISODate(addWorkingDaysUTC(parseISODate('2026-06-19'), 3, NO_HOLIDAYS))).toBe(
        '2026-06-24',
      );
    });

    it('addWorkingDaysUTC skips holidays and steps backwards for negatives', () => {
      const holidays = new Set(['2026-06-22']);
      // Fri +1 working day, Mon is a holiday ⇒ Tue 2026-06-23.
      expect(toISODate(addWorkingDaysUTC(parseISODate('2026-06-19'), 1, holidays))).toBe(
        '2026-06-23',
      );
      // Mon 2026-06-22 − 1 working day ⇒ Fri 2026-06-19.
      expect(toISODate(addWorkingDaysUTC(parseISODate('2026-06-22'), -1, NO_HOLIDAYS))).toBe(
        '2026-06-19',
      );
    });

    it('computeDeadlines counts the offset in working days when offsetWorkingDays is set', () => {
      // Reference Fri 2026-06-19, +2 WORKING days ⇒ Tue 2026-06-23 (vs +2 calendar ⇒ Sun 21).
      const wd = computeDeadlines(
        {
          referenceDate: parseISODate('2026-06-19'),
          offsetMonths: 0,
          offsetDays: 2,
          offsetWorkingDays: true,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 0,
        },
        NO_HOLIDAYS,
      );
      expect(wd.statutoryDeadline).toBe('2026-06-23');
      const cal = computeDeadlines(
        {
          referenceDate: parseISODate('2026-06-19'),
          offsetMonths: 0,
          offsetDays: 2,
          offsetWorkingDays: false,
          workingDayAdjustment: 'none',
          internalSlaOffsetDays: 0,
        },
        NO_HOLIDAYS,
      );
      expect(cal.statutoryDeadline).toBe('2026-06-21');
    });
  });
});
