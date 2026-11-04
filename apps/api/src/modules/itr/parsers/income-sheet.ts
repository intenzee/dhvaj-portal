import * as XLSX from 'xlsx';
import { ITR_INCOME_HEADS, headForSection, type ItrIncomeHead } from '@hsdg/contracts';
import {
  StatementRefused,
  TAN,
  amountOf,
  dateOf,
  textOf,
  type ParsedIncomeLine,
  type StatementParser,
} from './statement';

/**
 * A CSV or Excel sheet: the AIS / TIS as the portal's CSV download, or the
 * client's own figures on the firm's template. The header row is found by
 * name (the first of the top 20 rows with an amount column), so the columns
 * may come in any order and under any of the usual names.
 */
const ALIASES: Record<string, RegExp[]> = {
  head: [/^(income\s+)?head$/i, /^category$/i, /^head\s+of\s+income$/i],
  section: [/^(tds\s+)?section(\s+code)?$/i],
  description: [
    /^description$/i,
    /^information\s+(description|category)$/i,
    /^nature(\s+of\s+(payment|income))?$/i,
    /^particulars$/i,
  ],
  payerName: [
    /^(payer|deductor|information\s+source|source)(\s+name)?$/i,
    /^name\s+of\s+(the\s+)?(payer|deductor)$/i,
  ],
  payerTan: [/^(payer\s+|deductor\s+)?tan(\s+of\s+(the\s+)?(payer|deductor))?$/i],
  // In order of preference: the figure the client agrees, then what the department processed.
  amount: [
    /^amount(\s+paid\s*\/?\s*credited)?$/i,
    /^(gross\s+)?(amount|income|value)$/i,
    /^accepted\s+value$/i,
    /^(derived|processed)\s+value$/i,
    /^reported\s+value$/i,
  ],
  taxDeducted: [/^(tds|tax\s+deducted(\s*\/\s*collected)?|tds\s+deducted|tds\s+amount)$/i],
  date: [/^(transaction\s+)?date(\s+of\s+(credit|transaction))?$/i],
};

/** A head named in words ("Interest from savings bank" → other sources). */
function headOfText(text: string | null): ItrIncomeHead | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[\s-]+/g, '_');
  const exact = ITR_INCOME_HEADS.find((h) => h === t);
  if (exact) return exact;
  const s = text.toLowerCase();
  if (/salar|perquisite|pension/.test(s)) return 'salary';
  if (/house|rent\b|rent\s+received/.test(s)) return 'house_property';
  if (/capital|sale\s+of\s+(securities|units|land|property|shares)|mutual\s+fund|\bvda\b/.test(s))
    return 'capital_gains';
  if (/exempt|agricultur/.test(s)) return 'exempt';
  if (/business|profession|turnover|commission|contract|gst/.test(s)) return 'business';
  if (/interest|dividend|winning|lotter|other\s+source|insurance\s+maturity/.test(s))
    return 'other_sources';
  return null;
}

/**
 * Each field's column; the amount keeps every amount column in order of
 * preference, so a row with no accepted value falls back to the reported one.
 */
function columns(header: unknown[]): { at: Record<string, number>; amounts: number[] } | null {
  const cells = header.map((c) => String(c ?? '').trim());
  const at: Record<string, number> = {};
  for (const [field, res] of Object.entries(ALIASES)) {
    if (field === 'amount') continue;
    for (const re of res) {
      const i = cells.findIndex((c) => re.test(c));
      if (i >= 0) {
        at[field] = i;
        break;
      }
    }
  }
  const amounts = ALIASES.amount!.flatMap((re) => cells.flatMap((c, i) => (re.test(c) ? [i] : [])));
  return amounts.length === 0 ? null : { at, amounts: [...new Set(amounts)] };
}

export const incomeSheet: StatementParser = {
  format: 'CSV / Excel sheet',

  detect(bytes, text) {
    // xlsx (zip) and xls (OLE) by their magic numbers; CSV by a comma-separated first line.
    if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return true;
    if (bytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return true;
    const first = text.split(/\r?\n/).find((l) => l.trim());
    return !!first && (first.includes(',') || first.includes('\t')) && !first.includes('^');
  },

  parse(bytes) {
    let book: XLSX.WorkBook;
    try {
      book = XLSX.read(bytes, { type: 'buffer', raw: true, cellDates: false });
    } catch {
      throw new StatementRefused('The sheet could not be opened. Save it as .xlsx or .csv.');
    }
    const sheet = book.Sheets[book.SheetNames[0]!];
    const rows = sheet
      ? (XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: true,
          defval: null,
        }) as unknown[][])
      : [];
    const headerAt = rows.slice(0, 20).findIndex((r) => columns(r) !== null);
    if (headerAt < 0)
      throw new StatementRefused(
        'No header row with an amount column was found in the first 20 rows (looked for "Amount", "Accepted Value", "Reported Value" …).',
      );
    const { at: col, amounts } = columns(rows[headerAt]!)!;
    const cell = (r: unknown[], f: string) => (col[f] === undefined ? null : r[col[f]!]);

    const lines: ParsedIncomeLine[] = [];
    let skipped = 0;
    let badTan = 0;
    for (const r of rows.slice(headerAt + 1)) {
      if (r.every((c) => c === null || String(c).trim() === '')) continue;
      const amount = amounts.map((i) => amountOf(r[i])).find((a) => a !== null) ?? null;
      if (amount === null) {
        skipped += 1;
        continue;
      }
      const section = textOf(cell(r, 'section'), 40);
      const description = textOf(cell(r, 'description'), 500);
      let tan = textOf(cell(r, 'payerTan'), 20)?.toUpperCase() ?? null;
      if (tan && !TAN.test(tan)) {
        badTan += 1;
        tan = null;
      }
      const sectionHead = section ? headForSection(section) : null;
      lines.push({
        head:
          headOfText(textOf(cell(r, 'head'))) ??
          (sectionHead && sectionHead !== 'unclassified' ? sectionHead : null) ??
          headOfText(description) ??
          'unclassified',
        section,
        description,
        payerName: textOf(cell(r, 'payerName')),
        payerTan: tan,
        amount,
        taxDeducted: amountOf(cell(r, 'taxDeducted')) ?? '0.00',
        transactionOn: dateOf(cell(r, 'date')),
      });
    }
    const warnings: string[] = [];
    if (skipped) warnings.push(`${skipped} row(s) without an amount were skipped.`);
    if (badTan) warnings.push(`${badTan} TAN(s) were not valid and were left out.`);
    if (lines.some((l) => l.head === 'unclassified'))
      warnings.push('Some lines have no head: choose it on the matching view.');
    return { format: this.format, lines, skipped, warnings };
  },
};
