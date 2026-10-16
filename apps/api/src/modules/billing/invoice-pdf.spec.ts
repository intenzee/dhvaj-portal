import { gstSplit } from '@hsdg/contracts';
import { renderInvoicePdf, type InvoicePdfData } from './invoice-pdf';

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
      address: 'B-12, Connaught Place\nNew Delhi 110001',
      gstin: '07AAAFD1234K1Z5',
      stateCode: '07',
    },
    client: { name: 'Bharat Traders (P) Ltd', pan: 'AAACB1234C', gstin: '07AAACB1234C1Z5' },
    invoiceNumber: 'INV/26-27/0001',
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
    expect(pdf).toContain('(Invoice No. INV/26-27/0001)');
    expect(pdf).toContain('(CGST @ 9%)');
    // WinAnsi only: the rupee sign is spelt out, brackets are escaped.
    expect(pdf).toMatch(/\(Rs\./);
    expect(pdf).toContain('pocket\\)');
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
    expect(pdf).toContain('(IGST @ 18%)');
    expect(pdf).not.toContain('CGST');
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
  });
});
