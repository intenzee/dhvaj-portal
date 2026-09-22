import {
  changedSections,
  compareProfile,
  rollForwardSections,
  type CurrentSection,
  type PriorSection,
  type RollForwardProfileSnapshot,
} from '@hsdg/contracts';

function profile(p: Partial<RollForwardProfileSnapshot> = {}): RollForwardProfileSnapshot {
  return {
    isListed: false,
    groupHasRelationships: false,
    entityCategory: 'company',
    specialEntityTypes: [],
    financialYear: '2023-24',
    accountingEnvironment: 'in_house',
    ...p,
  };
}

describe('compareProfile — prior-year fact change highlighting (§12)', () => {
  it('1. flags a listing change and leaves unchanged fields alone', () => {
    const changes = compareProfile(
      profile(),
      profile({ isListed: true, financialYear: '2024-25' }),
    );
    const listing = changes.find((c) => c.field === 'isListed')!;
    expect(listing.changed).toBe(true);
    expect(listing.prior).toBe('No');
    expect(listing.current).toBe('Yes');
    expect(changes.find((c) => c.field === 'entityCategory')!.changed).toBe(false);
  });

  it('2. compares the special-entity set order-insensitively', () => {
    const changes = compareProfile(
      profile({ specialEntityTypes: ['nbfc', 'government'] }),
      profile({ specialEntityTypes: ['government', 'nbfc'] }),
    );
    expect(changes.find((c) => c.field === 'specialEntityTypes')!.changed).toBe(false);
  });
});

describe('rollForwardSections — carry-forward & change detection (§12)', () => {
  const prior: PriorSection[] = [
    { subSectionKey: '02.2', conclusion: 'ind_as', state: 'applicable' },
    { subSectionKey: '02.4', conclusion: 'applicable', state: 'approved' },
    { subSectionKey: '02.5', conclusion: 'exempt', state: 'not_applicable' },
  ];

  it('3. carries a decided prior conclusion when the current section is undecided', () => {
    const current: CurrentSection[] = [
      { subSectionKey: '02.2', title: 'FRF', conclusion: null, state: 'not_assessed' },
    ];
    const s = rollForwardSections(prior, current)[0]!;
    expect(s.carriedForward).toBe(true);
    expect(s.priorConclusion).toBe('ind_as');
    expect(s.changed).toBe(false);
  });

  it('4. flags a change when both years are decided and the conclusion differs', () => {
    const current: CurrentSection[] = [
      {
        subSectionKey: '02.4',
        title: 'CARO',
        conclusion: 'not_applicable_exempt',
        state: 'applicable',
      },
    ];
    const s = rollForwardSections(prior, current)[0]!;
    expect(s.changed).toBe(true);
    expect(s.carriedForward).toBe(false);
  });

  it('5. no prior section → neither carried nor changed', () => {
    const current: CurrentSection[] = [
      { subSectionKey: '02.3', title: 'Sch III', conclusion: null, state: 'not_assessed' },
    ];
    const s = rollForwardSections(prior, current)[0]!;
    expect(s.carriedForward).toBe(false);
    expect(s.changed).toBe(false);
    expect(s.priorConclusion).toBeNull();
  });
});

describe('changedSections — downstream re-evaluation (§12)', () => {
  it('6. a profile change ripples to every decided section; an undecided one is not flagged', () => {
    const sections = rollForwardSections(
      [{ subSectionKey: '02.4', conclusion: 'applicable', state: 'approved' }],
      [
        { subSectionKey: '02.4', title: 'CARO', conclusion: 'applicable', state: 'approved' },
        { subSectionKey: '02.5', title: 'ICFR', conclusion: null, state: 'not_assessed' },
      ],
    );
    const profileChanges = compareProfile(profile(), profile({ isListed: true }));
    const keys = changedSections(profileChanges, sections);
    expect(keys).toContain('02.4'); // decided → flagged by the profile change
    expect(keys).not.toContain('02.5'); // undecided → not flagged
  });

  it('7. no changes at all → nothing to re-evaluate', () => {
    const sections = rollForwardSections(
      [{ subSectionKey: '02.4', conclusion: 'applicable', state: 'approved' }],
      [{ subSectionKey: '02.4', title: 'CARO', conclusion: 'applicable', state: 'approved' }],
    );
    expect(changedSections(compareProfile(profile(), profile()), sections)).toHaveLength(0);
  });
});
