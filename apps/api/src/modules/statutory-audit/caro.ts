import {
  CARO_ANSWER,
  CARO_CONDITION,
  CARO_CONDITION_RESULT,
  CARO_CONTEXT_STATUS,
  CARO_DIRECT_TEST,
  CARO_ENTITY_ROUTE,
  CARO_OUTCOME,
  CARO_PROVISION_CODE,
  CARO_REPORT_CONTEXT,
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  formatInrCrore,
  ruleMeets,
  type CaroAnswer,
  type CaroCondition,
  type CaroConditionKey,
  type CaroConclusionSummary,
  type CaroDetail,
  type CaroDirectTest,
  type CaroEntityRoute,
  type CaroFactUsed,
  type CaroFacts,
  type CaroMissingFact,
  type CaroOutcome,
  type CaroPrivateTest,
  type CaroReportContextResult,
  type CaroResult,
  type FrameworkState,
  type ResolvedRule,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.4 CARO 2020 Applicability — pure engine (Implementation Guide §9.4; DHVAJ
 * 02.4 spec §3–§10).
 *
 * Decides Level 1 (does CARO apply to the report): the direct exemptions
 * CARO-01..05 first (banking / insurance / §8 / OPC / small company — consumed
 * from 02.1, never recomputed), then the cumulative private-company test (not a
 * holding/subsidiary of a public company AND capital + reserves, aggregate bank/FI
 * borrowings at any point in the year, and total revenue each within the CARO
 * limits). Every condition is evaluated and shown — one failure fails the route.
 * A public company that is not otherwise exempt → CARO applies.
 *
 * NO statutory number lives here (guide §1): all four tests resolve from the
 * Audit Rules Library through the injected {@link RuleResolver}; the detail
 * carries the ACTUAL limits, measurement bases and rule versions used. CARO 2020
 * is effective FY 2021-22 onward, so a period with no resolved rule returns
 * Further Assessment — it never guesses. Missing data returns Information
 * Pending rather than a year-end shortcut (spec §7).
 *
 * Mirrors financial-reporting.ts so it unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.caro;
const P = CARO_PROVISION_CODE;

const MEASUREMENT_LABEL: Record<string, string> = {
  balance_sheet_date: 'as on the balance sheet date',
  at_any_point_in_year: 'in aggregate at any point during the financial year',
  caro_measurement_basis: 'during the financial year on the CARO measurement basis',
  relevant_period: 'for the relevant period',
};

const OPERATOR_LABEL: Record<string, string> = {
  '<=': 'not more than',
  '<': 'less than',
  '>=': 'at least',
  '>': 'more than',
  '==': 'equal to',
};

const DIRECT_LABEL: Record<string, string> = {
  [CARO_DIRECT_TEST.banking]: 'Banking company',
  [CARO_DIRECT_TEST.insurance]: 'Insurance company',
  [CARO_DIRECT_TEST.section8]: 'Section 8 company',
  [CARO_DIRECT_TEST.opc]: 'One Person Company',
  [CARO_DIRECT_TEST.smallCompany]: 'Small company (§2(85))',
};

const CONDITION_LABEL: Record<CaroConditionKey, string> = {
  public_group: 'Public-company group relationship',
  capital_reserves: 'Paid-up capital + reserves & surplus',
  borrowings: 'Bank / FI borrowings',
  revenue: 'Total revenue',
};

function answerOf(v: boolean | null | undefined): CaroAnswer {
  return v === true ? CARO_ANSWER.yes : v === false ? CARO_ANSWER.no : CARO_ANSWER.pending;
}

const inr = (v: number | null | undefined) => (v == null ? null : formatInrCrore(v));

// ── CARO-01..05 ──────────────────────────────────────────────────────────────

function directTests(f: CaroFacts): CaroDirectTest[] {
  const src = f.profileAvailable === false ? null : '02.1';
  const profileNote = (yes: string, no: string, v: boolean | null) =>
    v === true
      ? yes
      : v === false
        ? no
        : '02.1 has not classified the entity yet — confirm the Entity & Regulatory Profile.';

  const smallAnswer: CaroAnswer =
    f.isPrivateCompany === false ? CARO_ANSWER.no : answerOf(f.isSmallCompany);
  const smallBasis =
    f.isPrivateCompany === false
      ? 'A public company cannot be a small company under §2(85).'
      : f.isSmallCompany === true
        ? `02.1 small-company conclusion: small company${f.smallCompanyBasis ? ` (${f.smallCompanyBasis})` : ''}.`
        : f.isSmallCompany === false
          ? `02.1 small-company conclusion: not a small company${f.smallCompanyBasis ? ` (${f.smallCompanyBasis})` : ''}.`
          : 'The 02.1 small-company assessment has no result yet — 02.4 uses the 02.1 result, never its own calculation.';

  const tests: CaroDirectTest[] = [
    {
      code: 'CARO-01',
      key: CARO_DIRECT_TEST.banking,
      question: 'Is the entity a banking company within the applicable CARO exemption?',
      answer: answerOf(f.isBanking),
      basis: profileNote(
        '02.1 special entity types include Banking company.',
        '02.1 does not classify the entity as a banking company.',
        f.isBanking,
      ),
      sourceSection: src,
      provisionCodes: [P.paragraph1],
      decisive: false,
    },
    {
      code: 'CARO-02',
      key: CARO_DIRECT_TEST.insurance,
      question: 'Is the entity an insurance company within the applicable CARO exemption?',
      answer: answerOf(f.isInsurance),
      basis: profileNote(
        '02.1 special entity types include Insurance company.',
        '02.1 does not classify the entity as an insurance company.',
        f.isInsurance,
      ),
      sourceSection: src,
      provisionCodes: [P.paragraph1],
      decisive: false,
    },
    {
      code: 'CARO-03',
      key: CARO_DIRECT_TEST.section8,
      question:
        'Is the entity a company licensed to operate under section 8 of the Companies Act, 2013?',
      answer: answerOf(f.isSection8),
      basis: profileNote(
        '02.1 classifies the entity as a Section 8 company.',
        '02.1 does not classify the entity as a Section 8 company.',
        f.isSection8,
      ),
      sourceSection: src,
      provisionCodes: [P.paragraph1, P.section8],
      decisive: false,
    },
    {
      code: 'CARO-04',
      key: CARO_DIRECT_TEST.opc,
      question: 'Is the entity a One Person Company?',
      answer: answerOf(f.isOpc),
      basis: profileNote(
        '02.1 entity type: One Person Company.',
        '02.1 entity type is not a One Person Company.',
        f.isOpc,
      ),
      sourceSection: src,
      provisionCodes: [P.paragraph1, P.section2_62],
      decisive: false,
    },
    {
      code: 'CARO-05',
      key: CARO_DIRECT_TEST.smallCompany,
      question: 'Is the entity a small company under section 2(85) for the relevant period?',
      answer: smallAnswer,
      basis: smallBasis,
      sourceSection: src,
      provisionCodes: [P.paragraph1, P.section2_85],
      decisive: false,
    },
  ];
  const first = tests.find((t) => t.answer === CARO_ANSWER.yes);
  if (first) first.decisive = true;
  return tests;
}

// ── Cumulative private-company conditions (§6, §7) ───────────────────────────

function requirementOf(rule: ResolvedRule, key: CaroConditionKey): string {
  const basis = MEASUREMENT_LABEL[rule.measurementBasis ?? ''] ?? '';
  if (key === CARO_CONDITION.publicGroup)
    return `Not a subsidiary or holding company of a public company${basis ? ` ${basis}` : ''}`;
  const op = OPERATOR_LABEL[rule.operator] ?? rule.operator;
  return `${op} ${rule.threshold != null ? formatInrCrore(rule.threshold) : '—'}${basis ? ` ${basis}` : ''}`;
}

function condition(
  key: CaroConditionKey,
  rule: ResolvedRule,
  actual: number | null,
  calculation: string | null,
  pendingReason: string | null,
): CaroCondition {
  const result =
    actual == null
      ? CARO_CONDITION_RESULT.pending
      : ruleMeets(actual, rule)
        ? CARO_CONDITION_RESULT.satisfied
        : CARO_CONDITION_RESULT.failed;
  const isGroup = key === CARO_CONDITION.publicGroup;
  return {
    key,
    label: CONDITION_LABEL[key],
    requirement: requirementOf(rule, key),
    result,
    ruleCode: rule.ruleCode,
    ruleVersionId: rule.ruleVersionId,
    ruleVersion: rule.version,
    ruleEffectiveFrom: rule.effectiveFrom,
    operator: rule.operator,
    threshold: rule.threshold,
    unit: rule.unit,
    measurementBasis: rule.measurementBasis,
    actual,
    actualDisplay: isGroup
      ? actual == null
        ? null
        : actual > 0
          ? 'Holding / subsidiary of a public company'
          : 'No public-company relationship'
      : inr(actual),
    limitDisplay: isGroup ? 'No public-company relationship' : inr(rule.threshold),
    calculation,
    pendingReason: result === CARO_CONDITION_RESULT.pending ? pendingReason : null,
    authorityProvisionId: rule.authorityProvisionId,
    guidanceReference: rule.guidanceReference,
  };
}

/** Aggregate the bank/FI balance schedule by date and take the peak (spec §7). */
export function aggregateBorrowingPeak(
  schedule: NonNullable<CaroFacts['borrowingSchedule']>,
): { peak: number; on: string; dates: number; lenders: number } | null {
  if (schedule.length === 0) return null;
  const byDate = new Map<string, number>();
  for (const p of schedule) byDate.set(p.asOn, (byDate.get(p.asOn) ?? 0) + p.amount);
  let on = '';
  let peak = -Infinity;
  for (const [d, total] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (total > peak) {
      peak = total;
      on = d;
    }
  }
  return { peak, on, dates: byDate.size, lenders: new Set(schedule.map((p) => p.lender)).size };
}

function privateConditions(
  f: CaroFacts,
  rules: Record<CaroConditionKey, ResolvedRule>,
): CaroCondition[] {
  // Public-group relationship — relationship status for the relevant period.
  const group =
    f.isHoldingOrSubsidiaryOfPublic == null ? null : f.isHoldingOrSubsidiaryOfPublic ? 1 : 0;
  const groupCalc =
    f.isHoldingOrSubsidiaryOfPublic == null
      ? null
      : f.publicGroupCounterparties?.length
        ? `Related public companies: ${f.publicGroupCounterparties.join(', ')}.`
        : f.isHoldingOrSubsidiaryOfPublic
          ? 'Recorded as a holding / subsidiary of a public company.'
          : 'No public company in the group for the period.';

  // Paid-up capital + reserves & surplus — components preserved when captured.
  let capital: number | null = null;
  let capitalCalc: string | null = null;
  if (f.paidUpCapital != null && f.reservesAndSurplus != null) {
    capital = f.paidUpCapital + f.reservesAndSurplus;
    capitalCalc = `Paid-up capital ${formatInrCrore(f.paidUpCapital)} + reserves & surplus ${formatInrCrore(f.reservesAndSurplus)} = ${formatInrCrore(capital)}.`;
  } else if (f.capitalPlusReserves != null) {
    capital = f.capitalPlusReserves;
    capitalCalc = `Paid-up capital + reserves & surplus as captured: ${formatInrCrore(capital)} (components not split).`;
  }

  // Borrowings — aggregate across banks/FIs, peak at any point in the year.
  let borrow: number | null = null;
  let borrowCalc: string | null = null;
  let borrowPending =
    'Aggregate bank / FI borrowings at any point in the year are not captured — enter the balance schedule or the aggregate peak.';
  const agg = f.borrowingSchedule?.length ? aggregateBorrowingPeak(f.borrowingSchedule) : null;
  const yearEndOnly = f.borrowingDataBasis === 'year_end_only';
  if (agg) {
    borrow = agg.peak;
    borrowCalc = `Aggregate of ${agg.lenders} lender(s) across ${agg.dates} balance date(s); peak ${formatInrCrore(agg.peak)} on ${agg.on}.`;
  } else if (f.peakBankFiBorrowings != null) {
    borrow = f.peakBankFiBorrowings;
    borrowCalc = `Aggregate peak as captured: ${formatInrCrore(borrow)}${f.borrowingDataBasis ? ` (${f.borrowingDataBasis.replace(/_/g, ' ')} data)` : ''}.`;
  }
  if (borrow != null && yearEndOnly && ruleMeets(borrow, rules.borrowings)) {
    // Within the limit on year-end data alone proves nothing for "any point" (spec §7);
    // a year-end figure above the limit already fails it.
    borrowPending =
      'Only year-end balances are available — the "at any point during the year" test needs balances through the year.';
    borrow = null;
  }

  // Total revenue — CARO basis, incl. discontinuing operations.
  let revenue: number | null = null;
  let revenueCalc: string | null = null;
  if (f.revenueFromOperations != null) {
    revenue =
      f.revenueFromOperations + (f.otherIncome ?? 0) + (f.discontinuedOperationsRevenue ?? 0);
    revenueCalc =
      `Revenue from operations ${formatInrCrore(f.revenueFromOperations)}` +
      ` + other income ${formatInrCrore(f.otherIncome ?? 0)}` +
      ` + discontinuing operations ${formatInrCrore(f.discontinuedOperationsRevenue ?? 0)}` +
      ` = ${formatInrCrore(revenue)}.`;
  } else if (f.totalRevenue != null) {
    revenue = f.totalRevenue;
    revenueCalc = `Total revenue as captured: ${formatInrCrore(revenue)} (CARO basis).`;
  }

  return [
    condition(
      CARO_CONDITION.publicGroup,
      rules.public_group,
      group,
      groupCalc,
      'Holding / subsidiary relationship with a public company not confirmed — check the 02.1 group structure.',
    ),
    condition(
      CARO_CONDITION.capitalReserves,
      rules.capital_reserves,
      capital,
      capitalCalc,
      'Paid-up capital and reserves & surplus at the balance-sheet date are not captured.',
    ),
    condition(CARO_CONDITION.borrowings, rules.borrowings, borrow, borrowCalc, borrowPending),
    condition(
      CARO_CONDITION.revenue,
      rules.revenue,
      revenue,
      revenueCalc,
      'Total revenue for the year (incl. discontinuing operations) is not captured.',
    ),
  ];
}

// ── Facts Used (§2, §4) ──────────────────────────────────────────────────────

function yn(v: boolean | null | undefined): string {
  return v === true ? 'Yes' : v === false ? 'No' : 'Not known';
}

function factsUsed(f: CaroFacts): CaroFactUsed[] {
  const out: CaroFactUsed[] = [
    {
      key: 'company_type',
      label: 'Company type / private-public status',
      value:
        f.isCompany === false
          ? 'Not a company'
          : f.isPrivateCompany === true
            ? f.isOpc
              ? 'One Person Company'
              : 'Private company'
            : f.isPrivateCompany === false
              ? 'Public company'
              : 'Not known',
      source: '02.1 Entity & Regulatory Profile',
      sourceSection: '02.1',
    },
    {
      key: 'banking',
      label: 'Banking company',
      value: yn(f.isBanking),
      source: '02.1',
      sourceSection: '02.1',
    },
    {
      key: 'insurance',
      label: 'Insurance company',
      value: yn(f.isInsurance),
      source: '02.1',
      sourceSection: '02.1',
    },
    {
      key: 'section_8',
      label: 'Section 8 company',
      value: yn(f.isSection8),
      source: '02.1',
      sourceSection: '02.1',
    },
    {
      key: 'opc',
      label: 'One Person Company',
      value: yn(f.isOpc),
      source: '02.1',
      sourceSection: '02.1',
    },
    {
      key: 'small_company',
      label: 'Small company (approved 02.1 result)',
      value: yn(f.isSmallCompany),
      source: '02.1 Small Company Assessment',
      sourceSection: '02.1',
    },
    {
      key: 'public_group',
      label: 'Holding / subsidiary of a public company',
      value: yn(f.isHoldingOrSubsidiaryOfPublic),
      source: '02.1 group structure / client master',
      sourceSection: '02.1',
    },
  ];
  const money = (key: string, label: string, v: number | null | undefined, source: string) => {
    if (v != null)
      out.push({ key, label, value: formatInrCrore(v), source, sourceSection: '02.4' });
  };
  money('paid_up_capital', 'Paid-up capital', f.paidUpCapital, 'Financial data (02.4)');
  money(
    'reserves_and_surplus',
    'Reserves & surplus',
    f.reservesAndSurplus,
    'Financial data (02.4)',
  );
  if (f.paidUpCapital == null || f.reservesAndSurplus == null)
    money(
      'capital_plus_reserves',
      'Paid-up capital + reserves & surplus',
      f.capitalPlusReserves,
      'Financial data / client master',
    );
  const agg = f.borrowingSchedule?.length ? aggregateBorrowingPeak(f.borrowingSchedule) : null;
  money(
    'peak_borrowings',
    'Peak aggregate bank / FI borrowings',
    agg?.peak ?? f.peakBankFiBorrowings,
    agg ? 'Bank / FI balance schedule (02.4)' : 'Ledger / financial data (02.4)',
  );
  money(
    'revenue_from_operations',
    'Revenue from operations',
    f.revenueFromOperations,
    'Financial statements',
  );
  money('other_income', 'Other income', f.otherIncome, 'Financial statements');
  money(
    'discontinued_revenue',
    'Revenue from discontinuing operations',
    f.discontinuedOperationsRevenue,
    'Financial statements',
  );
  if (f.revenueFromOperations == null)
    money('total_revenue', 'Total revenue', f.totalRevenue, 'Financial statements / client master');
  out.push({
    key: 'cfs_in_scope',
    label: 'Consolidated financial statements in scope',
    value: f.cfsInScope == null ? 'Pending 02.6' : yn(f.cfsInScope),
    source: '02.6 Consolidation / Group Audit',
    sourceSection: '02.6',
  });
  return out;
}

// ── Report contexts (§10) ────────────────────────────────────────────────────

function reportContexts(outcome: CaroOutcome, f: CaroFacts): CaroReportContextResult[] {
  const sfs: CaroReportContextResult =
    outcome === CARO_OUTCOME.applicable
      ? {
          context: CARO_REPORT_CONTEXT.standalone,
          status: CARO_CONTEXT_STATUS.applicable,
          applies: true,
          scope: 'paragraph_3',
          basis: 'CARO applies — instantiate the paragraph 3 clause work programme.',
        }
      : outcome === CARO_OUTCOME.notApplicableExempt
        ? {
            context: CARO_REPORT_CONTEXT.standalone,
            status: CARO_CONTEXT_STATUS.notApplicable,
            applies: false,
            scope: null,
            basis: 'Exempt — no CARO report on the standalone financial statements.',
          }
        : {
            context: CARO_REPORT_CONTEXT.standalone,
            status: CARO_CONTEXT_STATUS.pending,
            applies: null,
            scope: null,
            basis: 'Standalone CARO applicability not yet determined.',
          };

  let cfs: CaroReportContextResult;
  if (f.cfsInScope === false)
    cfs = {
      context: CARO_REPORT_CONTEXT.consolidated,
      status: CARO_CONTEXT_STATUS.notApplicable,
      applies: false,
      scope: null,
      basis: f.cfsBasis ?? 'No consolidated financial statements in scope (02.6).',
    };
  else if (f.cfsInScope == null)
    cfs = {
      context: CARO_REPORT_CONTEXT.consolidated,
      status: CARO_CONTEXT_STATUS.pending,
      applies: null,
      scope: null,
      basis:
        '02.6 has not concluded on consolidated financial statements — the CFS CARO component stays Pending; standalone applicability is concluded independently.',
    };
  else if (sfs.status === CARO_CONTEXT_STATUS.applicable)
    cfs = {
      context: CARO_REPORT_CONTEXT.consolidated,
      status: CARO_CONTEXT_STATUS.applicable,
      applies: true,
      scope: 'clause_3_xxi',
      basis:
        'Consolidated FS: report only under clause 3(xxi) (qualifications / adverse remarks in the CARO reports of companies included in the CFS) — do not replicate the paragraph 3 programme.',
    };
  else if (sfs.status === CARO_CONTEXT_STATUS.notApplicable)
    cfs = {
      context: CARO_REPORT_CONTEXT.consolidated,
      status: CARO_CONTEXT_STATUS.notApplicable,
      applies: false,
      scope: null,
      basis:
        'The company is exempt under paragraph 1 of the Order, so clause 3(xxi) reporting on the CFS does not arise.',
    };
  else
    cfs = {
      context: CARO_REPORT_CONTEXT.consolidated,
      status: CARO_CONTEXT_STATUS.pending,
      applies: null,
      scope: null,
      basis: 'Pending the standalone CARO applicability conclusion.',
    };
  return [sfs, cfs];
}

// ── The decision sequence ────────────────────────────────────────────────────

const STATE: Record<CaroOutcome, FrameworkState> = {
  applicable: 'system_suggested_applicable',
  not_applicable_exempt: 'system_suggested_not_applicable',
  further_assessment: 'professional_judgement_required',
  information_insufficient: 'pending_information',
};

interface Partial02 {
  outcome: CaroOutcome;
  basis: string;
  route: CaroEntityRoute;
  directExemption?: string | null;
  privateTest?: CaroPrivateTest | null;
  missing?: CaroMissingFact[];
  ruleVersionId?: string | null;
}

/**
 * The 02.4 decision sequence (spec §5–§8). Order matters: the Order version
 * gates first; then company status; then the direct exemptions (no threshold
 * test once one is established); then the cumulative private-company test; a
 * public company that is not otherwise exempt → applies.
 */
export function assessCaro(f: CaroFacts, resolve: RuleResolver): CaroResult {
  const rules = {
    public_group: resolve(AREA, RULE_CRITERION.publicGroupRelationship),
    capital_reserves: resolve(AREA, RULE_CRITERION.capitalAndReserves),
    borrowings: resolve(AREA, RULE_CRITERION.borrowings),
    revenue: resolve(AREA, RULE_CRITERION.revenue),
  };
  const used = factsUsed(f);
  const tests = directTests(f);
  const provisionCodes = new Set<string>([P.order, P.paragraph1, P.guidanceNote, P.section143_11]);

  const finish = (r: Partial02): CaroResult => {
    const privateTest = r.privateTest ?? null;
    const failed = (privateTest?.conditions ?? []).filter(
      (c) => c.result === CARO_CONDITION_RESULT.failed,
    );
    const conclusion: CaroConclusionSummary = {
      result: r.outcome,
      entityRoute: r.route,
      directExemption: r.directExemption ?? null,
      privateExemption: !privateTest?.tested
        ? 'not_required'
        : privateTest.qualified === true
          ? 'qualified'
          : privateTest.qualified === false
            ? 'not_qualified'
            : 'pending',
      failedConditions: failed.map((c) => c.key),
      failedCondition: failed[0]?.label ?? null,
      actualValue: failed[0]?.actualDisplay ?? null,
      configuredLimit: failed[0]?.limitDisplay ?? null,
      orderVersion: rules.revenue ? `CARO 2020 (effective ${rules.revenue.effectiveFrom})` : null,
    };
    for (const t of tests)
      if (t.answer !== CARO_ANSWER.no) t.provisionCodes.forEach((c) => provisionCodes.add(c));
    const level1Applies = r.outcome === CARO_OUTCOME.applicable;
    const detail: CaroDetail = {
      level1Applies,
      exemptionReason: r.outcome === CARO_OUTCOME.notApplicableExempt ? r.basis : null,
      orderVersion: rules.revenue
        ? { code: P.order, effectiveFrom: rules.revenue.effectiveFrom }
        : null,
      directTests: tests,
      privateTest,
      conclusion,
      factsUsed: used,
      missingFacts: r.missing ?? [],
      reportContexts: reportContexts(r.outcome, f),
      instantiatesClauseProgramme: level1Applies,
      caroScope: level1Applies ? 'standalone_paragraph_3' : null,
      provisionCodes: [...provisionCodes],
    };
    return {
      outcome: r.outcome,
      state: STATE[r.outcome],
      basis: r.basis,
      ruleVersionId: r.ruleVersionId ?? null,
      authorityProvisionId: null,
      detail,
    };
  };

  // 1. CARO 2020 effective FY 2021-22+ — no rule for the period ⇒ Further Assessment.
  if (!rules.public_group || !rules.capital_reserves || !rules.borrowings || !rules.revenue)
    return finish({
      outcome: CARO_OUTCOME.furtherAssessment,
      route: CARO_ENTITY_ROUTE.undetermined,
      basis:
        'No CARO 2020 rule version is in force for this audit period (CARO 2020 applies to financial years commencing on or after 01-Apr-2021) — assess the applicable Order separately.',
    });

  // 2. Must be a company.
  if (f.isCompany === false)
    return finish({
      outcome: CARO_OUTCOME.notApplicableExempt,
      route: CARO_ENTITY_ROUTE.nonCompany,
      basis: 'CARO applies only to companies under the Companies Act, 2013 — not applicable here.',
    });
  if (f.isCompany == null)
    return finish({
      outcome: CARO_OUTCOME.informationInsufficient,
      route: CARO_ENTITY_ROUTE.undetermined,
      basis: 'Entity type not confirmed — confirm 02.1 before assessing CARO applicability.',
      missing: [{ key: 'company_type', label: 'Entity type', source: '02.1' }],
    });

  // 3. Direct exemptions CARO-01..05 — no threshold test once one is established.
  const decisive = tests.find((t) => t.decisive);
  if (decisive) {
    const label = DIRECT_LABEL[decisive.key]!;
    return finish({
      outcome: CARO_OUTCOME.notApplicableExempt,
      route: CARO_ENTITY_ROUTE.directExemption,
      directExemption: label,
      basis: `${label} — directly exempt from CARO 2020 under paragraph 1 (${decisive.code}); private-company limits not tested.`,
    });
  }
  const pendingDirect = tests.filter((t) => t.answer === CARO_ANSWER.pending);
  const pendingDirectMissing: CaroMissingFact[] = pendingDirect.map((t) => ({
    key: t.key,
    label: `${t.code} ${DIRECT_LABEL[t.key]}`,
    source: '02.1',
  }));

  // 4. Private / public status.
  if (f.isPrivateCompany == null)
    return finish({
      outcome: CARO_OUTCOME.informationInsufficient,
      route: CARO_ENTITY_ROUTE.undetermined,
      basis: 'Private / public status not confirmed — needed to choose the CARO route.',
      missing: [
        { key: 'company_type', label: 'Private / public status', source: '02.1' },
        ...pendingDirectMissing,
      ],
    });

  if (f.isPrivateCompany === false) {
    if (pendingDirect.length)
      return finish({
        outcome: CARO_OUTCOME.informationInsufficient,
        route: CARO_ENTITY_ROUTE.publicCompany,
        basis: `Public company — a direct exemption is still pending (${pendingDirect.map((t) => t.code).join(', ')}).`,
        missing: pendingDirectMissing,
      });
    return finish({
      outcome: CARO_OUTCOME.applicable,
      route: CARO_ENTITY_ROUTE.publicCompany,
      basis:
        'Public company, no direct exemption applies — CARO 2020 applies to the report (the private-company exemption is not available).',
      ruleVersionId: null,
    });
  }

  // 5. Cumulative private-company exemption test — every condition evaluated.
  const conditions = privateConditions(f, rules as Record<CaroConditionKey, ResolvedRule>);
  const failed = conditions.filter((c) => c.result === CARO_CONDITION_RESULT.failed);
  const pending = conditions.filter((c) => c.result === CARO_CONDITION_RESULT.pending);
  const qualified = failed.length > 0 ? false : pending.length > 0 ? null : true;
  const privateTest: CaroPrivateTest = { tested: true, qualified, conditions };
  const missingConditions: CaroMissingFact[] = pending.map((c) => ({
    key: c.key,
    label: c.label,
    source: c.key === CARO_CONDITION.publicGroup ? '02.1 group structure' : '02.4 financial data',
  }));

  if (qualified === true)
    return finish({
      outcome: CARO_OUTCOME.notApplicableExempt,
      route: CARO_ENTITY_ROUTE.privateCompany,
      privateTest,
      basis:
        'Private company satisfying every cumulative condition (not a holding/subsidiary of a public company; capital + reserves, aggregate bank/FI borrowings and total revenue within the configured limits) — exempt from CARO 2020.',
      ruleVersionId: rules.revenue.ruleVersionId,
    });

  if (qualified === false) {
    const first = failed[0]!;
    if (pendingDirect.length)
      return finish({
        outcome: CARO_OUTCOME.informationInsufficient,
        route: CARO_ENTITY_ROUTE.privateCompany,
        privateTest,
        basis: `The private-company exemption fails (${failed.map((c) => c.label.toLowerCase()).join(', ')}), but a direct exemption is still pending (${pendingDirect.map((t) => t.code).join(', ')}).`,
        missing: pendingDirectMissing,
        ruleVersionId: first.ruleVersionId,
      });
    const why =
      first.key === CARO_CONDITION.publicGroup
        ? 'it is a holding / subsidiary of a public company'
        : `${first.label.toLowerCase()} ${first.actualDisplay} exceeds the configured limit ${first.limitDisplay}`;
    return finish({
      outcome: CARO_OUTCOME.applicable,
      route: CARO_ENTITY_ROUTE.privateCompany,
      privateTest,
      basis: `Private company does not qualify for the CARO exemption — ${why}${
        failed.length > 1
          ? ` (also failed: ${failed
              .slice(1)
              .map((c) => c.label.toLowerCase())
              .join(', ')})`
          : ''
      }. All conditions are cumulative, so CARO 2020 applies.`,
      ruleVersionId: first.ruleVersionId,
    });
  }

  return finish({
    outcome: CARO_OUTCOME.informationInsufficient,
    route: CARO_ENTITY_ROUTE.privateCompany,
    privateTest,
    basis: `Private-company exemption test pending: ${pending.map((c) => c.label.toLowerCase()).join(', ')}.`,
    missing: [...missingConditions, ...pendingDirectMissing],
  });
}
