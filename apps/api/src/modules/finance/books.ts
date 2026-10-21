import {
  fromPaise,
  toPaise,
  type BooksLedgers,
  type BooksVoucher,
  type VoucherEntry,
  type VoucherSource,
} from '@hsdg/contracts';
import { monthEnd } from './gst-register';

/**
 * Phase 2c · the month's billing as accounting vouchers for the firm's books
 * (Tally): sales, receipts, credit notes, write-offs, and a reversal for each
 * void that reaches the books. Something issued and voided in the same month
 * before it was ever exported never reaches the books at all. Pure.
 */

export interface BooksInvoiceRow {
  id: string;
  number: string;
  date: string;
  clientName: string;
  subtotal: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  /** IST date it was voided, or null. */
  voidedOn: string | null;
}

export interface BooksReceiptRow {
  id: string;
  date: string;
  clientName: string;
  mode: string;
  reference: string | null;
  gross: string;
  tds: string;
  tdsSection: string | null;
  net: string;
  /** Invoice numbers it paid, comma-separated. */
  against: string | null;
  reversedOn: string | null;
}

export interface BooksCreditNoteRow {
  id: string;
  number: string;
  date: string;
  clientName: string;
  invoiceNumber: string | null;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  voidedOn: string | null;
}

export interface BooksWriteOffRow {
  id: string;
  date: string;
  clientName: string;
  invoiceNumber: string | null;
  amount: string;
}

export interface BooksInput {
  month: string;
  ledgers: BooksLedgers;
  /** Issued in the month, or issued earlier and voided in it. */
  invoices: BooksInvoiceRow[];
  receipts: BooksReceiptRow[];
  creditNotes: BooksCreditNoteRow[];
  writeOffs: BooksWriteOffRow[];
  /** `${source}|${sourceId}` → when it was exported. */
  exported: Map<string, string>;
}

export const voucherKey = (source: VoucherSource, id: string): string => `${source}|${id}`;

const dr = (ledger: string, amount: string): VoucherEntry => ({
  ledger,
  debit: amount,
  credit: '0.00',
});
const cr = (ledger: string, amount: string): VoucherEntry => ({
  ledger,
  debit: '0.00',
  credit: amount,
});
const nonZero = (e: VoucherEntry): boolean => toPaise(e.debit) !== 0n || toPaise(e.credit) !== 0n;
const swap = (entries: VoucherEntry[]): VoucherEntry[] =>
  entries.map((e) => ({ ledger: e.ledger, debit: e.credit, credit: e.debit }));
const short = (id: string): string => id.replace(/-/g, '').slice(0, 8).toUpperCase();

/** Debits equal credits; every voucher this module writes must pass. */
export function balanced(v: Pick<BooksVoucher, 'entries'>): boolean {
  let d = 0n;
  let c = 0n;
  for (const e of v.entries) {
    d += toPaise(e.debit);
    c += toPaise(e.credit);
  }
  return d === c;
}

/**
 * The output tax an invoice charged: its CGST/SGST/IGST when they make up
 * total − subtotal. An older invoice may carry its tax without the split; it
 * is posted as CGST and SGST in halves (the firm's own state, as the GST
 * register takes an invoice with no place of supply), CGST taking the odd
 * paisa. Reverse charge: nothing was charged, so nothing is posted.
 */
export function outputTax(
  i: Pick<BooksInvoiceRow, 'subtotal' | 'cgst' | 'sgst' | 'igst' | 'total'>,
): {
  cgst: string;
  sgst: string;
  igst: string;
  unsplit: boolean;
} {
  const charged = toPaise(i.total) - toPaise(i.subtotal);
  const split = toPaise(i.cgst) + toPaise(i.sgst) + toPaise(i.igst);
  if (charged === split) return { cgst: i.cgst, sgst: i.sgst, igst: i.igst, unsplit: false };
  if (charged <= 0n) return { cgst: '0.00', sgst: '0.00', igst: '0.00', unsplit: false };
  const sgst = charged / 2n;
  return { cgst: fromPaise(charged - sgst), sgst: fromPaise(sgst), igst: '0.00', unsplit: true };
}

