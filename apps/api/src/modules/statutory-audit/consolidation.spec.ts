import {
  CONSOLIDATION_METHOD,
  CONSOLIDATION_OUTCOME,
  EMPTY_RULE6_EVIDENCE,
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
  // Reporting-date gap maxima (migration 1767600000000).
  [`${AREA}|${RULE_CRITERION.reportingDateGapMonths}|as_21`]: { operator: '<=', threshold: 6 },
  [`${AREA}|${RULE_CRITERION.reportingDateGapMonths}|ind_as_110`]: { operator: '<=', threshold: 3 },
  [`${AREA}|${RULE_CRITERION.reportingDateGapMonths}|ind_as_28`]: { operator: '<=', threshold: 3 },
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
        securitiesListedOrInProcess: false,
        parentFilesCompliantCfs: true,
        rule6Evidence: {
          ...EMPTY_RULE6_EVIDENCE,
          otherMembersIntimatedInWriting: true,
          proofOfDeliveryRetained: true,
          objectionStatus: 'no_objection',
          parentName: 'Parent Ltd',
          parentFilingSrn: 'F12345678',
        },
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

describe('02.6 spec v1.0 — relationship, Rule 6 evidence, perimeter, CFS-03/04 (§25)', () => {
  const AS = REPORTING_FRAMEWORK_OUTCOME.accountingStandards;
  const period = { periodStart: '2025-04-01', periodEnd: '2026-03-31' };
  const sub = (p: Partial<InvesteeInput> = {}) =>
    investee({ name: 'Sub', controlConclusion: 'yes', ...p });

  it('AS: > 50% VOTING power suggests AS 21 control; board-composition control works without the %', () => {
    const byVoting = classifyInvestee(
      investee({ votingDirect: 51, ownershipPercent: 40 }),
      false,
      resolve,
    );
    expect(byVoting.relationship).toBe(INVESTEE_RELATIONSHIP.subsidiary);
    expect(byVoting.standard).toBe('AS 21');
    expect(byVoting.judgementRequired).toBe(false);

    const byBoard = classifyInvestee(
      investee({ votingDirect: 30, boardCompositionControl: true }),
      false,
      resolve,
    );
    expect(byBoard.relationship).toBe(INVESTEE_RELATIONSHIP.subsidiary);
    expect(byBoard.basis).toMatch(/board composition/);

    // Voting power (not ownership) is the AS 21 indicator.
    const lowVoting = classifyInvestee(
      investee({ ownershipPercent: 60, votingDirect: 45 }),
      false,
      resolve,
    );
    expect(lowVoting.relationship).toBe(INVESTEE_RELATIONSHIP.associate);
  });

  it('Ind AS control is not a simple > 50% test — the % is an indicator needing confirmation', () => {
    const indicated = classifyInvestee(investee({ votingDirect: 80 }), true, resolve);
    expect(indicated.relationship).toBe(INVESTEE_RELATIONSHIP.subsidiary);
    expect(indicated.judgementRequired).toBe(true);
    expect(indicated.basis).toMatch(/not a percentage test/);

    const noControl = classifyInvestee(
      investee({ votingDirect: 80, controlConclusion: 'no' }),
      true,
      resolve,
    );
    expect(noControl.relationship).not.toBe(INVESTEE_RELATIONSHIP.subsidiary);

    const confirmed = classifyInvestee(
      investee({ votingDirect: 40, controlConclusion: 'yes' }),
      true,
      resolve,
    );
    expect(confirmed.relationship).toBe(INVESTEE_RELATIONSHIP.subsidiary);
    expect(confirmed.judgementRequired).toBe(false);
  });

  it('20%+ is a rebuttable SI presumption; < 20% does not prevent documented significant influence', () => {
    expect(classifyInvestee(investee({ votingDirect: 20 }), false, resolve).relationship).toBe(
      INVESTEE_RELATIONSHIP.associate,
    );
    expect(
      classifyInvestee(investee({ votingDirect: 25, significantInfluence: 'no' }), true, resolve)
        .relationship,
    ).toBe(INVESTEE_RELATIONSHIP.none);
    expect(
      classifyInvestee(investee({ votingDirect: 12, significantInfluence: 'yes' }), true, resolve)
        .relationship,
    ).toBe(INVESTEE_RELATIONSHIP.associate);
    // Recorded as an associate below 20% → further assessment, never silently dropped.
    const recorded = classifyInvestee(
      investee({ votingDirect: 12, suggestedRelationship: 'associate' }),
      false,
      resolve,
    );
    expect(recorded.relationship).toBe(INVESTEE_RELATIONSHIP.furtherAssessment);
    expect(recorded.included).toBe('pending');
  });

  it('joint control comes only from the contract — "further assessment" keeps the component pending', () => {
    const jv = classifyInvestee(
      investee({ votingDirect: 50, jointControl: 'yes' }),
      false,
      resolve,
    );
    expect(jv.relationship).toBe(INVESTEE_RELATIONSHIP.jointVenture);
    const pending = classifyInvestee(
      investee({ votingDirect: 50, jointControl: 'further_assessment' }),
      false,
      resolve,
    );
    expect(pending.included).toBe('pending');
    const only = assessConsolidation(
      facts({ investees: [investee({ jointControl: 'further_assessment' })] }),
      resolve,
    );
    expect(only.outcome).toBe(CONSOLIDATION_OUTCOME.furtherAssessment);
  });

  it('partially-owned: exemption only with written intimation + proof + no objection; silence is not consent', () => {
    const base = {
      isPartiallyOwnedSubsidiary: true,
      parentFilesCompliantCfs: true,
      investees: [sub()],
    };
    const ev = {
      ...EMPTY_RULE6_EVIDENCE,
      parentFilingSrn: 'F1',
      otherMembersIntimatedInWriting: true,
      proofOfDeliveryRetained: true,
    };
    const awaiting = assessConsolidation(
      facts({ ...base, rule6Evidence: { ...ev, objectionStatus: 'awaiting' } }),
      resolve,
    );
    expect(awaiting.outcome).toBe(CONSOLIDATION_OUTCOME.informationInsufficient);
    expect(awaiting.detail.rule6?.result).toBe('pending');
    const objected = assessConsolidation(
      facts({ ...base, rule6Evidence: { ...ev, objectionStatus: 'objection_received' } }),
      resolve,
    );
    expect(objected.outcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    const noProof = assessConsolidation(
      facts({
        ...base,
        rule6Evidence: { ...ev, proofOfDeliveryRetained: false, objectionStatus: 'no_objection' },
      }),
      resolve,
    );
    expect(noProof.detail.rule6?.result).toBe('pending');
    const ok = assessConsolidation(
      facts({ ...base, rule6Evidence: { ...ev, objectionStatus: 'no_objection' } }),
      resolve,
    );
    expect(ok.outcome).toBe(CONSOLIDATION_OUTCOME.cfsExempt);
    expect(ok.detail.rule6?.conditions?.map((c) => c.result)).toEqual([
      'satisfied',
      'satisfied',
      'satisfied',
      'satisfied',
    ]);
  });

  it('missing parent compliant-CFS filing evidence makes the exemption Pending (Unavailable when No)', () => {
    const base = { isWhollyOwnedSubsidiary: true, investees: [sub()] };
    const noEvidence = assessConsolidation(
      facts({ ...base, parentFilesCompliantCfs: true }),
      resolve,
    );
    expect(noEvidence.outcome).toBe(CONSOLIDATION_OUTCOME.informationInsufficient);
    expect(noEvidence.detail.missingFacts?.some((m) => m.key === 'rule6_parent_filing')).toBe(true);
    const no = assessConsolidation(facts({ ...base, parentFilesCompliantCfs: false }), resolve);
    expect(no.outcome).toBe(CONSOLIDATION_OUTCOME.cfsRequired);
    expect(no.detail.rule6?.conditions?.find((c) => c.key === 'other_members')?.result).toBe(
      'not_applicable',
    );
  });

  it('a joint operation alone does not trigger §129(3)', () => {
    const r = assessConsolidation(
      facts({
        investees: [investee({ isJointArrangement: true, jointArrangementIsOperation: true })],
      }),
      resolve,
    );
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.notApplicable);
    expect(r.detail.perimeter[0]?.included).toBe('yes');
  });

  it('effective dates: a relationship ended before the period is excluded, history retained', () => {
    const r = assessConsolidation(
      facts({
        ...period,
        investees: [
          sub({ name: 'Old', effectiveTo: '2024-12-31' }),
          sub({ name: 'New', effectiveFrom: '2025-10-01' }),
        ],
      }),
      resolve,
    );
    const [old, fresh] = r.detail.perimeter;
    expect(old?.included).toBe('no');
    expect(old?.periodImpact).toBe('outside_period');
    expect(fresh?.periodImpact).toBe('acquired_in_period');
    expect(r.detail.counts?.subsidiary).toBe(1);
  });

  it('a professional inclusion decision overrides the proposal and keeps its reason', () => {
    const r = assessConsolidation(
      facts({ investees: [sub({ included: 'no', inclusionReason: 'Held for sale' })] }),
      resolve,
    );
    expect(r.detail.perimeter[0]?.systemIncluded).toBe('yes');
    expect(r.detail.perimeter[0]?.included).toBe('no');
    expect(r.detail.perimeter[0]?.inclusionReason).toBe('Held for sale');
    expect(r.outcome).toBe(CONSOLIDATION_OUTCOME.notApplicable);
  });

  it('CFS-03: the reporting-date maximum comes from the rule per standard, never hard-coded', () => {
    const indAs = assessConsolidation(
      facts({ ...period, investees: [sub({ reportingDate: '2025-12-31' })] }),
      resolve,
    );
    const rd = indAs.detail.perimeter[0]?.reportingDate;
    expect(rd?.sameAsGroup).toBe(false);
    expect(rd?.maxGapMonths).toBe(3);
    expect(rd?.withinLimit).toBe(true);
    expect(rd?.missing).toEqual(
      expect.arrayContaining([
        'Reason for the different reporting date',
        'Interim financial information',
      ]),
    );
    expect(indAs.detail.rulesUsed?.some((x) => x.label.includes('Reporting-date gap'))).toBe(true);

    const as = assessConsolidation(
      facts({
        ...period,
        reportingFramework: AS,
        investees: [investee({ name: 'Sub', votingDirect: 100, reportingDate: '2025-09-30' })],
      }),
      resolve,
    );
    expect(as.detail.perimeter[0]?.reportingDate?.maxGapMonths).toBe(6);
    expect(as.detail.perimeter[0]?.reportingDate?.withinLimit).toBe(true);

    const tooOld = assessConsolidation(
      facts({ ...period, investees: [sub({ reportingDate: '2025-09-30' })] }),
      resolve,
    );
    expect(tooOld.detail.perimeter[0]?.reportingDate?.withinLimit).toBe(false);

    // No rule configured (AS 23 associate) → no invented limit.
    const assoc = assessConsolidation(
      facts({
        ...period,
        reportingFramework: AS,
        investees: [investee({ name: 'A', votingDirect: 30, reportingDate: '2025-12-31' })],
      }),
      resolve,
    );
    expect(assoc.detail.perimeter[0]?.reportingDate?.maxGapMonths).toBeNull();
    expect(assoc.detail.perimeter[0]?.reportingDate?.basis).toMatch(/No maximum gap is configured/);
  });

  it('CFS-04: a different local GAAP needs conversion without altering the component; same is aligned', () => {
    const r = assessConsolidation(
      facts({
        investees: [
          sub({ name: 'Foreign', localFramework: 'ifrs' }),
          sub({ name: 'Local', localFramework: 'ind_as' }),
          sub({ name: 'Unknown' }),
        ],
      }),
      resolve,
    );
    const [foreign, local, unknown] = r.detail.perimeter;
    expect(foreign?.policy?.result).toBe('conversion_required');
    expect(foreign?.policy?.basis).toMatch(/statutory accounts are preserved/);
    expect(local?.policy?.result).toBe('aligned');
    expect(unknown?.policy?.result).toBe('further_assessment');
    expect(r.detail.conversionsRequired).toBe(1);
  });

  it('shows the facts and rule versions used, and lists outstanding information', () => {
    const r = assessConsolidation(
      facts({ ...period, investees: [investee({ name: 'S', ownershipPercent: 80 })] }),
      resolve,
    );
    expect(r.detail.factsUsed?.map((x) => x.key)).toEqual(
      expect.arrayContaining(['group_framework', 'parent', 'listing']),
    );
    expect(r.detail.rulesUsed?.length).toBeGreaterThan(0);
    const keys = r.detail.missingFacts?.map((m) => m.key) ?? [];
    expect(keys).toEqual(
      expect.arrayContaining([
        'relationship_conclusion',
        'voting_power',
        'country',
        'reporting_date',
        'local_framework',
      ]),
    );
  });
});
