import {
  buildGstRegister,
  monthEnd,
  normRate,
  seriesOf,
  type RegisterCreditNote,
  type RegisterInput,
  type RegisterInvoice,
} from './gst-register';

// West Bengal firm; made-up GSTINs.
const FIRM = '19AAAFZ9999Q1Z5';
const B2B_GSTIN = '19AABCL1234M1Z2';
const OTHER_STATE_GSTIN = '27AABCM5678N1Z9';

let n = 0;
const inv = (over: Partial<RegisterInvoice> = {}): RegisterInvoice => {
  n += 1;
  return {
    id: `i${n}`,
    number: `INV/26-27/${String(n).padStart(4, '0')}`,
    issueDate: '2026-10-05',
    status: 'issued',
    voidedOn: null,
    clientGstin: B2B_GSTIN,
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
  };
};

const cn = (over: Partial<RegisterCreditNote> = {}): RegisterCreditNote => ({
  id: 'c1',
  number: 'CN/26-27/0001',
  date: '2026-10-20',
  status: 'approved',
  voidedOn: null,
  invoiceNumber: 'INV/26-27/0001',
  invoiceDate: '2026-09-10',
  invoiceTotal: '11800.00',
  clientGstin: B2B_GSTIN,
  clientName: 'Lake View Traders',
  placeOfSupply: '19',
  reverseCharge: false,
  rate: '18.00',
  taxable: '1000.00',
  cgst: '90.00',
  sgst: '90.00',
  igst: '0.00',
  total: '1180.00',
  sac: '998222',
  lines: [],
  ...over,
});

const input = (over: Partial<RegisterInput> = {}): RegisterInput => ({
  month: '2026-10',
  firmGstin: FIRM,
  firmState: '19',
  filedThrough: '2026-09-30',
  sacDefault: '998222',
  invoices: [],
  creditNotes: [],
  voidedFromEarlier: [],
  ...over,
});

beforeEach(() => {
  n = 0;
});

