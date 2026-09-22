/**
 * Audit Rules Library (Implementation Guide §4) — foundational subsystem #1.
 *
 * The single source of every statutory number, ratio, effective date and
 * exemption condition used by the Section 02 framework engines. NO statutory
 * number lives in code (guide §1): the engines resolve a rule by the
 * engagement's audit period through a `RuleResolver`, and render the actual
 * value/limit/operator used in their basis string.
 *
 * Modelled on the `compliance` effective-dated, append-only, version-frozen
 * precedent (`ComplianceRuleVersionRecord`): editing a threshold creates a NEW
 * version with a new `effectiveFrom`; prior versions are never mutated, so a
 * future change affects future periods only and never rewrites history.
 */

/** Comparison operator a rule applies to a measured fact. */
export const RULE_OPERATOR = {
  gte: '>=',
  gt: '>',
  lte: '<=',
  lt: '<',
  eq: '==',
  between: 'between',
} as const;
export type RuleOperator = (typeof RULE_OPERATOR)[keyof typeof RULE_OPERATOR];
export const RULE_OPERATORS: RuleOperator[] = Object.values(RULE_OPERATOR);

/** Unit a threshold is expressed in. */
export const RULE_UNIT = {
  inr: 'inr',
  percent: 'percent',
  boolean: 'boolean',
  date: 'date',
} as const;
export type RuleUnit = (typeof RULE_UNIT)[keyof typeof RULE_UNIT];
export const RULE_UNITS: RuleUnit[] = Object.values(RULE_UNIT);

/**
 * How the deciding fact is measured. A CARO borrowing test measures the peak at
 * any point in the year; an Ind AS net-worth test uses the standalone audited
 * FS. The engine honours the basis; it never assumes year-end.
 */
export const MEASUREMENT_BASIS = {
  standaloneAuditedFs: 'standalone_audited_fs',
  balanceSheetDate: 'balance_sheet_date',
  atAnyPointInYear: 'at_any_point_in_year',
  section198NetProfit: 'section_198_net_profit',
  caroBasis: 'caro_measurement_basis',
} as const;
export type MeasurementBasis = (typeof MEASUREMENT_BASIS)[keyof typeof MEASUREMENT_BASIS];
export const MEASUREMENT_BASES: MeasurementBasis[] = Object.values(MEASUREMENT_BASIS);

/**
 * The criteria the framework engines measure against. Shared with the Rules
 * Library seed so (areaKey, criterion, entityClass) tuples line up exactly.
 */
export const RULE_CRITERION = {
  netWorth: 'net_worth',
  paidUpCapital: 'paid_up_capital',
  /** Paid-up capital + reserves & surplus (e.g. the CARO 2020 private-company test). */
  capitalAndReserves: 'capital_and_reserves',
  borrowings: 'borrowings',
  revenue: 'revenue',
  turnover: 'turnover',
  deposits: 'deposits',
  netProfit: 'net_profit',
  /** Ownership % control presumption (e.g. AS 21 / Ind AS 110 consolidation). */
  controlOwnership: 'control_ownership',
  /** Ownership % significant-influence presumption (e.g. AS 23 / Ind AS 28). */
  significantInfluenceOwnership: 'significant_influence_ownership',
  /** Overall managerial-remuneration ceiling as a % of Section 198 net profit (§197). */
  managerialRemunerationPercent: 'managerial_remuneration_percent',
  /** Fraud amount at/above which the Central Government route applies (§143(12)). */
  fraudReportingThreshold: 'fraud_reporting_threshold',
  /** Days to seek the Board/Audit-Committee reply on a reported fraud (Rule 13). */
  boardReplyDays: 'board_reply_days',
  /** Days to forward the fraud report to the Central Government after the reply (Rule 13). */
  cgForwardDays: 'cg_forward_days',
  /** Books/audit-trail preservation period in years (Sec 128(5)). */
  retentionYears: 'retention_years',
} as const;
export type RuleCriterion = (typeof RULE_CRITERION)[keyof typeof RULE_CRITERION];
export const RULE_CRITERIA: RuleCriterion[] = Object.values(RULE_CRITERION);

/** A band row where a rule carries a table (e.g. Schedule V remuneration ceilings). */
export interface AuditRuleBandRecord {
  id: string;
  auditRuleVersionId: string;
  /** Inclusive lower bound of the band (unit per the parent rule). */
  lower: number | null;
  /** Exclusive upper bound (null = open-ended). */
  upper: number | null;
  ceilingValue: number | null;
  label: string | null;
  sortOrder: number;
}

