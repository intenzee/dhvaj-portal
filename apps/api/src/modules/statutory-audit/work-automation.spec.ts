import {
  OVERALL_WORK_AREA_KEY,
  areaForRisk,
  fsWorkAreaKey,
  planAreaDetail,
  planPlanningWorkAreas,
  suggestProcedures,
  type FsAreaInput,
  type RiskInput,
} from './work-automation';

const area = (o: Partial<FsAreaInput> & { id: string; name: string }): FsAreaInput => ({
  seq: 1,
  code: null,
  aliases: [],
  attention: 'standard',
  cy: null,
  py: null,
  unitLabel: null,
  assertions: [],
  ...o,
});

const risk = (o: Partial<RiskInput> & { id: string }): RiskInput => ({
  ref: 'R1',
  description: 'Risk',
  fsArea: null,
  assertion: null,
  rating: 'moderate',
  isSignificant: false,
  isFraudRisk: false,
  response: null,
  status: 'identified',
  sourceKey: null,
  ...o,
});

const revenue = area({
  id: 'a-rev',
  seq: 2,
  code: 'REV_OPS',
  name: 'Revenue from operations',
  attention: 'enhanced',
  cy: 1200,
  py: 1000,
  unitLabel: '₹ lakh',
  assertions: ['TX_OCC', 'TX_CUTOFF', 'PD_COMP'],
});
const cash = area({ id: 'a-cash', seq: 1, code: 'CASH', name: 'Cash and bank balances' });

describe('work automation — areas', () => {
  it('keys 03.5 areas by code and always adds the overall-responses area', () => {
    expect(fsWorkAreaKey(revenue)).toBe('fs_rev_ops');
    expect(fsWorkAreaKey({ code: null, name: 'Trade Receivables (net)' })).toBe(
      'fs_trade_receivables_net',
    );
    const plan = planPlanningWorkAreas([cash, revenue]);
    expect(plan.map((p) => p.workAreaKey)).toEqual([
      OVERALL_WORK_AREA_KEY,
      'fs_cash',
      'fs_rev_ops',
    ]);
    expect(plan.every((p) => /^[a-z0-9_]{2,60}$/.test(p.workAreaKey))).toBe(true);
  });

  it('places a risk in its 03.5 area by source key or FS-area wording', () => {
    expect(areaForRisk(risk({ id: 'r', sourceKey: 'area:a-cash' }), [cash, revenue])).toBe(cash);
    expect(areaForRisk(risk({ id: 'r', fsArea: 'Revenue' }), [cash, revenue])).toBe(revenue);
    expect(
      areaForRisk(risk({ id: 'r', fsArea: 'Journal entries & management estimates' }), [cash]),
    ).toBeNull();
    expect(areaForRisk(risk({ id: 'r', fsArea: 'Opening balances' }), [cash, revenue])).toBeNull();
    const je = area({ id: 'a-je', code: 'JE', name: 'Journal Entries' });
    const est = area({ id: 'a-est', code: 'EST', name: 'Accounting Estimates' });
    const ob = area({ id: 'a-ob', code: 'OB', name: 'Opening Balances' });
    expect(
      areaForRisk(risk({ id: 'r', fsArea: 'Journal entries & management estimates' }), [
        cash,
        est,
        je,
      ]),
    ).toBe(je);
    expect(areaForRisk(risk({ id: 'r', fsArea: 'Opening balances' }), [cash, ob])).toBe(ob);
  });
});

describe('work automation — area detail', () => {
  const blank = {
    ownerEmployeeId: null,
    reviewerEmployeeId: null,
    riskLevel: null,
    materiality: null,
    dueDate: null,
    financialCurrent: null,
    financialPrior: null,
  };
  const facts = {
    ownerId: 'mgr',
    reviewerId: 'ep',
    dueDate: '2026-09-30',
    performanceMateriality: 75,
    specific: [{ pm: 20, affectedAreas: ['REV_OPS'] }],
  };

  it('fills blanks from the team, risks, materiality and 03.5 figures', () => {
    const p = planAreaDetail({
      workAreaKey: 'fs_rev_ops',
      current: blank,
      fsArea: revenue,
      risks: [risk({ id: 'r', rating: 'high', isSignificant: true })],
      facts,
    });
    expect(p).toEqual({
      ownerEmployeeId: 'mgr',
      reviewerEmployeeId: 'ep',
      dueDate: '2026-09-30',
      riskLevel: 'significant',
      materiality: 20,
      financialCurrent: 1200,
      financialPrior: 1000,
      financialSource: '03.5 audit area review (₹ lakh)',
    });
  });

  it('never overwrites what the team entered', () => {
    const p = planAreaDetail({
      workAreaKey: 'fs_cash',
      current: {
        ...blank,
        ownerEmployeeId: 'x',
        riskLevel: 'high',
        materiality: 5,
        financialPrior: 1,
      },
      fsArea: { ...cash, cy: 10 },
      risks: [],
      facts,
    });
    expect(p.ownerEmployeeId).toBeUndefined();
    expect(p.riskLevel).toBeUndefined();
    expect(p.materiality).toBeUndefined();
    expect(p.financialCurrent).toBeUndefined();
  });

  it('workstreams get no materiality or figures; FS areas default by attention', () => {
    const caro = planAreaDetail({
      workAreaKey: 'caro',
      current: blank,
      fsArea: null,
      risks: [],
      facts,
    });
    expect(caro.materiality).toBeUndefined();
    expect(caro.riskLevel).toBeUndefined();
    const c = planAreaDetail({
      workAreaKey: 'fs_cash',
      current: blank,
      fsArea: cash,
      risks: [],
      facts,
    });
    expect(c.riskLevel).toBe('low');
    expect(c.materiality).toBe(75);
  });
});

