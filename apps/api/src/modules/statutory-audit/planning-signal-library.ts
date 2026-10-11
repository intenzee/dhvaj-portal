import { createHash } from 'node:crypto';
import {
  PLANNING_ATTENTIONS,
  PLANNING_DESTINATIONS,
  type PlanningAttention,
  type PlanningDestination,
  type PlanningSignalSource,
} from '@hsdg/contracts';

/**
 * 03.1 Planning Signal Library engine (DHVAJ 03.1 §5, §8, §21) — pure and
 * DB-free. The rules live in `hsdg.planning_signal_rule` (insert-only
 * versions); this module evaluates them over the flat {@link PlanningFacts}
 * map that `planning-intelligence-facts.ts` builds from the CONFIRMED Section
 * 01/02 records. A signal is a pointer to a fact, never a risk conclusion.
 */

export type FactValue = boolean | number | string | readonly string[] | null;
export type PlanningFacts = Readonly<Record<string, FactValue>>;

export type RuleCondition =
  | { fact: string; op: 'truthy' }
  | { fact: string; op: 'eq'; value: string | number | boolean }
  | { fact: string; op: 'in'; value: readonly string[] }
  | { fact: string; op: 'gt'; value: number }
  | { all: readonly RuleCondition[] }
  | { any: readonly RuleCondition[] }
  | { not: RuleCondition };

export type RuleTriggerSource = 'section_01' | 'section_02' | 'current_year_change';

export interface PlanningSignalRule {
  ruleCode: string;
  version: number;
  ruleKey: string;
  name: string;
  triggerSource: RuleTriggerSource;
  triggerSection: string;
  condition: RuleCondition;
  conditionVersion: number;
  observationTemplate: string;
  whyMayMatter: string;
  potentialImplications: string;
  guidanceAnchors: readonly string[];
  destinations: readonly PlanningDestination[];
  suggestedAttention: PlanningAttention;
  sourceLink: string | null;
  /** ISO dates; `effectiveTo` inclusive, null = open-ended. */
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}

/** A signal proposed by a library rule, keyed by its stable rule key (upsert). */
export interface DerivedSignal {
  ruleKey: string;
  ruleCode: string;
  ruleVersion: number;
  source: PlanningSignalSource;
  sourceSection: string;
  observation: string;
  whyMayMatter: string;
  potentialImplications: string;
  suggestedAttention: PlanningAttention;
  destinations: PlanningDestination[];
  guidanceAnchors: string[];
  sourceLink: string | null;
}

// ── conditions ──────────────────────────────────────────────────────────────

/** A fact "holds": true, a positive number, a non-empty string or list. */
export function isTruthy(v: FactValue | undefined): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'number') return v > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return v === true;
}

export function evaluateCondition(cond: RuleCondition, facts: PlanningFacts): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, facts));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, facts));
  if ('not' in cond) return !evaluateCondition(cond.not, facts);
  const v = facts[cond.fact];
  switch (cond.op) {
    case 'truthy':
      return isTruthy(v);
    case 'eq':
      return v === cond.value;
    case 'in':
      if (Array.isArray(v)) return v.some((x) => cond.value.includes(x));
      return typeof v === 'string' && cond.value.includes(v);
    case 'gt':
      return typeof v === 'number' && v > cond.value;
    default:
      return false;
  }
}

const OPS = new Set(['truthy', 'eq', 'in', 'gt']);
const FACT_KEY = /^[a-z][a-z0-9_]{0,59}$/;

/**
 * Validate an untrusted condition (admin "add version"). Returns the first
 * problem, or null when the condition is well-formed. Depth-limited.
 */
export function conditionProblem(raw: unknown, depth = 0): string | null {
  if (depth > 6) return 'Condition is nested too deeply.';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'A condition must be an object.';
  }
  const c = raw as Record<string, unknown>;
  const keys = Object.keys(c);
  if ('all' in c || 'any' in c) {
    const list = c.all ?? c.any;
    if (keys.length !== 1 || !Array.isArray(list) || list.length === 0) {
      return '"all" / "any" takes a non-empty list of conditions.';
    }
    for (const child of list) {
      const p = conditionProblem(child, depth + 1);
      if (p) return p;
    }
    return null;
  }
  if ('not' in c) {
    if (keys.length !== 1) return '"not" takes one condition.';
    return conditionProblem(c.not, depth + 1);
  }
  if (typeof c.fact !== 'string' || !FACT_KEY.test(c.fact)) {
    return 'Each test needs a "fact" name (lower_snake_case).';
  }
  if (typeof c.op !== 'string' || !OPS.has(c.op)) {
    return '"op" must be one of truthy, eq, in, gt.';
  }
  if (c.op === 'truthy') return keys.length === 2 ? null : '"truthy" takes no value.';
  if (c.op === 'eq') {
    return ['string', 'number', 'boolean'].includes(typeof c.value)
      ? null
      : '"eq" needs a string, number or boolean value.';
  }
  if (c.op === 'in') {
    return Array.isArray(c.value) &&
      c.value.length > 0 &&
      c.value.every((x) => typeof x === 'string')
      ? null
      : '"in" needs a non-empty list of strings.';
  }
  return typeof c.value === 'number' && Number.isFinite(c.value) ? null : '"gt" needs a number.';
}

