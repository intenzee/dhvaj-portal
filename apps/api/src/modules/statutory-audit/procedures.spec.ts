import { financialMovement, nextProcedureRef, procedureCompletionBlock } from '@hsdg/contracts';

describe('nextProcedureRef', () => {
  it('starts at P1 with no existing refs', () => {
    expect(nextProcedureRef([])).toBe('P1');
  });

  it('picks one past the highest existing P<n>, ignoring gaps and deletions', () => {
    expect(nextProcedureRef(['P1', 'P2', 'P3'])).toBe('P4');
    expect(nextProcedureRef(['P1', 'P5'])).toBe('P6'); // gap → past the max, never reused
  });

  it('ignores non-conforming refs', () => {
    expect(nextProcedureRef(['R1', 'PBC-1', 'p2', 'P2'])).toBe('P3');
  });
});

describe('financialMovement', () => {
  it('is null when either side is missing or prior is zero', () => {
    expect(financialMovement(null, 100)).toBeNull();
    expect(financialMovement(100, null)).toBeNull();
    expect(financialMovement(100, 0)).toBeNull();
  });

  it('computes the signed fraction against the absolute prior', () => {
    expect(financialMovement(120, 100)).toBeCloseTo(0.2);
    expect(financialMovement(80, 100)).toBeCloseTo(-0.2);
    expect(financialMovement(50, -100)).toBeCloseTo(1.5); // |prior| in the denominator
  });
});

describe('procedureCompletionBlock', () => {
  const ok = { objective: 'Test receivables', conclusion: 'No exceptions.', openExceptions: 0 };

  it('allows completion when objective + conclusion are present and no open exceptions', () => {
    expect(procedureCompletionBlock(ok)).toBeNull();
  });

  it('blocks without an objective', () => {
    expect(procedureCompletionBlock({ ...ok, objective: '  ' })).toMatch(/objective/i);
  });

  it('blocks without a conclusion', () => {
    expect(procedureCompletionBlock({ ...ok, conclusion: null })).toMatch(/conclusion/i);
  });

  it('blocks while exceptions are open', () => {
    expect(procedureCompletionBlock({ ...ok, openExceptions: 2 })).toMatch(/2 open exception/i);
  });
});