/** One effective-dated, append-only calculation snapshot for an audit rule. */
export interface AuditRuleVersionRecord {
  id: string;
  auditRuleId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Primary threshold; `between` also uses `thresholdHigh`. */
  threshold: number | null;
  thresholdHigh: number | null;
  /** Structured extra conditions the engine consults. */
  condition: unknown | null;
  /** The outcome when the rule fires, e.g. 'applicable' | 'ind_as'. */
  outcome: string | null;
  authorityProvisionId: string | null;
  guidanceReference: string | null;
  notes: string | null;
  createdAt: string;
  bands: AuditRuleBandRecord[];
}

/** An audit applicability rule with its version history. Firm-wide config. */
export interface AuditRuleRecord {
  id: string;
  /** Unique stable code, e.g. 'INDAS_NETWORTH', 'CARO_PVT_REVENUE'. */
  code: string;
  /** Owning framework area (matches FRAMEWORK_AREA_KEY values). */
  areaKey: string;
  /** Optional entity-class dimension, e.g. 'nbfc' | 'private' | 'public'; null = any. */
  entityClass: string | null;
  criterion: string;
  operator: RuleOperator;
  unit: RuleUnit;
  measurementBasis: MeasurementBasis | null;
  isActive: boolean;
  version: number;
  versions: AuditRuleVersionRecord[];
  createdAt: string;
  updatedAt: string;
}

/** The methodology bundle frozen onto an engagement at framework approval. */
export interface AuditRulesetVersionRecord {
  id: string;
  methodologyVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

/**
 * The result of resolving a rule for an audit period. Carries the ACTUAL rule
 * used so an engine can render a fully-traceable basis string and freeze the
 * version onto its conclusion. `bands` is populated for band-table rules.
 */
export interface ResolvedRule {
  ruleId: string;
  ruleCode: string;
  ruleVersionId: string;
  version: number;
  areaKey: string;
  entityClass: string | null;
  criterion: string;
  operator: RuleOperator;
  unit: RuleUnit;
  threshold: number | null;
  thresholdHigh: number | null;
  measurementBasis: MeasurementBasis | null;
  outcome: string | null;
  effectiveFrom: string;
  authorityProvisionId: string | null;
  guidanceReference: string | null;
  bands: AuditRuleBandRecord[];
}

/**
 * The pure, injectable resolver the framework engines depend on (guide §4.4).
 * Returns the rule version in force for the audit period, or `null` when the
 * library holds no version covering the period — the engine then reports
 * "Information Insufficient" and never guesses.
 *
 * Passing this in (rather than reading a DB inside the engine) keeps every
 * engine pure and deterministic: unit tests supply a fixture resolver, exactly
 * as `framework-suggestions.spec.ts` already runs without a database.
 */
export type RuleResolver = (
  areaKey: string,
  criterion: string,
  entityClass?: string | null,
) => ResolvedRule | null;

/** One crore in rupees — a display/unit constant, never a statutory threshold. */
const CRORE_IN_RUPEES = 10_000_000;

/** Render rupees as "₹X.XX cr" for human-readable, traceable basis strings. */
export function formatInrCrore(rupees: number): string {
  return `₹${(rupees / CRORE_IN_RUPEES).toFixed(2)} cr`;
}

/**
 * Apply a resolved rule's operator to a measured value, so the comparison
 * itself is driven by library data (not a hard-coded operator). `between` uses
 * both bounds. Returns false when the threshold is absent.
 */
export function ruleMeets(
  value: number,
  rule: Pick<ResolvedRule, 'operator' | 'threshold' | 'thresholdHigh'>,
): boolean {
  const t = rule.threshold;
  if (t == null) return false;
  switch (rule.operator) {
    case '>=':
      return value >= t;
    case '>':
      return value > t;
    case '<=':
      return value <= t;
    case '<':
      return value < t;
    case '==':
      return value === t;
    case 'between':
      return rule.thresholdHigh != null && value >= t && value <= rule.thresholdHigh;
    default:
      return false;
  }
}

/**
 * Derive the Indian audit-period start date from an engagement financial year
 * label like `2023-24` → `2023-04-01`. Used to resolve rules by period.
 */
export function auditPeriodStartFromFinancialYear(financialYear: string): string {
  const startYear = financialYear.slice(0, 4);
  return `${startYear}-04-01`;
}
