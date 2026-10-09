import {
  FRAMEWORK_AREA_KEY,
  ICFR_CONDITION_RESULT,
  ICFR_ENTITY_ROUTE,
  ICFR_FILING_STATUS,
  ICFR_OUTCOME,
  ICFR_ROUTE_RESULT,
  RULE_CRITERION,
  type IcfrBorrowingPoint,
  type IcfrFacts,
  type IcfrFilingRecord,
  type ResolvedRule,
  type RuleOperator,
  type RuleUnit,
} from '@hsdg/contracts';
import { aggregateCoveredBorrowings, assessIcfr, borrowingSourcesOf } from './icfr';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.ifc;
const TODAY = '2025-06-30';

/** Filings traceably on time (the default happy path). */
const ON_TIME: IcfrFilingRecord[] = [
  {
    form: 'AOC-4',
    section: '137',
    period: '2023-24',
    dueDate: '2024-10-29',
    filedOn: '2024-10-20',
    srn: 'F1',
    source: 'mca',
  },
  {
    form: 'MGT-7',
    section: '92',
    period: '2023-24',
    dueDate: '2024-11-28',
    filedOn: '2024-11-25',
    srn: 'F2',
    source: 'mca',
  },
];

function facts(partial: Partial<IcfrFacts> = {}): IcfrFacts {
  return {
    isCompany: true,
    isPrivateCompany: true,
    isOpc: false,
    isSmallCompany: false,
    turnover: null,
    turnoverAudited: true,
    peakCoveredBorrowings: null,
    filingDefault: null,
    filings: ON_TIME,
    today: TODAY,
    ...partial,
  };
}

interface SeedRule {
  code: string;
  operator: RuleOperator;
  unit: RuleUnit;
  threshold: number;
  basis: string;
  condition?: Record<string, unknown>;
  effectiveFrom?: string;
}

/** Fixture resolver mirroring migrations 1763800000000 + 1767500000000. */
const SEED: Record<string, SeedRule> = {
  [RULE_CRITERION.opcRoute]: {
    code: 'ICFR_OPC_ROUTE',
    operator: '==',
    unit: 'boolean',
    threshold: 1,
    basis: 'entity_status',
    condition: { requiresFilingCondition: true },
  },
  [RULE_CRITERION.smallCompanyRoute]: {
    code: 'ICFR_SMALL_COMPANY_ROUTE',
    operator: '==',
    unit: 'boolean',
    threshold: 1,
    basis: 'entity_status',
    condition: { requiresFilingCondition: true },
  },
  [RULE_CRITERION.turnover]: {
    code: 'ICFR_EXEMPT_TURNOVER',
    operator: '<',
    unit: 'inr',
    threshold: 50 * CRORE,
    basis: 'latest_audited_fs',
  },
  [RULE_CRITERION.borrowings]: {
    code: 'ICFR_EXEMPT_BORROWINGS',
    operator: '<',
    unit: 'inr',
    threshold: 25 * CRORE,
    basis: 'at_any_point_in_year',
    condition: {
      sources: ['bank', 'financial_institution', 'body_corporate'],
      excludes: ['other'],
    },
  },
  [RULE_CRITERION.monetaryJoin]: {
    code: 'ICFR_PRIVATE_MONETARY_JOIN',
    operator: '==',
    unit: 'boolean',
    threshold: 1,
    basis: 'entity_status',
    condition: { join: 'and' },
  },
  [RULE_CRITERION.filingCondition]: {
    code: 'ICFR_FILING_CONDITION',
    operator: '==',
    unit: 'boolean',
    threshold: 0,
    basis: 'relevant_period',
    condition: { sections: ['137', '92'] },
  },
};

function makeResolver(overrides: Record<string, Partial<SeedRule> | null> = {}) {
  return (areaKey: string, criterion: string): ResolvedRule | null => {
    if (areaKey !== AREA) return null;
    const o = criterion in overrides ? overrides[criterion] : {};
    if (o === null) return null;
    const base = SEED[criterion];
    if (!base) return null;
    const hit = { ...base, ...o };
    return {
      ruleId: `r-${criterion}`,
      ruleCode: hit.code,
      ruleVersionId: `rv-${criterion}`,
      version: 1,
      areaKey,
      entityClass: null,
      criterion,
      operator: hit.operator,
      unit: hit.unit,
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: hit.basis as ResolvedRule['measurementBasis'],
      outcome: 'exempt_condition',
      effectiveFrom: hit.effectiveFrom ?? '2016-04-01',
      authorityProvisionId: 'prov-143-3-i',
      guidanceReference: 'MCA notification',
      condition: hit.condition ?? null,
      bands: [],
    };
  };
}
const resolve = makeResolver();
const cond = (r: ReturnType<typeof assessIcfr>, key: string) =>
  r.detail.conditions!.find((c) => c.key === key)!;
