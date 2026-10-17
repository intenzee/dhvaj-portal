import { formatInr } from '@hsdg/contracts';
import { A4, MARGIN, Page, assemble, dmy, stateLabel, wrap } from './invoice-pdf';

/**
 * PS-205 · an approved credit note as a PDF, written like the tax invoice
 * (invoice-pdf.ts). The layout follows CGST rule 53(1A): the supplier's and
 * the recipient's names, addresses and GSTINs; the nature of the document;
 * its number (≤ 16 characters, one series a financial year) and date; the
 * number and date of the tax invoice it reduces; the taxable value, rate and
 * tax credited per line; and the supplier's signature. Place of supply, the
 * reason and the total in words are printed as well. A voided note prints
 * with its void, so a copy cannot pass for a live one.
 */
export interface CreditNotePdfData {
  firm: { name: string; address: string | null; gstin: string | null; stateCode: string | null };
  client: {
    name: string;
    gstin: string | null;
    pan: string | null;
    address: string | null;
    /** The recipient's state code (from the GSTIN, else the place of supply). */
    stateCode: string | null;
  };
  creditNoteNumber: string;
  creditDate: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  placeOfSupplyState: string | null;
  isReverseCharge: boolean;
  reason: string;
  /** CGST + SGST when the place of supply is the firm's state; else IGST. */
  intraState: boolean;
  lines: {
    description: string;
    sacCode: string | null;
    taxableValue: string;
    gstRate: string;
    cgst: string;
    sgst: string;
    igst: string;
    total: string;
  }[];
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
  amountInWords: string;
  voided: { on: string; reason: string } | null;
}

const rate = (r: string): string => r.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');

export function renderCreditNotePdf(d: CreditNotePdfData): Buffer {
  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);
  let y = A4.h - MARGIN;
  const right = A4.w - MARGIN;
  const need = (h: number): boolean => {
    if (y - h >= MARGIN + 20) return false;
    page = new Page();
    pages.push(page);
    y = A4.h - MARGIN;
    return true;
  };

  // Supplier, then the nature of the document.
  page.text(MARGIN, y, d.firm.name, 14, true);
  y -= 14;
  for (const l of wrap(d.firm.address ?? '', 80).filter(Boolean)) {
    page.text(MARGIN, y, l, 9);
    y -= 11;
  }
  if (d.firm.gstin) {
    page.text(MARGIN, y, `GSTIN: ${d.firm.gstin}   State: ${stateLabel(d.firm.stateCode)}`, 9);
    y -= 11;
  }
  y -= 8;
  page.text(MARGIN, y, 'CREDIT NOTE', 13, true);
  page.right(right, y, `Credit Note No. ${d.creditNoteNumber}`, 10, true);
  y -= 14;
  page.right(right, y, `Date: ${dmy(d.creditDate)}`, 9);
  y -= 11;
  page.right(right, y, `Against Tax Invoice No. ${d.invoiceNumber} dated ${dmy(d.invoiceDate)}`, 9);
  y -= 14;
  if (d.voided) {
    page.text(MARGIN, y, `VOID - cancelled on ${dmy(d.voided.on)}`, 11, true);
    y -= 12;
    for (const l of wrap(`Reason: ${d.voided.reason}`, 95)) {
      page.text(MARGIN, y, l, 9);
      y -= 11;
    }
    y -= 2;
  }
  page.rule(MARGIN, y, right, y);
  y -= 14;

  // Recipient.
  page.text(MARGIN, y, 'Issued to', 9, true);
  y -= 12;
  page.text(MARGIN, y, d.client.name, 10, true);
  y -= 12;
  for (const l of wrap(d.client.address ?? '', 80).filter(Boolean)) {
    page.text(MARGIN, y, l, 9);
    y -= 11;
  }
  page.text(MARGIN, y, `GSTIN: ${d.client.gstin ?? 'Unregistered'}`, 9);
  y -= 11;
  if (d.client.pan) {
    page.text(MARGIN, y, `PAN: ${d.client.pan}`, 9);
    y -= 11;
  }
  page.text(MARGIN, y, `State: ${stateLabel(d.client.stateCode)}`, 9);
  y -= 11;
  page.text(
    MARGIN,
    y,
    `Place of supply: ${stateLabel(d.placeOfSupplyState ?? d.firm.stateCode)}`,
    9,
  );
  y -= 11;
  if (d.isReverseCharge) {
    page.text(MARGIN, y, 'The invoice was under reverse charge; no tax is credited.', 9);
    y -= 11;
  }
  y -= 4;
  for (const [i, l] of wrap(`Reason: ${d.reason}`, 95).entries()) {
    page.text(MARGIN, y, l, 9, i === 0);
    y -= 11;
  }
  y -= 10;

  // Lines: the part of each invoice line credited, and its tax.
  const col = d.intraState
    ? { sac: 236, taxable: 330, rate: 365, a: 425, b: 485, total: right }
    : { sac: 236, taxable: 345, rate: 385, a: 465, b: 0, total: right };
  const header = (): void => {
    page.rule(MARGIN, y + 10, right, y + 10);
    page.text(MARGIN, y, 'Description', 9, true);
    page.text(col.sac, y, 'SAC', 9, true);
    page.right(col.taxable, y, 'Taxable', 9, true);
    page.right(col.rate, y, 'GST %', 9, true);
    page.right(col.a, y, d.intraState ? 'CGST' : 'IGST', 9, true);
    if (d.intraState) page.right(col.b, y, 'SGST', 9, true);
    page.right(col.total, y, 'Total', 9, true);
    y -= 6;
    page.rule(MARGIN, y, right, y);
    y -= 12;
  };
  header();
  for (const line of d.lines) {
    const desc = wrap(line.description, 34);
    if (need(desc.length * 11 + 4)) header();
    page.text(col.sac, y, line.sacCode ?? '', 9);
    page.right(col.taxable, y, formatInr(line.taxableValue), 9);
    page.right(col.rate, y, rate(line.gstRate), 9);
    page.right(col.a, y, formatInr(d.intraState ? line.cgst : line.igst), 9);
    if (d.intraState) page.right(col.b, y, formatInr(line.sgst), 9);
    page.right(col.total, y, formatInr(line.total), 9);
    for (const l of desc) {
      page.text(MARGIN, y, l, 9);
      y -= 11;
    }
    y -= 3;
  }
  page.rule(MARGIN, y + 6, right, y + 6);
  y -= 8;

  // Totals.
  need(110);
  const label = 380;
  const row = (name: string, value: string, bold = false): void => {
    page.text(label, y, name, 9, bold);
    page.right(right, y, value, 9, bold);
    y -= 13;
  };
  row('Taxable value', formatInr(d.taxableValue));
  if (d.intraState) {
    row('CGST', formatInr(d.cgst));
    row('SGST', formatInr(d.sgst));
  } else {
    row('IGST', formatInr(d.igst));
  }
  page.rule(label, y + 9, right, y + 9);
  row('Total credited (Rs.)', formatInr(d.total), true);
  y -= 4;
  for (const l of wrap(d.amountInWords, 95)) {
    need(12);
    page.text(MARGIN, y, l, 9, true);
    y -= 12;
  }

  need(40);
  y -= 24;
  page.right(right, y, `For ${d.firm.name}`, 9, true);
  y -= 30;
  page.right(right, y, 'Authorised signatory', 9);

  pages.forEach((p, i) => {
    p.right(right, MARGIN - 20, `Page ${i + 1} of ${pages.length}`, 7);
  });
  return assemble(pages);
}
