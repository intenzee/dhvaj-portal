import type { AnalyticsProfileDef, AnalyticsRuleDef } from '@hsdg/contracts';
import { V1_LIBRARY, V1_RULES } from './analytics-methodology-v1.fixture';
import {
  analyticsRuleProblem,
  inForce,
  resolveMethodology,
  runPreliminaryAnalytics,
  type AnalyticsInput,
} from './planning-analytics-engine';

const header: AnalyticsInput['header'] = {
  periodEnd: '2026-03-31',
  pyPeriodEnd: '2025-03-31',
  currency: 'INR',
  units: 'inr_crore',
  pyUnits: null,
  dataStatus: 'final',
};

const methodology = (
  profile = 'generic',
  patch: { rules?: AnalyticsRuleDef[]; profile?: Partial<AnalyticsProfileDef> } = {},
) => {
  const lib = { ...V1_LIBRARY, rules: patch.rules ?? V1_LIBRARY.rules };
  const m = resolveMethodology(lib, profile, '2026-03-31')!.methodology;
  return { ...m, profile: { ...m.profile, ...patch.profile } };
};

type Over = Partial<Omit<AnalyticsInput, 'methodology'>> & {
  profile?: string;
  rules?: AnalyticsRuleDef[];
  profilePatch?: Partial<AnalyticsProfileDef>;
};
const run = (values: AnalyticsInput['values'], over: Over = {}) => {
  const { profile, rules, profilePatch, ...rest } = over;
  return runPreliminaryAnalytics({
    methodology: methodology(profile, { rules, profile: profilePatch }),
    header,
    values,
    ...rest,
  });
};

const ratio = (r: ReturnType<typeof run>, key: string) => r.ratios.find((x) => x.key === key)!;
const exception = (r: ReturnType<typeof run>, key: string) =>
  r.exceptions.find((x) => x.ruleKey === key);
const status = (r: ReturnType<typeof run>, key: string) => r.rules.find((x) => x.ruleKey === key);
/** A copy of the v1 rules with one rule patched (a new version in force). */
const withRule = (key: string, patch: Partial<AnalyticsRuleDef>) =>
  V1_RULES.map((r) => (r.ruleKey === key ? { ...r, ...patch, version: r.version + 1 } : r));

