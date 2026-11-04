import { GST_STATES, formatInr, type GstSplit } from '@hsdg/contracts';
import { fitInto, type PdfImage } from './pdf-image';

/** Where the firm is paid: printed under the totals when any of it is on file. */
export interface FirmBank {
  accountName: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  branch: string | null;
  upiId: string | null;
}

/**
 * PS-201 · the issued invoice as a PDF. A tax invoice is text and rules, so a
 * small PDF 1.4 writer (built-in Helvetica, WinAnsi) does the job without a
 * rendering dependency. The layout follows CGST rule 46: supplier and
 * recipient with GSTINs, number and date, place of supply, SAC per line, the
 * taxable value, the CGST/SGST or IGST per rate, the total in figures and in
 * words, and whether tax is payable on reverse charge.
 */
export interface InvoicePdfData {
  firm: {
    name: string;
    address: string | null;
    gstin: string | null;
    stateCode: string | null;
    pan?: string | null;
    frn?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    bank?: FirmBank | null;
    logo?: PdfImage | null;
  };
  client: { name: string; pan: string | null; gstin: string | null };
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  placeOfSupplyState: string | null;
  isReverseCharge: boolean;
  lines: {
    description: string;
    sacCode: string | null;
    quantity: string;
    unitAmount: string;
    gstRate: string;
    taxableValue: string;
  }[];
  split: GstSplit;
  /** Legacy invoices (no firm GST state) carry a single tax figure. */
  taxAmount: string;
  total: string;
  amountInWords: string;
  notes: string | null;
}

export const A4 = { w: 595, h: 842 };
export const MARGIN = 48;

/** Helvetica advance widths (per 1000 em) for the characters we right-align. */
const WIDTHS: Record<string, number> = { '.': 278, ',': 278, '-': 333, ' ': 278, '%': 889 };
const textWidth = (s: string, size: number): number =>
  ([...s].reduce((w, c) => w + (WIDTHS[c] ?? 556), 0) * size) / 1000;

/** Keep to WinAnsi: the rupee sign and typographic marks become plain text. */
function ascii(s: string): string {
  return s
    .replace(/₹/g, 'Rs.')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/·/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e]/g, '?');
}

const esc = (s: string): string => ascii(s).replace(/[\\()]/g, (c) => `\\${c}`);

