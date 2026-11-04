import {
  PROGRESS_GROUP,
  type ProgressFilters,
  type ProgressGroup,
  type ProgressRow,
} from '@hsdg/contracts';
import { addDays, mondayOf } from './people';

/**
 * Phase 3, D-2 — the Progress page's pure parts: the period presets (by
 * internal due date, IST), the query strings and the CSV each table exports.
 */

export const PERIOD_PRESET = {
  thisWeek: 'this_week',
  thisMonth: 'this_month',
  lastMonth: 'last_month',
  custom: 'custom',
} as const;
export type PeriodPreset = (typeof PERIOD_PRESET)[keyof typeof PERIOD_PRESET];

export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  custom: 'Custom',
};

export const PROGRESS_GROUP_LABEL: Record<ProgressGroup, string> = {
  person: 'By person',
  client: 'By client',
  filing: 'By filing',
};

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The from / to dates (inclusive) of a preset, around `today` (IST, YYYY-MM-DD). Pure. */
export function periodRange(
  preset: PeriodPreset,
  today: string,
  custom: { from: string; to: string } = { from: '', to: '' },
): { from: string; to: string } {
  switch (preset) {
    case PERIOD_PRESET.thisWeek: {
      const monday = mondayOf(today);
      return { from: monday, to: addDays(monday, 6) };
    }
    case PERIOD_PRESET.thisMonth:
      return { from: monthStart(today), to: monthEnd(today) };
    case PERIOD_PRESET.lastMonth: {
      const last = addDays(monthStart(today), -1);
      return { from: monthStart(last), to: monthEnd(last) };
    }
    default:
      return custom;
  }
}

/** `groupBy=…&from=…&officeId=…`, leaving out what is empty. Pure. */
export function progressQuery(
  params: ProgressFilters & {
    groupBy?: ProgressGroup;
    key?: string;
    progress?: string;
    overdueOnly?: boolean;
    limit?: number;
    offset?: number;
  },
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    q.set(k, String(v));
  }
  return q.toString();
}

/** The share of a row that is done, 0–100. */
export function donePercent(row: Pick<ProgressRow, 'completed' | 'total'>): number {
  return row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0;
}

/** "2 with Kirandeep, 1 with Ravi" — who holds a filing's open work. */
export function holdersLine(row: ProgressRow): string {
  return (row.holders ?? []).map((h) => `${h.open} with ${h.fullName ?? 'no one yet'}`).join(', ');
}

/** The CSV of a table: the columns it shows. Pure. */
export function progressCsv(
  groupBy: ProgressGroup,
  rows: ProgressRow[],
): { headers: string[]; rows: Array<Array<string | number | null>> } {
  const counts = (r: ProgressRow) => [
    r.overdue,
    r.notStarted,
    r.inProgress,
    r.waitingOnClient,
    r.inReview,
    r.completed,
    r.total,
  ];
  const countHeaders = [
    'Overdue',
    'Not started',
    'In progress',
    'Waiting on client',
    'In review',
    'Completed',
    'Total',
  ];
  if (groupBy === PROGRESS_GROUP.person) {
    return { headers: ['Person', ...countHeaders], rows: rows.map((r) => [r.label, ...counts(r)]) };
  }
  if (groupBy === PROGRESS_GROUP.client) {
    return {
      headers: ['Client', 'Engagement', ...countHeaders],
      rows: rows.map((r) => [r.clientName ?? r.label, r.engagementLabel ?? '', ...counts(r)]),
    };
  }
  return {
    headers: ['Filing', 'With', ...countHeaders],
    rows: rows.map((r) => [r.label, holdersLine(r), ...counts(r)]),
  };
}
