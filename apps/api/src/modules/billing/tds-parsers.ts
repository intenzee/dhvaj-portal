import { financialYearOf, fromPaise, toPaise, type TdsImportSource } from '@hsdg/contracts';

/**
 * PS-204 · reading the firm's TDS credits out of what TRACES gives it. The
 * formats change from year to year, so each is a parser behind one interface,
 * tried in turn, each with anonymised fixtures (__fixtures__/). Pure — tested.
 */

/** A Part I row: TDS a deductor deposited against the firm's PAN. Amounts are decimal strings. */
export interface ParsedTdsCredit {
  deductorTan: string;
  deductorName: string;
  section: string;
  /** ISO date. */
  transactionDate: string;
  amountPaid: string;
  taxDeducted: string;
  tdsDeposited: string;
  bookingStatus: string | null;
  bookingDate: string | null;
  /** 26AS "Remarks" (A, B, F, G…); null when blank or a dash. */
  remarks: string | null;
}

export interface ParsedTdsFile {
  source: TdsImportSource;
  /** The deductee's (the firm's) PAN, when the file says. */
  pan: string | null;
  /** As the file states it, else from the transaction dates. */
  financialYear: string | null;
  /** The date the statement is as on: a 26AS's File Creation Date (or "Data updated till"). */
  asOn: string | null;
  credits: ParsedTdsCredit[];
  warnings: string[];
}

export interface TdsCreditParser {
  readonly source: TdsImportSource;
  /** Recognises its own format; cheap. */
  accepts(text: string): boolean;
  parse(text: string): ParsedTdsFile;
}

/** Not a file we can read; the message is for the person importing it. */
export class TdsParseError extends Error {}

export const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const TAN_TOKEN = /\b[A-Z]{4}\d{5}[A-Z]\b/g;
const PAN_TOKEN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** '15-Jun-2026', '15-06-2026', '15/06/2026' or '2026-06-15' → '2026-06-15'; else null. */
export function parseTracesDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/.exec(s);
  if (match) {
    d = Number(match[1]);
    m = MONTHS[match[2]!.toLowerCase()] ?? 0;
    y = Number(match[3]);
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    !m ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** '1,00,000.00' → '100000.00'; '-500.00' (a reversal) stays signed; a dash or blank is zero; else null. */
export function parseTracesAmount(raw: string | undefined): string | null {
  const s = (raw ?? '').replace(/[,\s₹]/g, '');
  if (s === '' || s === '-') return '0.00';
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return fromPaise(toPaise(s));
}

function sum(amounts: string[]): string {
  return fromPaise(amounts.reduce((t, a) => t + toPaise(a), 0n));
}

/** '2026-27' or '2026-2027' → '2026-27'; else null. */
export function normaliseYear(raw: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2}|\d{4})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2]!.length === 4 ? Number(m[2]) : Number(m[1]!.slice(0, 2) + m[2]);
  if (end !== start + 1) return null;
  return `${start}-${String(end % 100).padStart(2, '0')}`;
}

