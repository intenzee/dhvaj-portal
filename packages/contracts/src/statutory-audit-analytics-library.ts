/**
 * Statutory Audit — 03.2 Analytics Methodology Library (DHVAJ 03.2 §12, §15,
 * §17, §23).
 *
 * The preliminary analytics methodology is versioned DATA, not code: canonical
 * metric definitions, industry analytics profiles and analytics rules (ratios
 * and attention rules) are maintained by the Methodology Admin without a
 * deployment. Every change appends a version effective from a date; the
 * version in force on the audit period end is used, and an Investigation Card
 * keeps the rule code + version it was raised under.
 *
 * Attention parameters only surface matters for the auditor to investigate.
 * They are NOT materiality thresholds and never evidence of misstatement or of
 * a significant risk (§15).
 */

import type { PlanningAttention } from './statutory-audit-planning-signal';
import type { DatasetStatus, MetricSourceType } from './statutory-audit-planning-analytics';

/** Versioning fields shared by every row of the library. */
export interface AnalyticsLibraryVersioning {
  version: number;
  /** ISO dates; `effectiveTo` inclusive, null = open-ended. */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** false = retired / disabled from `effectiveFrom`. */
  active: boolean;
  methodologyVersion: string;
}

/** Audit columns on a library row as the admin screen lists it. */
export interface AnalyticsLibraryAudit {
  id: string;
  changeNote: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Fields every "append a version" request carries. */
export interface AnalyticsLibraryVersionInput {
  effectiveFrom?: string;
  effectiveTo?: string | null;
  active?: boolean;
  methodologyVersion?: string;
  /** Why this version was made (required — methodology changes are controlled). */
  changeNote: string;
}

// ── Canonical metric definitions (03.2.7) ────────────────────────────────────

/**
 * What a figure measures. Only `amount` figures are converted between units
 * (₹ / ₹ lakh / …); a headcount or a percentage is never scaled.
 */
export const METRIC_VALUE_TYPE = { amount: 'amount', count: 'count', percent: 'percent' } as const;
export type MetricValueType = (typeof METRIC_VALUE_TYPE)[keyof typeof METRIC_VALUE_TYPE];
export const METRIC_VALUE_TYPES: MetricValueType[] = Object.values(METRIC_VALUE_TYPE);
export const METRIC_VALUE_TYPE_LABEL: Record<MetricValueType, string> = {
  amount: 'Amount',
  count: 'Count',
  percent: 'Percentage',
};

export interface AnalyticsMetricDef extends AnalyticsLibraryVersioning {
  /** Canonical metric id — a future TB module populates this same id. */
  metricKey: string;
  label: string;
  valueType: MetricValueType;
  /** Core = expected for every entity the metric applies to. */
  core: boolean;
  note: string;
  /** Industry profile keys the metric is offered for; empty = every profile. */
  appliesTo: string[];
  sortOrder: number;
}

export interface AnalyticsMetricRecord extends AnalyticsMetricDef, AnalyticsLibraryAudit {}

export interface CreateAnalyticsMetricVersionInput extends AnalyticsLibraryVersionInput {
  metricKey: string;
  label: string;
  /** Fixed by the first version. */
  valueType: MetricValueType;
  core?: boolean;
  note?: string;
  appliesTo?: string[];
  sortOrder?: number;
}

// ── Industry analytics profiles (§17) ────────────────────────────────────────

export const FINANCE_COST_BASIS = { average: 'average', closing: 'closing' } as const;
export type FinanceCostBasis = (typeof FINANCE_COST_BASIS)[keyof typeof FINANCE_COST_BASIS];
export const FINANCE_COST_BASES: FinanceCostBasis[] = Object.values(FINANCE_COST_BASIS);

export interface AnalyticsProfileDef extends AnalyticsLibraryVersioning {
  profileKey: string;
  label: string;
  description: string;
  /** Sub-industry taxonomy offered in 03.2.3 (an "Other" free text is always allowed). */
  subIndustries: string[];
  /** System-suggested industry considerations for 03.2.3 (the Manager confirms). */
  considerations: string[];
  /** Day ratios on average balances (opening = prior-year closing) when available. */
  averageBalances: boolean;
  /** Metrics summed as "debt" for debt-to-equity and the finance-cost relationship. */
  debtMetrics: string[];
  /** Finance cost is related to average or closing debt; always disclosed. */
  financeCostBasis: FinanceCostBasis;
  /** Ordered cost bases for inventory days (first one with figures wins). Never revenue. */
  inventoryCostBases: string[];
  /** Ordered bases for payable days. Never revenue. */
  payableCostBases: string[];
  /**
   * The basis the revenue-vs-inventory relationship falls back to when no cost
   * base has figures (e.g. `revenue`), or null to not evaluate it. Disclosed.
   */
  inventoryTrendFallback: string | null;
}

export interface AnalyticsProfileRecord extends AnalyticsProfileDef, AnalyticsLibraryAudit {}

export interface CreateAnalyticsProfileVersionInput extends AnalyticsLibraryVersionInput {
  profileKey: string;
  label: string;
  description?: string;
  subIndustries?: string[];
  considerations?: string[];
  averageBalances?: boolean;
  debtMetrics: string[];
  financeCostBasis: FinanceCostBasis;
  inventoryCostBases: string[];
  payableCostBases: string[];
  inventoryTrendFallback?: string | null;
}

/** A profile as offered in the 03.2 industry-profile selector. */
export interface AnalyticsProfileOption {
  key: string;
  label: string;
  description: string;
}

// ── Analytics rules (§12, §13, §15) ──────────────────────────────────────────

/**
 * `ratio` rows define a calculated ratio (§12); every other kind is an
 * attention rule that may surface an exception (§13, §15).
 */
export const ANALYTICS_RULE_KIND = {
  ratio: 'ratio',
  /** Single-line CY/PY % movement of one metric. */
  movement: 'movement',
  /** Growth of two figures diverges by ≥ the parameter (percentage points). */
  relationship: 'relationship',
  /** A ratio moves by ≥ the parameter in its own unit (points / days / ×). */
  ratioShift: 'ratio_shift',
  /** A ratio changes by ≥ the parameter %, or crosses a configured level. */
  ratioChange: 'ratio_change',
  /** A ratio reverses its prior-year direction (needs the prior file's PY). */
  trendReversal: 'trend_reversal',
  /** A metric or ratio is beyond a configured level. */
  threshold: 'threshold',
} as const;
export type AnalyticsRuleKind = (typeof ANALYTICS_RULE_KIND)[keyof typeof ANALYTICS_RULE_KIND];
export const ANALYTICS_RULE_KINDS: AnalyticsRuleKind[] = Object.values(ANALYTICS_RULE_KIND);
export const ANALYTICS_RULE_KIND_LABEL: Record<AnalyticsRuleKind, string> = {
  ratio: 'Ratio',
  movement: 'Movement',
  relationship: 'Relationship',
  ratio_shift: 'Ratio shift',
  ratio_change: 'Ratio change',
  trend_reversal: 'Trend reversal',
  threshold: 'Threshold',
};
/** Attention-rule kinds (everything but `ratio`). */
export type AnalyticsExceptionKind = Exclude<AnalyticsRuleKind, 'ratio'>;

/** What the attention parameter measures (§15). */
export const ATTENTION_PARAMETER_TYPE = {
  absolute: 'absolute',
  percent: 'percent',
  ratio: 'ratio',
  trend: 'trend',
  relationship: 'relationship',
} as const;
export type AttentionParameterType =
  (typeof ATTENTION_PARAMETER_TYPE)[keyof typeof ATTENTION_PARAMETER_TYPE];
export const ATTENTION_PARAMETER_TYPES: AttentionParameterType[] =
  Object.values(ATTENTION_PARAMETER_TYPE);
export const ATTENTION_PARAMETER_TYPE_LABEL: Record<AttentionParameterType, string> = {
  absolute: 'Absolute level',
  percent: '% movement',
  ratio: 'Ratio shift',
  trend: 'Trend',
  relationship: 'Relationship gap (points)',
};

/** Which balance a metric operand uses. */
export type AnalyticsBalance = 'closing' | 'average' | 'finance_cost_basis';

/**
 * A calculation operand:
 *  - `{metric}` — a metric (closing balance unless `balance` says otherwise:
 *    `average` = average of opening and closing when the profile asks for
 *    average balances; `finance_cost_basis` = the profile's finance-cost basis);
 *  - `{debt: true}` — the profile's debt definition (sum of its debt metrics);
 *  - `{base}` — the profile's ordered cost base (first metric with figures);
 *  - `{sum, less}` — Σ sum − Σ less (missing terms are skipped; all missing = null).
 */
export type AnalyticsExpr =
  | { metric: string; balance?: AnalyticsBalance }
  | { debt: true; balance?: AnalyticsBalance }
  | { base: 'inventory_cost' | 'payable_cost' | 'inventory_trend'; balance?: AnalyticsBalance }
  | { sum: AnalyticsExpr[]; less?: AnalyticsExpr[] };

export type RatioUnit = '%' | 'days' | 'x' | 'amount' | 'per_unit';

/** `definition` per kind. */
export type AnalyticsRuleDefinition =
  | {
      kind: 'ratio';
      /** num / den × scale; or `value` for an amount. */
      num?: AnalyticsExpr;
      den?: AnalyticsExpr;
      value?: AnalyticsExpr;
      scale?: number;
      unit: RatioUnit;
      /** Denominator must be > 0 to be meaningful (default true). */
      denPositive?: boolean;
    }
  | {
      kind: 'movement';
      metric: string;
      /** Also flag a figure that is new this year (PY nil). Uses `nilWording`. */
      newFromNil?: boolean;
      nilWording?: string;
    }
  | {
      kind: 'relationship';
      a: AnalyticsExpr;
      b: AnalyticsExpr;
      /** Only flag when the two move in opposite directions. */
      oppositeDirection?: boolean;
    }
  | { kind: 'ratio_shift'; ratio: string }
  | {
      kind: 'ratio_change';
      ratio: string;
      /** Also flag when the ratio falls below this level (from at/above it). */
      crossBelow?: number;
      crossAttention?: PlanningAttention;
      crossWording?: string;
    }
  | { kind: 'trend_reversal'; ratio: string }
  | {
      kind: 'threshold';
      metric?: string;
      ratio?: string;
      op: 'lt' | 'lte' | 'gt' | 'gte';
    };

export interface AnalyticsRuleDef extends AnalyticsLibraryVersioning {
  /** Stable rule id, e.g. `PAR-004`. */
  ruleCode: string;
  /** Stable machine key (cards, 03.5 tags and ratio references use it). */
  ruleKey: string;
  name: string;
  kind: AnalyticsRuleKind;
  /** Industry profile keys the rule is for; empty = generic (every profile). */
  appliesTo: string[];
  /** Profiles for which the rule is not meaningful (shown as not applicable). */
  excludedFor: string[];
  /** Canonical metric ids the rule needs. */
  requiredMetrics: string[];
  /** Transparent human formula. */
  formula: string;
  definition: AnalyticsRuleDefinition;
  parameterType: AttentionParameterType | null;
  /** The attention parameter (null for ratio rows). */
  parameterValue: number | null;
  /** Suggest Enhanced Attention at/above this size (parameter units). */
  enhancedAt: number | null;
  /** Suggest Immediate Partner Attention at/above this size (parameter units). */
  immediateAt: number | null;
  /** Minimum data quality: dataset statuses allowed (empty = any). */
  minDataStatus: DatasetStatus[];
  /** Minimum data quality: figure sources allowed for the required metrics (empty = any). */
  minSourceTypes: MetricSourceType[];
  /** Neutral, factual observation template ({{placeholders}}). */
  signalWording: string;
  /** Methodology explanation of why it may matter. */
  whyMayMatter: string;
  /** Suggested (editable) affected FS areas — never a final area decision. */
  affectedAreas: string[];
  /** Base suggested attention (raised by `enhancedAt` / `immediateAt`). */
  suggestedAttention: PlanningAttention;
}

export interface AnalyticsRuleRecord extends AnalyticsRuleDef, AnalyticsLibraryAudit {}

export interface CreateAnalyticsRuleVersionInput extends AnalyticsLibraryVersionInput {
  ruleCode: string;
  /** Required for a new code; fixed thereafter. */
  ruleKey?: string;
  name: string;
  /** Fixed by the first version. */
  kind: AnalyticsRuleKind;
  appliesTo?: string[];
  excludedFor?: string[];
  requiredMetrics?: string[];
  formula: string;
  definition: AnalyticsRuleDefinition;
  parameterType?: AttentionParameterType | null;
  parameterValue?: number | null;
  enhancedAt?: number | null;
  immediateAt?: number | null;
  minDataStatus?: DatasetStatus[];
  minSourceTypes?: MetricSourceType[];
  signalWording?: string;
  whyMayMatter?: string;
  affectedAreas?: string[];
  suggestedAttention?: PlanningAttention;
}

/** The whole library (every version) for the Methodology Admin screen. */
export interface AnalyticsLibrary {
  metrics: AnalyticsMetricRecord[];
  profiles: AnalyticsProfileRecord[];
  rules: AnalyticsRuleRecord[];
}

// ── What a 03.2 file runs on ─────────────────────────────────────────────────

/** How one rule in force fared on this file's figures (transparency, §12). */
export type AnalyticsRuleOutcome =
  'flagged' | 'not_flagged' | 'not_applicable' | 'insufficient_data' | 'data_quality';

export interface AnalyticsRuleStatus {
  ruleCode: string;
  ruleVersion: number;
  ruleKey: string;
  name: string;
  kind: AnalyticsRuleKind;
  formula: string;
  /** e.g. `≥ 25% movement (Enhanced ≥ 50)`; null for ratios. */
  parameterText: string | null;
  outcome: AnalyticsRuleOutcome;
  reason: string | null;
}

/** The methodology a 03.2 file is running on (shown in 03.2.7 / 03.2.8). */
export interface AnalyticsMethodologySummary {
  profileKey: string;
  profileLabel: string;
  profileVersion: number;
  methodologyVersion: string;
  /** The date the in-force versions were resolved on (audit period end, or today). */
  resolvedOn: string;
  averageBalances: boolean;
  debtDefinition: string;
  financeCostBasis: FinanceCostBasis;
  /** Metrics offered in the dataset grid for this profile, in order. */
  metrics: Array<{
    key: string;
    label: string;
    note: string;
    core: boolean;
    valueType: MetricValueType;
  }>;
  /**
   * Investigation cards raised under an older rule version than the one in
   * force — "Refresh analytics" re-runs them on the current methodology.
   */
  staleCards: number;
}
