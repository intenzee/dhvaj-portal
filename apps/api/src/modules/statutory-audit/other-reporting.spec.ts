import {
  AUDIT_TRAIL_CONCLUSION,
  EMPTY_CROSS_REFS,
  EMPTY_DIRECTOR_STATUS,
  EMPTY_FRAUD_STATUS,
  EMPTY_OTHER_REPORTING_CAPTURED,
  FRAUD_ROUTE,
  FRAMEWORK_AREA_KEY,
  OTHER_REPORTING_OUTCOME,
  REMUNERATION_OUTCOME,
  REPORTING_APPLICABILITY as APPL,
  REPORTING_CARD as CARD,
  REPORTING_STATUS as RS,
  RULE_CRITERION as C,
  type AuditRuleBandRecord,
  type OtherReportingBaseFacts,
  type ReportingCardKey,
  type ResolvedRule,
  type RuleOperator,
  type RuleResolver,
  type SoftwareSystemInput,
} from '@hsdg/contracts';
import { assessOtherReporting, normaliseCaptured } from './other-reporting';
import {
  otherReportingCompletion,
  otherReportingFingerprint,
  otherReportingLegacyMirror,
  otherReportingPartnerApprovalReason,
} from './other-reporting-completion';

const CRORE = 10_000_000;
const LAKH = 100_000;
const A143 = FRAMEWORK_AREA_KEY.section143;
const A11 = FRAMEWORK_AREA_KEY.rule11;

/** A clean, fully answered public company with one compliant audit-trail system. */
const COMPLIANT_SYSTEM: SoftwareSystemInput = {
  id: 'sys-a',
  name: 'Tally Prime',
  hasAuditTrailFeature: true,
  auditTrailOperatedAllYear: true,
  module: 'gl',
  featureStatus: 'available',
  enabledThroughout: 'yes',
  transactionsCovered: 'complete',
  canAlterOrDisable: 'no',
  tampering: 'no',
  preservation: 'compliant',
};

function facts(partial: Partial<OtherReportingBaseFacts> = {}): OtherReportingBaseFacts {
  return {
    ...EMPTY_OTHER_REPORTING_CAPTURED,
    softwareSystems: [COMPLIANT_SYSTEM],
    foreseeableLosses: {
      hasLongTermContracts: 'no',
      hasDerivativeContracts: 'no',
      provisionAdequate: 'pending',
      linkedWorkpapers: [],
    },
    iepf: { status: 'not_applicable', delayAmount: null, delayPeriod: null, sourceWorkpaper: null },
    dividend: {
      declaredOrPaid: false,
      kind: null,
      section123Compliant: 'pending',
      note: null,
      sourceWorkpaper: null,
    },
    managerialPersons: [
      { id: 'p1', name: 'MD', category: 'managing_director', remuneration: 40 * LAKH },
    ],
    section198NetProfit: 10 * CRORE,
    isCompany: true,
    isPublicCompany: true,
    publicCompanySource: 'test',
    auditTrailInForce: true,
    auditTrailEffectiveFrom: '2023-04-01',
    periodStart: '2024-04-01',
    rule11Version: { code: 'AUDIT_RULE_11', effectiveFrom: '2021-04-01' },
    fraud: EMPTY_FRAUD_STATUS,
    directors: { ...EMPTY_DIRECTOR_STATUS, total: 3, cleared: 3, conclusion: 'none_found' },
    crossRefs: EMPTY_CROSS_REFS,
    evidenceCounts: {},
    scheduleVBands: [],
    ...partial,
  };
}

type SeedRow = {
  operator: RuleOperator;
  threshold: number | null;
  effectiveFrom?: string;
  bands?: AuditRuleBandRecord[];
  condition?: Record<string, unknown>;
};
type Seed = Record<string, SeedRow | null>;

