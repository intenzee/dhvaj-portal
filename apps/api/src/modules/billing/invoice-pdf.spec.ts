import { gstSplit } from '@hsdg/contracts';
import {
  FONT_METRICS,
  bankLines,
  firmBlockLines,
  invoiceDate,
  lineHeading,
  renderInvoicePdf,
  taxRows,
  textWidth,
  wrapToWidth,
  type InvoicePdfData,
} from './invoice-pdf';

export const sampleInvoice = (over: Partial<InvoicePdfData> = {}): InvoicePdfData => {
  const lines = [
    {
      description: 'Statutory audit for FY 2025-26 (Companies Act, 2013) including CARO reporting',
      sacCode: '998221',
      quantity: '1.00',
      unitAmount: '100000.00',
      gstRate: '18.00',
      taxableValue: '100000.00',
    },
    {
      description: 'GST returns — April to September (₹ out-of-pocket)',
      sacCode: '998231',
      quantity: '6.00',
      unitAmount: '2500.00',
      gstRate: '18.00',
      taxableValue: '15000.00',
    },
  ];
  const split = gstSplit(lines, '07', '07');
  return {
    firm: {
      name: 'DHVAJ & Associates',
      address: '16/7, LGF,\nKalkaji,\nNew Delhi',
      gstin: '07AAAFD1234K1Z5',
      stateCode: '07',
      pan: 'AAAFD1234K',
      email: 'executive@dhvaj.in',
    },
    client: {
      name: 'Bharat Traders (P) Ltd',
      pan: 'AAACB1234C',
      gstin: '07AAACB1234C1Z5',
      address: 'B-12, Connaught Place, New Delhi 110001',
    },
    invoiceNumber: '202627/10/01',
    issueDate: '2026-10-16',
    dueDate: '2026-10-31',
    placeOfSupplyState: '07',
    isReverseCharge: false,
    lines,
    split,
    taxAmount: split.tax,
    total: split.total,
    amountInWords: 'Rupees One Lakh Thirty-Five Thousand Seven Hundred Only',
    notes: 'Bank: HDFC Bank, A/c 0000 (sample)',
    ...over,
  };
};

