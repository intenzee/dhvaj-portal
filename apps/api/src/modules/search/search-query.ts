import { periodKeyLabel, type SearchUnderstood } from '@hsdg/contracts';

/**
 * Staff Workflow WF-304 — reads a Ctrl K query into words, forms and a period.
 * "bharat gstr1 sep" → text [bharat], forms [gstr1], period 2026-09 (the
 * current financial year, Apr–Mar, unless a year is given). Pure — tested.
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Statutory form names as staff type them, once punctuation is stripped. */
const FORM =
  /^(gstr\d{1,2}[a-z]?|cmp\d{2}|itc\d{2}|pmt\d{2}|iff|\d{2}q|itr\d{0,2}[a-z]?|mgt\d{1,2}[a-z]?|aoc\d[a-z]{0,3}|dir\d{1,2}[a-z]?|adt\d|msme\d?|dpt\d|ben\d|inc\d{1,2}[a-z]?|llp\d{1,2}|3c[abd]|10b[a-z]?|15[cg]a|15[gh]|16a?|26as|27eq|form\d{1,3}[a-z]?)$/;

/** A form prefix that may be typed apart from its number: "gstr 3b", "mgt 7", "form 24q". */
const SPLIT_PREFIX = new Set([
  'gstr',
  'cmp',
  'itc',
  'pmt',
  'itr',
  'mgt',
  'aoc',
  'dir',
  'adt',
  'dpt',
  'ben',
  'inc',
  'llp',
]);

export interface ParsedSearch extends SearchUnderstood {
  /** The period's shape, for the SQL filter. */
  periodKind: 'month' | 'quarter' | 'half' | 'fy' | null;
}

function fyOf(year: number, month: number): string {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** `25` → 2025, `2025` → 2025, else null. */
function yearOf(token: string): number | null {
  if (/^20\d{2}$/.test(token)) return Number(token);
  if (/^\d{2}$/.test(token)) return 2000 + Number(token);
  return null;
}

/** `2025-26`, `fy25`, `fy2025-26`, `fy 2025-26` → `2025-26`. */
function fyToken(token: string): string | null {
  const m = /^(?:fy)?(20\d{2})-?(\d{2})$/.exec(token);
  if (m && (Number(m[1]) + 1) % 100 === Number(m[2])) return `${m[1]}-${m[2]}`;
  const short = /^fy(\d{2})$/.exec(token);
  if (short) {
    const start = 2000 + Number(short[1]);
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }
  return null;
}

/**
 * @param today ISO date (IST) — sets the default financial year.
 */
export function parseSearchQuery(q: string, today: string): ParsedSearch {
  const raw = q
    .toLowerCase()
    .replace(/[,;]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const text: string[] = [];
  const forms: string[] = [];
  let month: number | null = null;
  let monthYear: number | null = null;
  let quarter: string | null = null;
  let fy: string | null = null;

  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i]!;
    const bare = tok.replace(/[^a-z0-9-]/g, '');
    const flat = bare.replace(/-/g, '');

    // "2026-09" — a calendar month.
    const ym = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(bare);
    if (ym) {
      month = Number(ym[2]);
      monthYear = Number(ym[1]);
      continue;
    }
    const fyt = fyToken(bare);
    if (fyt) {
      fy = fyt;
      continue;
    }
    if (bare === 'fy' && raw[i + 1] && fyToken(raw[i + 1]!.replace(/[^0-9-]/g, ''))) {
      fy = fyToken(raw[i + 1]!.replace(/[^0-9-]/g, ''));
      i++;
      continue;
    }
    // "sep", "sep-26", "sep26", "sep 2026".
    const mm = /^([a-z]+)-?(\d{2}|\d{4})?$/.exec(bare);
    if (mm && MONTHS[mm[1]!] !== undefined) {
      month = MONTHS[mm[1]!]!;
      if (mm[2]) monthYear = yearOf(mm[2]);
      else if (raw[i + 1] && yearOf(raw[i + 1]!) !== null && month !== null) {
        monthYear = yearOf(raw[i + 1]!);
        i++;
      }
      continue;
    }
    if (/^q[1-4]$/.test(flat)) {
      quarter = flat.toUpperCase();
      continue;
    }
    // "gstr 3b", "form 24q" — glue the prefix to the number that follows.
    const next = raw[i + 1]?.replace(/[^a-z0-9]/g, '');
    if ((SPLIT_PREFIX.has(flat) || flat === 'form') && next && /^\d/.test(next)) {
      const glued = flat === 'form' ? next : flat + next;
      if (FORM.test(glued)) {
        forms.push(glued);
        i++;
        continue;
      }
    }
    if (FORM.test(flat)) {
      forms.push(flat);
      continue;
    }
    if (flat.length > 0) text.push(tok.replace(/[%_\\]/g, ''));
  }

  const [ty, tm] = today.split('-').map(Number) as [number, number];
  const currentFy = fyOf(ty, tm);
  let period: string | null = null;
  let periodKind: ParsedSearch['periodKind'] = null;
  if (month !== null) {
    let year: number;
    if (monthYear !== null) year = monthYear;
    else {
      // A bare month falls in the financial year (given or current): Apr–Dec its first year.
      const start = Number((fy ?? currentFy).slice(0, 4));
      year = month >= 4 ? start : start + 1;
    }
    period = `${year}-${String(month).padStart(2, '0')}`;
    periodKind = 'month';
  } else if (quarter) {
    period = `${fy ?? currentFy}:${quarter}`;
    periodKind = 'quarter';
  } else if (fy) {
    period = fy;
    periodKind = 'fy';
  }

  return {
    text: text.filter((t) => t.length > 0),
    forms: [...new Set(forms)],
    period,
    periodKind,
    periodLabel: period ? (periodKind === 'fy' ? `FY ${period}` : periodKeyLabel(period)) : null,
  };
}

/** Does anything in the query name work (a form or a period)? */
export function namesWork(p: ParsedSearch): boolean {
  return p.forms.length > 0 || p.period !== null;
}
