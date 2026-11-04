import * as XLSX from 'xlsx';
import { matchIncomeLines, type ItrIncomeLine } from '@hsdg/contracts';
import { StatementRefused, parseStatement } from './index';
import { amountOf, dateOf } from './statement';

/** A synthetic 26AS text export: two deductors in Part I, one in Part II, and Part VI. */
const FORM_26AS = [
  'Annual Tax Statement',
  'Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year',
  'ABCPE1234F^Active^2025-26^2026-27',
  'PART-I - Details of Tax Deducted at Source',
  'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
  '1^EXAMPLE SOFTWARE PRIVATE LIMITED^MUMX12345A^^^^^12,00,000.00^1,10,000.00^1,10,000.00',
  '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
  '^1^192^31-Mar-2026^F^31-May-2026^-^12,00,000.00^1,10,000.00^1,10,000.00',
  '2^SAMPLE BANK LIMITED^DELS54321B^^^^^45,250.00^4,525.00^4,525.00',
  '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
  '^1^194A^30-Sep-2025^F^15-Nov-2025^-^20,000.00^2,000.00^2,000.00',
  '^2^194A^31-Mar-2026^U^15-May-2026^-^25,250.00^2,525.00^2,525.00',
  'PART-II - Details of Tax Deducted at Source for 15G / 15H',
  'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
  '1^DEMO CO-OPERATIVE BANK^PNEX11111C^^^^^8,000.00^0.00^0.00',
  'PART-VI - Details of Tax Collected at Source',
  'Sr. No.^Name of Collector^TAN of Collector^^^^^Total Amount Paid / Debited(Rs.)^Total Tax Collected(Rs.)',
  '1^SOME DEALER^BLRS99999D^^^^^9,00,000.00^9,000.00',
].join('\n');

const sheet = (rows: unknown[][], type: 'xlsx' | 'csv' = 'xlsx'): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'AIS');
  return type === 'csv'
    ? Buffer.from(XLSX.utils.sheet_to_csv(wb.Sheets.AIS!))
    : (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
};

describe('statement helpers', () => {
  it('reads Indian-grouped amounts, brackets as negative, and refuses words', () => {
    expect(amountOf('1,25,000.5')).toBe('125000.50');
    expect(amountOf('Rs. 99')).toBe('99.00');
    expect(amountOf('(1,200.00)')).toBe('-1200.00');
    expect(amountOf(42.129)).toBe('42.13');
    expect(amountOf('n/a')).toBeNull();
  });
  it('reads the usual date shapes', () => {
    expect(dateOf('31-Mar-2026')).toBe('2026-03-31');
    expect(dateOf('5/4/2025')).toBe('2025-04-05');
    expect(dateOf('2025-04-15T00:00:00')).toBe('2025-04-15');
    expect(dateOf(46112)).toBe('2026-03-31');
    expect(dateOf('soon')).toBeNull();
  });
});

describe('Form 26AS text export', () => {
  const parsed = parseStatement(Buffer.from(FORM_26AS), '26as');

  it('reads each Part I transaction under its deductor, with the head from the section', () => {
    expect(parsed.format).toMatch(/26AS/);
    const salary = parsed.lines.filter((l) => l.payerTan === 'MUMX12345A');
    expect(salary).toEqual([
      expect.objectContaining({
        head: 'salary',
        section: '192',
        payerName: 'EXAMPLE SOFTWARE PRIVATE LIMITED',
        amount: '1200000.00',
        taxDeducted: '110000.00',
        transactionOn: '2026-03-31',
      }),
    ]);
    const bank = parsed.lines.filter((l) => l.payerTan === 'DELS54321B');
    expect(bank.map((l) => [l.head, l.amount, l.description])).toEqual([
      ['other_sources', '20000.00', null],
      ['other_sources', '25250.00', 'Booking status U'],
    ]);
  });

  it('reads a Part II deductor with no transactions from its totals, and leaves later Parts out', () => {
    expect(parsed.lines.find((l) => l.payerTan === 'PNEX11111C')).toEqual(
      expect.objectContaining({ head: 'unclassified', amount: '8000.00', section: null }),
    );
    expect(parsed.lines.some((l) => l.payerTan === 'BLRS99999D')).toBe(false);
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.warnings.join(' ')).toMatch(/Parts VI/);
  });

  it('is refused under another source', () => {
    expect(() => parseStatement(Buffer.from(FORM_26AS), 'ais')).toThrow(/import it as 26AS/);
  });
});

