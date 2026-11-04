import {
  PROFITABILITY_BOTTOM,
  type ProfitabilityBy,
  type ProfitabilityMeasures,
  type ProfitabilityRow,
} from '@hsdg/contracts';

/**
 * PS-302 — the profitability maths, pure. Money is held in paise (integers)
 * so sums are exact; hours in seconds.
 */

/** Hours logged by one person on one engagement (and service) on one IST day. */
export interface TimeFact {
  engagementId: string;
  employeeId: string;
  day: string;
  serviceId: string | null;
  seconds: number;
  billableSeconds: number;
}

/** Money on an engagement on a day: billed (credit notes negative) or collected, ex-GST. */
export interface MoneyFact {
  engagementId: string;
  day: string;
  kind: 'billed' | 'collected';
  paise: number;
}

export interface EngagementMeta {
  id: string;
  code: string;
  entityId: string;
  entityName: string;
  partnerId: string | null;
  partnerName: string | null;
  officeCode: string | null;
  primaryServiceId: string | null;
}

/** A rate in force from a day; a list is sorted latest first. */
export interface RateFrom {
  effectiveFrom: string;
  costPaise: number;
  chargePaise: number;
}

export interface RateBook {
  /** Grade id → its cards, latest first. */
  byGrade: Map<string, RateFrom[]>;
  /** Employee id → their overrides, latest first. */
  byEmployee: Map<string, RateFrom[]>;
  /** Employee id → grade id. */
  gradeOf: Map<string, string | null>;
}

/** The rate in force on `day`: the latest row from on or before it. */
export function rateOn(rows: readonly RateFrom[] | undefined, day: string): RateFrom | null {
  if (!rows) return null;
  for (const r of rows) if (r.effectiveFrom <= day) return r;
  return null;
}

/** An employee's rate on a day: their own override, else their grade's card. */
export function employeeRateOn(book: RateBook, employeeId: string, day: string): RateFrom | null {
  const own = rateOn(book.byEmployee.get(employeeId), day);
  if (own) return own;
  const grade = book.gradeOf.get(employeeId);
  return grade ? rateOn(book.byGrade.get(grade), day) : null;
}

/** Rupees as a decimal string → paise. */
export function toPaise(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  return Math.round(Number(v) * 100);
}

/** Paise → rupees, 2 dp. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const a = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** a ÷ b as a percentage, 1 dp; null when b is not positive. */
export function pct(a: number, b: number): number | null {
  if (b <= 0) return null;
  return Math.round((a / b) * 1000) / 10;
}

const hours = (seconds: number): number => Math.round((seconds / 3600) * 100) / 100;

interface Acc {
  seconds: number;
  billableSeconds: number;
  unratedSeconds: number;
  costPaise: number;
  standardPaise: number;
  billedPaise: number;
  collectedPaise: number;
}

const emptyAcc = (): Acc => ({
  seconds: 0,
  billableSeconds: 0,
  unratedSeconds: 0,
  costPaise: 0,
  standardPaise: 0,
  billedPaise: 0,
  collectedPaise: 0,
});

