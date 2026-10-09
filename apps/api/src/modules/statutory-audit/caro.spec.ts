import {
  CARO_OUTCOME,
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  type CaroFacts,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
import { aggregateBorrowingPeak, assessCaro } from './caro';
import {
  affectedRulesFor,
  caroCompletion,
  caroPartnerApprovalReason,
  contextStatuses,
  legacyMirror,
} from './caro-completion';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.caro;

function facts(partial: Partial<CaroFacts> = {}): CaroFacts {
  return {
    isCompany: true,
    isPrivateCompany: true,
    isBanking: false,
    isInsurance: false,
    isSection8: false,
    isOpc: false,
    isSmallCompany: false,
    profileAvailable: true,
    isHoldingOrSubsidiaryOfPublic: false,
    capitalPlusReserves: null,
    peakBankFiBorrowings: null,
    totalRevenue: null,
    cfsInScope: false,
    ...partial,
  };
}

/** Fixture resolver mirroring the seeded CARO 2020 rules (1763700000000 + 1767400000000). */
type Seed = Record<
  string,
  {
    operator: RuleOperator;
    threshold: number;
    basis: string;
    unit?: 'inr' | 'boolean';
    code: string;
  }
>;
const SEED: Seed = {
  [`${AREA}|${RULE_CRITERION.publicGroupRelationship}|`]: {
    operator: '==',
    threshold: 0,
    basis: 'relevant_period',
    unit: 'boolean',
    code: 'CARO_PVT_PUBLIC_GROUP',
  },
  [`${AREA}|${RULE_CRITERION.capitalAndReserves}|`]: {
    operator: '<=',
    threshold: 1 * CRORE,
    basis: 'balance_sheet_date',
    code: 'CARO_PVT_CAPITAL_RESERVES',
  },
  [`${AREA}|${RULE_CRITERION.borrowings}|`]: {
    operator: '<=',
    threshold: 1 * CRORE,
    basis: 'at_any_point_in_year',
    code: 'CARO_PVT_BORROWINGS',
  },
  [`${AREA}|${RULE_CRITERION.revenue}|`]: {
    operator: '<=',
    threshold: 10 * CRORE,
    basis: 'caro_measurement_basis',
    code: 'CARO_PVT_REVENUE',
  },
};

function makeResolver(overrides: Partial<Seed> = {}, empty = false): RuleResolver {
  const table: Seed = empty ? {} : ({ ...SEED, ...overrides } as Seed);
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}|${entityClass ?? ''}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: hit.code,
      ruleVersionId: `rv-${criterion}`,
      version: 1,
      areaKey,
      entityClass: entityClass ?? null,
      criterion,
      operator: hit.operator,
      unit: hit.unit ?? 'inr',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: hit.basis as ResolvedRule['measurementBasis'],
      outcome: 'exempt_condition',
      effectiveFrom: '2021-04-01',
      authorityProvisionId: 'prov-caro-2020',
      guidanceReference: 'ICAI GN on CARO 2020',
      bands: [],
    };
  };
}
const resolve = makeResolver();

const within = {
  capitalPlusReserves: 0.5 * CRORE,
  peakBankFiBorrowings: 0.5 * CRORE,
  borrowingDataBasis: 'monthly' as const,
  totalRevenue: 5 * CRORE,
};
const cond = (r: ReturnType<typeof assessCaro>, key: string) =>
  r.detail.privateTest!.conditions.find((c) => c.key === key)!;