const band = (lower: number | null, upper: number | null, ceiling: number, i: number) => ({
  id: `b${i}`,
  auditRuleVersionId: 'rv-sv',
  lower,
  upper,
  ceilingValue: ceiling,
  label: `Band ${i}`,
  sortOrder: i,
});
const SCHEDULE_V_V2: SeedRow = {
  operator: '<=',
  threshold: null,
  effectiveFrom: '2016-09-12',
  condition: { excess_percent: 0.01, doubled_by_special_resolution: true },
  bands: [
    band(null, 5 * CRORE, 60 * LAKH, 1),
    band(5 * CRORE, 100 * CRORE, 84 * LAKH, 2),
    band(100 * CRORE, 250 * CRORE, 120 * LAKH, 3),
    band(250 * CRORE, null, 120 * LAKH, 4),
  ],
};

const SEED: Seed = {
  [`${A143}|${C.managerialRemunerationPercent}`]: { operator: '<=', threshold: 11 },
  [`${A143}|${C.remunerationOneExecutivePercent}`]: { operator: '<=', threshold: 5 },
  [`${A143}|${C.remunerationMultiExecutivePercent}`]: { operator: '<=', threshold: 10 },
  [`${A143}|${C.remunerationNonExecWithMgmtPercent}`]: { operator: '<=', threshold: 1 },
  [`${A143}|${C.remunerationNonExecWithoutMgmtPercent}`]: { operator: '<=', threshold: 3 },
  [`${A143}|${C.fraudReportingThreshold}`]: { operator: '>=', threshold: 1 * CRORE },
  [`${A143}|${C.fraudInitialNoticeDays}`]: { operator: '<=', threshold: 2 },
  [`${A143}|${C.boardReplyDays}`]: { operator: '<=', threshold: 45 },
  [`${A143}|${C.cgForwardDays}`]: { operator: '<=', threshold: 15 },
  [`${A143}|${C.scheduleVCeiling}`]: SCHEDULE_V_V2,
  [`${A11}|${C.auditTrailEffective}`]: {
    operator: '>=',
    threshold: null,
    effectiveFrom: '2023-04-01',
  },
  [`${A11}|${C.retentionYears}`]: { operator: '>=', threshold: 8 },
};

function makeResolver(overrides: Seed = {}): RuleResolver {
  const table = { ...SEED, ...overrides };
  return (areaKey, criterion): ResolvedRule | null => {
    const hit = table[`${areaKey}|${criterion}`];
    if (!hit) return null;
    return {
      ruleId: 'r',
      ruleCode: `${areaKey}_${criterion}`.toUpperCase(),
      ruleVersionId: `rv-${criterion}`,
      version: 1,
      areaKey,
      entityClass: null,
      criterion,
      operator: hit.operator,
      unit: 'percent',
      threshold: hit.threshold,
      thresholdHigh: null,
      measurementBasis: null,
      outcome: 'x',
      effectiveFrom: hit.effectiveFrom ?? '2014-04-01',
      authorityProvisionId: 'prov',
      guidanceReference: null,
      condition: hit.condition ?? null,
      bands: hit.bands ?? [],
    };
  };
}
const resolve = makeResolver();
const card = (r: ReturnType<typeof assessOtherReporting>, k: ReportingCardKey) =>
  r.detail.cards.find((c) => c.key === k)!;
const test197 = (r: ReturnType<typeof assessOtherReporting>, k: string) =>
  r.detail.remuneration.categories.find((t) => t.key === k)!;

