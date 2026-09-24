import { runPreliminaryAnalytics, type AnalyticsInput } from './planning-analytics-engine';

const header: AnalyticsInput['header'] = {
  periodEnd: '2026-03-31',
  pyPeriodEnd: '2025-03-31',
  currency: 'INR',
  units: 'inr_crore',
  pyUnits: null,
};

const run = (values: AnalyticsInput['values'], over: Partial<AnalyticsInput> = {}) =>
  runPreliminaryAnalytics({ profile: 'generic', header, values, ...over });

const ratio = (r: ReturnType<typeof run>, key: string) => r.ratios.find((x) => x.key === key)!;
const exception = (r: ReturnType<typeof run>, key: string) =>
  r.exceptions.find((x) => x.ruleKey === key);

describe('runPreliminaryAnalytics (03.2.8)', () => {
  it('works without a trial balance and requires period / currency / units first', () => {
    const r = run({ revenue: { cy: 82, py: 54 } }, { header: { ...header, units: null } });
    expect(r.ready).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain('header_incomplete');
    expect(r.exceptions).toEqual([]);
  });

  it('calculates absolute and % movement; PY = 0 is N/M, never infinity', () => {
    const r = run({ revenue: { cy: 82, py: 54 }, other_income: { cy: 5, py: 0 } });
    const rev = r.movements.find((m) => m.metricKey === 'revenue')!;
    expect(rev.absolute).toBe(28);
    expect(rev.percentLabel).toBe('+51.9%');
    const oi = r.movements.find((m) => m.metricKey === 'other_income')!;
    expect(oi.percent).toBeNull();
    expect(oi.percentLabel).toBe('N/M');
    expect(oi.absolute).toBe(5);
  });

  it('spec §13 example: receivables growing faster than revenue raises a neutral relationship exception', () => {
    const r = run({ revenue: { cy: 82, py: 54 }, trade_receivables: { cy: 29, py: 14 } });
    const e = exception(r, 'rel_revenue_receivables')!;
    expect(e.observation).toContain('+107.1%');
    expect(e.observation).toContain('+51.9%');
    expect(e.observation).toContain('materially faster');
    expect(e.observation.toLowerCase()).not.toMatch(/misstat|risk|recoverab/);
    expect(e.whyFlagged).toContain('attention parameter');
  });

  it('never labels an attention parameter as materiality, misstatement or risk', () => {
    const r = run({
      revenue: { cy: 200, py: 100 },
      trade_receivables: { cy: 90, py: 20 },
      pat: { cy: 30, py: 10 },
      cash_bank: { cy: 2, py: 10 },
    });
    for (const e of r.exceptions) {
      expect(`${e.observation} ${e.whyFlagged}`.toLowerCase()).not.toMatch(
        /misstatement|significant risk|audit risk|is material\b/,
      );
    }
  });

  it('inventory days need cost of sales — never Revenue', () => {
    const noCost = run({ inventory: { cy: 10, py: 8 }, revenue: { cy: 100, py: 90 } });
    expect(ratio(noCost, 'inventory_days').status).toBe('insufficient_data');
    expect(ratio(noCost, 'inventory_days').reason).toContain('Cost of sales');
    const withCost = run({ inventory: { cy: 10, py: 8 }, cost_of_sales: { cy: 73, py: 73 } });
    expect(ratio(withCost, 'inventory_days').cy).toBe(50);
    expect(ratio(withCost, 'inventory_days').formula).toContain('Cost of sales');
  });

  it('payable days prefer purchases and disclose the basis', () => {
    const r = run({
      trade_payables: { cy: 10, py: 10 },
      purchases: { cy: 73, py: 73 },
      revenue: { cy: 500, py: 500 },
    });
    expect(ratio(r, 'payable_days').formula).toContain('Purchases');
    expect(ratio(r, 'payable_days').cy).toBe(50);
    const cos = run({ trade_payables: { cy: 10, py: 10 }, cost_of_sales: { cy: 73, py: 73 } });
    expect(ratio(cos, 'payable_days').formula).toContain('Cost of sales');
    const none = run({ trade_payables: { cy: 10, py: 10 }, revenue: { cy: 500, py: 500 } });
    expect(ratio(none, 'payable_days').status).toBe('insufficient_data');
  });

  it('does not calculate a ratio over a zero or negative denominator', () => {
    const r = run({ total_borrowings: { cy: 50, py: 40 }, net_worth: { cy: -10, py: -5 } });
    expect(ratio(r, 'debt_equity').status).toBe('not_meaningful');
    expect(ratio(r, 'debt_equity').cy).toBeNull();
    expect(exception(r, 'negative_net_worth')?.suggestedAttention).toBe('enhanced');
  });

  it('shows formula and underlying values for every ratio', () => {
    const r = run({ gross_profit: { cy: 30, py: 25 }, revenue: { cy: 100, py: 100 } });
    const gm = ratio(r, 'gross_margin');
    expect(gm.formula).toBe('Gross profit / Revenue × 100');
    expect(gm.inputs.map((i) => [i.metricKey, i.cy, i.py])).toEqual([
      ['gross_profit', 30, 25],
      ['revenue', 100, 100],
    ]);
    expect(exception(r, 'gross_margin_shift')?.observation).toContain('from 25% to 30%');
  });

  it('borrowings vs finance cost and current-ratio crossing below 1', () => {
    const r = run({
      finance_cost: { cy: 12, py: 6 },
      total_borrowings: { cy: 100, py: 98 },
      current_assets: { cy: 90, py: 120 },
      current_liabilities: { cy: 100, py: 100 },
    });
    expect(exception(r, 'rel_borrowings_finance_cost')).toBeDefined();
    const liq = exception(r, 'liquidity_current_ratio')!;
    expect(liq.observation).toContain('below 1');
    expect(liq.suggestedAttention).toBe('enhanced');
  });

  it('converts PY units, and refuses to compare when units cannot be converted', () => {
    const conv = run(
      { revenue: { cy: 82, py: 5400 } },
      { header: { ...header, units: 'inr_crore', pyUnits: 'inr_lakh' } },
    );
    expect(conv.movements[0]!.py).toBe(54);
    expect(conv.warnings.map((w) => w.code)).toContain('unit_mismatch_converted');
    const other = run({ revenue: { cy: 82, py: 54 } }, { header: { ...header, pyUnits: 'other' } });
    expect(other.movements[0]!.py).toBeNull();
    expect(other.warnings.map((w) => w.code)).toContain('unit_mismatch_unconvertible');
  });

  it('warns when the prior period is not twelve months earlier', () => {
    const r = run({}, { header: { ...header, pyPeriodEnd: '2025-09-30' } });
    expect(r.warnings.map((w) => w.code)).toContain('period_mismatch');
  });

  it('industry profile changes the analytics, not the data model (NBFC drops working-capital ratios)', () => {
    const values = { revenue: { cy: 82, py: 54 }, trade_receivables: { cy: 29, py: 14 } };
    const nbfc = run(values, { profile: 'nbfc' });
    expect(ratio(nbfc, 'receivable_days').status).toBe('not_applicable');
    expect(exception(nbfc, 'rel_revenue_receivables')).toBeUndefined();
    expect(ratio(run(values), 'receivable_days').status).toBe('calculated');
  });

  it('attention parameters are configurable and drive the suggested attention', () => {
    const values = { revenue: { cy: 130, py: 100 } };
    expect(exception(run(values), 'movement_revenue')?.suggestedAttention).toBe('standard');
    expect(
      exception(
        run(values, {
          parameters: {
            movementPct: 10,
            relationshipGapPts: 20,
            ratioShiftPts: 3,
            enhancedMultiple: 2,
          },
        }),
        'movement_revenue',
      )?.suggestedAttention,
    ).toBe('enhanced');
    expect(
      exception(
        run(values, {
          parameters: {
            movementPct: 40,
            relationshipGapPts: 20,
            ratioShiftPts: 3,
            enhancedMultiple: 2,
          },
        }),
        'movement_revenue',
      ),
    ).toBeUndefined();
  });

  it('includes custom metrics in movements', () => {
    const r = run(
      { custom_order_book: { cy: 300, py: 200 } },
      { customMetrics: [{ key: 'custom_order_book', label: 'Order book' }] },
    );
    expect(r.movements).toEqual([
      expect.objectContaining({ label: 'Order book', percentLabel: '+50%' }),
    ]);
  });
});
