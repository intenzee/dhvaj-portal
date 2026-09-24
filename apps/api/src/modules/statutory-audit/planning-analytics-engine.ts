import {
  ANALYTICS_METHODOLOGY_VERSION,
  DEFAULT_ANALYTICS_PARAMETERS,
  FINANCIAL_METRIC_DEFS,
  FINANCIAL_UNIT_FACTOR,
  PLANNING_ATTENTION,
  type AnalyticsAttentionParameters,
  type AnalyticsResult,
  type AnalyticsWarning,
  type DerivedAnalyticsException,
  type FinancialUnit,
  type IndustryProfile,
  type MetricMovement,
  type PlanningAttention,
  type RatioResult,
} from '@hsdg/contracts';

/**
 * 03.2.8 Preliminary Analytical Review — pure, DB-free engine (DHVAJ 03.2 §12–§17).
 *
 * Calculates movements, ratios and relationships from the manually entered
 * Focused Financial Dataset and surfaces exceptions for the auditor to
 * investigate. It never concludes misstatement or risk: wording is factual,
 * attention parameters are methodology-configured (not materiality), and a
 * ratio is only calculated when its inputs exist and its denominator is
 * meaningful. Inventory / payable days never fall back to Revenue.
 */

export interface AnalyticsInput {
  profile: IndustryProfile;
  header: {
    periodEnd: string | null;
    pyPeriodEnd: string | null;
    currency: string | null;
    units: FinancialUnit | null;
    pyUnits: FinancialUnit | null;
  };
  /** metricKey → CY/PY amounts as entered (PY in `pyUnits` when set). */
  values: Readonly<Record<string, { cy?: number | null; py?: number | null }>>;
  customMetrics?: readonly { key: string; label: string }[];
  parameters?: AnalyticsAttentionParameters;
}

interface ProfileConfig {
  /** Ratios / rules that are not meaningful for the profile. */
  excludedRatios: readonly string[];
  excludedRules: readonly string[];
  /** System-suggested industry considerations for 03.2.3 (Manager confirms). */
  considerations: readonly string[];
}

const WORKING_CAPITAL_RATIOS = [
  'receivable_days',
  'inventory_days',
  'payable_days',
  'current_ratio',
  'working_capital',
];

/** Industry Analytics Profiles (§17) — versioned with ANALYTICS_METHODOLOGY_VERSION. */
export const INDUSTRY_PROFILE_CONFIG: Readonly<Record<IndustryProfile, ProfileConfig>> = {
  generic: {
    excludedRatios: [],
    excludedRules: [],
    considerations: [],
  },
  manufacturing: {
    excludedRatios: [],
    excludedRules: [],
    considerations: [
      'Inventory existence and valuation (raw material / WIP / finished goods mix)',
      'Capacity utilisation and production KPIs',
      'Commodity / input-price sensitivity',
      'Standard costing and overhead absorption',
    ],
  },
  trading: {
    excludedRatios: [],
    excludedRules: [],
    considerations: [
      'Customer and supplier concentration',
      'Returns, discounts and rebates',
      'Inventory ageing and slow-moving stock',
    ],
  },
  services: {
    excludedRatios: ['inventory_days'],
    excludedRules: ['rel_revenue_inventory', 'movement_inventory'],
    considerations: [
      'Unbilled / accrued revenue and contract cut-off',
      'Revenue per employee / utilisation metrics',
      'Contract and customer concentration',
    ],
  },
  construction: {
    excludedRatios: [],
    excludedRules: [],
    considerations: [
      'Order book and stage-of-completion measurement',
      'Contract assets / liabilities, retentions and advances',
      'Onerous contracts and cost-to-complete estimates',
    ],
  },
  nbfc: {
    excludedRatios: [...WORKING_CAPITAL_RATIOS, 'gross_margin'],
    excludedRules: [
      'rel_revenue_receivables',
      'rel_revenue_inventory',
      'gross_margin_shift',
      'liquidity_current_ratio',
    ],
    considerations: [
      'Sector-specific RBI regulatory metrics (capital adequacy, NPA / ECL staging)',
      'Generic working-capital ratios do not apply — use the sector methodology',
      'Asset-liability maturity profile and liquidity coverage',
    ],
  },
  section8: {
    excludedRatios: ['gross_margin', 'inventory_days'],
    excludedRules: ['gross_margin_shift', 'rel_revenue_inventory'],
    considerations: [
      'Grants, donations and restricted funds',
      'Programme / utilisation metrics and application of income',
      'Compliance with registration conditions',
    ],
  },
};

