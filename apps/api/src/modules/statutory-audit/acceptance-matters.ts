import {
  ACCEPTANCE_MATTER_CATEGORY,
  ELIGIBILITY_CHECKS,
  acceptanceSource,
  answerLabel,
  isExceptionAnswer,
  questionByKey,
  type AcceptanceDetails,
  type AcceptanceMatterCategory,
  type MatterSeverityLevel,
} from '@hsdg/contracts';
import type { DerivedMatter } from './matters-generation';

/**
 * Acceptance Matters derivation (spec §11). Pure and deterministic — mirrors the
 * framework matters generator so it unit-tests without a database and upserts
 * idempotently by `source`.
 *
 * Matters come from the answers themselves: an exception answer (and, where
 * the spec says so, the severity / impact / conclusion recorded with it)
 * raises a matter with a back-link to its question. When the answer changes
 * the matter is no longer emitted and the service closes it automatically.
 * The description is auto-populated from what was recorded.
 */

export interface AcceptanceAnswerInput {
  segmentKey: string;
  questionKey: string;
  answer: string | null;
  details?: AcceptanceDetails;
}

interface MatterShape {
  category: AcceptanceMatterCategory;
  severity: MatterSeverityLevel;
  isBlocking: boolean;
}

type Rule = (a: AcceptanceAnswerInput) => (MatterShape & { title?: string; sub?: string })[];

const C = ACCEPTANCE_MATTER_CATEGORY;

/** Matter for an exception answer to one of the earlier Yes / No checks. */
const legacy =
  (shape: MatterShape): Rule =>
  (a) => {
    const q = questionByKey(a.questionKey);
    return q && isExceptionAnswer(q, a.answer) ? [shape] : [];
  };

/**
 * APP-05 checklist row marked Issue (spec §5): "any issue creates an
 * Acceptance Matter". Its weight follows the conclusion recorded on the row —
 * a resolved issue stays on the register for the record; one awaiting the
 * Partner, or barring the appointment, blocks acceptance.
 */
const eligibilityIssue: Rule = (a) => {
  if (a.answer !== 'issue') return [];
  const label = ELIGIBILITY_CHECKS.find(([k]) => k === a.questionKey)?.[1] ?? a.questionKey;
  const what = detailText(a.details, 'description') ?? 'issue identified';
  const title = `Eligibility — ${label}: ${what}`;
  switch (a.details?.conclusion) {
    case 'resolved':
      return [{ category: C.eligibility, severity: 'medium', isBlocking: false, title }];
    case 'cannot_accept':
      return [{ category: C.eligibility, severity: 'critical', isBlocking: true, title }];
    default:
      return [{ category: C.eligibility, severity: 'high', isBlocking: true, title }];
  }
};

/**
 * Per-question rules. A question with no rule raises no matter (e.g. EP-01's
 * correction is put right on the master, it is not an acceptance concern).
 */
const RULES: Record<string, Rule> = {
  ...Object.fromEntries(ELIGIBILITY_CHECKS.map(([k]) => [k, eligibilityIssue])),
  communication_sent: legacy({ category: C.previousAuditor, severity: 'high', isBlocking: true }),
  no_professional_objection: legacy({
    category: C.previousAuditor,
    severity: 'high',
    isBlocking: true,
  }),
  management_integrity_concern: legacy({
    category: C.integrity,
    severity: 'high',
    isBlocking: true,
  }),
  resources_competence: legacy({ category: C.resources, severity: 'high', isBlocking: true }),
  independence_threats: legacy({ category: C.independence, severity: 'high', isBlocking: true }),
  prohibited_services: legacy({ category: C.independence, severity: 'critical', isBlocking: true }),
  acceptable_framework: legacy({
    category: C.preconditions,
    severity: 'critical',
    isBlocking: true,
  }),
  management_responsibilities: legacy({
    category: C.preconditions,
    severity: 'critical',
    isBlocking: true,
  }),
  no_scope_limitation: legacy({ category: C.scope, severity: 'high', isBlocking: true }),
};

/** First non-empty text detail among `keys`, for the matter description. */
export function detailText(
  details: AcceptanceDetails | undefined,
  ...keys: string[]
): string | null {
  for (const k of keys) {
    const v = details?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function titleFor(a: AcceptanceAnswerInput, override?: string): string {
  const q = questionByKey(a.questionKey);
  if (!q) return override ?? a.questionKey;
  const head = `${q.code ? `${q.code} ` : ''}${q.prompt.replace(/[.?]$/, '')}`;
  const said =
    detailText(a.details, 'explanation', 'description', 'matter', 'matterCommunicated') ??
    answerLabel(q, a.answer);
  return override ?? `${head} — ${said}`;
}

export function deriveAcceptanceMatters(
  answers: readonly AcceptanceAnswerInput[],
): DerivedMatter[] {
  const out: DerivedMatter[] = [];
  for (const a of answers) {
    const base = a.questionKey.split(':')[0]!;
    const rule = RULES[base];
    if (!rule) continue;
    for (const m of rule(a)) {
      out.push({
        source: acceptanceSource(a.segmentKey, a.questionKey, m.sub),
        category: m.category,
        severity: m.severity,
        isBlocking: m.isBlocking,
        title: titleFor(a, m.title).slice(0, 500),
      });
    }
  }
  return out;
}
