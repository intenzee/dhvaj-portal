import {
  FRAMEWORK_AREA_KEY,
  ICFR_OUTCOME,
  RULE_CRITERION,
  type IcfrFacts,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
import { assessIcfr } from './icfr';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.ifc;

function facts(partial: Partial<IcfrFacts> = {}): IcfrFacts {
  return {
    isCompany: true,
    isPrivateCompany: true,
    isOpc: false,
    isSmallCompany: false,
    turnover: null,
    peakCoveredBorrowings: null,
    filingDefault: false,
    ...partial,
  };
}

/** Fixture resolver mirroring the seeded §143(3)(i) exemption limits (migration 1763800000000). */
type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${AREA}|${RULE_CRITERION.turnover}|`]: { operator: '<', threshold: 50 * CRORE },
  [`${AREA}|${RULE_CRITERION.borrowings}|`]: { operator: '<', threshold: 25 * CRORE },
};

function makeResolver(overrides: Seed = {}, empty = false): RuleResolver {
  const table = empty ? {} : { ...SEED, ...overrides };
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `ICFR_${criterion}`.toUpperCase(),
      ruleVersionId: `rv-${criterion}`,
      version: 1,
      areaKey,
      entityClass: entityClass ?? null,
      criterion,
      operator: hit.operator,
      unit: 'inr',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: 'at_any_point_in_year',
      outcome: 'exempt_condition',
      effectiveFrom: '2016-04-01',
      authorityProvisionId: 'prov-143-3-i',
      guidanceReference: null,
      bands: [],
    };
  };
}
const resolve = makeResolver();

describe('assessIcfr — §143(3)(i) applicability (§9.5 / spec §24)', () => {
  it('1. a public company always reports ICFR', () => {
    const r = assessIcfr(facts({ isPrivateCompany: false }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.configuresIcfrWorkstream).toBe(true);
  });

  it.each([
    ['OPC', { isOpc: true }],
    ['small company', { isSmallCompany: true }],
  ])('2. a private %s is exempt', (_label, flag) => {
    const r = assessIcfr(facts(flag), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.exempt);
  });

  it('3. turnover exactly ₹50cr fails the strict `<` limit → applies', () => {
    const r = assessIcfr(
      facts({ turnover: 50 * CRORE, peakCoveredBorrowings: 1 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.monetaryTest?.turnoverWithinLimit).toBe(false);
  });

  it('4. borrowings exactly ₹25cr fails the strict `<` limit → applies', () => {
    const r = assessIcfr(
      facts({ turnover: 1 * CRORE, peakCoveredBorrowings: 25 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.monetaryTest?.borrowingsWithinLimit).toBe(false);
  });

  it('5. both conditions strictly within limits → exempt', () => {
    const r = assessIcfr(
      facts({ turnover: 40 * CRORE, peakCoveredBorrowings: 20 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.exempt);
    expect(r.detail.monetaryTest?.tested).toBe(true);
  });

  it('6. both-AND: one condition failing → applies', () => {
    const r = assessIcfr(
      facts({ turnover: 40 * CRORE, peakCoveredBorrowings: 30 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
  });

  it('7. an intra-year borrowing peak above ₹25cr governs even if year-end is low', () => {
    const r = assessIcfr(
      facts({ turnover: 10 * CRORE, peakCoveredBorrowings: 40 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
  });

  it('8. a filing default blocks the exemption even when the money passes', () => {
    const r = assessIcfr(
      facts({ turnover: 1 * CRORE, peakCoveredBorrowings: 1 * CRORE, filingDefault: true }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.filingDefaultBlocks).toBe(true);
  });

  it('9. a filing default blocks even an OPC/small exemption', () => {
    const r = assessIcfr(facts({ isSmallCompany: true, filingDefault: true }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.filingDefaultBlocks).toBe(true);
  });

  it('10. information-insufficient when a deciding number is missing', () => {
    const r = assessIcfr(facts({ turnover: 10 * CRORE }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.informationInsufficient);
  });

  it('10b. one captured figure over its limit decides it — the missing one is moot', () => {
    const t = assessIcfr(facts({ turnover: 80 * CRORE }), resolve);
    expect(t.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(t.detail.monetaryTest).toEqual({
      tested: true,
      turnoverWithinLimit: false,
      borrowingsWithinLimit: null,
    });
    const b = assessIcfr(facts({ peakCoveredBorrowings: 30 * CRORE }), resolve);
    expect(b.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(b.detail.monetaryTest?.borrowingsWithinLimit).toBe(false);
  });
});

describe('assessIcfr — separations & period gating (§9.5 / spec §24)', () => {
  it('11. an exemption keeps the Controls phase active and Rule 11(g) separate', () => {
    const r = assessIcfr(facts({ isOpc: true }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.exempt);
    expect(r.detail.controlsPhaseUnaffected).toBe(true);
    expect(r.detail.rule11gSeparate).toBe(true);
    expect(r.detail.configuresIcfrWorkstream).toBe(false);
  });

  it('12. a private company in a period before the exemption framework → Further Assessment; a public company still applies', () => {
    const empty = makeResolver({}, true);
    expect(assessIcfr(facts(), empty).outcome).toBe(ICFR_OUTCOME.furtherAssessment);
    expect(assessIcfr(facts({ isPrivateCompany: false }), empty).outcome).toBe(
      ICFR_OUTCOME.applicable,
    );
  });

  it('13. a future rule-library change affects future periods only', () => {
    // Turnover ₹60cr fails the ₹50cr limit → applies.
    const base = facts({ turnover: 60 * CRORE, peakCoveredBorrowings: 1 * CRORE });
    expect(assessIcfr(base, resolve).outcome).toBe(ICFR_OUTCOME.applicable);
    // A future period raises the turnover limit to ₹100cr → the same facts are now exempt.
    const raised = makeResolver({
      [`${AREA}|${RULE_CRITERION.turnover}|`]: { operator: '<', threshold: 100 * CRORE },
    });
    expect(assessIcfr(base, raised).outcome).toBe(ICFR_OUTCOME.exempt);
  });
});
