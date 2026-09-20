import {
  ACCOUNTING_ENVIRONMENT,
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  SA_TRIGGER_CODE,
  SMALL_COMPANY_OUTCOME,
  SPECIAL_ENTITY_TYPE,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
  type SpecialEntityType,
} from '@hsdg/contracts';
import { assessSmallCompany, deriveSaTriggers, type SmallCompanyFacts } from './entity-profile';

const CRORE = 10_000_000;

/** Small-company facts with everything unknown; override just what a case needs. */
function facts(partial: Partial<SmallCompanyFacts> = {}): SmallCompanyFacts {
  return {
    isCompany: null,
    isPrivateCompany: null,
    isHoldingOrSubsidiary: null,
    specialEntityTypes: [],
    paidUpCapital: null,
    turnover: null,
    ...partial,
  };
}

/**
 * Fixture resolver mirroring the seeded §2(85) rules (migration 1763400000000).
 * The engine is pure and DB-free — the ceilings arrive through this resolver, so
 * a test can change a limit to prove behaviour is config-driven (exactly as a
 * future rule-library version would be). Defaults to the current ₹4cr / ₹40cr.
 */
type Seed = Record<string, { operator: RuleOperator; threshold: number }>;
const SEED: Seed = {
  [`${FRAMEWORK_AREA_KEY.entityRegulatoryProfile}|${RULE_CRITERION.paidUpCapital}`]: {
    operator: '<=',
    threshold: 4 * CRORE,
  },
  [`${FRAMEWORK_AREA_KEY.entityRegulatoryProfile}|${RULE_CRITERION.turnover}`]: {
    operator: '<=',
    threshold: 40 * CRORE,
  },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table = { ...SEED, ...overrides };
  return (areaKey, criterion): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `SMALL_CO_${criterion}`.toUpperCase(),
      ruleVersionId: 'rv-1',
      version: 3,
      areaKey,
      entityClass: null,
      criterion,
      operator: hit.operator,
      unit: 'inr',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: 'balance_sheet_date',
      outcome: 'small',
      effectiveFrom: '2022-09-15',
      authorityProvisionId: 'prov-2-85',
      guidanceReference: null,
      bands: [],
    };
  };
}

const resolve = makeResolver();
const privateCo: Partial<SmallCompanyFacts> = {
  isCompany: true,
  isPrivateCompany: true,
  isHoldingOrSubsidiary: false,
};

