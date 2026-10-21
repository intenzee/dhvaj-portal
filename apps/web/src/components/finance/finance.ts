import {
  PERMISSION,
  fromPaise,
  toPaise,
  type BankMatchLine,
  type BankMatchProposal,
  type BooksVoucher,
  type GstOutwardRegister,
  type GstTotals,
  type MatchConfidence,
} from '@hsdg/contracts';
import { can, type Principal } from '@/lib/principal';
import type { ReceiptPrefill } from '@/components/billing/record-receipt-modal';

/**
 * Accountant role, phase 2c · Reports → Finance: the pure parts of the page.
 * Firm-wide reports, so only the Accountant and the Managing Partner
 * (entity.read_billing) see them.
 */
export const canReadFinance = (principal: Principal | null): boolean =>
  can(principal, PERMISSION.entityReadBilling);

/** This month in IST, 'YYYY-MM'. */
export function currentMonth(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
}

/** 'YYYY-MM' moved by whole months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** GSTR-1 is due on the 11th of the next month. */
export function gstr1Due(month: string): string {
  return `${shiftMonth(month, 1)}-11`;
}

const sum = (xs: string[]): string => fromPaise(xs.reduce((a, x) => a + toPaise(x), 0n));

/** The register's tables as counts and taxable value, for the summary strip. */
export function registerSections(
  r: GstOutwardRegister,
): { key: string; label: string; count: number; taxable: string }[] {
  const items = (rows: { items: { taxable: string }[] }[]) =>
    rows.flatMap((x) => x.items.map((i) => i.taxable));
  return [
    { key: 'b2b', label: 'B2B (4A)', count: r.b2b.length, taxable: sum(items(r.b2b)) },
    { key: 'b2cl', label: 'B2C large (5)', count: r.b2cl.length, taxable: sum(items(r.b2cl)) },
    {
      key: 'b2cs',
      label: 'B2C small (7)',
      count: r.b2cs.length,
      taxable: sum(r.b2cs.map((x) => x.taxable)),
    },
    {
      key: 'cdnr',
      label: 'Credit notes, registered (9B)',
      count: r.cdnr.length,
      taxable: sum(items(r.cdnr)),
    },
    {
      key: 'cdnur',
      label: 'Credit notes, unregistered (9B)',
      count: r.cdnur.length,
      taxable: sum(items(r.cdnur)),
    },
  ];
}

/** Portal minus register, per column; all zero when the register ties. */
export function tieDifference(portal: GstTotals, register: GstTotals): GstTotals {
  const d = (k: keyof GstTotals) => fromPaise(toPaise(portal[k]) - toPaise(register[k]));
  return {
    taxable: d('taxable'),
    igst: d('igst'),
    cgst: d('cgst'),
    sgst: d('sgst'),
    total: d('total'),
  };
}

/** A voucher's amount: the sum of its debits. */
export function voucherAmount(v: BooksVoucher): string {
  return sum(v.entries.map((e) => e.debit));
}

export const CONFIDENCE: Record<MatchConfidence, { label: string; tone: string }> = {
  high: { label: 'Sure', tone: 'success' },
  medium: { label: 'Likely', tone: 'info' },
  low: { label: 'Guess', tone: 'warn' },
};

/** The receipt a matched credit makes: net is the credit, the split is the proposal's. */
export function receiptFromMatch(line: BankMatchLine, p: BankMatchProposal): ReceiptPrefill {
  return {
    receivedOn: line.credit.date,
    reference: (line.credit.reference ?? line.credit.narration).slice(0, 200) || null,
    net: line.credit.amount,
    tds: p.tds,
    allocations: p.invoices.map((i) => ({ invoiceId: i.invoiceId, amount: i.allocate })),
  };
}

/** The file's bytes, base64, for an upload DTO. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      const url = String(reader.result ?? '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Largest bank statement the API reads. */
export const BANK_STATEMENT_MAX_BYTES = 5 * 1024 * 1024;
