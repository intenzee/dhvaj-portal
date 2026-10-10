import {
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  INVESTEE_RELATIONSHIP,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  type ConsolidationDetail,
  type ConsolidationFacts,
  type GroupAuditStatus,
  type InvesteeInput,
  type ResolvedRule,
  type RuleResolver,
} from '@hsdg/contracts';
import { assessConsolidation, classifyInvestee } from './consolidation';
import {
  consolidationCompletion,
  consolidationLegacyMirror,
  consolidationPartnerApprovalReason,
  consolidationSummary,
  isConsolidationDecided,
  perimeterFingerprint,
  priorYearChanges,
  type ConsolidationCompletionInput,
} from './consolidation-completion';

const AREA = FRAMEWORK_AREA_KEY.cfs;
const RULES: Record<string, [ResolvedRule['operator'], number]> = {
  [`${RULE_CRITERION.controlOwnership}|`]: ['>', 50],
  [`${RULE_CRITERION.significantInfluenceOwnership}|`]: ['>=', 20],
  [`${RULE_CRITERION.reportingDateGapMonths}|ind_as_110`]: ['<=', 3],
  [`${RULE_CRITERION.reportingDateGapMonths}|ind_as_28`]: ['<=', 3],
};
const resolve: RuleResolver = (areaKey, criterion, entityClass) => {
  const hit = areaKey === AREA ? RULES[`${criterion}|${entityClass ?? ''}`] : undefined;
  if (!hit) return null;
  return {
    ruleId: 'r',
    ruleCode: criterion.toUpperCase(),
    ruleVersionId: `rv-${criterion}-${entityClass ?? ''}`,
    version: 1,
    areaKey,
    entityClass: entityClass ?? null,
    criterion,
    operator: hit[0],
    unit: 'percent',
    threshold: hit[1],
    thresholdHigh: null,
    measurementBasis: null,
    outcome: null,
    effectiveFrom: '2015-04-01',
    authorityProvisionId: null,
    guidanceReference: null,
    bands: [],
  };
};

function inv(name: string, partial: Partial<InvesteeInput> = {}): InvesteeInput {
  return {
    id: `id-${name}`,
    name,
    ownershipPercent: null,
    hasControl: null,
    isJointArrangement: false,
    jointArrangementIsOperation: false,
    significantInfluenceRebutted: null,
    auditedByOtherAuditor: false,
    ...partial,
  };
}

function detailOf(investees: InvesteeInput[], extra: Partial<ConsolidationFacts> = {}) {
  return assessConsolidation(
    {
      reportingFramework: REPORTING_FRAMEWORK_OUTCOME.indAs,
      investees,
      isWhollyOwnedSubsidiary: false,
      isPartiallyOwnedSubsidiary: false,
      otherMembersIntimatedNoObjection: false,
      securitiesListedOrInProcess: false,
      parentFilesCompliantCfs: null,
      hasBranches: false,
      periodStart: '2024-04-01',
      periodEnd: '2025-03-31',
      ...extra,
    },
    resolve,
  );
}

const SUB_OK = inv('Sub', {
  ownershipPercent: 80,
  controlConclusion: 'yes',
  country: 'IN',
  reportingDate: '2025-03-31',
  localFramework: 'ind_as',
});

const GROUP_DONE: GroupAuditStatus = {
  matrixComplete: true,
  dhvajComponents: 1,
  otherAuditorComponents: 0,
  tbdComponents: 0,
  byComponent: {},
  sa600Required: false,
  sa600Pending: 0,
  instructionsPending: 0,
  pendingReports: 0,
  branchAuditPresent: 'no',
  branchAuditors: 0,
  branchPending: 0,
  workProgrammeGenerated: true,
  blockingMatters: [],
};

function completionInput(
  detail: ConsolidationDetail,
  overrides: Partial<ConsolidationCompletionInput> = {},
): ConsolidationCompletionInput {
  return {
    detail,
    conclusion: CONSOLIDATION_OUTCOME.cfsRequired,
    decided: true,
    professionalAction: 'confirm',
    partnerRequired: false,
    partnerApproved: false,
    needsReevaluation: false,
    upstreamReady: true,
    provisionResolved: true,
    started: true,
    isSubsidiary: false,
    groupAudit: GROUP_DONE,
    crossLinks: { caroComponents: 1, icfrComponents: 1 },
    conversionsOpen: 0,
    ...overrides,
  };
}

const met = (c: ReturnType<typeof consolidationCompletion>, key: string) =>
  c.items.find((i) => i.key === key)?.met;

