import * as XLSX from 'xlsx';
import {
  GST_STATES,
  type GstHsnRow,
  type GstOutwardRegister,
  type GstRegisterItem,
} from '@hsdg/contracts';

/**
 * The register as files for whoever files the firm's GSTR-1: the GSTN JSON
 * (the shape the offline tool and the portal import) and an Excel workbook
 * whose sheets carry the offline tool's column headings, plus a summary with
 * the tax amounts and the tie-out. Pure.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-05' → '05-10-2026' (GSTN JSON). */
export function gstnDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** '2026-10-05' → '05-Oct-2026' (offline tool Excel). */
export function sheetDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1] ?? m}-${y}`;
}

/** '19' → '19-West Bengal'. */
export function posLabel(code: string): string {
  const name = GST_STATES[code];
  return name ? `${code}-${name}` : code;
}

const num = (s: string): number => Number(s);

/** '2026-10' → '102026'. */
export function returnPeriod(month: string): string {
  const [y, m] = month.split('-');
  return `${m}${y}`;
}

function itemDetail(i: GstRegisterItem, inter: boolean): Record<string, number> {
  return {
    rt: num(i.rate),
    txval: num(i.taxable),
    ...(inter ? { iamt: num(i.igst) } : { camt: num(i.cgst), samt: num(i.sgst) }),
    csamt: num(i.cess),
  };
}

function items(
  list: GstRegisterItem[],
  inter: boolean,
): { num: number; itm_det: Record<string, number> }[] {
  return list.map((i, idx) => ({ num: idx + 1, itm_det: itemDetail(i, inter) }));
}

const isInter = (r: GstOutwardRegister, pos: string): boolean =>
  !!r.firmState && !!pos && pos !== r.firmState;

function groupBy<T>(rows: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    m.set(k, [...(m.get(k) ?? []), row]);
  }
  return m;
}

function hsnJson(rows: GstHsnRow[]): Record<string, unknown>[] {
  return rows.map((h, idx) => ({
    num: idx + 1,
    hsn_sc: h.sac,
    desc: '',
    uqc: h.uqc,
    qty: num(h.quantity),
    rt: num(h.rate),
    txval: num(h.taxable),
    iamt: num(h.igst),
    camt: num(h.cgst),
    samt: num(h.sgst),
    csamt: num(h.cess),
  }));
}

/** The GSTR-1 JSON; empty tables are left out. */
export function gstr1Json(r: GstOutwardRegister): Record<string, unknown> {
  const out: Record<string, unknown> = { gstin: r.firmGstin ?? '', fp: returnPeriod(r.month) };
  if (r.b2b.length) {
    out.b2b = [...groupBy(r.b2b, (i) => i.clientGstin)].map(([ctin, invs]) => ({
      ctin,
      inv: invs.map((i) => ({
        inum: i.invoiceNumber,
        idt: gstnDate(i.invoiceDate),
        val: num(i.invoiceValue),
        pos: i.placeOfSupply,
        rchrg: i.reverseCharge ? 'Y' : 'N',
        inv_typ: 'R',
        itms: items(i.items, isInter(r, i.placeOfSupply)),
      })),
    }));
  }
  if (r.b2cl.length) {
    out.b2cl = [...groupBy(r.b2cl, (i) => i.placeOfSupply)].map(([pos, invs]) => ({
      pos,
      inv: invs.map((i) => ({
        inum: i.invoiceNumber,
        idt: gstnDate(i.invoiceDate),
        val: num(i.invoiceValue),
        itms: items(i.items, true),
      })),
    }));
  }
  if (r.b2cs.length) {
    out.b2cs = r.b2cs.map((b) => ({
      sply_ty: b.supplyType,
      pos: b.placeOfSupply,
      typ: 'OE',
      ...itemDetail(
        {
          rate: b.rate,
          taxable: b.taxable,
          igst: b.igst,
          cgst: b.cgst,
          sgst: b.sgst,
          cess: b.cess,
        },
        b.supplyType === 'INTER',
      ),
    }));
  }
  if (r.cdnr.length) {
    out.cdnr = [...groupBy(r.cdnr, (n) => n.clientGstin ?? '')].map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((n) => ({
        ntty: 'C',
        nt_num: n.noteNumber,
        nt_dt: gstnDate(n.noteDate),
        val: num(n.noteValue),
        pos: n.placeOfSupply,
        rchrg: n.reverseCharge ? 'Y' : 'N',
        inv_typ: 'R',
        itms: items(n.items, isInter(r, n.placeOfSupply)),
      })),
    }));
  }
  if (r.cdnur.length) {
    out.cdnur = r.cdnur.map((n) => ({
      typ: 'B2CL',
      ntty: 'C',
      nt_num: n.noteNumber,
      nt_dt: gstnDate(n.noteDate),
      val: num(n.noteValue),
      pos: n.placeOfSupply,
      itms: items(n.items, true),
    }));
  }
  if (r.hsnB2b.length || r.hsnB2c.length) {
    out.hsn = {
      ...(r.hsnB2b.length ? { hsn_b2b: hsnJson(r.hsnB2b) } : {}),
      ...(r.hsnB2c.length ? { hsn_b2c: hsnJson(r.hsnB2c) } : {}),
    };
  }
  if (r.docs.length) {
    const det = (nature: 'invoices' | 'credit_notes', docNum: number, docTyp: string) => {
      const docs = r.docs.filter((d) => d.nature === nature);
      return docs.length
        ? [
            {
              doc_num: docNum,
              doc_typ: docTyp,
              docs: docs.map((d, idx) => ({
                num: idx + 1,
                from: d.from,
                to: d.to,
                totnum: d.total,
                cancel: d.cancelled,
                net_issue: d.netIssued,
              })),
            },
          ]
        : [];
    };
    out.doc_issue = {
      doc_det: [
        ...det('invoices', 1, 'Invoices for outward supply'),
        ...det('credit_notes', 5, 'Credit Note'),
      ],
    };
  }
  return out;
}

type Row = (string | number)[];

const hsnSheet = (rows: GstHsnRow[]): Row[] => [
  [
    'HSN',
    'Description',
    'UQC',
    'Total Quantity',
    'Total Value',
    'Rate',
    'Taxable Value',
    'Integrated Tax Amount',
    'Central Tax Amount',
    'State/UT Tax Amount',
    'Cess Amount',
  ],
  ...rows.map((h) => [
    h.sac,
    '',
    'NA-NOT APPLICABLE',
    num(h.quantity),
    num(h.totalValue),
    num(h.rate),
    num(h.taxable),
    num(h.igst),
    num(h.cgst),
    num(h.sgst),
    num(h.cess),
  ]),
];

/** Sheet name → rows, in the offline tool's order. */
export function gstr1Sheets(r: GstOutwardRegister): [string, Row[]][] {
  const t = r.tieOut;
  const totalsRow = (label: string, x: typeof t.invoices.portal): Row => [
    label,
    num(x.taxable),
    num(x.igst),
    num(x.cgst),
    num(x.sgst),
    num(x.total),
  ];
  return [
    [
      'summary',
      [
        ['GSTIN', r.firmGstin ?? '(not set)'],
        ['Return period', returnPeriod(r.month)],
        ['Filed', r.filed ? 'Yes' : 'No'],
        [],
        ['Tie-out', 'Taxable', 'IGST', 'CGST', 'SGST', 'Total'],
        totalsRow('Invoices in the portal', t.invoices.portal),
        totalsRow('Invoices in this register', t.invoices.register),
        totalsRow('Credit notes in the portal', t.creditNotes.portal),
        totalsRow('Credit notes in this register', t.creditNotes.register),
        ['Ties', t.ok ? 'Yes' : 'No — see warnings'],
        [],
        ['Warnings'],
        ...r.warnings.map((w) => [w.message]),
      ],
    ],
    [
      'b2b,sez,de',
      [
        [
          'GSTIN/UIN of Recipient',
          'Receiver Name',
          'Invoice Number',
          'Invoice date',
          'Invoice Value',
          'Place Of Supply',
          'Reverse Charge',
          'Applicable % of Tax Rate',
          'Invoice Type',
          'E-Commerce GSTIN',
          'Rate',
          'Taxable Value',
          'Cess Amount',
        ],
        ...r.b2b.flatMap((i) =>
          i.items.map((it) => [
            i.clientGstin,
            i.clientName,
            i.invoiceNumber,
            sheetDate(i.invoiceDate),
            num(i.invoiceValue),
            posLabel(i.placeOfSupply),
            i.reverseCharge ? 'Y' : 'N',
            '',
            'Regular B2B',
            '',
            num(it.rate),
            num(it.taxable),
            num(it.cess),
          ]),
        ),
      ],
    ],
    [
      'b2cl',
      [
        [
          'Invoice Number',
          'Invoice date',
          'Invoice Value',
          'Place Of Supply',
          'Applicable % of Tax Rate',
          'Rate',
          'Taxable Value',
          'Cess Amount',
          'E-Commerce GSTIN',
        ],
        ...r.b2cl.flatMap((i) =>
          i.items.map((it) => [
            i.invoiceNumber,
            sheetDate(i.invoiceDate),
            num(i.invoiceValue),
            posLabel(i.placeOfSupply),
            '',
            num(it.rate),
            num(it.taxable),
            num(it.cess),
            '',
          ]),
        ),
      ],
    ],
    [
      'b2cs',
      [
        [
          'Type',
          'Place Of Supply',
          'Applicable % of Tax Rate',
          'Rate',
          'Taxable Value',
          'Cess Amount',
          'E-Commerce GSTIN',
        ],
        ...r.b2cs.map((b) => [
          'OE',
          posLabel(b.placeOfSupply),
          '',
          num(b.rate),
          num(b.taxable),
          num(b.cess),
          '',
        ]),
      ],
    ],
    [
      'cdnr',
      [
        [
          'GSTIN/UIN of Recipient',
          'Receiver Name',
          'Note Number',
          'Note Date',
          'Note Type',
          'Place Of Supply',
          'Reverse Charge',
          'Note Supply Type',
          'Note Value',
          'Applicable % of Tax Rate',
          'Rate',
          'Taxable Value',
          'Cess Amount',
        ],
        ...r.cdnr.flatMap((n) =>
          n.items.map((it) => [
            n.clientGstin ?? '',
            n.clientName,
            n.noteNumber,
            sheetDate(n.noteDate),
            'C',
            posLabel(n.placeOfSupply),
            n.reverseCharge ? 'Y' : 'N',
            'Regular B2B',
            num(n.noteValue),
            '',
            num(it.rate),
            num(it.taxable),
            num(it.cess),
          ]),
        ),
      ],
    ],
    [
      'cdnur',
      [
        [
          'UR Type',
          'Note Number',
          'Note Date',
          'Note Type',
          'Place Of Supply',
          'Note Value',
          'Applicable % of Tax Rate',
          'Rate',
          'Taxable Value',
          'Cess Amount',
        ],
        ...r.cdnur.flatMap((n) =>
          n.items.map((it) => [
            'B2CL',
            n.noteNumber,
            sheetDate(n.noteDate),
            'C',
            posLabel(n.placeOfSupply),
            num(n.noteValue),
            '',
            num(it.rate),
            num(it.taxable),
            num(it.cess),
          ]),
        ),
      ],
    ],
    ['hsn(b2b)', hsnSheet(r.hsnB2b)],
    ['hsn(b2c)', hsnSheet(r.hsnB2c)],
    [
      'docs',
      [
        ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'],
        ...r.docs.map((d) => [
          d.nature === 'invoices' ? 'Invoices for outward supply' : 'Credit Note',
          d.from,
          d.to,
          d.total,
          d.cancelled,
        ]),
      ],
    ],
  ];
}

export function gstr1Workbook(r: GstOutwardRegister): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of gstr1Sheets(r)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
