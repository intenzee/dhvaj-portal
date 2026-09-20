import {
  CARO_OUTCOME,
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  type CaroFacts,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
import { assessCaro } from './caro';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.caro;

function facts(partial: Partial<CaroFacts> = {}): CaroFacts {
  return {
    isCompany: true,
    isPrivateCompany: true,
    isBanking: false,
    isInsurance: false,
    isSection8: false,
    isOpc: false,
    isSmallCompany: false,
    isHoldingOrSubsidiaryOfPublic: false,
    capitalPlusReserves: null,
    peakBankFiBorrowings: null,
    totalRevenue: null,
    ...partial,
  };
}

/** Fixture resolver mirroring the seeded CARO 2020 limits (migration 1763700000000). */
type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${AREA}|${RULE_CRITERION.capitalAndReserves}|`]: { operator: '<=', threshold: 1 * CRORE },
  [`${AREA}|${RULE_CRITERION.borrowings}|`]: { operator: '<=', threshold: 1 * CRORE },
  [`${AREA}|${RULE_CRITERION.revenue}|`]: { operator: '<=', threshold: 10 * CRORE },
};

function makeResolver(overrides: Seed = {}, empty = false): RuleResolver {
  const table = empty ? {} : { ...SEED, ...overrides };
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `CARO_${criterion}`.toUpperCase(),
      ruleVersionId: `rv-${criterion}`,
      version: 1,
      areaKey,
      entityClass: entityClass ?? null,
      criterion,
      operator: hit.operator,
      unit: 'inr',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: 'caro_measurement_basis',
      outcome: 'exempt_condition',
      effectiveFrom: '2021-04-01',
      authorityProvisionId: 'prov-caro-2020',
      guidanceReference: null,
      bands: [],
    };
  };
}
const resolve = makeResolver();

describe('assessCaro — direct exemptions (§9.4 / spec §20)', () => {
  it('1. banking company is exempt without any threshold test', () => {
    const r = assessCaro(facts({ isBanking: true }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    expect(r.detail.privateTest).toBeNull(); // never reached the money tests
    expect(r.detail.level1Applies).toBe(false);
  });

  it.each([
    ['insurance', { isInsurance: true }],
    ['section 8', { isSection8: true }],
    ['OPC', { isOpc: true }],
    ['small company', { isSmallCompany: true }],
  ])('2. %s company is directly exempt', (_label, flag) => {
    expect(assessCaro(facts(flag), resolve).outcome).toBe(CARO_OUTCOME.notApplicableExempt);
  });
});

describe('assessCaro — the cumulative private-company test (§9.4 / spec §20)', () => {
  it('3. private subsidiary of a public company applies, regardless of money', () => {
    const r = assessCaro(facts({ isHoldingOrSubsidiaryOfPublic: true }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.applicable);
    expect(r.detail.privateTest?.noPublicGroupRelationship).toBe(false);
    expect(r.detail.instantiatesClauseProgramme).toBe(true);
    expect(r.detail.caroScope).toBe('standalone_paragraph_3');
  });

  it('4. an intra-year borrowing peak above ₹1cr fails even if year-end is low', () => {
    const r = assessCaro(
      facts({
        capitalPlusReserves: 50 * (CRORE / 100), // ₹0.5cr
        peakBankFiBorrowings: 2 * CRORE, // peak ₹2cr — over the limit
        totalRevenue: 5 * CRORE,
      }),
      resolve,
    );
    expect(r.outcome).toBe(CARO_OUTCOME.applicable);
    expect(r.detail.privateTest?.borrowingsWithinLimit).toBe(false);
  });

  it('5. aggregate (not per-lender) borrowings govern — an aggregate over ₹1cr fails', () => {
    // The captured fact is the aggregate across all banks/FIs; two ₹0.6cr lenders = ₹1.2cr.
    const r = assessCaro(
      facts({ capitalPlusReserves: 0, peakBankFiBorrowings: 12 * (CRORE / 10), totalRevenue: 0 }),
      resolve,
    );
    expect(r.outcome).toBe(CARO_OUTCOME.applicable);
  });

  it('6. revenue exactly at the ₹10cr limit passes ("does not exceed") → exempt', () => {
    const r = assessCaro(
      facts({
        capitalPlusReserves: 1 * CRORE,
        peakBankFiBorrowings: 1 * CRORE,
        totalRevenue: 10 * CRORE,
      }),
      resolve,
    );
    expect(r.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    expect(r.detail.privateTest?.revenueWithinLimit).toBe(true);
  });

  it('7. all conditions within limits → exempt', () => {
    const r = assessCaro(
      facts({ capitalPlusReserves: 0, peakBankFiBorrowings: 0, totalRevenue: 0 }),
      resolve,
    );
    expect(r.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    expect(r.detail.privateTest?.tested).toBe(true);
  });

  it('8. information-insufficient when a deciding number is missing', () => {
    const r = assessCaro(facts({ capitalPlusReserves: 0, totalRevenue: 0 }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.informationInsufficient);
  });
});

describe('assessCaro — public company & period gating (§9.4 / spec §20)', () => {
  it('9. a public company (not otherwise exempt) → CARO applies, standalone programme instantiated', () => {
    const r = assessCaro(facts({ isPrivateCompany: false }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.applicable);
    expect(r.detail.instantiatesClauseProgramme).toBe(true);
  });

  it('10. a period before CARO 2020 (no rule) → Further Assessment', () => {
    const empty = makeResolver({}, true);
    const r = assessCaro(facts({ isPrivateCompany: false }), empty);
    expect(r.outcome).toBe(CARO_OUTCOME.furtherAssessment);
    expect(r.state).toBe('professional_judgement_required');
  });

  it('11. a future rule-library change affects future periods only', () => {
    // Borderline private company: revenue ₹15cr fails at the ₹10cr limit → applies.
    const base = facts({
      capitalPlusReserves: 0,
      peakBankFiBorrowings: 0,
      totalRevenue: 15 * CRORE,
    });
    expect(assessCaro(base, resolve).outcome).toBe(CARO_OUTCOME.applicable);
    // A future period raises the revenue limit to ₹20cr → the same facts are now exempt.
    const raised = makeResolver({
      [`${AREA}|${RULE_CRITERION.revenue}|`]: { operator: '<=', threshold: 20 * CRORE },
    });
    expect(assessCaro(base, raised).outcome).toBe(CARO_OUTCOME.notApplicableExempt);
  });
});