const LABEL: Record<string, string> = Object.fromEntries(
  FINANCIAL_METRIC_DEFS.map((d) => [d.key, d.label]),
);

/** Metrics whose standalone movement is worth surfacing. */
const MOVEMENT_METRICS = [
  'revenue',
  'gross_profit',
  'pbt',
  'pat',
  'cash_bank',
  'trade_receivables',
  'inventory',
  'trade_payables',
  'total_borrowings',
  'employee_cost',
  'finance_cost',
  'related_party',
] as const;

/** Suggested (editable) FS areas per metric — never a final area decision (03.5). */
const AREAS: Record<string, string[]> = {
  revenue: ['Revenue'],
  gross_profit: ['Revenue', 'Cost of sales'],
  pbt: ['Profit & loss'],
  pat: ['Profit & loss', 'Taxation'],
  cash_bank: ['Cash & bank'],
  trade_receivables: ['Trade receivables', 'Revenue'],
  inventory: ['Inventory', 'Cost of sales'],
  trade_payables: ['Trade payables', 'Purchases'],
  total_borrowings: ['Borrowings'],
  employee_cost: ['Employee benefits'],
  finance_cost: ['Finance cost', 'Borrowings'],
  related_party: ['Related parties'],
};

// ── number helpers ───────────────────────────────────────────────────────────

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

/** (CY − PY) / |PY| × 100; null when either side is missing or PY is 0. */
export function pctChange(cy: number | null, py: number | null): number | null {
  if (cy === null || py === null || py === 0) return null;
  return ((cy - py) / Math.abs(py)) * 100;
}

function pctLabel(cy: number | null, py: number | null): string {
  if (cy === null || py === null) return '—';
  if (py === 0) return 'N/M';
  const p = round(pctChange(cy, py)!);
  return `${p > 0 ? '+' : ''}${p}%`;
}

