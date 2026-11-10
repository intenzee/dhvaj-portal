import { GST_STATES, formatInr, type GstSplit } from '@hsdg/contracts';
import { fitInto, type PdfImage } from './pdf-image';

/** Where the firm is paid: printed beside the amount in words when any of it is on file. */
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
 * rendering dependency. The layout is the firm's own (the Tally-style boxed
 * invoice it has always sent), and it carries what CGST rule 46 asks for:
 * supplier and recipient with GSTINs and states, number and date, place of
 * supply, SAC per line, the taxable value, the CGST/SGST or IGST per rate, the
 * total in figures and in words, and whether tax is payable on reverse charge.
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
  client: { name: string; pan: string | null; gstin: string | null; address?: string | null };
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

// Helvetica and Helvetica-Bold advance widths (per 1000 em), ASCII 32–126;
// the obliques share them.
const REGULAR = (
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' +
  '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 ' +
  '667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 ' +
  '278 278 278 469 556 333 ' +
  '556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 ' +
  '334 260 334 584'
)
  .split(' ')
  .map(Number);
const BOLD = (
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 ' +
  '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 ' +
  '722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 ' +
  '333 278 333 584 556 333 ' +
  '556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 ' +
  '389 280 389 584'
)
  .split(' ')
  .map(Number);
export const FONT_METRICS = { regular: REGULAR, bold: BOLD };

/** The width of WinAnsi text in points. Pure — tested. */
export function textWidth(s: string, size: number, bold = false): number {
  const table = bold ? BOLD : REGULAR;
  return ([...s].reduce((w, c) => w + (table[c.charCodeAt(0) - 32] ?? 556), 0) * size) / 1000;
}

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
  text(x: number, y: number, s: string, size = 9, bold = false, italic = false): void {
    const font = italic ? (bold ? 'F4' : 'F3') : bold ? 'F2' : 'F1';
    this.ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(s)}) Tj ET`);
  }
  right(xRight: number, y: number, s: string, size = 9, bold = false, italic = false): void {
    this.text(xRight - textWidth(ascii(s), size, bold), y, s, size, bold, italic);
  }
  center(xMid: number, y: number, s: string, size = 9, bold = false): void {
    this.text(xMid - textWidth(ascii(s), size, bold) / 2, y, s, size, bold);
  }
  rule(x1: number, y1: number, x2: number, y2: number, width = 0.5): void {
    this.ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  /** Draw the document's image (/Im1) with its bottom-left at x, y. */
  image(x: number, y: number, w: number, h: number): void {
    this.ops.push(`q ${w} 0 0 ${h} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q`);
  }
  /**
   * The rupee sign, which WinAnsi has no glyph for, drawn in strokes: two
   * bars, the bowl and the leg, its left edge at x on the baseline y.
   */
  rupee(x: number, y: number, size: number): void {
    const u = size / 1000;
    const p = (dx: number, dy: number): string =>
      `${(x + dx * u).toFixed(2)} ${(y + dy * u).toFixed(2)}`;
    this.ops.push(
      `q ${(80 * u).toFixed(2)} w 0 J ` +
        `${p(40, 700)} m ${p(500, 700)} l S ` +
        `${p(40, 560)} m ${p(500, 560)} l S ` +
        `${p(150, 700)} m ${p(430, 700)} ${p(430, 390)} ${p(150, 390)} c ${p(70, 390)} l S ` +
        `${p(150, 390)} m ${p(450, 0)} l S Q`,
    );
  }
}

/** The rupee sign's advance at a size: a figure's width. */
export const RUPEE_WIDTH = (size: number): number => (556 * size) / 1000;

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

/** Break text into lines no wider than `width` points; blank lines dropped. Pure — tested. */
export function wrapToWidth(s: string, width: number, size: number, bold = false): string[] {
  const fits = (t: string): boolean => textWidth(ascii(t), size, bold) <= width;
  const out: string[] = [];
  for (const para of s.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (fits(next)) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = word;
      while (!fits(line)) {
        let cut = line.length - 1;
        while (cut > 1 && !fits(line.slice(0, cut))) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export const stateLabel = (code: string | null): string =>
  code ? `${GST_STATES[code] ?? 'State'} (${code})` : '-';

const stateName = (code: string): string => GST_STATES[code] ?? code;

export const dmy = (iso: string | null): string => (iso ? iso.split('-').reverse().join('-') : '-');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-11-01' → '1-Nov-26', as the invoice dates it. Pure — tested. */
export function invoiceDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-') as [string, string, string];
  return `${Number(d)}-${MONTHS[Number(m) - 1] ?? m}-${y.slice(2)}`;
}

/** The firm's block under its name: address, GSTIN, state, phone, e-mail. Pure — tested. */
export function firmBlockLines(f: InvoicePdfData['firm']): string[] {
  const out = (f.address ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (f.gstin) out.push(`GSTIN/UIN: ${f.gstin}`);
  if (f.stateCode) out.push(`State Name :  ${stateName(f.stateCode)}, Code : ${f.stateCode}`);
  if (f.phone) out.push(`Phone : ${f.phone}`);
  if (f.email) out.push(`E-Mail : ${f.email}`);
  return out;
}

/** "Company's Bank Details", or nothing when none is on file. Pure — tested. */
export function bankLines(b: FirmBank | null | undefined): string[] {
  if (!b) return [];
  return [
    b.accountName && `A/c Holder's Name : ${b.accountName}`,
    b.bankName && `Bank Name : ${b.bankName}`,
    b.accountNumber && `A/c No. : ${b.accountNumber}`,
    (b.branch || b.ifsc) && `Branch & IFS Code : ${[b.branch, b.ifsc].filter(Boolean).join(' & ')}`,
    b.upiId && `UPI : ${b.upiId}`,
  ].filter((l): l is string => Boolean(l));
}

