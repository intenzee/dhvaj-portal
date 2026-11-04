import type { ItrIncomeHead, ItrIncomeSource } from '@hsdg/contracts';

/** One line of income read from a statement, before it is stored. */
export interface ParsedIncomeLine {
  head: ItrIncomeHead;
  section: string | null;
  description: string | null;
  payerName: string | null;
  payerTan: string | null;
  /** Decimal string, two places ("125000.00"). */
  amount: string;
  taxDeducted: string;
  transactionOn: string | null;
}

export interface ParsedStatement {
  /** What the file was read as, for the import's answer. */
  format: string;
  lines: ParsedIncomeLine[];
  skipped: number;
  warnings: string[];
}

/**
 * A statement format. `detect` looks at the bytes (and the source the user
 * chose); the first parser that recognises a file reads it. A parser that
 * recognises a file it cannot read throws StatementRefused with the reason.
 */
export interface StatementParser {
  readonly format: string;
  detect(bytes: Buffer, text: string, source: ItrIncomeSource): boolean;
  parse(bytes: Buffer, text: string, source: ItrIncomeSource): ParsedStatement;
}

/** A file the desk recognises and will not read, with what to download instead. */
export class StatementRefused extends Error {}

export const TAN = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

/** "1,25,000.50" / "125000" / "(1,200.00)" → "125000.50"; null when not an amount. */
export function amountOf(raw: unknown): string | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw.toFixed(2) : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^(rs\.?|inr|₹)\s*/i, '');
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[(),\s-]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return (negative ? -n : n).toFixed(2);
}

/** "15-Apr-2025", "15/04/2025", "2025-04-15" or an Excel serial → "2025-04-15"; else null. */
export function dateOf(raw: unknown): string | null {
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    // Excel's day 1 is 1900-01-01, with its 1900 leap-year bug (day 60).
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/.exec(s);
  if (m && MONTHS[m[2]!.toUpperCase()])
    return `${m[3]}-${MONTHS[m[2]!.toUpperCase()]}-${m[1]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

/** Trimmed, single-spaced, or null when blank. */
export function textOf(raw: unknown, max = 300): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
