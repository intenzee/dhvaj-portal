import { creditNoteVoidBlock } from '@hsdg/contracts';
import { renderCreditNotePdf, type CreditNotePdfData } from './credit-note-pdf';

const sample = (over: Partial<CreditNotePdfData> = {}): CreditNotePdfData => ({
  firm: {
    name: 'DHVAJ & Associates',
    address: 'B-12, Connaught Place\nNew Delhi 110001',
    gstin: '07AAAFD1234K1Z5',
    stateCode: '07',
  },
  client: {
    name: 'Bharat Traders (P) Ltd',
    gstin: '07AAACB1234C1Z5',
    pan: 'AAACB1234C',
    address: '4 Chandni Chowk, Delhi 110006',
    stateCode: '07',
  },
  creditNoteNumber: 'CN/26-27/0001',
  creditDate: '2026-10-17',
  invoiceNumber: 'INV/26-27/0004',
  invoiceDate: '2026-10-01',
  placeOfSupplyState: '07',
  isReverseCharge: false,
  reason: 'Fee agreed lower (engagement letter of 1 Oct)',
  intraState: true,
  lines: [
    {
      description: 'Statutory audit for FY 2025-26',
      sacCode: '998221',
      taxableValue: '10000.00',
      gstRate: '18.00',
      cgst: '900.00',
      sgst: '900.00',
      igst: '0.00',
      total: '11800.00',
    },
  ],
  taxableValue: '10000.00',
  cgst: '900.00',
  sgst: '900.00',
  igst: '0.00',
  total: '11800.00',
  amountInWords: 'Rupees Eleven Thousand Eight Hundred Only',
  voided: null,
  ...over,
});

describe('renderCreditNotePdf (PS-205, CGST rule 53)', () => {
  it('writes a well-formed PDF with what rule 53 asks for', () => {
    const pdf = renderCreditNotePdf(sample()).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(CREDIT NOTE)');
    expect(pdf).toContain('(Credit Note No. CN/26-27/0001)');
    expect(pdf).toContain('(Date: 17-10-2026)');
    expect(pdf).toContain('(Against Tax Invoice No. INV/26-27/0004 dated 01-10-2026)');
    expect(pdf).toContain('07AAAFD1234K1Z5');
    expect(pdf).toContain('(GSTIN: 07AAACB1234C1Z5)');
    expect(pdf).toMatch(/\(Place of supply: [A-Za-z ]+ \\\(07\\\)\)/);
    expect(pdf).toContain('Fee agreed lower');
    expect(pdf).toContain('(CGST)');
    expect(pdf).toContain('(SGST)');
    expect(pdf).toContain('(Rupees Eleven Thousand Eight Hundred Only)');
    expect(pdf).toContain('(Authorised signatory)');
    expect(pdf).not.toContain('VOID');
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('shows IGST alone across states, and prints a void so a copy cannot pass for live', () => {
    const pdf = renderCreditNotePdf(
      sample({
        intraState: false,
        placeOfSupplyState: '27',
        cgst: '0.00',
        sgst: '0.00',
        igst: '1800.00',
        lines: [{ ...sample().lines[0]!, cgst: '0.00', sgst: '0.00', igst: '1800.00' }],
        voided: { on: '2026-10-20', reason: 'Raised against the wrong invoice' },
      }),
    ).toString('latin1');
    expect(pdf).toContain('(IGST)');
    expect(pdf).not.toContain('(CGST)');
    expect(pdf).toContain('(VOID - cancelled on 20-10-2026)');
    expect(pdf).toContain('Raised against the wrong invoice');
  });

  it('runs on to further pages for many lines, numbering them', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...sample().lines[0]!,
      description: `Line ${i + 1} of the invoice credited in part`,
    }));
    const pdf = renderCreditNotePdf(sample({ lines: many })).toString('latin1');
    expect(pdf).toMatch(/\(Page 1 of [2-9]\)/);
  });
});

describe('creditNoteVoidBlock (PS-205)', () => {
  const note = { creditDate: '2026-09-15', number: 'CN/26-27/0002' };
  it('lets a note be voided while its GST period is open', () => {
    expect(creditNoteVoidBlock(note, null)).toBeNull();
    expect(creditNoteVoidBlock(note, '2026-08-31')).toBeNull();
  });
  it('refuses once the GSTR-1 covering its date is filed, saying what to do instead', () => {
    expect(creditNoteVoidBlock(note, '2026-09-30')).toMatch(
      /^Credit note CN\/26-27\/0002 is dated 15-09-2026 and the GST return through 30-09-2026 is filed.*debit note or amend/,
    );
  });
});
