import {
  detectChanges,
  openDetections,
  reassessmentProgress,
  type DetectionFacts,
} from './reassessment-automation';

const facts = (o: Partial<DetectionFacts> = {}): DetectionFacts => ({
  performanceMateriality: 75000,
  specificMateriality: [20000],
  areas: [
    {
      id: 'caro',
      key: 'caro',
      title: 'CARO',
      isFs: false,
      materiality: null,
      dueDate: '2025-09-30',
    },
    {
      id: 'rev',
      key: 'fs_rev',
      title: 'Revenue',
      isFs: true,
      materiality: 75000,
      dueDate: '2025-09-30',
    },
    {
      id: 'cash',
      key: 'fs_cash',
      title: 'Cash & Bank',
      isFs: true,
      materiality: 20000,
      dueDate: '2025-09-30',
    },
  ],
  procedureDueDates: ['2025-09-30', '2025-09-30', '2025-08-15'],
  unansweredRisks: [],
  requiredWorkstreams: [{ key: 'caro', title: 'CARO' }],
  activeWorkstreams: [{ id: 'caro', key: 'caro', title: 'CARO' }],
  frameworkVersion: 1,
  investees: [],
  cfsConclusion: 'not_applicable',
  plannedEndDate: '2025-09-30',
  ...o,
});

describe('reassessment automation — detection', () => {
  it('finds nothing when the work matches the file', () => {
    expect(detectChanges(facts())).toEqual([]);
  });

  it('detects revised materiality, scoped to the areas planned at the old figure', () => {
    const [d] = detectChanges(facts({ performanceMateriality: 60000 }));
    expect(d).toMatchObject({
      key: 'materiality:60000',
      changeType: 'materiality_revised',
      scopeAreaIds: ['rev'], // cash uses a specific materiality — not stale
      scopeLabel: '1 area(s): Revenue',
      followThrough: "Updates those areas' materiality to ₹60,000.",
    });
    expect(d!.reason).toContain('planned at ₹75,000');
  });

  it('detects a significant risk with no response, in its area', () => {
    const [d] = detectChanges(
      facts({
        unansweredRisks: [{ id: 'r9', ref: 'R9', description: 'Revenue fraud', areaId: 'rev' }],
      }),
    );
    expect(d).toMatchObject({ key: 'risk:r9', changeType: 'risk_changed', scopeAreaIds: ['rev'] });
    expect(d!.reason).toContain('SA 330.21');
  });

  it('detects Section 02 and the work out of step', () => {
    const [d] = detectChanges(
      facts({
        requiredWorkstreams: [{ key: 'ifc', title: 'IFC Workstream' }],
        frameworkVersion: 2,
      }),
    );
    expect(d).toMatchObject({
      key: 'framework:v2:+ifc,-caro',
      changeType: 'caro_ifc_applicability',
      scopeAreaIds: ['caro'],
    });
    expect(d!.reason).toBe(
      'Section 02 changed after the work was planned: IFC Workstream now applies but the audit work has no workstream for it; CARO no longer applies but still has active work.',
    );
  });

  it('detects a subsidiary while CFS is not applicable', () => {
    const [d] = detectChanges(facts({ investees: ['Acme Sub Pvt Ltd'] }));
    expect(d).toMatchObject({ key: 'cfs:Acme Sub Pvt Ltd', changeType: 'new_subsidiary' });
    expect(detectChanges(facts({ investees: ['X'], cfsConclusion: 'applicable' }))).toEqual([]);
  });

  it('detects a moved completion date and offers to move the due dates', () => {
    const [d] = detectChanges(facts({ plannedEndDate: '2025-10-31' }));
    expect(d).toMatchObject({
      key: 'date:2025-09-30->2025-10-31',
      changeType: 'reporting_date_changed',
      followThrough:
        'Moves the due dates on 2025-09-30 to 2025-10-31 (the original date stays in this record).',
    });
    expect(d!.reason).toContain('3 area(s) and 2 procedure(s)');
  });

  it('hides what was raised or dismissed', () => {
    const all = detectChanges(facts({ performanceMateriality: 60000, investees: ['X'] }));
    expect(all).toHaveLength(2);
    expect(openDetections(all, new Set(['materiality:60000']), new Set(['cfs:X']))).toEqual([]);
  });
});

describe('reassessment automation — progress', () => {
  it('is ready once every flagged area is re-concluded and the phases are cleared', () => {
    expect(
      reassessmentProgress({
        status: 'open',
        flaggedAreas: [{ concluded: true }, { concluded: false }],
        phasesStillOpen: 0,
      }),
    ).toEqual({ progress: { done: 1, total: 2 }, readyToResolve: false });
    expect(
      reassessmentProgress({
        status: 'open',
        flaggedAreas: [{ concluded: true }],
        phasesStillOpen: 1,
      }).readyToResolve,
    ).toBe(false);
    expect(reassessmentProgress({ status: 'open', flaggedAreas: [], phasesStillOpen: 0 })).toEqual({
      progress: null,
      readyToResolve: true,
    });
    expect(
      reassessmentProgress({ status: 'resolved', flaggedAreas: [], phasesStillOpen: 0 })
        .readyToResolve,
    ).toBe(false);
  });
});
