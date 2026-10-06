import {
  openSuggestions,
  resolvedInFile,
  reviewArea,
  reviewProcedure,
  type AreaReviewFacts,
  type ProcedureReviewFacts,
} from './review-automation';

const proc = (o: Partial<ProcedureReviewFacts> = {}): ProcedureReviewFacts => ({
  id: 'p1',
  ref: 'P-007',
  objective: 'Confirm bank balances exist at the year end.',
  conclusion: 'Balances agreed to confirmations without exception.',
  samplingMethod: null,
  sampleSize: null,
  evidenceCount: 2,
  openExceptions: 0,
  carriedExceptions: 0,
  significantRisks: [],
  ...o,
});

const area = (o: Partial<AreaReviewFacts> = {}): AreaReviewFacts => ({
  id: 'a1',
  title: 'Revenue',
  conclusion: 'Revenue is fairly stated in all material respects.',
  procedures: [
    { ref: 'P-001', state: 'complete' },
    { ref: 'P-002', state: 'complete' },
  ],
  outstandingPbc: [],
  significantRisks: [],
  carriedExceptions: 0,
  ...o,
});

describe('review automation — procedures', () => {
  it('a complete, evidenced procedure is ready with nothing to suggest', () => {
    const r = reviewProcedure(proc());
    expect(r.ready).toBe(true);
    expect(r.suggestions).toEqual([]);
    expect(r.checks.map((c) => c.key)).toEqual([
      'objective',
      'conclusion',
      'evidence',
      'exceptions',
    ]);
  });

  it('suggests the notes a first review would raise, blocking what stops completion', () => {
    const r = reviewProcedure(
      proc({
        conclusion: 'Done.',
        evidenceCount: 0,
        openExceptions: 2,
        samplingMethod: 'monetary_unit',
        sampleSize: null,
        significantRisks: ['R2'],
        carriedExceptions: 1,
      }),
    );
    expect(r.ready).toBe(false);
    const byKey = new Map(r.suggestions.map((s) => [s.sourceKey, s]));
    expect(byKey.get('proc:p1:conclusion')).toMatchObject({ isBlocking: true });
    expect(byKey.get('proc:p1:evidence')).toMatchObject({ isBlocking: true }); // significant risk
    expect(byKey.get('proc:p1:exceptions')?.body).toBe(
      'P-007: 2 exception(s) still open — resolve them or carry them forward as misstatements.',
    );
    expect(byKey.get('proc:p1:sample')).toMatchObject({ isBlocking: false });
    expect(byKey.get('proc:p1:sample')?.body).toContain('monetary unit sample');
    expect(r.context).toEqual([
      'Responds to significant risk R2 — check the response is specific to it (SA 330.21).',
      '1 exception(s) carried forward as uncorrected misstatements.',
    ]);
  });

  it('missing evidence is not blocking when no significant risk rides on it', () => {
    const r = reviewProcedure(proc({ evidenceCount: 0 }));
    expect(r.suggestions).toEqual([
      expect.objectContaining({ sourceKey: 'proc:p1:evidence', isBlocking: false }),
    ]);
  });
});

describe('review automation — areas', () => {
  it('checks the procedures, the conclusion and outstanding client information', () => {
    const r = reviewArea(
      area({
        conclusion: null,
        procedures: [
          { ref: 'P-001', state: 'complete' },
          { ref: 'P-002', state: 'in_progress' },
        ],
        outstandingPbc: ['PBC-004'],
        significantRisks: ['R1'],
        carriedExceptions: 2,
      }),
    );
    expect(r.checks).toEqual([
      { key: 'procedures', label: 'Procedures complete (1 of 2)', ok: false },
      { key: 'conclusion', label: 'Area conclusion recorded', ok: false },
      { key: 'pbc', label: 'Client information received', ok: false },
    ]);
    expect(r.suggestions.map((s) => [s.sourceKey, s.isBlocking])).toEqual([
      ['area:a1:procedures', true],
      ['area:a1:conclusion', true],
      ['area:a1:pbc', false],
    ]);
    expect(r.suggestions[0]!.body).toContain('(P-002)');
    expect(r.context).toEqual([
      'Significant risks: R1.',
      '2 misstatement(s) carried forward — check they are in the summary of misstatements.',
    ]);
    expect(reviewArea(area()).ready).toBe(true);
  });

  it('an area with no procedures is not ready', () => {
    const r = reviewArea(area({ procedures: [] }));
    expect(r.checks[0]).toEqual({ key: 'procedures', label: 'Procedures performed', ok: false });
  });
});

describe('review automation — suggestions over time', () => {
  it('hides raised and dismissed suggestions, and spots a fix in the file', () => {
    const s = reviewProcedure(proc({ evidenceCount: 0, conclusion: null })).suggestions;
    expect(
      openSuggestions(s, new Set(['proc:p1:conclusion']), new Set(['proc:p1:evidence'])),
    ).toEqual([]);
    expect(openSuggestions(s, new Set(), new Set()).length).toBe(2);
    const passing = new Set(['proc:p1:evidence']);
    expect(resolvedInFile('proc:p1:evidence', passing)).toBe(true);
    expect(resolvedInFile('proc:p1:conclusion', passing)).toBe(false);
    expect(resolvedInFile(null, passing)).toBe(false);
  });
});