describe('02.7 matrix — Section 143(3) core and the clean case', () => {
  it('instantiates every Section 143(3) card (a)–(j) incl. (h), the Rule 11 matters and the other reporting', () => {
    const r = assessOtherReporting(facts(), resolve);
    const keys = r.detail.cards.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(Object.values(CARD)));
    expect(keys).toHaveLength(Object.values(CARD).length);
    expect(card(r, CARD.s143AccountsQualification).clause).toBe('Section 143(3)(h)');
  });

  it('a clean, fully answered public company is configured with no matters', () => {
    const r = assessOtherReporting(facts(), resolve);
    expect(r.detail.missingFacts.filter((m) => m.blocking)).toEqual([]);
    expect(r.detail.matters).toEqual([]);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.configured);
    expect(r.state).toBe('system_suggested_applicable');
  });

  it('a team "No" on proper books / information raises a modified-reporting exception', () => {
    const r = assessOtherReporting(facts({ booksProper: 'no', informationObtained: 'no' }), resolve);
    expect(card(r, CARD.s143Books).systemReportingStatus).toBe(RS.modifiedExpected);
    expect(card(r, CARD.s143Information).systemExceptions).toHaveLength(1);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.attentionRequired);
  });

  it('director disqualification (Section 164(2)) comes from the Track B director workpaper', () => {
    const r = assessOtherReporting(
      facts({ directors: { total: 3, pending: 0, disqualified: 1, cleared: 2, conclusion: 'identified' } }),
      resolve,
    );
    const g = card(r, CARD.s143Directors);
    expect(g.systemReportingStatus).toBe(RS.modifiedExpected);
    expect(r.detail.matters.find((m) => m.cardKey === CARD.s143Directors)?.severity).toBe('high');
  });

  it('a non-company: Companies Act reporting does not apply to any card', () => {
    const r = assessOtherReporting(facts({ isCompany: false, isPublicCompany: false }), resolve);
    expect(r.detail.cards.every((c) => c.applicability === APPL.notApplicable)).toBe(true);
    expect(r.detail.matters).toEqual([]);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.configured);
  });

  it('an unknown entity type blocks the matrix (Pending facts) — never a guess', () => {
    const r = assessOtherReporting(facts({ isCompany: null, isPublicCompany: null }), resolve);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts.find((m) => m.key === 'entity_type')?.blocking).toBe(true);
  });
});

