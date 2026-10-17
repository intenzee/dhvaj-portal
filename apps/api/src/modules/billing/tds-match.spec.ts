import { tdsQuarterLabel, tdsReminderText } from '@hsdg/contracts';
import {
  matchTds,
  quarterIndex,
  SUBSET_LIMIT,
  type MatchCredit,
  type MatchReceipt,
} from './tds-match';

const Q2 = quarterIndex('2026-27', 'Q2');
const Q3 = quarterIndex('2026-27', 'Q3');
const rupees = (n: number): bigint => BigInt(Math.round(n * 100));

const credit = (id: string, tds: number, o: Partial<MatchCredit> = {}): MatchCredit => ({
  id,
  clientId: 'alpha',
  quarterIndex: Q2,
  date: '2026-08-10',
  tds: rupees(tds),
  ...o,
});
const receipt = (id: string, tds: number, o: Partial<MatchReceipt> = {}): MatchReceipt => ({
  id,
  clientId: 'alpha',
  quarterIndex: Q2,
  date: '2026-08-10',
  tds: rupees(tds),
  ...o,
});
const ONE_RUPEE = rupees(1);

describe('quarterIndex', () => {
  it('counts quarters across years', () => {
    expect(quarterIndex('2026-27', 'Q4') + 1).toBe(quarterIndex('2027-28', 'Q1'));
  });
});

describe('matchTds', () => {
  it('matches one to one exactly, nearest date first among equals', () => {
    const out = matchTds(
      [
        credit('c-far', 1000, { date: '2026-07-01' }),
        credit('c-near', 1000, { date: '2026-08-12' }),
      ],
      [receipt('r1', 1000)],
      ONE_RUPEE,
    );
    expect(out.matches).toEqual([
      {
        kind: 'exact',
        clientId: 'alpha',
        creditIds: ['c-near'],
        receiptIds: ['r1'],
        difference: 0n,
      },
    ]);
    expect(out.notBooked).toEqual(['c-far']);
    expect(out.missing).toEqual([]);
  });

  it('matches within the tolerance, and not beyond it', () => {
    const within = matchTds([credit('c1', 1180)], [receipt('r1', 1179.5)], ONE_RUPEE);
    expect(within.matches[0]).toMatchObject({ kind: 'tolerance', difference: rupees(0.5) });
    const beyond = matchTds([credit('c1', 1180)], [receipt('r1', 1000)], ONE_RUPEE);
    expect(beyond.matches).toEqual([]);
    expect(beyond.notBooked).toEqual(['c1']);
    expect(beyond.missing).toEqual(['r1']);
  });

  it('prefers an exact pair before spending a credit within the tolerance', () => {
    const out = matchTds(
      [credit('c-1000', 1000), credit('c-1000.5', 1000.5)],
      [receipt('r-1000.5', 1000.5, { date: '2026-07-01' }), receipt('r-1000', 1000)],
      ONE_RUPEE,
    );
    expect(out.matches.map((m) => [m.kind, m.creditIds[0], m.receiptIds[0]])).toEqual([
      ['exact', 'c-1000.5', 'r-1000.5'],
      ['exact', 'c-1000', 'r-1000'],
    ]);
  });

  it('matches one receipt deposited as several credits (a split deposit)', () => {
    const out = matchTds(
      [credit('c1', 6000), credit('c2', 4000), credit('c3', 999)],
      [receipt('r1', 10000)],
      ONE_RUPEE,
    );
    expect(out.matches).toEqual([
      expect.objectContaining({ kind: 'split', creditIds: ['c1', 'c2'], receiptIds: ['r1'] }),
    ]);
    expect(out.notBooked).toEqual(['c3']);
  });

  it('matches several receipts reported as one credit', () => {
    const out = matchTds(
      [credit('c1', 3000)],
      [receipt('r1', 1000, { date: '2026-07-05' }), receipt('r2', 2000), receipt('r3', 750)],
      ONE_RUPEE,
    );
    expect(out.matches).toEqual([
      expect.objectContaining({ kind: 'combined', creditIds: ['c1'], receiptIds: ['r1', 'r2'] }),
    ]);
    expect(out.missing).toEqual(['r3']);
  });

  it("agrees a client's quarter in total when no pairing does", () => {
    const out = matchTds(
      [credit('c1', 2500), credit('c2', 2500)],
      [receipt('r1', 1000), receipt('r2', 1500), receipt('r3', 2500.4)],
      ONE_RUPEE,
    );
    // r3 ~ c1 within the tolerance; then c2 = r1 + r2.
    expect(out.matches.map((m) => m.kind)).toEqual(['tolerance', 'combined']);
    const total = matchTds(
      [credit('c1', 700), credit('c2', 800)],
      [receipt('r1', 600), receipt('r2', 900)],
      ONE_RUPEE,
    );
    expect(total.matches).toEqual([
      expect.objectContaining({
        kind: 'quarter_total',
        creditIds: ['c1', 'c2'],
        receiptIds: ['r1', 'r2'],
        difference: 0n,
      }),
    ]);
  });

  it('matches across a neighbouring quarter only after its own quarter', () => {
    const out = matchTds(
      [credit('c-q3', 500, { quarterIndex: Q3, date: '2026-10-02' })],
      [receipt('r-q2', 500, { date: '2026-09-28' })],
      ONE_RUPEE,
    );
    expect(out.matches).toEqual([expect.objectContaining({ kind: 'other_quarter' })]);
    const two = matchTds(
      [credit('c-q2', 500, { quarterIndex: Q2 - 2 })],
      [receipt('r-q2', 500)],
      ONE_RUPEE,
    );
    expect(two.matches).toEqual([]);
  });

  it('never matches across clients, and a TAN on no client is never booked', () => {
    const out = matchTds(
      [credit('c-beta', 1000, { clientId: 'beta' }), credit('c-none', 1000, { clientId: null })],
      [receipt('r-alpha', 1000)],
      ONE_RUPEE,
    );
    expect(out.matches).toEqual([]);
    expect(out.notBooked).toEqual(['c-beta', 'c-none']);
    expect(out.missing).toEqual(['r-alpha']);
  });

  it('a zero tolerance asks for the paisa', () => {
    const out = matchTds([credit('c1', 1000)], [receipt('r1', 1000.01)], 0n);
    expect(out.matches).toEqual([]);
  });

  it(`looks for splits among the ${SUBSET_LIMIT} credits nearest the receipt`, () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      credit(`c${String(i).padStart(2, '0')}`, 100 + i, {
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      }),
    );
    const out = matchTds(many, [receipt('r1', 100 + 101, { date: '2026-07-01' })], 0n);
    expect(out.matches).toEqual([
      expect.objectContaining({ kind: 'split', creditIds: ['c00', 'c01'] }),
    ]);
  });
});

