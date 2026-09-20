import {
  FRAMEWORK_AREAS,
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
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

/**
 * Fixture resolver mirroring the seeded Audit Rules Library (migration
 * 1763100000000). The engine is pure and DB-free — every threshold arrives
 * through this resolver, so a test can change a limit here to prove behaviour
 * is config-driven, exactly as a future rule-library version would be.
 */
type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${FRAMEWORK_AREA_KEY.indAsAs}|${RULE_CRITERION.netWorth}`]: {
    operator: '>=',
    threshold: 250 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.caro}|${RULE_CRITERION.paidUpCapital}`]: {
    operator: '<=',
    threshold: 1 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.caro}|${RULE_CRITERION.borrowings}`]: {
    operator: '<=',
    threshold: 1 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.caro}|${RULE_CRITERION.revenue}`]: {
    operator: '<=',
    threshold: 10 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.internalAudit}|${RULE_CRITERION.paidUpCapital}`]: {
    operator: '>=',
    threshold: 50 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.internalAudit}|${RULE_CRITERION.turnover}`]: {
    operator: '>=',
    threshold: 200 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.internalAudit}|${RULE_CRITERION.borrowings}`]: {
    operator: '>=',
    threshold: 100 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.internalAudit}|${RULE_CRITERION.deposits}`]: {
    operator: '>=',
    threshold: 25 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.secretarialAudit}|${RULE_CRITERION.paidUpCapital}`]: {
    operator: '>=',
    threshold: 50 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.secretarialAudit}|${RULE_CRITERION.turnover}`]: {
    operator: '>=',
    threshold: 250 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.csr}|${RULE_CRITERION.netWorth}`]: {
    operator: '>=',
    threshold: 500 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.csr}|${RULE_CRITERION.turnover}`]: {
    operator: '>=',
    threshold: 1000 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.csr}|${RULE_CRITERION.netProfit}`]: {
    operator: '>=',
    threshold: 5 * CRORE,
  },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table = { ...SEED, ...overrides };
  return (areaKey, criterion): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `${areaKey}_${criterion}`.toUpperCase(),
      ruleVersionId: 'rv',
      version: 1,
      areaKey,
      entityClass: null,
      criterion,
      operator: hit.operator,
      unit: 'inr',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: null,
      outcome: null,
      effectiveFrom: '2016-04-01',
      authorityProvisionId: 'prov',
      guidanceReference: null,
      bands: [],
    };
  };
}

const resolve = makeResolver();

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

describe('suggestArea — advisory applicability (§19), thresholds resolved from the Rules Library (§4)', () => {
  it('Ind AS: listed company ⇒ applicable', () => {
    const s = suggestArea(
      FRAMEWORK_AREA_KEY.indAsAs,
      facts({ isCompany: true, isListed: true }),
      resolve,
    );
    expect(s.suggestion).toBe('applicable');
    expect(s.state).toBe('system_suggested_applicable');
  });

  it('Ind AS: unlisted with net worth ≥ threshold ⇒ applicable; below ⇒ not applicable', () => {
    expect(
      suggestArea(
        FRAMEWORK_AREA_KEY.indAsAs,
        facts({ isCompany: true, isListed: false, netWorth: 300 * CRORE }),
        resolve,
      ).suggestion,
    ).toBe('applicable');
    expect(
      suggestArea(
        FRAMEWORK_AREA_KEY.indAsAs,
        facts({ isCompany: true, isListed: false, netWorth: 100 * CRORE }),
        resolve,
      ).suggestion,
    ).toBe('not_applicable');
  });

  it('Ind AS: the frozen rule (code + effective date + limit) appears in the basis', () => {
    const s = suggestArea(
      FRAMEWORK_AREA_KEY.indAsAs,
      facts({ isCompany: true, isListed: false, netWorth: 300 * CRORE }),
      resolve,
    );
    expect(s.basis).toContain('₹250.00 cr');
    expect(s.basis).toContain('effective 2016-04-01');
    expect(s.authorityProvisionId).toBe('prov');
    expect(s.ruleVersionId).toBe('rv');
  });

  it('Ind AS: missing net worth (unlisted) ⇒ pending_information, no suggestion', () => {
    const s = suggestArea(
      FRAMEWORK_AREA_KEY.indAsAs,
      facts({ isCompany: true, isListed: false }),
      resolve,
    );
    expect(s.suggestion).toBeNull();
    expect(s.state).toBe('pending_information');
  });

  it('Ind AS: library holds no rule for the period ⇒ Information Insufficient (never a guess)', () => {
    const empty: RuleResolver = () => null;
    const s = suggestArea(
      FRAMEWORK_AREA_KEY.indAsAs,
      facts({ isCompany: true, isListed: false, netWorth: 300 * CRORE }),
      empty,
    );
    expect(s.suggestion).toBeNull();
    expect(s.state).toBe('professional_judgement_required');
    expect(s.basis).toContain('Information Insufficient');
  });

  it('a future rule-library change affects future results with NO engine change', () => {
    // Raise the Ind AS net-worth threshold to ₹500 cr (a later effective version).
    const raised = makeResolver({
      [`${FRAMEWORK_AREA_KEY.indAsAs}|${RULE_CRITERION.netWorth}`]: {
        operator: '>=',
        threshold: 500 * CRORE,
      },
    });
    const f = facts({ isCompany: true, isListed: false, netWorth: 300 * CRORE });
    expect(suggestArea(FRAMEWORK_AREA_KEY.indAsAs, f, resolve).suggestion).toBe('applicable');
    expect(suggestArea(FRAMEWORK_AREA_KEY.indAsAs, f, raised).suggestion).toBe('not_applicable');
  });

  it('CARO: non-company ⇒ not applicable', () => {
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.caro, facts({ isCompany: false }), resolve).suggestion,
    ).toBe('not_applicable');
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
      resolve,
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
      resolve,
    );
    expect(s.suggestion).toBe('applicable');
  });

  it('CFS: subsidiaries present ⇒ applicable; none ⇒ not applicable', () => {
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.cfs, facts({ hasSubsidiariesOrAssociates: true }), resolve)
        .suggestion,
    ).toBe('applicable');
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.cfs, facts({ hasSubsidiariesOrAssociates: false }), resolve)
        .suggestion,
    ).toBe('not_applicable');
  });

  it('CSR: meets a Sec 135 threshold ⇒ applicable; below all ⇒ not applicable', () => {
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.csr, facts({ netProfit: 6 * CRORE }), resolve).suggestion,
    ).toBe('applicable');
    expect(
      suggestArea(
        FRAMEWORK_AREA_KEY.csr,
        facts({ netWorth: 10 * CRORE, turnover: 10 * CRORE, netProfit: 1 * CRORE }),
        resolve,
      ).suggestion,
    ).toBe('not_applicable');
  });

  it('Section 143 / Rule 11: any company audit ⇒ applicable', () => {
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.section143, facts({ isCompany: true }), resolve).suggestion,
    ).toBe('applicable');
    expect(
      suggestArea(FRAMEWORK_AREA_KEY.rule11, facts({ isCompany: true }), resolve).suggestion,
    ).toBe('applicable');
  });

  it('Cost records: sector-specific ⇒ professional judgement, no suggestion', () => {
    const s = suggestArea(FRAMEWORK_AREA_KEY.costRecords, facts({ isCompany: true }), resolve);
    expect(s.suggestion).toBeNull();
    expect(s.state).toBe('professional_judgement_required');
  });

  it('descriptive area ⇒ not_assessed, no suggestion (left to the professional)', () => {
    const s = suggestArea(
      FRAMEWORK_AREA_KEY.entityRegulatoryProfile,
      facts({ isCompany: true }),
      resolve,
    );
    expect(s.suggestion).toBeNull();
    expect(s.state).toBe('not_assessed');
  });
});
