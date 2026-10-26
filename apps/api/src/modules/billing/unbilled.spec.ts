import { dueFeeItems, type FeeTerms } from './unbilled';

const terms = (over: Partial<FeeTerms>): FeeTerms => ({
  frequency: 'monthly',
  startDate: '2026-07-10',
  endDate: null,
  retainerAmount: '25000.00',
  billingModel: 'retainer',
  completed: false,
  years: [],
  ...over,
});

describe('PS-206 dueFeeItems', () => {
  it('a monthly retainer is due for each month begun since it took effect', () => {
    const items = dueFeeItems(terms({}), '2026-10-17');
    expect(items.map((i) => [i.key, i.label, i.amount])).toEqual([
      ['retainer:2026-07', 'July 2026', '25000.00'],
      ['retainer:2026-08', 'August 2026', '25000.00'],
      ['retainer:2026-09', 'September 2026', '25000.00'],
      ['retainer:2026-10', 'October 2026', '25000.00'],
    ]);
    expect(items[2]).toMatchObject({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      ageDays: 17,
    });
    expect(items[3]!.ageDays).toBe(0);
  });

  it('quarters and years follow the Indian financial year; the end date stops them', () => {
    const q = dueFeeItems(terms({ frequency: 'quarterly', startDate: '2026-02-01' }), '2026-10-17');
    expect(q.map((i) => i.key)).toEqual([
      'retainer:2025-26:Q4',
      'retainer:2026-27:Q1',
      'retainer:2026-27:Q2',
      'retainer:2026-27:Q3',
    ]);
    expect(q[2]).toMatchObject({ label: 'Q2 2026-27 (Jul–Sep 2026)', periodEnd: '2026-09-30' });
    const a = dueFeeItems(terms({ frequency: 'annual', startDate: '2025-06-01' }), '2026-10-17');
    expect(a.map((i) => i.label)).toEqual(['FY 2025-26', 'FY 2026-27']);
    const ended = dueFeeItems(terms({ endDate: '2026-08-15' }), '2026-10-17');
    expect(ended.map((i) => i.key)).toEqual(['retainer:2026-07', 'retainer:2026-08']);
  });

  it('never lets an old unbilled fee drop off; the billing go-live is where the list starts', () => {
    const items = dueFeeItems(terms({ startDate: '2024-04-01' }), '2026-10-17');
    expect(items[0]!.key).toBe('retainer:2024-04');
    expect(items).toHaveLength(31);
    const live = dueFeeItems(terms({ startDate: '2024-04-01' }), '2026-10-17', '2026-04-01');
    expect(live[0]!.key).toBe('retainer:2026-04');
    expect(live).toHaveLength(7);
    // A go-live before the fee began changes nothing.
    expect(dueFeeItems(terms({}), '2026-10-17', '2025-01-01')).toHaveLength(4);
  });

  it('an FY 2024-25 year fee still unbilled stays listed after 1 April 2026; the go-live drops it', () => {
    const fy = terms({
      frequency: 'annual',
      retainerAmount: null,
      years: [
        {
          id: 'y1',
          financialYear: '2024-25',
          feeAmount: '60000.00',
          billingModel: null,
          closed: true,
        },
      ],
    });
    expect(dueFeeItems(fy, '2026-10-17').map((i) => i.label)).toEqual(['FY 2024-25']);
    expect(dueFeeItems(fy, '2026-10-17', '2025-04-01')).toEqual([]);
    const quarterly = { ...fy, frequency: 'quarterly' as const };
    expect(dueFeeItems(quarterly, '2026-10-17', '2025-01-01').map((i) => i.key)).toEqual([
      'year:y1:2024-25:Q4',
    ]);
  });

  it('nothing without a start, an amount, or a fixed fee', () => {
    expect(dueFeeItems(terms({ startDate: null }), '2026-10-17')).toEqual([]);
    expect(dueFeeItems(terms({ retainerAmount: null }), '2026-10-17')).toEqual([]);
    expect(dueFeeItems(terms({ retainerAmount: '0' }), '2026-10-17')).toEqual([]);
    expect(dueFeeItems(terms({ billingModel: 'time_and_material' }), '2026-10-17')).toEqual([]);
    expect(dueFeeItems(terms({ frequency: 'milestone' }), '2026-10-17')).toEqual([]);
  });

  it('a one-off fee once; on completion only when the work is done', () => {
    expect(dueFeeItems(terms({ frequency: 'one_time' }), '2026-10-17')).toMatchObject([
      { key: 'retainer:once', label: 'Fixed fee', amount: '25000.00' },
    ]);
    expect(dueFeeItems(terms({ frequency: 'on_completion' }), '2026-10-17')).toEqual([]);
    expect(
      dueFeeItems(terms({ frequency: 'on_completion', completed: true }), '2026-10-17'),
    ).toHaveLength(1);
  });

  it("a compliance year's fee is shared over its quarters, the last taking the paise", () => {
    const year = {
      id: 'y1',
      financialYear: '2026-27',
      feeAmount: '100000.00',
      billingModel: null,
      closed: false,
    };
    const items = dueFeeItems(terms({ frequency: 'quarterly', years: [year] }), '2026-10-17');
    expect(items.map((i) => [i.key, i.amount])).toEqual([
      ['year:y1:2026-27:Q1', '25000.00'],
      ['year:y1:2026-27:Q2', '25000.00'],
      ['year:y1:2026-27:Q3', '25000.00'],
    ]);
    expect(items[0]!.label).toBe('FY 2026-27 · Q1 2026-27 (Apr–Jun 2026)');
    const monthly = dueFeeItems(
      terms({ years: [{ ...year, feeAmount: '1000.00' }] }),
      '2027-03-31',
    );
    expect(monthly).toHaveLength(12);
    expect(monthly[0]!.amount).toBe('83.33');
    expect(monthly[11]!.amount).toBe('83.37');
  });

  it('a year fee replaces the retainer; never configured means the year in one', () => {
    const year = {
      id: 'y1',
      financialYear: '2026-27',
      feeAmount: '60000.00',
      billingModel: null,
      closed: false,
    };
    const items = dueFeeItems(terms({ frequency: null, years: [year] }), '2026-10-17');
    expect(items).toMatchObject([
      { key: 'year:y1:2026-27', label: 'FY 2026-27', amount: '60000.00' },
    ]);
    expect(
      dueFeeItems(terms({ years: [{ ...year, billingModel: 'pro_bono' }] }), '2026-10-17'),
    ).toEqual([]);
  });

  it('a milestone or event fee is due on its date, beside the retainer, unless nothing is billed', () => {
    const milestones = [
      {
        id: 'm1',
        description: 'Valuation report delivered',
        amount: '75000.00',
        dueOn: '2026-08-20',
      },
      { id: 'm2', description: 'Board meeting', amount: '5000.00', dueOn: '2026-11-01' },
    ];
    const items = dueFeeItems(
      terms({ frequency: 'milestone', startDate: '2026-04-01', milestones }),
      '2026-10-17',
    );
    expect(items).toEqual([
      {
        key: 'milestone:m1',
        source: 'milestone',
        label: 'Valuation report delivered',
        periodStart: '2026-08-20',
        periodEnd: '2026-08-20',
        amount: '75000.00',
        ageDays: 58,
      },
    ]);
    const both = dueFeeItems(terms({ milestones }), '2026-10-17');
    expect(both.map((i) => i.key)).toEqual([
      'retainer:2026-07',
      'retainer:2026-08',
      'milestone:m1',
      'retainer:2026-09',
      'retainer:2026-10',
    ]);
    expect(
      dueFeeItems(terms({ billingModel: 'time_and_material', milestones }), '2026-10-17'),
    ).toHaveLength(1);
    expect(dueFeeItems(terms({ billingModel: 'pro_bono', milestones }), '2026-10-17')).toEqual([]);
  });
});

