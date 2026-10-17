import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TdsParseError,
  form16aText,
  parseTdsText,
  normaliseYear,
  parseTracesAmount,
  parseTracesDate,
  traces26asText,
} from './tds-parsers';

/** Anonymised: made-up names, PANs and TANs in TRACES's layout. */
const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('TRACES dates and amounts', () => {
  it('reads the date shapes TRACES uses', () => {
    expect(parseTracesDate('15-Jun-2026')).toBe('2026-06-15');
    expect(parseTracesDate('5-Sept-2026')).toBe('2026-09-05');
    expect(parseTracesDate('15-06-2026')).toBe('2026-06-15');
    expect(parseTracesDate('15/06/2026')).toBe('2026-06-15');
    expect(parseTracesDate('2026-06-15')).toBe('2026-06-15');
    expect(parseTracesDate('31-Feb-2026')).toBeNull();
    expect(parseTracesDate('-')).toBeNull();
  });

  it('reads Indian-grouped amounts, a dash as zero, a reversal as negative', () => {
    expect(parseTracesAmount('1,00,000.00')).toBe('100000.00');
    expect(parseTracesAmount('4000')).toBe('4000.00');
    expect(parseTracesAmount('-')).toBe('0.00');
    expect(parseTracesAmount('-5000.00')).toBe('-5000.00');
    expect(parseTracesAmount('ten')).toBeNull();
  });
});

describe('26AS text export', () => {
  const text = fixture('26as-2026-27.txt');

  it('is recognised, and Form 16A is not', () => {
    expect(traces26asText.accepts(text)).toBe(true);
    expect(form16aText.accepts(text)).toBe(false);
  });

  it("reads the header's label row over its value row: PAN, year as 2026-2027, as-on date", () => {
    const p = parseTdsText(text);
    expect(p.source).toBe('26as_text');
    expect(p.pan).toBe('AAAFZ9999Q');
    expect(p.financialYear).toBe('2026-27');
    expect(p.asOn).toBe('2026-11-20');
  });

  it("reads Part I's rows under their deductor, trailing carets and all", () => {
    const p = parseTdsText(text);
    expect(p.credits).toHaveLength(8);
    expect(p.credits[0]).toEqual({
      deductorTan: 'DELA00001A',
      deductorName: 'ALPHA WIDGETS PRIVATE LIMITED',
      section: '194JB',
      transactionDate: '2026-06-15',
      amountPaid: '100000.00',
      taxDeducted: '10000.00',
      tdsDeposited: '10000.00',
      bookingStatus: 'F',
      bookingDate: '2026-07-31',
      remarks: null,
    });
    expect(p.credits[2]).toMatchObject({
      deductorTan: 'MUMB00002B',
      bookingStatus: 'U',
      bookingDate: null,
    });
    expect(p.credits.map((c) => [c.deductorTan, c.section, c.bookingStatus, c.remarks])).toEqual(
      expect.arrayContaining([
        ['DELD00004D', '194JA', 'P', null],
        ['CHNE00005E', '194JB', 'O', 'F'],
        ['PNEZ00006F', '1027', 'F', 'B'],
      ]),
    );
  });

  it('keeps a reversal signed, so it nets off the row it reverses', () => {
    const zeta = parseTdsText(text).credits.filter((c) => c.deductorTan === 'PNEZ00006F');
    expect(zeta.map((c) => [c.amountPaid, c.taxDeducted, c.tdsDeposited])).toEqual([
      ['50000.00', '5000.00', '5000.00'],
      ['-50000.00', '-5000.00', '-5000.00'],
    ]);
  });

  it('leaves Part II (15G/15H), TCS and later parts out; says Part X lists defaults', () => {
    const p = parseTdsText(text);
    expect(p.credits.map((c) => c.deductorTan)).not.toContain('DELS00009Z');
    expect(p.warnings).toContainEqual(expect.stringMatching(/defaults against the firm/));
  });

  it('skips a row it cannot read and says when a deductor does not add up', () => {
    const p = parseTdsText(text);
    expect(p.warnings).toEqual([
      expect.stringMatching(/^Skipped line 18/),
      'GAMMA FOODS LIMITED (BLRG00003C): the rows add up to 2000.00, the summary says 2500.00.',
      expect.stringMatching(/defaults against the firm/),
    ]);
  });

  it('says nothing of an empty Part X', () => {
    const quiet = text.replace(
      /^1\^2026-27\^0\.00.*$/m,
      '^^^*********** No Transactions Present **********^',
    );
    expect(parseTdsText(quiet).warnings).not.toContainEqual(expect.stringMatching(/defaults/));
  });

  it('finds columns by their heading, so an added column shifts nothing', () => {
    const shifted = text
      .split('\n')
      .map((l) =>
        l.startsWith('^Sr. No.^Section')
          ? l.replace('^Remarks^', '^Remarks^Deductee Ref^')
          : /^\^\d+\^(194|10)/.test(l)
            ? l.replace(/^(\^\d+\^[^^]+\^[^^]+\^[^^]+\^[^^]+\^[^^]+)\^/, '$1^X1^')
            : l,
      )
      .join('\n');
    expect(parseTdsText(shifted).credits[0]).toMatchObject({
      amountPaid: '100000.00',
      tdsDeposited: '10000.00',
      remarks: null,
    });
  });

  it('takes the year from the assessment year when that is all it says', () => {
    const p = parseTdsText(text.replace('^2026-2027^2027-2028^', '^^2027-2028^'));
    expect(p.financialYear).toBe('2026-27');
  });

  it("skips rows dated outside the file's year", () => {
    const p = parseTdsText(text.replace('10-Sep-2026', '10-Sep-2025'));
    expect(p.credits).toHaveLength(7);
    expect(p.warnings).toContain('Skipped 1 row dated outside 2026-27, the year of the file.');
  });

  it('refuses a 26AS without Part I', () => {
    const noPart1 = text.replace('PART-I - Details', 'PART-IV - Details');
    expect(() => parseTdsText(noPart1)).toThrow(TdsParseError);
  });

  it('still reads the label^value header of older exports, and its "Data updated till"', () => {
    const old = [
      'Annual Tax Statement under Section 203AA of the Income Tax Act, 1961',
      'Data updated till^15-Oct-2026',
      'Permanent Account Number (PAN)^AAAFZ9999Q^Current Status of PAN^Active^Financial Year^2026-27^Assessment Year^2027-28',
      'PART-I - Details of Tax Deducted at Source',
      'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited(Rs.)^Total Tax Deducted(Rs.)^Total TDS Deposited(Rs.)',
      '1^ALPHA WIDGETS PRIVATE LIMITED^DELA00001A^^^^^1,00,000.00^10,000.00^10,000.00',
      '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited(Rs.)^Tax Deducted(Rs.)^TDS Deposited(Rs.)',
      '^1^194J^15-Jun-2026^F^31-Jul-2026^-^1,00,000.00^10,000.00^10,000.00',
    ].join('\r\n');
    const p = parseTdsText(old);
    expect(p).toMatchObject({ pan: 'AAAFZ9999Q', financialYear: '2026-27', asOn: '2026-10-15' });
    expect(p.credits).toHaveLength(1);
  });
});