describe('02.7 §21 — Section 197(16) managerial remuneration', () => {
  it('a public company activates Section 197(16); a private company does not', () => {
    const pub = assessOtherReporting(facts(), resolve);
    expect(pub.detail.remuneration.applicable).toBe(true);
    expect(card(pub, CARD.s197Remuneration).applicability).toBe(APPL.applicable);
    const pvt = assessOtherReporting(facts({ isPublicCompany: false }), resolve);
    expect(pvt.detail.remuneration.applicable).toBe(false);
    expect(pvt.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.notApplicable);
    expect(card(pvt, CARD.s197Remuneration).applicability).toBe(APPL.notApplicable);
  });

  it('an unconfirmed public-company route keeps the card pending (blocking)', () => {
    const r = assessOtherReporting(facts({ isPublicCompany: null }), resolve);
    expect(card(r, CARD.s197Remuneration).applicability).toBe(APPL.pending);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.informationInsufficient);
  });

  it('one MD: tests 11% overall and 5% one-executive on Section 198 net profit, not the other categories', () => {
    const r = assessOtherReporting(facts(), resolve);
    expect(test197(r, 'overall').applicable).toBe(true);
    expect(test197(r, 'overall').permittedAmount).toBe(1.1 * CRORE);
    expect(test197(r, 'one_executive').applicable).toBe(true);
    expect(test197(r, 'one_executive').permittedAmount).toBe(50 * LAKH);
    expect(test197(r, 'multiple_executives').applicable).toBe(false);
    expect(test197(r, 'non_exec_with_mgmt').applicable).toBe(false);
    expect(test197(r, 'non_exec_without_mgmt').applicable).toBe(false);
    expect(r.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.withinLimit);
  });

  it('two executives test the 10% aggregate; non-executives test 1% when an MD exists', () => {
    const r = assessOtherReporting(
      facts({
        managerialPersons: [
          { name: 'MD', category: 'managing_director', remuneration: 40 * LAKH },
          { name: 'WTD', category: 'whole_time_director', remuneration: 40 * LAKH },
          { name: 'ID', category: 'non_executive_director', remuneration: 12 * LAKH },
        ],
      }),
      resolve,
    );
    expect(test197(r, 'one_executive').applicable).toBe(false);
    expect(test197(r, 'multiple_executives').permittedAmount).toBe(1 * CRORE);
    expect(test197(r, 'multiple_executives').within).toBe(true);
    const ne = test197(r, 'non_exec_with_mgmt');
    expect(ne.applicable).toBe(true);
    expect(ne.permittedAmount).toBe(10 * LAKH);
    expect(ne.within).toBe(false);
    expect(test197(r, 'non_exec_without_mgmt').applicable).toBe(false);
    expect(r.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.exceedsLimit);
    expect(card(r, CARD.s197Remuneration).systemReportingStatus).toBe(RS.modifiedExpected);
  });

  it('non-executives with no MD / WTD / Manager test the 3% limit', () => {
    const r = assessOtherReporting(
      facts({
        hasManagingOrWholeTimeDirector: false,
        managerialPersons: [
          { name: 'D1', category: 'non_executive_director', remuneration: 20 * LAKH },
        ],
      }),
      resolve,
    );
    expect(test197(r, 'non_exec_without_mgmt').applicable).toBe(true);
    expect(test197(r, 'non_exec_without_mgmt').permittedAmount).toBe(30 * LAKH);
    expect(test197(r, 'non_exec_with_mgmt').applicable).toBe(false);
  });

  it('exceeding a sub-limit with the special-resolution route recorded is not an exception', () => {
    const over = facts({
      managerialPersons: [{ name: 'MD', category: 'managing_director', remuneration: 80 * LAKH }],
    });
    expect(assessOtherReporting(over, resolve).detail.remuneration.outcome).toBe(
      REMUNERATION_OUTCOME.exceedsLimit,
    );
    const approved = assessOtherReporting(
      { ...over, approvals: { ...over.approvals, executiveSpecialResolution: true } },
      resolve,
    );
    expect(test197(approved, 'one_executive').approvalRoute).toBe(true);
    expect(approved.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.withinLimit);
  });

  it('no Section 198 profit routes to the versioned Schedule V band — not the ordinary %', () => {
    const r = assessOtherReporting(
      facts({ section198NetProfit: -2 * CRORE, effectiveCapital: 40 * CRORE }),
      resolve,
    );
    const sv = r.detail.remuneration.scheduleV;
    expect(r.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.scheduleVRoute);
    expect(sv.triggered).toBe(true);
    expect(sv.band?.label).toBe('Band 2');
    expect(sv.ceiling).toBe(84 * LAKH);
    expect(sv.exceeding).toEqual([]);
  });

  it('inadequate profits (team) also route to Schedule V; a special resolution doubles the ceiling', () => {
    const base = facts({
      inadequateProfits: true,
      effectiveCapital: 3 * CRORE,
      managerialPersons: [{ name: 'MD', category: 'managing_director', remuneration: 90 * LAKH }],
    });
    const r = assessOtherReporting(base, resolve);
    expect(r.detail.remuneration.scheduleV.ceiling).toBe(60 * LAKH);
    expect(r.detail.remuneration.scheduleV.exceeding).toEqual(['MD']);
    expect(card(r, CARD.s197Remuneration).systemReportingStatus).toBe(RS.modifiedExpected);
    const sr = assessOtherReporting(
      { ...base, approvals: { ...base.approvals, scheduleVSpecialResolution: true } },
      resolve,
    );
    expect(sr.detail.remuneration.scheduleV.doubled).toBe(true);
    expect(sr.detail.remuneration.scheduleV.ceiling).toBe(120 * LAKH);
    expect(sr.detail.remuneration.scheduleV.exceeding).toEqual([]);
  });

  it('the top Schedule V band adds the excess % over its lower bound (rule data)', () => {
    const r = assessOtherReporting(
      facts({ section198NetProfit: 0, effectiveCapital: 350 * CRORE }),
      resolve,
    );
    // 120L + 0.01% × (350cr − 250cr) = 120L + 1L
    expect(r.detail.remuneration.scheduleV.ceiling).toBeCloseTo(121 * LAKH, 0);
  });

  it('Schedule V without effective capital or without configured bands is pending, never a guess', () => {
    const noEc = assessOtherReporting(facts({ section198NetProfit: -1 }), resolve);
    expect(noEc.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.informationInsufficient);
    const noBands = assessOtherReporting(
      facts({ section198NetProfit: -1, effectiveCapital: CRORE }),
      makeResolver({ [`${A143}|${C.scheduleVCeiling}`]: null }),
    );
    expect(noBands.detail.remuneration.scheduleV.basis).toMatch(/not configured/);
    expect(noBands.detail.remuneration.outcome).toBe(REMUNERATION_OUTCOME.informationInsufficient);
  });

  it('a future limit change is configuration only (same facts, new %)', () => {
    const over = facts({
      managerialPersons: [{ name: 'MD', category: 'managing_director', remuneration: 60 * LAKH }],
    });
    expect(assessOtherReporting(over, resolve).detail.remuneration.outcome).toBe(
      REMUNERATION_OUTCOME.exceedsLimit,
    );
    const raised = makeResolver({
      [`${A143}|${C.remunerationOneExecutivePercent}`]: { operator: '<=', threshold: 7 },
    });
    expect(assessOtherReporting(over, raised).detail.remuneration.outcome).toBe(
      REMUNERATION_OUTCOME.withinLimit,
    );
  });
});