describe('CM-4 fee period', () => {
  const year = (feeAmount: string, feePeriod: FeeTerms['years'][number]['feePeriod']) => ({
    id: 'y1',
    financialYear: '2026-27',
    feeAmount,
    feePeriod,
    billingModel: null,
    closed: false,
  });
  const yearEnd = '2027-03-31';

  it('₹5,000 per month billed monthly is 12 items of ₹5,000', () => {
    const items = dueFeeItems(
      terms({ retainerAmount: null, years: [year('5000.00', 'monthly')] }),
      yearEnd,
    );
    expect(items).toHaveLength(12);
    expect(new Set(items.map((i) => i.amount))).toEqual(new Set(['5000.00']));
  });

  it('₹5,000 per month billed quarterly is 4 items of ₹15,000', () => {
    const items = dueFeeItems(
      terms({ frequency: 'quarterly', retainerAmount: null, years: [year('5000.00', 'monthly')] }),
      yearEnd,
    );
    expect(items.map((i) => i.amount)).toEqual(['15000.00', '15000.00', '15000.00', '15000.00']);
  });

  it('₹1,00,000 per year billed monthly is unchanged: 11 × ₹8,333.33 and ₹8,333.37', () => {
    const items = dueFeeItems(
      terms({ retainerAmount: null, years: [year('100000.00', 'annual')] }),
      yearEnd,
    );
    expect(items.slice(0, 11).every((i) => i.amount === '8333.33')).toBe(true);
    expect(items[11]!.amount).toBe('8333.37');
  });

  it('a one-time fee is one item, whatever the invoicing frequency', () => {
    const items = dueFeeItems(
      terms({ retainerAmount: null, years: [year('25000.00', 'one_time')] }),
      yearEnd,
    );
    expect(items.map((i) => [i.key, i.amount])).toEqual([['year:y1:2026-27', '25000.00']]);
  });

  it('never configured: a monthly fee is invoiced monthly, a half-yearly one once a year', () => {
    const monthly = dueFeeItems(
      terms({ frequency: null, retainerAmount: null, years: [year('5000.00', 'monthly')] }),
      yearEnd,
    );
    expect(monthly).toHaveLength(12);
    const half = dueFeeItems(
      terms({ frequency: null, retainerAmount: null, years: [year('30000.00', 'half_yearly')] }),
      yearEnd,
    );
    expect(half.map((i) => i.amount)).toEqual(['60000.00']);
  });
});
