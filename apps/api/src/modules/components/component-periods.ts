import { BadRequestException } from '@nestjs/common';
import { RECURRENCE, type Recurrence } from '@hsdg/contracts';

/** One generated period: a stable key, a human label, and calendar bounds (ISO). */
export interface ComponentPeriod {
  key: string;
  label: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

const FY = /^(\d{4})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function iso(year: number, month0: number, day: number): string {
  const mm = String(month0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function lastDay(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** The financial year's start/end calendar years (Indian FY: 2026-27 ⇒ 2026, 2027). */
export function financialYearBounds(financialYear: string): { startYear: number; endYear: number } {
  const m = FY.exec(financialYear);
  if (!m)
    throw new BadRequestException(`Invalid financial year "${financialYear}" (expected YYYY-YY).`);
  const startYear = Number(m[1]);
  return { startYear, endYear: startYear + 1 };
}

/**
 * Enumerate the periods of one financial year for a component's frequency
 * (spec §21). The engagement is scoped to a single FY, so the set is naturally
 * bounded — 12 months / 4 quarters / 2 halves / 1 year. `as_required` is ad-hoc
 * and never auto-generated (§29), so it yields no periods.
 *
 * Indian FY runs 1 April → 31 March; quarters and halves are FY-aligned.
 */
export function enumeratePeriods(frequency: Recurrence, financialYear: string): ComponentPeriod[] {
  const { startYear, endYear } = financialYearBounds(financialYear);

  switch (frequency) {
    case RECURRENCE.monthly: {
      const periods: ComponentPeriod[] = [];
      // Apr (month0 = 3) of startYear through Mar of endYear — 12 months.
      for (let i = 0; i < 12; i += 1) {
        const month0 = (3 + i) % 12;
        const year = month0 >= 3 ? startYear : endYear;
        periods.push({
          key: iso(year, month0, 1).slice(0, 7), // YYYY-MM
          label: `${MONTHS[month0]} ${year}`,
          start: iso(year, month0, 1),
          end: iso(year, month0, lastDay(year, month0)),
        });
      }
      return periods;
    }

    case RECURRENCE.quarterly: {
      // Q1 Apr–Jun (startYear) … Q4 Jan–Mar (endYear).
      const quarters: Array<[number, number, number, number]> = [
        [1, startYear, 3, startYear], // Q1: Apr–Jun
        [2, startYear, 6, startYear], // Q2: Jul–Sep
        [3, startYear, 9, startYear], // Q3: Oct–Dec
        [4, endYear, 0, endYear], // Q4: Jan–Mar (of endYear)
      ];
      return quarters.map(([n, sy, sm0]) => {
        const em0 = sm0 + 2;
        return {
          key: `${financialYear}-Q${n}`,
          label: `Q${n} ${financialYear}`,
          start: iso(sy, sm0, 1),
          end: iso(sy, em0, lastDay(sy, em0)),
        };
      });
    }

    case RECURRENCE.halfYearly: {
      return [
        {
          key: `${financialYear}-H1`,
          label: `H1 ${financialYear}`,
          start: iso(startYear, 3, 1),
          end: iso(startYear, 8, lastDay(startYear, 8)),
        }, // Apr–Sep
        {
          key: `${financialYear}-H2`,
          label: `H2 ${financialYear}`,
          start: iso(startYear, 9, 1),
          end: iso(endYear, 2, lastDay(endYear, 2)),
        }, // Oct–Mar
      ];
    }

    case RECURRENCE.annual:
    case RECURRENCE.oneTime: {
      return [
        {
          key: financialYear,
          label: `FY ${financialYear}`,
          start: iso(startYear, 3, 1), // 1 Apr
          end: iso(endYear, 2, 31), // 31 Mar
        },
      ];
    }

    case RECURRENCE.asRequired:
    default:
      return [];
  }
}