describe('02.7 §21 — Section 143(12) fraud', () => {
  it('fraud of exactly ₹1 crore takes the Central Government route; ₹99.99 lakh does not', () => {
    const at = assessOtherReporting(facts({ fraudIdentified: true, fraudAmount: CRORE }), resolve);
    expect(at.detail.fraud.route).toBe(FRAUD_ROUTE.centralGovernment);
    expect(at.detail.fraud.formReference).toBe('ADT-4');
    const below = assessOtherReporting(
      facts({ fraudIdentified: true, fraudAmount: 99.99 * LAKH }),
      resolve,
    );
    expect(below.detail.fraud.route).toBe(FRAUD_ROUTE.auditCommitteeBoard);
  });

  it('the Fraud Matter register (Track B) drives the card, with overdue deadlines as exceptions', () => {
    const r = assessOtherReporting(
      facts({
        fraud: {
          ...EMPTY_FRAUD_STATUS,
          matters: 2,
          open: 1,
          centralGovernmentRoute: 1,
          belowThreshold: 1,
          overdue: 1,
          nextDeadline: '2025-01-10',
          thresholdAmount: CRORE,
        },
      }),
      resolve,
    );
    expect(r.detail.fraud.route).toBe(FRAUD_ROUTE.centralGovernment);
    expect(card(r, CARD.s143_12Fraud).systemExceptions).toEqual(['1 Rule 13 deadline(s) overdue']);
    expect(card(r, CARD.s143_12Fraud).workConfigured).toBe('framework_always_available');
  });

  it('every fraud number is shown from the Rules Library', () => {
    const codes = assessOtherReporting(facts(), resolve).detail.rulesUsed.map((u) => [u.code, u.value]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ['FRAUD_CG_THRESHOLD', CRORE],
        ['FRAUD_INITIAL_NOTICE_DAYS', 2],
        ['FRAUD_BOARD_REPLY_DAYS', 45],
        ['FRAUD_CG_FORWARD_DAYS', 15],
      ]),
    );
  });
});

