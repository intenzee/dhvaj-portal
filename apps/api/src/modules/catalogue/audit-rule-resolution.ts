import type {
  AuditRuleBandRecord,
  MeasurementBasis,
  ResolvedRule,
  RuleOperator,
  RuleResolver,
  RuleUnit,
} from '@hsdg/contracts';

/**
 * Pure resolution helpers for the Audit Rules Library (Implementation Guide §4.3).
 * Kept free of DB access so effective-date selection and the "historical freeze /
 * future change affects future only" behaviour are unit-tested without a database
 * (mirrors framework-suggestions.spec.ts).
 */

/** The minimal shape effective-date selection needs from a rule version. */
export interface EffectiveDated {
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Select the version in force for an audit period: `effective_from <= start` AND
 * (`effective_to IS NULL` OR `effective_to > start`), taking the highest
 * `effective_from`. Returns null when no version covers the period (the caller
 * then reports Information Insufficient — never a guess). ISO `YYYY-MM-DD`
 * strings compare correctly lexicographically.
 */
export function selectRuleVersion<T extends EffectiveDated>(
  versions: readonly T[],
  auditPeriodStart: string,
): T | null {
  let chosen: T | null = null;
  for (const v of versions) {
    const covers =
      v.effectiveFrom <= auditPeriodStart &&
      (v.effectiveTo == null || v.effectiveTo > auditPeriodStart);
    if (!covers) continue;
    if (chosen == null || v.effectiveFrom > chosen.effectiveFrom) chosen = v;
  }
  return chosen;
}

/** A flattened rule+version row as loaded from the Rules Library for a period. */
export interface ResolvableRuleVersion {
  ruleId: string;
  ruleCode: string;
  areaKey: string;
  entityClass: string | null;
  criterion: string;
  operator: RuleOperator;
  unit: RuleUnit;
  measurementBasis: MeasurementBasis | null;
  ruleVersionId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  threshold: number | null;
  thresholdHigh: number | null;
  outcome: string | null;
  authorityProvisionId: string | null;
  guidanceReference: string | null;
  bands: AuditRuleBandRecord[];
}

const key = (areaKey: string, criterion: string, entityClass: string | null): string =>
  `${areaKey}|${criterion}|${entityClass ?? ''}`;

function toResolved(r: ResolvableRuleVersion): ResolvedRule {
  return {
    ruleId: r.ruleId,
    ruleCode: r.ruleCode,
    ruleVersionId: r.ruleVersionId,
    version: r.version,
    areaKey: r.areaKey,
    entityClass: r.entityClass,
    criterion: r.criterion,
    operator: r.operator,
    unit: r.unit,
    threshold: r.threshold,
    thresholdHigh: r.thresholdHigh,
    measurementBasis: r.measurementBasis,
    outcome: r.outcome,
    effectiveFrom: r.effectiveFrom,
    authorityProvisionId: r.authorityProvisionId,
    guidanceReference: r.guidanceReference,
    bands: r.bands,
  };
}

/**
 * Build a synchronous, pure {@link RuleResolver} from the versions that already
 * cover the audit period (one already picked per rule via {@link selectRuleVersion}).
 * Lookup prefers an entity-class-specific rule, then falls back to a class-agnostic
 * one (`entity_class IS NULL`), so a general threshold applies unless a class
 * override exists. Returns null when the library holds nothing for the criterion.
 */
export function buildResolver(rows: readonly ResolvableRuleVersion[]): RuleResolver {
  const byKey = new Map<string, ResolvableRuleVersion>();
  for (const r of rows) byKey.set(key(r.areaKey, r.criterion, r.entityClass), r);
  return (areaKey, criterion, entityClass) => {
    const specific =
      entityClass != null ? byKey.get(key(areaKey, criterion, entityClass)) : undefined;
    const chosen = specific ?? byKey.get(key(areaKey, criterion, null));
    return chosen ? toResolved(chosen) : null;
  };
}
