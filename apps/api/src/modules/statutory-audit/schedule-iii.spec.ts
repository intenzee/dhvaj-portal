import {
  FRAMEWORK_AREA_KEY,
  FS_COMPONENT,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  SCHEDULE_III_OUTCOME,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
  type ScheduleIiiFacts,
} from '@hsdg/contracts';
import { assessScheduleIii } from './schedule-iii';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.scheduleIii;

function facts(partial: Partial<ScheduleIiiFacts> = {}): ScheduleIiiFacts {
  return {
    reportingFramework: REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
    isNbfc: false,
    isBankOrInsurance: false,
    isOpc: false,
    isSmallCompany: false,
    isDormant: false,
    firstTimeIndAs: false,
    turnover: null,
    ...partial,
  };
}

/**
 * Fixture resolver mirroring the seeded 02.3 rounding rule (migration
 * 1763600000000): Schedule III rounding turnover band splits at ₹100cr. The key
 * is `area|criterion|entityClass`; effective-date phasing is expressed by
 * supplying the threshold in force for the scenario's period.
 */
type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${AREA}|${RULE_CRITERION.turnover}|`]: { operator: '>=', threshold: 100 * CRORE },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table = { ...SEED, ...overrides };
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: 'SCH_III_ROUNDING',
      ruleVersionId: 'rv-round',
      version: 1,
      areaKey,
      entityClass: entityClass ?? null,
      criterion,
      operator: hit.operator,
      unit: 'inr',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: 'balance_sheet_date',
      outcome: 'higher_band',
      effectiveFrom: '2014-04-01',
      authorityProvisionId: null,
      guidanceReference: null,
      bands: [],
    };
  };
}
const resolve = makeResolver();

describe('assessScheduleIii — Division routing (§9.3 / spec §21 acceptance)', () => {
  it('1. AS → Division I, citing SCH_III_DIV_I', () => {
    const r = assessScheduleIii(
      facts({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.accountingStandards }),
      resolve,
    );
    expect(r.outcome).toBe(SCHEDULE_III_OUTCOME.divisionI);
    expect(r.detail.divisionProvisionCode).toBe('SCH_III_DIV_I');
    // Division I is an AS format — no Statement of Changes in Equity.
    expect(r.detail.requiredComponents).not.toContain(FS_COMPONENT.statementOfChangesInEquity);
  });

  it('2. Ind AS non-NBFC → Division II, with a Statement of Changes in Equity', () => {
    const r = assessScheduleIii(
      facts({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs }),
      resolve,
    );
    expect(r.outcome).toBe(SCHEDULE_III_OUTCOME.divisionII);
    expect(r.detail.divisionProvisionCode).toBe('SCH_III_DIV_II');
    expect(r.detail.requiredComponents).toContain(FS_COMPONENT.statementOfChangesInEquity);
  });

  it('3. Ind AS NBFC → Division III', () => {
    const r = assessScheduleIii(
      facts({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs, isNbfc: true }),
      resolve,
    );
    expect(r.outcome).toBe(SCHEDULE_III_OUTCOME.divisionIII);
    expect(r.detail.divisionProvisionCode).toBe('SCH_III_DIV_III');
  });

  it('4. specialised entity is not forced into a Division', () => {
    const bank = assessScheduleIii(
      facts({
        reportingFramework: REPORTING_FRAMEWORK_OUTCOME.specialised,
        isBankOrInsurance: true,
      }),
      resolve,
    );
    expect(bank.outcome).toBe(SCHEDULE_III_OUTCOME.specialisedFormat);
    expect(bank.detail.division).toBeNull();
    expect(bank.detail.divisionProvisionCode).toBeNull();
    // Defense in depth: the bank flag alone routes to specialised even if 02.2 said Ind AS.
    const flagged = assessScheduleIii(
      facts({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs, isBankOrInsurance: true }),
      resolve,
    );
    expect(flagged.outcome).toBe(SCHEDULE_III_OUTCOME.specialisedFormat);
  });

  it('5. information-insufficient until 02.2 is concluded', () => {
    const r = assessScheduleIii(facts({ reportingFramework: null }), resolve);
    expect(r.outcome).toBe(SCHEDULE_III_OUTCOME.informationInsufficient);
    expect(r.state).toBe('pending_information');
  });
});

describe('assessScheduleIii — cash-flow exemption reuses 02.1 (§9.3)', () => {
  it('6. ordinary company → Cash Flow Statement required', () => {
    const r = assessScheduleIii(facts(), resolve);
    expect(r.detail.cashFlowRequired).toBe(true);
    expect(r.detail.requiredComponents).toContain(FS_COMPONENT.cashFlowStatement);
    expect(r.detail.cashFlowExemptionReason).toBeNull();
  });

  it.each([
    ['OPC', { isOpc: true }],
    ['small company', { isSmallCompany: true }],
    ['dormant company', { isDormant: true }],
  ])('7. %s → cash-flow exempt (§2(40) proviso), no CFS component', (_label, flag) => {
    const r = assessScheduleIii(facts(flag), resolve);
    expect(r.detail.cashFlowRequired).toBe(false);
    expect(r.detail.requiredComponents).not.toContain(FS_COMPONENT.cashFlowStatement);
    expect(r.detail.cashFlowExemptionReason).toMatch(/§2\(40\)/);
  });
});

describe('assessScheduleIii — rounding band & disclosures (config-driven, §9.3)', () => {
  it('8. turnover ≥ ₹100cr → higher rounding band; < → lower band', () => {
    const high = assessScheduleIii(facts({ turnover: 250 * CRORE }), resolve);
    expect(high.detail.roundingUnits).toEqual(['lakhs', 'millions', 'crores']);
    expect(high.detail.roundingThreshold).toBe(100 * CRORE);
    expect(high.ruleVersionId).toBe('rv-round');

    const low = assessScheduleIii(facts({ turnover: 20 * CRORE }), resolve);
    expect(low.detail.roundingUnits).toEqual(['hundreds', 'thousands', 'lakhs', 'millions']);
  });

  it('9. a future rounding-rule change affects future periods only', () => {
    const base = facts({ turnover: 250 * CRORE });
    expect(assessScheduleIii(base, resolve).detail.roundingUnits).toEqual([
      'lakhs',
      'millions',
      'crores',
    ]);
    // A future period raises the band split to ₹500cr → the same turnover is now the lower band.
    const raised = makeResolver({
      [`${AREA}|${RULE_CRITERION.turnover}|`]: { operator: '>=', threshold: 500 * CRORE },
    });
    expect(assessScheduleIii(base, raised).detail.roundingUnits).toEqual([
      'hundreds',
      'thousands',
      'lakhs',
      'millions',
    ]);
  });

  it('10. first-time Ind AS triggers the Ind AS 101 disclosure; a zero balance never suppresses baseline disclosures', () => {
    const firstTime = assessScheduleIii(
      facts({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs, firstTimeIndAs: true }),
      resolve,
    );
    expect(firstTime.detail.disclosures).toContain(
      'First-time adoption reconciliations (Ind AS 101)',
    );

    // Continuing Ind AS: no 101, but the baseline set is still rule-required (not balance-driven).
    const continuing = assessScheduleIii(
      facts({ reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs, firstTimeIndAs: false }),
      resolve,
    );
    expect(continuing.detail.disclosures).not.toContain(
      'First-time adoption reconciliations (Ind AS 101)',
    );
    expect(continuing.detail.disclosures.length).toBeGreaterThan(0);
  });

  it('11. missing rounding rule leaves the band pending but still concludes the Division', () => {
    const empty: RuleResolver = () => null;
    const r = assessScheduleIii(facts({ turnover: 250 * CRORE }), empty);
    expect(r.outcome).toBe(SCHEDULE_III_OUTCOME.divisionI);
    expect(r.detail.roundingThreshold).toBeNull();
    expect(r.detail.roundingUnits).toEqual([]);
    expect(r.ruleVersionId).toBeNull();
  });
});
