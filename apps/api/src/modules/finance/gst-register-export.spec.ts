import * as XLSX from 'xlsx';
import { buildGstRegister, type RegisterInvoice } from './gst-register';
import {
  gstnDate,
  gstr1Json,
  gstr1Workbook,
  posLabel,
  returnPeriod,
  sheetDate,
} from './gst-register-export';

const invoice = (over: Partial<RegisterInvoice>): RegisterInvoice => ({
  id: 'i1',
  number: 'INV/26-27/0001',
  issueDate: '2026-10-05',
  status: 'issued',
  voidedOn: null,
  clientGstin: '19AABCL1234M1Z2',
  clientName: 'Lake View Traders',
  placeOfSupply: '19',
  reverseCharge: false,
  subtotal: '10000.00',
  cgst: '900.00',
  sgst: '900.00',
  igst: '0.00',
  total: '11800.00',
  lines: [{ sac: '998222', rate: '18', taxable: '10000.00' }],
  ...over,
});

const register = buildGstRegister({
  month: '2026-10',
  firmGstin: '19AAAFZ9999Q1Z5',
  firmState: '19',
  filedThrough: null,
  sacDefault: '998222',
  invoices: [
    invoice({}),
    invoice({
      id: 'i2',
      number: 'INV/26-27/0002',
      clientGstin: '27AABCM5678N1Z9',
      clientName: 'Marine Drive Exports',
      placeOfSupply: '27',
      cgst: '0.00',
      sgst: '0.00',
      igst: '1800.00',
    }),
    invoice({ id: 'i3', number: 'INV/26-27/0003', clientGstin: null, clientName: 'R. Sen' }),
  ],
  creditNotes: [],
  voidedFromEarlier: [],
});

/** The parts of the GSTN JSON these tests read. */
interface Gstr1 {
  gstin: string;
  fp: string;
  b2b: { ctin: string; inv: { itms: { itm_det: unknown }[] }[] }[];
  hsn: { hsn_b2b: unknown[]; hsn_b2c: unknown[] };
  doc_issue: { doc_det: unknown };
  [table: string]: unknown;
}

describe('GSTR-1 files', () => {
  it('formats dates, states and the period', () => {
    expect(gstnDate('2026-10-05')).toBe('05-10-2026');
    expect(sheetDate('2026-10-05')).toBe('05-Oct-2026');
    expect(posLabel('19')).toBe('19-West Bengal');
    expect(returnPeriod('2026-10')).toBe('102026');
  });

  it('writes the GSTN JSON: CGST/SGST within the state, IGST across, empty tables left out', () => {
    const j = gstr1Json(register) as unknown as Gstr1;
    expect(j.gstin).toBe('19AAAFZ9999Q1Z5');
    expect(j.fp).toBe('102026');
    expect(j.b2b).toHaveLength(2);
    const local = j.b2b.find((b) => b.ctin === '19AABCL1234M1Z2')!;
    expect(local.inv[0]).toMatchObject({
      inum: 'INV/26-27/0001',
      idt: '05-10-2026',
      val: 11800,
      pos: '19',
      rchrg: 'N',
      inv_typ: 'R',
    });
    expect(local.inv[0]!.itms[0]!.itm_det).toEqual({
      rt: 18,
      txval: 10000,
      camt: 900,
      samt: 900,
      csamt: 0,
    });
    const away = j.b2b.find((b) => b.ctin === '27AABCM5678N1Z9')!;
    expect(away.inv[0]!.itms[0]!.itm_det).toEqual({ rt: 18, txval: 10000, iamt: 1800, csamt: 0 });
    expect(j.b2cs).toEqual([
      {
        sply_ty: 'INTRA',
        pos: '19',
        typ: 'OE',
        rt: 18,
        txval: 10000,
        camt: 900,
        samt: 900,
        csamt: 0,
      },
    ]);
    expect(j.b2cl).toBeUndefined();
    expect(j.cdnr).toBeUndefined();
    expect(j.hsn.hsn_b2b[0]).toMatchObject({
      hsn_sc: '998222',
      uqc: 'NA',
      rt: 18,
      txval: 20000,
      iamt: 1800,
      camt: 900,
      samt: 900,
    });
    expect(j.hsn.hsn_b2c[0]).toMatchObject({ txval: 10000 });
    expect(j.doc_issue.doc_det).toEqual([
      {
        doc_num: 1,
        doc_typ: 'Invoices for outward supply',
        docs: [
          {
            num: 1,
            from: 'INV/26-27/0001',
            to: 'INV/26-27/0003',
            totnum: 3,
            cancel: 0,
            net_issue: 3,
          },
        ],
      },
    ]);
  });

  it('writes the workbook with the offline tool sheets', () => {
    const book = XLSX.read(gstr1Workbook(register), { type: 'buffer' });
    expect(book.SheetNames).toEqual([
      'summary',
      'b2b,sez,de',
      'b2cl',
      'b2cs',
      'cdnr',
      'cdnur',
      'hsn(b2b)',
      'hsn(b2c)',
      'docs',
    ]);
    const b2b = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['b2b,sez,de']!);
    expect(b2b[0]).toMatchObject({
      'GSTIN/UIN of Recipient': '19AABCL1234M1Z2',
      'Invoice date': '05-Oct-2026',
      'Place Of Supply': '19-West Bengal',
      'Invoice Type': 'Regular B2B',
      Rate: 18,
      'Taxable Value': 10000,
    });
  });
});
