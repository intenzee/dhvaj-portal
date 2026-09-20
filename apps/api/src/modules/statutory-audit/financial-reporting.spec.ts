import {
  FRAMEWORK_AREA_KEY,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  SMC_STATUS,
  type FinancialReportingFacts,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
import { assessFinancialReporting } from './financial-reporting';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;

function facts(partial: Partial<FinancialReportingFacts> = {}): FinancialReportingFacts {
  return {
    isCompany: true,
    isPrivateCompany: true,
    isListed: false,
    isListedOnSmeExchange: false,
    isNbfc: false,
    isBankOrInsurance: false,
    priorIndAs: false,
    voluntaryIndAs: false,
    groupTriggersIndAs: false,
    netWorth: null,
    turnover: null,
    borrowings: null,
    ...partial,
  };
}

/**
 * Fixture resolver mirroring the seeded 02.2 rules (migration 1763500000000). The
 * key is `area|criterion|entityClass`; effective-date phasing is expressed by
 * supplying the threshold in force for the scenario's period. Defaults: corporate
 * roadmap ₹250cr (Phase II), NBFC ₹250cr, SMC ₹250cr turnover / ₹50cr borrowings.
 */
type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${AREA}|${RULE_CRITERION.netWorth}|`]: { operator: '>=', threshold: 250 * CRORE },
  [`${AREA}|${RULE_CRITERION.netWorth}|nbfc`]: { operator: '>=', threshold: 250 * CRORE },
  [`${AREA}|${RULE_CRITERION.turnover}|`]: { operator: '<=', threshold: 250 * CRORE },
  [`${AREA}|${RULE_CRITERION.borrowings}|`]: { operator: '<=', threshold: 50 * CRORE },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table = { ...SEED, ...overrides };
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `FRF_${criterion}`.toUpperCase(),
      ruleVersionId: 'rv',
      version: 2,
      areaKey,
      entityClass: entityClass ?? null,
      criterion,
      operator: hit.operator,
      unit: 'inr',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: null,
      outcome: 'ind_as',
      effectiveFrom: '2017-04-01',
      authorityProvisionId: 'prov-rule-4',
      guidanceReference: null,
      bands: [],
    };
  };
}
const resolve = makeResolver();

describe('assessFinancialReporting — 02.2D roadmap (§9.2 acceptance)', () => {
  it('1. unlisted ₹600cr → Ind AS', () => {
    const r = assessFinancialReporting(facts({ netWorth: 600 * CRORE }), resolve);
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.detail.firstTimeIndAs).toBe(true);
    expect(r.ruleVersionId).toBe('rv');
    expect(r.authorityProvisionId).toBe('prov-rule-4');
  });

  it('2. unlisted ₹300cr → Ind AS (Phase II ₹250cr threshold)', () => {
    expect(assessFinancialReporting(facts({ netWorth: 300 * CRORE }), resolve).outcome).toBe(
      REPORTING_FRAMEWORK_OUTCOME.indAs,
    );
  });

  it('3. listed non-SME below ₹500cr (₹300cr) → Ind AS via the roadmap', () => {
    const r = assessFinancialReporting(facts({ isListed: true, netWorth: 300 * CRORE }), resolve);
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
  });

  it('4. SME-exchange proviso: listing does NOT force Ind AS below the threshold → AS', () => {
    const r = assessFinancialReporting(
      facts({
        isListed: true,
        isListedOnSmeExchange: true,
        netWorth: 100 * CRORE,
        turnover: 10 * CRORE,
        borrowings: 5 * CRORE,
      }),
      resolve,
    );
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.accountingStandards);
  });

  it('5. group-triggered → Ind AS regardless of a low net worth', () => {
    const r = assessFinancialReporting(
      facts({ groupTriggersIndAs: true, netWorth: 10 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
  });

  it('6. prior adopter continuing → Ind AS, not first-time, even at low net worth', () => {
    const r = assessFinancialReporting(facts({ priorIndAs: true, netWorth: 5 * CRORE }), resolve);
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.detail.firstTimeIndAs).toBe(false);
  });

  it('7. NBFC ₹600cr @ Phase I (₹500cr) → Ind AS', () => {
    const phaseI = makeResolver({
      [`${AREA}|${RULE_CRITERION.netWorth}|nbfc`]: { operator: '>=', threshold: 500 * CRORE },
    });
    const r = assessFinancialReporting(facts({ isNbfc: true, netWorth: 600 * CRORE }), phaseI);
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.detail.isNbfc).toBe(true);
  });

  it('8. NBFC unlisted ₹300cr @ Phase II (₹250cr) → Ind AS', () => {
    expect(
      assessFinancialReporting(facts({ isNbfc: true, netWorth: 300 * CRORE }), resolve).outcome,
    ).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
  });

  it('9. below the threshold → Accounting Standards, with the SMC sub-status computed', () => {
    const r = assessFinancialReporting(
      facts({ netWorth: 100 * CRORE, turnover: 100 * CRORE, borrowings: 20 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.accountingStandards);
    expect(r.detail.smcStatus).toBe(SMC_STATUS.smc);

    const nonSmc = assessFinancialReporting(
      facts({ netWorth: 100 * CRORE, turnover: 300 * CRORE, borrowings: 20 * CRORE }),
      resolve,
    );
    expect(nonSmc.detail.smcStatus).toBe(SMC_STATUS.nonSmc);
  });

  it('10. a future rule-library change affects future periods only (config-driven)', () => {
    const base = facts({ netWorth: 300 * CRORE });
    // Current Phase II threshold ₹250cr → Ind AS.
    expect(assessFinancialReporting(base, resolve).outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    // A future period raises the threshold to ₹500cr → the same facts give AS.
    const raised = makeResolver({
      [`${AREA}|${RULE_CRITERION.netWorth}|`]: { operator: '>=', threshold: 500 * CRORE },
    });
    expect(assessFinancialReporting(base, raised).outcome).toBe(
      REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
    );
  });
});

describe('assessFinancialReporting — guards', () => {
  it('routes bank/insurance to a specialised framework', () => {
    const r = assessFinancialReporting(
      facts({ isBankOrInsurance: true, netWorth: 10 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.specialised);
  });

  it('is professional-review for a non-company', () => {
    expect(assessFinancialReporting(facts({ isCompany: false }), resolve).outcome).toBe(
      REPORTING_FRAMEWORK_OUTCOME.professionalReview,
    );
  });

  it('is information-insufficient when net worth is absent or no rule covers the period', () => {
    expect(assessFinancialReporting(facts({ netWorth: null }), resolve).outcome).toBe(
      REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
    );
    const empty: RuleResolver = () => null;
    expect(assessFinancialReporting(facts({ netWorth: 300 * CRORE }), empty).outcome).toBe(
      REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
    );
  });
});
