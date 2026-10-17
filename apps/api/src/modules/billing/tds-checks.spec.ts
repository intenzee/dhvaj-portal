import { tdsExpectedBy, tdsReturnDueDate, tdsSectionKind } from '@hsdg/contracts';
import { awaitedFor, bookedChecks, creditChecks, longDate } from './tds-checks';

const credit = (over: Partial<Parameters<typeof creditChecks>[0]> = {}) => ({
  section: '194JB',
  amountPaid: '100000.00',
  taxDeducted: '10000.00',
  tdsDeposited: '10000.00',
  bookingStatus: 'F',
  remarks: null,
  ...over,
});
const codes = (c: Parameters<typeof creditChecks>[0]) => creditChecks(c).map((x) => x.code);

describe('PS-204 section codes', () => {
  it('reads old and new section names as what the payment was', () => {
    expect(['194J', '194JB', '194J(b)', '1027'].map(tdsSectionKind)).toEqual(
      Array(4).fill('professional_10'),
    );
    expect(['194JA', '194J(a)', '1026'].map(tdsSectionKind)).toEqual(Array(3).fill('technical_2'));
    expect(tdsSectionKind('1028')).toBe('director');
    expect(['194C', '1023', '1024'].map(tdsSectionKind)).toEqual(Array(3).fill('contract'));
    expect(['194H', '1006'].map(tdsSectionKind)).toEqual(['commission', 'commission']);
    expect(tdsSectionKind('194A')).toBe('other');
  });
});

describe('PS-204 checks on a 26AS credit', () => {
  it('a final 10% credit under 194JB raises nothing', () => {
    expect(creditChecks(credit())).toEqual([]);
    // Rounded to the rupee is still 10%.
    expect(codes(credit({ amountPaid: '33333.00', taxDeducted: '3333.00' }))).toEqual([]);
  });

  it('flags 2% (technical rate on professional fees), 20% (no PAN), 11.8% (TDS on GST)', () => {
    expect(
      codes(credit({ section: '194JA', taxDeducted: '2000.00', tdsDeposited: '2000.00' })),
    ).toEqual(['rate_2']);
    expect(codes(credit({ taxDeducted: '20000.00', tdsDeposited: '20000.00' }))).toEqual([
      'rate_20',
    ]);
    expect(codes(credit({ taxDeducted: '11800.00', tdsDeposited: '11800.00' }))).toEqual([
      'tds_on_gst',
    ]);
    expect(creditChecks(credit({ taxDeducted: '7500.00', tdsDeposited: '7500.00' }))).toEqual([
      expect.objectContaining({
        code: 'unusual_rate',
        message: expect.stringMatching(/^TDS at 7.5%/),
      }),
    ]);
  });

  it('flags a section not for professional fees, and does not query its rate', () => {
    expect(
      codes(credit({ section: '194C', taxDeducted: '2000.00', tdsDeposited: '2000.00' })),
    ).toEqual(['wrong_section']);
    expect(codes(credit({ section: '1028' }))).toEqual(['director_section']);
    // 20% is the missing PAN whatever the section.
    expect(
      codes(credit({ section: '194H', taxDeducted: '20000.00', tdsDeposited: '20000.00' })),
    ).toEqual(['wrong_section', 'rate_20']);
  });

  it('a s.197 certificate (remark F) is a note, and its low rate no flag', () => {
    expect(creditChecks(credit({ remarks: 'F', taxDeducted: '5000.00' }))).toEqual([
      expect.objectContaining({ code: 'lower_deduction_certificate', level: 'note' }),
    ]);
  });

  it('short deposits and U/O statuses are risks; P a note; reversals pass quietly', () => {
    expect(creditChecks(credit({ tdsDeposited: '8000.00' }))).toEqual([
      expect.objectContaining({
        code: 'short_deposit',
        level: 'risk',
        message: expect.stringContaining('₹8,000.00 of the ₹10,000.00'),
      }),
    ]);
    expect(codes(credit({ bookingStatus: 'U' }))).toEqual(['status_unmatched']);
    expect(codes(credit({ bookingStatus: 'O' }))).toEqual(['status_overbooked']);
    expect(creditChecks(credit({ bookingStatus: 'P' }))).toEqual([
      expect.objectContaining({ code: 'status_provisional', level: 'note' }),
    ]);
    expect(
      codes(
        credit({ amountPaid: '-100000.00', taxDeducted: '-10000.00', tdsDeposited: '-10000.00' }),
      ),
    ).toEqual([]);
  });
});

describe('PS-204 checks on booked TDS', () => {
  it('compares with the fee before GST, when known', () => {
    expect(bookedChecks({ tdsAmount: '1000.00', taxable: '10000.00' })).toEqual([]);
    expect(bookedChecks({ tdsAmount: '1180.00', taxable: '10000.00' })).toEqual([
      expect.objectContaining({ code: 'tds_on_gst' }),
    ]);
    expect(bookedChecks({ tdsAmount: '500.00', taxable: '10000.00' })).toEqual([
      expect.objectContaining({
        code: 'booked_rate',
        message: expect.stringMatching(/^TDS at 5%/),
      }),
    ]);
    expect(bookedChecks({ tdsAmount: '500.00', taxable: null })).toEqual([]);
  });
});

describe('PS-204 awaited or missing', () => {
  it("knows each quarter's 26Q due date, and when the 26AS should show it", () => {
    expect(['Q1', 'Q2', 'Q3', 'Q4'].map((q) => tdsReturnDueDate('2026-27', q as 'Q1'))).toEqual([
      '2026-07-31',
      '2026-10-31',
      '2027-01-31',
      '2027-05-31',
    ]);
    expect(tdsExpectedBy('2026-27', 'Q2')).toBe('2026-11-15');
    expect(longDate('2026-11-15')).toBe('15 Nov 2026');
  });

  it('awaits a deduction till the return is due and a 26AS late enough says otherwise', () => {
    // Before the return is due.
    expect(awaitedFor('2026-27', 'Q2', null, '2026-10-17')).toEqual({
      expectedBy: '2026-11-15',
      reason: 'Return due 31 Oct 2026',
    });
    // Due, not yet in any 26AS.
    expect(awaitedFor('2026-27', 'Q2', '2026-10-20', '2026-11-05')!.reason).toMatch(
      /^Return was due 31 Oct 2026/,
    );
    // Past it, but the 26AS is older.
    expect(awaitedFor('2026-27', 'Q2', '2026-10-20', '2026-12-01')!.reason).toBe(
      'Your 26AS is as on 20 Oct 2026; import a newer one (it should show from 15 Nov 2026)',
    );
    // A 26AS as on the date or later: missing.
    expect(awaitedFor('2026-27', 'Q2', '2026-11-15', '2026-12-01')).toBeNull();
    // No 26AS at all, long past: missing, as before.
    expect(awaitedFor('2025-26', 'Q1', null, '2026-10-17')).toBeNull();
  });
});