describe('02.6 CFS-05 Engagement Partner trigger (spec §22)', () => {
  const base = detailOf([SUB_OK]).detail;

  it('no partner approval for a confirmed decisive result with no dispute', () => {
    expect(
      consolidationPartnerApprovalReason({
        conclusion: CONSOLIDATION_OUTCOME.cfsRequired,
        systemOutcome: CONSOLIDATION_OUTCOME.cfsRequired,
        isOverridden: false,
        detail: base,
      }),
    ).toBeNull();
  });

  it('a significant override, Further Assessment or non-decisive system result needs the EP', () => {
    const r = (o: Partial<Parameters<typeof consolidationPartnerApprovalReason>[0]>) =>
      consolidationPartnerApprovalReason({
        conclusion: CONSOLIDATION_OUTCOME.cfsRequired,
        systemOutcome: CONSOLIDATION_OUTCOME.cfsRequired,
        isOverridden: false,
        detail: base,
        ...o,
      });
    expect(r({ isOverridden: true })).toMatch(/significant override/);
    expect(r({ conclusion: CONSOLIDATION_OUTCOME.furtherAssessment })).toMatch(
      /Further Assessment/,
    );
    expect(r({ systemOutcome: CONSOLIDATION_OUTCOME.informationInsufficient })).toMatch(
      /could not determine/,
    );
    expect(r({ conclusion: null })).toBeNull();
  });

  it('a control dispute (no control despite > 50% voting) needs the EP', () => {
    const d = detailOf([
      SUB_OK,
      inv('Disputed', { votingDirect: 60, controlConclusion: 'no', significantInfluence: 'yes' }),
    ]).detail;
    const disputed = d.perimeter.find((p) => p.name === 'Disputed')!;
    expect(disputed.relationship).toBe(INVESTEE_RELATIONSHIP.associate);
    expect(disputed.presumptionRebutted).toMatch(/No control concluded despite voting power 60%/);
    expect(
      consolidationPartnerApprovalReason({
        conclusion: CONSOLIDATION_OUTCOME.cfsRequired,
        systemOutcome: CONSOLIDATION_OUTCOME.cfsRequired,
        isOverridden: false,
        detail: d,
      }),
    ).toMatch(/Control \/ influence dispute: Disputed/);
  });

  it('rebutting the 20% significant-influence presumption is a dispute too', () => {
    const c = classifyInvestee(
      inv('Rebutted', { votingDirect: 25, controlConclusion: 'no', significantInfluence: 'no' }),
      true,
      resolve,
    );
    expect(c.relationship).toBe(INVESTEE_RELATIONSHIP.none);
    expect(c.presumptionRebutted).toMatch(/Significant-influence presumption rebutted/);
  });

  it('a perimeter dispute (inclusion changed from the proposal) needs the EP', () => {
    const d = detailOf([
      SUB_OK,
      inv('Excluded', {
        ownershipPercent: 70,
        controlConclusion: 'yes',
        included: 'no',
        inclusionReason: 'Held for sale',
      }),
    ]).detail;
    expect(
      consolidationPartnerApprovalReason({
        conclusion: CONSOLIDATION_OUTCOME.cfsRequired,
        systemOutcome: CONSOLIDATION_OUTCOME.cfsRequired,
        isOverridden: false,
        detail: d,
      }),
    ).toMatch(/Perimeter dispute: inclusion changed from the system proposal for Excluded/);
  });
});

describe('02.6 Section 02 "CFS" mirror', () => {
  it('maps CFS required → applicable and exempt / not applicable → not applicable', () => {
    expect(consolidationLegacyMirror(CONSOLIDATION_OUTCOME.cfsRequired, null, false)).toEqual({
      suggestion: 'applicable',
      conclusion: null,
      state: 'system_suggested_applicable',
    });
    expect(consolidationLegacyMirror(CONSOLIDATION_OUTCOME.cfsExempt, null, false).state).toBe(
      'system_suggested_not_applicable',
    );
    expect(
      consolidationLegacyMirror(
        CONSOLIDATION_OUTCOME.cfsRequired,
        CONSOLIDATION_OUTCOME.cfsExempt,
        true,
      ),
    ).toEqual({ suggestion: 'applicable', conclusion: 'not_applicable', state: 'overridden' });
  });

  it('never invents a suggestion the engine could not reach', () => {
    expect(consolidationLegacyMirror(CONSOLIDATION_OUTCOME.furtherAssessment, null, false)).toEqual(
      { suggestion: null, conclusion: null, state: 'professional_judgement_required' },
    );
    expect(
      consolidationLegacyMirror(CONSOLIDATION_OUTCOME.informationInsufficient, null, false, true)
        .state,
    ).toBe('pending_information');
  });

  it('a recorded Further Assessment conclusion counts as decided', () => {
    expect(isConsolidationDecided('professional_judgement_required', 'further_assessment')).toBe(
      true,
    );
    expect(isConsolidationDecided('professional_judgement_required', null)).toBe(false);
  });
});