/** Every fact a condition reads (admin preview / docs). */
export function conditionFacts(cond: RuleCondition): string[] {
  if ('all' in cond) return [...new Set(cond.all.flatMap(conditionFacts))];
  if ('any' in cond) return [...new Set(cond.any.flatMap(conditionFacts))];
  if ('not' in cond) return conditionFacts(cond.not);
  return [cond.fact];
}

// ── templates ───────────────────────────────────────────────────────────────

function formatFact(v: FactValue | undefined): string {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.filter((x) => String(x).trim()).join(', ');
  if (v === true) return 'yes';
  return String(v).trim();
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/**
 * Render `{{fact}}` placeholders. A `[[ … ]]` segment is dropped entirely when
 * any placeholder inside it renders empty — "[[ ({{provider}})]]" disappears
 * when no provider is recorded, so the sentence never shows "()".
 */
export function renderTemplate(template: string, facts: PlanningFacts): string {
  const withOptional = template.replace(/\[\[([\s\S]*?)\]\]/g, (_, inner: string) => {
    let empty = false;
    const out = inner.replace(PLACEHOLDER, (__, key: string) => {
      const s = formatFact(facts[key]);
      if (!s) empty = true;
      return s;
    });
    return empty ? '' : out;
  });
  return withOptional
    .replace(PLACEHOLDER, (_, key: string) => formatFact(facts[key]))
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── versions ────────────────────────────────────────────────────────────────

/**
 * The version of each rule code in force on `on` (ISO date): active, inside its
 * effective window, highest version wins. A retired code (latest in-window
 * version inactive) yields nothing.
 */
export function effectiveRules(
  rules: readonly PlanningSignalRule[],
  on: string,
): PlanningSignalRule[] {
  const best = new Map<string, PlanningSignalRule>();
  for (const r of rules) {
    if (r.effectiveFrom > on || (r.effectiveTo !== null && r.effectiveTo < on)) continue;
    const cur = best.get(r.ruleCode);
    if (!cur || r.version > cur.version) best.set(r.ruleCode, r);
  }
  return [...best.values()]
    .filter((r) => r.active)
    .sort((a, b) => a.ruleCode.localeCompare(b.ruleCode));
}

const SOURCE_OF: Record<RuleTriggerSource, PlanningSignalSource> = {
  section_01: 'section_01',
  section_02: 'section_02',
  current_year_change: 'current_year_change',
};

function toSignal(rule: PlanningSignalRule, facts: PlanningFacts): DerivedSignal {
  return {
    ruleKey: rule.ruleKey,
    ruleCode: rule.ruleCode,
    ruleVersion: rule.version,
    source: SOURCE_OF[rule.triggerSource],
    sourceSection: rule.triggerSection,
    observation: renderTemplate(rule.observationTemplate, facts),
    whyMayMatter: rule.whyMayMatter,
    potentialImplications: rule.potentialImplications,
    suggestedAttention: rule.suggestedAttention,
    destinations: [...rule.destinations],
    guidanceAnchors: [...rule.guidanceAnchors],
    sourceLink: rule.sourceLink,
  };
}

/**
 * Derive the 03.1.1 Engagement Intelligence signals: every Section 01/02 rule
 * in force on `on` whose condition holds. Only configured, applicable facts
 * produce a signal (spec acceptance test).
 */
export function deriveEngagementSignals(
  rules: readonly PlanningSignalRule[],
  facts: PlanningFacts,
  on: string,
): DerivedSignal[] {
  return effectiveRules(rules, on)
    .filter((r) => r.triggerSource !== 'current_year_change')
    .filter((r) => evaluateCondition(r.condition, facts))
    .map((r) => toSignal(r, facts));
}

/**
 * The category-specific signal a PI-01 change raises (§6), or null when no
 * change rule is in force for the category.
 */
export function deriveChangeSignal(
  rules: readonly PlanningSignalRule[],
  change: { category: string; label: string; description: string | null },
  on: string,
): DerivedSignal | null {
  const facts: PlanningFacts = {
    change_category: change.category,
    change_label: change.label,
    change_description: change.description,
  };
  const rule = effectiveRules(rules, on).find(
    (r) => r.triggerSource === 'current_year_change' && evaluateCondition(r.condition, facts),
  );
  return rule ? toSignal(rule, facts) : null;
}

/** JSON with object keys sorted at every depth (jsonb reorders keys on storage). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Stable hash of the facts — a different value means Section 01/02 moved. */
export function factsFingerprint(facts: PlanningFacts): string {
  const sorted = Object.keys(facts)
    .sort()
    .map((k) => [k, facts[k]]);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

/** Shape-check a rule row read from the DB (defensive: bad config never fires). */
export function isUsableRule(r: PlanningSignalRule): boolean {
  return (
    PLANNING_ATTENTIONS.includes(r.suggestedAttention) &&
    r.destinations.every((d) => PLANNING_DESTINATIONS.includes(d)) &&
    conditionProblem(r.condition) === null
  );
}