/**
 * A line as the invoice prints it: a bold heading and an italic detail under
 * it. Taxable work is "Professional Charges" with what it was for under it;
 * anything else (a DSC, an out-of-pocket) is its own heading, with whatever
 * follows " — " as the detail. Pure — tested.
 */
export function lineHeading(l: { description: string; gstRate: string }): {
  heading: string;
  detail: string | null;
} {
  const text = l.description.trim();
  if (Number(l.gstRate) > 0) {
    return {
      heading: 'Professional Charges',
      detail: /^professional charges$/i.test(text) ? null : text,
    };
  }
  const [head = '', ...rest] = text.split(/\s+[—–]\s+|\r?\n/);
  const detail = rest.join(' ').trim();
  return { heading: head.trim(), detail: detail || null };
}

const rateText = (r: number): string => String(Number(r.toFixed(2)));

/** The tax rows under the lines: CGST and SGST, or IGST, at each rate. Pure — tested. */
export function taxRows(
  d: Pick<InvoicePdfData, 'split' | 'taxAmount' | 'isReverseCharge'>,
): { label: string; rate: string; amount: string }[] {
  if (d.isReverseCharge) return [];
  const gst = d.split.byRate.filter((b) => Number(b.rate) > 0);
  if (gst.length) {
    return gst.flatMap((b) =>
      d.split.intraState
        ? [
            { label: 'CGST', rate: rateText(Number(b.rate) / 2), amount: b.cgst },
            { label: 'SGST', rate: rateText(Number(b.rate) / 2), amount: b.sgst },
          ]
        : [{ label: 'IGST', rate: rateText(Number(b.rate)), amount: b.igst }],
    );
  }
  return Number(d.taxAmount) > 0 ? [{ label: 'Tax', rate: '', amount: d.taxAmount }] : [];
}

/** 'Rupees Two Thousand Only' → 'INR Two Thousand Only'. */
const inrWords = (words: string): string => words.replace(/^Rupees\s+/, 'INR ');

// The page: the box runs L..R; the line table's columns end at these x.
const L = 36;
const R = A4.w - 36;
const COL = { sl: 54, desc: 300, hsn: 352, qty: 405, rate: 458, per: 482 };
const GRID = 430;
const ROW = 26;
/** Where a page that runs on stops its lines. */
const RUN_ON_BOTTOM = 72;
/** The bottom of the last page's box; "Computer Generated" sits under it. */
const BOX_BOTTOM = 56;
const SIGN_H = 46;

const DECLARATION =
  'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.';

interface BodyRow {
  h: number;
  draw: (p: Page, top: number) => void;
}