describe('26AS before AY 2023-24 (lettered parts)', () => {
  const text = fixture('26as-2021-22-part-a.txt');

  it('reads PART A as the TDS and stops at A1, A2, B and G', () => {
    const p = parseTdsText(text);
    expect(p).toMatchObject({ financialYear: '2021-22', asOn: '2022-06-10', warnings: [] });
    expect(p.credits).toEqual([
      expect.objectContaining({
        deductorTan: 'DELA00001A',
        section: '194J',
        tdsDeposited: '6000.00',
      }),
    ]);
  });
});

describe('normaliseYear', () => {
  it('takes either way TRACES writes a year', () => {
    expect(normaliseYear('2026-27')).toBe('2026-27');
    expect(normaliseYear('2026-2027')).toBe('2026-27');
    expect(normaliseYear('1999-2000')).toBe('1999-00');
    expect(normaliseYear('2026-2028')).toBeNull();
    expect(normaliseYear('2026')).toBeNull();
  });
});

describe('Form 16A text layer', () => {
  const text = fixture('form16a-q2.txt');

  it("reads the deductor, the firm's PAN, and one credit for the quarter", () => {
    const p = parseTdsText(text);
    expect(p.source).toBe('form16a_pdf');
    expect(p.pan).toBe('AAAFZ9999Q');
    expect(p.financialYear).toBe('2026-27');
    expect(p.credits).toEqual([
      {
        deductorTan: 'DELA00001A',
        deductorName: 'ALPHA WIDGETS PRIVATE LIMITED',
        section: '194JB',
        transactionDate: '2026-09-10',
        amountPaid: '50000.00',
        taxDeducted: '5000.00',
        tdsDeposited: '5000.00',
        bookingStatus: null,
        bookingDate: null,
        remarks: null,
      },
    ]);
    expect(p.warnings).toEqual([]);
  });

  it("reads a government deductor's PANNOTREQD and a 2025-Act payment code", () => {
    const govt = text
      .replace('AAACA0001A DELA00001A', 'PANNOTREQD DELA00001A')
      .replace(/ 194JB /g, ' 1027 ');
    const p = parseTdsText(govt);
    expect(p.pan).toBe('AAAFZ9999Q');
    expect(p.credits).toEqual([
      expect.objectContaining({ section: '1027', amountPaid: '50000.00', tdsDeposited: '5000.00' }),
    ]);
  });

  it('dates a quarter with no payment rows on its last day, and says so', () => {
    const p = parseTdsText(text.replace(/^\d .*\d{2}-\d{2}-\d{4}$/gm, ''));
    expect(p.credits[0]).toMatchObject({ transactionDate: '2026-09-30', amountPaid: '0.00' });
    expect(p.warnings).toEqual([expect.stringMatching(/^Q2: no payment rows/)]);
  });

  it('refuses a certificate naming two TANs', () => {
    expect(() => parseTdsText(`${text}\nMUMB00002B`)).toThrow(/more than one TAN/);
  });
});

describe('anything else', () => {
  it('is refused with how to get the right file', () => {
    expect(() => parseTdsText('Date,Narration,Amount\n01-04-2026,NEFT,100')).toThrow(
      /View As Text/,
    );
  });
});