const routeOf = (r: ReturnType<typeof assessIcfr>, key: string) =>
  r.detail.routes!.find((c) => c.key === key)!;

describe('assessIcfr — §143(3)(i) applicability (spec v1.1 §5–§10, §24, §25)', () => {
  it('public / non-private company → Applicable without running the private-company tests', () => {
    const r = assessIcfr(facts({ isPrivateCompany: false, turnover: 1 * CRORE }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.entityRoute).toBe(ICFR_ENTITY_ROUTE.publicCompany);
    expect(r.detail.configuresIcfrWorkstream).toBe(true);
    expect(r.detail.routes!.every((x) => x.result === ICFR_ROUTE_RESULT.notTested)).toBe(true);
    expect(r.detail.conditions!.every((c) => c.result === ICFR_CONDITION_RESULT.notTested)).toBe(
      true,
    );
    expect(r.detail.monetaryTest).toBeNull();
  });

  it('a non-company is outside §143(3)(i); an unknown entity type is Information Pending', () => {
    expect(assessIcfr(facts({ isCompany: false }), resolve).outcome).toBe(ICFR_OUTCOME.exempt);
    const r = assessIcfr(facts({ isCompany: null }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts!.map((m) => m.key)).toContain('company_type');
  });

  it('private OPC → exempt via the OPC route with the filing condition satisfied; monetary not tested', () => {
    const r = assessIcfr(facts({ isOpc: true, turnover: 90 * CRORE }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.exempt);
    expect(routeOf(r, 'opc').result).toBe(ICFR_ROUTE_RESULT.exemptRoute);
    expect(routeOf(r, 'small_company').result).toBe(ICFR_ROUTE_RESULT.notTested);
    expect(cond(r, 'turnover').result).toBe(ICFR_CONDITION_RESULT.notTested);
    expect(cond(r, 'filing').result).toBe(ICFR_CONDITION_RESULT.satisfied);
    expect(r.ruleVersionId).toBe(`rv-${RULE_CRITERION.opcRoute}`);
  });

  it('private OPC with a filing default → exemption unavailable (Applicable)', () => {
    const late: IcfrFilingRecord[] = [{ ...ON_TIME[0]!, filedOn: '2024-12-15' }, ON_TIME[1]!];
    const r = assessIcfr(facts({ isOpc: true, filings: late }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.filingDefaultBlocks).toBe(true);
    expect(r.detail.filing!.status).toBe(ICFR_FILING_STATUS.defaultIdentified);
  });

  it('private OPC with filing status unknown → Information Pending (unknown ≠ no default)', () => {
    const r = assessIcfr(facts({ isOpc: true, filings: [], filingDefault: null }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts!.map((m) => m.key)).toContain('filing');
  });

  it('a bare "no default" flag without traceable support stays Pending; with evidence it satisfies', () => {
    const bare = assessIcfr(facts({ isOpc: true, filings: [], filingDefault: false }), resolve);
    expect(bare.detail.filing!.status).toBe(ICFR_FILING_STATUS.pending);
    const doc = assessIcfr(
      facts({ isOpc: true, filings: [], filingDefault: false, filingEvidence: 'MCA V3 extract' }),
      resolve,
    );
    expect(doc.outcome).toBe(ICFR_OUTCOME.exempt);
  });

  it('a filing not yet due is not a default; one overdue and unfiled is', () => {
    const notDue: IcfrFilingRecord[] = [
      { ...ON_TIME[0]!, dueDate: '2025-10-29', filedOn: null, period: '2024-25' },
      ...ON_TIME,
    ];
    expect(assessIcfr(facts({ isOpc: true, filings: notDue }), resolve).outcome).toBe(
      ICFR_OUTCOME.exempt,
    );
    const overdue: IcfrFilingRecord[] = [{ ...ON_TIME[1]!, filedOn: null }];
    expect(assessIcfr(facts({ isOpc: true, filings: overdue }), resolve).outcome).toBe(
      ICFR_OUTCOME.applicable,
    );
  });

  it('small company consumes the approved 02.1 result (no recalculation here)', () => {
    // Turnover far above any small-company limit — still exempt because 02.1 approved "small".
    const r = assessIcfr(facts({ isSmallCompany: true, turnover: 400 * CRORE }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.exempt);
    expect(routeOf(r, 'small_company').result).toBe(ICFR_ROUTE_RESULT.exemptRoute);
    expect(r.detail.monetaryTest).toBeNull();
  });

  it('₹49.99cr turnover + ₹24.99cr peak covered borrowings + no default → both monetary tests pass → Exempt', () => {
    const r = assessIcfr(
      facts({ turnover: 49.99 * CRORE, peakCoveredBorrowings: 24.99 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.exempt);
    expect(r.detail.monetaryTest).toEqual({
      tested: true,
      turnoverWithinLimit: true,
      borrowingsWithinLimit: true,
    });
    expect(r.detail.monetaryJoin).toBe('and');
    expect(r.detail.reportingApplies).toBe(false);
    expect(r.detail.controlsPhaseUnaffected).toBe(true);
    expect(r.detail.rule11gSeparate).toBe(true);
  });

  it('turnover exactly ₹50cr fails "< ₹50cr" → Applicable', () => {
    const r = assessIcfr(
      facts({ turnover: 50 * CRORE, peakCoveredBorrowings: 10 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(cond(r, 'turnover').result).toBe(ICFR_CONDITION_RESULT.failed);
    expect(cond(r, 'turnover').limitDisplay).toBe('₹50.00 cr');
    expect(cond(r, 'turnover').operator).toBe('<');
    expect(r.detail.conclusion!.reason).toMatch(/Turnover condition failed/);
  });

  it('peak covered borrowings exactly ₹25cr fails "< ₹25cr" → Applicable', () => {
    const r = assessIcfr(
      facts({ turnover: 20 * CRORE, peakCoveredBorrowings: 25 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(cond(r, 'borrowings').result).toBe(ICFR_CONDITION_RESULT.failed);
    expect(r.ruleVersionId).toBe(`rv-${RULE_CRITERION.borrowings}`);
  });

  it('borrowing test aggregates covered body-corporate debt by date and uses the intra-year peak, not year end', () => {
    const schedule: IcfrBorrowingPoint[] = [
      { asOn: '2024-09-30', lender: 'HDFC Bank', source: 'bank', amount: 15 * CRORE },
      { asOn: '2024-09-30', lender: 'Acme Pvt Ltd', source: 'body_corporate', amount: 12 * CRORE },
      { asOn: '2024-09-30', lender: 'Promoter', source: 'other', amount: 5 * CRORE },
      { asOn: '2025-03-31', lender: 'HDFC Bank', source: 'bank', amount: 15 * CRORE },
    ];
    const r = assessIcfr(
      facts({ turnover: 20 * CRORE, borrowingSchedule: schedule, borrowingDataBasis: 'monthly' }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    const b = r.detail.borrowing!;
    expect(b.maximumAggregate).toBe(27 * CRORE); // bank 15 + body corporate 12; "other" excluded
    expect(b.peakDate).toBe('2024-09-30');
    expect(b.bySource.body_corporate).toBe(12 * CRORE);
    expect(b.bySource.other).toBe(5 * CRORE);
    expect(b.excludedSources).toEqual(['other']);
    expect(cond(r, 'borrowings').calculation).toMatch(/excluded per rule: other/);
  });

  it('year-end-only data within the limit cannot prove "at any point" → Pending', () => {
    const r = assessIcfr(
      facts({
        turnover: 20 * CRORE,
        peakCoveredBorrowings: 15 * CRORE,
        borrowingDataBasis: 'year_end_only',
      }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.informationInsufficient);
    expect(cond(r, 'borrowings').pendingReason).toMatch(/year-end/);
  });

  it('BOTH monetary conditions are required — one passing alone is insufficient', () => {
    const r = assessIcfr(
      facts({ turnover: 72.4 * CRORE, peakCoveredBorrowings: 11.2 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(cond(r, 'borrowings').result).toBe(ICFR_CONDITION_RESULT.satisfied);
    expect(r.detail.conclusion).toMatchObject({
      result: ICFR_OUTCOME.applicable,
      entityRoute: ICFR_ENTITY_ROUTE.privateCompany,
      opc: ICFR_ROUTE_RESULT.no,
      smallCompany: ICFR_ROUTE_RESULT.no,
      turnover: '₹72.40 cr',
      peakBorrowings: '₹11.20 cr',
      filingCondition: ICFR_CONDITION_RESULT.satisfied,
    });
  });

  it('one figure at/over its limit decides even while the other is missing', () => {
    const r = assessIcfr(facts({ turnover: 60 * CRORE }), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
  });

  it('a filing default makes the exemption unavailable even when both monetary tests pass', () => {
    const r = assessIcfr(
      facts({
        turnover: 20 * CRORE,
        peakCoveredBorrowings: 20 * CRORE,
        filingDefault: true,
        filings: [],
      }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.applicable);
    expect(r.detail.filingDefaultBlocks).toBe(true);
    expect(r.detail.conclusion!.reason).toMatch(/Filing-default condition failed/);
  });

  it('a provisional (unaudited) turnover is never substituted → Pending', () => {
    const r = assessIcfr(
      facts({ turnover: 10 * CRORE, turnoverAudited: false, peakCoveredBorrowings: 5 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.informationInsufficient);
    expect(cond(r, 'turnover').pendingReason).toMatch(/provisional/);
  });

  it('missing monetary facts → Information Pending naming each', () => {
    const r = assessIcfr(facts(), resolve);
    expect(r.outcome).toBe(ICFR_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts!.map((m) => m.key)).toEqual(['turnover', 'peak_borrowings']);
  });

  it('an unconcluded 02.1 small-company result keeps the private test Pending when money fails', () => {
    const r = assessIcfr(
      facts({ isSmallCompany: null, turnover: 60 * CRORE, peakCoveredBorrowings: 5 * CRORE }),
      resolve,
    );
    expect(r.outcome).toBe(ICFR_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts!.map((m) => m.key)).toContain('small_company');
  });

  it('no exemption-notification version for the period → Further Assessment for a private company only', () => {
    const none = makeResolver(
      Object.fromEntries(Object.keys(SEED).map((k) => [k, null])) as Record<string, null>,
    );
    const r = assessIcfr(facts({ turnover: 10 * CRORE, peakCoveredBorrowings: 5 * CRORE }), none);
    expect(r.outcome).toBe(ICFR_OUTCOME.furtherAssessment);
    expect(r.detail.notificationVersion).toBeNull();
    expect(assessIcfr(facts({ isPrivateCompany: false }), none).outcome).toBe(
      ICFR_OUTCOME.applicable,
    );
  });

  it('a future rule change (threshold / operator / join) is pure data — no code change', () => {
    const f = facts({ turnover: 50 * CRORE, peakCoveredBorrowings: 30 * CRORE });
    expect(assessIcfr(f, resolve).outcome).toBe(ICFR_OUTCOME.applicable);
    const v2 = makeResolver({
      [RULE_CRITERION.turnover]: { operator: '<=', effectiveFrom: '2030-04-01' },
      [RULE_CRITERION.monetaryJoin]: { condition: { join: 'or' } },
    });
    const r = assessIcfr(f, v2);
    expect(r.outcome).toBe(ICFR_OUTCOME.exempt);
    expect(r.detail.monetaryJoin).toBe('or');
  });

  it('records the exemption notification version, provisions and report contexts', () => {
    const r = assessIcfr(
      facts({ turnover: 10 * CRORE, peakCoveredBorrowings: 5 * CRORE, cfsInScope: true }),
      resolve,
    );
    expect(r.detail.notificationVersion).toEqual({
      code: 'MCA_ICFR_PVT_EXEMPTION',
      effectiveFrom: '2016-04-01',
    });
    expect(r.detail.provisionCodes).toEqual(
      expect.arrayContaining([
        'COS_ACT_143_3_I',
        'MCA_ICFR_PVT_EXEMPTION',
        'COS_ACT_92',
        'COS_ACT_137',
      ]),
    );
    expect(r.detail.reportContexts!.map((c) => c.status)).toEqual(['not_applicable', 'applicable']);
    expect(r.detail.factsUsed!.find((x) => x.key === 'cfs_in_scope')!.value).toBe('Yes');
  });
});

describe('borrowing helpers', () => {
  it('covered sources come from the rule; no configured list counts every source', () => {
    expect(borrowingSourcesOf(null).covered).toHaveLength(4);
    const agg = aggregateCoveredBorrowings(
      [
        { asOn: '2024-04-30', lender: 'A', source: 'bank', amount: 5 },
        { asOn: '2024-04-30', lender: 'B', source: 'other', amount: 50 },
        { asOn: '2024-05-31', lender: 'A', source: 'bank', amount: 8 },
      ],
      ['bank'],
    )!;
    expect(agg).toMatchObject({ peak: 8, on: '2024-05-31', dates: 2, lenders: 2 });
  });
});
