import {
  ACCEPTANCE_MATTER_CATEGORY,
  ACCEPTANCE_METHODOLOGY,
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
 * PA-05 "Yes" (spec §6): the previous auditor communicated a matter. It is
 * always on the register; its weight follows the Impact on Acceptance.
 */
const previousAuditorMatter: Rule = (a) => {
  if (a.answer !== 'yes') return [];
  const shape = (severity: MatterSeverityLevel, isBlocking: boolean) => [
    { category: C.previousAuditor, severity, isBlocking },
  ];
  switch (a.details?.impact) {
    case 'no_impact':
      return shape('low', false);
    case 'safeguard':
      return shape('medium', false);
    case 'partner_review':
      return shape('high', true);
    case 'should_not_accept':
      return shape('critical', true);
    default: // further information required, or impact not yet assessed
      return shape('high', true);
  }
};

/** A matter for each listed answer: [category, severity, blocking]. */
const when =
  (byAnswer: Record<string, [AcceptanceMatterCategory, MatterSeverityLevel, boolean]>): Rule =>
  (a) => {
    const hit = a.answer != null ? byAnswer[a.answer] : undefined;
    return hit ? [{ category: hit[0], severity: hit[1], isBlocking: hit[2] }] : [];
  };

/** ACC-03 scope limitation, weighted by its potential effect (spec §7.2). */
const scopeLimitation: Rule = (a) => {
  if (a.answer !== 'yes') return [];
  switch (a.details?.effect) {
    case 'minor':
      return [{ category: C.scope, severity: 'low', isBlocking: false }];
    case 'may_prevent':
      return [{ category: C.scope, severity: 'critical', isBlocking: true }];
    default:
      return [{ category: C.scope, severity: 'high', isBlocking: true }];
  }
};

/**
 * Per-question rules. A question with no rule raises no matter (e.g. EP-01's
 * correction is put right on the master, it is not an acceptance concern).
 */
const RULES: Record<string, Rule> = {
  ...Object.fromEntries(ELIGIBILITY_CHECKS.map(([k]) => [k, eligibilityIssue])),
  pa_05: previousAuditorMatter,
  acc_01: when({ yes: [C.integrity, 'high', true] }),
  acc_02: when({ yes: [C.integrity, 'high', true], pending: [C.integrity, 'medium', false] }),
  acc_03: scopeLimitation,
  acc_04: when({ no: [C.resources, 'high', true] }),
  acc_05: when({
    yes: ACCEPTANCE_METHODOLOGY.feeMattersNeedPartnerReview
      ? [C.fee, 'high', true]
      : [C.fee, 'medium', false],
  }),
  acc_06: when({ yes: [C.other, 'medium', false] }),
  acc_conclusion: when({
    partner_attention: [C.other, 'high', true],
    do_not_accept: [C.other, 'critical', true],
  }),
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
    detailText(a.details, 'explanation', 'description', 'matter', 'matterCommunicated', 'basis') ??
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