describe('02.6 completion checklist (spec §24)', () => {
  it('a confirmed CFS-required file with the group-audit work done is complete', () => {
    const c = consolidationCompletion(completionInput(detailOf([SUB_OK]).detail));
    expect(c.items.filter((i) => i.met === false)).toEqual([]);
    expect(c.complete).toBe(true);
    expect(c.status).toBe('complete');
  });

  it('is not complete until the auditor matrix, SA 600 work and work programme are done', () => {
    const detail = detailOf([SUB_OK]).detail;
    const c = consolidationCompletion(
      completionInput(detail, {
        groupAudit: {
          ...GROUP_DONE,
          matrixComplete: false,
          sa600Required: true,
          sa600Pending: 1,
          instructionsPending: 1,
          workProgrammeGenerated: false,
        },
      }),
    );
    expect(c.complete).toBe(false);
    expect(met(c, 'auditor_matrix')).toBe(false);
    expect(met(c, 'sa600_configured')).toBe(false);
    expect(met(c, 'work_programme')).toBe(false);
  });

  it('needs the Engagement Partner when required', () => {
    const detail = detailOf([SUB_OK]).detail;
    const c = consolidationCompletion(completionInput(detail, { partnerRequired: true }));
    expect(met(c, 'manager_and_partner')).toBe(false);
    expect(
      met(
        consolidationCompletion(
          completionInput(detail, { partnerRequired: true, partnerApproved: true }),
        ),
        'manager_and_partner',
      ),
    ).toBe(true);
  });

  it('flags missing reporting-date / local framework capture (CFS-03 / CFS-04)', () => {
    const detail = detailOf([
      inv('Sub', { ownershipPercent: 80, controlConclusion: 'yes' }),
    ]).detail;
    const c = consolidationCompletion(completionInput(detail));
    expect(met(c, 'differences_identified')).toBe(false);
  });

  it('a CFS-exempt file needs Rule 6 tested but no group-audit or cross-link work', () => {
    const detail = detailOf([SUB_OK]).detail;
    const c = consolidationCompletion(
      completionInput(detail, {
        conclusion: CONSOLIDATION_OUTCOME.cfsExempt,
        isSubsidiary: true,
        groupAudit: null,
        crossLinks: { caroComponents: null, icfrComponents: null },
      }),
    );
    expect(met(c, 'auditor_matrix')).toBeNull();
    expect(met(c, 'work_programme')).toBeNull();
    expect(met(c, 'cross_links')).toBeNull();
    expect(met(c, 'rule6_tested')).toBe(true);
  });

  it('branch auditors (section 143(8)) count toward completion with or without a CFS (spec §17)', () => {
    const detail = detailOf([SUB_OK]).detail;
    const exempt = (g: Partial<GroupAuditStatus>) =>
      consolidationCompletion(
        completionInput(detail, {
          conclusion: CONSOLIDATION_OUTCOME.cfsExempt,
          isSubsidiary: true,
          groupAudit: { ...GROUP_DONE, matrixComplete: false, ...g },
          crossLinks: { caroComponents: null, icfrComponents: null },
        }),
      );
    // No branches, no CFS: nothing to do.
    expect(met(exempt({ branchAuditPresent: 'no' }), 'auditor_matrix')).toBeNull();
    // BR-01 unanswered blocks even a standalone file.
    const pending = exempt({ branchAuditPresent: 'pending' });
    expect(met(pending, 'auditor_matrix')).toBe(false);
    expect(pending.items.find((x) => x.key === 'auditor_matrix')?.detail).toMatch(/BR-01/);
    // BR-01 Yes needs a branch record, each with its report and response.
    expect(met(exempt({ branchAuditPresent: 'yes', branchAuditors: 0 }), 'auditor_matrix')).toBe(
      false,
    );
    expect(
      met(
        exempt({ branchAuditPresent: 'yes', branchAuditors: 2, branchPending: 1 }),
        'auditor_matrix',
      ),
    ).toBe(false);
    expect(
      met(
        exempt({ branchAuditPresent: 'yes', branchAuditors: 2, branchPending: 0 }),
        'auditor_matrix',
      ),
    ).toBe(true);
    // CFS required: the component matrix and the branch records both count.
    const cfs = consolidationCompletion(
      completionInput(detail, {
        groupAudit: {
          ...GROUP_DONE,
          branchAuditPresent: 'yes',
          branchAuditors: 1,
          branchPending: 1,
        },
      }),
    );
    expect(met(cfs, 'auditor_matrix')).toBe(false);
  });

  it('Information Pending and undecided files are in progress, never complete', () => {
    const detail = detailOf([SUB_OK]).detail;
    const c = consolidationCompletion(
      completionInput(detail, {
        decided: false,
        conclusion: null,
        professionalAction: 'information_pending',
      }),
    );
    expect(c.complete).toBe(false);
    expect(c.status).toBe('in_progress');
    expect(c.items.find((i) => i.key === 'cfs_concluded')?.detail).toMatch(/Information Pending/);
  });

  it('cross links unmet when CARO / ICFR are in scope with no 02.6 components', () => {
    const c = consolidationCompletion(
      completionInput(detailOf([SUB_OK]).detail, {
        crossLinks: { caroComponents: 0, icfrComponents: null },
      }),
    );
    expect(met(c, 'cross_links')).toBe(false);
  });

  it('re-evaluation and blocking matters block completion', () => {
    const detail = detailOf([SUB_OK]).detail;
    expect(
      met(
        consolidationCompletion(completionInput(detail, { needsReevaluation: true })),
        'no_blocking_matter',
      ),
    ).toBe(false);
    expect(
      met(
        consolidationCompletion(
          completionInput(detail, {
            groupAudit: { ...GROUP_DONE, blockingMatters: ['Material GA-04 pending'] },
          }),
        ),
        'no_blocking_matter',
      ),
    ).toBe(false);
  });
});

