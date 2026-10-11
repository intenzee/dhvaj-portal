import {
  PLANNING_SIGNAL_STATUS,
  type PlanningAttention,
  type PlanningChangeCategory,
  type PlanningConsiderationKind,
  type PlanningSignalStatus,
} from '@hsdg/contracts';
import { effectiveVersions, type VersionedLibraryRule } from './planning-signal-library';

/**
 * 03.1 §13.2–13.3 — pure, DB-free deriver of STRATEGIC timing and resource
 * considerations from the Planning Signal Register.
 *
 * The rules are configuration (§21): versioned rows of the Strategic
 * Consideration Library (hsdg.planning_consideration_rule), maintained by the
 * Managing Partner / administrator. Considerations only say WHY timing or
 * resources may matter. They never carry dates (03.11) or named people /
 * specialist scope (03.8). Each points at the signal that prompted it and the
 * library version it came from, so the strategy stays traceable (§22).
 */

/** The register facts the deriver reads. */
export interface ConsiderationSignalFact {
  id: string;
  ruleKey: string | null;
  /** Category of the PI-01 change that raised the signal, if any. */
  changeCategory: PlanningChangeCategory | null;
  attention: PlanningAttention;
  status: PlanningSignalStatus;
}

/** One version of a Strategic Consideration Library rule, as the engine reads it. */
export interface PlanningConsiderationRule extends VersionedLibraryRule {
  /** Stable idempotency key of the generated consideration — never changes per code. */
  considerationKey: string;
  kind: PlanningConsiderationKind;
  label: string;
  basis: string;
  /** A signal fires the rule when ANY listed rule key, change category or attention matches. */
  matchRuleKeys: readonly string[];
  matchChangeCategories: readonly string[];
  matchAttention: readonly PlanningAttention[];
}

export interface DerivedConsideration {
  /** Stable idempotency key (upsert-by-key). */
  key: string;
  kind: PlanningConsiderationKind;
  label: string;
  basis: string;
  /** The prompting signal. */
  signalId: string;
  ruleCode: string;
  ruleVersion: number;
}

export function considerationRuleMatches(
  rule: PlanningConsiderationRule,
  s: ConsiderationSignalFact,
): boolean {
  return (
    (s.ruleKey !== null && rule.matchRuleKeys.includes(s.ruleKey)) ||
    (s.changeCategory !== null && rule.matchChangeCategories.includes(s.changeCategory)) ||
    rule.matchAttention.includes(s.attention)
  );
}

/**
 * Derive the strategic timing/resource considerations prompted by the active
 * (non-closed) signals, using the library version of each rule in force on
 * `on` (the audit period end). One consideration per rule, in rule-code order,
 * linked to the first matching signal in register order.
 */
export function deriveStrategicConsiderations(
  rules: readonly PlanningConsiderationRule[],
  signals: readonly ConsiderationSignalFact[],
  on: string,
): DerivedConsideration[] {
  const active = signals.filter((s) => s.status !== PLANNING_SIGNAL_STATUS.closed);
  const out: DerivedConsideration[] = [];
  const seen = new Set<string>();
  for (const rule of effectiveVersions(rules, on)) {
    // Two codes may not share a key (the admin service refuses it); be defensive anyway.
    if (seen.has(rule.considerationKey)) continue;
    const prompt = active.find((s) => considerationRuleMatches(rule, s));
    if (!prompt) continue;
    seen.add(rule.considerationKey);
    out.push({
      key: rule.considerationKey,
      kind: rule.kind,
      label: rule.label,
      basis: rule.basis,
      signalId: prompt.id,
      ruleCode: rule.ruleCode,
      ruleVersion: rule.version,
    });
  }
  return out;
}