describe('work automation — procedures', () => {
  it('suggests risk responses, area programmes and workstream procedures', () => {
    const out = suggestProcedures({
      areaKeys: new Set([OVERALL_WORK_AREA_KEY, 'fs_cash', 'fs_rev_ops', 'caro']),
      fsAreas: [cash, revenue],
      risks: [
        risk({
          id: 'r1',
          ref: 'R1',
          fsArea: 'Revenue',
          assertion: 'occurrence',
          response: 'Cut-off.',
        }),
        risk({ id: 'r2', ref: 'R2', fsArea: 'Journal entries', isSignificant: true }),
        risk({ id: 'r3', ref: 'R3', status: 'concluded' }),
      ],
      caroClauses: [
        {
          sourceKey: 'caro:CARO_2020_3_I_B',
          sourceNote: '02.4 CARO clause 3(i)(b)',
          title: 'CARO 3(i)(b) — Physical verification of property, plant and equipment',
          objective: 'Verify.',
          expectedEvidence: null,
        },
      ],
    });
    const byKey = new Map(out.map((p) => [p.sourceKey, p]));
    expect(byKey.get('risk:r1')).toMatchObject({
      workAreaKey: 'fs_rev_ops',
      objective: 'Cut-off.',
      assertions: ['occurrence'],
      riskId: 'r1',
    });
    expect(byKey.get('risk:r2')?.workAreaKey).toBe(OVERALL_WORK_AREA_KEY);
    expect(byKey.get('risk:r2')?.objective).toMatch(/SA 330.21/);
    expect(byKey.has('risk:r3')).toBe(false);
    expect(byKey.get('fs:fs_rev_ops:substantive')?.assertions).toEqual([
      'occurrence',
      'cutoff',
      'presentation_and_disclosure',
    ]);
    expect(byKey.has('fs:fs_cash:confirm')).toBe(true);
    expect(byKey.has('fs:fs_rev_ops:cutoff')).toBe(true);
    // CARO: the 02.4 clause programme, never a generic CARO template.
    expect(byKey.get('caro:CARO_2020_3_I_B')?.workAreaKey).toBe('caro');
    expect([...byKey.keys()].some((k) => k.startsWith('std:caro:'))).toBe(false);
    expect(byKey.has('std:ifc:walkthroughs')).toBe(false);
    expect(byKey.has(`std:${OVERALL_WORK_AREA_KEY}:final_analytics`)).toBe(true);
    expect(new Set(out.map((p) => p.sourceKey)).size).toBe(out.length);
  });

  it('takes the IFC programme from the 02.5 ICFR workstream, never a generic one', () => {
    const icfrProcedures = [
      {
        sourceKey: 'icfr:revenue:rev_controls',
        sourceNote: '02.5 ICFR — Revenue',
        title: 'Test revenue controls',
        objective: 'Test.',
        expectedEvidence: null,
      },
    ];
    const withIfc = suggestProcedures({
      areaKeys: new Set(['ifc']),
      fsAreas: [],
      risks: [],
      icfrProcedures,
    });
    expect(withIfc.map((p) => [p.sourceKey, p.workAreaKey])).toEqual([
      ['icfr:revenue:rev_controls', 'ifc'],
    ]);
    // No IFC work area (reporting exempt) → nothing, even if planned.
    expect(
      suggestProcedures({ areaKeys: new Set(), fsAreas: [], risks: [], icfrProcedures }),
    ).toEqual([]);
  });
});