describe('GST outward register (GSTR-1)', () => {
  it('helpers: month end, rate, series', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-10')).toBe('2026-10-31');
    expect(normRate('18.00')).toBe('18');
    expect(normRate('2.50')).toBe('2.5');
    expect(normRate('0')).toBe('0');
    expect(seriesOf('INV/26-27/0012')).toEqual({ series: 'INV/26-27/', seq: 12 });
  });

  it('puts a registered client in B2B by rate, and ties to the invoice', () => {
    const r = buildGstRegister(
      input({
        invoices: [
          inv({
            subtotal: '15000.00',
            cgst: '1200.00',
            sgst: '1200.00',
            total: '17400.00',
            lines: [
              { sac: '998222', rate: '18', taxable: '10000.00' },
              { sac: '998222', rate: '12', taxable: '5000.00' },
            ],
          }),
        ],
      }),
    );
    expect(r.b2b).toHaveLength(1);
    expect(r.b2b[0]!.items).toEqual([
      {
        rate: '18',
        taxable: '10000.00',
        igst: '0.00',
        cgst: '900.00',
        sgst: '900.00',
        cess: '0.00',
      },
      {
        rate: '12',
        taxable: '5000.00',
        igst: '0.00',
        cgst: '300.00',
        sgst: '300.00',
        cess: '0.00',
      },
    ]);
    expect(r.tieOut.ok).toBe(true);
    expect(r.tieOut.invoices.register.total).toBe('17400.00');
    expect(r.warnings).toEqual([]);
    expect(r.filed).toBe(false);
  });

  it('sends an inter-state unregistered invoice above ₹1 lakh to B2CL, the rest to B2CS by state and rate', () => {
    const big = inv({
      clientGstin: null,
      placeOfSupply: '27',
      subtotal: '100000.00',
      cgst: '0.00',
      sgst: '0.00',
      igst: '18000.00',
      total: '118000.00',
      lines: [{ sac: '998222', rate: '18', taxable: '100000.00' }],
    });
    const small = inv({
      clientGstin: null,
      placeOfSupply: '27',
      subtotal: '50000.00',
      cgst: '0.00',
      sgst: '0.00',
      igst: '9000.00',
      total: '59000.00',
      lines: [{ sac: '998222', rate: '18', taxable: '50000.00' }],
    });
    const local = inv({ clientGstin: null });
    const local2 = inv({ clientGstin: null });
    const r = buildGstRegister(input({ invoices: [big, small, local, local2] }));
    expect(r.b2cl.map((x) => x.invoiceNumber)).toEqual([big.number]);
    expect(r.b2cs).toEqual([
      {
        supplyType: 'INTRA',
        placeOfSupply: '19',
        rate: '18',
        taxable: '20000.00',
        igst: '0.00',
        cgst: '1800.00',
        sgst: '1800.00',
        cess: '0.00',
      },
      {
        supplyType: 'INTER',
        placeOfSupply: '27',
        rate: '18',
        taxable: '50000.00',
        igst: '9000.00',
        cgst: '0.00',
        sgst: '0.00',
        cess: '0.00',
      },
    ]);
    // An intra-state unregistered invoice stays B2CS whatever its value.
    expect(r.b2b).toEqual([]);
  });

  it('keeps an inter-state registered client in B2B, with IGST', () => {
    const r = buildGstRegister(
      input({
        invoices: [
          inv({
            clientGstin: OTHER_STATE_GSTIN,
            placeOfSupply: '27',
            cgst: '0.00',
            sgst: '0.00',
            igst: '1800.00',
          }),
        ],
      }),
    );
    expect(r.b2b[0]!.items[0]).toMatchObject({ igst: '1800.00', cgst: '0.00' });
    expect(r.b2cl).toEqual([]);
    expect(r.tieOut.ok).toBe(true);
  });

  it('files credit notes: CDNR for registered, CDNUR against a B2CL invoice, else netted into B2CS', () => {
    const local = inv({ clientGstin: null });
    const r = buildGstRegister(
      input({
        invoices: [local],
        creditNotes: [
          cn(),
          cn({
            id: 'c2',
            number: 'CN/26-27/0002',
            clientGstin: null,
            placeOfSupply: '27',
            invoiceTotal: '118000.00',
            cgst: '0.00',
            sgst: '0.00',
            igst: '180.00',
          }),
          cn({ id: 'c3', number: 'CN/26-27/0003', clientGstin: null }),
        ],
      }),
    );
    expect(r.cdnr.map((x) => x.noteNumber)).toEqual(['CN/26-27/0001']);
    expect(r.cdnur.map((x) => x.noteNumber)).toEqual(['CN/26-27/0002']);
    expect(r.b2cs).toEqual([
      expect.objectContaining({
        placeOfSupply: '19',
        taxable: '9000.00',
        cgst: '810.00',
        sgst: '810.00',
      }),
    ]);
    expect(r.tieOut.creditNotes.register.taxable).toBe('3000.00');
  });

  it('files a credit note by its lines, each at its own rate and SAC', () => {
    const local = inv({
      clientGstin: null,
      subtotal: '15000.00',
      cgst: '1200.00',
      sgst: '1200.00',
      total: '17400.00',
      lines: [
        { sac: '998222', rate: '18', taxable: '10000.00' },
        { sac: '998231', rate: '12', taxable: '5000.00' },
      ],
    });
    const mixed = {
      rate: null,
      taxable: '1500.00',
      cgst: '120.00',
      sgst: '120.00',
      total: '1740.00',
      lines: [
        {
          sac: '998222',
          rate: '18.00',
          taxable: '1000.00',
          igst: '0.00',
          cgst: '90.00',
          sgst: '90.00',
        },
        {
          sac: '998231',
          rate: '12.00',
          taxable: '500.00',
          igst: '0.00',
          cgst: '30.00',
          sgst: '30.00',
        },
      ],
    };
    const r = buildGstRegister(
      input({
        invoices: [local],
        creditNotes: [
          cn({ ...mixed }),
          cn({ ...mixed, id: 'c2', number: 'CN/26-27/0002', clientGstin: null }),
        ],
      }),
    );
    expect(r.cdnr[0]!.items.map((i) => [i.rate, i.taxable, i.cgst])).toEqual([
      ['12', '500.00', '30.00'],
      ['18', '1000.00', '90.00'],
    ]);
    expect(r.b2cs.map((x) => [x.rate, x.taxable])).toEqual([
      ['18', '9000.00'],
      ['12', '4500.00'],
    ]);
    expect(r.hsnB2c.map((h) => [h.sac, h.rate, h.taxable])).toEqual([
      ['998222', '18', '9000.00'],
      ['998231', '12', '4500.00'],
    ]);
    expect(r.hsnB2b.map((h) => [h.sac, h.rate, h.taxable])).toEqual([
      ['998222', '18', '-1000.00'],
      ['998231', '12', '-500.00'],
    ]);
    expect(r.tieOut.ok).toBe(true);
    expect(r.warnings.filter((w) => w.code === 'tax_differs_from_lines')).toEqual([]);
  });

  it('nets the SAC summary by tab and shares a rate across SACs to the paisa', () => {
    const r = buildGstRegister(
      input({
        invoices: [
          inv({
            subtotal: '100.01',
            cgst: '9.00',
            sgst: '9.00',
            total: '118.01',
            lines: [
              { sac: '998221', rate: '18', taxable: '33.34' },
              { sac: '998222', rate: '18', taxable: '66.67' },
            ],
          }),
        ],
        creditNotes: [cn({ taxable: '10.00', cgst: '0.90', sgst: '0.90', total: '11.80' })],
      }),
    );
    const sum = r.hsnB2b.reduce((a, h) => a + Math.round(Number(h.cgst) * 100), 0);
    expect(sum).toBe(900 - 90);
    expect(r.hsnB2b.map((h) => [h.sac, h.taxable])).toEqual([
      ['998221', '33.34'],
      ['998222', '56.67'],
    ]);
    expect(r.hsnB2b[0]).toMatchObject({ uqc: 'NA', quantity: '0' });
    expect(r.hsnB2c).toEqual([]);
  });

  it('counts documents by series, cancelled ones included, and flags a gap', () => {
    const a = inv();
    const b = inv({ status: 'void', voidedOn: '2026-10-12' });
    n += 1; // number 3 is dated in another month
    const c = inv();
    const r = buildGstRegister(input({ invoices: [a, b, c] }));
    expect(r.docs).toEqual([
      {
        nature: 'invoices',
        series: 'INV/26-27/',
        from: a.number,
        to: c.number,
        total: 3,
        cancelled: 1,
        netIssued: 2,
      },
    ]);
    expect(r.b2b.map((x) => x.invoiceNumber)).toEqual([a.number, c.number]);
    expect(r.warnings.map((w) => w.code)).toEqual(['number_gap']);
  });

  it('keeps an invoice voided after the month, and warns in the month it was voided', () => {
    const late = inv({ status: 'void', voidedOn: '2026-11-03' });
    const r = buildGstRegister(
      input({
        invoices: [late],
        voidedFromEarlier: [
          { id: 'old', number: 'INV/26-27/0099', issueDate: '2026-08-01', voidedOn: '2026-10-02' },
        ],
      }),
    );
    expect(r.b2b).toHaveLength(1);
    expect(r.docs[0]).toMatchObject({ cancelled: 0, netIssued: 1 });
    expect(r.warnings.map((w) => w.code)).toEqual([
      'voided_after_month',
      'voided_from_earlier_month',
    ]);
  });

  it('says where an invoice tax differs from its lines, and a missing place of supply', () => {
    const r = buildGstRegister(
      input({
        firmGstin: null,
        invoices: [inv({ placeOfSupply: null, cgst: '0.00', sgst: '0.00', total: '10000.00' })],
      }),
    );
    expect(r.warnings.map((w) => w.code)).toEqual([
      'no_firm_gstin',
      'no_place_of_supply',
      'tax_differs_from_lines',
    ]);
    expect(r.tieOut.ok).toBe(false);
    expect(r.b2b[0]!.placeOfSupply).toBe('19');
  });

  it('knows a filed month', () => {
    expect(buildGstRegister(input({ filedThrough: '2026-10-31' })).filed).toBe(true);
    expect(buildGstRegister(input({ filedThrough: null })).filed).toBe(false);
  });
});