describe('CSV / Excel sheets', () => {
  const rows = [
    ['Annual Information Statement — synthetic'],
    [],
    [
      'Information Category',
      'Information Source',
      'TAN',
      'Reported Value',
      'Accepted Value',
      'TDS',
    ],
    ['Interest from savings bank', 'SAMPLE BANK LIMITED', 'DELS54321B', '3,100', '3,000', '0'],
    ['Dividend', 'LISTED CO LTD', 'bad-tan', 1500, null, 150],
    ['Sale of securities', 'DEMO BROKING LLP', null, '2,50,000.00', null, null],
    ['Note: values are as reported', null, null, null, null, null],
  ];

  it('finds the header row by name, prefers the accepted value, and reads heads from words', () => {
    const p = parseStatement(sheet(rows), 'ais');
    expect(p.format).toBe('CSV / Excel sheet');
    expect(p.lines.map((l) => [l.head, l.payerName, l.payerTan, l.amount, l.taxDeducted])).toEqual([
      ['other_sources', 'SAMPLE BANK LIMITED', 'DELS54321B', '3000.00', '0.00'],
      ['other_sources', 'LISTED CO LTD', null, '1500.00', '150.00'],
      ['capital_gains', 'DEMO BROKING LLP', null, '250000.00', '0.00'],
    ]);
    expect(p.skipped).toBe(1);
    expect(p.warnings.join(' ')).toMatch(/TAN\(s\) were not valid/);
  });

  it('reads the same sheet as CSV', () => {
    const p = parseStatement(sheet(rows, 'csv'), 'tis');
    expect(p.lines).toHaveLength(3);
  });

  it("reads the client's figures on the firm's template, head named outright", () => {
    const p = parseStatement(
      sheet([
        ['Head', 'Payer', 'Payer TAN', 'Section', 'Amount', 'Tax deducted', 'Date'],
        [
          'salary',
          'EXAMPLE SOFTWARE PRIVATE LIMITED',
          'MUMX12345A',
          '192',
          1200000,
          110000,
          '31-03-2026',
        ],
        ['', 'Tenant (synthetic)', '', '', 180000, 0, ''],
      ]),
      'client',
    );
    expect(p.lines[0]).toEqual(
      expect.objectContaining({
        head: 'salary',
        amount: '1200000.00',
        transactionOn: '2026-03-31',
      }),
    );
    expect(p.lines[1]!.head).toBe('unclassified');
  });

  it('refuses a sheet without an amount column', () => {
    expect(() =>
      parseStatement(
        sheet([
          ['Name', 'PAN'],
          ['X', 'Y'],
        ]),
        'ais',
      ),
    ).toThrow(StatementRefused);
  });
});

describe('refusals', () => {
  it('refuses the encrypted AIS JSON, a PDF, and anything else', () => {
    expect(() => parseStatement(Buffer.from('{"data":"U2FsdGVkX1+..."}'), 'ais')).toThrow(
      /encrypted/,
    );
    expect(() => parseStatement(Buffer.from('%PDF-1.7 ...'), '26as')).toThrow(/password/);
    expect(() => parseStatement(Buffer.from('just some notes'), 'client')).toThrow(/not a format/);
  });
});

describe('matchIncomeLines', () => {
  const line = (over: Partial<ItrIncomeLine>): ItrIncomeLine => ({
    id: Math.random().toString(36),
    source: '26as',
    head: 'other_sources',
    section: null,
    description: null,
    payerName: null,
    payerTan: null,
    amount: '0.00',
    taxDeducted: '0.00',
    transactionOn: null,
    ...over,
  });

  it('matches by TAN, then by name without Ltd, within a head; gaps first', () => {
    const m = matchIncomeLines([
      line({ payerTan: 'DELS54321B', amount: '20000.00', taxDeducted: '2000.00' }),
      line({ payerTan: 'DELS54321B', amount: '25250.00', taxDeducted: '2525.00' }),
      line({ source: 'ais', payerTan: 'dels54321b', amount: '45250.40' }),
      line({ source: 'client', payerName: 'x', payerTan: 'DELS54321B', amount: '45250.00' }),
      line({ source: 'ais', payerName: 'Listed Co Ltd', amount: '1500.00' }),
      line({ source: 'client', payerName: 'LISTED CO LIMITED', amount: '1000.00' }),
      line({
        source: 'ais',
        head: 'capital_gains',
        payerName: 'Demo Broking LLP',
        amount: '250000.00',
      }),
      line({ source: 'client', head: 'house_property', payerName: 'Tenant', amount: '180000.00' }),
    ]);
    expect(m.rows.map((r) => [r.head, r.status, r.difference])).toEqual([
      ['capital_gains', 'not_in_client', '0.00'],
      ['other_sources', 'mismatch', '500.00'],
      ['house_property', 'only_client', '0.00'],
      ['other_sources', 'matched', '0.40'],
    ]);
    const bank = m.rows.find((r) => r.payerTan === 'DELS54321B')!;
    expect(bank.amounts).toEqual({ '26as': '45250.00', ais: '45250.40', client: '45250.00' });
    expect(bank.taxDeducted['26as']).toBe('4525.00');
    expect(m.counts).toEqual({ matched: 1, mismatch: 1, not_in_client: 1, only_client: 1 });
    expect(m.totals.find((t) => t.head === 'other_sources')!.amounts).toEqual({
      '26as': '45250.00',
      ais: '46750.40',
      client: '46250.00',
    });
  });
});
