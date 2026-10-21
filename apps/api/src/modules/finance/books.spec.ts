import { DEFAULT_BOOKS_LEDGERS } from '@hsdg/contracts';
import {
  balanced,
  buildVouchers,
  journalCsv,
  outputTax,
  tallyXml,
  voucherKey,
  type BooksInput,
  type BooksInvoiceRow,
  type BooksReceiptRow,
} from './books';

const invoice = (over: Partial<BooksInvoiceRow> = {}): BooksInvoiceRow => ({
  id: 'inv-1',
  number: 'INV/26-27/0001',
  date: '2026-10-05',
  clientName: 'Lake View Traders',
  subtotal: '10000.00',
  cgst: '900.00',
  sgst: '900.00',
  igst: '0.00',
  total: '11800.00',
  voidedOn: null,
  ...over,
});

const receipt = (over: Partial<BooksReceiptRow> = {}): BooksReceiptRow => ({
  id: '0a1b2c3d-0000-4000-8000-000000000001',
  date: '2026-10-20',
  clientName: 'Lake View Traders',
  mode: 'bank',
  reference: 'NEFT N123',
  gross: '11800.00',
  tds: '1000.00',
  tdsSection: '194J',
  net: '10800.00',
  against: 'INV/26-27/0001',
  reversedOn: null,
  ...over,
});

const input = (over: Partial<BooksInput> = {}): BooksInput => ({
  month: '2026-10',
  ledgers: DEFAULT_BOOKS_LEDGERS,
  invoices: [],
  receipts: [],
  creditNotes: [],
  writeOffs: [],
  exported: new Map(),
  ...over,
});

describe('books export', () => {
  it('posts a sale: client debited, fees and output tax credited', () => {
    const [v] = buildVouchers(input({ invoices: [invoice()] }));
    expect(v).toMatchObject({
      source: 'invoice',
      type: 'Sales',
      number: 'INV/26-27/0001',
      exportedAt: null,
    });
    expect(v!.entries).toEqual([
      { ledger: 'Lake View Traders', debit: '11800.00', credit: '0.00' },
      { ledger: 'Professional Fees', debit: '0.00', credit: '10000.00' },
      { ledger: 'Output CGST', debit: '0.00', credit: '900.00' },
      { ledger: 'Output SGST', debit: '0.00', credit: '900.00' },
    ]);
    expect(balanced(v!)).toBe(true);
  });

  it('posts the tax an invoice charged, split or not', () => {
    const [v] = buildVouchers(
      input({
        invoices: [
          invoice({ subtotal: '13000.00', cgst: '0.00', sgst: '0.00', total: '13180.01' }),
        ],
      }),
    );
    expect(v!.entries.slice(2)).toEqual([
      { ledger: 'Output CGST', debit: '0.00', credit: '90.01' },
      { ledger: 'Output SGST', debit: '0.00', credit: '90.00' },
    ]);
    expect(v!.narration).toMatch(/not split/);
    expect(balanced(v!)).toBe(true);
    // Reverse charge: the client pays the tax; nothing to post.
    expect(
      outputTax({
        subtotal: '1000.00',
        cgst: '90.00',
        sgst: '90.00',
        igst: '0.00',
        total: '1000.00',
      }),
    ).toEqual({
      cgst: '0.00',
      sgst: '0.00',
      igst: '0.00',
      unsplit: false,
    });
  });

  it('posts a receipt with the TDS the client deducted', () => {
    const [v] = buildVouchers(input({ receipts: [receipt()] }));
    expect(v).toMatchObject({ type: 'Receipt', number: 'RCPT/0A1B2C3D' });
    expect(v!.entries).toEqual([
      { ledger: 'Bank', debit: '10800.00', credit: '0.00' },
      { ledger: 'TDS Receivable', debit: '1000.00', credit: '0.00' },
      { ledger: 'Lake View Traders', debit: '0.00', credit: '11800.00' },
    ]);
    expect(v!.narration).toBe(
      'Received bank NEFT N123 against INV/26-27/0001; TDS 1000.00 u/s 194J',
    );
  });

  it('leaves out what was issued and voided in the month before any export', () => {
    expect(buildVouchers(input({ invoices: [invoice({ voidedOn: '2026-10-09' })] }))).toEqual([]);
    expect(buildVouchers(input({ receipts: [receipt({ reversedOn: '2026-10-25' })] }))).toEqual([]);
  });

  it('reverses a void once the sale reached the books', () => {
    const exported = new Map([[voucherKey('invoice', 'inv-1'), '2026-10-07T10:00:00Z']]);
    const vs = buildVouchers(input({ invoices: [invoice({ voidedOn: '2026-10-09' })], exported }));
    expect(vs.map((v) => [v.source, v.exportedAt])).toEqual([
      ['invoice', '2026-10-07T10:00:00Z'],
      ['invoice_void', null],
    ]);
    expect(vs[1]!.entries[0]).toEqual({
      ledger: 'Lake View Traders',
      debit: '0.00',
      credit: '11800.00',
    });
    // Issued last month, voided this month: only the reversal.
    const late = buildVouchers(
      input({ invoices: [invoice({ date: '2026-09-28', voidedOn: '2026-10-02' })] }),
    );
    expect(late.map((v) => [v.source, v.date])).toEqual([['invoice_void', '2026-10-02']]);
  });

  it('posts credit notes and write-offs', () => {
    const vs = buildVouchers(
      input({
        creditNotes: [
          {
            id: 'cn-1',
            number: 'CN/26-27/0001',
            date: '2026-10-21',
            clientName: 'Lake View Traders',
            invoiceNumber: 'INV/26-27/0001',
            taxable: '1000.00',
            cgst: '0.00',
            sgst: '0.00',
            igst: '180.00',
            total: '1180.00',
            voidedOn: null,
          },
        ],
        writeOffs: [
          {
            id: 'wo-00000001',
            date: '2026-10-30',
            clientName: 'Lake View Traders',
            invoiceNumber: 'INV/26-27/0001',
            amount: '200.00',
          },
        ],
      }),
    );
    expect(vs.map((v) => v.type)).toEqual(['Credit Note', 'Journal']);
    expect(vs[0]!.entries.map((e) => e.ledger)).toEqual([
      'Professional Fees',
      'Output IGST',
      'Lake View Traders',
    ]);
    expect(vs[1]!.entries).toEqual([
      { ledger: 'Bad Debts Written Off', debit: '200.00', credit: '0.00' },
      { ledger: 'Lake View Traders', debit: '0.00', credit: '200.00' },
    ]);
  });

  it('writes a journal CSV and Tally XML', () => {
    const vs = buildVouchers(input({ invoices: [invoice({ clientName: 'Sen & Co, "Kolkata"' })] }));
    const csv = journalCsv(vs);
    expect(csv.split('\r\n')[0]).toBe('Date,Voucher Type,Voucher No,Ledger,Debit,Credit,Narration');
    expect(csv).toContain(
      '05-10-2026,Sales,INV/26-27/0001,"Sen & Co, ""Kolkata""",11800.00,0.00,Invoice INV/26-27/0001',
    );
    const x = tallyXml(vs);
    expect(x).toContain('<DATE>20261005</DATE>');
    expect(x).toContain('<PARTYLEDGERNAME>Sen &amp; Co, &quot;Kolkata&quot;</PARTYLEDGERNAME>');
    expect(x).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-11800.00</AMOUNT>');
    expect(x).toContain(
      '<LEDGERNAME>Professional Fees</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>10000.00</AMOUNT>',
    );
  });
});