export function renderInvoicePdf(d: InvoicePdfData): Buffer {
  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);
  const tax = taxRows(d);
  const title = tax.length || d.isReverseCharge ? 'TAX INVOICE' : 'INVOICE';
  const clientState = d.client.gstin?.slice(0, 2) || d.placeOfSupplyState || d.firm.stateCode;
  const supplyState = d.placeOfSupplyState ?? clientState;

  // The title, and the logo (if any) to its left.
  const titleY = A4.h - 40;
  if (d.firm.logo) {
    const box = fitInto(d.firm.logo, 96, 28);
    page.image(L, titleY - 8, box.w, box.h);
  }
  page.center(A4.w / 2, titleY, title, 12, true);
  const top = titleY - 12;
  const leftW = COL.desc - L - 8;

  // Left: the firm, then the consignee and the buyer (the client, both).
  let y = top - 12;
  for (const n of wrapToWidth(d.firm.name, leftW, 10, true)) {
    page.text(L + 4, y, n, 10, true);
    y -= 11;
  }
  for (const l of firmBlockLines(d.firm).flatMap((l) => wrapToWidth(l, leftW, 8.5))) {
    page.text(L + 4, y, l, 8.5);
    y -= 10;
  }
  const firmBottom = Math.min(y + 5, top - 3 * ROW);
  page.rule(L, firmBottom, COL.desc, firmBottom);

  const party = (yTop: number, label: string): number => {
    let py = yTop - 10;
    page.text(L + 4, py, label, 8);
    py -= 13;
    for (const n of wrapToWidth(d.client.name, leftW, 9.5, true)) {
      page.text(L + 4, py, n, 9.5, true);
      py -= 11;
    }
    for (const a of wrapToWidth(d.client.address ?? '', leftW, 8)) {
      page.text(L + 4, py, a, 8);
      py -= 9.5;
    }
    const kv = (k: string, v: string): void => {
      page.text(L + 4, py, k, 8.5);
      page.text(L + 72, py, `:  ${v}`, 8.5);
      py -= 10.5;
    };
    if (d.client.gstin) kv('GSTIN/UIN', d.client.gstin);
    else if (d.client.pan) kv('PAN', d.client.pan);
    if (clientState) kv('State Name', `${stateName(clientState)}, Code : ${clientState}`);
    return Math.min(py + 5, yTop - 96);
  };
  const consigneeBottom = party(firmBottom, 'Consignee (Ship to)');
  page.rule(L, consigneeBottom, COL.desc, consigneeBottom);
  const blocksBottom = Math.min(party(consigneeBottom, 'Buyer (Bill to)'), top - 6 * ROW - 40);

  // Right: the reference grid, then Terms of Delivery to the bottom.
  const cells: [string, string][] = [
    ['Invoice No.', d.invoiceNumber],
    ['Dated', invoiceDate(d.issueDate)],
    ['Delivery Note', ''],
    ['Mode/Terms of Payment', d.dueDate ? `Due by ${invoiceDate(d.dueDate)}` : ''],
    ['Reference No. & Date.', ''],
    ['Other References', ''],
    ["Buyer's Order No.", ''],
    ['Dated', ''],
    ['Dispatch Doc No.', ''],
    ['Delivery Note Date', ''],
    ['Dispatched through', ''],
    ['Place of Supply', supplyState ? `${stateName(supplyState)} (${supplyState})` : ''],
  ];
  cells.forEach(([label, value], i) => {
    const x = i % 2 ? GRID : COL.desc;
    const cellTop = top - Math.floor(i / 2) * ROW;
    page.text(x + 4, cellTop - 9, label, 8);
    if (value) page.text(x + 4, cellTop - 20, value, 9, true);
  });
  for (let r = 1; r <= 6; r++) page.rule(COL.desc, top - r * ROW, R, top - r * ROW);
  page.rule(GRID, top, GRID, top - 6 * ROW);
  page.text(COL.desc + 4, top - 6 * ROW - 10, 'Terms of Delivery', 8);
  page.rule(L, top, R, top);
  for (const x of [L, COL.desc, R]) page.rule(x, top, x, blocksBottom);

  // The line table.
  const tableHeader = (p: Page, yTop: number): number => {
    const h = 22;
    p.rule(L, yTop, R, yTop);
    for (const x of [L, COL.sl, COL.desc, COL.hsn, COL.qty, COL.rate, COL.per, R]) {
      p.rule(x, yTop, x, yTop - h);
    }
    p.text(L + 3, yTop - 9, 'Sl', 8);
    p.text(L + 3, yTop - 18, 'No.', 6);
    p.center((COL.sl + COL.desc) / 2, yTop - 9, 'Description of Services', 8);
    p.center((COL.desc + COL.hsn) / 2, yTop - 9, 'HSN/SAC', 8);
    p.center((COL.hsn + COL.qty) / 2, yTop - 9, 'Quantity', 8);
    p.center((COL.qty + COL.rate) / 2, yTop - 9, 'Rate', 8);
    p.center((COL.rate + COL.per) / 2, yTop - 9, 'per', 8);
    p.center((COL.per + R) / 2, yTop - 9, 'Amount', 8);
    p.rule(L, yTop - h, R, yTop - h);
    return yTop - h;
  };
  const columns = (p: Page, yTop: number, yBottom: number): void => {
    for (const x of [L, COL.sl, COL.desc, COL.hsn, COL.qty, COL.rate, COL.per, R]) {
      p.rule(x, yTop, x, yBottom);
    }
    p.rule(L, yBottom, R, yBottom);
  };

  const descW = COL.desc - COL.sl - 8;
  const rows: BodyRow[] = d.lines.map((line, i) => {
    const { heading, detail } = lineHeading(line);
    const heads = wrapToWidth(heading, descW, 9, true);
    const details = detail ? wrapToWidth(detail, descW - 12, 8.5) : [];
    const qty = line.quantity.replace(/\.0+$/, '');
    const plain = Number(line.quantity) === 1;
    return {
      h: 6 + heads.length * 11 + details.length * 10 + 4,
      draw: (p, rowTop) => {
        let ly = rowTop - 13;
        p.right(COL.sl - 3, ly, String(i + 1), 9);
        if (line.sacCode) p.text(COL.desc + 3, ly, line.sacCode, 8.5);
        if (!plain) {
          p.right(COL.qty - 3, ly, qty, 9);
          p.right(COL.rate - 3, ly, formatInr(line.unitAmount), 9);
        }
        p.right(R - 4, ly, formatInr(line.taxableValue), 9, true);
        for (const h of heads) {
          p.text(COL.sl + 4, ly, h, 9, true);
          ly -= 11;
        }
        for (const t of details) {
          p.text(COL.sl + 16, ly + 1, t, 8.5, false, true);
          ly -= 10;
        }
      },
    };
  });
  if (tax.length) rows.push({ h: 14, draw: () => undefined });
  for (const t of tax) {
    rows.push({
      h: 12,
      draw: (p, rowTop) => {
        const ly = rowTop - 9;
        p.right(COL.desc - 4, ly, t.label, 9, true, true);
        if (t.rate) {
          p.right(COL.rate - 3, ly, t.rate, 9, false, true);
          p.text(COL.rate + 3, ly, '%', 9, false, true);
        }
        p.right(R - 4, ly, formatInr(t.amount), 9, true);
      },
    });
  }

  // The footer, laid out from the box's bottom up.
  const words = wrapToWidth(inrWords(d.amountInWords), R - L - 8, 9, true);
  const notes = d.notes ? wrapToWidth(`Remarks: ${d.notes}`, COL.desc - L - 8, 8) : [];
  const bank = bankLines(d.firm.bank).flatMap((l) => wrapToWidth(l, R - COL.desc - 8, 8));
  const wordsH = 12 + words.length * 11 + 4;
  const leftBelow = notes.length * 9.5 + 10.5 + 16;
  const rightBelow = bank.length ? 11 + bank.length * 9.5 + 4 : 0;
  const sectionH = wordsH + Math.max(leftBelow, rightBelow) + 6;
  const signTop = BOX_BOTTOM + SIGN_H;
  const totalBottom = signTop + sectionH;
  const bodyBottom = totalBottom + 18;

  let bodyTop = tableHeader(page, blocksBottom);
  y = bodyTop;
  let i = 0;
  for (;;) {
    const rest = rows.slice(i).reduce((s, r) => s + r.h, 0);
    if (y - rest >= bodyBottom) {
      for (; i < rows.length; i++) {
        rows[i]!.draw(page, y);
        y -= rows[i]!.h;
      }
      break;
    }
    const before = i;
    while (i < rows.length && y - rows[i]!.h >= RUN_ON_BOTTOM) {
      rows[i]!.draw(page, y);
      y -= rows[i]!.h;
      i++;
    }
    if (i === before && y === bodyTop && i < rows.length) {
      // A row taller than a page: print it and move on.
      rows[i]!.draw(page, y);
      i++;
    }
    columns(page, bodyTop, RUN_ON_BOTTOM - 6);
    page.right(R - 4, RUN_ON_BOTTOM - 18, 'continued ...', 8, false, true);
    page = new Page();
    pages.push(page);
    page.center(A4.w / 2, titleY, `${title} (continued)`, 11, true);
    page.right(
      R,
      titleY - 14,
      `Invoice No. ${d.invoiceNumber}   Dated ${invoiceDate(d.issueDate)}`,
      8,
    );
    bodyTop = tableHeader(page, titleY - 22);
    y = bodyTop;
  }
  columns(page, bodyTop, bodyBottom);

  // Total.
  columns(page, bodyBottom, totalBottom);
  page.right(COL.desc - 4, bodyBottom - 12, 'Total', 9);
  const total = formatInr(d.total);
  const totalW = textWidth(total, 10, true);
  page.right(R - 4, bodyBottom - 13, total, 10, true);
  page.rupee(R - 4 - totalW - 3 - RUPEE_WIDTH(10), bodyBottom - 13, 10);

  // Amount in words, remarks, PAN; bank details on the right.
  let fy = totalBottom - 10;
  page.text(L + 4, fy, 'Amount Chargeable (in words)', 8);
  page.right(R - 4, fy, 'E. & O.E', 8, false, true);
  fy -= 13;
  for (const w of words) {
    page.text(L + 4, fy, w, 9, true);
    fy -= 11;
  }
  fy -= 4;
  let by = fy;
  for (const n of notes) {
    page.text(L + 4, fy, n, 8);
    fy -= 9.5;
  }
  page.text(
    L + 4,
    signTop + 22,
    `Tax payable on reverse charge :  ${d.isReverseCharge ? 'Yes' : 'No'}`,
    8,
  );
  if (d.firm.pan) {
    page.text(L + 4, signTop + 8, "Company's PAN", 8.5);
    page.text(L + 110, signTop + 8, `:  ${d.firm.pan}`, 8.5, true);
  }
  if (bank.length) {
    page.text(COL.desc + 4, by, "Company's Bank Details", 8);
    by -= 10;
    for (const b of bank) {
      page.text(COL.desc + 4, by, b, 8);
      by -= 9.5;
    }
  }

  // Declaration and signatory.
  page.text(L + 4, signTop - 9, 'Declaration', 8);
  page.rule(L + 4, signTop - 10.5, L + 4 + textWidth('Declaration', 8), signTop - 10.5);
  let dy = signTop - 19;
  for (const l of wrapToWidth(DECLARATION, COL.desc - L - 10, 8)) {
    page.text(L + 4, dy, l, 8);
    dy -= 9;
  }
  page.rule(COL.desc, signTop, R, signTop);
  page.rule(COL.desc, signTop, COL.desc, BOX_BOTTOM);
  page.right(R - 4, signTop - 10, `for ${d.firm.name}`, 8.5, true);
  page.right(R - 4, BOX_BOTTOM + 4, 'Authorised Signatory', 8);
  for (const x of [L, R]) page.rule(x, totalBottom, x, BOX_BOTTOM);
  page.rule(L, BOX_BOTTOM, R, BOX_BOTTOM);
  page.center(A4.w / 2, BOX_BOTTOM - 14, 'This is a Computer Generated Invoice', 8);

  if (pages.length > 1) {
    pages.forEach((p, n) => p.right(R, 24, `Page ${n + 1} of ${pages.length}`, 7));
  }
  return assemble(pages, d.firm.logo ?? null);
}

/**
 * Objects: 1 catalog, 2 pages, 3–6 fonts (Helvetica, bold, oblique, bold
 * oblique), then a page and its content per page, then the image (if any)
 * as /Im1 on every page.
 */
export function assemble(pages: Page[], image: PdfImage | null = null): Buffer {
  const objects: string[] = [];
  const first = 7;
  const pageIds = pages.map((_, i) => first + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'].forEach(
    (font, i) => {
      objects[3 + i] =
        `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`;
    },
  );
  const imageId = image ? first + pages.length * 2 : null;
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
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >>${xobject} >> /Contents ${pageId + 1} 0 R >>`;
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
