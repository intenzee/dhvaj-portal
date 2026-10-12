/**
 * Statutory Audit — 03.3 Materiality Methodology Library (DHVAJ 03.3 §8, §19,
 * §23).
 *
 * DHVAJ's materiality methodology is versioned DATA maintained by the
 * Methodology Admin (holders of service.manage) — never code and never the
 * UI. A rule offers guidance only: the possible benchmark, optional percentage
 * guidance, considerations, its source / technical basis and when it applies
 * (industry profile, entity circumstance). Selecting outside the guidance is
 * permitted with a rationale and raises Partner Attention (the override rule).
 * SA 320 prescribes no benchmark or percentage; the Methodology Admin cannot
 * conclude engagement materiality.
 */

import type {
  AnalyticsLibraryAudit,
  AnalyticsLibraryVersionInput,
  AnalyticsLibraryVersioning,
} from './statutory-audit-analytics-library';

export const MATERIALITY_RULE_KIND = {
  omBenchmark: 'om_benchmark',
  pm: 'pm',
  ctt: 'ctt',
  attention: 'attention',
  rounding: 'rounding',
} as const;
export type MaterialityRuleKind =
  (typeof MATERIALITY_RULE_KIND)[keyof typeof MATERIALITY_RULE_KIND];
export const MATERIALITY_RULE_KINDS: MaterialityRuleKind[] = Object.values(MATERIALITY_RULE_KIND);
export const MATERIALITY_RULE_KIND_LABEL: Record<MaterialityRuleKind, string> = {
  om_benchmark: 'Overall materiality benchmark',
  pm: 'Performance materiality',
  ctt: 'Clearly trivial threshold',
  attention: 'Attention parameter',
  rounding: 'Rounding step',
};

/** The attention parameters a rule of kind `attention` sets. */
export const MATERIALITY_ATTENTION_CRITERION = {
  pyChange: 'py_change',
  volatility: 'volatility',
  nearBreakeven: 'near_breakeven',
} as const;
export type MaterialityAttentionCriterion =
  (typeof MATERIALITY_ATTENTION_CRITERION)[keyof typeof MATERIALITY_ATTENTION_CRITERION];
export const MATERIALITY_ATTENTION_CRITERIA: MaterialityAttentionCriterion[] = Object.values(
  MATERIALITY_ATTENTION_CRITERION,
);
export const MATERIALITY_ATTENTION_CRITERION_LABEL: Record<MaterialityAttentionCriterion, string> =
  {
    py_change: 'Change from prior-year materiality (%)',
    volatility: 'Benchmark year-on-year movement (%)',
    near_breakeven: 'Near break-even — PBT as % of revenue',
  };

/**
 * The override rule: what a selection outside the guidance raises. Every
 * override raises Partner Attention; `immediate_partner` also raises the §19
 * "Manager overrides an Immediate Partner Attention methodology prompt".
 */
export const MATERIALITY_OVERRIDE_ATTENTION = {
  partnerAttention: 'partner_attention',
  immediatePartner: 'immediate_partner',
} as const;
export type MaterialityOverrideAttention =
  (typeof MATERIALITY_OVERRIDE_ATTENTION)[keyof typeof MATERIALITY_OVERRIDE_ATTENTION];
export const MATERIALITY_OVERRIDE_ATTENTIONS: MaterialityOverrideAttention[] = Object.values(
  MATERIALITY_OVERRIDE_ATTENTION,
);
export const MATERIALITY_OVERRIDE_ATTENTION_LABEL: Record<MaterialityOverrideAttention, string> = {
  partner_attention: 'Partner Attention',
  immediate_partner: 'Immediate Partner Attention',
};

/** Entity circumstance a rule can apply to besides the 02.1 special entity types. */
export const MATERIALITY_CIRCUMSTANCE_INITIAL_AUDIT = 'initial_audit';

/** A methodology-defined candidate built from a 03.2 canonical metric. */
export type MetricBenchmarkKey = `metric:${string}`;
export const METRIC_BENCHMARK_PREFIX = 'metric:';
export const METRIC_BENCHMARK_KEY_PATTERN = /^metric:[a-z][a-z0-9_]{1,59}$/;
export const isMetricBenchmark = (key: string | null | undefined): key is MetricBenchmarkKey =>
  !!key && METRIC_BENCHMARK_KEY_PATTERN.test(key);

export interface MaterialityMethodologyRuleDef extends AnalyticsLibraryVersioning {
  /** MMR-001 … — stable across versions. */
  ruleCode: string;
  kind: MaterialityRuleKind;
  name: string;
  /** om_benchmark only: a built-in candidate key or `metric:<metric_key>`. */
  benchmarkKey: string | null;
  /** The candidate's label (required for a metric benchmark). */
  benchmarkLabel: string | null;
  /** attention only. */
  attentionCriterion: MaterialityAttentionCriterion | null;
  /** Optional percentage guidance (om_benchmark: % of benchmark; pm / ctt: % of OM). */
  lowPct: number | null;
  highPct: number | null;
  /** attention: the parameter (%); rounding: the step (₹). */
  parameterValue: number | null;
  /** 03.2 industry profiles; empty = every profile. */
  industryProfiles: string[];
  /** 02.1 special entity types or `initial_audit`; empty = every file. */
  circumstances: string[];
  considerations: string[];
  sourceBasis: string;
  /** Placeholder awaiting DHVAJ formal approval. */
  provisional: boolean;
  overrideAttention: MaterialityOverrideAttention;
}

export interface MaterialityMethodologyRuleRecord
  extends MaterialityMethodologyRuleDef, AnalyticsLibraryAudit {}

export interface CreateMaterialityRuleVersionInput extends AnalyticsLibraryVersionInput {
  ruleCode: string;
  /** Fixed by the first version. */
  kind: MaterialityRuleKind;
  name: string;
  benchmarkKey?: string | null;
  benchmarkLabel?: string | null;
  attentionCriterion?: MaterialityAttentionCriterion | null;
  lowPct?: number | null;
  highPct?: number | null;
  parameterValue?: number | null;
  industryProfiles?: string[];
  circumstances?: string[];
  considerations?: string[];
  sourceBasis: string;
  provisional?: boolean;
  overrideAttention?: MaterialityOverrideAttention;
}

/** Every version of every rule, for the Methodology Admin screen. */
export interface MaterialityMethodologyLibrary {
  rules: MaterialityMethodologyRuleRecord[];
}

/** Human description of where a rule applies. */
export function materialityRuleApplicability(
  rule: Pick<MaterialityMethodologyRuleDef, 'industryProfiles' | 'circumstances'>,
): string {
  const parts: string[] = [];
  if (rule.industryProfiles.length) parts.push(`Profile: ${rule.industryProfiles.join(', ')}`);
  if (rule.circumstances.length) {
    parts.push(`Circumstance: ${rule.circumstances.join(', ').replace(/_/g, ' ')}`);
  }
  return parts.join(' · ') || 'All entities';
}
