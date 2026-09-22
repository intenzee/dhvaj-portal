import {
  FRAUD_ROUTE,
  FRAMEWORK_AREA_KEY,
  OTHER_REPORTING_OUTCOME,
  REMUNERATION_OUTCOME,
  RULE_CRITERION,
  type OtherReportingBaseFacts,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
import { assessOtherReporting } from './other-reporting';

const CRORE = 10_000_000;
const A143 = FRAMEWORK_AREA_KEY.section143;
const A11 = FRAMEWORK_AREA_KEY.rule11;

function facts(partial: Partial<OtherReportingBaseFacts> = {}): OtherReportingBaseFacts {
  return {
    isPublicCompany: true,
    auditTrailInForce: true,
    softwareSystems: [],
    managerialRemunerationPaid: null,
    section198NetProfit: null,
    hasManagingOrWholeTimeDirector: true,
    fraudIdentified: false,
    fraudAmount: null,
    fraudEventDate: null,
    intermediaryFundsAdvanced: false,
    ultimateBeneficiaryFundsReceived: false,
    fundingRepresentationsObtained: false,
    dividendCompliesSec123: null,
    pendingLitigationDisclosed: null,
    foreseeableLossesProvided: null,
    iepfTransferDelay: null,
    ...partial,
  };
}

type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${A143}|${RULE_CRITERION.managerialRemunerationPercent}|`]: { operator: '<=', threshold: 11 },
  [`${A143}|${RULE_CRITERION.fraudReportingThreshold}|`]: { operator: '>=', threshold: 1 * CRORE },
  [`${A143}|${RULE_CRITERION.boardReplyDays}|`]: { operator: '<=', threshold: 45 },
  [`${A143}|${RULE_CRITERION.cgForwardDays}|`]: { operator: '<=', threshold: 15 },
  [`${A11}|${RULE_CRITERION.retentionYears}|`]: { operator: '>=', threshold: 8 },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table = { ...SEED, ...overrides };
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `${areaKey}_${criterion}`.toUpperCase(),
      ruleVersionId: `rv-${criterion}`,
      version: 1,
      areaKey,
      entityClass: entityClass ?? null,
      criterion,
      operator: hit.operator,
      unit: 'percent',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: null,
      outcome: 'x',
      effectiveFrom: '2014-04-01',
      authorityProvisionId: 'prov',
      guidanceReference: null,
      bands: [],
    };
  };
}
const resolve = makeResolver();

describe('assessOtherReporting — §197(16) managerial remuneration (§9.7 / spec §21)', () => {
  it('1. a private company does not activate §197(16)', () => {
    const r = assessOtherReporting(facts({ isPublicCompany: false }), resolve);
    expect(r.detail.remuneration.applicable).toBe(false);
    expect(r.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.notApplicable);
  });

  it('2. public company: within the 11% of Section 198 net profit → within limit', () => {
    const r = assessOtherReporting(
      facts({ managerialRemunerationPaid: 10 * CRORE, section198NetProfit: 100 * CRORE }),
      resolve,
    );
    expect(r.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.withinLimit);
    expect(r.detail.remuneration.permittedAmount).toBe(11 * CRORE); // 11% of ₹100cr, Section 198 basis
  });

  it('3. exceeding the ceiling raises a high-severity matter → attention required', () => {
    const r = assessOtherReporting(
      facts({ managerialRemunerationPaid: 20 * CRORE, section198NetProfit: 100 * CRORE }),
      resolve,
    );
    expect(r.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.exceedsLimit);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.attentionRequired);
    expect(r.detail.matters.some((m) => m.code === 'section_197_remuneration')).toBe(true);
  });

  it('4. no / inadequate Section 198 profit routes to the Schedule V band table', () => {
    const r = assessOtherReporting(
      facts({ managerialRemunerationPaid: 1 * CRORE, section198NetProfit: 0 }),
      resolve,
    );
    expect(r.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.scheduleVRoute);
    expect(r.detail.remuneration.scheduleVRoute).toBe(true);
  });

  it('5. a future ceiling change is config-only (raising the % re-permits the same facts)', () => {
    const base = facts({
      managerialRemunerationPaid: 15 * CRORE,
      section198NetProfit: 100 * CRORE,
    });
    expect(assessOtherReporting(base, resolve).detail.remuneration.outcome).toBe(
      REMUNERATION_OUTCOME.exceedsLimit,
    );
    const raised = makeResolver({
      [`${A143}|${RULE_CRITERION.managerialRemunerationPercent}|`]: {
        operator: '<=',
        threshold: 20,
      },
    });
    expect(assessOtherReporting(base, raised).detail.remuneration.outcome).toBe(
      REMUNERATION_OUTCOME.withinLimit,
    );
  });
});

describe('assessOtherReporting — §143(12) fraud (§9.7 / spec §21)', () => {
  it('6. fraud exactly ₹1cr triggers the Central Government route (ADT-4)', () => {
    const r = assessOtherReporting(
      facts({ fraudIdentified: true, fraudAmount: 1 * CRORE, fraudEventDate: '2024-06-01' }),
      resolve,
    );
    expect(r.detail.fraud.route).toBe(FRAUD_ROUTE.centralGovernment);
    expect(r.detail.fraud.formReference).toBe('ADT-4');
  });

  it('7. ₹99.99L (below ₹1cr) takes the Audit Committee / Board route', () => {
    const r = assessOtherReporting(
      facts({ fraudIdentified: true, fraudAmount: 9999000, fraudEventDate: '2024-06-01' }),
      resolve,
    );
    expect(r.detail.fraud.route).toBe(FRAUD_ROUTE.auditCommitteeBoard);
    expect(r.detail.fraud.formReference).toBeNull();
  });

  it('8. the deadline engine computes dates from the event date (+45, then +15)', () => {
    const r = assessOtherReporting(
      facts({ fraudIdentified: true, fraudAmount: 2 * CRORE, fraudEventDate: '2024-06-01' }),
      resolve,
    );
    expect(r.detail.fraud.boardReplyByDate).toBe('2024-07-16'); // 2024-06-01 + 45 days
    expect(r.detail.fraud.cgForwardByDate).toBe('2024-07-31'); // + 15 days
  });
});

describe('assessOtherReporting — Rule 11(g) audit trail & 11(e)/(f) (§9.7 / spec §21)', () => {
  it('9. Rule 11(g) is not applicable before it is in force for the period', () => {
    const r = assessOtherReporting(facts({ auditTrailInForce: false }), resolve);
    expect(r.detail.rule11g.applicable).toBe(false);
  });

  it('10. Rule 11(g) is assessed per software system, with the rule-configured retention', () => {
    const r = assessOtherReporting(
      facts({
        softwareSystems: [
          { name: 'Tally', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true },
          { name: 'Legacy ERP', hasAuditTrailFeature: false, auditTrailOperatedAllYear: false },
        ],
      }),
      resolve,
    );
    expect(r.detail.rule11g.applicable).toBe(true);
    expect(r.detail.rule11g.retentionYears).toBe(8);
    expect(r.detail.rule11g.systems).toHaveLength(2);
    expect(r.detail.rule11g.allAdequate).toBe(false);
    expect(r.detail.matters.some((m) => m.code === 'rule_11g_audit_trail')).toBe(true);
  });

  it('11. Rule 11(e)/(f): funding movements without representations raise a matter', () => {
    const r = assessOtherReporting(
      facts({ intermediaryFundsAdvanced: true, fundingRepresentationsObtained: false }),
      resolve,
    );
    expect(r.detail.rule11ef.satisfied).toBe(false);
    expect(r.detail.matters.some((m) => m.code === 'rule_11ef_representations')).toBe(true);
  });

  it('12. a clean public company with no triggers → configured (no matters)', () => {
    const r = assessOtherReporting(
      facts({
        managerialRemunerationPaid: 5 * CRORE,
        section198NetProfit: 100 * CRORE,
        softwareSystems: [
          { name: 'Tally', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true },
        ],
        dividendCompliesSec123: true,
      }),
      resolve,
    );
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.configured);
    expect(r.detail.matters).toHaveLength(0);
  });
});