describe('02.7 §21 — Rule 11(g) audit trail', () => {
  const before2023 = makeResolver({ [`${A11}|${C.auditTrailEffective}`]: null });

  it('an FY from 1 April 2023 activates Rule 11(g); an earlier FY resolves under the historical version', () => {
    const now = assessOtherReporting(facts(), resolve);
    expect(now.detail.rule11g.applicable).toBe(true);
    expect(now.detail.rule11g.effectiveFrom).toBe('2023-04-01');
    const old = assessOtherReporting(facts({ auditTrailInForce: false }), before2023);
    expect(old.detail.rule11g.applicable).toBe(false);
    expect(card(old, CARD.r11gAuditTrail).applicability).toBe(APPL.notApplicable);
  });

  it('assesses each software / module separately with a suggested conclusion', () => {
    const r = assessOtherReporting(
      facts({
        softwareSystems: [
          COMPLIANT_SYSTEM,
          { ...COMPLIANT_SYSTEM, id: 'sys-b', name: 'Payroll', module: 'payroll', tampering: 'yes' },
          { ...COMPLIANT_SYSTEM, id: 'sys-c', name: 'Billing', preservation: 'pending' },
        ],
      }),
      resolve,
    );
    const by = Object.fromEntries(r.detail.rule11g.systems.map((s) => [s.name, s.conclusion]));
    expect(by).toEqual({
      'Tally Prime': AUDIT_TRAIL_CONCLUSION.compliant,
      Payroll: AUDIT_TRAIL_CONCLUSION.modifiedExpected,
      Billing: AUDIT_TRAIL_CONCLUSION.furtherWork,
    });
    expect(card(r, CARD.r11gAuditTrail).systemReportingStatus).toBe(RS.modifiedExpected);
  });

  it('the preservation period is rule data (8 years today, configurable)', () => {
    expect(assessOtherReporting(facts(), resolve).detail.rule11g.retentionYears).toBe(8);
    const ten = makeResolver({ [`${A11}|${C.retentionYears}`]: { operator: '>=', threshold: 10 } });
    expect(assessOtherReporting(facts(), ten).detail.rule11g.retentionYears).toBe(10);
  });

  it('an audit-trail exception cross-links proper books but never copies its conclusion', () => {
    const r = assessOtherReporting(
      facts({
        booksProper: 'yes',
        softwareSystems: [{ ...COMPLIANT_SYSTEM, enabledThroughout: 'no', booksCrossRef: true }],
      }),
      resolve,
    );
    const books = card(r, CARD.s143Books);
    expect(books.applicabilityBasis).toMatch(/audit-trail exception/);
    expect(books.systemReportingStatus).toBe(RS.unmodifiedExpected);
    expect(books.systemExceptions).toEqual([]);
  });

  it('a register with no systems is pending; legacy two-boolean rows still read', () => {
    expect(card(assessOtherReporting(facts({ softwareSystems: [] }), resolve), CARD.r11gAuditTrail).applicability).toBe(
      APPL.pending,
    );
    const legacy = assessOtherReporting(
      facts({
        softwareSystems: [{ name: 'Old', hasAuditTrailFeature: true, auditTrailOperatedAllYear: true }],
      }),
      resolve,
    );
    expect(legacy.detail.rule11g.systems[0]!.adequate).toBe(true);
  });
});

describe('02.7 §21 — Rule 11(a)–(f)', () => {
  it('Rule 11(e) has no monetary exemption — any transaction needs both representations', () => {
    const r = assessOtherReporting(
      facts({
        rule11eAdvanced: {
          ...EMPTY_OTHER_REPORTING_CAPTURED.rule11eAdvanced,
          transactionsIdentified: 'yes',
          representationObtained: 'no',
          parties: 'one ₹1 transfer',
        },
      }),
      resolve,
    );
    expect(card(r, CARD.r11eAdvanced).systemExceptions[0]).toMatch(/representation not obtained/);
    expect(card(r, CARD.r11eAdvanced).applicabilityBasis).toMatch(/No monetary exemption/);
    expect(r.detail.rule11ef.satisfied).toBe(false);
  });

  it('no long-term contracts / no dividend / nothing to transfer → Not Applicable to Facts', () => {
    const r = assessOtherReporting(facts(), resolve);
    expect(card(r, CARD.r11Losses).applicability).toBe(APPL.notApplicableToFacts);
    expect(card(r, CARD.r11fDividend).applicability).toBe(APPL.notApplicableToFacts);
    expect(card(r, CARD.r11Iepf).applicability).toBe(APPL.notApplicableToFacts);
  });

  it('unanswered Rule 11 routes are blocking pending facts', () => {
    const r = assessOtherReporting(facts({ dividend: { ...EMPTY_OTHER_REPORTING_CAPTURED.dividend } }), resolve);
    expect(card(r, CARD.r11fDividend).applicability).toBe(APPL.pending);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.informationInsufficient);
  });

  it('an IEPF delay and a non-compliant dividend are exceptions', () => {
    const r = assessOtherReporting(
      facts({
        iepf: { status: 'delay', delayAmount: 2 * LAKH, delayPeriod: '40 days', sourceWorkpaper: null },
        dividend: {
          declaredOrPaid: true,
          kind: 'final',
          section123Compliant: 'no',
          note: null,
          sourceWorkpaper: null,
        },
      }),
      resolve,
    );
    expect(card(r, CARD.r11Iepf).systemReportingStatus).toBe(RS.modifiedExpected);
    expect(card(r, CARD.r11fDividend).systemReportingStatus).toBe(RS.modifiedExpected);
  });

  it('older rows with only the legacy booleans are normalised into the structured facts', () => {
    const n = normaliseCaptured({
      pendingLitigationDisclosed: false,
      iepfTransferDelay: true,
      dividendCompliesSec123: true,
      intermediaryFundsAdvanced: true,
      fundingRepresentationsObtained: true,
    });
    expect(n.litigation.disclosure).toBe('not_disclosed');
    expect(n.iepf.status).toBe('delay');
    expect(n.dividend.declaredOrPaid).toBe(true);
    expect(n.rule11eAdvanced.transactionsIdentified).toBe('yes');
    expect(n.rule11eAdvanced.representationObtained).toBe('yes');
  });
});

