import { ACCEPTANCE_QUESTIONS, type AcceptanceQuestionDefinition } from '@hsdg/contracts';
import type { DerivedMatter } from './matters-generation';

/**
 * Acceptance Matters derivation engine (Implementation Guide §8.4, §10). Pure and
 * deterministic — mirrors the framework matters/work-generation precedent so it
 * unit-tests without a database and upserts idempotently by `source`.
 *
 * A question answered with its `adverseAnswer` raises a matter carrying the
 * question's category/severity/blocking classification and a `source` back-link
 * to the segment + question. When the answer changes away from the adverse value
 * the matter is no longer emitted and the service auto-closes it.
 */

export interface AcceptanceAnswerInput {
  segmentKey: string;
  questionKey: string;
  answer: string | null;
}

/** Index the methodology question catalogue by `${segmentKey}:${questionKey}`. */
const QUESTION_BY_KEY = new Map<string, AcceptanceQuestionDefinition>(
  ACCEPTANCE_QUESTIONS.map((q) => [`${q.segmentKey}:${q.questionKey}`, q]),
);

export function deriveAcceptanceMatters(
  answers: readonly AcceptanceAnswerInput[],
): DerivedMatter[] {
  const out: DerivedMatter[] = [];
  for (const a of answers) {
    const q = QUESTION_BY_KEY.get(`${a.segmentKey}:${a.questionKey}`);
    if (!q) continue;
    if (a.answer !== q.adverseAnswer) continue;
    out.push({
      source: `acceptance:${q.segmentKey}:${q.questionKey}`,
      category: q.category,
      severity: q.severity,
      isBlocking: q.isBlocking,
      title: `${q.prompt} — adverse response requires action/safeguard.`,
    });
  }
  return out;
}
