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

describe('03.1.6 prior-year matters — CARO, ICFR, estimates, opinion and misstatements', () => {
  const planned = priorYearMattersFromFile({
    financialYear: '2023-24',
    risks: [
      {
        id: 'e1',
        ref: 'R-004',
        description: 'ECL provisioning model',
        fsArea: 'Loans',
        isFraudRisk: false,
        source: 'estimate',
        response: null,
      },
    ],
    focusAreas: [],
    blockingNotes: [],
    exceptions: [],
    caroMatters: [
      { id: 'c1', clauseRef: '3(vii)(a)', title: 'Statutory dues', draft: 'PF paid late.' },
    ],
    icfrDeficiencies: [
      {
        id: 'd1',
        seq: 2,
        classification: 'material_weakness',
        description: 'No review of journal entries',
        remediationStatus: 'in_progress',
      },
      {
        id: 'd2',
        seq: 3,
        classification: 'control_deficiency',
        description: 'Minor',
        remediationStatus: 'not_started',
      },
    ],
    completionNotes: [
      { id: 'a1', itemKey: 'auditors_report', note: 'Qualified opinion on inventory.' },
      { id: 'm1', itemKey: 'misstatements', note: 'Uncorrected misstatements: INR 12 lakh.' },
    ],
  });

  it('maps each source to its matter type; plain control deficiencies stay behind', () => {
    expect(planned.map((m) => [m.sourceRef, m.matterType])).toEqual([
      ['risk:e1', 'significant_estimate'],
      ['caro:c1', 'caro_exception'],
      ['icfr:d1', 'control_deficiency'],
      ['report:a1', 'modified_opinion'],
      ['misstatements:m1', 'unadjusted_misstatement'],
    ]);
    expect(planned[0]!.description).toBe('Significant estimate — Loans: ECL provisioning model');
    expect(planned[1]!.description).toBe('CARO 3(vii)(a) — Statutory dues: PF paid late.');
    expect(planned[2]!.description).toBe('Material weakness: No review of journal entries');
    expect(planned[2]!.sourceEvidence).toBe(
      'FY 2023-24 audit file — ICFR deficiency ICD-002 (remediation in progress)',
    );
  });

  it('ignores clean report and misstatement notes', () => {
    expect(
      priorYearMattersFromFile({
        financialYear: '2023-24',
        risks: [],
        focusAreas: [],
        blockingNotes: [],
        exceptions: [],
        completionNotes: [
          { id: 'a', itemKey: 'auditors_report', note: "Auditor's report prepared under SA 700." },
          { id: 'b', itemKey: 'misstatements', note: 'No misstatements carried forward.' },
          { id: 'c', itemKey: 'misstatements', note: null },
        ],
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
