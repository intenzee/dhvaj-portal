import { FRAMEWORK_AREAS, FRAMEWORK_AREA_KEY } from '@hsdg/contracts';
import { suggestArea, type FrameworkFacts } from './framework-suggestions';

const CRORE = 10_000_000;

/** Facts with everything unknown; override just what a case needs. */
function facts(partial: Partial<FrameworkFacts> = {}): FrameworkFacts {
  return {
    isCompany: null,
    isPrivateCompany: null,
    isListed: null,
    hasSubsidiariesOrAssociates: null,
    isGovernmentCompany: null,
    acceptsPublicDeposits: null,
    regulatedSector: null,
    netWorth: null,
    turnover: null,
    netProfit: null,
    paidUpCapital: null,
    totalBorrowings: null,
    publicDeposits: null,
    ...partial,
  };
}

describe('FRAMEWORK_AREAS catalogue (§18)', () => {
  it('defines the sixteen assessment areas with unique keys and ordered', () => {
    expect(FRAMEWORK_AREAS).toHaveLength(16);
    const keys = FRAMEWORK_AREAS.map((a) => a.areaKey);
    expect(new Set(keys).size).toBe(16);
    expect(FRAMEWORK_AREAS.map((a) => a.sortOrder)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });
});

describe('suggestArea — advisory applicability (§19)', () => {
  it('Ind AS: listed company ⇒ applicable', () => {
    const s = suggestArea(FRAMEWORK_AREA_KEY.indAsAs, facts({ isCompany: true, isListed: true }));
    expect(s.suggestion).toBe('applicable');
    expect(s.state).toBe('system_suggested_applicable');
  });

  it('Ind AS: unlisted with net worth ≥ ₹250 cr ⇒ applicable; below ⇒ not applicable', () => {
    expect(
      suggestArea(
        FRAMEWORK_AREA_KEY.indAsAs,
        facts({ isCompany: true, isListed: false, netWorth: 300 * CRORE }),
      ).suggestion,
    ).toBe('applicable');
    expect(
      suggestArea(
        FRAMEWORK_AREA_KEY.indAsAs,
        facts({ isCompany: true, isListed: false, netWorth: 100 * CRORE }),
      ).suggestion,
    ).toBe('not_applicable');
  });

  it('Ind AS: missing net worth (unlisted) ⇒ pending_information, no suggestion', () => {
    const s = suggestArea(FRAMEWORK_AREA_KEY.indAsAs, facts({ isCompany: true, isListed: false }));
    expect(s.suggestion).toBeNull();
    expect(s.state).toBe('pending_information');
  });

  it('CARO: non-company ⇒ not applicable', () => {
    expect(suggestArea(FRAMEWORK_AREA_KEY.caro, facts({ isCompany: false })).suggestion).toBe(
      'not_applicable',
    );
  });

  it('CARO: small private company within all exemption limits ⇒ not applicable', () => {
    const s = suggestArea(
      FRAMEWORK_AREA_KEY.caro,
      facts({
        isCompany: true,
        isPrivateCompany: true,
        paidUpCapital: 0.5 * CRORE,
        totalBorrowings: 0.5 * CRORE,
        turnover: 5 * CRORE,
      }),
    );
    expect(s.suggestion).toBe('not_applicable');
  });

  it('CARO: private company above a limit ⇒ applicable', () => {
    const s = suggestArea(
      FRAMEWORK_AREA_KEY.caro,
      facts({
        isCompany: true,
        isPrivateCompany: true,
        paidUpCapital: 2 * CRORE,
        totalBorrowings: 0.5 * CRORE,
        turnover: 5 * CRORE,
      }),
    );
    expect(s.suggestion).toBe('applicable');
  });

  it('CFS: subsidiaries present ⇒ applicable; none ⇒ not applicable', () => {
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.cfs, facts({ hasSubsidiariesOrAssociates: true })).suggestion,
    ).toBe('applicable');
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.cfs, facts({ hasSubsidiariesOrAssociates: false })).suggestion,
    ).toBe('not_applicable');
  });

  it('CSR: meets a Sec 135 threshold ⇒ applicable; below all ⇒ not applicable', () => {
    expect(suggestArea(FRAMEWORK_AREA_KEY.csr, facts({ netProfit: 6 * CRORE })).suggestion).toBe(
      'applicable',
    );
    expect(
      suggestArea(
        FRAMEWORK_AREA_KEY.csr,
        facts({ netWorth: 10 * CRORE, turnover: 10 * CRORE, netProfit: 1 * CRORE }),
      ).suggestion,
    ).toBe('not_applicable');
  });

  it('Section 143 / Rule 11: any company audit ⇒ applicable', () => {
    expect(suggestArea(FRAMEWORK_AREA_KEY.section143, facts({ isCompany: true })).suggestion).toBe(
      'applicable',
    );
    expect(suggestArea(FRAMEWORK_AREA_KEY.rule11, facts({ isCompany: true })).suggestion).toBe(
      'applicable',
    );
  });

  it('Cost records: sector-specific ⇒ professional judgement, no suggestion', () => {
    const s = suggestArea(FRAMEWORK_AREA_KEY.costRecords, facts({ isCompany: true }));
    expect(s.suggestion).toBeNull();
    expect(s.state).toBe('professional_judgement_required');
  });

  it('descriptive area ⇒ not_assessed, no suggestion (left to the professional)', () => {
    const s = suggestArea(FRAMEWORK_AREA_KEY.entityRegulatoryProfile, facts({ isCompany: true }));
    expect(s.suggestion).toBeNull();
    expect(s.state).toBe('not_assessed');
  });
});
