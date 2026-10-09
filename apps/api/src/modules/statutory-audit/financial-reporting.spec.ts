import {
  APPLICABILITY_TYPE,
  ENTITY_BRANCH,
  FRAMEWORK_AREA_KEY,
  FRF_CONFIDENCE,
  GROUP_EFFECT,
  REPORTING_FRAMEWORK_OUTCOME,
  SMC_STATUS,
  type FinancialReportingFacts,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
} from '@hsdg/contracts';
import { assessFinancialReporting, fyOf, nextFy } from './financial-reporting';
import { financialReportingCompletion, partnerApprovalReason } from './financial-reporting-completion';

const CRORE = 10_000_000;
const AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;

/**
 * Fixture Rules Library mirroring migration 1766850000000: effective-dated
 * versions, resolved for the audit period exactly as the real resolver does
 * (class-specific first, then class-agnostic).
 */
interface LibRow {
  code: string;
  cls: string | null;
  crit: string;
  op: RuleOperator;
  threshold: number | null;
  from: string;
  to?: string | null;
  cond?: Record<string, unknown>;
  outcome?: string;
}
const NEXT = { firstMeetsAppliesFrom: 'next_year' };
const LIB: LibRow[] = [
  { code: 'FRF_INDAS_CORP_P1', cls: 'corporate_p1', crit: 'net_worth', op: '>=', threshold: 500 * CRORE, from: '2016-04-01', cond: { measurementBaseDate: '2014-03-31', ...NEXT } },
  { code: 'FRF_INDAS_CORP_LISTED_P2', cls: 'corporate_listed_p2', crit: 'listed', op: '==', threshold: 1, from: '2017-04-01', cond: { measurementBaseDate: '2016-03-31' } },
  { code: 'FRF_INDAS_CORP_UNLISTED_P2', cls: 'corporate_unlisted_p2', crit: 'net_worth', op: '>=', threshold: 250 * CRORE, from: '2017-04-01', cond: { measurementBaseDate: '2016-03-31', ...NEXT } },
  { code: 'FRF_INDAS_NBFC_P1', cls: 'nbfc_p1', crit: 'net_worth', op: '>=', threshold: 500 * CRORE, from: '2018-04-01', cond: { measurementBaseDate: '2016-03-31', ...NEXT } },
  { code: 'FRF_INDAS_NBFC_LISTED_P2', cls: 'nbfc_listed_p2', crit: 'listed', op: '==', threshold: 1, from: '2019-04-01' },
  { code: 'FRF_INDAS_NBFC_UNLISTED_P2', cls: 'nbfc_unlisted_p2', crit: 'net_worth', op: '>=', threshold: 250 * CRORE, from: '2019-04-01', cond: { measurementBaseDate: '2016-03-31', ...NEXT } },
  { code: 'FRF_INDAS_SME_EXCEPTION', cls: 'sme_itp', crit: 'listing_exception', op: '==', threshold: 1, from: '2015-04-01', outcome: 'exempt_mandatory' },
  { code: 'FRF_INDAS_VOLUNTARY', cls: null, crit: 'voluntary_adoption', op: '==', threshold: 1, from: '2015-04-01' },
  { code: 'FRF_INDAS_GROUP_CORP', cls: 'corporate', crit: 'group_relationship', op: '==', threshold: 1, from: '2016-04-01' },
  { code: 'FRF_INDAS_GROUP_NBFC', cls: 'nbfc', crit: 'group_relationship', op: '==', threshold: 1, from: '2018-04-01' },
  { code: 'FRF_ROUTE_BANK', cls: 'bank', crit: 'entity_route', op: '==', threshold: 1, from: '2015-04-01', outcome: 'specialised_framework' },
  { code: 'FRF_ROUTE_INSURANCE', cls: 'insurance', crit: 'entity_route', op: '==', threshold: 1, from: '2015-04-01', outcome: 'specialised_framework' },
  { code: 'FRF_SMC_TURNOVER', cls: null, crit: 'turnover', op: '<=', threshold: 50 * CRORE, from: '2006-12-07', to: '2021-03-31' },
  { code: 'FRF_SMC_TURNOVER', cls: null, crit: 'turnover', op: '<=', threshold: 250 * CRORE, from: '2021-04-01' },
  { code: 'FRF_SMC_BORROWINGS', cls: null, crit: 'borrowings', op: '<=', threshold: 10 * CRORE, from: '2006-12-07', to: '2021-03-31' },
  { code: 'FRF_SMC_BORROWINGS', cls: null, crit: 'borrowings', op: '<=', threshold: 50 * CRORE, from: '2021-04-01' },
];

