import {
  CONSOLIDATION_METHOD,
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  INVESTEE_RELATIONSHIP,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  type ConsolidationFacts,
  type InvesteeInput,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
import { assessConsolidation, classifyInvestee } from './consolidation';

const AREA = FRAMEWORK_AREA_KEY.cfs;

function investee(partial: Partial<InvesteeInput> = {}): InvesteeInput {
  return {
    name: 'Investee',
    ownershipPercent: null,
    hasControl: null,
    isJointArrangement: false,
    jointArrangementIsOperation: false,
    significantInfluenceRebutted: null,
    auditedByOtherAuditor: false,
    ...partial,
  };
}

function facts(partial: Partial<ConsolidationFacts> = {}): ConsolidationFacts {
  return {
    reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs,
    investees: [],
    isWhollyOwnedSubsidiary: false,
    isPartiallyOwnedSubsidiary: false,
    otherMembersIntimatedNoObjection: false,
    securitiesListedOrInProcess: false,
    parentFilesCompliantCfs: null,
    hasBranches: false,
    ...partial,
  };
}

/** Fixture resolver mirroring the seeded ownership presumptions (migration 1763900000000). */
type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${AREA}|${RULE_CRITERION.controlOwnership}|`]: { operator: '>', threshold: 50 },
  [`${AREA}|${RULE_CRITERION.significantInfluenceOwnership}|`]: { operator: '>=', threshold: 20 },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table = { ...SEED, ...overrides };
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `CFS_${criterion}`.toUpperCase(),
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
      outcome: 'presumption',
      effectiveFrom: '2014-04-01',
      authorityProvisionId: 'prov',
      guidanceReference: null,
      bands: [],
    };
  };
}
const resolve = makeResolver();

describe('classifyInvestee — percentages are inputs, not the whole test (§9.6 / spec §25)', () => {
  it('1. control is not coded as a bare > 50%: a captured control judgment overrides ownership', () => {
    // 45% but control established → subsidiary.
    const sub = classifyInvestee(
      investee({ ownershipPercent: 45, hasControl: true }),
      true,
      resolve,
    );
    expect(sub.relationship).toBe(INVESTEE_RELATIONSHIP.subsidiary);
    expect(sub.method).toBe(CONSOLIDATION_METHOD.fullConsolidation);

    // 60% but control judged absent → NOT a subsidiary (falls to the associate test).
    const notSub = classifyInvestee(
      investee({ ownershipPercent: 60, hasControl: false }),
      true,
      resolve,
    );
    expect(notSub.relationship).toBe(INVESTEE_RELATIONSHIP.associate);
  });

  it('2. > 50% with no explicit judgment → subsidiary via the (rebuttable) presumption', () => {
    const r = classifyInvestee(investee({ ownershipPercent: 60 }), true, resolve);
    expect(r.relationship).toBe(INVESTEE_RELATIONSHIP.subsidiary);
  });

  it('3. the 20% significant-influence presumption is rebuttable both ways', () => {
    // 25% rebutted → no significant influence → outside the perimeter.
    const rebuttedOut = classifyInvestee(
      investee({ ownershipPercent: 25, significantInfluenceRebutted: true }),
      true,
      resolve,
    );
    expect(rebuttedOut.relationship).toBe(INVESTEE_RELATIONSHIP.none);

    // 15% but significant influence established → associate despite being below 20%.
    const rebuttedIn = classifyInvestee(
      investee({ ownershipPercent: 15, significantInfluenceRebutted: false }),
      true,
      resolve,
    );
    expect(rebuttedIn.relationship).toBe(INVESTEE_RELATIONSHIP.associate);

    // 25% presumption stands → associate.
    expect(classifyInvestee(investee({ ownershipPercent: 25 }), true, resolve).relationship).toBe(
      INVESTEE_RELATIONSHIP.associate,
    );
  });

  it('4. joint arrangements: JV → equity (Ind AS 111/28); joint operation → line-by-line', () => {
    const jv = classifyInvestee(investee({ isJointArrangement: true }), true, resolve);
    expect(jv.relationship).toBe(INVESTEE_RELATIONSHIP.jointVenture);
    expect(jv.method).toBe(CONSOLIDATION_METHOD.equityMethod);

    const jo = classifyInvestee(
      investee({ isJointArrangement: true, jointArrangementIsOperation: true }),
      true,
      resolve,
    );
    expect(jo.relationship).toBe(INVESTEE_RELATIONSHIP.jointOperation);
    expect(jo.method).toBe(CONSOLIDATION_METHOD.jointOperationLineByLine);
  });

  it('5. a JV under AS uses proportionate consolidation (AS 27)', () => {
    const jv = classifyInvestee(investee({ isJointArrangement: true }), false, resolve);
    expect(jv.method).toBe(CONSOLIDATION_METHOD.proportionateConsolidation);
  });

  it('6. a future rule-library change to the control presumption affects future periods only', () => {
    const inv = investee({ ownershipPercent: 55 }); // > 50 → subsidiary under the current rule
    expect(classifyInvestee(inv, true, resolve).relationship).toBe(
      INVESTEE_RELATIONSHIP.subsidiary,
    );
    const raised = makeResolver({
      [`${AREA}|${RULE_CRITERION.controlOwnership}|`]: { operator: '>', threshold: 60 },
    });
    // A future period raises the presumption to > 60 → 55% is no longer a subsidiary by %.
    expect(classifyInvestee(inv, true, raised).relationship).toBe(INVESTEE_RELATIONSHIP.associate);
  });
});

describe('assessConsolidation — CFS required / Rule 6 exemption (§9.6 / spec §25)', () => {
  const withSub = (extra: Partial<ConsolidationFacts> = {}) =>
    facts({ investees: [investee({ ownershipPercent: 100, hasControl: true })], ...extra });

  it('7. no subsidiary/associate/JV → §129(3) does not require CFS', () => {
    const r = assessConsolidation(
      facts({ investees: [investee({ ownershipPercent: 5 })] }),
      resolve,
    );
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.notApplicable);
    expect(r.detail.cfsTriggered).toBe(false);
  });

  it('8. a subsidiary but the entity is not itself a subsidiary → CFS required (Rule 6 unavailable)', () => {
    const r = assessConsolidation(withSub(), resolve);
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(r.detail.rule6?.applies).toBe(false);
  });

  it('9. partially-owned Rule 6 needs ALL conditions (missing no-objection → CFS required)', () => {
    const r = assessConsolidation(
      withSub({
        isPartiallyOwnedSubsidiary: true,
        otherMembersIntimatedNoObjection: false,
        parentFilesCompliantCfs: true,
      }),
      resolve,
    );
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
  });

  it('10. all cumulative Rule 6 conditions met → CFS exempt', () => {
    const r = assessConsolidation(
      withSub({
        isPartiallyOwnedSubsidiary: true,
        otherMembersIntimatedNoObjection: true,
        securitiesListedOrInProcess: false,
        parentFilesCompliantCfs: true,
      }),
      resolve,
    );
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.cfsExempt);
    expect(r.detail.rule6?.applies).toBe(true);
  });

  it('11. a listed subsidiary fails Rule 6 → CFS required', () => {
    const r = assessConsolidation(
      withSub({
        isWhollyOwnedSubsidiary: true,
        securitiesListedOrInProcess: true,
        parentFilesCompliantCfs: true,
      }),
      resolve,
    );
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(r.detail.rule6?.notListedCondition).toBe(false);
  });

  it('12. missing parent-CFS-filing status ⇒ pending (information insufficient)', () => {
    const r = assessConsolidation(
      withSub({ isWhollyOwnedSubsidiary: true, parentFilesCompliantCfs: null }),
      resolve,
    );
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.informationInsufficient);
    expect(r.detail.rule6?.applies).toBeNull();
  });

  it('13. a component audited by another auditor ⇒ SA 600 framework', () => {
    const r = assessConsolidation(
      facts({
        investees: [
          investee({ ownershipPercent: 100, hasControl: true, auditedByOtherAuditor: true }),
        ],
      }),
      resolve,
    );
    expect(r.detail.usesOtherAuditors).toBe(true);
    expect(r.detail.saFramework).toBe('SA 600');
  });

  it('14. no hard-coded materiality %, and the cross-link note names one group structure', () => {
    const r = assessConsolidation(withSub(), resolve);
    expect(r.detail.materialityNote).toMatch(/no fixed materiality/i);
    expect(r.detail.materialityNote).not.toMatch(/\d+\s*%/);
    expect(r.detail.crossLinkNote).toMatch(/3\(xxi\)/);
  });

  it('15. information-insufficient until 02.2 is concluded', () => {
    expect(assessConsolidation(facts({ reportingFramework: null }), resolve).outcome).toBe(
      CONSOLIDATION_OUTCOME.informationInsufficient,
    );
  });
});
