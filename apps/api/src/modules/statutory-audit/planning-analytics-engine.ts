import {
  ANALYTICS_RULE_KINDS,
  ATTENTION_PARAMETER_TYPES,
  DATASET_STATUSES,
  FINANCIAL_UNIT_FACTOR,
  METRIC_SOURCE_TYPES,
  PLANNING_ATTENTION,
  PLANNING_ATTENTIONS,
  type AnalyticsExpr,
  type AnalyticsMetricDef,
  type AnalyticsProfileDef,
  type AnalyticsResult,
  type AnalyticsRuleDef,
  type AnalyticsRuleDefinition,
  type AnalyticsRuleOutcome,
  type AnalyticsRuleStatus,
  type AnalyticsWarning,
  type DatasetStatus,
  type DerivedAnalyticsException,
  type FinancialUnit,
  type MetricMovement,
  type MetricSourceType,
  type PlanningAttention,
  type RatioResult,
  type RatioUnit,
} from '@hsdg/contracts';

/**
 * 03.2.8 Preliminary Analytical Review — pure, DB-free engine (DHVAJ 03.2 §12–§17).
 *
 * Runs the Analytics Methodology Library in force (metric definitions, the
 * industry profile and its ratio / attention rules — versioned data, see
 * planning-analytics-library.ts) over the manually entered Focused Financial
 * Dataset and surfaces exceptions for the auditor to investigate. It never
 * concludes misstatement or risk: wording is factual, attention parameters are
 * methodology-configured (not materiality), and a ratio is only calculated when
 * its inputs exist and its denominator is meaningful. Inventory / payable days
 * never fall back to Revenue.
 */

/** The library versions in force for one file. */
export interface AnalyticsMethodology {
  profile: AnalyticsProfileDef;
  /** Metric definitions in force (all profiles; the engine filters). */
  metrics: readonly AnalyticsMetricDef[];
  /** Rules in force (all profiles; the engine filters by appliesTo / excludedFor). */
  rules: readonly AnalyticsRuleDef[];
}

export interface AnalyticsInput {
  methodology: AnalyticsMethodology;
  header: {
    periodEnd: string | null;
    pyPeriodEnd: string | null;
    currency: string | null;
    units: FinancialUnit | null;
    pyUnits: FinancialUnit | null;
    dataStatus?: DatasetStatus | null;
  };
  /**
   * metricKey → figures as entered: CY, PY (in `pyUnits` when set) and `pp` —
   * the prior file's prior-year figure (PY−1), already in CY units.
   */
  values: Readonly<
    Record<
      string,
      {
        cy?: number | null;
        py?: number | null;
        pp?: number | null;
        cySource?: MetricSourceType | null;
        pySource?: MetricSourceType | null;
      }
    >
  >;
  customMetrics?: readonly { key: string; label: string }[];
}

type Period = 'cy' | 'py' | 'pp';
type Getter = (key: string, period: Period) => number | null;

// ── library resolution ───────────────────────────────────────────────────────

interface Versioned {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}

/**
 * The version of each item in force on `on` (ISO date): inside its effective
 * window, highest version wins; a retired item (that version inactive) drops out.
 */
export function inForce<T extends Versioned>(
  rows: readonly T[],
  keyOf: (r: T) => string,
  on: string,
): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    if (r.effectiveFrom > on || (r.effectiveTo !== null && r.effectiveTo < on)) continue;
    const k = keyOf(r);
    const cur = best.get(k);
    if (!cur || r.version > cur.version) best.set(k, r);
  }
  return [...best.values()].filter((r) => r.active);
}

/** Resolve the methodology for `profileKey` on `on`; falls back to `generic`. */
export function resolveMethodology(
  library: {
    metrics: readonly AnalyticsMetricDef[];
    profiles: readonly AnalyticsProfileDef[];
    rules: readonly AnalyticsRuleDef[];
  },
  profileKey: string,
  on: string,
): { methodology: AnalyticsMethodology; profiles: AnalyticsProfileDef[] } | null {
  const profiles = inForce(library.profiles, (p) => p.profileKey, on).sort((a, b) =>
    a.profileKey === 'generic'
      ? -1
      : b.profileKey === 'generic'
        ? 1
        : a.label.localeCompare(b.label),
  );
  const profile =
    profiles.find((p) => p.profileKey === profileKey) ??
    profiles.find((p) => p.profileKey === 'generic') ??
    null;
  if (!profile) return null;
  return {
    profiles,
    methodology: {
      profile,
      metrics: inForce(library.metrics, (m) => m.metricKey, on).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
      rules: inForce(library.rules, (r) => r.ruleCode, on).sort((a, b) =>
        a.ruleCode.localeCompare(b.ruleCode),
      ),
    },
  };
}

/** Metrics offered in the dataset grid for a profile. */
export function metricsForProfile(m: AnalyticsMethodology): AnalyticsMetricDef[] {
  return m.metrics.filter(
    (d) => d.appliesTo.length === 0 || d.appliesTo.includes(m.profile.profileKey),
  );
}