function resolverFor(periodStart: string, lib: LibRow[] = LIB): RuleResolver {
  const inForce = lib.filter((r) => r.from <= periodStart && (!r.to || r.to >= periodStart));
  const find = (crit: string, cls: string | null) =>
    inForce
      .filter((r) => r.crit === crit && r.cls === cls)
      .sort((a, b) => b.from.localeCompare(a.from))[0];
  return (areaKey, criterion, entityClass): ResolvedRule | null => {
    if (areaKey !== AREA) return null;
    const hit = (entityClass != null ? find(criterion, entityClass) : undefined) ?? find(criterion, null);
    if (!hit) return null;
    return {
      ruleId: hit.code,
      ruleCode: hit.code,
      ruleVersionId: `${hit.code}@${hit.from}`,
      version: 1,
      areaKey,
      entityClass: hit.cls,
      criterion: hit.crit,
      operator: hit.op,
      unit: hit.crit === 'net_worth' || hit.crit === 'turnover' || hit.crit === 'borrowings' ? 'inr' : 'boolean',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: null,
      outcome: hit.outcome ?? 'ind_as',
      effectiveFrom: hit.from,
      authorityProvisionId: `prov:${hit.code}`,
      guidanceReference: null,
      condition: hit.cond ?? null,
      bands: [],
    };
  };
}

function facts(fy: string, partial: Partial<FinancialReportingFacts> = {}): FinancialReportingFacts {
  return {
    isCompany: true,
    isPrivateCompany: false,
    isListed: false,
    listingStatus: 'unlisted',
    listingExchanges: [],
    isListedOnSmeExchange: false,
    isNbfc: false,
    isBankOrInsurance: false,
    specialEntityTypes: [],
    priorIndAs: false,
    voluntaryIndAs: false,
    groupTriggersIndAs: false,
    netWorth: null,
    turnover: null,
    borrowings: null,
    voluntaryAnswer: 'no',
    relatedEntities: [],
    auditFinancialYear: fy,
    auditPeriodStart: `${fy.slice(0, 4)}-04-01`,
    ...partial,
  };
}

/** A net-worth point at the end of FY `fy`. */
const nw = (fy: string, crore: number) => ({
  asAt: `${Number(fy.slice(0, 4)) + 1}-03-31`,
  financialYear: fy,
  value: crore * CRORE,
  source: 'test',
});

const run = (fy: string, partial: Partial<FinancialReportingFacts> = {}, lib?: LibRow[]) =>
  assessFinancialReporting(facts(fy, partial), resolverFor(`${fy.slice(0, 4)}-04-01`, lib));

describe('FY helpers', () => {
  it('maps dates to Indian financial years', () => {
    expect(fyOf('2024-03-31')).toBe('2023-24');
    expect(fyOf('2024-04-01')).toBe('2024-25');
    expect(nextFy('2099-00')).toBe('2100-01');
  });
});

