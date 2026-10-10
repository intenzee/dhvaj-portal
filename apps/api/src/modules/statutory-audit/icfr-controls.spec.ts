import type { IcfrLibraryArea, IcfrWorkstreamLevel1 } from '@hsdg/contracts';
import {
  ICFR_DEFICIENCY_METHODOLOGY,
  areasInForce,
  componentMissing,
  consolidatedConclusionBlockers,
  controlBlockers,
  controlOverall,
  deficiencyBlockers,
  icfrProcedureSourceKey,
  needsFollowUp,
  planConsolidated,
  planIcfrProcedures,
  planWorkstream,
  suggestDeficiencyClass,
  suggestParentConclusion,
  suggestScoping,
  summariseDeficiencies,
  workstreamConclusionBlockers,
  type ComponentForConclusion,
  type DeficiencyForReview,
  type ScopingFacts,
} from './icfr-controls';

const level1 = (o: Partial<IcfrWorkstreamLevel1> = {}): IcfrWorkstreamLevel1 => ({
  outcome: 'applicable',
  decided: true,
  reportingApplies: true,
  consolidatedStatus: 'not_applicable',
  financialYear: '2025-26',
  periodStart: '2025-04-01',
  ...o,
});

const area = (o: Partial<IcfrLibraryArea>): IcfrLibraryArea => ({
  id: 'a',
  frameworkCode: 'DHVAJ_ICFR',
  frameworkLabel: 'DHVAJ ICFR v1',
  areaKey: 'revenue',
  title: 'Revenue',
  description: '',
  activation: 'fact_risk',
  triggerAreaCodes: ['REV', 'AR'],
  triggerKeywords: ['revenue', 'receivable'],
  procedures: [
    { key: 'rev_controls', title: 'Test revenue controls', objective: 'o', evidence: 'e' },
  ],
  sortOrder: 1,
  effectiveFrom: '2015-04-01',
  effectiveTo: null,
  ...o,
});

const facts = (o: Partial<ScopingFacts> = {}): ScopingFacts => ({
  areas: [],
  risks: [],
  accountingSoftware: null,
  recordsElectronic: null,
  ...o,
});

describe('planWorkstream', () => {
  it('instantiates when reporting applies (decided or suggested)', () => {
    expect(planWorkstream(level1(), null, true)).toMatchObject({
      state: 'active',
      action: 'ensure',
    });
    expect(planWorkstream(level1({ decided: false }), null, true).reason).toMatch(
      /follows the final/,
    );
  });
  it('withdraws an active workstream when exempt, never deleting it', () => {
    const p = planWorkstream(
      level1({ outcome: 'exempt', reportingApplies: false }),
      { status: 'active' },
      true,
    );
    expect(p).toMatchObject({ state: 'withdrawn', action: 'withdraw' });
    expect(p.reason).toMatch(/Section 05 internal controls remain active/);
  });
  it('is not required when exempt and nothing exists', () => {
    expect(planWorkstream(level1({ reportingApplies: false }), null, true)).toMatchObject({
      state: 'not_required',
      action: 'none',
    });
  });
  it('waits while 02.5 is pending, keeping what exists', () => {
    expect(planWorkstream(null, null, true).state).toBe('awaiting_conclusion');
    expect(
      planWorkstream(
        level1({ outcome: 'further_assessment', reportingApplies: null }),
        { status: 'active' },
        true,
      ),
    ).toMatchObject({ state: 'active', action: 'none' });
  });
  it('does not instantiate without a framework in force', () => {
    expect(planWorkstream(level1(), null, false)).toMatchObject({ action: 'none' });
  });
});

describe('areasInForce', () => {
  it('picks the latest version in force per area key, in order', () => {
    const lib = [
      area({ id: '1', areaKey: 'revenue', sortOrder: 2 }),
      area({ id: '2', areaKey: 'revenue', sortOrder: 2, effectiveFrom: '2024-04-01' }),
      area({ id: '3', areaKey: 'entity_level', sortOrder: 0 }),
      area({ id: '4', areaKey: 'future', effectiveFrom: '2030-04-01' }),
    ];
    expect(areasInForce(lib, '2025-04-01').map((a) => a.id)).toEqual(['3', '2']);
    expect(areasInForce(lib, '2020-04-01').map((a) => a.id)).toEqual(['3', '1']);
  });
});

