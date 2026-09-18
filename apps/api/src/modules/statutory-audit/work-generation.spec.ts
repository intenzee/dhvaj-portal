import { FRAMEWORK_AREA_KEY, WORK_AREA_KEY, type FrameworkConclusion } from '@hsdg/contracts';
import { planWorkAreas } from './work-generation';

/** Build a conclusion map from a plain object of areaKey → conclusion. */
function conclusions(
  entries: Record<string, FrameworkConclusion>,
): ReadonlyMap<string, FrameworkConclusion> {
  return new Map(Object.entries(entries));
}

describe('planWorkAreas (§20 Framework → Dynamic Work Generation)', () => {
  it('generates no work areas when nothing is applicable', () => {
    expect(planWorkAreas(conclusions({}))).toEqual([]);
    expect(
      planWorkAreas(
        conclusions({
          [FRAMEWORK_AREA_KEY.caro]: 'not_applicable',
          [FRAMEWORK_AREA_KEY.ifc]: 'not_applicable',
        }),
      ),
    ).toEqual([]);
  });

  it('generates a work area only for an applicable trigger', () => {
    const plan = planWorkAreas(conclusions({ [FRAMEWORK_AREA_KEY.caro]: 'applicable' }));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      workAreaKey: WORK_AREA_KEY.caro,
      source: 'framework:caro',
      originAreaKey: FRAMEWORK_AREA_KEY.caro,
    });
  });

  it('deduplicates rule_11 / section_143 into the single reporting workstream', () => {
    const both = planWorkAreas(
      conclusions({
        [FRAMEWORK_AREA_KEY.rule11]: 'applicable',
        [FRAMEWORK_AREA_KEY.section143]: 'applicable',
      }),
    );
    expect(both.filter((a) => a.workAreaKey === WORK_AREA_KEY.auditorReporting)).toHaveLength(1);

    // Either trigger alone still yields exactly the one reporting area.
    const rule11Only = planWorkAreas(conclusions({ [FRAMEWORK_AREA_KEY.rule11]: 'applicable' }));
    const sec143Only = planWorkAreas(
      conclusions({ [FRAMEWORK_AREA_KEY.section143]: 'applicable' }),
    );
    expect(rule11Only).toHaveLength(1);
    expect(sec143Only).toHaveLength(1);
    expect(rule11Only[0]!.workAreaKey).toBe(WORK_AREA_KEY.auditorReporting);
    expect(sec143Only[0]!.workAreaKey).toBe(WORK_AREA_KEY.auditorReporting);
  });

  it('is deterministic and idempotent — same input, same ordered output', () => {
    const input = conclusions({
      [FRAMEWORK_AREA_KEY.indAsAs]: 'applicable',
      [FRAMEWORK_AREA_KEY.scheduleIii]: 'applicable',
      [FRAMEWORK_AREA_KEY.caro]: 'applicable',
      [FRAMEWORK_AREA_KEY.ifc]: 'applicable',
      [FRAMEWORK_AREA_KEY.cfs]: 'not_applicable',
    });
    const first = planWorkAreas(input);
    const second = planWorkAreas(input);
    expect(second).toEqual(first);
    // Sorted by blueprint sortOrder.
    expect(first.map((a) => a.sortOrder)).toEqual(
      [...first.map((a) => a.sortOrder)].sort((x, y) => x - y),
    );
    expect(first.map((a) => a.workAreaKey)).toEqual([
      WORK_AREA_KEY.indAsReview,
      WORK_AREA_KEY.scheduleIiiWork,
      WORK_AREA_KEY.caro,
      WORK_AREA_KEY.ifc,
    ]);
  });

  it('generates the full applicable set for a typical listed company', () => {
    const plan = planWorkAreas(
      conclusions({
        [FRAMEWORK_AREA_KEY.indAsAs]: 'applicable',
        [FRAMEWORK_AREA_KEY.scheduleIii]: 'applicable',
        [FRAMEWORK_AREA_KEY.caro]: 'applicable',
        [FRAMEWORK_AREA_KEY.ifc]: 'applicable',
        [FRAMEWORK_AREA_KEY.cfs]: 'applicable',
        [FRAMEWORK_AREA_KEY.internalAudit]: 'applicable',
        [FRAMEWORK_AREA_KEY.rule11]: 'applicable',
        [FRAMEWORK_AREA_KEY.section143]: 'applicable',
      }),
    );
    expect(plan.map((a) => a.workAreaKey)).toEqual([
      WORK_AREA_KEY.indAsReview,
      WORK_AREA_KEY.scheduleIiiWork,
      WORK_AREA_KEY.caro,
      WORK_AREA_KEY.ifc,
      WORK_AREA_KEY.cfs,
      WORK_AREA_KEY.internalAuditReliance,
      WORK_AREA_KEY.auditorReporting,
    ]);
  });
});
