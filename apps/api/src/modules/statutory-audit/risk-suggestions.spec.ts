import { suggestRisks, type RiskSuggestionFacts } from './risk-suggestions';

const none: RiskSuggestionFacts = {
  isInitialAudit: false,
  hasGroupRelationships: false,
  signals: [],
  priorYearMatters: [],
  enhancedAreas: [],
};
const keys = (f: RiskSuggestionFacts) => suggestRisks(f).map((r) => r.sourceKey);

describe('Section 04 suggested risks', () => {
  it('always starts from the two SA 240 presumptions, significant and with a response', () => {
    const r = suggestRisks(none);
    expect(r.map((x) => x.sourceKey)).toEqual([
      'sa240:management_override',
      'sa240:revenue_recognition',
    ]);
    expect(r.every((x) => x.isSignificant && x.isFraudRisk && x.response)).toBe(true);
    expect(r[1]).toEqual(expect.objectContaining({ fsArea: 'Revenue', assertion: 'occurrence' }));
  });

  it('suggests signals the Manager raised, never a standard or not-relevant one', () => {
    const signal = (id: string, p: Partial<RiskSuggestionFacts['signals'][number]>) => ({
      id,
      code: `PS-00${id}`,
      source: 'analytics',
      observation: 'Gross margin up 9 points',
      whyMayMatter: 'Possible cut-off error',
      attention: 'standard' as const,
      managerAssessment: null,
      status: 'assessed',
      ...p,
    });
    const r = suggestRisks({
      ...none,
      signals: [
        signal('1', { attention: 'enhanced' }),
        signal('2', { attention: 'immediate_partner' }),
        signal('3', { managerAssessment: 'potential_risk_assess_further' }),
        signal('4', {}),
        signal('5', { attention: 'enhanced', managerAssessment: 'not_relevant' }),
        signal('6', { attention: 'enhanced', status: 'closed' }),
      ],
    }).slice(2);
    expect(r.map((x) => [x.sourceKey, x.rating, x.source])).toEqual([
      ['signal:1', 'moderate', 'analytical_review'],
      ['signal:2', 'high', 'analytical_review'],
      ['signal:3', 'moderate', 'analytical_review'],
    ]);
    expect(r[0]!.description).toBe('Gross margin up 9 points — Possible cut-off error');
    expect(r[1]!.sourceNote).toBe('Planning signal PS-002 (Partner attention)');
  });

  it('carries last year’s significant risks unless reassessed as resolved', () => {
    const r = suggestRisks({
      ...none,
      priorYearMatters: [
        {
          id: 'a',
          code: 'PY-001',
          matterType: 'significant_risk',
          description: 'Fraud in revenue',
          assessment: 'still_relevant',
        },
        {
          id: 'b',
          code: 'PY-002',
          matterType: 'significant_risk',
          description: 'Inventory',
          assessment: 'resolved',
        },
        {
          id: 'c',
          code: 'PY-003',
          matterType: 'partner_focus_area',
          description: 'Focus',
          assessment: null,
        },
        {
          id: 'd',
          code: 'PY-004',
          matterType: 'significant_estimate',
          description: 'ECL provision',
          assessment: null,
        },
      ],
    }).slice(2);
    expect(r.map((x) => [x.sourceKey, x.rating, x.isSignificant, x.isFraudRisk])).toEqual([
      ['py:a', 'significant', true, true],
      ['py:d', 'high', false, false],
    ]);
  });

  it('adds Enhanced 03.5 areas, related parties and opening balances when they apply', () => {
    expect(
      keys({
        ...none,
        enhancedAreas: [{ id: 'x', name: 'Inventories', reason: 'Slow-moving' }],
        hasGroupRelationships: true,
        isInitialAudit: true,
      }).slice(2),
    ).toEqual(['area:x', 'sa550:related_parties', 'sa510:opening_balances']);
  });
});