describe('suggestScoping', () => {
  it('always-areas are in scope', () => {
    expect(suggestScoping(area({ activation: 'always' }), facts()).scoping).toBe('in_scope');
  });
  it('a retained significant account puts a process in scope with the basis', () => {
    const s = suggestScoping(
      area({}),
      facts({ areas: [{ code: 'REV', name: 'Revenue', attention: 'enhanced' }] }),
    );
    expect(s.scoping).toBe('in_scope');
    expect(s.basis).toMatch(/Revenue \(Enhanced attention\) \(03\.5\)/);
  });
  it('a Section 04 risk puts a process in scope', () => {
    const s = suggestScoping(
      area({}),
      facts({
        risks: [
          { ref: 'R-001', fsArea: 'Trade receivables', description: 'x', isSignificant: true },
        ],
      }),
    );
    expect(s).toMatchObject({ scoping: 'in_scope' });
    expect(s.basis).toMatch(/R-001 \(significant\)/);
  });
  it('no account or risk → not in scope, never every process mandatory', () => {
    expect(suggestScoping(area({}), facts()).scoping).toBe('not_in_scope');
  });
  it('ITGC follows the IT dependency', () => {
    const itgc = area({
      activation: 'it_dependency',
      triggerAreaCodes: [],
      triggerKeywords: ['it general'],
    });
    expect(suggestScoping(itgc, facts({ accountingSoftware: 'tally' })).scoping).toBe('in_scope');
    expect(suggestScoping(itgc, facts({ recordsElectronic: 'no' })).scoping).toBe('not_in_scope');
    expect(suggestScoping(itgc, facts()).scoping).toBe('to_be_scoped');
  });
  it('scoping-only areas wait for the team', () => {
    expect(suggestScoping(area({ activation: 'scoping' }), facts()).scoping).toBe('to_be_scoped');
  });
});

describe('planIcfrProcedures', () => {
  it('plans one procedure per step of each in-scope area plus the conclusion', () => {
    const ps = planIcfrProcedures([
      {
        areaKey: 'revenue',
        title: 'Revenue',
        scoping: 'in_scope',
        withdrawn: false,
        procedures: area({}).procedures,
      },
      {
        areaKey: 'inventory',
        title: 'Inventory',
        scoping: 'not_in_scope',
        withdrawn: false,
        procedures: area({}).procedures,
      },
    ]);
    expect(ps.map((p) => p.sourceKey)).toEqual([
      icfrProcedureSourceKey('revenue', 'rev_controls'),
      'icfr:workstream:conclusion',
    ]);
  });
  it('plans nothing without an in-scope area', () => {
    expect(planIcfrProcedures([])).toEqual([]);
  });
});

describe('controlOverall', () => {
  it('keeps design, implementation and operating effectiveness separate', () => {
    expect(
      controlOverall({ design: null, implementation: null, operatingEffectiveness: null }),
    ).toBe('not_assessed');
    expect(
      controlOverall({
        design: 'deficiency',
        implementation: 'implemented',
        operatingEffectiveness: 'effective',
      }),
    ).toBe('design_deficiency');
    expect(
      controlOverall({
        design: 'adequate',
        implementation: 'not_implemented',
        operatingEffectiveness: null,
      }),
    ).toBe('not_implemented');
    expect(
      controlOverall({
        design: 'adequate',
        implementation: 'implemented',
        operatingEffectiveness: 'effective',
      }),
    ).toBe('effective');
    expect(
      controlOverall({
        design: 'adequate',
        implementation: 'implemented',
        operatingEffectiveness: 'not_tested',
      }),
    ).toBe('design_implementation_only');
    expect(
      controlOverall({
        design: 'adequate',
        implementation: 'implemented',
        operatingEffectiveness: 'exception_identified',
      }),
    ).toBe('operating_exception');
    expect(
      controlOverall({ design: 'adequate', implementation: null, operatingEffectiveness: null }),
    ).toBe('in_progress');
  });
});

describe('controlBlockers', () => {
  const base = {
    purposeIcfr: true,
    design: 'adequate' as const,
    implementation: 'implemented' as const,
    operatingEffectiveness: 'effective' as const,
    testNote: null,
    evidence: 1,
    deficiencies: 0,
  };
  it('a complete control has none', () => expect(controlBlockers(base)).toEqual([]));
  it('an ICFR control concludes operating effectiveness; an FS-only one need not', () => {
    expect(controlBlockers({ ...base, operatingEffectiveness: null })).toHaveLength(1);
    expect(controlBlockers({ ...base, purposeIcfr: false, operatingEffectiveness: null })).toEqual(
      [],
    );
  });
  it('not tested needs a reason; evidence is required; a deficient control raises a deficiency', () => {
    expect(controlBlockers({ ...base, operatingEffectiveness: 'not_tested' })).toEqual([
      'Say why operating effectiveness was not tested.',
    ]);
    expect(controlBlockers({ ...base, evidence: 0 })).toEqual([
      'Link the evidence the conclusion rests on.',
    ]);
    expect(controlBlockers({ ...base, design: 'deficiency' })[0]).toMatch(/deficiency register/);
    expect(controlBlockers({ ...base, design: 'deficiency', deficiencies: 1 })).toEqual([]);
  });
});

