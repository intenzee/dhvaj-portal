import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TdsParseError,
  form16aText,
  parseTdsText,
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

  it('reads Indian-grouped amounts, a dash as zero', () => {
    expect(parseTracesAmount('1,00,000.00')).toBe('100000.00');
    expect(parseTracesAmount('4000')).toBe('4000.00');
    expect(parseTracesAmount('-')).toBe('0.00');
    expect(parseTracesAmount('ten')).toBeNull();
  });
});

describe('26AS text export', () => {
  const text = fixture('26as-2026-27.txt');

  it('is recognised, and Form 16A is not', () => {
    expect(traces26asText.accepts(text)).toBe(true);
    expect(form16aText.accepts(text)).toBe(false);
  });

  it("reads Part I's rows under their deductor, and the header's PAN and year", () => {
    const p = parseTdsText(text);
    expect(p.source).toBe('26as_text');
    expect(p.pan).toBe('AAAFZ9999Q');
    expect(p.financialYear).toBe('2026-27');
    expect(p.credits).toHaveLength(4);
    expect(p.credits[0]).toEqual({
      deductorTan: 'DELA00001A',
      deductorName: 'ALPHA WIDGETS PRIVATE LIMITED',
      section: '194J',
      transactionDate: '2026-06-15',
      amountPaid: '100000.00',
      taxDeducted: '10000.00',
      tdsDeposited: '10000.00',
      bookingStatus: 'F',
      bookingDate: '2026-07-31',
    });
    expect(p.credits[2]).toMatchObject({
      deductorTan: 'MUMB00002B',
      section: '194JB',
      bookingStatus: 'U',
      bookingDate: null,
    });
  });

  it('leaves Part II (15G/15H) and later parts out', () => {
    const p = parseTdsText(text);
    expect(p.credits.map((c) => c.deductorTan)).not.toContain('DELS00009Z');
  });

  it('skips a row it cannot read and says when a deductor does not add up', () => {
    const p = parseTdsText(text);
    expect(p.warnings).toEqual([
      expect.stringMatching(/^Skipped line 19/),
      'GAMMA FOODS LIMITED (BLRG00003C): the rows add up to 2000.00, the summary says 2500.00.',
    ]);
  });

  it('finds columns by their heading, so an added column shifts nothing', () => {
    const shifted = text
      .split('\n')
      .map((l) =>
        l.startsWith('^Sr. No.^Section')
          ? l.replace('^Remarks^', '^Remarks^Deductee Ref^')
          : /^\^\d+\^194/.test(l)
            ? l.replace(/\^-\^(?=[\d,]+\.\d\d\^)/, '^-^X1^')
            : l,
      )
      .join('\n');
    expect(parseTdsText(shifted).credits[0]).toMatchObject({
      amountPaid: '100000.00',
      tdsDeposited: '10000.00',
    });
  });

  it('takes the year from the assessment year when that is all it says', () => {
    const p = parseTdsText(text.replace('^Financial Year^2026-27', ''));
    expect(p.financialYear).toBe('2026-27');
  });

  it("skips rows dated outside the file's year", () => {
    const p = parseTdsText(text.replace('10-Sep-2026', '10-Sep-2025'));
    expect(p.credits).toHaveLength(3);
    expect(p.warnings).toContain('Skipped 1 row dated outside 2026-27, the year of the file.');
  });

  it('refuses a 26AS without Part I', () => {
    const noPart1 = text.replace('PART-I - Details', 'PART-IV - Details');
    expect(() => parseTdsText(noPart1)).toThrow(TdsParseError);
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
        section: '194J',
        transactionDate: '2026-09-10',
        amountPaid: '50000.00',
        taxDeducted: '5000.00',
        tdsDeposited: '5000.00',
        bookingStatus: null,
        bookingDate: null,
      },
    ]);
    expect(p.warnings).toEqual([]);
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
      /Export as Text/,
    );
  });
});