describe('02.7 §21 — cross-references consume 02.4 / 02.5 / 02.6 (no second register)', () => {
  it('branch reporting consumes 02.6; CARO and ICFR consume 02.4 / 02.5', () => {
    const r = assessOtherReporting(
      facts({
        crossRefs: {
          caro: { applicable: false, conclusion: 'not_applicable', complete: true, reportableClauses: 0 },
          icfr: { reportingRequired: true, conclusion: 'applicable', complete: false, deficiencies: 1 },
          group: {
            cfsConclusion: null,
            branchesExist: true,
            branchAuditors: 2,
            branchReportsDealt: 1,
            branchReportsPending: 1,
            branchReturnsReceived: true,
          },
        },
      }),
      resolve,
    );
    expect(card(r, CARD.caro).applicability).toBe(APPL.notApplicable);
    expect(card(r, CARD.s143Icfr).applicability).toBe(APPL.crossReference);
    expect(card(r, CARD.s143Icfr).workConfigured).toBe('cross_reference');
    expect(card(r, CARD.s143BranchReport).applicability).toBe(APPL.applicable);
    expect(card(r, CARD.branchReporting).applicabilityBasis).toMatch(/1 report\(s\) dealt with, 1 pending/);
  });

  it('unanswered 02.6 branch facts show as pending but do not block 02.7', () => {
    const r = assessOtherReporting(facts(), resolve);
    expect(card(r, CARD.s143BranchReturns).applicability).toBe(APPL.pending);
    expect(r.detail.missingFacts.find((m) => m.key === CARD.s143BranchReturns)?.blocking).toBe(false);
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.configured);
  });
});

describe('02.7 — Rules Library and overrides', () => {
  it('a missing Rules Library value is a blocking pending fact', () => {
    const r = assessOtherReporting(
      facts(),
      makeResolver({ [`${A143}|${C.remunerationOneExecutivePercent}`]: null }),
    );
    expect(r.outcome).toBe(OTHER_REPORTING_OUTCOME.informationInsufficient);
    expect(r.detail.missingFacts.some((m) => m.key === 'rule_REM_ONE_MDWTD_MANAGER')).toBe(true);
  });

  it('a team override removing an applicable obligation is recorded and needs the EP', () => {
    const r = assessOtherReporting(
      facts({
        applicabilityOverrides: {
          [CARD.s197Remuneration]: { applicability: APPL.notApplicable, reason: 'Deemed private' },
        },
      }),
      resolve,
    );
    const c = card(r, CARD.s197Remuneration);
    expect(c.applicability).toBe(APPL.notApplicable);
    expect(c.applicabilityBasis).toMatch(/^Team override: Deemed private/);
    expect(r.detail.removedObligations).toEqual([c.requirement]);
    expect(
      otherReportingPartnerApprovalReason({
        conclusion: 'configured',
        isOverridden: false,
        detail: r.detail,
      }),
    ).toMatch(/removes statutory obligation/);
  });

  it('an override that resolves a pending card is not significant', () => {
    const r = assessOtherReporting(
      facts({
        isPublicCompany: null,
        applicabilityOverrides: {
          [CARD.s197Remuneration]: { applicability: APPL.applicable, reason: 'Deemed public' },
        },
      }),
      resolve,
    );
    expect(r.detail.removedObligations).toEqual([]);
    expect(r.detail.missingFacts.find((m) => m.key === CARD.s197Remuneration)).toBeUndefined();
  });
});