describe('runPreliminaryAnalytics (03.2.8) on the v1 methodology library', () => {
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
    // The card keeps the library rule + version it fired under.
    expect(e.ruleCode).toMatch(/^PAR-\d{3}$/);
    expect(e.ruleVersion).toBe(1);
    expect(e.methodologyVersion).toBe('dhvaj-analytics-2026.1');
    expect(e.whyMayMatter).toBeTruthy();
  });

  it('never labels an attention parameter as materiality, misstatement or risk', () => {
    const r = run({
      revenue: { cy: 200, py: 100 },
      trade_receivables: { cy: 90, py: 20 },
      pat: { cy: 30, py: 10 },
      cash_bank: { cy: 2, py: 10 },
      net_worth: { cy: -5, py: 10 },
    });
    expect(r.exceptions.length).toBeGreaterThan(2);
    for (const e of r.exceptions) {
      expect(`${e.observation} ${e.whyFlagged} ${e.whyMayMatter}`.toLowerCase()).not.toMatch(
        /misstatement|significant risk|audit risk|is material\b/,
      );
    }
  });

  it('every seeded attention rule has neutral wording that passes the library validator', () => {
    const metrics = new Set(V1_LIBRARY.metrics.map((m) => m.metricKey));
    const ratios = new Set(V1_RULES.filter((r) => r.kind === 'ratio').map((r) => r.ruleKey));
    for (const r of V1_RULES)
      expect([r.ruleCode, analyticsRuleProblem(r, metrics, ratios)]).toEqual([r.ruleCode, null]);
  });

  it('inventory days need a cost base — never Revenue', () => {
    const noCost = run({ inventory: { cy: 10, py: 8 }, revenue: { cy: 100, py: 90 } });
    expect(ratio(noCost, 'inventory_days').status).toBe('insufficient_data');
    expect(ratio(noCost, 'inventory_days').reason).toContain('Cost of sales');
    expect(ratio(noCost, 'inventory_days').inputs.map((i) => i.metricKey)).not.toContain('revenue');
    const withCost = run({ inventory: { cy: 10, py: 8 }, cost_of_sales: { cy: 73, py: 73 } });
    expect(ratio(withCost, 'inventory_days').cy).toBe(50);
    expect(ratio(withCost, 'inventory_days').basisNote).toContain('Cost base: Cost of sales');
    // The profile's ordered fallback: purchases when cost of sales is absent.
    const purchases = run({ inventory: { cy: 10, py: 8 }, purchases: { cy: 73, py: 73 } });
    expect(ratio(purchases, 'inventory_days').basisNote).toContain('Cost base: Purchases');
  });

  it('the validator rejects an inventory-days definition over Revenue', () => {
    const metrics = new Set(V1_LIBRARY.metrics.map((m) => m.metricKey));
    const inv = V1_RULES.find((r) => r.ruleKey === 'inventory_days')!;
    expect(
      analyticsRuleProblem(
        {
          ...inv,
          definition: {
            kind: 'ratio',
            num: { metric: 'inventory' },
            den: { metric: 'revenue' },
            scale: 365,
            unit: 'days',
          },
        },
        metrics,
        new Set(),
      ),
    ).toMatch(/never Revenue/);
  });

  it('payable days prefer purchases and disclose the basis', () => {
    const r = run({
      trade_payables: { cy: 10, py: 10 },
      purchases: { cy: 73, py: 73 },
      revenue: { cy: 500, py: 500 },
    });
    expect(ratio(r, 'payable_days').basisNote).toContain('Purchases');
    expect(ratio(r, 'payable_days').cy).toBe(50);
    const cos = run({ trade_payables: { cy: 10, py: 10 }, cost_of_sales: { cy: 73, py: 73 } });
    expect(ratio(cos, 'payable_days').basisNote).toContain('Cost of sales');
    const none = run({ trade_payables: { cy: 10, py: 10 }, revenue: { cy: 500, py: 500 } });
    expect(ratio(none, 'payable_days').status).toBe('insufficient_data');
  });

  it('revenue vs inventory prefers a cost base; the profile decides the fallback', () => {
    const values = { inventory: { cy: 50, py: 20 }, revenue: { cy: 110, py: 100 } };
    const generic = exception(run(values), 'rel_revenue_inventory')!;
    expect(generic.observation).toContain('revenue from operations trend');
    expect(generic.whyFlagged).toContain('profile’s fallback'); // the fallback is disclosed
    const withCost = exception(
      run({ ...values, cost_of_sales: { cy: 80, py: 75 } }),
      'rel_revenue_inventory',
    )!;
    expect(withCost.observation).toContain('cost of sales');
    // A profile with no fallback does not evaluate the rule without a cost base.
    const strict = run(values, {
      profile: 'manufacturing',
      profilePatch: { inventoryTrendFallback: null },
    });
    expect(exception(strict, 'rel_revenue_inventory')).toBeUndefined();
    expect(status(strict, 'rel_revenue_inventory')!.outcome).toBe('insufficient_data');
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
    expect(gm.ruleCode).toMatch(/^PAR-/);
    expect(gm.inputs.map((i) => [i.metricKey, i.cy, i.py])).toEqual([
      ['gross_profit', 30, 25],
      ['revenue', 100, 100],
    ]);
    expect(exception(r, 'gross_margin_shift')?.observation).toContain('from 25% to 30%');
  });

  it('debt definition is configurable and disclosed; finance cost basis is average or closing', () => {
    const values = {
      total_borrowings: { cy: 100, py: 60 },
      lease_liabilities: { cy: 20, py: 20 },
      net_worth: { cy: 200, py: 200 },
      finance_cost: { cy: 12, py: 6 },
    };
    const closing = run(values);
    expect(ratio(closing, 'debt_equity').cy).toBe(0.5);
    expect(ratio(closing, 'debt_equity').basisNote).toBe('Debt = Total borrowings');
    expect(ratio(closing, 'finance_cost_rate').cy).toBe(12);
    const configured = run(values, {
      profilePatch: {
        debtMetrics: ['total_borrowings', 'lease_liabilities'],
        financeCostBasis: 'average',
      },
    });
    expect(ratio(configured, 'debt_equity').cy).toBe(0.6);
    expect(ratio(configured, 'debt_equity').basisNote).toContain(
      'Total borrowings + Lease liabilities',
    );
    // Average of (60 + 20) and (100 + 20) = 100 → 12 / 100.
    expect(ratio(configured, 'finance_cost_rate').cy).toBe(12);
    expect(ratio(configured, 'finance_cost_rate').basisNote).toContain('CY on average balance');
    expect(ratio(configured, 'finance_cost_rate').basisNote).toContain(
      'PY on closing balance — no opening balance available',
    );
  });

  it('average-balance day ratios only when the profile asks and opening balances exist', () => {
    const values = {
      trade_receivables: { cy: 30, py: 10, pp: 6 },
      revenue: { cy: 365, py: 365 },
    };
    expect(ratio(run(values), 'receivable_days').cy).toBe(30); // closing
    const avg = run(values, { profilePatch: { averageBalances: true } });
    expect(ratio(avg, 'receivable_days').cy).toBe(20); // (10 + 30) / 2
    expect(ratio(avg, 'receivable_days').py).toBe(8); // (6 + 10) / 2 from the prior file
    expect(ratio(avg, 'receivable_days').basisNote).toContain('average balance');
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

  it('working-capital trend: a shift in working-capital days is surfaced', () => {
    const r = run({
      revenue: { cy: 365, py: 365 },
      trade_receivables: { cy: 120, py: 60 },
      inventory: { cy: 40, py: 40 },
      trade_payables: { cy: 30, py: 30 },
    });
    expect(ratio(r, 'working_capital_days').cy).toBe(130);
    expect(ratio(r, 'working_capital_days').py).toBe(70);
    const e = exception(r, 'working_capital_trend')!;
    expect(e.observation).toContain('from 70 days to 130 days');
    expect(e.suggestedAttention).toBe('enhanced'); // 60 days ≥ Enhanced level
  });

  it('gross-margin trend reversal needs last year’s file and flags a reversed direction', () => {
    const values = {
      gross_profit: { cy: 26, py: 30, pp: 25 },
      revenue: { cy: 100, py: 100, pp: 100 },
    };
    const e = exception(run(values), 'gross_margin_trend_reversal')!;
    expect(e.observation).toContain('rose from 25% to 30% last year but fell to 26% this year');
    const noPrior = run({ gross_profit: { cy: 26, py: 30 }, revenue: { cy: 100, py: 100 } });
    expect(exception(noPrior, 'gross_margin_trend_reversal')).toBeUndefined();
    expect(status(noPrior, 'gross_margin_trend_reversal')!.reason).toContain(
      'last year’s audit file',
    );
    // Same direction → no reversal.
    const steady = run({
      gross_profit: { cy: 35, py: 30, pp: 25 },
      revenue: { cy: 100, py: 100, pp: 100 },
    });
    expect(exception(steady, 'gross_margin_trend_reversal')).toBeUndefined();
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

  it('never unit-converts a headcount or a percentage', () => {
    const r = run(
      { revenue: { cy: 82, py: 5400 }, headcount: { cy: 410, py: 300 } },
      { profile: 'services', header: { ...header, units: 'inr_crore', pyUnits: 'inr_lakh' } },
    );
    expect(r.movements.find((m) => m.metricKey === 'headcount')!.py).toBe(300);
    expect(ratio(r, 'revenue_per_employee').cy).toBe(0.2);
    expect(ratio(r, 'revenue_per_employee').py).toBe(0.18);
  });

  it('warns when the prior period is not twelve months earlier, and flags unaudited data', () => {
    const r = run({}, { header: { ...header, pyPeriodEnd: '2025-09-30', dataStatus: 'draft' } });
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['period_mismatch', 'unaudited_data']),
    );
  });

  it('industry profile changes the analytics, not the data model (NBFC drops working-capital ratios)', () => {
    const values = { revenue: { cy: 82, py: 54 }, trade_receivables: { cy: 29, py: 14 } };
    const nbfc = run(values, { profile: 'nbfc' });
    expect(ratio(nbfc, 'receivable_days').status).toBe('not_applicable');
    expect(exception(nbfc, 'rel_revenue_receivables')).toBeUndefined();
    expect(status(nbfc, 'rel_revenue_receivables')!.outcome).toBe('not_applicable');
    expect(ratio(run(values), 'receivable_days').status).toBe('calculated');
  });

  it('industry profiles ADD sector analytics (only for their profile)', () => {
    const values = {
      revenue: { cy: 100, py: 80 },
      order_book: { cy: 300, py: 150 },
      contract_assets: { cy: 40, py: 10 },
    };
    const construction = run(values, { profile: 'construction' });
    expect(ratio(construction, 'order_book_cover').cy).toBe(3);
    expect(exception(construction, 'movement_order_book')).toBeDefined();
    expect(exception(construction, 'rel_revenue_contract_assets')).toBeDefined();
    const generic = run(values);
    expect(generic.ratios.find((x) => x.key === 'order_book_cover')).toBeUndefined();
    expect(exception(generic, 'movement_order_book')).toBeUndefined();
  });

  it('a rule can suggest Immediate Partner Attention (NBFC capital adequacy)', () => {
    const r = run(
      {
        capital_adequacy: { cy: 12.5, py: 18 },
        gross_npa: { cy: 9, py: 4 },
        loan_book: { cy: 100, py: 100 },
      },
      { profile: 'nbfc' },
    );
    const crar = exception(r, 'nbfc_crar_below_level')!;
    expect(crar.suggestedAttention).toBe('immediate_partner');
    expect(crar.observation).toContain('12.5');
    // A 5-point NPA shift crosses the rule's Immediate Partner level (4).
    expect(exception(r, 'nbfc_gross_npa_shift')!.suggestedAttention).toBe('immediate_partner');
  });

  it('attention parameters are configurable data and drive the suggested attention', () => {
    const values = { revenue: { cy: 130, py: 100 } };
    expect(exception(run(values), 'movement_revenue')?.suggestedAttention).toBe('standard');
    const lower = run(values, {
      rules: withRule('movement_revenue', { parameterValue: 10, enhancedAt: 20 }),
    });
    expect(exception(lower, 'movement_revenue')?.suggestedAttention).toBe('enhanced');
    expect(exception(lower, 'movement_revenue')?.ruleVersion).toBe(2);
    const ipa = run(values, {
      rules: withRule('movement_revenue', { parameterValue: 10, immediateAt: 30 }),
    });
    expect(exception(ipa, 'movement_revenue')?.suggestedAttention).toBe('immediate_partner');
    const higher = run(values, { rules: withRule('movement_revenue', { parameterValue: 40 }) });
    expect(exception(higher, 'movement_revenue')).toBeUndefined();
    expect(status(higher, 'movement_revenue')!.outcome).toBe('not_flagged');
  });

  it('a disabled rule version stops the rule', () => {
    const r = run(
      { revenue: { cy: 130, py: 100 } },
      { rules: withRule('movement_revenue', { active: false }) },
    );
    expect(exception(r, 'movement_revenue')).toBeUndefined();
    expect(status(r, 'movement_revenue')).toBeUndefined();
  });

  it('minimum data quality: a rule needing final data is not run on draft figures', () => {
    const rules = withRule('movement_revenue', { minDataStatus: ['final'] });
    const values = { revenue: { cy: 130, py: 100 } };
    const draft = run(values, { rules, header: { ...header, dataStatus: 'draft' } });
    expect(exception(draft, 'movement_revenue')).toBeUndefined();
    expect(status(draft, 'movement_revenue')!.outcome).toBe('data_quality');
    expect(exception(run(values, { rules }), 'movement_revenue')).toBeDefined();
    const src = withRule('movement_revenue', { minSourceTypes: ['draft_fs', 'audited_py_fs'] });
    const mgmt = run(
      { revenue: { cy: 130, py: 100, cySource: 'management_accounts', pySource: 'audited_py_fs' } },
      { rules: src },
    );
    expect(status(mgmt, 'movement_revenue')!.outcome).toBe('data_quality');
  });

  it('a new related-party relationship is flagged even though % movement is N/M', () => {
    const e = exception(run({ related_party: { cy: 7, py: 0 } }), 'movement_related_party')!;
    expect(e.observation).toContain('against nil last year');
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

  it('lists every rule in force with its formula, parameter and outcome', () => {
    const r = run({ revenue: { cy: 130, py: 100 } });
    const s = status(r, 'movement_revenue')!;
    expect(s).toMatchObject({
      outcome: 'flagged',
      parameterText: '≥ 25% movement (Enhanced ≥ 50)',
    });
    expect(r.rules.every((x) => x.ruleCode && x.formula)).toBe(true);
  });
});

describe('library versions in force', () => {
  const rows = [
    { key: 'a', version: 1, effectiveFrom: '2000-01-01', effectiveTo: null, active: true },
    { key: 'a', version: 2, effectiveFrom: '2026-04-01', effectiveTo: null, active: true },
    { key: 'b', version: 1, effectiveFrom: '2000-01-01', effectiveTo: null, active: true },
    { key: 'b', version: 2, effectiveFrom: '2026-01-01', effectiveTo: null, active: false },
  ];
  it('uses the highest version effective on the period end; a retirement drops the item', () => {
    expect(inForce(rows, (r) => r.key, '2026-03-31').map((r) => [r.key, r.version])).toEqual([
      ['a', 1],
    ]);
    expect(inForce(rows, (r) => r.key, '2027-03-31').map((r) => [r.key, r.version])).toEqual([
      ['a', 2],
    ]);
    expect(inForce(rows, (r) => r.key, '2025-03-31').map((r) => [r.key, r.version])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  it('falls back to the generic profile when the file’s profile is retired', () => {
    const res = resolveMethodology(
      {
        ...V1_LIBRARY,
        profiles: V1_LIBRARY.profiles.map((p) =>
          p.profileKey === 'trading' ? { ...p, active: false } : p,
        ),
      },
      'trading',
      '2026-03-31',
    )!;
    expect(res.methodology.profile.profileKey).toBe('generic');
    expect(res.profiles.map((p) => p.profileKey)).not.toContain('trading');
  });
});