const ruleIsForProfile = (r: AnalyticsRuleDef, profile: string) =>
  r.appliesTo.length === 0 || r.appliesTo.includes(profile);

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
const signed = (n: number, dp = 1) => `${n > 0 ? '+' : ''}${round(n, dp)}`;

const UNIT_DP: Record<RatioUnit, number> = { '%': 1, days: 1, x: 2, amount: 2, per_unit: 2 };
/** A ratio value with its unit, e.g. `12.5%`, `64 days`, `1.52×`. */
function withUnit(v: number, unit: RatioUnit): string {
  const n = round(v, UNIT_DP[unit]);
  return unit === '%' ? `${n}%` : unit === 'days' ? `${n} days` : unit === 'x' ? `${n}×` : `${n}`;
}
/** A change in a ratio, e.g. `+3.1 points`, `−12 days`. */
function deltaWithUnit(d: number, unit: RatioUnit): string {
  const n = signed(d, UNIT_DP[unit]);
  return unit === '%' ? `${n} points` : unit === 'days' ? `${n} days` : unit === 'x' ? `${n}×` : n;
}
const unitWord = (unit: RatioUnit | null) =>
  unit === '%' ? 'points' : unit === 'days' ? 'days' : unit === 'x' ? '×' : '';

/** Render `{{name}}` placeholders; unknown names render empty. */
export function renderWording(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

const attentionRank: Record<PlanningAttention, number> = {
  standard: 0,
  enhanced: 1,
  immediate_partner: 2,
};
const maxAttention = (a: PlanningAttention, b: PlanningAttention) =>
  attentionRank[b] > attentionRank[a] ? b : a;

/** Base attention raised by the rule's Enhanced / Immediate Partner levels. */
function attentionFor(rule: AnalyticsRuleDef, size: number): PlanningAttention {
  let a = rule.suggestedAttention;
  if (rule.enhancedAt !== null && Math.abs(size) >= rule.enhancedAt)
    a = maxAttention(a, PLANNING_ATTENTION.enhanced);
  if (rule.immediateAt !== null && Math.abs(size) >= rule.immediateAt) {
    a = maxAttention(a, PLANNING_ATTENTION.immediatePartner);
  }
  return a;
}

/** e.g. `≥ 25% movement (Enhanced ≥ 50; Immediate Partner ≥ 100)`. */
export function parameterText(rule: AnalyticsRuleDef): string | null {
  if (rule.kind === 'ratio' || rule.parameterValue === null) return null;
  const p = rule.parameterValue;
  const unit =
    rule.parameterType === 'percent' ? '%' : rule.parameterType === 'relationship' ? ' points' : '';
  const def = rule.definition;
  let main: string;
  if (def.kind === 'threshold') {
    const op = { lt: '<', lte: '≤', gt: '>', gte: '≥' }[def.op];
    main = `${op} ${p}`;
  } else if (def.kind === 'trend_reversal') {
    main = `direction reverses, each move ≥ ${p}`;
  } else if (def.kind === 'ratio_shift') {
    main = `shift ≥ ${p}`;
  } else {
    main = `≥ ${p}${unit}${def.kind === 'movement' ? ' movement' : def.kind === 'relationship' ? ' gap' : ' change'}`;
  }
  if (def.kind === 'ratio_change' && def.crossBelow !== undefined)
    main += `, or falls below ${def.crossBelow}`;
  const lv = [
    rule.enhancedAt !== null ? `Enhanced ≥ ${rule.enhancedAt}` : null,
    rule.immediateAt !== null ? `Immediate Partner ≥ ${rule.immediateAt}` : null,
  ].filter(Boolean);
  return lv.length ? `${main} (${lv.join('; ')})` : main;
}

// ── engine ───────────────────────────────────────────────────────────────────

interface RatioCalc extends RatioResult {
  /** PY−1 value (from the prior file), used by trend rules only. */
  pp: number | null;
}

export function runPreliminaryAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { methodology: m, header } = input;
  const profile = m.profile;
  const warnings: AnalyticsWarning[] = [];
  const ready = !!(header.periodEnd && header.currency && header.units);
  if (!ready) {
    warnings.push({
      code: 'header_incomplete',
      message: 'Record the period end, currency and units before entering figures.',
    });
  }
  if (header.dataStatus && header.dataStatus !== 'final') {
    warnings.push({
      code: 'unaudited_data',
      message: `Current-year figures are ${header.dataStatus === 'draft' ? 'draft' : 'management accounts'} — unaudited; analytics are preliminary.`,
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

  const defs = new Map(m.metrics.map((d) => [d.metricKey, d]));
  const isAmount = (k: string) => (defs.get(k)?.valueType ?? 'amount') === 'amount';
  const v: Getter = (key, period) => {
    const raw = input.values[key]?.[period];
    if (raw === null || raw === undefined) return null;
    if (period === 'py' && isAmount(key)) return pyFactor === null ? null : raw * pyFactor;
    return raw;
  };
  const labelOf = (key: string) =>
    defs.get(key)?.label ?? input.customMetrics?.find((c) => c.key === key)?.label ?? key;

  // Movements for every metric with a figure: library order, custom, then any other.
  const ordered = [
    ...m.metrics.map((d) => d.metricKey),
    ...(input.customMetrics ?? []).map((c) => c.key),
  ];
  for (const k of Object.keys(input.values)) if (!ordered.includes(k)) ordered.push(k);
  const movements: MetricMovement[] = ordered
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

  const ctx = new EvalContext(profile, v, labelOf);
  const rules = m.rules.filter((r) => ruleIsForProfile(r, profile.profileKey));
  const excluded = (r: AnalyticsRuleDef) => r.excludedFor.includes(profile.profileKey);

  // Ratios (§12).
  const ratioMap = new Map<string, RatioCalc>();
  for (const r of rules) {
    if (r.definition.kind !== 'ratio') continue;
    const calc = excluded(r) ? notApplicableRatio(r, ctx) : computeRatio(r, r.definition, ctx);
    ratioMap.set(r.ruleKey, calc);
  }
  const ratios: RatioResult[] = [...ratioMap.values()].map(({ pp: _pp, ...r }) => r);

  // Attention rules (§13, §15).
  const exceptions: DerivedAnalyticsException[] = [];
  const statuses: AnalyticsRuleStatus[] = [];
  const status = (r: AnalyticsRuleDef, outcome: AnalyticsRuleOutcome, reason: string | null) =>
    statuses.push({
      ruleCode: r.ruleCode,
      ruleVersion: r.version,
      ruleKey: r.ruleKey,
      name: r.name,
      kind: r.kind,
      formula: r.formula,
      parameterText: parameterText(r),
      outcome,
      reason,
    });

  for (const r of rules) {
    if (r.definition.kind === 'ratio') {
      const calc = ratioMap.get(r.ruleKey)!;
      status(
        r,
        calc.status === 'calculated'
          ? 'not_flagged'
          : calc.status === 'not_applicable'
            ? 'not_applicable'
            : 'insufficient_data',
        calc.status === 'calculated' ? null : calc.reason,
      );
      continue;
    }
    if (excluded(r)) {
      status(r, 'not_applicable', 'Not meaningful for this industry profile.');
      continue;
    }
    if (!ready) {
      status(r, 'insufficient_data', 'The dataset header is incomplete.');
      continue;
    }
    const dq = dataQualityProblem(r, header.dataStatus ?? null, input.values);
    if (dq) {
      status(r, 'data_quality', dq);
      continue;
    }
    const outcome = evaluateRule(r, r.definition, ctx, ratioMap);
    if (outcome.kind === 'skip') {
      status(r, 'insufficient_data', outcome.reason);
    } else if (outcome.kind === 'quiet') {
      status(r, 'not_flagged', null);
    } else {
      status(r, 'flagged', null);
      const ref = `${r.ruleCode} v${r.version}, ${r.methodologyVersion}; a planning attention parameter, not a materiality threshold`;
      exceptions.push({
        ruleKey: r.ruleKey,
        ruleCode: r.ruleCode,
        ruleVersion: r.version,
        methodologyVersion: r.methodologyVersion,
        kind: r.definition.kind,
        observation: outcome.observation,
        whyFlagged: `${outcome.why} (${ref}).`,
        whyMayMatter: r.whyMayMatter,
        suggestedAttention: outcome.attention,
        affectedAreas: [...r.affectedAreas],
        values: snapshot(ctx.usedMetrics(r), v),
      });
    }
  }

  return {
    methodologyVersion: profile.methodologyVersion,
    profile: profile.profileKey,
    profileLabel: profile.label,
    rules: statuses,
    ready,
    warnings,
    movements,
    ratios,
    exceptions: ready ? exceptions : [],
  };
}

function snapshot(keys: readonly string[], v: Getter): Record<string, number | null> {
  return Object.fromEntries(
    [...new Set(keys)].flatMap((k) => [
      [`${k}_cy`, v(k, 'cy')],
      [`${k}_py`, v(k, 'py')],
    ]),
  );
}

/** §15 minimum data quality: dataset status and the source of the figures used. */
function dataQualityProblem(
  r: AnalyticsRuleDef,
  dataStatus: DatasetStatus | null,
  values: AnalyticsInput['values'],
): string | null {
  if (r.minDataStatus.length && (!dataStatus || !r.minDataStatus.includes(dataStatus))) {
    return `Needs dataset status ${r.minDataStatus.join(' / ')} (dataset is ${dataStatus ?? 'not set'}).`;
  }
  if (r.minSourceTypes.length) {
    for (const k of r.requiredMetrics) {
      const val = values[k];
      for (const [amount, src] of [
        [val?.cy, val?.cySource],
        [val?.py, val?.pySource],
      ] as const) {
        if (amount === null || amount === undefined) continue;
        if (!src || !r.minSourceTypes.includes(src)) {
          return `Needs figures sourced from ${r.minSourceTypes.join(' / ')}.`;
        }
      }
    }
  }
  return null;
}

// ── expressions ──────────────────────────────────────────────────────────────

class EvalContext {
  private readonly used = new Map<string, Set<string>>();
  private current: string | null = null;

  constructor(
    readonly profile: AnalyticsProfileDef,
    readonly v: Getter,
    readonly labelOf: (k: string) => string,
  ) {}

  begin(ruleKey: string): void {
    this.current = ruleKey;
    if (!this.used.has(ruleKey)) this.used.set(ruleKey, new Set());
  }
  touch(key: string): void {
    if (this.current) this.used.get(this.current)!.add(key);
  }
  usedMetrics(r: AnalyticsRuleDef): string[] {
    return [...(this.used.get(r.ruleKey) ?? []), ...r.requiredMetrics];
  }

  /** First base metric with figures in both years, else in either, else the first listed. */
  resolveBase(base: 'inventory_cost' | 'payable_cost' | 'inventory_trend'): string | null {
    const p = this.profile;
    const list =
      base === 'payable_cost'
        ? p.payableCostBases
        : base === 'inventory_cost'
          ? p.inventoryCostBases
          : [
              ...p.inventoryCostBases,
              ...(p.inventoryTrendFallback ? [p.inventoryTrendFallback] : []),
            ];
    const both = list.find((k) => this.v(k, 'cy') !== null && this.v(k, 'py') !== null);
    if (both) return both;
    // The trend fallback is only for a relationship, which needs both years anyway.
    const either = list.find((k) => this.v(k, 'cy') !== null || this.v(k, 'py') !== null);
    return either ?? list[0] ?? null;
  }

  debtLabel(): string {
    return this.profile.debtMetrics.map((k) => this.labelOf(k)).join(' + ');
  }

  label(e: AnalyticsExpr): string {
    if ('metric' in e) return this.labelOf(e.metric);
    if ('debt' in e)
      return this.profile.debtMetrics.length === 1
        ? this.labelOf(this.profile.debtMetrics[0]!)
        : 'Debt';
    if ('base' in e) {
      const b = this.resolveBase(e.base);
      return b ? this.labelOf(b) : 'Cost base';
    }
    return [
      ...e.sum.map((x) => this.label(x)),
      ...(e.less ?? []).map((x) => `− ${this.label(x)}`),
    ].join(' + ');
  }

  /** Metric keys an expression reads (after resolving bases and the debt definition). */
  keys(e: AnalyticsExpr): string[] {
    if ('metric' in e) return [e.metric];
    if ('debt' in e) return [...this.profile.debtMetrics];
    if ('base' in e) {
      const b = this.resolveBase(e.base);
      return b ? [b] : [];
    }
    return [...e.sum, ...(e.less ?? [])].flatMap((x) => this.keys(x));
  }

  /** Closing (or average) value; `notes` collects the basis disclosure. */
  value(e: AnalyticsExpr, period: Period, notes: Set<string>): number | null {
    if ('sum' in e) {
      const plus = e.sum.map((x) => this.value(x, period, notes));
      const minus = (e.less ?? []).map((x) => this.value(x, period, notes));
      if ([...plus, ...minus].every((x) => x === null)) return null;
      return (
        plus.reduce<number>((s, x) => s + (x ?? 0), 0) -
        minus.reduce<number>((s, x) => s + (x ?? 0), 0)
      );
    }
    const keys = this.keys(e);
    if (!keys.length) return null;
    const balance = e.balance ?? 'closing';
    const useAverage =
      balance === 'average'
        ? this.profile.averageBalances
        : balance === 'finance_cost_basis'
          ? this.profile.financeCostBasis === 'average'
          : false;
    let total: number | null = null;
    for (const k of keys) {
      this.touch(k);
      const closing = this.v(k, period);
      if (closing === null) continue;
      let x = closing;
      if (useAverage) {
        const opening =
          period === 'cy' ? this.v(k, 'py') : period === 'py' ? this.v(k, 'pp') : null;
        if (opening !== null) {
          x = (opening + closing) / 2;
          notes.add(`${period.toUpperCase()} on average balance ((opening + closing) / 2)`);
        } else if (period !== 'pp') {
          notes.add(`${period.toUpperCase()} on closing balance — no opening balance available`);
        }
      }
      total = (total ?? 0) + x;
    }
    return total;
  }
}

function notApplicableRatio(r: AnalyticsRuleDef, ctx: EvalContext): RatioCalc {
  const def = r.definition as Extract<AnalyticsRuleDefinition, { kind: 'ratio' }>;
  return {
    key: r.ruleKey,
    label: r.name,
    formula: r.formula,
    unit: def.unit,
    cy: null,
    py: null,
    pp: null,
    status: 'not_applicable',
    reason: 'Not meaningful for this industry profile.',
    ruleCode: r.ruleCode,
    ruleVersion: r.version,
    basisNote: null,
    inputs: inputsOf(def, ctx),
  };
}

function inputsOf(
  def: Extract<AnalyticsRuleDefinition, { kind: 'ratio' }>,
  ctx: EvalContext,
): RatioResult['inputs'] {
  const keys = [
    ...new Set(
      [def.value, def.num, def.den]
        .filter((e): e is AnalyticsExpr => !!e)
        .flatMap((e) => ctx.keys(e)),
    ),
  ];
  return keys.map((k) => ({
    metricKey: k,
    label: ctx.labelOf(k),
    cy: ctx.v(k, 'cy'),
    py: ctx.v(k, 'py'),
  }));
}

function computeRatio(
  r: AnalyticsRuleDef,
  def: Extract<AnalyticsRuleDefinition, { kind: 'ratio' }>,
  ctx: EvalContext,
): RatioCalc {
  ctx.begin(r.ruleKey);
  const notes = new Set<string>();
  const dp = UNIT_DP[def.unit];
  const denPositive = def.denPositive ?? true;

  const calc = (p: Period, n: Set<string>) => {
    if (def.value) {
      const x = ctx.value(def.value, p, n);
      return {
        value: x === null ? null : round(x, dp),
        why: x === null ? ('missing' as const) : null,
      };
    }
    const num = ctx.value(def.num!, p, n);
    const den = ctx.value(def.den!, p, n);
    if (num === null || den === null) return { value: null, why: 'missing' as const };
    if (den === 0 || (denPositive && den < 0)) return { value: null, why: 'nm' as const };
    return { value: round((num / den) * (def.scale ?? 1), dp), why: null };
  };
  const cy = calc('cy', notes);
  const py = calc('py', notes);
  const pp = calc('pp', new Set());
  const any = cy.value !== null || py.value !== null;
  const status: RatioResult['status'] = any
    ? 'calculated'
    : cy.why === 'nm' || py.why === 'nm'
      ? 'not_meaningful'
      : 'insufficient_data';

  // Disclose the basis: cost base chosen, debt definition, average vs closing.
  const exprs = [def.value, def.num, def.den].filter((e): e is AnalyticsExpr => !!e);
  const basis: string[] = [];
  const walk = (e: AnalyticsExpr) => {
    if ('sum' in e) return [...e.sum, ...(e.less ?? [])].forEach(walk);
    if ('base' in e) basis.push(`Cost base: ${ctx.label(e)}`);
    if ('debt' in e) basis.push(`Debt = ${ctx.debtLabel()}`);
  };
  exprs.forEach(walk);
  basis.push(...notes);
  const missingLabels = () => {
    if (def.value) return ctx.label(def.value);
    return `${ctx.label(def.num!)} and ${ctx.label(def.den!)}`;
  };

  return {
    key: r.ruleKey,
    label: r.name,
    formula: r.formula,
    unit: def.unit,
    cy: cy.value,
    py: py.value,
    pp: pp.value,
    status,
    reason:
      status === 'insufficient_data'
        ? `Needs ${missingLabels()}.`
        : status === 'not_meaningful'
          ? `${def.den ? ctx.label(def.den) : 'The denominator'} is zero or negative — ratio not meaningful.`
          : null,
    ruleCode: r.ruleCode,
    ruleVersion: r.version,
    basisNote: basis.length ? [...new Set(basis)].join('; ') : null,
    inputs: inputsOf(def, ctx),
  };
}

type Outcome =
  | { kind: 'skip'; reason: string }
  | { kind: 'quiet' }
  | { kind: 'flag'; observation: string; why: string; attention: PlanningAttention };

function evaluateRule(
  r: AnalyticsRuleDef,
  def: Exclude<AnalyticsRuleDefinition, { kind: 'ratio' }>,
  ctx: EvalContext,
  ratios: Map<string, RatioCalc>,
): Outcome {
  ctx.begin(r.ruleKey);
  const p = r.parameterValue ?? 0;
  const words = (vars: Record<string, string>, template = r.signalWording) =>
    renderWording(template, vars);
  const ratioOf = (key: string): RatioCalc | { unavailable: string } => {
    const x = ratios.get(key);
    if (!x) return { unavailable: `Ratio "${key}" is not in force for this profile.` };
    if (x.status === 'not_applicable')
      return { unavailable: `${x.label} is not applicable for this profile.` };
    x.inputs.forEach((i) => ctx.touch(i.metricKey));
    return x;
  };

  switch (def.kind) {
    case 'movement': {
      const cy = ctx.value({ metric: def.metric }, 'cy', new Set());
      const py = ctx.value({ metric: def.metric }, 'py', new Set());
      const label = ctx.labelOf(def.metric);
      if (cy === null || py === null) return { kind: 'skip', reason: `Needs CY and PY ${label}.` };
      if (py === 0) {
        if (def.newFromNil && cy !== 0) {
          return {
            kind: 'flag',
            observation: words(
              { label, cy: String(cy), py: String(py) },
              def.nilWording ?? r.signalWording,
            ),
            why: 'The figure is new this year (nil in the prior year)',
            attention: r.suggestedAttention,
          };
        }
        return { kind: 'skip', reason: 'Prior year is nil — % movement not meaningful (N/M).' };
      }
      const g = pctChange(cy, py)!;
      if (Math.abs(g) < p) return { kind: 'quiet' };
      return {
        kind: 'flag',
        observation: words({
          label,
          change: fmtPct(g),
          cy: String(round(cy, 2)),
          py: String(round(py, 2)),
        }),
        why: `Movement of ${fmtPct(g)} is at or above the planning attention parameter of ${p}%`,
        attention: attentionFor(r, g),
      };
    }

    case 'relationship': {
      const n = new Set<string>();
      const growth = (e: AnalyticsExpr) => pctChange(ctx.value(e, 'cy', n), ctx.value(e, 'py', n));
      const ga = growth(def.a);
      const gb = growth(def.b);
      if (ga === null || gb === null) {
        return {
          kind: 'skip',
          reason: `Needs CY and PY ${ctx.label(def.a)} and ${ctx.label(def.b)} (PY not nil).`,
        };
      }
      const gap = ga - gb;
      if (def.oppositeDirection && Math.sign(ga) === Math.sign(gb)) return { kind: 'quiet' };
      if (Math.abs(gap) < p) return { kind: 'quiet' };
      const aLabel = ctx.label(def.a);
      const bLabel = ctx.label(def.b);
      const fallback = [def.a, def.b].some(
        (e) =>
          'base' in e &&
          e.base === 'inventory_trend' &&
          ctx.resolveBase(e.base) === ctx.profile.inventoryTrendFallback,
      );
      const why =
        (def.oppositeDirection
          ? `The two moved in opposite directions, diverging by ${round(Math.abs(gap))} percentage points (relationship attention parameter ${p} points)`
          : `Growth rates diverge by ${round(Math.abs(gap))} percentage points, at or above the relationship attention parameter of ${p} points`) +
        (fallback
          ? `; no cost base was available, so ${bLabel.toLowerCase()} is used under the profile’s fallback`
          : '');
      return {
        kind: 'flag',
        observation: words({
          a: aLabel,
          b: bLabel,
          aLower: aLabel.toLowerCase(),
          bLower: bLabel.toLowerCase(),
          ga: fmtPct(ga),
          gb: fmtPct(gb),
          gap: String(round(Math.abs(gap))),
          fasterSlower: ga > gb ? 'materially faster' : 'materially slower',
        }),
        why,
        attention: attentionFor(r, gap),
      };
    }

    case 'ratio_shift': {
      const x = ratioOf(def.ratio);
      if ('unavailable' in x) return { kind: 'skip', reason: x.unavailable };
      if (x.cy === null || x.py === null)
        return { kind: 'skip', reason: `Needs ${x.label} for both years.` };
      const d = x.cy - x.py;
      if (Math.abs(d) < p) return { kind: 'quiet' };
      return {
        kind: 'flag',
        observation: words({
          label: x.label,
          cy: withUnit(x.cy, x.unit),
          py: withUnit(x.py, x.unit),
          delta: deltaWithUnit(d, x.unit),
        }),
        why: `A shift of ${round(Math.abs(d), UNIT_DP[x.unit])} ${unitWord(x.unit)} is at or above the ratio attention parameter of ${p} ${unitWord(x.unit)}`,
        attention: attentionFor(r, d),
      };
    }

    case 'ratio_change': {
      const x = ratioOf(def.ratio);
      if ('unavailable' in x) return { kind: 'skip', reason: x.unavailable };
      if (x.cy === null || x.py === null)
        return { kind: 'skip', reason: `Needs ${x.label} for both years.` };
      const change = pctChange(x.cy, x.py);
      const crossed =
        def.crossBelow !== undefined && x.cy < def.crossBelow && x.py >= def.crossBelow;
      if (!crossed && (change === null || Math.abs(change) < p)) return { kind: 'quiet' };
      const vars = {
        label: x.label,
        cy: withUnit(x.cy, x.unit),
        py: withUnit(x.py, x.unit),
        change: change === null ? 'N/M' : fmtPct(change),
        level: String(def.crossBelow ?? ''),
      };
      let attention = change === null ? r.suggestedAttention : attentionFor(r, change);
      if (crossed) attention = maxAttention(attention, def.crossAttention ?? r.suggestedAttention);
      return {
        kind: 'flag',
        observation: words(vars, crossed ? (def.crossWording ?? r.signalWording) : r.signalWording),
        why: crossed
          ? `The ratio fell below the configured level of ${def.crossBelow}`
          : `The ratio moved ${fmtPct(change!)}, at or above the ${p}% attention parameter`,
        attention,
      };
    }

    case 'trend_reversal': {
      const x = ratioOf(def.ratio);
      if ('unavailable' in x) return { kind: 'skip', reason: x.unavailable };
      if (x.cy === null || x.py === null)
        return { kind: 'skip', reason: `Needs ${x.label} for both years.` };
      if (x.pp === null) {
        return {
          kind: 'skip',
          reason:
            'Needs the prior-year comparatives from last year’s audit file (PY−1) to establish a trend.',
        };
      }
      const d1 = x.py - x.pp;
      const d2 = x.cy - x.py;
      if (Math.sign(d1) === Math.sign(d2) || Math.abs(d1) < p || Math.abs(d2) < p)
        return { kind: 'quiet' };
      return {
        kind: 'flag',
        observation: words({
          label: x.label,
          pp: withUnit(x.pp, x.unit),
          py: withUnit(x.py, x.unit),
          cy: withUnit(x.cy, x.unit),
          dir1: d1 > 0 ? 'rose' : 'fell',
          dir2: d2 > 0 ? 'rose' : 'fell',
        }),
        why: `The ratio moved at least ${p} ${unitWord(x.unit)} in each of the last two years, in opposite directions (trend attention parameter)`,
        attention: attentionFor(r, Math.min(Math.abs(d1), Math.abs(d2))),
      };
    }

    case 'threshold': {
      let value: number | null;
      let label: string;
      let shown: string;
      if (def.ratio) {
        const x = ratioOf(def.ratio);
        if ('unavailable' in x) return { kind: 'skip', reason: x.unavailable };
        value = x.cy;
        label = x.label;
        shown = value === null ? '' : withUnit(value, x.unit);
      } else {
        const key = def.metric!;
        value = ctx.value({ metric: key }, 'cy', new Set());
        label = ctx.labelOf(key);
        shown = value === null ? '' : String(round(value, 2));
      }
      if (value === null) return { kind: 'skip', reason: `Needs the CY ${label}.` };
      const hit =
        def.op === 'lt'
          ? value < p
          : def.op === 'lte'
            ? value <= p
            : def.op === 'gt'
              ? value > p
              : value >= p;
      if (!hit) return { kind: 'quiet' };
      const opText = { lt: 'below', lte: 'at or below', gt: 'above', gte: 'at or above' }[def.op];
      return {
        kind: 'flag',
        observation: words({ label, value: shown, threshold: String(p) }),
        why: `The figure is ${opText} the configured level of ${p}`,
        attention: r.suggestedAttention,
      };
    }
  }
}

// ── library validation (Methodology Admin) ───────────────────────────────────

const EXPR_KEYS = new Set(['metric', 'debt', 'base', 'sum', 'less', 'balance']);

function exprProblem(e: unknown, metrics: ReadonlySet<string>, depth = 0): string | null {
  if (depth > 4) return 'Expressions are nested too deeply.';
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'An operand must be an object.';
  const o = e as Record<string, unknown>;
  const extra = Object.keys(o).find((k) => !EXPR_KEYS.has(k));
  if (extra) return `Unknown operand field "${extra}".`;
  if (
    o.balance !== undefined &&
    !['closing', 'average', 'finance_cost_basis'].includes(o.balance as string)
  ) {
    return 'balance must be closing, average or finance_cost_basis.';
  }
  if ('metric' in o) {
    if (typeof o.metric !== 'string' || !metrics.has(o.metric))
      return `Unknown metric "${String(o.metric)}".`;
    return null;
  }
  if ('debt' in o) return o.debt === true ? null : 'debt must be true.';
  if ('base' in o) {
    return ['inventory_cost', 'payable_cost', 'inventory_trend'].includes(o.base as string)
      ? null
      : 'base must be inventory_cost, payable_cost or inventory_trend.';
  }
  if ('sum' in o) {
    if (!Array.isArray(o.sum) || o.sum.length === 0) return 'sum needs at least one operand.';
    if (o.less !== undefined && !Array.isArray(o.less)) return 'less must be a list.';
    for (const x of [...o.sum, ...((o.less as unknown[]) ?? [])]) {
      const p = exprProblem(x, metrics, depth + 1);
      if (p) return p;
    }
    return null;
  }
  return 'An operand needs metric, debt, base or sum.';
}

/**
 * Why a rule version cannot be saved, or null. `metrics` are the metric keys in
 * the library; `ratioKind` maps ratio rule keys to their unit (for references).
 */
export function analyticsRuleProblem(
  rule: Pick<
    AnalyticsRuleDef,
    | 'kind'
    | 'definition'
    | 'parameterType'
    | 'parameterValue'
    | 'enhancedAt'
    | 'immediateAt'
    | 'suggestedAttention'
    | 'requiredMetrics'
    | 'minDataStatus'
    | 'minSourceTypes'
    | 'signalWording'
    | 'whyMayMatter'
  >,
  metrics: ReadonlySet<string>,
  ratioKeys: ReadonlySet<string>,
): string | null {
  if (!ANALYTICS_RULE_KINDS.includes(rule.kind)) return `Unknown rule kind "${rule.kind}".`;
  const def = rule.definition as AnalyticsRuleDefinition | undefined;
  if (!def || typeof def !== 'object' || def.kind !== rule.kind) {
    return 'The definition must be an object whose kind matches the rule kind.';
  }
  const bad = rule.requiredMetrics.find((k) => !metrics.has(k));
  if (bad) return `Unknown required metric "${bad}".`;
  if (rule.minDataStatus.some((s) => !DATASET_STATUSES.includes(s)))
    return 'Unknown dataset status.';
  if (rule.minSourceTypes.some((s) => !METRIC_SOURCE_TYPES.includes(s)))
    return 'Unknown source type.';
  if (!PLANNING_ATTENTIONS.includes(rule.suggestedAttention)) return 'Unknown suggested attention.';
  const expr = (e: unknown) => exprProblem(e, metrics);

  if (def.kind === 'ratio') {
    if (!['%', 'days', 'x', 'amount', 'per_unit'].includes(def.unit)) return 'Unknown ratio unit.';
    if (def.value) {
      if (def.num || def.den) return 'A ratio is either a value or num / den, not both.';
      return expr(def.value);
    }
    if (!def.num || !def.den) return 'A ratio needs num and den (or value).';
    if (def.scale !== undefined && !(Number.isFinite(def.scale) && def.scale > 0))
      return 'scale must be > 0.';
    // §12 / §24: inventory and payable days never silently use Revenue. (Working-capital
    // days over a sum of balances are a revenue-based cycle measure and stay allowed.)
    const denKeys = JSON.stringify(def.den);
    const numMetric = 'metric' in def.num ? def.num.metric : null;
    if (
      def.unit === 'days' &&
      /"metric":"revenue"/.test(denKeys) &&
      numMetric &&
      /inventory|payable/.test(numMetric)
    ) {
      return 'Inventory / payable days must use a cost base, never Revenue.';
    }
    return expr(def.num) ?? expr(def.den);
  }

  // Attention rules need a parameter and wording.
  if (rule.parameterType === null || !ATTENTION_PARAMETER_TYPES.includes(rule.parameterType)) {
    return 'An attention rule needs a parameter type.';
  }
  if (rule.parameterValue === null || !Number.isFinite(rule.parameterValue)) {
    return 'An attention rule needs a parameter value.';
  }
  if (def.kind !== 'threshold' && rule.parameterValue < 0)
    return 'The parameter must not be negative.';
  for (const [lvl, name] of [
    [rule.enhancedAt, 'Enhanced'],
    [rule.immediateAt, 'Immediate Partner'],
  ] as const) {
    if (lvl !== null && (!Number.isFinite(lvl) || lvl < 0)) return `${name} level must be ≥ 0.`;
  }
  if (rule.enhancedAt !== null && rule.immediateAt !== null && rule.immediateAt < rule.enhancedAt) {
    return 'The Immediate Partner level must be at or above the Enhanced level.';
  }
  if (!rule.signalWording.trim()) return 'An attention rule needs neutral signal wording.';
  if (!rule.whyMayMatter.trim()) return 'An attention rule needs "why it may matter".';
  // §15: attention parameters are never described as materiality / misstatement / risk conclusions.
  const extraWording = [
    def.kind === 'movement' ? def.nilWording : undefined,
    def.kind === 'ratio_change' ? def.crossWording : undefined,
  ].filter((w): w is string => typeof w === 'string');
  if (extraWording.some((w) => w.length > 1000)) return 'Wording must be at most 1000 characters.';
  const text = [rule.signalWording, rule.whyMayMatter, ...extraWording].join(' ').toLowerCase();
  if (/\bmaterial(ity)?\b|misstat|significant risk|audit risk|\brmm\b/.test(text)) {
    return 'Signal wording must be neutral — no materiality, misstatement or risk conclusions.';
  }

  switch (def.kind) {
    case 'movement':
      return metrics.has(def.metric) ? null : `Unknown metric "${def.metric}".`;
    case 'relationship':
      return expr(def.a) ?? expr(def.b);
    case 'ratio_shift':
    case 'trend_reversal':
      return ratioKeys.has(def.ratio) ? null : `Unknown ratio "${def.ratio}".`;
    case 'ratio_change':
      if (!ratioKeys.has(def.ratio)) return `Unknown ratio "${def.ratio}".`;
      if (def.crossAttention && !PLANNING_ATTENTIONS.includes(def.crossAttention))
        return 'Unknown cross attention.';
      return null;
    case 'threshold':
      if (!['lt', 'lte', 'gt', 'gte'].includes(def.op)) return 'op must be lt, lte, gt or gte.';
      if (!!def.metric === !!def.ratio) return 'A threshold reads exactly one metric or ratio.';
      if (def.metric && !metrics.has(def.metric)) return `Unknown metric "${def.metric}".`;
      if (def.ratio && !ratioKeys.has(def.ratio)) return `Unknown ratio "${def.ratio}".`;
      return null;
  }
}