describe('deficiency methodology', () => {
  it('magnitude × likelihood suggests the classification', () => {
    expect(suggestDeficiencyClass('material', 'probable')).toBe('material_weakness');
    expect(suggestDeficiencyClass('material', 'remote')).toBe('significant_deficiency');
    expect(suggestDeficiencyClass('more_than_inconsequential', 'reasonably_possible')).toBe(
      'significant_deficiency',
    );
    expect(suggestDeficiencyClass('inconsequential', 'probable')).toBe('control_deficiency');
    expect(suggestDeficiencyClass(null, 'probable')).toBeNull();
    expect(ICFR_DEFICIENCY_METHODOLOGY.matrix).toHaveLength(9);
  });

  const d = (o: Partial<DeficiencyForReview> = {}): DeficiencyForReview => ({
    classification: 'significant_deficiency',
    magnitude: 'more_than_inconsequential',
    likelihood: 'probable',
    assertions: ['occurrence'],
    affected: true,
    compensatingControls: 0,
    compensatingNote: null,
    remediationAction: 'Fix it',
    remediationStatus: 'in_progress',
    auditImpact: 'Extended substantive testing',
    reportingImpact: 'tcwg_communication',
    reviewed: false,
    ...o,
  });

  it('a complete deficiency passes the Manager review', () => {
    expect(deficiencyBlockers(d(), 'manager_review')).toEqual([]);
  });
  it('a lower classification than the methodology needs compensating controls', () => {
    expect(
      deficiencyBlockers(d({ classification: 'control_deficiency' }), 'manager_review')[0],
    ).toMatch(/compensating controls/);
    expect(
      deficiencyBlockers(
        d({ classification: 'control_deficiency', compensatingNote: 'Monthly review' }),
        'manager_review',
      ),
    ).toEqual([]);
  });
  it('a material weakness modifies the ICFR opinion', () => {
    expect(
      deficiencyBlockers(
        d({ classification: 'material_weakness', magnitude: 'material' }),
        'manager_review',
      ),
    ).toContain('A material weakness modifies the ICFR opinion — set the reporting impact.');
  });
  it('only SD / MW go to the Partner, after the Manager', () => {
    expect(deficiencyBlockers(d(), 'partner_conclude')).toEqual([
      'The Manager reviews the deficiency first.',
    ]);
    expect(deficiencyBlockers(d({ reviewed: true }), 'partner_conclude')).toEqual([]);
    expect(
      deficiencyBlockers(
        d({ classification: 'control_deficiency', reviewed: true }),
        'partner_conclude',
      ),
    ).toHaveLength(1);
  });
  it('summarises the register', () => {
    const s = summariseDeficiencies([
      {
        classification: 'material_weakness',
        status: 'open',
        reviewed: true,
        partnerConcluded: false,
        withdrawn: false,
      },
      {
        classification: 'control_deficiency',
        status: 'closed',
        reviewed: false,
        partnerConcluded: false,
        withdrawn: false,
      },
      {
        classification: 'significant_deficiency',
        status: 'open',
        reviewed: true,
        partnerConcluded: true,
        withdrawn: true,
      },
    ]);
    expect(s).toEqual({
      total: 2,
      open: 1,
      controlDeficiencies: 1,
      significantDeficiencies: 0,
      materialWeaknesses: 1,
      awaitingReview: 1,
      awaitingPartner: 1,
    });
  });
});

describe('needsFollowUp', () => {
  it('follows up SD / MW and any unremediated deficiency', () => {
    expect(
      needsFollowUp({
        classification: 'material_weakness',
        remediationStatus: 'remediated',
        withdrawn: false,
      }),
    ).toBe(true);
    expect(
      needsFollowUp({
        classification: 'control_deficiency',
        remediationStatus: 'in_progress',
        withdrawn: false,
      }),
    ).toBe(true);
    expect(
      needsFollowUp({
        classification: 'control_deficiency',
        remediationStatus: 'remediated',
        withdrawn: false,
      }),
    ).toBe(false);
    expect(
      needsFollowUp({
        classification: 'material_weakness',
        remediationStatus: 'x',
        withdrawn: true,
      }),
    ).toBe(false);
  });
});