function measures(a: Acc): ProfitabilityMeasures {
  const margin = a.billedPaise - a.costPaise;
  return {
    hours: hours(a.seconds),
    billableHours: hours(a.billableSeconds),
    timeCost: rupees(a.costPaise),
    standardValue: rupees(a.standardPaise),
    billed: rupees(a.billedPaise),
    collected: rupees(a.collectedPaise),
    realisationPct: pct(a.billedPaise, a.standardPaise),
    collectionPct: pct(a.collectedPaise, a.billedPaise),
    margin: rupees(margin),
    marginPct: pct(margin, a.billedPaise),
    unratedHours: hours(a.unratedSeconds),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09" → "Sep 2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

interface Group {
  key: string;
  label: string;
  sub: string | null;
}

export interface ProfitabilityInput {
  by: ProfitabilityBy;
  time: readonly TimeFact[];
  money: readonly MoneyFact[];
  engagements: ReadonlyMap<string, EngagementMeta>;
  serviceNames: ReadonlyMap<string, string>;
  employeeNames: ReadonlyMap<string, string>;
  rates: RateBook;
}

export interface ProfitabilityResult {
  rows: ProfitabilityRow[];
  totals: ProfitabilityMeasures;
  unratedPeople: string[];
}

/** Every measure per row of the chosen dimension, ranked by margin (months in order). */
export function profitability(input: ProfitabilityInput): ProfitabilityResult {
  const groups = new Map<string, Group & { acc: Acc }>();
  const total = emptyAcc();
  const unrated = new Set<string>();

  const groupOf = (eng: EngagementMeta, day: string, serviceId: string | null): Group => {
    switch (input.by) {
      case 'client':
        return { key: eng.entityId, label: eng.entityName, sub: null };
      case 'engagement':
        return { key: eng.id, label: eng.code, sub: eng.entityName };
      case 'service': {
        const id = serviceId ?? eng.primaryServiceId;
        return id
          ? { key: id, label: input.serviceNames.get(id) ?? 'Service', sub: null }
          : { key: 'none', label: 'No service', sub: null };
      }
      case 'partner':
        return eng.partnerId
          ? { key: eng.partnerId, label: eng.partnerName ?? 'Partner', sub: eng.officeCode }
          : { key: 'none', label: 'No partner', sub: null };
      case 'month':
        return { key: day.slice(0, 7), label: monthLabel(day.slice(0, 7)), sub: null };
    }
  };
  const accOf = (g: Group): Acc => {
    let cur = groups.get(g.key);
    if (!cur) {
      cur = { ...g, acc: emptyAcc() };
      groups.set(g.key, cur);
    }
    return cur.acc;
  };

  for (const t of input.time) {
    const eng = input.engagements.get(t.engagementId);
    if (!eng) continue;
    const acc = accOf(groupOf(eng, t.day, t.serviceId));
    const rate = employeeRateOn(input.rates, t.employeeId, t.day);
    const cost = rate ? Math.round((t.seconds * rate.costPaise) / 3600) : 0;
    const standard = rate ? Math.round((t.billableSeconds * rate.chargePaise) / 3600) : 0;
    if (!rate) unrated.add(input.employeeNames.get(t.employeeId) ?? t.employeeId);
    for (const a of [acc, total]) {
      a.seconds += t.seconds;
      a.billableSeconds += t.billableSeconds;
      if (!rate) a.unratedSeconds += t.seconds;
      a.costPaise += cost;
      a.standardPaise += standard;
    }
  }
  for (const m of input.money) {
    const eng = input.engagements.get(m.engagementId);
    if (!eng) continue;
    const acc = accOf(groupOf(eng, m.day, null));
    for (const a of [acc, total]) {
      if (m.kind === 'billed') a.billedPaise += m.paise;
      else a.collectedPaise += m.paise;
    }
  }

  const list = [...groups.values()].map((g) => ({
    g,
    marginPaise: g.acc.billedPaise - g.acc.costPaise,
  }));
  if (input.by === 'month') list.sort((a, b) => a.g.key.localeCompare(b.g.key));
  else list.sort((a, b) => b.marginPaise - a.marginPaise || a.g.label.localeCompare(b.g.label));

  // The bottom PROFITABILITY_BOTTOM by margin, when there are more rows than
  // that; a loss is always flagged.
  const bottomKeys = new Set(
    list.length > PROFITABILITY_BOTTOM
      ? [...list]
          .sort((a, b) => a.marginPaise - b.marginPaise)
          .slice(0, PROFITABILITY_BOTTOM)
          .map((x) => x.g.key)
      : [],
  );
  const rows: ProfitabilityRow[] = list.map(({ g, marginPaise }) => ({
    key: g.key,
    label: g.label,
    sub: g.sub,
    ...measures(g.acc),
    bottom: bottomKeys.has(g.key) || marginPaise < 0,
  }));
  return { rows, totals: measures(total), unratedPeople: [...unrated].sort() };
}

/** The report as CSV (rows, then the total). */
export function profitabilityCsv(
  byLabel: string,
  rows: readonly ProfitabilityRow[],
  totals: ProfitabilityMeasures,
): string {
  const cell = (v: string | number | null): string => {
    if (v === null) return '';
    const s = String(v);
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = [
    byLabel,
    'Detail',
    'Hours',
    'Billable hours',
    'Time cost',
    'Standard value',
    'Billed',
    'Collected',
    'Realisation %',
    'Collection %',
    'Margin',
    'Margin %',
    'Unrated hours',
  ];
  const line = (label: string, sub: string | null, m: ProfitabilityMeasures) =>
    [
      label,
      sub,
      m.hours,
      m.billableHours,
      m.timeCost,
      m.standardValue,
      m.billed,
      m.collected,
      m.realisationPct,
      m.collectionPct,
      m.margin,
      m.marginPct,
      m.unratedHours,
    ]
      .map(cell)
      .join(',');
  return [
    head.join(','),
    ...rows.map((r) => line(r.label, r.sub, r)),
    line('Total', null, totals),
  ].join('\n');
}
