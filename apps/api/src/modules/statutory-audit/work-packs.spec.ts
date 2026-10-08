import type { SectionPack, SignOffCheck } from '@hsdg/contracts';
import {
  conclusionReady,
  draftAreaConclusion,
  planWork,
  type WorkPackArea,
  type WorkPackFacts,
  type WorkPackProcedure,
} from './work-packs';

const byKey = (p: SectionPack, key: string): SignOffCheck => p.checks.find((c) => c.key === key)!;

const area = (over: Partial<WorkPackArea>): WorkPackArea => ({
  id: 'a1',
  workAreaKey: 'fs_cash',
  title: 'Cash and bank',
  isActive: true,
  ownerName: 'Manager',
  reviewerName: 'Partner',
  dueDate: '2025-06-30',
  materiality: 375000,
  conclusion: null,
  conclusionState: 'draft',
  reviewed: false,
  ...over,
});

const proc = (over: Partial<WorkPackProcedure>): WorkPackProcedure => ({
  ref: 'P1',
  title: 'Bank confirmations',
  state: 'complete',
  conclusion: 'Balances agreed to confirmations.',
  areaIds: ['a1'],
  riskId: null,
  evidenceCount: 1,
  exceptions: [],
  ...over,
});

const base: WorkPackFacts = {
  frameworkApproved: true,
  areas: [area({})],
  procedures: [proc({})],
  risks: [],
  today: '2025-05-01',
};

describe('draftAreaConclusion', () => {
  it('concludes from completed procedures and their exceptions', () => {
    const procs = [
      proc({
        exceptions: [
          { description: 'Stale cheque', status: 'resolved', resolution: 'Written back.' },
          { description: 'Unreconciled item', status: 'carried_forward', resolution: null },
        ],
      }),
    ];
    const memo = draftAreaConclusion({ title: 'Cash and bank', materiality: 375000 }, procs)!;
    expect(memo).toContain('• P1 Bank confirmations: Balances agreed to confirmations.');
    expect(memo).toContain('• Stale cheque — resolved: Written back.');
    expect(memo).toContain('• Unreconciled item — carried forward to completion.');
    expect(memo).toContain('Materiality applied: ₹3,75,000.');
    expect(memo.split('\n').at(-1)).toMatch(
      /^Conclusion: based on the procedures performed.*Cash and bank\. Exceptions carried forward/,
    );
    expect(conclusionReady(procs)).toBe(true);
  });

  it('does not conclude while procedures are open, and is null with none', () => {
    const procs = [proc({}), proc({ ref: 'P2', state: 'in_progress', conclusion: null })];
    const memo = draftAreaConclusion({ title: 'Cash and bank', materiality: null }, procs)!;
    expect(memo).toContain('• P2 Bank confirmations: conclusion not yet recorded.');
    expect(memo.split('\n').at(-1)).toBe(
      'Conclusion: not yet reached — 1 procedure(s) still open.',
    );
    expect(conclusionReady(procs)).toBe(false);
    expect(draftAreaConclusion({ title: 'X', materiality: null }, [])).toBeNull();
  });
});

describe('planWork', () => {
  it('points to the framework until it is approved', () => {
    const p = planWork({ ...base, frameworkApproved: false }, 'audit_areas');
    expect(p.ready).toBe(false);
    expect(byKey(p, 'work_built').goTo?.phaseKey).toBe('framework');
  });

  it('names what is open and links to the area it sits in', () => {
    const p = planWork(
      {
        ...base,
        areas: [
          area({}),
          area({ id: 'a2', title: 'Revenue', ownerName: null, dueDate: '2025-04-01' }),
        ],
        procedures: [
          proc({ evidenceCount: 0 }),
          proc({
            ref: 'P2',
            title: 'Cut-off testing',
            state: 'ready_for_review',
            areaIds: ['a2'],
            riskId: 'r1',
            exceptions: [{ description: 'Late invoice', status: 'open', resolution: null }],
          }),
        ],
        risks: [{ id: 'r1', riskRef: 'R1', description: 'Revenue cut-off', isSignificant: true }],
      },
      'audit_areas',
    );
    expect(p.ready).toBe(false);
    const open = byKey(p, 'procedures_complete');
    expect(open.facts).toContain('• P2 Cut-off testing — ready for review (Revenue)');
    expect(open.goTo).toMatchObject({ phaseKey: 'audit_areas', anchor: 'area-a2' });
    expect(byKey(p, 'exceptions').facts).toContain('• P2: Late invoice');
    expect(byKey(p, 'significant_risks').facts).toContain(
      '• R1 Revenue cut-off — procedure not complete',
    );
    expect(byKey(p, 'conclusions_submitted').facts).toEqual(
      expect.arrayContaining([
        '• Cash and bank — conclusion drafted, ready to submit',
        '• Revenue — 1 procedure(s) open',
      ]),
    );
    expect(byKey(p, 'evidence').facts).toContain('• P1 Bank confirmations');
    expect(byKey(p, 'area_details').facts).toEqual(
      expect.arrayContaining([
        '• Revenue — no owner',
        '• Revenue — due 2025-04-01, not yet concluded',
      ]),
    );
  });

  it('is ready once the work is done, flagging conclusions awaiting review', () => {
    const p = planWork(
      { ...base, areas: [area({ conclusionState: 'submitted', conclusion: 'Done.' })] },
      'audit_areas',
    );
    expect(p.ready).toBe(true);
    expect(p.attention).toBe(1);
    expect(byKey(p, 'conclusions_reviewed').goTo?.phaseKey).toBe('review');
  });

  it('Section 05 covers only the controls workstreams, and is not applicable without them', () => {
    const none = planWork(base, 'controls');
    expect(none.ready).toBe(true);
    expect(byKey(none, 'work_built').facts[0]).toMatch(/not applicable/);
    const ifc = planWork(
      {
        ...base,
        areas: [area({}), area({ id: 'c1', workAreaKey: 'ifc', title: 'IFC' })],
        procedures: [proc({}), proc({ ref: 'P2', state: 'not_started', areaIds: ['c1'] })],
      },
      'controls',
    );
    expect(byKey(ifc, 'procedures_complete').facts[0]).toBe(
      '0 of 1 procedure(s) complete; still open:',
    );
    expect(byKey(ifc, 'procedures_complete').goTo).toMatchObject({
      phaseKey: 'controls',
      anchor: 'area-c1',
    });
    expect(ifc.checks.some((c) => c.key === 'significant_risks')).toBe(false);
  });
});