describe('02.7 §20 completion, fingerprint and the Section 02 mirror', () => {
  const base = () => {
    const r = assessOtherReporting(
      facts({
        crossRefs: {
          ...EMPTY_CROSS_REFS,
          caro: { applicable: true, conclusion: 'applicable', complete: true, reportableClauses: 2 },
          icfr: { reportingRequired: true, conclusion: 'applicable', complete: true, deficiencies: 0 },
        },
      }),
      resolve,
    );
    return {
      detail: r.detail,
      decided: true,
      professionalAction: 'confirm' as const,
      partnerRequired: false,
      partnerApproved: false,
      needsReevaluation: false,
      isCompany: true,
      started: true,
      fraud: EMPTY_FRAUD_STATUS,
      directors: { ...EMPTY_DIRECTOR_STATUS, total: 3, cleared: 3, conclusion: 'none_found' as const },
      crossRefs: {
        ...EMPTY_CROSS_REFS,
        caro: { applicable: true, conclusion: 'applicable', complete: true, reportableClauses: 2 },
        icfr: { reportingRequired: true, conclusion: 'applicable', complete: true, deficiencies: 0 },
      },
    };
  };

  it('02.7 is COMPLETE while every card is still Work Pending (obligations identified, not concluded)', () => {
    const d = base();
    expect(d.detail.cards.every((c) => c.state.workStatus === 'not_started')).toBe(true);
    const c = otherReportingCompletion(d);
    expect(c.items.filter((i) => i.met === false)).toEqual([]);
    expect(c.complete).toBe(true);
  });

  it('an unapproved significant override, a pending director workpaper or no conclusion keeps it open', () => {
    expect(otherReportingCompletion({ ...base(), partnerRequired: true }).complete).toBe(false);
    expect(
      otherReportingCompletion({
        ...base(),
        directors: { ...EMPTY_DIRECTOR_STATUS, total: 2, pending: 2, conclusion: 'pending' },
      }).complete,
    ).toBe(false);
    const undecided = otherReportingCompletion({ ...base(), decided: false });
    expect(undecided.complete).toBe(false);
    expect(undecided.status).toBe('in_progress');
  });

  it('the fingerprint moves on applicability changes, not on card exceptions', () => {
    const a = assessOtherReporting(facts(), resolve);
    const exception = assessOtherReporting(facts({ booksProper: 'no' }), resolve);
    const route = assessOtherReporting(facts({ isPublicCompany: false }), resolve);
    expect(otherReportingFingerprint('configured', a.detail)).toBe(
      otherReportingFingerprint('configured', exception.detail),
    );
    expect(otherReportingFingerprint('configured', a.detail)).not.toBe(
      otherReportingFingerprint('configured', route.detail),
    );
  });

  it('mirrors the Section 02 rule_11 / section_143 applicability', () => {
    expect(otherReportingLegacyMirror(true, false, false)).toEqual({
      suggestion: 'applicable',
      conclusion: null,
      state: 'system_suggested_applicable',
    });
    expect(otherReportingLegacyMirror(true, true, false).conclusion).toBe('applicable');
    expect(otherReportingLegacyMirror(false, true, false).conclusion).toBe('not_applicable');
    expect(otherReportingLegacyMirror(null, false, false).state).toBe(
      'professional_judgement_required',
    );
  });
});