describe('assessCaro — direct exemptions CARO-01..05 (spec §5, §20 tests 1–2)', () => {
  it('1. banking company resolves to Not Applicable - Exempt without any threshold test', () => {
    const r = assessCaro(facts({ isBanking: true, isPrivateCompany: false }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    expect(r.detail.privateTest).toBeNull();
    expect(r.detail.conclusion.entityRoute).toBe('direct_exemption');
    expect(r.detail.conclusion.directExemption).toBe('Banking company');
    expect(r.detail.directTests.find((t) => t.code === 'CARO-01')).toMatchObject({
      answer: 'yes',
      decisive: true,
    });
  });

  it.each([
    ['insurance', { isInsurance: true }, 'CARO-02', 'Insurance company'],
    ['section 8', { isSection8: true }, 'CARO-03', 'Section 8 company'],
    ['OPC', { isOpc: true }, 'CARO-04', 'One Person Company'],
    ['approved small company', { isSmallCompany: true }, 'CARO-05', 'Small company (§2(85))'],
  ])('2. %s resolves through its own direct exemption route', (_n, f, code, label) => {
    const r = assessCaro(facts({ ...f, totalRevenue: 50 * CRORE }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    expect(r.detail.conclusion.directExemption).toBe(label);
    expect(r.detail.directTests.find((t) => t.decisive)?.code).toBe(code);
    expect(r.detail.privateTest).toBeNull();
  });

  it('cites paragraph 1 and the section provisions for the exemption tests', () => {
    const r = assessCaro(facts({ isSection8: true }), resolve);
    expect(r.detail.provisionCodes).toEqual(
      expect.arrayContaining(['CARO_2020', 'CARO_2020_PARA_1', 'COS_ACT_8', 'ICAI_GN_CARO_2020']),
    );
  });

  it('a direct exemption not yet known is Information Pending, never assumed No', () => {
    const r = assessCaro(
      facts({ isPrivateCompany: false, isBanking: null, profileAvailable: false }),
      resolve,
    );
    expect(r.outcome).toBe(CARO_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts.map((m) => m.key)).toContain('banking');
  });

  it('a public company answers CARO-05 No (it cannot be a small company)', () => {
    const r = assessCaro(facts({ isPrivateCompany: false, isSmallCompany: null }), resolve);
    expect(r.detail.directTests.find((t) => t.code === 'CARO-05')?.answer).toBe('no');
    expect(r.outcome).toBe(CARO_OUTCOME.applicable);
    expect(r.detail.conclusion.entityRoute).toBe('public_company');
  });
});

describe('assessCaro — cumulative private-company test (spec §6–§8, §20 tests 3–8)', () => {
  it('3. a subsidiary/holding of a public company fails regardless of the monetary tests', () => {
    const r = assessCaro(facts({ ...within, isHoldingOrSubsidiaryOfPublic: true }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.applicable);
    expect(cond(r, 'public_group').result).toBe('failed');
    expect(cond(r, 'capital_reserves').result).toBe('satisfied');
    expect(r.detail.conclusion.failedConditions).toEqual(['public_group']);
    expect(r.detail.privateTest!.qualified).toBe(false);
  });

  it('4. capital + reserves exactly ₹1 crore satisfies; above the limit fails', () => {
    const at = assessCaro(facts({ ...within, capitalPlusReserves: 1 * CRORE }), resolve);
    expect(cond(at, 'capital_reserves').result).toBe('satisfied');
    expect(at.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    const over = assessCaro(facts({ ...within, capitalPlusReserves: 1 * CRORE + 1 }), resolve);
    expect(cond(over, 'capital_reserves').result).toBe('failed');
    expect(over.outcome).toBe(CARO_OUTCOME.applicable);
  });

  it('4b. paid-up capital and reserves components are added and the calculation preserved', () => {
    const r = assessCaro(
      facts({
        ...within,
        capitalPlusReserves: null,
        paidUpCapital: 0.4 * CRORE,
        reservesAndSurplus: 0.7 * CRORE,
      }),
      resolve,
    );
    const c = cond(r, 'capital_reserves');
    expect(c.actual).toBe(1.1 * CRORE);
    expect(c.result).toBe('failed');
    expect(c.calculation).toContain('Paid-up capital ₹0.40 cr + reserves & surplus ₹0.70 cr');
  });

  it('5. an intra-year borrowing peak above ₹1 crore fails even when year-end is low', () => {
    const r = assessCaro(
      facts({
        ...within,
        peakBankFiBorrowings: null,
        borrowingSchedule: [
          { asOn: '2024-09-30', lender: 'HDFC', lenderType: 'bank', amount: 1.2 * CRORE },
          { asOn: '2025-03-31', lender: 'HDFC', lenderType: 'bank', amount: 0.2 * CRORE },
        ],
      }),
      resolve,
    );
    expect(cond(r, 'borrowings')).toMatchObject({ result: 'failed', actual: 1.2 * CRORE });
    expect(r.outcome).toBe(CARO_OUTCOME.applicable);
  });

  it('6. aggregate across banks/FIs governs, not per-lender limits', () => {
    const r = assessCaro(
      facts({
        ...within,
        peakBankFiBorrowings: null,
        borrowingSchedule: [
          { asOn: '2024-06-30', lender: 'HDFC', lenderType: 'bank', amount: 0.6 * CRORE },
          {
            asOn: '2024-06-30',
            lender: 'SIDBI',
            lenderType: 'financial_institution',
            amount: 0.6 * CRORE,
          },
        ],
      }),
      resolve,
    );
    expect(cond(r, 'borrowings').actual).toBe(1.2 * CRORE);
    expect(cond(r, 'borrowings').result).toBe('failed');
    expect(aggregateBorrowingPeak([])).toBeNull();
  });

  it('5b. year-end-only data within the limit is Information Pending, not a pass', () => {
    const r = assessCaro(facts({ ...within, borrowingDataBasis: 'year_end_only' }), resolve);
    expect(cond(r, 'borrowings').result).toBe('pending');
    expect(cond(r, 'borrowings').pendingReason).toMatch(/year-end/);
    expect(r.outcome).toBe(CARO_OUTCOME.informationInsufficient);
    // A year-end figure already above the limit fails outright.
    const over = assessCaro(
      facts({ ...within, borrowingDataBasis: 'year_end_only', peakBankFiBorrowings: 2 * CRORE }),
      resolve,
    );
    expect(cond(over, 'borrowings').result).toBe('failed');
  });

  it('7. total revenue exactly ₹10 crore satisfies "does not exceed"; above fails', () => {
    const at = assessCaro(facts({ ...within, totalRevenue: 10 * CRORE }), resolve);
    expect(at.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    const over = assessCaro(facts({ ...within, totalRevenue: 14.82 * CRORE }), resolve);
    expect(over.outcome).toBe(CARO_OUTCOME.applicable);
    expect(over.detail.conclusion).toMatchObject({
      entityRoute: 'private_company',
      directExemption: null,
      privateExemption: 'not_qualified',
      failedCondition: 'Total revenue',
      actualValue: '₹14.82 cr',
      configuredLimit: '₹10.00 cr',
      orderVersion: 'CARO 2020 (effective 2021-04-01)',
    });
    expect(over.ruleVersionId).toBe(`rv-${RULE_CRITERION.revenue}`);
  });

  it('7b. revenue includes other income and discontinuing operations', () => {
    const r = assessCaro(
      facts({
        ...within,
        totalRevenue: null,
        revenueFromOperations: 9 * CRORE,
        otherIncome: 0.5 * CRORE,
        discontinuedOperationsRevenue: 1 * CRORE,
      }),
      resolve,
    );
    expect(cond(r, 'revenue')).toMatchObject({ actual: 10.5 * CRORE, result: 'failed' });
  });

  it('8. the exemption is granted only when every condition is satisfied', () => {
    const r = assessCaro(facts(within), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.notApplicableExempt);
    expect(r.detail.privateTest!.qualified).toBe(true);
    expect(r.detail.privateTest!.conditions.every((c) => c.result === 'satisfied')).toBe(true);
    expect(r.detail.conclusion.privateExemption).toBe('qualified');
  });

  it('a missing figure is Information Pending naming the blocking fact', () => {
    const r = assessCaro(facts({ ...within, totalRevenue: null }), resolve);
    expect(r.outcome).toBe(CARO_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts.map((m) => m.key)).toEqual(['revenue']);
  });

  it('a failed condition with a direct exemption still pending stays Information Pending', () => {
    const r = assessCaro(
      facts({ ...within, totalRevenue: 20 * CRORE, isSmallCompany: null }),
      resolve,
    );
    expect(r.outcome).toBe(CARO_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts.map((m) => m.key)).toContain('small_company');
  });
});

describe('assessCaro — period, rules library and report contexts (spec §10, §20 tests 9–11)', () => {
  it('9. a future rule-library change affects future periods only (no code change)', () => {
    const raised = makeResolver({
      [`${AREA}|${RULE_CRITERION.revenue}|`]: {
        operator: '<=',
        threshold: 20 * CRORE,
        basis: 'caro_measurement_basis',
        code: 'CARO_PVT_REVENUE',
      },
    });
    const f = facts({ ...within, totalRevenue: 15 * CRORE });
    expect(assessCaro(f, resolve).outcome).toBe(CARO_OUTCOME.applicable);
    expect(assessCaro(f, raised).outcome).toBe(CARO_OUTCOME.notApplicableExempt);
  });

  it('a period before CARO 2020 (no rule) → Further Assessment', () => {
    const r = assessCaro(facts(within), makeResolver({}, true));
    expect(r.outcome).toBe(CARO_OUTCOME.furtherAssessment);
    expect(r.detail.orderVersion).toBeNull();
  });

  it('10. standalone applicability generates the paragraph 3 programme', () => {
    const r = assessCaro(facts({ isPrivateCompany: false }), resolve);
    expect(r.detail.instantiatesClauseProgramme).toBe(true);
    expect(r.detail.reportContexts[0]).toMatchObject({
      context: 'standalone',
      status: 'applicable',
      scope: 'paragraph_3',
    });
  });

  it('11. CFS gets clause 3(xxi) only — never a duplicate paragraph 3 programme', () => {
    const r = assessCaro(facts({ isPrivateCompany: false, cfsInScope: true }), resolve);
    expect(r.detail.reportContexts[1]).toMatchObject({
      context: 'consolidated',
      status: 'applicable',
      scope: 'clause_3_xxi',
    });
  });

  it('CFS stays Pending while 02.6 is open, standalone still concludes', () => {
    const r = assessCaro(facts({ isPrivateCompany: false, cfsInScope: null }), resolve);
    expect(r.detail.reportContexts.map((c) => c.status)).toEqual(['applicable', 'pending']);
  });

  it('a non-company is not applicable', () => {
    expect(assessCaro(facts({ isCompany: false }), resolve).outcome).toBe(
      CARO_OUTCOME.notApplicableExempt,
    );
  });
});

describe('02.4 completion, partner approval and mirror (spec §9, §19)', () => {
  const base = assessCaro(facts({ isPrivateCompany: false, cfsInScope: false }), resolve).detail;

  it('12. clause-level relevance never changes Level 1 (context status is Level-1 only)', () => {
    expect(contextStatuses('applicable', true)).toEqual({
      standalone: 'applicable',
      consolidated: 'applicable',
    });
    expect(contextStatuses('not_applicable_exempt', null)).toEqual({
      standalone: 'not_applicable',
      consolidated: 'pending',
    });
  });

  it('13. an override needs the Engagement Partner; the system result is kept separately', () => {
    expect(
      caroPartnerApprovalReason({
        conclusion: 'not_applicable_exempt',
        systemOutcome: 'applicable',
        isOverridden: true,
      }),
    ).toMatch(/override/);
    expect(
      caroPartnerApprovalReason({
        conclusion: 'applicable',
        systemOutcome: 'applicable',
        isOverridden: false,
      }),
    ).toBeNull();
    expect(
      caroPartnerApprovalReason({
        conclusion: 'further_assessment',
        systemOutcome: 'information_insufficient',
        isOverridden: false,
      }),
    ).toMatch(/Further Assessment/);
  });

  it('is COMPLETE only once confirmed and the programme is instantiated', () => {
    const input = {
      detail: base,
      conclusion: 'applicable' as const,
      decided: true,
      professionalAction: 'confirm' as const,
      partnerRequired: false,
      partnerApproved: false,
      needsReevaluation: false,
      upstreamReady: true,
      programmeContexts: [] as string[],
      blockingMatterOpen: false,
      started: true,
    };
    const without = caroCompletion(input);
    expect(without.complete).toBe(false);
    expect(without.items.find((i) => i.key === 'work_programme')?.met).toBe(false);
    const done = caroCompletion({ ...input, programmeContexts: ['standalone'] });
    expect(done.complete).toBe(true);
    expect(done.contexts).toEqual({ standalone: true, consolidated: null });
    expect(caroCompletion({ ...input, decided: false, conclusion: null as never }).complete).toBe(
      false,
    );
  });

  it('mirrors 02.4 onto the Phase-02 area (one CARO answer)', () => {
    expect(legacyMirror('applicable', null, false)).toEqual({
      suggestion: 'applicable',
      conclusion: null,
      state: 'system_suggested_applicable',
    });
    expect(legacyMirror('applicable', 'not_applicable_exempt', true)).toEqual({
      suggestion: 'applicable',
      conclusion: 'not_applicable',
      state: 'overridden',
    });
    expect(legacyMirror('information_insufficient', 'further_assessment', false).state).toBe(
      'professional_judgement_required',
    );
  });

  it('names the rule a changed source fact feeds', () => {
    const d = assessCaro(facts(within), resolve).detail;
    expect(affectedRulesFor('total_revenue', d)).toEqual(['CARO_PVT_REVENUE']);
    expect(affectedRulesFor('section_8', d)).toEqual(['CARO-03']);
  });
});
