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

  it('looks back twelve months at most', () => {
    const items = dueFeeItems(terms({ startDate: '2020-01-01' }), '2026-10-17');
    expect(items[0]!.key).toBe('retainer:2025-10');
    expect(items).toHaveLength(13);
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