describe('assessFinancialReporting — spec §22 acceptance tests', () => {
  it('1. unlisted ₹600 cr resolves through the ₹500 cr Phase I rule with the correct phase', () => {
    const r = run('2016-17', { netWorthHistory: [nw('2013-14', 600)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.ruleVersionId).toBe('FRF_INDAS_CORP_P1@2016-04-01');
    expect(r.detail.limitApplied).toBe('₹500.00 cr');
    expect(r.detail.effectiveFromFy).toBe('2016-17');
    expect(r.detail.applicabilityType).toBe(APPLICABILITY_TYPE.mandatory);
    expect(r.detail.firstTimeIndAs).toBe(true);
    expect(r.basis).toContain('threshold ₹500.00 cr');
    // In a later year the same company is continuing from FY 2016-17.
    const later = run('2024-25', { netWorthHistory: [nw('2013-14', 600), nw('2023-24', 650)] });
    expect(later.detail.effectiveFromFy).toBe('2016-17');
    expect(later.detail.applicabilityType).toBe(APPLICABILITY_TYPE.continuing);
    expect(later.detail.firstTimeIndAs).toBe(false);
  });

  it('2. unlisted ₹300 cr resolves through the ₹250 cr Phase II rule', () => {
    const r = run('2017-18', { netWorthHistory: [nw('2015-16', 300)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.ruleVersionId).toBe('FRF_INDAS_CORP_UNLISTED_P2@2017-04-01');
    expect(r.detail.limitApplied).toBe('₹250.00 cr');
    expect(r.detail.effectiveFromFy).toBe('2017-18');
    expect(r.basis).toMatch(/Unlisted company; applicable net worth ₹300\.00 cr .*threshold ₹250\.00 cr; rule FRF_INDAS_CORP_UNLISTED_P2 effective 01-Apr-2017; Ind AS applicable/);
  });

  it('3. listed non-SME company below ₹500 cr (even ₹100 cr) resolves through the listing route', () => {
    const r = run('2024-25', {
      listingStatus: 'listed',
      isListed: true,
      listingExchanges: ['nse'],
      priorFramework: 'accounting_standards',
      netWorthHistory: [nw('2023-24', 100)],
    });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.ruleVersionId).toBe('FRF_INDAS_CORP_LISTED_P2@2017-04-01');
    expect(r.detail.limitApplied).toBe('Not applicable (listing route)');
    expect(r.detail.effectiveFromFy).toBe('2024-25');
    expect(r.detail.firstTimeIndAs).toBe(true);
    // In process of listing is treated the same as listed.
    const inProc = run('2017-18', { listingStatus: 'in_process', netWorthHistory: [nw('2016-17', 20)] });
    expect(inProc.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(inProc.detail.effectiveFromFy).toBe('2017-18');
  });

  it('4. SME exchange: the proviso is tested — no mandatory listing / net-worth route', () => {
    const sme = { listingStatus: 'listed' as const, isListed: true, listingExchanges: ['sme'], isListedOnSmeExchange: true };
    const r = run('2024-25', { ...sme, netWorthHistory: [nw('2023-24', 600)], turnover: 40 * CRORE, borrowings: 5 * CRORE });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.accountingStandards);
    expect(r.detail.listing?.provisoApplies).toBe(true);
    expect(r.detail.rulesApplied?.[0]).toMatchObject({ ruleCode: 'FRF_INDAS_SME_EXCEPTION', result: 'exception_applied' });
    // An SME-listed company is still LISTED for SMC → non-SMC.
    expect(r.detail.smc?.status).toBe(SMC_STATUS.nonSmc);
    // …but voluntary adoption is still considered separately.
    const v = run('2024-25', { ...sme, voluntaryAnswer: 'yes', voluntaryFirstIndAsFy: '2024-25' });
    expect(v.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(v.detail.applicabilityType).toBe(APPLICABILITY_TYPE.voluntary);
  });

  it('5. below the direct thresholds, a group relationship is evaluated through the group rule', () => {
    const r = run('2024-25', {
      netWorthHistory: [nw('2023-24', 10)],
      relatedEntities: [
        { name: 'Parent Ltd', relationship: 'holding', framework: 'ind_as', frameworkSource: 'Listed on NSE/BSE' },
      ],
    });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.ruleVersionId).toBe('FRF_INDAS_GROUP_CORP@2016-04-01');
    expect(r.detail.group?.result).toBe(GROUP_EFFECT.triggers);
    expect(r.detail.group?.path).toContain('holding company Parent Ltd');
    expect(r.detail.group?.rows[0]?.effect).toBe(GROUP_EFFECT.triggers);
    // Unknown framework of a related company → review required (Information Pending).
    const unknown = run('2024-25', {
      netWorthHistory: [nw('2023-24', 10)],
      relatedEntities: [{ name: 'Sub Pvt', relationship: 'subsidiary', framework: 'unknown', frameworkSource: null }],
    });
    expect(unknown.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.informationInsufficient);
    expect(unknown.detail.missingFacts?.map((m) => m.key)).toContain('group');
    // The team's answer resolves it.
    const answered = run('2024-25', {
      netWorthHistory: [nw('2023-24', 10)],
      relatedEntities: [{ name: 'Sub Pvt', relationship: 'subsidiary', framework: 'unknown', frameworkSource: null }],
      groupAnswer: 'no',
      turnover: 10 * CRORE,
      borrowings: 1 * CRORE,
      groupNonSmc: 'no',
    });
    expect(answered.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.accountingStandards);
  });

  it('6. a prior Ind AS adopter stays on the continuing route regardless of current net worth', () => {
    const r = run('2024-25', {
      indAsAlreadyApplicable: 'yes',
      firstIndAsFy: '2019-20',
      netWorthHistory: [nw('2023-24', 5)],
    });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.detail.applicabilityType).toBe(APPLICABILITY_TYPE.continuing);
    expect(r.detail.firstTimeIndAs).toBe(false);
    expect(r.detail.effectiveFromFy).toBe('2019-20');
    expect(r.detail.limitApplied).toBe('Not applicable (continuing)');
    // FRF-01 alone (prior year on Ind AS) also routes to continuing.
    expect(run('2024-25', { priorFramework: 'ind_as' }).detail.applicabilityType).toBe(
      APPLICABILITY_TYPE.continuing,
    );
  });

  it('7. NBFC ₹600 cr uses the NBFC 01-Apr-2018 phase, not the corporate phase', () => {
    const nbfc = { isNbfc: true, specialEntityTypes: ['nbfc'] };
    const r = run('2018-19', { ...nbfc, netWorthHistory: [nw('2015-16', 600)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.ruleVersionId).toBe('FRF_INDAS_NBFC_P1@2018-04-01');
    expect(r.detail.entityBranch).toBe(ENTITY_BRANCH.nbfc);
    expect(r.detail.effectiveFromFy).toBe('2018-19');
    // In FY 2017-18 the corporate ₹500 cr phase must NOT pull the NBFC in.
    const before = run('2017-18', { ...nbfc, netWorthHistory: [nw('2015-16', 600)], turnover: 1, borrowings: 1 });
    expect(before.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.informationInsufficient);
    expect(before.basis).toContain('No Ind AS NBFC roadmap rule');
  });

  it('8. NBFC unlisted ₹300 cr uses the configured 01-Apr-2019 / ₹250 cr rule', () => {
    const r = run('2019-20', { isNbfc: true, specialEntityTypes: ['nbfc'], netWorthHistory: [nw('2015-16', 300)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.ruleVersionId).toBe('FRF_INDAS_NBFC_UNLISTED_P2@2019-04-01');
    expect(r.detail.limitApplied).toBe('₹250.00 cr');
  });

  it('9. an AS company is separately assessed for SMC using the configured ₹250 cr / ₹50 cr limits', () => {
    const base = { netWorthHistory: [nw('2023-24', 100)], groupNonSmc: 'no' as const };
    const smc = run('2024-25', { ...base, turnover: 200 * CRORE, borrowings: 40 * CRORE });
    expect(smc.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.accountingStandards);
    expect(smc.detail.smc).toMatchObject({
      status: SMC_STATUS.smc,
      turnoverThreshold: 250 * CRORE,
      borrowingsThreshold: 50 * CRORE,
    });
    expect(smc.detail.smc?.authorityProvisionId).toBe('prov:FRF_SMC_TURNOVER');
    expect(run('2024-25', { ...base, turnover: 260 * CRORE, borrowings: 1 }).detail.smc?.status).toBe(
      SMC_STATUS.nonSmc,
    );
    // Before 1-Apr-2021 the 2006 Rules' ₹50 cr turnover limit applies.
    expect(run('2019-20', { ...base, netWorthHistory: [nw('2018-19', 100)], turnover: 60 * CRORE, borrowings: 1 }).detail.smc?.status).toBe(SMC_STATUS.nonSmc);
    // A holding/subsidiary relationship with no answer → Information Insufficient.
    const grp = run('2024-25', {
      netWorthHistory: [nw('2023-24', 100)],
      turnover: 1,
      borrowings: 1,
      relatedEntities: [{ name: 'Parent', relationship: 'holding', framework: 'accounting_standards', frameworkSource: null }],
    });
    expect(grp.detail.smc?.status).toBe(SMC_STATUS.informationInsufficient);
  });

  it('10. a future-dated Rules Library change affects future periods only (no code change)', () => {
    const lib: LibRow[] = [
      ...LIB,
      { code: 'FRF_INDAS_CORP_UNLISTED_P2', cls: 'corporate_unlisted_p2', crit: 'net_worth', op: '>=', threshold: 400 * CRORE, from: '2030-04-01', cond: { measurementBaseDate: '2029-03-31', ...NEXT } },
    ];
    const hist = { netWorthHistory: [nw('2023-24', 300), nw('2029-30', 300)], turnover: 1, borrowings: 1, groupNonSmc: 'no' as const };
    expect(run('2024-25', hist, lib).outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    const future = run('2030-31', hist, lib);
    expect(future.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.accountingStandards);
    expect(future.detail.limitApplied).toBe('₹400.00 cr');
  });

  it('11. every triggered rule cites its provision for View Provision', () => {
    const r = run('2024-25', { listingStatus: 'listed', isListed: true, netWorthHistory: [nw('2023-24', 10)] });
    for (const a of r.detail.rulesApplied ?? []) expect(a.authorityProvisionId).toMatch(/^prov:/);
    expect(r.authorityProvisionId).toBe('prov:FRF_INDAS_CORP_LISTED_P2');
  });
});

describe('assessFinancialReporting — Rule 4 timing (§10)', () => {
  it('a company first meeting the threshold at a year end applies Ind AS from the next year', () => {
    const r = run('2024-25', { netWorthHistory: [nw('2021-22', 100), nw('2023-24', 260)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.detail.netWorth).toMatchObject({ firstMetFy: '2023-24', appliesFromFy: '2024-25', result: 'met' });
    expect(r.detail.netWorth?.measurementDate).toBe('2024-03-31');
    expect(r.detail.firstTimeIndAs).toBe(true);
  });

  it('a threshold met only at the end of the audit year does not apply to that year', () => {
    const r = run('2024-25', {
      netWorthHistory: [nw('2023-24', 100), nw('2024-25', 400)],
      turnover: 1,
      borrowings: 1,
      groupNonSmc: 'no',
    });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.accountingStandards);
    expect(r.detail.netWorth?.result).toBe('not_met');
  });

  it('flags professional review when Ind AS should have applied earlier but the prior year used AS', () => {
    const r = run('2024-25', { priorFramework: 'accounting_standards', netWorthHistory: [nw('2015-16', 300)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.indAs);
    expect(r.detail.confidence).toBe(FRF_CONFIDENCE.professionalReview);
    expect(r.state).toBe('professional_judgement_required');
  });
});

describe('assessFinancialReporting — branches and guards (§8)', () => {
  it('routes a bank by the Rules Library route, never the ordinary roadmap', () => {
    const r = run('2024-25', { isBank: true, isBankOrInsurance: true, specialEntityTypes: ['bank'], netWorthHistory: [nw('2023-24', 900)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.specialised);
    expect(r.ruleVersionId).toBe('FRF_ROUTE_BANK@2015-04-01');
    expect(r.detail.entityBranch).toBe(ENTITY_BRANCH.bank);
    expect(r.detail.blockingReview).toBe(true);
  });

  it('keeps an insurer specialised even when no route is configured', () => {
    const lib = LIB.filter((l) => l.code !== 'FRF_ROUTE_INSURANCE');
    const r = run('2024-25', { isInsurance: true, isBankOrInsurance: true, specialEntityTypes: ['insurance'] }, lib);
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.specialised);
    expect(r.detail.confidence).toBe(FRF_CONFIDENCE.professionalReview);
  });

  it('is professional review for a non-company and Information Insufficient for an unknown type', () => {
    expect(run('2024-25', { isCompany: false }).outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.professionalReview);
    const u = run('2024-25', { isCompany: null });
    expect(u.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.informationInsufficient);
    expect(u.detail.missingFacts?.[0]?.anchor).toBe('profile-card-A');
  });

  it('is Information Insufficient, naming the field, when net worth is missing', () => {
    const r = run('2024-25');
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.informationInsufficient);
    expect(r.state).toBe('pending_information');
    expect(r.detail.missingFacts?.map((m) => m.key)).toEqual(['net_worth']);
  });

  it('asks for voluntary adoption when it is Information Pending and nothing else decides', () => {
    const r = run('2024-25', { voluntaryAnswer: 'pending', netWorthHistory: [nw('2023-24', 10)] });
    expect(r.outcome).toBe(REPORTING_FRAMEWORK_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts?.map((m) => m.key)).toEqual(['voluntary']);
  });
});

describe('financialReportingCompletion (§21) and partner approval (FRF-05)', () => {
  const decided = (r: ReturnType<typeof run>, conclusion = r.outcome, isOverridden = false) => ({
    state: (isOverridden ? 'overridden' : 'applicable') as 'applicable' | 'overridden',
    conclusion,
    systemOutcome: r.outcome,
    isOverridden,
  });

  it('is complete for a determined AS + SMC conclusion with every answer recorded', () => {
    const f = facts('2024-25', {
      netWorthHistory: [nw('2023-24', 100)],
      turnover: 10 * CRORE,
      borrowings: 1 * CRORE,
      groupNonSmc: 'no',
      priorFramework: 'accounting_standards',
      indAsAlreadyApplicable: 'no',
      voluntaryAnswer: 'no',
    });
    const r = assessFinancialReporting(f, resolverFor('2024-04-01'));
    const c = financialReportingCompletion({
      decision: decided(r),
      detail: r.detail,
      facts: f,
      captured: { isListedOnSmeExchange: false, priorIndAs: false, voluntaryIndAs: false, groupTriggersIndAs: false },
      profileConfirmed: true,
      partnerRequired: false,
      partnerApproved: false,
      blockingReviewOpen: false,
    });
    expect(c.items.filter((i) => i.met === false)).toEqual([]);
    expect(c.complete).toBe(true);
    expect(c.items.find((i) => i.key === 'smc')?.met).toBe(true);
    expect(c.items.find((i) => i.key === 'first_time')?.met).toBeNull();
  });

  it('needs FRF-06 for Ind AS, partner approval for an override, and no open review', () => {
    const f = facts('2024-25', { netWorthHistory: [nw('2023-24', 300)], priorFramework: 'accounting_standards', indAsAlreadyApplicable: 'no' });
    const r = assessFinancialReporting(f, resolverFor('2024-04-01'));
    const d = decided(r, REPORTING_FRAMEWORK_OUTCOME.accountingStandards, true);
    expect(partnerApprovalReason(d, r.detail)).toMatch(/overrides/);
    const c = financialReportingCompletion({
      decision: d,
      detail: r.detail,
      facts: f,
      captured: { isListedOnSmeExchange: false, priorIndAs: false, voluntaryIndAs: false, groupTriggersIndAs: false },
      profileConfirmed: true,
      partnerRequired: true,
      partnerApproved: false,
      blockingReviewOpen: true,
    });
    expect(c.complete).toBe(false);
    const unmet = c.items.filter((i) => i.met === false).map((i) => i.key);
    expect(unmet).toEqual(expect.arrayContaining(['partner_approval', 'no_blocking_review']));
    expect(partnerApprovalReason(decided(r), r.detail)).toBeNull();
  });
});
