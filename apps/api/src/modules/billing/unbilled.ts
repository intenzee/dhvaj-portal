import { fromPaise, toPaise, type BillingFrequency, type UnbilledItem } from '@hsdg/contracts';

/** How far back the unbilled list looks, in months: older periods were billed by hand. */
export const UNBILLED_LOOKBACK_MONTHS = 12;

/** Billing models with no fixed fee to bill. */
const NOT_FIXED = new Set(['time_and_material', 'pro_bono', 'not_billed']);

/** What the due-period calculator reads for one engagement. */
export interface FeeTerms {
  /** engagement_commercial.billing_frequency; null when never configured. */
  frequency: BillingFrequency | null;
  /** engagement_commercial.effective_date, else the planned start. */
  startDate: string | null;
  endDate: string | null;
  /** The retainer per billing period. */
  retainerAmount: string | null;
  /** engagements.billing_model. */
  billingModel: string | null;
  /** completed or closed: an on-completion fee is due. */
  completed: boolean;
  /** Compliance years with a fee. Any fee here replaces the retainer. */
  years: {
    id: string;
    financialYear: string;
    feeAmount: string | null;
    billingModel: string | null;
    closed: boolean;
  }[];
}

interface Period {
  suffix: string;
  label: string;
  start: string;
  end: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fyLabel = (startYear: number): string =>
  `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
const fyStartYear = (date: string): number => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
};
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function month(y: number, m: number): Period {
  return {
    suffix: iso(y, m, 1).slice(0, 7),
    label: `${MONTH_NAMES[m - 1]} ${y}`,
    start: iso(y, m, 1),
    end: iso(y, m, lastDay(y, m)),
  };
}

/** Indian FY quarter q (1 = Apr–Jun) of the FY starting in April of fy. */
function quarter(fy: number, q: number): Period {
  const m = 4 + (q - 1) * 3;
  const y = m > 12 ? fy + 1 : fy;
  const sm = m > 12 ? m - 12 : m;
  return {
    suffix: `${fyLabel(fy)}:Q${q}`,
    label: `Q${q} ${fyLabel(fy)} (${MONTHS[sm - 1]}–${MONTHS[sm + 1]} ${y})`,
    start: iso(y, sm, 1),
    end: iso(y, sm + 2, lastDay(y, sm + 2)),
  };
}

function financialYear(fy: number): Period {
  return {
    suffix: fyLabel(fy),
    label: `FY ${fyLabel(fy)}`,
    start: iso(fy, 4, 1),
    end: iso(fy + 1, 3, 31),
  };
}

/** The month, quarter or FY periods of a frequency that start in [from, to]. */
function periodsBetween(
  frequency: 'monthly' | 'quarterly' | 'annual',
  from: string,
  to: string,
): Period[] {
  const out: Period[] = [];
  if (frequency === 'annual') {
    for (let fy = fyStartYear(from); iso(fy, 4, 1) <= to; fy++) out.push(financialYear(fy));
  } else if (frequency === 'quarterly') {
    for (let fy = fyStartYear(from); iso(fy, 4, 1) <= to; fy++) {
      for (let q = 1; q <= 4; q++) out.push(quarter(fy, q));
    }
  } else {
    let [y, m] = from.split('-').map(Number) as [number, number];
    while (iso(y, m, 1) <= to) {
      out.push(month(y, m));
      if (m === 12) {
        y += 1;
        m = 1;
      } else {
        m += 1;
      }
    }
  }
  // A period is due once it has begun and while the terms run.
  return out.filter((p) => p.start <= to && p.end >= from);
}

function lookbackStart(asOf: string): string {
  const [y, m] = asOf.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) - UNBILLED_LOOKBACK_MONTHS;
  return iso(Math.floor(total / 12), (total % 12) + 1, 1);
}

const isPeriodic = (f: BillingFrequency | null): f is 'monthly' | 'quarterly' | 'annual' =>
  f === 'monthly' || f === 'quarterly' || f === 'annual';

function item(
  key: string,
  source: UnbilledItem['source'],
  p: Period,
  amount: bigint,
  asOf: string,
): UnbilledItem {
  return {
    key,
    source,
    label: p.label,
    periodStart: p.start,
    periodEnd: p.end,
    amount: fromPaise(amount),
    ageDays: Math.max(0, daysBetween(p.end, asOf)),
  };
}

/** The retainer: its amount for every period due since it took effect. */
function retainerItems(t: FeeTerms, asOf: string): UnbilledItem[] {
  const amount = t.retainerAmount ? toPaise(t.retainerAmount) : 0n;
  if (amount <= 0n) return [];
  const f = t.frequency ?? 'monthly';
  if (isPeriodic(f)) {
    if (!t.startDate) return [];
    const from = [t.startDate, lookbackStart(asOf)].sort()[1]!;
    const to = t.endDate && t.endDate < asOf ? t.endDate : asOf;
    return periodsBetween(f, from, to).map((p) =>
      item(`retainer:${p.suffix}`, 'retainer', p, amount, asOf),
    );
  }
  const start = t.startDate ?? asOf;
  const once = {
    suffix: 'once',
    label: 'Fixed fee',
    start,
    end: [start, t.endDate ?? asOf].sort()[1]!,
  };
  const due = (f === 'one_time' && start <= asOf) || (f === 'on_completion' && t.completed);
  if (due) return [item('retainer:once', 'retainer', once, amount, asOf)];
  return []; // milestone and event fees need their milestones and events
}

/** A compliance year's fee, shared over its months or quarters (the last takes the paise). */
function yearItems(t: FeeTerms, asOf: string): UnbilledItem[] {
  const out: UnbilledItem[] = [];
  const from = lookbackStart(asOf);
  // Never configured: the year's fee is billed in one.
  const f: BillingFrequency = t.frequency ?? 'annual';
  for (const y of t.years) {
    const fee = y.feeAmount ? toPaise(y.feeAmount) : 0n;
    if (fee <= 0n || NOT_FIXED.has(y.billingModel ?? t.billingModel ?? '')) continue;
    const fy = Number(y.financialYear.slice(0, 4));
    const year = financialYear(fy);
    const keyOf = (p: Period) => `year:${y.id}:${p.suffix}`;
    const label = (p: Period) =>
      p.suffix === year.suffix ? `FY ${y.financialYear}` : `FY ${y.financialYear} · ${p.label}`;
    if (isPeriodic(f)) {
      const all = periodsBetween(f, year.start, year.end);
      const share = fee / BigInt(all.length);
      all.forEach((p, i) => {
        if (p.start > asOf || p.end < from) return;
        const amount = i === all.length - 1 ? fee - share * BigInt(all.length - 1) : share;
        out.push(item(keyOf(p), 'year_fee', { ...p, label: label(p) }, amount, asOf));
      });
    } else if ((f === 'one_time' && year.start <= asOf) || (f === 'on_completion' && y.closed)) {
      out.push(item(keyOf(year), 'year_fee', { ...year, label: label(year) }, fee, asOf));
    }
  }
  return out;
}

/**
 * PS-206 · the fixed-fee periods of an engagement that are due by `asOf` (IST),
 * oldest first: a compliance year's fee shared by the billing frequency, else
 * the retainer per period. The caller drops what fee_billings already holds.
 * DI-free and unit-tested; unbilled.service.ts feeds it.
 */
export function dueFeeItems(t: FeeTerms, asOf: string): UnbilledItem[] {
  const hasYearFee = t.years.some((y) => y.feeAmount && toPaise(y.feeAmount) > 0n);
  const items = hasYearFee
    ? yearItems(t, asOf)
    : NOT_FIXED.has(t.billingModel ?? '')
      ? []
      : retainerItems(t, asOf);
  return items.sort(
    (a, b) => a.periodStart.localeCompare(b.periodStart) || a.key.localeCompare(b.key),
  );
}