describe('renderInvoicePdf', () => {
  it('writes a well-formed PDF whose cross-reference points at each object', () => {
    const pdf = renderInvoicePdf(sampleInvoice()).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(TAX INVOICE)');
    expect(pdf).toContain('(202627/10/01)');
    expect(pdf).toContain('(16-Oct-26)');
    expect(pdf).toContain('(Due by 31-Oct-26)');
    expect(pdf).toContain('(Consignee \\(Ship to\\))');
    expect(pdf).toContain('(Buyer \\(Bill to\\))');
    expect(pdf).toContain('(B-12, Connaught Place, New Delhi 110001)');
    expect(pdf).toContain('(Professional Charges)');
    expect(pdf).toContain('(CGST)');
    expect(pdf).toContain('(SGST)');
    expect(pdf).toContain('(INR One Lakh Thirty-Five Thousand Seven Hundred Only)');
    expect(pdf).toContain('(:  AAAFD1234K)');
    expect(pdf).toContain('(for DHVAJ & Associates)');
    expect(pdf).toContain('(This is a Computer Generated Invoice)');
    // WinAnsi only: brackets are escaped, the rupee sign in text is spelt out,
    // and the total's rupee sign is drawn.
    expect(pdf).toContain('pocket\\)');
    expect(pdf).toMatch(/\(Rs\./);
    expect(pdf).toMatch(/ c [\d.]+ [\d.]+ l S /);
    expect(pdf).toContain('/BaseFont /Helvetica-BoldOblique');
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    offsets.forEach((o, i) => expect(pdf.slice(o, o + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });

  it('shows IGST inter-state and runs long invoices onto more pages', () => {
    const base = sampleInvoice();
    const lines = Array.from({ length: 80 }, () => base.lines[0]!);
    const pdf = renderInvoicePdf(
      sampleInvoice({ lines, split: gstSplit(lines, '07', '27'), placeOfSupplyState: '27' }),
    ).toString('latin1');
    expect(pdf).toContain('(IGST)');
    expect(pdf).toContain('(18)');
    expect(pdf).not.toContain('CGST');
    expect(pdf).toContain('(TAX INVOICE \\(continued\\))');
    expect(pdf).toContain('(continued ...)');
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
  });

  it('a bill with no GST is an INVOICE with no tax rows', () => {
    const lines = [
      {
        description: 'DSC Charges — Fees for DSC Charges',
        sacCode: null,
        quantity: '1.00',
        unitAmount: '2200.00',
        gstRate: '0.00',
        taxableValue: '2200.00',
      },
    ];
    const split = gstSplit(lines, '07', '04');
    const pdf = renderInvoicePdf(
      sampleInvoice({
        lines,
        split,
        taxAmount: split.tax,
        total: split.total,
        client: { name: 'MSPSLSA', pan: null, gstin: null, address: null },
        placeOfSupplyState: '04',
      }),
    ).toString('latin1');
    expect(pdf).toContain('(INVOICE)');
    expect(pdf).not.toContain('TAX INVOICE');
    expect(pdf).toContain('(DSC Charges)');
    expect(pdf).toContain('(Fees for DSC Charges)');
    expect(pdf).toContain('(:  Chandigarh, Code : 04)');
    expect(pdf).not.toContain('GST)');
  });
});

describe('the invoice layout helpers', () => {
  it('dates the invoice as 1-Nov-26', () => {
    expect(invoiceDate('2026-11-01')).toBe('1-Nov-26');
    expect(invoiceDate('2027-03-31')).toBe('31-Mar-27');
    expect(invoiceDate(null)).toBe('');
  });

  it('prints taxable work as Professional Charges, anything else under its own name', () => {
    expect(lineHeading({ description: 'Audit Fees for F.Y 25-26', gstRate: '18.00' })).toEqual({
      heading: 'Professional Charges',
      detail: 'Audit Fees for F.Y 25-26',
    });
    expect(lineHeading({ description: 'Professional charges', gstRate: '18' })).toEqual({
      heading: 'Professional Charges',
      detail: null,
    });
    expect(lineHeading({ description: 'DSC Charges — Fees for DSC', gstRate: '0' })).toEqual({
      heading: 'DSC Charges',
      detail: 'Fees for DSC',
    });
    expect(lineHeading({ description: 'ROC fees', gstRate: '0.00' })).toEqual({
      heading: 'ROC fees',
      detail: null,
    });
  });

  it('splits the tax by rate: CGST and SGST at half, or IGST; none on reverse charge', () => {
    const lines = [
      { taxableValue: '1000.00', gstRate: '18.00' },
      { taxableValue: '1000.00', gstRate: '5.00' },
    ];
    const intra = gstSplit(lines, '07', '07');
    expect(taxRows({ split: intra, taxAmount: intra.tax, isReverseCharge: false })).toEqual([
      { label: 'CGST', rate: '9', amount: '90.00' },
      { label: 'SGST', rate: '9', amount: '90.00' },
      { label: 'CGST', rate: '2.5', amount: '25.00' },
      { label: 'SGST', rate: '2.5', amount: '25.00' },
    ]);
    const inter = gstSplit(lines.slice(0, 1), '07', '20');
    expect(taxRows({ split: inter, taxAmount: inter.tax, isReverseCharge: false })).toEqual([
      { label: 'IGST', rate: '18', amount: '180.00' },
    ]);
    expect(taxRows({ split: inter, taxAmount: inter.tax, isReverseCharge: true })).toEqual([]);
  });

  it('the firm block and the bank details, as the invoice prints them', () => {
    expect(
      firmBlockLines({
        name: 'DHVAJ & Associates',
        address: '16/7, LGF,\nKalkaji,\nNew Delhi',
        gstin: '07AASFH6602D1ZF',
        stateCode: '07',
        email: 'executive@dhvaj.in',
      }),
    ).toEqual([
      '16/7, LGF,',
      'Kalkaji,',
      'New Delhi',
      'GSTIN/UIN: 07AASFH6602D1ZF',
      'State Name :  Delhi, Code : 07',
      'E-Mail : executive@dhvaj.in',
    ]);
    expect(
      bankLines({
        accountName: 'DHVAJ & Associates',
        bankName: 'HDFC Bank',
        accountNumber: '50200012345678',
        ifsc: 'HDFC0001234',
        branch: 'Kalkaji',
        upiId: null,
      }),
    ).toEqual([
      "A/c Holder's Name : DHVAJ & Associates",
      'Bank Name : HDFC Bank',
      'A/c No. : 50200012345678',
      'Branch & IFS Code : Kalkaji & HDFC0001234',
    ]);
    expect(bankLines(null)).toEqual([]);
  });

  it('measures and wraps text by its width in points', () => {
    expect(FONT_METRICS.regular).toHaveLength(95);
    expect(FONT_METRICS.bold).toHaveLength(95);
    expect(textWidth('0', 10)).toBeCloseTo(5.56);
    expect(textWidth('W', 10, true)).toBeCloseTo(9.44);
    expect(textWidth('il', 10)).toBeLessThan(textWidth('mm', 10));
    const lines = wrapToWidth('HOUSE NO-21, BC BLOCK, SHALIMAR BAGH WEST, DELHI 110088', 120, 8);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((l) => expect(textWidth(l, 8)).toBeLessThanOrEqual(120));
    expect(wrapToWidth('', 100, 8)).toEqual([]);
    expect(wrapToWidth('x'.repeat(60), 50, 8).join('')).toBe('x'.repeat(60));
  });
});
