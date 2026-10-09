import { FRAMEWORK_MATTER_CATEGORY } from '@hsdg/contracts';

/**
 * Framework Matters derivation engine (Implementation Guide §10). Pure and
 * deterministic — mirrors the work-generation.ts precedent so it can be
 * unit-tested without a database and upserted idempotently by `source`.
 *
 * Matters are GENERATED from the framework assessment states, never re-entered:
 *   • an OVERRIDE                       → a `framework_override` matter (documented,
 *                                          non-blocking) so the override is tracked.
 *   • a `pending_information` state     → an `information_pending` matter that
 *                                          BLOCKS approval (a deciding fact is missing).
 *   • a `professional_judgement_required` state → a `technical_judgment` matter
 *                                          (needs professional input; non-blocking).
 *
 * Decided/approved areas produce no matter; when a source condition clears, the
 * previously-derived matter is no longer emitted and the service auto-closes it.
 */

/** The assessment facts the derivation reads (a subset of the assessment row). */
export interface FrameworkMatterInput {
  areaKey: string;
  title: string;
  state: string;
  isOverridden: boolean;
}

/**
 * A matter the engine says SHOULD exist for the current states. Shared by the
 * framework and acceptance derivations so both feed the one reconcile path (§10).
 */
export interface DerivedMatter {
  /** Stable idempotency key (UNIQUE per workflow instance). */
  source: string;
  /** Section-specific classification (FrameworkMatterCategory or acceptance category). */
  category: string;
  isBlocking: boolean;
  /** Acceptance severity (low|medium|high|critical); null for framework matters. */
  severity?: string | null;
  /** One-line description for the Matters panel. */
  title: string;
}

export function deriveFrameworkMatters(areas: readonly FrameworkMatterInput[]): DerivedMatter[] {
  const out: DerivedMatter[] = [];
  for (const a of areas) {
    if (a.isOverridden) {
      out.push({
        source: `framework:${a.areaKey}:override`,
        category: FRAMEWORK_MATTER_CATEGORY.frameworkOverride,
        isBlocking: false,
        title: `${a.title}: professional conclusion overrides the system suggestion.`,
      });
    }
    if (a.state === 'pending_information') {
      out.push({
        source: `framework:${a.areaKey}:information`,
        category: FRAMEWORK_MATTER_CATEGORY.informationPending,
        isBlocking: true,
        title: `${a.title}: a deciding fact is missing — capture it before approval.`,
      });
    } else if (a.state === 'professional_judgement_required') {
      out.push({
        source: `framework:${a.areaKey}:judgment`,
        category: FRAMEWORK_MATTER_CATEGORY.technicalJudgment,
        isBlocking: false,
        title: `${a.title}: no safe rule applies — professional judgement required.`,
      });
    }
  }
  return out;
}

/** The 02.2 row facts the Framework Review derivation reads. */
export interface FinancialReportingMatterInput {
  state: string;
  conclusion: string | null;
  /** The engine marked the result specialised / further assessment (spec §19). */
  blocking_review: boolean;
  partner_approved: boolean;
  professional_action: string | null;
  pending_reason: string | null;
}

/**
 * 02.2 matters (Section 02.2 spec §15, §19):
 *   • a specialised / further-assessment result → a BLOCKING Framework Review,
 *     open until the conclusion is recorded AND Partner-approved;
 *   • an FRF-05 "Information Pending" conclusion → a BLOCKING information matter
 *     naming the missing fact.
 * When the condition clears the reconcile path auto-closes the matter.
 */
export function deriveFinancialReportingMatters(
  row: FinancialReportingMatterInput | null,
): DerivedMatter[] {
  if (!row) return [];
  const out: DerivedMatter[] = [];
  const decided = ['applicable', 'not_applicable', 'overridden', 'approved'].includes(row.state);
  if (row.blocking_review && !(decided && row.conclusion && row.partner_approved)) {
    out.push({
      source: 'framework:02.2:review',
      category: FRAMEWORK_MATTER_CATEGORY.blocking,
      isBlocking: true,
      title:
        '02.2 Financial Reporting Framework: specialised / further assessment — Framework Review open until concluded and Partner-approved.',
    });
  }
  if (row.professional_action === 'information_pending') {
    out.push({
      source: 'framework:02.2:information',
      category: FRAMEWORK_MATTER_CATEGORY.informationPending,
      isBlocking: true,
      title: `02.2 Financial Reporting Framework: information pending — ${row.pending_reason ?? 'a deciding fact is missing'}.`,
    });
  }
  return out;
}