describe('assessSmallCompany (§9.1 Card E, §2(85))', () => {
  it('is not_applicable for a non-company', () => {
    const r = assessSmallCompany(facts({ isCompany: false }), resolve);
    expect(r.outcome).toBe(SMALL_COMPANY_OUTCOME.notApplicable);
    expect(r.ruleVersionId).toBeNull();
  });

  it('pends when the entity type / private status is unconfirmed', () => {
    expect(assessSmallCompany(facts({ isCompany: null }), resolve).outcome).toBe(
      SMALL_COMPANY_OUTCOME.pending,
    );
    expect(
      assessSmallCompany(facts({ isCompany: true, isPrivateCompany: null }), resolve).outcome,
    ).toBe(SMALL_COMPANY_OUTCOME.pending);
  });

  it('excludes a public company from the definition', () => {
    const r = assessSmallCompany(facts({ isCompany: true, isPrivateCompany: false }), resolve);
    expect(r.outcome).toBe(SMALL_COMPANY_OUTCOME.notSmall);
    expect(r.basis).toContain('public company');
  });

  it('excludes a holding/subsidiary company (§2(85) proviso)', () => {
    const r = assessSmallCompany(facts({ ...privateCo, isHoldingOrSubsidiary: true }), resolve);
    expect(r.outcome).toBe(SMALL_COMPANY_OUTCOME.notSmall);
    expect(r.basis).toContain('proviso');
  });

  it.each<SpecialEntityType>([
    SPECIAL_ENTITY_TYPE.bank,
    SPECIAL_ENTITY_TYPE.insurance,
    SPECIAL_ENTITY_TYPE.nbfc,
    SPECIAL_ENTITY_TYPE.section_8,
  ])('excludes a special entity (%s) from the definition', (type) => {
    const r = assessSmallCompany(facts({ ...privateCo, specialEntityTypes: [type] }), resolve);
    expect(r.outcome).toBe(SMALL_COMPANY_OUTCOME.notSmall);
  });

  it('pends when a deciding financial fact is absent', () => {
    const r = assessSmallCompany(
      facts({ ...privateCo, paidUpCapital: 1 * CRORE, turnover: null }),
      resolve,
    );
    expect(r.outcome).toBe(SMALL_COMPANY_OUTCOME.pending);
  });

  it('reports Information Insufficient when the library holds no ceiling for the period', () => {
    const empty: RuleResolver = () => null;
    const r = assessSmallCompany(
      facts({ ...privateCo, paidUpCapital: 1 * CRORE, turnover: 1 * CRORE }),
      empty,
    );
    expect(r.outcome).toBe(SMALL_COMPANY_OUTCOME.pending);
    expect(r.basis).toContain('Information Insufficient');
  });

  it('is small when a private company sits within BOTH ceilings, freezing the rule + provision', () => {
    const r = assessSmallCompany(
      facts({ ...privateCo, paidUpCapital: 2 * CRORE, turnover: 30 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(SMALL_COMPANY_OUTCOME.small);
    expect(r.ruleVersionId).toBe('rv-1');
    expect(r.authorityProvisionId).toBe('prov-2-85');
    expect(r.basis).toContain('₹4.00 cr');
  });

  it('is not_small when either ceiling is exceeded', () => {
    expect(
      assessSmallCompany(
        facts({ ...privateCo, paidUpCapital: 5 * CRORE, turnover: 10 * CRORE }),
        resolve,
      ).outcome,
    ).toBe(SMALL_COMPANY_OUTCOME.notSmall);
    expect(
      assessSmallCompany(
        facts({ ...privateCo, paidUpCapital: 1 * CRORE, turnover: 60 * CRORE }),
        resolve,
      ).outcome,
    ).toBe(SMALL_COMPANY_OUTCOME.notSmall);
  });

  it('is config-driven: a future ceiling change flips the outcome with no code change', () => {
    const base = facts({ ...privateCo, paidUpCapital: 6 * CRORE, turnover: 30 * CRORE });
    // ₹6cr paid-up exceeds the current ₹4cr ceiling → not small.
    expect(assessSmallCompany(base, resolve).outcome).toBe(SMALL_COMPANY_OUTCOME.notSmall);
    // A methodology admin raises the ceiling to ₹10cr for a future period.
    const raised = makeResolver({
      [`${FRAMEWORK_AREA_KEY.entityRegulatoryProfile}|${RULE_CRITERION.paidUpCapital}`]: {
        operator: '<=',
        threshold: 10 * CRORE,
      },
    });
    expect(assessSmallCompany(base, raised).outcome).toBe(SMALL_COMPANY_OUTCOME.small);
  });
});

describe('deriveSaTriggers (§9.1 — SA 510 / 402 / 299)', () => {
  const byCode = (env: Parameters<typeof deriveSaTriggers>[0]) =>
    Object.fromEntries(deriveSaTriggers(env).map((t) => [t.code, t.triggered]));

  it('flags SA 510 only for an initial (first-year) audit', () => {
    expect(
      byCode({ initialAudit: true, accountingEnvironment: null, jointAudit: false })[
        SA_TRIGGER_CODE.sa510
      ],
    ).toBe(true);
    expect(
      byCode({ initialAudit: false, accountingEnvironment: null, jointAudit: false })[
        SA_TRIGGER_CODE.sa510
      ],
    ).toBe(false);
  });

  it('flags SA 402 when a service organisation is in the accounting environment', () => {
    expect(
      byCode({
        initialAudit: false,
        accountingEnvironment: ACCOUNTING_ENVIRONMENT.outsourced,
        jointAudit: false,
      })[SA_TRIGGER_CODE.sa402],
    ).toBe(true);
    expect(
      byCode({
        initialAudit: false,
        accountingEnvironment: ACCOUNTING_ENVIRONMENT.hybrid,
        jointAudit: false,
      })[SA_TRIGGER_CODE.sa402],
    ).toBe(true);
    expect(
      byCode({
        initialAudit: false,
        accountingEnvironment: ACCOUNTING_ENVIRONMENT.inHouse,
        jointAudit: false,
      })[SA_TRIGGER_CODE.sa402],
    ).toBe(false);
  });

  it('flags SA 299 only for a joint audit', () => {
    expect(
      byCode({ initialAudit: false, accountingEnvironment: null, jointAudit: true })[
        SA_TRIGGER_CODE.sa299
      ],
    ).toBe(true);
    expect(
      byCode({ initialAudit: false, accountingEnvironment: null, jointAudit: false })[
        SA_TRIGGER_CODE.sa299
      ],
    ).toBe(false);
  });
});
