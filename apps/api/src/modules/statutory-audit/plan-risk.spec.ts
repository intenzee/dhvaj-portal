import type { PlanningItemState } from '@hsdg/contracts';
import { incompletePlanningCount, nextRiskRef } from './plan-risk';

describe('incompletePlanningCount (§21)', () => {
  it('counts every non-complete state', () => {
    const states: PlanningItemState[] = [
      'complete',
      'in_progress',
      'not_started',
      'needs_attention',
      'complete',
    ];
    expect(incompletePlanningCount(states)).toBe(3);
  });

  it('is zero when everything is complete', () => {
    expect(incompletePlanningCount(['complete', 'complete'])).toBe(0);
    expect(incompletePlanningCount([])).toBe(0);
  });
});

describe('nextRiskRef (§22)', () => {
  it('starts at R1 for an empty register', () => {
    expect(nextRiskRef([])).toBe('R1');
  });

  it('picks one past the highest existing R-number', () => {
    expect(nextRiskRef(['R1', 'R2', 'R3'])).toBe('R4');
    // Robust to gaps left by deletions.
    expect(nextRiskRef(['R1', 'R5'])).toBe('R6');
  });

  it('ignores refs that do not fit the R<n> pattern', () => {
    expect(nextRiskRef(['fraud-1', 'R2', 'custom'])).toBe('R3');
    expect(nextRiskRef(['abc'])).toBe('R1');
  });
});
