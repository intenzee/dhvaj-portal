import {
  ACCEPTANCE_MATTER_CATEGORY,
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
 * Per-question rules. A question with no rule raises no matter (e.g. EP-01's
 * correction is put right on the master, it is not an acceptance concern).
 */
const RULES: Record<string, Rule> = {
  properly_appointed: legacy({ category: C.appointment, severity: 'critical', isBlocking: true }),
  eligible_141: legacy({ category: C.eligibility, severity: 'critical', isBlocking: true }),
  within_ceiling: legacy({ category: C.eligibility, severity: 'high', isBlocking: true }),
  communication_sent: legacy({ category: C.previousAuditor, severity: 'high', isBlocking: true }),
  no_professional_objection: legacy({
    category: C.previousAuditor,
    severity: 'high',
    isBlocking: true,
  }),
  management_integrity_concern: legacy({ category: C.integrity, severity: 'high', isBlocking: true }),
  resources_competence: legacy({ category: C.resources, severity: 'high', isBlocking: true }),
  independence_threats: legacy({ category: C.independence, severity: 'high', isBlocking: true }),
  prohibited_services: legacy({ category: C.independence, severity: 'critical', isBlocking: true }),
  acceptable_framework: legacy({ category: C.preconditions, severity: 'critical', isBlocking: true }),
  management_responsibilities: legacy({
    category: C.preconditions,
    severity: 'critical',
    isBlocking: true,
  }),
  no_scope_limitation: legacy({ category: C.scope, severity: 'high', isBlocking: true }),
  engagement_letter_issued: legacy({ category: C.other, severity: 'medium', isBlocking: true }),
  client_acknowledged: legacy({ category: C.other, severity: 'medium', isBlocking: false }),
};

/** First non-empty text detail among `keys`, for the matter description. */
export function detailText(details: AcceptanceDetails | undefined, ...keys: string[]): string | null {
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