export function buildVouchers(input: BooksInput): BooksVoucher[] {
  const start = `${input.month}-01`;
  const end = monthEnd(input.month);
  const inMonth = (d: string | null): d is string => !!d && d >= start && d <= end;
  const L = input.ledgers;
  const out: BooksVoucher[] = [];
  const push = (
    v: Omit<BooksVoucher, 'exportedAt' | 'entries'> & { entries: VoucherEntry[] },
  ): void => {
    out.push({
      ...v,
      entries: v.entries.filter(nonZero),
      exportedAt: input.exported.get(voucherKey(v.source, v.sourceId)) ?? null,
    });
  };
  const wasExported = (source: VoucherSource, id: string): boolean =>
    input.exported.has(voucherKey(source, id));
  // Issued and voided within the month, never exported: it never happened in the books.
  const cancelledWithin = (
    source: VoucherSource,
    id: string,
    date: string,
    voidedOn: string | null,
  ): boolean => inMonth(date) && inMonth(voidedOn) && !wasExported(source, id);

  for (const i of input.invoices) {
    const tax = outputTax(i);
    const entries = [
      dr(i.clientName, i.total),
      cr(L.sales, i.subtotal),
      cr(L.outputCgst, tax.cgst),
      cr(L.outputSgst, tax.sgst),
      cr(L.outputIgst, tax.igst),
    ];
    const note = tax.unsplit ? ' (GST not split on the invoice; posted as CGST and SGST)' : '';
    if (cancelledWithin('invoice', i.id, i.date, i.voidedOn)) continue;
    if (inMonth(i.date)) {
      push({
        source: 'invoice',
        sourceId: i.id,
        date: i.date,
        type: 'Sales',
        number: i.number,
        party: i.clientName,
        narration: `Invoice ${i.number}${note}`,
        entries,
      });
    }
    if (inMonth(i.voidedOn)) {
      push({
        source: 'invoice_void',
        sourceId: i.id,
        date: i.voidedOn,
        type: 'Journal',
        number: `${i.number}-VOID`,
        party: i.clientName,
        narration: `Invoice ${i.number} voided`,
        entries: swap(entries),
      });
    }
  }

  for (const r of input.receipts) {
    const bank = r.mode === 'cash' ? L.cash : r.mode === 'adjustment' ? L.adjustment : L.bank;
    const entries = [dr(bank, r.net), dr(L.tdsReceivable, r.tds), cr(r.clientName, r.gross)];
    const number = `RCPT/${short(r.id)}`;
    if (cancelledWithin('receipt', r.id, r.date, r.reversedOn)) continue;
    const how = [r.mode === 'upi' ? 'UPI' : r.mode, r.reference].filter(Boolean).join(' ');
    const tds =
      toPaise(r.tds) > 0n
        ? `; TDS ${r.tds}${r.tdsSection && r.tdsSection !== 'other' ? ` u/s ${r.tdsSection}` : ''}`
        : '';
    if (inMonth(r.date)) {
      push({
        source: 'receipt',
        sourceId: r.id,
        date: r.date,
        type: 'Receipt',
        number,
        party: r.clientName,
        narration: `Received ${how}${r.against ? ` against ${r.against}` : ''}${tds}`,
        entries,
      });
    }
    if (inMonth(r.reversedOn)) {
      push({
        source: 'receipt_reversal',
        sourceId: r.id,
        date: r.reversedOn,
        type: 'Journal',
        number: `${number}-REV`,
        party: r.clientName,
        narration: `Receipt ${how} reversed`,
        entries: swap(entries),
      });
    }
  }

  for (const c of input.creditNotes) {
    const entries = [
      dr(L.sales, c.taxable),
      dr(L.outputCgst, c.cgst),
      dr(L.outputSgst, c.sgst),
      dr(L.outputIgst, c.igst),
      cr(c.clientName, c.total),
    ];
    if (cancelledWithin('credit_note', c.id, c.date, c.voidedOn)) continue;
    if (inMonth(c.date)) {
      push({
        source: 'credit_note',
        sourceId: c.id,
        date: c.date,
        type: 'Credit Note',
        number: c.number,
        party: c.clientName,
        narration: `Credit note ${c.number}${c.invoiceNumber ? ` against ${c.invoiceNumber}` : ''}`,
        entries,
      });
    }
    if (inMonth(c.voidedOn)) {
      push({
        source: 'credit_note_void',
        sourceId: c.id,
        date: c.voidedOn,
        type: 'Journal',
        number: `${c.number}-VOID`,
        party: c.clientName,
        narration: `Credit note ${c.number} voided`,
        entries: swap(entries),
      });
    }
  }

  for (const w of input.writeOffs) {
    if (!inMonth(w.date)) continue;
    push({
      source: 'write_off',
      sourceId: w.id,
      date: w.date,
      type: 'Journal',
      number: `WO/${short(w.id)}`,
      party: w.clientName,
      narration: `Written off${w.invoiceNumber ? ` on ${w.invoiceNumber}` : ''}`,
      entries: [dr(L.badDebts, w.amount), cr(w.clientName, w.amount)],
    });
  }

  for (const v of out) {
    if (!balanced(v)) throw new Error(`Voucher ${v.number} does not balance.`);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

// ── Files ──

const csvCell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** '2026-10-05' → '05-10-2026'. */
const dmy = (iso: string): string => iso.split('-').reverse().join('-');

/** One row per ledger line: what any accounting package can import. */
export function journalCsv(vouchers: BooksVoucher[]): string {
  const rows = [['Date', 'Voucher Type', 'Voucher No', 'Ledger', 'Debit', 'Credit', 'Narration']];
  for (const v of vouchers) {
    for (const e of v.entries) {
      rows.push([dmy(v.date), v.type, v.number, e.ledger, e.debit, e.credit, v.narration]);
    }
  }
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const xml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Tally import XML (Gateway of Tally → Import → Vouchers). Debits are
 * negative with ISDEEMEDPOSITIVE Yes, credits positive with No. The ledgers
 * must exist in Tally first: clients under Sundry Debtors, by the names here.
 */
export function tallyXml(vouchers: BooksVoucher[]): string {
  const body = vouchers
    .map((v) => {
      const lines = v.entries
        .map((e) => {
          const debit = toPaise(e.debit) !== 0n;
          const amount = debit ? fromPaise(-toPaise(e.debit)) : fromPaise(toPaise(e.credit));
          return [
            '<ALLLEDGERENTRIES.LIST>',
            `<LEDGERNAME>${xml(e.ledger)}</LEDGERNAME>`,
            `<ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
            `<AMOUNT>${amount}</AMOUNT>`,
            '</ALLLEDGERENTRIES.LIST>',
          ].join('');
        })
        .join('\n');
      return [
        '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
        `<VOUCHER VCHTYPE="${xml(v.type)}" ACTION="Create">`,
        `<DATE>${v.date.replace(/-/g, '')}</DATE>`,
        `<VOUCHERTYPENAME>${xml(v.type)}</VOUCHERTYPENAME>`,
        `<VOUCHERNUMBER>${xml(v.number)}</VOUCHERNUMBER>`,
        `<PARTYLEDGERNAME>${xml(v.party)}</PARTYLEDGERNAME>`,
        `<NARRATION>${xml(v.narration)}</NARRATION>`,
        lines,
        '</VOUCHER>',
        '</TALLYMESSAGE>',
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
    '<BODY><IMPORTDATA>',
    '<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>',
    '<REQUESTDATA>',
    body,
    '</REQUESTDATA>',
    '</IMPORTDATA></BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n');
}