const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${round(n)}%`;

// ── engine ───────────────────────────────────────────────────────────────────

export function runPreliminaryAnalytics(input: AnalyticsInput): AnalyticsResult {
  const params = input.parameters ?? DEFAULT_ANALYTICS_PARAMETERS;
  const profile = INDUSTRY_PROFILE_CONFIG[input.profile];
  const { header } = input;
  const warnings: AnalyticsWarning[] = [];
  const ready = !!(header.periodEnd && header.currency && header.units);
  if (!ready) {
    warnings.push({
      code: 'header_incomplete',
      message: 'Record the period end, currency and units before entering figures.',
    });
  }

  // PY conversion into CY units (§21: warn on unit mismatch; never mix silently).
  let pyFactor: number | null = 1;
  if (header.units && header.pyUnits && header.pyUnits !== header.units) {
    const cyF = FINANCIAL_UNIT_FACTOR[header.units];
    const pyF = FINANCIAL_UNIT_FACTOR[header.pyUnits];
    if (cyF === null || pyF === null) {
      pyFactor = null;
      warnings.push({
        code: 'unit_mismatch_unconvertible',
        message:
          'Prior-year figures use a different, non-standard unit — CY/PY comparisons are not calculated.',
      });
    } else {
      pyFactor = pyF / cyF;
      warnings.push({
        code: 'unit_mismatch_converted',
        message:
          'Prior-year figures were entered in different units and have been converted to current-year units.',
      });
    }
  }
  if (header.periodEnd && header.pyPeriodEnd) {
    const cy = new Date(header.periodEnd);
    const py = new Date(header.pyPeriodEnd);
    const months = (cy.getFullYear() - py.getFullYear()) * 12 + (cy.getMonth() - py.getMonth());
    if (months !== 12) {
      warnings.push({
        code: 'period_mismatch',
        message: `The prior-year period ends ${months} month(s) before the current period — movements may not be comparable.`,
      });
    }
  }

  const v = (key: string, period: 'cy' | 'py'): number | null => {
    const raw = input.values[key]?.[period];
    if (raw === null || raw === undefined) return null;
    if (period === 'py') return pyFactor === null ? null : raw * pyFactor;
    return raw;
  };
  const labelOf = (key: string) =>
    LABEL[key] ?? input.customMetrics?.find((c) => c.key === key)?.label ?? key;

  // Movements for every metric with any figure, canonical order then custom.
  const orderedKeys = [
    ...FINANCIAL_METRIC_DEFS.map((d) => d.key as string),
    ...(input.customMetrics ?? []).map((c) => c.key),
  ];
  const movements: MetricMovement[] = orderedKeys
    .filter((k) => input.values[k] && (input.values[k]!.cy != null || input.values[k]!.py != null))
    .map((k) => {
      const cy = v(k, 'cy');
      const py = v(k, 'py');
      return {
        metricKey: k,
        label: labelOf(k),
        cy,
        py,
        absolute: cy !== null && py !== null ? cy - py : null,
        percent: pctChange(cy, py),
        percentLabel: pctLabel(cy, py),
      };
    });

  const ratios = computeRatios(v, labelOf).map((r) =>
    profile.excludedRatios.includes(r.key)
      ? {
          ...r,
          cy: null,
          py: null,
          status: 'not_applicable' as const,
          reason: 'Not meaningful for this industry profile.',
        }
      : r,
  );

  const exceptions = ready
    ? deriveExceptions(v, labelOf, params).filter((e) => !profile.excludedRules.includes(e.ruleKey))
    : [];

  return {
    methodologyVersion: ANALYTICS_METHODOLOGY_VERSION,
    profile: input.profile,
    parameters: params,
    ready,
    warnings,
    movements,
    ratios,
    exceptions,
  };
}

type Getter = (key: string, period: 'cy' | 'py') => number | null;

function computeRatios(v: Getter, labelOf: (k: string) => string): RatioResult[] {
  const out: RatioResult[] = [];
  const inputs = (...keys: string[]) =>
    keys.map((k) => ({ metricKey: k, label: labelOf(k), cy: v(k, 'cy'), py: v(k, 'py') }));

  /** num / den × scale for each period, with explicit missing / non-meaningful handling. */
  const ratio = (
    key: string,
    label: string,
    formula: string,
    unit: RatioResult['unit'],
    num: string,
    den: string,
    scale: number,
    denMustBePositive = true,
  ) => {
    const calc = (p: 'cy' | 'py') => {
      const n = v(num, p);
      const d = v(den, p);
      if (n === null || d === null) return { value: null, why: 'missing' as const };
      if (d === 0 || (denMustBePositive && d < 0)) return { value: null, why: 'nm' as const };
      return { value: round((n / d) * scale, unit === 'x' ? 2 : 1), why: null };
    };
    const cy = calc('cy');
    const py = calc('py');
    const any = cy.value !== null || py.value !== null;
    const status: RatioResult['status'] = any
      ? 'calculated'
      : cy.why === 'nm' || py.why === 'nm'
        ? 'not_meaningful'
        : 'insufficient_data';
    out.push({
      key,
      label,
      formula,
      unit,
      cy: cy.value,
      py: py.value,
      status,
      reason:
        status === 'insufficient_data'
          ? `Needs ${labelOf(num)} and ${labelOf(den)}.`
          : status === 'not_meaningful'
            ? `${labelOf(den)} is zero or negative — ratio not meaningful.`
            : null,
      inputs: inputs(num, den),
    });
  };

  ratio(
    'gross_margin',
    'Gross margin',
    'Gross profit / Revenue × 100',
    '%',
    'gross_profit',
    'revenue',
    100,
  );
  ratio(
    'pbt_margin',
    'PBT margin',
    'Profit before tax / Revenue × 100',
    '%',
    'pbt',
    'revenue',
    100,
  );
  ratio('pat_margin', 'PAT margin', 'Profit after tax / Revenue × 100', '%', 'pat', 'revenue', 100);
  ratio(
    'receivable_days',
    'Receivable days',
    'Trade receivables (closing) / Revenue × 365',
    'days',
    'trade_receivables',
    'revenue',
    365,
  );
  // Never Revenue: cost of sales is required (§12).
  ratio(
    'inventory_days',
    'Inventory days',
    'Inventory (closing) / Cost of sales × 365',
    'days',
    'inventory',
    'cost_of_sales',
    365,
  );
  // Purchases preferred, cost of sales as the disclosed alternative; never Revenue.
  const payableBase =
    v('purchases', 'cy') !== null || v('purchases', 'py') !== null ? 'purchases' : 'cost_of_sales';
  ratio(
    'payable_days',
    'Payable days',
    `Trade payables (closing) / ${labelOf(payableBase)} × 365`,
    'days',
    'trade_payables',
    payableBase,
    365,
  );
  ratio(
    'current_ratio',
    'Current ratio',
    'Current assets / Current liabilities',
    'x',
    'current_assets',
    'current_liabilities',
    1,
  );
  ratio(
    'debt_equity',
    'Debt to equity',
    'Total borrowings / Net worth (debt = total borrowings)',
    'x',
    'total_borrowings',
    'net_worth',
    1,
  );
  ratio(
    'finance_cost_rate',
    'Finance cost to borrowings',
    'Finance cost / Closing borrowings × 100',
    '%',
    'finance_cost',
    'total_borrowings',
    100,
  );
  ratio(
    'employee_cost_ratio',
    'Employee-cost ratio',
    'Employee cost / Revenue × 100',
    '%',
    'employee_cost',
    'revenue',
    100,
  );

  // Working capital (amount): receivables + inventory − payables.
  const wc = (p: 'cy' | 'py') => {
    const r = v('trade_receivables', p);
    const i = v('inventory', p);
    const t = v('trade_payables', p);
    if (r === null && i === null && t === null) return null;
    return (r ?? 0) + (i ?? 0) - (t ?? 0);
  };
  const wcCy = wc('cy');
  const wcPy = wc('py');
  out.push({
    key: 'working_capital',
    label: 'Trade working capital',
    formula: 'Trade receivables + Inventory − Trade payables',
    unit: 'amount',
    cy: wcCy,
    py: wcPy,
    status: wcCy === null && wcPy === null ? 'insufficient_data' : 'calculated',
    reason:
      wcCy === null && wcPy === null
        ? 'Needs trade receivables, inventory or trade payables.'
        : null,
    inputs: inputs('trade_receivables', 'inventory', 'trade_payables'),
  });
  return out;
}

function deriveExceptions(
  v: Getter,
  labelOf: (k: string) => string,
  p: AnalyticsAttentionParameters,
): DerivedAnalyticsException[] {
  const out: DerivedAnalyticsException[] = [];
  const attention = (size: number, param: number): PlanningAttention =>
    Math.abs(size) >= param * p.enhancedMultiple
      ? PLANNING_ATTENTION.enhanced
      : PLANNING_ATTENTION.standard;
  const growth = (k: string) => pctChange(v(k, 'cy'), v(k, 'py'));
  const snap = (...keys: string[]) =>
    Object.fromEntries(
      keys.flatMap((k) => [
        [`${k}_cy`, v(k, 'cy')],
        [`${k}_py`, v(k, 'py')],
      ]),
    );

  // Single-line movements.
  for (const k of MOVEMENT_METRICS) {
    const cy = v(k, 'cy');
    const py = v(k, 'py');
    if (cy === null || py === null) continue;
    const g = growth(k);
    if (py === 0 && cy !== 0 && k === 'related_party') {
      out.push({
        ruleKey: `movement_${k}`,
        kind: 'movement',
        observation: `${labelOf(k)} is ${cy} this year against nil last year (new relationship).`,
        whyFlagged: 'A new related-party relationship or balance arose during the year.',
        suggestedAttention: PLANNING_ATTENTION.standard,
        affectedAreas: AREAS[k] ?? [],
        values: snap(k),
      });
      continue;
    }
    if (g === null || Math.abs(g) < p.movementPct) continue;
    out.push({
      ruleKey: `movement_${k}`,
      kind: 'movement',
      observation: `${labelOf(k)} moved ${fmtPct(g)} (CY ${cy} vs PY ${py}).`,
      whyFlagged: `Movement of ${fmtPct(g)} is at or above the planning attention parameter of ${p.movementPct}% (methodology ${ANALYTICS_METHODOLOGY_VERSION}; not a materiality threshold).`,
      suggestedAttention: attention(g, p.movementPct),
      affectedAreas: AREAS[k] ?? [],
      values: snap(k),
    });
  }

  // Relationship analytics (§13) — compare growth rates across metrics.
  const relationship = (
    ruleKey: string,
    a: string,
    b: string,
    observation: (ga: number, gb: number) => string,
    areas: string[],
  ) => {
    const ga = growth(a);
    const gb = growth(b);
    if (ga === null || gb === null) return;
    const gap = ga - gb;
    if (Math.abs(gap) < p.relationshipGapPts) return;
    out.push({
      ruleKey,
      kind: 'relationship',
      observation: observation(ga, gb),
      whyFlagged: `Growth rates diverge by ${round(Math.abs(gap))} percentage points, at or above the relationship attention parameter of ${p.relationshipGapPts} points.`,
      suggestedAttention: attention(gap, p.relationshipGapPts),
      affectedAreas: areas,
      values: snap(a, b),
    });
  };

  relationship(
    'rel_revenue_receivables',
    'trade_receivables',
    'revenue',
    (gr, grev) =>
      `Trade receivables moved ${fmtPct(gr)} while revenue moved ${fmtPct(grev)} — receivables have grown ${gr > grev ? 'materially faster' : 'materially slower'} than revenue.`,
    ['Trade receivables', 'Revenue'],
  );
  const costBase =
    v('cost_of_sales', 'cy') !== null && v('cost_of_sales', 'py') !== null
      ? 'cost_of_sales'
      : 'revenue';
  relationship(
    'rel_revenue_inventory',
    'inventory',
    costBase,
    (gi, gb) =>
      `Inventory moved ${fmtPct(gi)} while ${labelOf(costBase).toLowerCase()} moved ${fmtPct(gb)} — inventory movement is inconsistent with the ${costBase === 'revenue' ? 'revenue' : 'cost'} trend.`,
    ['Inventory', 'Cost of sales'],
  );
  relationship(
    'rel_borrowings_finance_cost',
    'finance_cost',
    'total_borrowings',
    (gf, gb) =>
      `Finance cost moved ${fmtPct(gf)} while borrowings moved ${fmtPct(gb)} — the finance-cost movement appears inconsistent with the debt movement.`,
    ['Finance cost', 'Borrowings'],
  );
  // Profit vs cash: directions differ and the gap is large.
  {
    const gp = growth('pat');
    const gc = growth('cash_bank');
    if (
      gp !== null &&
      gc !== null &&
      Math.sign(gp) !== Math.sign(gc) &&
      Math.abs(gp - gc) >= p.relationshipGapPts
    ) {
      out.push({
        ruleKey: 'rel_profit_cash',
        kind: 'relationship',
        observation: `Profit after tax moved ${fmtPct(gp)} while cash & bank moved ${fmtPct(gc)} — the profit trend is inconsistent with the cash trend.`,
        whyFlagged: `Profit and cash moved in opposite directions, diverging by ${round(Math.abs(gp - gc))} percentage points (parameter ${p.relationshipGapPts} points).`,
        suggestedAttention: attention(gp - gc, p.relationshipGapPts),
        affectedAreas: ['Revenue', 'Trade receivables', 'Cash & bank'],
        values: snap('pat', 'cash_bank'),
      });
    }
  }

  // Ratio shifts (percentage points).
  const shift = (ruleKey: string, num: string, den: string, label: string, areas: string[]) => {
    const r = (per: 'cy' | 'py') => {
      const n = v(num, per);
      const d = v(den, per);
      return n === null || d === null || d <= 0 ? null : (n / d) * 100;
    };
    const cy = r('cy');
    const py = r('py');
    if (cy === null || py === null) return;
    const d = cy - py;
    if (Math.abs(d) < p.ratioShiftPts) return;
    out.push({
      ruleKey,
      kind: 'ratio_shift',
      observation: `${label} moved from ${round(py)}% to ${round(cy)}% (${d > 0 ? '+' : ''}${round(d)} points).`,
      whyFlagged: `A shift of ${round(Math.abs(d))} points is at or above the ratio attention parameter of ${p.ratioShiftPts} points.`,
      suggestedAttention: attention(d, p.ratioShiftPts),
      affectedAreas: areas,
      values: snap(num, den),
    });
  };
  shift('gross_margin_shift', 'gross_profit', 'revenue', 'Gross margin', [
    'Revenue',
    'Cost of sales',
    'Inventory',
  ]);
  shift('rel_revenue_employee_cost', 'employee_cost', 'revenue', 'Employee-cost ratio', [
    'Employee benefits',
  ]);

  // Liquidity: current ratio falls below 1, or moves sharply.
  {
    const ca = (per: 'cy' | 'py') => v('current_assets', per);
    const cl = (per: 'cy' | 'py') => v('current_liabilities', per);
    const cyR = ca('cy') !== null && (cl('cy') ?? 0) > 0 ? ca('cy')! / cl('cy')! : null;
    const pyR = ca('py') !== null && (cl('py') ?? 0) > 0 ? ca('py')! / cl('py')! : null;
    if (cyR !== null && pyR !== null) {
      const change = pctChange(cyR, pyR)!;
      const crossed = cyR < 1 && pyR >= 1;
      if (crossed || Math.abs(change) >= p.movementPct) {
        out.push({
          ruleKey: 'liquidity_current_ratio',
          kind: 'liquidity',
          observation: `Current ratio moved from ${round(pyR, 2)} to ${round(cyR, 2)}${crossed ? ' and is now below 1' : ''}.`,
          whyFlagged: crossed
            ? 'Current liabilities now exceed current assets.'
            : `The current ratio moved ${fmtPct(change)}, at or above the ${p.movementPct}% attention parameter.`,
          suggestedAttention: crossed
            ? PLANNING_ATTENTION.enhanced
            : attention(change, p.movementPct),
          affectedAreas: ['Going concern / liquidity', 'Borrowings'],
          values: snap('current_assets', 'current_liabilities'),
        });
      }
    }
  }

  // Negative net worth.
  {
    const nw = v('net_worth', 'cy');
    if (nw !== null && nw < 0) {
      out.push({
        ruleKey: 'negative_net_worth',
        kind: 'liquidity',
        observation: `Net worth is negative at the period end (${nw}).`,
        whyFlagged: 'Total equity is below zero.',
        suggestedAttention: PLANNING_ATTENTION.enhanced,
        affectedAreas: ['Going concern / liquidity', 'Equity'],
        values: snap('net_worth'),
      });
    }
  }
  return out;
}
