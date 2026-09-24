import type { PlanningExpectationRecord } from '@hsdg/contracts';
import { evaluateExpectation, validateAnswers } from './audit-business-understanding.service';

describe('validateAnswers (03.2.1–03.2.6 field catalogue)', () => {
  it('accepts known fields in the right shape and trims / drops empty rows', () => {
    expect(
      validateAnswers('business_model', {
        activities: ['Services', 'Services'],
        seasonality: 'Yes',
        activities_note: '  IT consulting  ',
        products: [
          ['Cloud migration', 'Services'],
          ['', ''],
        ],
      }),
    ).toEqual({
      activities: ['Services'],
      seasonality: 'Yes',
      activities_note: 'IT consulting',
      products: [['Cloud migration', 'Services']],
    });
  });

  it('rejects unknown fields, options outside the list and malformed tables', () => {
    expect(() => validateAnswers('business_model', { bogus: 'x' })).toThrow(/Unknown field/);
    expect(() => validateAnswers('business_model', { seasonality: 'Maybe' })).toThrow(
      /Invalid value/,
    );
    expect(() => validateAnswers('business_model', { activities: ['Mining'] })).toThrow(
      /Invalid value/,
    );
    expect(() => validateAnswers('business_model', { products: [['only one column']] })).toThrow(
      /Invalid value/,
    );
  });
});

describe('evaluateExpectation (§14)', () => {
  const exp = (over: Partial<PlanningExpectationRecord>): PlanningExpectationRecord => ({
    id: 'e',
    metricKey: 'revenue',
    metricLabel: 'Revenue',
    expectationType: 'amount',
    expectedAmount: null,
    expectedLow: null,
    expectedHigh: null,
    expectedDirection: null,
    tolerancePct: null,
    basis: 'budget',
    basisNote: null,
    actual: 82,
    variance: null,
    suggestedInvestigation: null,
    requiresInvestigation: null,
    conclusion: null,
    signalId: null,
    signalCode: null,
    version: 1,
    ...over,
  });

  it('amount: variance and tolerance-based suggestion', () => {
    expect(evaluateExpectation(exp({ expectedAmount: 80, tolerancePct: 5 }), 54)).toEqual({
      variance: 2,
      suggestedInvestigation: false,
    });
    expect(
      evaluateExpectation(exp({ expectedAmount: 60, tolerancePct: 5 }), 54).suggestedInvestigation,
    ).toBe(true);
  });

  it('range: distance outside the range', () => {
    expect(
      evaluateExpectation(exp({ expectationType: 'range', expectedLow: 60, expectedHigh: 70 }), 54),
    ).toEqual({
      variance: 12,
      suggestedInvestigation: true,
    });
    expect(
      evaluateExpectation(exp({ expectationType: 'range', expectedLow: 80, expectedHigh: 90 }), 54)
        .suggestedInvestigation,
    ).toBe(false);
  });

  it('direction: compares with the prior year', () => {
    expect(
      evaluateExpectation(exp({ expectationType: 'direction', expectedDirection: 'increase' }), 54)
        .suggestedInvestigation,
    ).toBe(false);
    expect(
      evaluateExpectation(
        exp({ expectationType: 'direction', expectedDirection: 'stable', tolerancePct: 10 }),
        54,
      ).suggestedInvestigation,
    ).toBe(true);
  });

  it('no actual yet → no suggestion', () => {
    expect(evaluateExpectation(exp({ actual: null, expectedAmount: 80 }), 54)).toEqual({
      variance: null,
      suggestedInvestigation: null,
    });
  });
});
