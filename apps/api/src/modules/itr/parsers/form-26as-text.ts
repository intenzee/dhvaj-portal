import { headForSection } from '@hsdg/contracts';
import {
  TAN,
  amountOf,
  dateOf,
  textOf,
  type ParsedIncomeLine,
  type StatementParser,
} from './statement';

/**
 * Form 26AS as TRACES exports it in text: '^'-separated cells, the deductee's
 * details first, then each Part with its own header rows. Part I lists each
 * deductor (name, TAN, totals) followed by its transactions (section, date,
 * amount, tax). Read by the header cells, not by position, since TRACES has
 * moved columns between years.
 *
 * Only Part I (TDS) and Part II (TDS on 15G / 15H) are income of the
 * taxpayer; the later Parts (TDS the taxpayer deducted as a buyer, TCS, tax
 * paid, refunds, demands) are not read. The layout is from third-party
 * descriptions of the export — verify against a real download.
 */
interface SummaryColumns {
  name: number;
  tan: number;
  amount: number;
  tax: number;
}
interface DetailColumns {
  section: number;
  date: number;
  amount: number;
  tax: number;
  status: number;
}
const find = (cells: string[], re: RegExp) => cells.findIndex((c) => re.test(c));

export const form26asText: StatementParser = {
  format: 'Form 26AS text export (TRACES — layout to verify)',

  detect(_bytes, text) {
    return text.includes('^') && /TAN\s+of\s+Deductor/i.test(text);
  },

  parse(_bytes, text) {
    const warnings: string[] = [];
    let skipped = 0;
    let part: 'income' | 'other' | null = null;
    let summary: SummaryColumns | null = null;
    let detail: DetailColumns | null = null;
    let deductor: { name: string | null; tan: string; amount: string; tax: string } | null = null;
    let deductorLines = 0;
    const lines: ParsedIncomeLine[] = [];
    const sawOther = new Set<string>();

    // A deductor with no transaction rows is read from its totals.
    const closeDeductor = () => {
      if (deductor && deductorLines === 0 && part !== 'other') {
        lines.push({
          head: 'unclassified',
          section: null,
          description: null,
          payerName: deductor.name,
          payerTan: deductor.tan,
          amount: deductor.amount,
          taxDeducted: deductor.tax,
          transactionOn: null,
        });
      }
      deductor = null;
      deductorLines = 0;
    };

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const partMatch = /^\^?\s*PART[\s-]*([IVX]+|[A-H]\d?)\b/i.exec(line);
      if (partMatch) {
        closeDeductor();
        const p = partMatch[1]!.toUpperCase();
        part = ['I', 'II', 'A', 'A1'].includes(p) ? 'income' : 'other';
        if (part === 'other') sawOther.add(p);
        summary = null;
        detail = null;
        continue;
      }
      if (!line.includes('^')) continue;
      const cells = line.split('^').map((c) => c.trim());

      // Header rows.
      const tanCol = find(cells, /^TAN\s+of\s+Deductor/i);
      if (tanCol >= 0) {
        summary = {
          name: find(cells, /^Name\s+of\s+Deductor/i),
          tan: tanCol,
          amount: find(cells, /^Total\s+Amount\s+Paid/i),
          tax: find(cells, /^Total\s+Tax\s+Deducted/i),
        };
        if (part === null) part = 'income';
        continue;
      }
      const sectionCol = find(cells, /^Section(\s+\d+)?$/i);
      if (sectionCol >= 0 && find(cells, /Transaction\s+Date/i) >= 0) {
        detail = {
          section: sectionCol,
          date: find(cells, /Transaction\s+Date/i),
          amount: find(cells, /^Amount\s+Paid/i),
          tax: find(cells, /^Tax\s+Deducted/i),
          status: find(cells, /Status\s+of\s+Booking/i),
        };
        continue;
      }
      if (part !== 'income') continue;

      // A deductor's totals row.
      if (summary && TAN.test((cells[summary.tan] ?? '').toUpperCase())) {
        closeDeductor();
        deductor = {
          name: textOf(cells[summary.name]),
          tan: cells[summary.tan]!.toUpperCase(),
          amount: amountOf(cells[summary.amount]) ?? '0.00',
          tax: amountOf(cells[summary.tax]) ?? '0.00',
        };
        continue;
      }
      // One of its transactions.
      if (detail && deductor) {
        const section = textOf(cells[detail.section], 40);
        const amount = amountOf(cells[detail.amount]);
        if (!section || !/\d{3}/.test(section) || amount === null) {
          skipped += 1;
          continue;
        }
        const status = (detail.status >= 0 ? cells[detail.status] : '')?.toUpperCase();
        lines.push({
          head: headForSection(section),
          section,
          description: status && status !== 'F' ? `Booking status ${status}` : null,
          payerName: deductor.name,
          payerTan: deductor.tan,
          amount,
          taxDeducted: amountOf(cells[detail.tax]) ?? '0.00',
          transactionOn: dateOf(cells[detail.date]),
        });
        deductorLines += 1;
        continue;
      }
      skipped += 1;
    }
    closeDeductor();

    if (lines.length === 0)
      warnings.push(
        'No TDS lines were found in Part I. Check this is the 26AS text export for the right year.',
      );
    if (sawOther.size > 0)
      warnings.push(
        `Parts ${[...sawOther].join(', ')} (tax deducted by the client, TCS, tax paid, refunds, demands) are not imported.`,
      );
    if (lines.some((l) => l.head === 'unclassified'))
      warnings.push('Some lines have no section: choose their head on the matching view.');
    return { format: this.format, lines, skipped, warnings };
  },
};