describe('the TDS reminder', () => {
  it('names the quarter by its months', () => {
    expect(tdsQuarterLabel('2026-27', 'Q4')).toBe('Q4 (January–March 2027) of 2026-27');
  });

  it("lists what is missing, with the firm's PAN, and asks for the return", () => {
    const text = tdsReminderText({
      clientName: 'Y Client LLP',
      firmName: 'Example & Co',
      pan: 'AAAFZ9999Q',
      financialYear: '2026-27',
      quarter: 'Q2',
      lines: [
        { receivedOn: '2026-07-20', tdsAmount: '2500.00', tdsSection: '194J', reference: 'UTR1' },
        { receivedOn: '2026-08-02', tdsAmount: '125000', tdsSection: 'other', reference: null },
      ],
    });
    expect(text).toContain(
      'our Form 26AS (PAN AAAFZ9999Q) for Q2 (July–September 2026) of 2026-27',
    );
    expect(text).toContain('These deductions do not appear');
    expect(text).toContain('• Payment of 20/07/2026 (UTR1): TDS ₹2,500.00 under section 194J');
    expect(text).toContain('• Payment of 02/08/2026: TDS ₹1,25,000.00\n');
    expect(text).toContain('Total: ₹1,27,500.00');
    expect(text).toContain('quoting our PAN AAAFZ9999Q');
    expect(text.endsWith('Thank you,\nExample & Co')).toBe(true);
  });

  it('says it once for one deduction, and the year when no quarter is given', () => {
    const text = tdsReminderText({
      clientName: 'Y',
      firmName: 'F',
      pan: null,
      financialYear: '2026-27',
      quarter: null,
      lines: [{ receivedOn: '2026-07-20', tdsAmount: '10', tdsSection: null, reference: null }],
    });
    expect(text).toContain('with our Form 26AS for the year 2026-27. This deduction does not');
    expect(text).not.toContain('Total:');
  });
});