export class Page {
  readonly ops: string[] = [];
  text(x: number, y: number, s: string, size = 9, bold = false): void {
    this.ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`,
    );
  }
  right(xRight: number, y: number, s: string, size = 9, bold = false): void {
    this.text(xRight - textWidth(ascii(s), size), y, s, size, bold);
  }
  rule(x1: number, y1: number, x2: number, y2: number, width = 0.5): void {
    this.ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  /** Draw the document's image (/Im1) with its bottom-left at x, y. */
  image(x: number, y: number, w: number, h: number): void {
    this.ops.push(`q ${w} 0 0 ${h} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q`);
  }
}

/** The firm's lines under its name: address, GSTIN/state, PAN/FRN, contact. Pure — tested. */
export function firmHeaderLines(f: InvoicePdfData['firm']): string[] {
  const out = wrap(f.address ?? '', 80).filter(Boolean);
  if (f.gstin) out.push(`GSTIN: ${f.gstin}   State: ${stateLabel(f.stateCode)}`);
  const ids = [f.pan && `PAN: ${f.pan}`, f.frn && `FRN: ${f.frn}`].filter(Boolean);
  if (ids.length) out.push(ids.join('   '));
  const contact = [f.phone && `Phone: ${f.phone}`, f.email && `Email: ${f.email}`, f.website]
    .filter(Boolean)
    .join('   ');
  if (contact) out.push(contact);
  return out;
}

/** The "Bank details" block, or nothing when none is on file. Pure — tested. */
export function bankLines(b: FirmBank | null | undefined): string[] {
  if (!b) return [];
  const out = [
    b.accountName && `Account name: ${b.accountName}`,
    (b.bankName || b.branch) && `Bank: ${[b.bankName, b.branch].filter(Boolean).join(', ')}`,
    (b.accountNumber || b.ifsc) &&
      [b.accountNumber && `A/c no: ${b.accountNumber}`, b.ifsc && `IFSC: ${b.ifsc}`]
        .filter(Boolean)
        .join('   '),
    b.upiId && `UPI: ${b.upiId}`,
  ].filter((l): l is string => Boolean(l));
  return out;
}

/** Break text into lines of at most `max` characters on word boundaries. */
export function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > max) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
      while (line.length > max) {
        out.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    out.push(line);
  }
  return out;
}

export const stateLabel = (code: string | null): string =>
  code ? `${GST_STATES[code] ?? 'State'} (${code})` : '-';

export const dmy = (iso: string | null): string => (iso ? iso.split('-').reverse().join('-') : '-');

export function renderInvoicePdf(d: InvoicePdfData): Buffer {
  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);
  let y = A4.h - MARGIN;
  const right = A4.w - MARGIN;
  const need = (h: number): void => {
    if (y - h >= MARGIN + 20) return;
    page = new Page();
    pages.push(page);
    y = A4.h - MARGIN;
  };

  // Header: the logo (if any) and the firm, then TAX INVOICE.
  const top = y;
  let x = MARGIN;
  if (d.firm.logo) {
    const box = fitInto(d.firm.logo, 64, 56);
    page.image(MARGIN, top + 10 - box.h, box.w, box.h);
    x = MARGIN + box.w + 12;
  }
  page.text(x, y, d.firm.name, 14, true);
  y -= 14;
  for (const l of firmHeaderLines(d.firm)) {
    page.text(x, y, l, 9);
    y -= 11;
  }
  if (d.firm.logo) y = Math.min(y, top + 10 - fitInto(d.firm.logo, 64, 56).h - 4);
  y -= 8;
  page.text(MARGIN, y, 'TAX INVOICE', 13, true);
  page.right(right, y, `Invoice No. ${d.invoiceNumber}`, 10, true);
  y -= 14;
  page.right(right, y, `Date: ${dmy(d.issueDate)}`, 9);
  y -= 11;
  page.right(right, y, `Due: ${dmy(d.dueDate)}`, 9);
  y -= 16;
  page.rule(MARGIN, y, right, y);
  y -= 14;

  // Recipient.
  page.text(MARGIN, y, 'Billed to', 9, true);
  y -= 12;
  page.text(MARGIN, y, d.client.name, 10, true);
  y -= 12;
  if (d.client.gstin) {
    page.text(MARGIN, y, `GSTIN: ${d.client.gstin}`, 9);
    y -= 11;
  }
  if (d.client.pan) {
    page.text(MARGIN, y, `PAN: ${d.client.pan}`, 9);
    y -= 11;
  }
  page.text(
    MARGIN,
    y,
    `Place of supply: ${stateLabel(d.placeOfSupplyState ?? d.firm.stateCode)}`,
    9,
  );
  y -= 11;
  page.text(MARGIN, y, `Tax payable on reverse charge: ${d.isReverseCharge ? 'Yes' : 'No'}`, 9);
  y -= 18;

  // Lines.
  const col = { sac: 290, qty: 350, rate: 425, gst: 462, amt: right };
  const header = (): void => {
    page.rule(MARGIN, y + 10, right, y + 10);
    page.text(MARGIN, y, 'Description', 9, true);
    page.text(col.sac, y, 'SAC', 9, true);
    page.right(col.qty, y, 'Qty', 9, true);
    page.right(col.rate, y, 'Rate', 9, true);
    page.right(col.gst, y, 'GST %', 9, true);
    page.right(col.amt, y, 'Taxable value', 9, true);
    y -= 6;
    page.rule(MARGIN, y, right, y);
    y -= 12;
  };
  header();
  for (const line of d.lines) {
    const desc = wrap(line.description, 48);
    need(desc.length * 11 + 4);
    if (y === A4.h - MARGIN) header();
    page.text(col.sac, y, line.sacCode ?? '', 9);
    page.right(col.qty, y, line.quantity.replace(/\.00$/, ''), 9);
    page.right(col.rate, y, formatInr(line.unitAmount), 9);
    page.right(col.gst, y, line.gstRate.replace(/\.00$/, ''), 9);
    page.right(col.amt, y, formatInr(line.taxableValue), 9);
    for (const l of desc) {
      page.text(MARGIN, y, l, 9);
      y -= 11;
    }
    y -= 3;
  }
  page.rule(MARGIN, y + 6, right, y + 6);
  y -= 8;

  // Totals.
  need(140);
  const label = 380;
  const row = (name: string, value: string, bold = false): void => {
    page.text(label, y, name, 9, bold);
    page.right(right, y, value, 9, bold);
    y -= 13;
  };
  row('Taxable value', formatInr(d.split.taxable));
  const gst = d.split.byRate.filter((b) => Number(b.rate) > 0);
  if (gst.length) {
    for (const b of gst) {
      if (d.split.intraState) {
        row(`CGST @ ${Number(b.rate) / 2}%`, formatInr(b.cgst));
        row(`SGST @ ${Number(b.rate) / 2}%`, formatInr(b.sgst));
      } else {
        row(`IGST @ ${b.rate}%`, formatInr(b.igst));
      }
    }
  } else if (Number(d.taxAmount) > 0) {
    row('Tax', formatInr(d.taxAmount));
  }
  if (d.isReverseCharge) row('Tax payable by recipient (reverse charge)', formatInr(d.split.tax));
  page.rule(label, y + 9, right, y + 9);
  row('Total (Rs.)', formatInr(d.total), true);
  y -= 4;
  for (const l of wrap(d.amountInWords, 95)) {
    need(12);
    page.text(MARGIN, y, l, 9, true);
    y -= 12;
  }
  if (d.notes) {
    y -= 8;
    for (const l of wrap(d.notes, 95)) {
      need(12);
      page.text(MARGIN, y, l, 9);
      y -= 11;
    }
  }
  const bank = bankLines(d.firm.bank);
  need(Math.max(40, bank.length ? 24 + 12 * (bank.length + 1) : 0));
  y -= 24;
  const signY = y;
  if (bank.length) {
    page.text(MARGIN, y, 'Bank details', 9, true);
    y -= 12;
    for (const l of bank) {
      page.text(MARGIN, y, l, 9);
      y -= 11;
    }
  }
  page.right(right, signY, `For ${d.firm.name}`, 9, true);
  page.right(right, signY - 30, 'Authorised signatory', 9);

  pages.forEach((p, i) => {
    p.right(right, MARGIN - 20, `Page ${i + 1} of ${pages.length}`, 7);
  });
  return assemble(pages, d.firm.logo ?? null);
}

/**
 * Objects: 1 catalog, 2 pages, 3–4 fonts, then a page and its content per
 * page, then the image (if any) as /Im1 on every page.
 */
export function assemble(pages: Page[], image: PdfImage | null = null): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const imageId = image ? 5 + pages.length * 2 : null;
  if (image && imageId) {
    objects[imageId] =
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
      `/ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter} ` +
      `/Length ${image.data.length} >>\nstream\n${image.data.toString('latin1')}\nendstream`;
  }
  const xobject = imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : '';
  pages.forEach((p, i) => {
    const pageId = pageIds[i]!;
    const stream = p.ops.join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobject} >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]!}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