describe('02.6 summary + re-evaluation fingerprint', () => {
  it('summarises CFS required, counts, framework and group-audit figures', () => {
    const { detail } = detailOf([SUB_OK]);
    const s = consolidationSummary(CONSOLIDATION_OUTCOME.cfsRequired, detail, GROUP_DONE);
    expect(s).toMatchObject({
      cfsRequired: true,
      counts: { subsidiary: 1 },
      framework: 'Ind AS',
      dhvajComponents: 1,
      workProgrammeGenerated: true,
    });
  });

  it('changes when a component relationship or inclusion changes', () => {
    const a = detailOf([SUB_OK]);
    const b = detailOf([{ ...SUB_OK, controlConclusion: 'no', significantInfluence: 'yes' }]);
    expect(perimeterFingerprint(a.outcome, a.detail)).toBe(
      perimeterFingerprint(a.outcome, detailOf([SUB_OK]).detail),
    );
    expect(perimeterFingerprint(a.outcome, a.detail)).not.toBe(
      perimeterFingerprint(b.outcome, b.detail),
    );
  });

  it('ignores CFS-03 / CFS-04 data — a decided conclusion is not reopened by it', () => {
    const a = detailOf([SUB_OK]);
    const b = detailOf([{ ...SUB_OK, reportingDate: '2024-12-31', localFramework: 'ifrs' }]);
    expect(perimeterFingerprint(a.outcome, a.detail)).toBe(
      perimeterFingerprint(b.outcome, b.detail),
    );
  });
});

describe('02.6 prior-year roll-forward indicators (spec §21)', () => {
  it('names new, disposed, ownership, reporting-date, framework and conclusion changes', () => {
    const prior = detailOf([
      SUB_OK,
      inv('Gone', { ownershipPercent: 60, controlConclusion: 'yes', country: 'IN' }),
      inv('Assoc', { votingDirect: 25, reportingDate: '2024-12-31', localFramework: 'ind_as' }),
    ]);
    const current = detailOf(
      [
        { ...SUB_OK, ownershipPercent: 90, localFramework: 'ifrs' },
        inv('Assoc', { votingDirect: 25, reportingDate: '2025-09-30', localFramework: 'ind_as' }),
        inv('New', { ownershipPercent: 100, controlConclusion: 'yes' }),
      ],
      { reportingFramework: REPORTING_FRAMEWORK_OUTCOME.accountingStandards },
    );
    const kinds = priorYearChanges(
      { outcome: CONSOLIDATION_OUTCOME.cfsExempt, detail: prior.detail },
      { outcome: current.outcome, detail: current.detail },
    ).map((c) => `${c.kind}:${c.componentName ?? '-'}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'ownership_change:Sub',
        'framework_change:Sub',
        'reporting_date_change:Assoc',
        'new_component:New',
        'disposed_component:Gone',
        'framework_change:-',
        'conclusion_change:-',
      ]),
    );
  });

  it('matches a pre-id component by name', () => {
    const prior = detailOf([{ ...SUB_OK, id: undefined }]);
    const current = detailOf([SUB_OK]);
    expect(
      priorYearChanges(
        { outcome: prior.outcome, detail: prior.detail },
        { outcome: current.outcome, detail: current.detail },
      ),
    ).toEqual([]);
  });
});
