import { PLANNING_ITEM_DONE_STATES, type PlanningItemState } from '@hsdg/contracts';

/**
 * Pure helpers for Planning (§21) and Risk (§22) — deterministic and DB-free so
 * they can be unit-tested in isolation (the framework-suggestions precedent).
 */

/** How many planning sub-areas are not yet complete (0 ⇒ ready to approve). */
export function incompletePlanningCount(states: readonly PlanningItemState[]): number {
  return states.filter((s) => !PLANNING_ITEM_DONE_STATES.includes(s)).length;
}

/**
 * The next human-facing risk reference ("R1", "R2", …) given the refs already in
 * use. Reuses the R<n> numbering, picking one past the highest existing number
 * so refs never collide even after deletions. Non-conforming refs are ignored.
 */
export function nextRiskRef(existingRefs: readonly string[]): string {
  let max = 0;
  for (const ref of existingRefs) {
    const m = /^R(\d+)$/.exec(ref.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R${max + 1}`;
}