/** 'Assessment Year 2027-28' (or 2027-2028) → '2026-27'. */
function yearBefore(ay: string): string | null {
  const year = normaliseYear(ay);
  if (!year) return null;
  const start = Number(year.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ── 26AS, the text export ("Export as Text") ────────────────────────────

/**
 * The caret-separated text TRACES exports ("View As Text"): a header — a row
 * of labels (File Creation Date, PAN, Financial Year as 2026-2027…) over a
 * row of values — then the parts. PART-I (PART A before AY 2023-24) is the
 * TDS: a summary line per deductor (Sr. No., name, TAN, totals) followed by
 * its transactions (blank first cell, Sr. No., section, transaction date,
 * booking status and date, remarks, amount paid, tax deducted, TDS
 * deposited; a reversal is negative). Every other part ends it; PART-X (PART
 * G before) lists defaults, said as a warning. Columns are found by their
 * headings, not their place, so an added column does not shift the amounts.
 */
export const traces26asText: TdsCreditParser = {
  source: '26as_text',

  accepts(text) {
    return (
      text.includes('^') && /TAN of Deductor/i.test(text) && /Tax Deducted at Source/i.test(text)
    );
  },

  parse(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const warnings: string[] = [];
    let pan: string | null = null;
    let financialYear: string | null = null;
    let asOn: string | null = null;
    const credits: ParsedTdsCredit[] = [];
    /** The header's label row, waiting for its value row. */
    let labels: string[] | null = null;

    let inPart1 = false;
    let sawPart1 = false;
    let inDefaults = false;
    let defaultsListed = false;
    let deductorCols: { name: number; tan: number; deposited: number } | null = null;
    let rowCols: {
      section: number;
      date: number;
      status: number;
      bookedOn: number;
      paid: number;
      deducted: number;
      deposited: number;
      remarks: number;
    } | null = null;
    let deductor: { name: string; tan: string; stated: string | null; rows: string[] } | null =
      null;

    const closeDeductor = (): void => {
      if (deductor?.stated && deductor.rows.length) {
        const got = sum(deductor.rows);
        if (toPaise(got) !== toPaise(deductor.stated)) {
          warnings.push(
            `${deductor.name} (${deductor.tan}): the rows add up to ${got}, the summary says ${deductor.stated}.`,
          );
        }
      }
      deductor = null;
    };
    const find = (cells: string[], re: RegExp): number => cells.findIndex((c) => re.test(c));

    lines.forEach((line, i) => {
      const cells = line.split('^').map((c) => c.trim());
      const first = cells.find((c) => c !== '') ?? '';
      if (!first || /No Transactions Present/i.test(first)) return;

      // The header: a row of labels over a row of values.
      if (labels) {
        const at = (re: RegExp): string | undefined => cells[labels!.findIndex((l) => re.test(l))];
        const panValue = at(/Permanent Account Number/i) ?? '';
        pan ??= PAN_RE.test(panValue) ? panValue : null;
        financialYear ??= normaliseYear(at(/^Financial Year$/i));
        financialYear ??= yearBefore(at(/^Assessment Year$/i) ?? '');
        asOn ??= parseTracesDate(at(/^File Creation Date$/i));
        labels = null;
        return;
      }
      const panAt = find(cells, /Permanent Account Number/i);
      if (panAt >= 0 && !pan) {
        const inline = cells.slice(panAt + 1).find((c) => PAN_RE.test(c));
        if (!inline) {
          labels = cells;
          return;
        }
        pan = inline;
      }
      // Older and made-up layouts: label^value pairs on a line.
      const fyAt = find(cells, /^Financial Year$/i);
      if (fyAt >= 0 && !financialYear) financialYear = normaliseYear(cells[fyAt + 1]);
      const ayAt = find(cells, /^Assessment Year$/i);
      if (ayAt >= 0 && !financialYear) financialYear = yearBefore(cells[ayAt + 1] ?? '');
      const asOnAt = find(cells, /^(Data updated till|File Creation Date)$/i);
      if (asOnAt >= 0 && !asOn) asOn = parseTracesDate(cells[asOnAt + 1]);

      // PART-I … PART-X; before AY 2023-24, PART A, A1, A2, B … G.
      const part = /^PART[\s-]*([IVX]+|[A-H]\d?)\b/i.exec(first);
      if (part) {
        closeDeductor();
        const name = part[1]!.toUpperCase();
        inPart1 =
          (name === 'I' || name === 'A') &&
          /Tax Deducted at Source/i.test(line) &&
          !/15G|15H/i.test(line);
        if (inPart1) sawPart1 = true;
        inDefaults = name === 'X' || (name === 'G' && /Default/i.test(line));
        deductorCols = null;
        rowCols = null;
        return;
      }
      if (inDefaults) {
        if (!defaultsListed && /^\d+$/.test(cells[0] ?? '')) {
          defaultsListed = true;
          warnings.push(
            "This 26AS lists defaults against the firm's own TDS returns (short payment or deduction, interest, fees): see them on TRACES.",
          );
        }
        return;
      }
      if (!inPart1) return;

      if (find(cells, /^Name of Deductor$/i) >= 0 && find(cells, /^TAN of Deductor$/i) >= 0) {
        deductorCols = {
          name: find(cells, /^Name of Deductor$/i),
          tan: find(cells, /^TAN of Deductor$/i),
          deposited: find(cells, /^Total TDS Deposited/i),
        };
        return;
      }
      if (find(cells, /^Section/i) >= 0 && find(cells, /^Transaction Date/i) >= 0) {
        rowCols = {
          section: find(cells, /^Section/i),
          date: find(cells, /^Transaction Date/i),
          status: find(cells, /^Status of Booking/i),
          bookedOn: find(cells, /^Date of Booking/i),
          paid: find(cells, /^Amount Paid/i),
          deducted: find(cells, /^Tax Deducted/i),
          deposited: find(cells, /^TDS Deposited/i),
          remarks: find(cells, /^Remarks/i),
        };
        return;
      }

      // A deductor: Sr. No. in the first cell and a TAN where the heading said.
      if (
        deductorCols &&
        /^\d+$/.test(cells[0] ?? '') &&
        TAN_RE.test(cells[deductorCols.tan] ?? '')
      ) {
        closeDeductor();
        deductor = {
          name: cells[deductorCols.name] || cells[deductorCols.tan]!,
          tan: cells[deductorCols.tan]!,
          stated:
            deductorCols.deposited >= 0 ? parseTracesAmount(cells[deductorCols.deposited]) : null,
          rows: [],
        };
        return;
      }

      // One of its transactions: a blank first cell, then the row's Sr. No.
      if (rowCols && deductor && cells[0] === '' && /^\d+$/.test(cells[1] ?? '')) {
        const at = `line ${i + 1}`;
        const date = parseTracesDate(cells[rowCols.date]);
        const paid = parseTracesAmount(cells[rowCols.paid]);
        const deducted = parseTracesAmount(cells[rowCols.deducted]);
        const deposited = parseTracesAmount(cells[rowCols.deposited]);
        const section = cells[rowCols.section] ?? '';
        if (!date || paid === null || deducted === null || deposited === null || !section) {
          warnings.push(`Skipped ${at}: it is not a transaction we can read.`);
          return;
        }
        const status = (rowCols.status >= 0 ? cells[rowCols.status] : '')?.toUpperCase() ?? '';
        const remark = (rowCols.remarks >= 0 ? cells[rowCols.remarks] : '')?.toUpperCase() ?? '';
        deductor.rows.push(deposited);
        credits.push({
          deductorTan: deductor.tan,
          deductorName: deductor.name,
          section,
          transactionDate: date,
          amountPaid: paid,
          taxDeducted: deducted,
          tdsDeposited: deposited,
          bookingStatus: /^[A-Z]$/.test(status) ? status : null,
          bookingDate: rowCols.bookedOn >= 0 ? parseTracesDate(cells[rowCols.bookedOn]) : null,
          remarks: remark && remark !== '-' ? remark.slice(0, 20) : null,
        });
      }
    });
    closeDeductor();

    if (!sawPart1) {
      throw new TdsParseError('This 26AS has no Part I (TDS deducted at source).');
    }
    return { source: '26as_text', pan, financialYear, asOn, credits, warnings };
  },
};

// ── Form 16A, the text layer of the TRACES PDF ──────────────────────────

/**
 * A Form 16A certifies one deductor's TDS on the firm for one quarter (or a
 * few). Its text layer runs the labels and the values of each box into lines
 * of their own, so the facts are found by their shape: the TAN is the one
 * token shaped like a TAN, the deductee's PAN the PAN after it; each quarter's
 * summary row is "Q2 <receipt no.> <tax deducted> <tax deposited>"; each
 * payment "<Sr.> <amount> <section> [<ref>] <dd-mm-yyyy>". One credit per
 * quarter: the payments' sum, the deposited tax, the last payment's date.
 */
export const form16aText: TdsCreditParser = {
  source: 'form16a_pdf',

  accepts(text) {
    return /FORM\s+NO\.?\s*16\s*A\b/i.test(text);
  },

  parse(text) {
    const warnings: string[] = [];
    const tans = [...new Set(text.match(TAN_TOKEN) ?? [])];
    if (tans.length !== 1) {
      throw new TdsParseError(
        tans.length === 0
          ? 'No deductor TAN found in this Form 16A.'
          : 'This Form 16A names more than one TAN; import one certificate at a time.',
      );
    }
    const tan = tans[0]!;
    const afterTan = text.slice(text.indexOf(tan) + tan.length);
    const pan = afterTan.match(PAN_TOKEN)?.[0] ?? null;

    // The year: the assessment year beside its label, else the period's start,
    // else the first year-shaped token after the label (values on a line of their own).
    const ay = /Assessment\s+Year\s*:?\s*(\d{4}-\d{2,4})/i.exec(text);
    const from = /\bFrom\s+(\d{1,2}[-/ ][A-Za-z0-9]{2,9}[-/ ]\d{4})\s+To\b/i.exec(text);
    const fromIso = from ? parseTracesDate(from[1]) : null;
    const label = /Assessment\s+Year/i.exec(text);
    const later = label ? /\b(\d{4}-\d{2})\b/.exec(text.slice(label.index)) : null;
    const financialYear = ay
      ? yearBefore(ay[1]!)
      : fromIso
        ? financialYearOf(fromIso)
        : later
          ? yearBefore(later[1]!)
          : null;

    const nameAt = /Name and address of the deductor/i.exec(text);
    let deductorName = '';
    if (nameAt) {
      const rest = text
        .slice(nameAt.index + nameAt[0].length)
        .split('\n')
        .map((l) => l.trim());
      const line = rest.find((l) => l && !/Name and address of the deductee/i.test(l)) ?? '';
      deductorName = line.split(/\s{2,}/)[0]!.slice(0, 300);
    }
    if (!deductorName) {
      deductorName = `Deductor ${tan}`;
      warnings.push("The deductor's name was not found; the TAN stands in for it.");
    }

    const payments: { amount: string; section: string; date: string }[] = [];
    // Section 194J, 194JB, 194J(b), or a 2025-Act payment code such as 1027.
    const paymentRe =
      /^\s*\d+\s+([\d,]+\.\d{2})\s+(\d{4}|\d{3}[A-Z]{0,3}(?:\([A-Za-z]{1,2}\))?)\s+(?:\S+\s+)?(\d{2}[-/]\d{2}[-/]\d{4})\s*$/gm;
    for (const m of text.matchAll(paymentRe)) {
      const date = parseTracesDate(m[3]);
      const amount = parseTracesAmount(m[1]);
      if (date && amount) payments.push({ amount, section: m[2]!, date });
    }

    const credits: ParsedTdsCredit[] = [];
    const quarterRe = /\b(Q[1-4])\s+([A-Z0-9]{8})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g;
    for (const m of text.matchAll(quarterRe)) {
      if (!financialYear) break;
      const q = Number(m[1]!.slice(1));
      const deducted = parseTracesAmount(m[3])!;
      const deposited = parseTracesAmount(m[4])!;
      const inQuarter = payments.filter((p) => quarterOf(p.date) === q);
      const last =
        inQuarter
          .map((p) => p.date)
          .sort()
          .pop() ?? quarterEnd(financialYear, q);
      const sections = inQuarter.map((p) => p.section);
      credits.push({
        deductorTan: tan,
        deductorName,
        section: mostCommon(sections) ?? 'other',
        transactionDate: last,
        amountPaid: sum(inQuarter.map((p) => p.amount)),
        taxDeducted: deducted,
        tdsDeposited: deposited,
        bookingStatus: null,
        bookingDate: null,
        remarks: null,
      });
      if (inQuarter.length === 0) {
        warnings.push(`${m[1]}: no payment rows read; dated the quarter's last day.`);
      }
    }
    if (!financialYear) throw new TdsParseError('No assessment year found in this Form 16A.');
    return { source: 'form16a_pdf', pan, financialYear, asOn: null, credits, warnings };
  },
};

function quarterOf(iso: string): number {
  const m = Number(iso.slice(5, 7));
  return m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
}

function quarterEnd(financialYear: string, q: number): string {
  const y = Number(financialYear.slice(0, 4));
  return ['', `${y}-06-30`, `${y}-09-30`, `${y}-12-31`, `${y + 1}-03-31`][q]!;
}

function mostCommon(xs: string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Tried in order; the first that recognises the text reads it. */
export const TDS_PARSERS: readonly TdsCreditParser[] = [traces26asText, form16aText];

/**
 * Read a TRACES file's text with whichever parser recognises it, and settle
 * its year: the one it states, else the one its rows fall in (a file spanning
 * two is refused). Throws TdsParseError with the reason.
 */
export function parseTdsText(text: string): ParsedTdsFile {
  const parser = TDS_PARSERS.find((p) => p.accepts(text));
  if (!parser) {
    throw new TdsParseError(
      'Not a 26AS text export or a Form 16A. Download the 26AS from TRACES with "View As Text" (or "Export as Text") and import the ZIP or the text file in it.',
    );
  }
  const parsed = parser.parse(text);
  if (parsed.credits.length === 0) {
    throw new TdsParseError('The file has no TDS entries to import.');
  }
  const years = [...new Set(parsed.credits.map((c) => financialYearOf(c.transactionDate)))];
  if (!parsed.financialYear) {
    if (years.length !== 1) {
      throw new TdsParseError(
        'The file does not say its financial year, and its rows span several.',
      );
    }
    parsed.financialYear = years[0]!;
  }
  const year = parsed.financialYear;
  const outside = parsed.credits.length;
  parsed.credits = parsed.credits.filter((c) => financialYearOf(c.transactionDate) === year);
  const dropped = outside - parsed.credits.length;
  if (dropped) {
    parsed.warnings.push(
      `Skipped ${dropped} row${dropped === 1 ? '' : 's'} dated outside ${year}, the year of the file.`,
    );
  }
  if (parsed.credits.length === 0) {
    throw new TdsParseError(`The file has no TDS entries dated in ${year}.`);
  }
  return parsed;
}
