import { WORK_AREA_BLUEPRINT, type FrameworkConclusion, type WorkAreaKey } from '@hsdg/contracts';

/**
 * Framework → Work-Area generation engine (Audit Spec §20). Pure and
 * deterministic — mirrors the framework-suggestions precedent so it can be
 * unit-tested without a database.
 *
 * It maps the APPROVED framework applicability conclusions to the set of
 * applicable work areas (§20 "APPROVED FRAMEWORK → APPLICABLE WORK AREAS"). The
 * same conclusions always yield the same work areas, which is what makes
 * generation idempotent (§20, §36): the service upserts this plan by
 * work_area_key, so re-running never duplicates and only diffs against what
 * already exists.
 */

/** The approved conclusion for one framework area, keyed by its machine key. */
export type FrameworkConclusionMap = ReadonlyMap<string, FrameworkConclusion>;

/** One work area the engine wants to exist, with its provenance. */
export interface WorkAreaPlanEntry {
  workAreaKey: WorkAreaKey;
  title: string;
  scope: string;
  /** Provenance string, e.g. `framework:caro` (§20). */
  source: string;
  /** The framework area key that triggered it. */
  originAreaKey: string;
  sortOrder: number;
}

/**
 * Compute the applicable work areas from the approved framework conclusions.
 * A blueprint entry activates only when its trigger area concludes `applicable`.
 * Entries that share a work_area_key (rule_11 / section_143 → the single
 * auditor's-reporting workstream) are deduplicated, keeping the first match so
 * the result is stable regardless of which trigger fired.
 */
export function planWorkAreas(conclusions: FrameworkConclusionMap): WorkAreaPlanEntry[] {
  const byKey = new Map<WorkAreaKey, WorkAreaPlanEntry>();
  for (const entry of WORK_AREA_BLUEPRINT) {
    if (conclusions.get(entry.triggerAreaKey) !== 'applicable') continue;
    if (byKey.has(entry.workAreaKey)) continue; // first trigger wins — stable, no dup
    byKey.set(entry.workAreaKey, {
      workAreaKey: entry.workAreaKey,
      title: entry.title,
      scope: entry.scope,
      source: `framework:${entry.triggerAreaKey}`,
      originAreaKey: entry.triggerAreaKey,
      sortOrder: entry.sortOrder,
    });
  }
  return [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}