describe('workstreamConclusionBlockers', () => {
  const ready = {
    areas: [
      { title: 'Revenue', scoping: 'in_scope' as const, keyIcfrControls: 1, withdrawn: false },
    ],
    controls: [
      { ref: 'C-1', purposeIcfr: true, reviewState: 'reviewed' as const, withdrawn: false },
    ],
    deficiencies: [],
    followUps: [],
  };
  it('a ready workstream concludes', () => {
    expect(workstreamConclusionBlockers(ready, 'unmodified')).toEqual([]);
  });
  it('lists scoping, key controls, reviews and follow-ups', () => {
    const b = workstreamConclusionBlockers(
      {
        areas: [
          { title: 'Revenue', scoping: 'in_scope', keyIcfrControls: 0, withdrawn: false },
          { title: 'ITGC', scoping: 'to_be_scoped', keyIcfrControls: 0, withdrawn: false },
        ],
        controls: [{ ref: 'C-1', purposeIcfr: true, reviewState: 'submitted', withdrawn: false }],
        deficiencies: [
          {
            ref: 'ICD-001',
            classification: 'material_weakness',
            reviewed: true,
            partnerConcluded: false,
            withdrawn: false,
          },
        ],
        followUps: [{ priorRef: 'ICD-009', status: 'open' }],
      },
      'unmodified',
    );
    expect(b).toEqual([
      'Scope ITGC.',
      'Revenue is in scope but has no key ICFR control.',
      'Review 1 ICFR control (C-1).',
      'Partner conclusion on ICD-001.',
      'Conclude the prior-year follow-up on ICD-009.',
      'A material weakness is recorded — the ICFR opinion cannot be unmodified.',
    ]);
  });
  it('a modified opinion needs a material weakness', () => {
    expect(workstreamConclusionBlockers(ready, 'modified_material_weakness')).toHaveLength(1);
  });
});

describe('consolidated consideration', () => {
  it('follows the 02.6 context, never blocking the standalone', () => {
    expect(planConsolidated(level1({ consolidatedStatus: 'applicable' }), null).action).toBe(
      'ensure',
    );
    expect(planConsolidated(level1({ consolidatedStatus: 'pending' }), null).state).toBe('pending');
    expect(planConsolidated(level1(), { status: 'active' })).toMatchObject({
      state: 'withdrawn',
      action: 'withdraw',
    });
    expect(planConsolidated(level1(), null).state).toBe('not_required');
  });

  const c = (o: Partial<ComponentForConclusion> = {}): ComponentForConclusion => ({
    indianCompany: 'yes',
    componentIcfr: 'applicable',
    auditor: 'other',
    reportLinked: true,
    materiality: 'significant',
    materialWeakness: false,
    withdrawn: false,
    ...o,
  });

  it('a component needs its facts; foreign / exempt ones need fewer', () => {
    expect(componentMissing(c())).toEqual([]);
    expect(componentMissing(c({ reportLinked: false }))).toHaveLength(1);
    expect(componentMissing(c({ indianCompany: 'no', auditor: null, materiality: null }))).toEqual(
      [],
    );
    expect(componentMissing(c({ componentIcfr: 'exempt', auditor: null }))).toEqual([]);
    expect(componentMissing(c({ componentIcfr: 'pending' }))).toHaveLength(1);
  });
  it('suggests the parent conclusion and checks consistency', () => {
    expect(suggestParentConclusion([c()], false)).toBe('unmodified');
    expect(suggestParentConclusion([c({ materialWeakness: true })], false)).toBe(
      'modified_component_material_weakness',
    );
    expect(suggestParentConclusion([c()], true)).toBe('modified_parent_material_weakness');
    expect(suggestParentConclusion([c({ indianCompany: null })], false)).toBeNull();
    expect(
      consolidatedConclusionBlockers(
        [c({ materialWeakness: true })],
        ['Sub A'],
        'unmodified',
        false,
      ),
    ).toHaveLength(1);
    expect(
      consolidatedConclusionBlockers([c({ auditor: null })], ['Sub A'], null, false)[0],
    ).toMatch(/^Sub A:/);
  });
});
