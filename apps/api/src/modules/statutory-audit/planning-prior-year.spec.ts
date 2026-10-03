import {
  mergePriorSections,
  priorYearMattersFromFile,
  priorYearValues,
} from './planning-prior-year';

describe('03.1.6 prior-year matters from last year’s file', () => {
  const planned = priorYearMattersFromFile({
    financialYear: '2023-24',
    risks: [
      {
        id: 'r1',
        ref: 'R-001',
        description: 'Revenue cut-off',
        fsArea: 'Revenue',
        isFraudRisk: true,
        response: 'Cut-off testing',
      },
    ],
    focusAreas: [
      { id: 'f1', name: 'Inventory valuation', why: 'Slow-moving stock', partnerAttention: true },
    ],
    blockingNotes: [{ id: 'n1', body: 'Related-party approvals missing', status: 'cleared' }],
    exceptions: [
      { id: 'x1', description: 'Unrecorded liability', severity: 'high', status: 'resolved' },
    ],
  });

  it('maps each kind of record to its matter type with traceable evidence', () => {
    expect(planned.map((m) => [m.sourceRef, m.matterType])).toEqual([
      ['risk:r1', 'significant_risk'],
      ['focus:f1', 'partner_focus_area'],
      ['note:n1', 'major_review_point'],
      ['exception:x1', 'major_review_point'],
    ]);
    expect(planned[0]!.description).toBe('Significant (fraud) risk — Revenue: Revenue cut-off');
    expect(planned[0]!.sourceEvidence).toBe(
      'FY 2023-24 audit file — risk register R-001; response: Cut-off testing',
    );
    expect(planned[1]!.sourceEvidence).toMatch(/Partner attention/);
  });

  it('plans nothing when last year had nothing to bring forward', () => {
    expect(
      priorYearMattersFromFile({
        financialYear: '2023-24',
        risks: [],
        focusAreas: [],
        blockingNotes: [],
        exceptions: [],
      }),
    ).toEqual([]);
  });
});

describe('03.2 carry-forward', () => {
  it('seeds unsaved sections from last year, with this year’s master answers on top', () => {
    const merged = mergePriorSections(
      [{ key: 'business_model', answers: { activities: ['Manufacturing'] } }],
      [
        {
          key: 'business_model',
          answers: { activities: ['Trading'], revenue_streams: 'Domestic' },
        },
        { key: 'systems', answers: { erp: 'Tally' } },
        { key: 'governance', answers: { board: '3 directors' } },
      ],
      new Set(['governance']),
    );
    expect(merged).toEqual([
      {
        key: 'business_model',
        answers: { activities: ['Manufacturing'], revenue_streams: 'Domestic' },
        fromPriorYear: true,
      },
      { key: 'systems', answers: { erp: 'Tally' }, fromPriorYear: true },
    ]);
  });

  it('turns last year’s figures into this year’s prior-year column, in this year’s units', () => {
    expect(
      priorYearValues(
        [
          { metricKey: 'revenue', amount: 125 }, // ₹ lakh
          { metricKey: 'pat', amount: 10 },
        ],
        { priorUnits: 100000, targetUnits: 10000000 }, // lakh → crore
        new Set(['pat:py']),
      ),
    ).toEqual([{ metricKey: 'revenue', amount: 1.25 }]);
  });
});
