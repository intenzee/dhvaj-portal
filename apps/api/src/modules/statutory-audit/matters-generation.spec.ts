import { deriveFrameworkMatters, type FrameworkMatterInput } from './matters-generation';

const area = (over: Partial<FrameworkMatterInput> = {}): FrameworkMatterInput => ({
  areaKey: 'ind_as_as',
  title: 'Ind AS / AS Applicability',
  state: 'applicable',
  isOverridden: false,
  ...over,
});

describe('deriveFrameworkMatters (Matters engine, guide §10)', () => {
  it('a decided, non-overridden area produces no matter', () => {
    expect(deriveFrameworkMatters([area({ state: 'applicable' })])).toEqual([]);
    expect(deriveFrameworkMatters([area({ state: 'not_applicable' })])).toEqual([]);
    expect(deriveFrameworkMatters([area({ state: 'approved' })])).toEqual([]);
  });

  it('pending_information ⇒ a BLOCKING information_pending matter', () => {
    const m = deriveFrameworkMatters([area({ state: 'pending_information' })])[0]!;
    expect(m.category).toBe('information_pending');
    expect(m.isBlocking).toBe(true);
    expect(m.source).toBe('framework:ind_as_as:information');
  });

  it('professional_judgement_required ⇒ a non-blocking technical_judgment matter', () => {
    const m = deriveFrameworkMatters([area({ state: 'professional_judgement_required' })])[0]!;
    expect(m.category).toBe('technical_judgment');
    expect(m.isBlocking).toBe(false);
    expect(m.source).toBe('framework:ind_as_as:judgment');
  });

  it('an override ⇒ a non-blocking framework_override matter (tracked, not blocked)', () => {
    const m = deriveFrameworkMatters([area({ state: 'overridden', isOverridden: true })])[0]!;
    expect(m.category).toBe('framework_override');
    expect(m.isBlocking).toBe(false);
    expect(m.source).toBe('framework:ind_as_as:override');
  });

  it('is idempotent by source and stable across runs', () => {
    const areas = [
      area({ areaKey: 'caro', title: 'CARO', state: 'pending_information' }),
      area({ areaKey: 'ind_as_as', state: 'overridden', isOverridden: true }),
    ];
    const first = deriveFrameworkMatters(areas);
    const second = deriveFrameworkMatters(areas);
    expect(second).toEqual(first);
    expect(new Set(first.map((m) => m.source)).size).toBe(first.length);
  });
});
