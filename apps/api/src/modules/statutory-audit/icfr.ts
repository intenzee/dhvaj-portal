import {
  FRAMEWORK_AREA_KEY,
  ICFR_BORROWING_SOURCES,
  ICFR_BORROWING_SOURCE_LABEL,
  ICFR_CONDITION,
  ICFR_CONDITION_RESULT,
  ICFR_CONTEXT_STATUS,
  ICFR_ENTITY_ROUTE,
  ICFR_FILING_STATUS,
  ICFR_FILING_STATUS_LABEL,
  ICFR_OUTCOME,
  ICFR_PROVISION_CODE,
  ICFR_ROUTE,
  ICFR_ROUTE_RESULT,
  RULE_CRITERION,
  formatInrCrore,
  ruleMeets,
  type FrameworkState,
  type IcfrBorrowingMeasure,
  type IcfrBorrowingPoint,
  type IcfrBorrowingSource,
  type IcfrCondition,
  type IcfrConditionKey,
  type IcfrConditionResult,
  type IcfrConclusionSummary,
  type IcfrDetail,
  type IcfrEntityRoute,
  type IcfrFactUsed,
  type IcfrFacts,
  type IcfrFilingAssessment,
  type IcfrMissingFact,
  type IcfrMonetaryTest,
  type IcfrOutcome,
  type IcfrReportContextResult,
  type IcfrResult,
  type IcfrRouteKey,
  type IcfrRouteResult,
  type IcfrRouteTest,
  type IcfrTurnoverMeasure,
  type ResolvedRule,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.5 Internal Financial Controls / ICFR Reporting — pure engine (Guide §9.5;
 * DHVAJ 02.5 spec v1.1 §5–§10).
 *
 * Step 1 resolves the private-company exemption rules in force for the audit
 * period; Step 2 a non-private company reports under §143(3)(i); Steps 3–4 test
 * the OPC and approved Small Company routes (consumed from 02.1, never
 * recalculated); Step 5 tests the monetary conditions — turnover per the latest
 * audited financial statements and the maximum aggregate covered borrowings at
 * any point in the year — combined per the configured join (AND today); Step 6
 * the §92 / §137 filing-default condition gates every exemption route; Step 7
 * concludes Applicable / Exempt / Further Assessment Required with the basis.
 *
 * NO statutory number or rule logic lives here (guide §1): limits, operators,
 * the AND/OR join, the covered borrowing sources and the filing prerequisite
 * all resolve from the Audit Rules Library through the injected
 * {@link RuleResolver}; the detail carries the actual limits, bases and rule
 * versions used. Unknown is never treated as "no default" or "within limit" —
 * a missing deciding fact returns Information Pending.
 *
 * An exemption never disables Section 05 control work, and Rule 11(g) stays a
 * separate conclusion (detail flags). Mirrors caro.ts so it unit-tests without
 * a database.
 */

const AREA = FRAMEWORK_AREA_KEY.ifc;
const P = ICFR_PROVISION_CODE;

const OPERATOR_LABEL: Record<string, string> = {
  '<=': '≤',
  '<': '<',
  '>=': '≥',
  '>': '>',
  '==': '=',
};

const MEASUREMENT_LABEL: Record<string, string> = {
  latest_audited_fs: 'as per the latest audited financial statements',
  balance_sheet_date: 'as on the balance sheet date',
  at_any_point_in_year: 'in aggregate at any point during the financial year',
  relevant_period: 'for the relevant period',
};

const CONDITION_LABEL: Record<IcfrConditionKey, string> = {
  turnover: 'Turnover',
  borrowings: 'Maximum aggregate covered borrowings',
  filing: 'Filing-default condition (§137 / §92)',
};

const ROUTE_LABEL: Record<IcfrRouteKey, string> = {
  opc: 'One Person Company',
  small_company: 'Small Company (§2(85))',
};

const inr = (v: number | null | undefined) => (v == null ? null : formatInrCrore(v));

function yn(v: boolean | null | undefined): string {
  return v === true ? 'Yes' : v === false ? 'No' : 'Not known';
}

function cond<T>(rule: ResolvedRule | null, key: string): T | undefined {
  return (rule?.condition as Record<string, unknown> | null | undefined)?.[key] as T | undefined;
}

// ── IFC-02 borrowings (spec §8) ──────────────────────────────────────────────

/** The covered / excluded sources per the borrowing rule (rule data, spec §3). */
export function borrowingSourcesOf(rule: ResolvedRule | null): {
  covered: IcfrBorrowingSource[];
  excluded: IcfrBorrowingSource[];
} {
  const listed = cond<string[]>(rule, 'sources');
  const excludes = cond<string[]>(rule, 'excludes') ?? [];
  // No configured list ⇒ count every source: including more can only defeat the
  // exemption, never grant it on a guess.
  const covered = ICFR_BORROWING_SOURCES.filter(
    (s) => (listed ? listed.includes(s) : true) && !excludes.includes(s),
  );
  return { covered, excluded: ICFR_BORROWING_SOURCES.filter((s) => !covered.includes(s)) };
}

/**
 * Aggregate the covered balances by date and take the maximum (spec §8): the
 * peak, its date and the per-source split on that date (excluded sources shown,
 * not counted).
 */
export function aggregateCoveredBorrowings(
  schedule: IcfrBorrowingPoint[],
  covered: IcfrBorrowingSource[],
): {
  peak: number;
  on: string;
  bySource: Record<IcfrBorrowingSource, number | null>;
  dates: number;
  lenders: number;
} | null {
  if (schedule.length === 0) return null;
  const byDate = new Map<string, number>();
  for (const p of schedule) {
    const add = covered.includes(p.source) ? p.amount : 0;
    byDate.set(p.asOn, (byDate.get(p.asOn) ?? 0) + add);
  }
  let on = '';
  let peak = -Infinity;
  for (const [d, total] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (total > peak) {
      peak = total;
      on = d;
    }
  }
  const bySource = Object.fromEntries(ICFR_BORROWING_SOURCES.map((s) => [s, null])) as Record<
    IcfrBorrowingSource,
    number | null
  >;
  for (const p of schedule.filter((x) => x.asOn === on))
    bySource[p.source] = (bySource[p.source] ?? 0) + p.amount;
  return {
    peak,
    on,
    bySource,
    dates: byDate.size,
    lenders: new Set(schedule.map((p) => p.lender)).size,
  };
}

function borrowingMeasure(f: IcfrFacts, rule: ResolvedRule | null): IcfrBorrowingMeasure {
  const { covered, excluded } = borrowingSourcesOf(rule);
  const agg = f.borrowingSchedule?.length
    ? aggregateCoveredBorrowings(f.borrowingSchedule, covered)
    : null;
  const empty = Object.fromEntries(ICFR_BORROWING_SOURCES.map((s) => [s, null])) as Record<
    IcfrBorrowingSource,
    number | null
  >;
  if (agg)
    return {
      maximumAggregate: agg.peak,
      peakDate: agg.on,
      bySource: agg.bySource,
      coveredSources: covered,
      excludedSources: excluded,
      dataBasis: f.borrowingDataBasis ?? null,
      balanceDates: agg.dates,
      lenders: agg.lenders,
      method: 'schedule',
    };
  return {
    maximumAggregate: f.peakCoveredBorrowings,
    peakDate: f.peakDate ?? null,
    bySource: empty,
    coveredSources: covered,
    excludedSources: excluded,
    dataBasis: f.borrowingDataBasis ?? null,
    balanceDates: 0,
    lenders: 0,
    method: f.peakCoveredBorrowings != null ? 'documented' : 'none',
  };
}

// ── IFC-01 turnover (spec §7) ────────────────────────────────────────────────

function turnoverMeasure(f: IcfrFacts): IcfrTurnoverMeasure {
  return {
    amount: f.turnover,
    period: f.turnoverPeriod ?? null,
    source: f.turnoverSource ?? null,
    audited: f.turnoverAudited ?? null,
    basis:
      f.turnover == null
        ? 'No turnover from audited financial statements is available.'
        : `Turnover ${formatInrCrore(f.turnover)}${f.turnoverPeriod ? ` for ${f.turnoverPeriod}` : ''}${f.turnoverSource ? ` (${f.turnoverSource})` : ''}.`,
  };
}

// ── IFC-03 filing condition (spec §9) ────────────────────────────────────────

/** Whether one filing is a default as on `today` (null = cannot tell). */
function filingDefaulted(r: NonNullable<IcfrFacts['filings']>[number], today: string) {
  if (r.filedOn) return r.dueDate ? r.filedOn > r.dueDate : null;
  if (!r.dueDate) return null;
  return r.dueDate < today ? true : false;
}

export function assessFiling(f: IcfrFacts, required: boolean): IcfrFilingAssessment {
  const today = f.today ?? new Date().toISOString().slice(0, 10);
  const records = (f.filings ?? []).map((r) => ({ ...r, defaulted: filingDefaulted(r, today) }));
  const defaults = records.filter((r) => r.defaulted === true);
  const unknown = records.filter((r) => r.defaulted === null);
  const documented = f.filingEvidence?.trim() ? f.filingEvidence.trim() : null;

  let status: IcfrFilingAssessment['status'];
  let basis: string;
  if (defaults.length || f.filingDefault === true) {
    status = ICFR_FILING_STATUS.defaultIdentified;
    basis = defaults.length
      ? `Default identified: ${defaults.map((r) => `${r.form}${r.period ? ` ${r.period}` : ''} (due ${r.dueDate}${r.filedOn ? `, filed ${r.filedOn}` : ', not filed'})`).join('; ')}.`
      : `Default recorded by the team${documented ? ` — ${documented}` : ''}.`;
  } else if (records.length && unknown.length === 0) {
    status = ICFR_FILING_STATUS.noDefault;
    basis = `No default across ${records.length} traceable filing record(s) (${records.map((r) => r.form).join(', ')}).`;
  } else if (f.filingDefault === false && documented) {
    status = ICFR_FILING_STATUS.noDefault;
    basis = `No default identified — documented evidence: ${documented}.`;
  } else {
    status = ICFR_FILING_STATUS.pending;
    basis =
      f.filingDefault === false
        ? 'A "no default" answer needs traceable support — record the AOC-4 / MGT-7 filings (due date, filing date / SRN) or the documented evidence.'
        : unknown.length
          ? `Filing status not traceable for: ${unknown.map((r) => r.form).join(', ')} — record the due date and filing date / SRN.`
          : 'Filing status under §137 / §92 not established — record the filings or the documented evidence (unknown is never "no default").';
  }
  return { status, required, records, basis };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function notTestedCondition(key: IcfrConditionKey, rule: ResolvedRule | null): IcfrCondition {
  return {
    key,
    label: CONDITION_LABEL[key],
    requirement: rule ? requirementOf(key, rule) : 'Not configured for the period',
    result: ICFR_CONDITION_RESULT.notTested,
    ruleCode: rule?.ruleCode ?? null,
    ruleVersionId: rule?.ruleVersionId ?? null,
    ruleVersion: rule?.version ?? null,
    ruleEffectiveFrom: rule?.effectiveFrom ?? null,
    operator: rule?.operator ?? null,
    threshold: rule?.threshold ?? null,
    unit: rule?.unit ?? null,
    measurementBasis: rule?.measurementBasis ?? null,
    actual: null,
    actualDisplay: '—',
    limitDisplay: key === ICFR_CONDITION.filing ? 'No disqualifying default' : inr(rule?.threshold),
    calculation: null,
    pendingReason: null,
    guidanceReference: rule?.guidanceReference ?? null,
    provisionCodes: provisionsFor(key),
  };
}

function provisionsFor(key: IcfrConditionKey): string[] {
  return key === ICFR_CONDITION.filing
    ? [P.exemptionNotification, P.section137, P.section92]
    : [P.exemptionNotification, P.section143_3_i];
}

function requirementOf(key: IcfrConditionKey, rule: ResolvedRule): string {
  if (key === ICFR_CONDITION.filing)
    return 'No default in filing financial statements (§137) or the annual return (§92)';
  const basis = MEASUREMENT_LABEL[rule.measurementBasis ?? ''] ?? '';
  const op = OPERATOR_LABEL[rule.operator] ?? rule.operator;
  return `${op} ${rule.threshold != null ? formatInrCrore(rule.threshold) : '—'}${basis ? ` ${basis}` : ''}`;
}

function monetaryCondition(
  key: IcfrConditionKey,
  rule: ResolvedRule | null,
  actual: number | null,
  calculation: string | null,
  pendingReason: string,
): IcfrCondition {
  const base = notTestedCondition(key, rule);
  if (!rule)
    return {
      ...base,
      result: ICFR_CONDITION_RESULT.pending,
      pendingReason: 'No rule version in force for the audit period.',
    };
  const result: IcfrConditionResult =
    actual == null
      ? ICFR_CONDITION_RESULT.pending
      : ruleMeets(actual, rule)
        ? ICFR_CONDITION_RESULT.satisfied
        : ICFR_CONDITION_RESULT.failed;
  return {
    ...base,
    result,
    actual,
    actualDisplay: inr(actual) ?? 'Not available',
    calculation,
    pendingReason: result === ICFR_CONDITION_RESULT.pending ? pendingReason : null,
  };
}

function turnoverCondition(f: IcfrFacts, rule: ResolvedRule | null): IcfrCondition {
  // A provisional / unaudited figure is never substituted (spec §7).
  const accepted = f.turnoverAudited === false ? null : f.turnover;
  const calc =
    accepted == null
      ? null
      : `Turnover ${formatInrCrore(accepted)}${f.turnoverPeriod ? ` (${f.turnoverPeriod})` : ''}${f.turnoverSource ? ` — ${f.turnoverSource}` : ''}.`;
  const why =
    f.turnoverAudited === false && f.turnover != null
      ? 'Only a provisional / unaudited turnover is available — the test uses the latest audited financial statements.'
      : 'Turnover per the latest audited financial statements is not available.';
  return monetaryCondition(ICFR_CONDITION.turnover, rule, accepted, calc, why);
}

function borrowingCondition(rule: ResolvedRule | null, m: IcfrBorrowingMeasure): IcfrCondition {
  let actual = m.maximumAggregate;
  let calc: string | null = null;
  let why =
    'Maximum aggregate covered borrowings at any point in the year are not captured — enter the balance schedule or the documented peak.';
  const covered = m.coveredSources.map((s) => ICFR_BORROWING_SOURCE_LABEL[s].toLowerCase());
  if (m.method === 'schedule' && actual != null) {
    const split = m.coveredSources
      .filter((s) => m.bySource[s] != null)
      .map(
        (s) => `${ICFR_BORROWING_SOURCE_LABEL[s].toLowerCase()} ${formatInrCrore(m.bySource[s]!)}`,
      );
    const excluded = m.excludedSources.filter((s) => m.bySource[s] != null);
    calc =
      `Covered sources (${covered.join(' + ')}) aggregated across ${m.balanceDates} balance date(s), ${m.lenders} lender(s); ` +
      `peak ${formatInrCrore(actual)} on ${m.peakDate}${split.length ? ` (${split.join(' + ')})` : ''}` +
      `${excluded.length ? `; excluded per rule: ${excluded.map((s) => `${ICFR_BORROWING_SOURCE_LABEL[s].toLowerCase()} ${formatInrCrore(m.bySource[s]!)}`).join(', ')}` : ''}.`;
  } else if (m.method === 'documented' && actual != null) {
    calc = `Documented maximum aggregate ${formatInrCrore(actual)}${m.peakDate ? ` on ${m.peakDate}` : ''}${m.dataBasis ? ` (${m.dataBasis.replace(/_/g, ' ')} data)` : ''}.`;
  }
  if (actual != null && rule && m.dataBasis === 'year_end_only' && ruleMeets(actual, rule)) {
    // Within the limit on year-end data alone proves nothing for "any point";
    // a year-end figure at/over the limit already fails it (spec §8).
    why =
      'Only year-end balances are available — the "at any point during the year" test needs balances through the year.';
    actual = null;
  }
  return monetaryCondition(ICFR_CONDITION.borrowings, rule, actual, calc, why);
}

function filingCondition(rule: ResolvedRule | null, a: IcfrFilingAssessment): IcfrCondition {
  const base = notTestedCondition(ICFR_CONDITION.filing, rule);
  if (!rule) return base;
  const result: IcfrConditionResult =
    a.status === ICFR_FILING_STATUS.noDefault
      ? ICFR_CONDITION_RESULT.satisfied
      : a.status === ICFR_FILING_STATUS.defaultIdentified
        ? ICFR_CONDITION_RESULT.failed
        : ICFR_CONDITION_RESULT.pending;
  const defaults = a.records.filter((r) => r.defaulted === true).length;
  return {
    ...base,
    result,
    actual: result === ICFR_CONDITION_RESULT.pending ? null : defaults,
    actualDisplay: ICFR_FILING_STATUS_LABEL[a.status],
    calculation: a.basis,
    pendingReason: result === ICFR_CONDITION_RESULT.pending ? a.basis : null,
  };
}

function route(
  key: IcfrRouteKey,
  rule: ResolvedRule | null,
  value: boolean | null,
  tested: boolean,
): IcfrRouteTest {
  const result: IcfrRouteResult = !tested
    ? ICFR_ROUTE_RESULT.notTested
    : !rule
      ? ICFR_ROUTE_RESULT.notAvailable
      : value === true
        ? ICFR_ROUTE_RESULT.exemptRoute
        : value === false
          ? ICFR_ROUTE_RESULT.no
          : ICFR_ROUTE_RESULT.pending;
  return {
    key,
    label: ROUTE_LABEL[key],
    actual: yn(value),
    result,
    basis:
      result === ICFR_ROUTE_RESULT.exemptRoute
        ? `${ROUTE_LABEL[key]} per 02.1 — exemption route available${cond<boolean>(rule, 'requiresFilingCondition') ? ', subject to the filing condition' : ''}.`
        : result === ICFR_ROUTE_RESULT.no
          ? `Not a ${ROUTE_LABEL[key].toLowerCase()} per 02.1.`
          : result === ICFR_ROUTE_RESULT.pending
            ? `${ROUTE_LABEL[key]} status not concluded in 02.1.`
            : result === ICFR_ROUTE_RESULT.notAvailable
              ? 'No rule version for this route is in force for the period.'
              : 'Not reached.',
    sourceSection: '02.1',
    ruleCode: rule?.ruleCode ?? null,
    ruleVersionId: rule?.ruleVersionId ?? null,
    provisionCodes: [P.exemptionNotification],
  };
}

// ── Facts Used (§2, §4) ──────────────────────────────────────────────────────

function factsUsed(
  f: IcfrFacts,
  m: IcfrBorrowingMeasure,
  filing: IcfrFilingAssessment,
): IcfrFactUsed[] {
  const out: IcfrFactUsed[] = [
    {
      key: 'company_type',
      label: 'Company type',
      value:
        f.isCompany === false
          ? 'Not a company'
          : f.isPrivateCompany === true
            ? 'Private company'
            : f.isPrivateCompany === false
              ? 'Public company'
              : 'Not known',
      source: '02.1 Entity & Regulatory Profile',
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
      source: f.smallCompanyBasis ?? '02.1 Small Company Assessment',
      sourceSection: '02.1',
    },
    {
      key: 'turnover',
      label: `Turnover (latest audited FS${f.turnoverPeriod ? `, ${f.turnoverPeriod}` : ''})`,
      value: inr(f.turnover) ?? 'Not available',
      source: f.turnoverSource ?? '02.1 financial profile',
      sourceSection: f.turnoverSource?.startsWith('02.5') ? '02.5' : '02.1',
    },
    {
      key: 'peak_borrowings',
      label: 'Maximum aggregate covered borrowings',
      value:
        m.maximumAggregate != null
          ? `${formatInrCrore(m.maximumAggregate)}${m.peakDate ? ` on ${m.peakDate}` : ''}`
          : 'Not captured',
      source: m.method === 'schedule' ? 'Borrowing schedule (02.5)' : 'Documented peak (02.5)',
      sourceSection: '02.5',
    },
    {
      key: 'filing',
      label: 'Section 137 / 92 filing status',
      value: ICFR_FILING_STATUS_LABEL[filing.status],
      source: filing.records.length
        ? `Compliance calendar / MCA (${filing.records.length} record(s))`
        : 'Documented evidence (02.5)',
      sourceSection: filing.records.some((r) => r.source === 'compliance_calendar')
        ? 'master'
        : '02.5',
    },
    {
      key: 'cfs_in_scope',
      label: 'Consolidated financial statements in scope',
      value: f.cfsInScope == null ? 'Pending 02.6' : yn(f.cfsInScope),
      source: '02.6 Consolidation / Group Audit',
      sourceSection: '02.6',
    },
  ];
  return out;
}

function reportContexts(outcome: IcfrOutcome, f: IcfrFacts): IcfrReportContextResult[] {
  const standalone: IcfrReportContextResult =
    outcome === ICFR_OUTCOME.applicable
      ? {
          context: 'standalone',
          status: ICFR_CONTEXT_STATUS.applicable,
          applies: true,
          basis: '§143(3)(i) report on ICFR (Annexure) on the standalone financial statements.',
        }
      : outcome === ICFR_OUTCOME.exempt
        ? {
            context: 'standalone',
            status: ICFR_CONTEXT_STATUS.notApplicable,
            applies: false,
            basis: 'Exempt — no separate §143(3)(i) opinion / annexure on the standalone FS.',
          }
        : {
            context: 'standalone',
            status: ICFR_CONTEXT_STATUS.pending,
            applies: null,
            basis: 'Standalone ICFR reporting not yet determined.',
          };
  const consolidated: IcfrReportContextResult =
    f.cfsInScope === false
      ? {
          context: 'consolidated',
          status: ICFR_CONTEXT_STATUS.notApplicable,
          applies: false,
          basis: f.cfsBasis ?? 'No consolidated financial statements in scope (02.6).',
        }
      : f.cfsInScope == null
        ? {
            context: 'consolidated',
            status: ICFR_CONTEXT_STATUS.pending,
            applies: null,
            basis:
              '02.6 has not concluded on consolidated financial statements — the consolidated ICFR consideration stays Pending; the standalone conclusion is not blocked.',
          }
        : {
            context: 'consolidated',
            status: ICFR_CONTEXT_STATUS.applicable,
            applies: null,
            basis:
              'CFS in scope — complete the Consolidated ICFR Reporting Consideration (component companies), not a copy of the standalone workstream.',
          };
  return [standalone, consolidated];
}

// ── The decision sequence ────────────────────────────────────────────────────

const STATE: Record<IcfrOutcome, FrameworkState> = {
  applicable: 'system_suggested_applicable',
  exempt: 'system_suggested_not_applicable',
  further_assessment: 'professional_judgement_required',
  information_insufficient: 'pending_information',
};

interface Decision {
  outcome: IcfrOutcome;
  route: IcfrEntityRoute;
  basis: string;
  reason: string;
  exemptionReason?: string | null;
  filingDefaultBlocks?: boolean;
  missing?: IcfrMissingFact[];
  ruleVersionId?: string | null;
}

/**
 * The 02.5 decision sequence (spec §5 Steps 1–7). Every reached route and
 * condition is evaluated and shown; the first decisive result concludes.
 */
export function assessIcfr(f: IcfrFacts, resolve: RuleResolver): IcfrResult {
  // Step 1 — the private-company exemption framework in force for the period.
  const rules = {
    opc: resolve(AREA, RULE_CRITERION.opcRoute),
    small: resolve(AREA, RULE_CRITERION.smallCompanyRoute),
    turnover: resolve(AREA, RULE_CRITERION.turnover),
    borrowings: resolve(AREA, RULE_CRITERION.borrowings),
    join: resolve(AREA, RULE_CRITERION.monetaryJoin),
    filing: resolve(AREA, RULE_CRITERION.filingCondition),
  };
  const anchor = rules.join ?? rules.turnover ?? rules.opc ?? rules.small ?? null;
  const notificationVersion = anchor
    ? { code: P.exemptionNotification, effectiveFrom: anchor.effectiveFrom }
    : null;
  const joinMode: 'and' | 'or' = cond<string>(rules.join, 'join') === 'or' ? 'or' : 'and';
  const filingRequired = rules.filing != null;

  const borrowing = borrowingMeasure(f, rules.borrowings);
  const filing = assessFiling(f, filingRequired);
  const turnover = turnoverMeasure(f);
  const used = factsUsed(f, borrowing, filing);
  const isPrivate = f.isCompany === true && f.isPrivateCompany === true;

  // Routes and conditions — evaluated in order for a private company only.
  const opcRoute = route(ICFR_ROUTE.opc, rules.opc, f.isOpc, isPrivate);
  const opcExempt = opcRoute.result === ICFR_ROUTE_RESULT.exemptRoute;
  const smallRoute = route(
    ICFR_ROUTE.smallCompany,
    rules.small,
    f.isSmallCompany,
    isPrivate && !opcExempt,
  );
  const smallExempt = smallRoute.result === ICFR_ROUTE_RESULT.exemptRoute;
  const testMonetary = isPrivate && !opcExempt && !smallExempt;
  const turnoverRow = testMonetary
    ? turnoverCondition(f, rules.turnover)
    : notTestedCondition(ICFR_CONDITION.turnover, rules.turnover);
  const borrowingRow = testMonetary
    ? borrowingCondition(rules.borrowings, borrowing)
    : notTestedCondition(ICFR_CONDITION.borrowings, rules.borrowings);
  const filingRow = isPrivate
    ? filingCondition(rules.filing, filing)
    : notTestedCondition(ICFR_CONDITION.filing, rules.filing);
  const routes = [opcRoute, smallRoute];
  const conditions = [turnoverRow, borrowingRow, filingRow];

  const monetaryResult: IcfrConditionResult = !testMonetary
    ? ICFR_CONDITION_RESULT.notTested
    : !rules.turnover || !rules.borrowings
      ? ICFR_CONDITION_RESULT.pending
      : joinOf(joinMode, turnoverRow.result, borrowingRow.result);
  const monetaryTest: IcfrMonetaryTest | null = testMonetary
    ? {
        tested: true,
        turnoverWithinLimit: within(turnoverRow.result),
        borrowingsWithinLimit: within(borrowingRow.result),
      }
    : null;

  const provisionCodes = new Set<string>([P.section143_3_i, P.guidanceNote, P.rule11g]);
  if (isPrivate)
    [P.exemptionNotification, P.section92, P.section137].forEach((c) => provisionCodes.add(c));
  if (isPrivate && (opcExempt || smallExempt)) provisionCodes.add(P.implementationGuide);

  const finish = (d: Decision): IcfrResult => {
    const reportingApplies = d.outcome === ICFR_OUTCOME.applicable;
    const conclusion: IcfrConclusionSummary = {
      result: d.outcome,
      entityRoute: d.route,
      opc: opcRoute.result,
      smallCompany: smallRoute.result,
      turnover: turnoverRow.actual != null ? inr(turnoverRow.actual) : inr(f.turnover),
      turnoverLimit: rules.turnover ? requirementOf(ICFR_CONDITION.turnover, rules.turnover) : null,
      peakBorrowings: inr(borrowing.maximumAggregate),
      borrowingLimit: rules.borrowings
        ? requirementOf(ICFR_CONDITION.borrowings, rules.borrowings)
        : null,
      filingCondition: filingRow.result,
      reason: d.reason,
      notificationVersion: notificationVersion
        ? `MCA private-company exemption (effective ${notificationVersion.effectiveFrom})`
        : null,
    };
    const detail: IcfrDetail = {
      reportingApplies,
      exemptionReason: d.outcome === ICFR_OUTCOME.exempt ? (d.exemptionReason ?? d.basis) : null,
      monetaryTest,
      filingDefaultBlocks: d.filingDefaultBlocks ?? false,
      configuresIcfrWorkstream: reportingApplies,
      controlsPhaseUnaffected: true,
      rule11gSeparate: true,
      entityRoute: d.route,
      notificationVersion:
        d.route === ICFR_ENTITY_ROUTE.privateCompany ? notificationVersion : null,
      routes,
      conditions,
      monetaryJoin: rules.join ? joinMode : null,
      turnover,
      borrowing,
      filing,
      conclusion,
      factsUsed: used,
      missingFacts: d.missing ?? [],
      reportContexts: reportContexts(d.outcome, f),
      provisionCodes: [...provisionCodes],
    };
    const basis =
      d.outcome === ICFR_OUTCOME.exempt
        ? `${d.basis} (An ICFR reporting exemption does not disable the Controls phase — ordinary SA control work continues.)`
        : d.basis;
    return {
      outcome: d.outcome,
      state: STATE[d.outcome],
      basis,
      ruleVersionId: d.ruleVersionId ?? null,
      authorityProvisionId: null,
      detail,
    };
  };

  // Company status.
  if (f.isCompany === false)
    return finish({
      outcome: ICFR_OUTCOME.exempt,
      route: ICFR_ENTITY_ROUTE.notCompany,
      basis: 'Not a company under the Companies Act — §143(3)(i) ICFR reporting does not apply.',
      reason: 'Not a company; §143(3)(i) does not apply',
    });
  if (f.isCompany == null)
    return finish({
      outcome: ICFR_OUTCOME.informationInsufficient,
      route: ICFR_ENTITY_ROUTE.unknown,
      basis: 'Entity type not confirmed — confirm 02.1 before assessing ICFR reporting.',
      reason: 'Entity type pending',
      missing: [{ key: 'company_type', label: 'Entity type', source: '02.1' }],
    });

  // Step 2 — a non-private company reports; no private-company tests run.
  if (f.isPrivateCompany === false)
    return finish({
      outcome: ICFR_OUTCOME.applicable,
      route: ICFR_ENTITY_ROUTE.publicCompany,
      basis:
        'Public / non-private company — §143(3)(i) ICFR reporting applies; the private-company exemption is not available.',
      reason: 'Not a private company; exemption unavailable',
    });
  if (f.isPrivateCompany == null)
    return finish({
      outcome: ICFR_OUTCOME.informationInsufficient,
      route: ICFR_ENTITY_ROUTE.unknown,
      basis:
        'Private / public status not confirmed — needed for the ICFR private-company exemption test.',
      reason: 'Private / public status pending',
      missing: [{ key: 'company_type', label: 'Private / public status', source: '02.1' }],
    });

  const PRIV = ICFR_ENTITY_ROUTE.privateCompany;
  if (!notificationVersion)
    return finish({
      outcome: ICFR_OUTCOME.furtherAssessment,
      route: PRIV,
      basis:
        'The §143(3)(i) private-company ICFR-reporting exemption is not in force for this audit period — assess ICFR reporting manually.',
      reason: 'No exemption-notification version for the period',
    });

  // Step 6 first as a gate — a disqualifying filing default removes EVERY route.
  if (filingRequired && filingRow.result === ICFR_CONDITION_RESULT.failed)
    return finish({
      outcome: ICFR_OUTCOME.applicable,
      route: PRIV,
      filingDefaultBlocks: true,
      basis: `A default in filing financial statements (§137) or the annual return (§92) makes the private-company exemption unavailable — §143(3)(i) reporting applies. ${filing.basis}`,
      reason: 'Filing-default condition failed; exemption unavailable',
      ruleVersionId: rules.filing!.ruleVersionId,
    });

  // Steps 3–5 — which exemption route (if any) is available.
  const exemptVia: { label: string; ruleVersionId: string | null } | null = opcExempt
    ? { label: 'One Person Company route', ruleVersionId: rules.opc!.ruleVersionId }
    : smallExempt
      ? {
          label: 'Small Company route (approved 02.1 result)',
          ruleVersionId: rules.small!.ruleVersionId,
        }
      : monetaryResult === ICFR_CONDITION_RESULT.satisfied
        ? {
            label: `monetary conditions (${joinMode === 'and' ? 'both' : 'either'} satisfied: turnover ${turnoverRow.actualDisplay} ${turnoverRow.requirement}; peak covered borrowings ${borrowingRow.actualDisplay} ${borrowingRow.requirement})`,
            ruleVersionId: (rules.join ?? rules.turnover)!.ruleVersionId,
          }
        : null;

  const pendingRoutes = routes.filter((r) => r.result === ICFR_ROUTE_RESULT.pending);
  const routeMissing: IcfrMissingFact[] = pendingRoutes.map((r) => ({
    key: r.key === ICFR_ROUTE.opc ? 'opc' : 'small_company',
    label: r.label,
    source: '02.1',
  }));
  const conditionMissing = (rows: IcfrCondition[]): IcfrMissingFact[] =>
    rows
      .filter((c) => c.result === ICFR_CONDITION_RESULT.pending)
      .map((c) => ({
        key: c.key === ICFR_CONDITION.borrowings ? 'peak_borrowings' : c.key,
        label: c.label,
        source:
          c.key === ICFR_CONDITION.turnover
            ? 'Latest audited financial statements (02.1 / IFC-01)'
            : c.key === ICFR_CONDITION.borrowings
              ? 'Borrowing schedule (IFC-02)'
              : 'Compliance / MCA filing records (IFC-03)',
      }));

  if (exemptVia) {
    // Step 6 — the exemption stands only with the filing condition satisfied.
    if (filingRequired && filingRow.result !== ICFR_CONDITION_RESULT.satisfied)
      return finish({
        outcome: ICFR_OUTCOME.informationInsufficient,
        route: PRIV,
        basis: `Exemption available via the ${exemptVia.label}, subject to the filing condition — ${filing.basis}`,
        reason: 'Filing-default condition pending',
        missing: conditionMissing([filingRow]),
      });
    const reason = `Exempt via the ${exemptVia.label}${filingRequired ? '; no filing default' : ''}`;
    return finish({
      outcome: ICFR_OUTCOME.exempt,
      route: PRIV,
      basis: `Private company exempt from §143(3)(i) ICFR reporting — ${reason}.`,
      exemptionReason: `${reason}.`,
      reason,
      ruleVersionId: exemptVia.ruleVersionId,
    });
  }

  // No route resolved the exemption.
  if (monetaryResult === ICFR_CONDITION_RESULT.failed && pendingRoutes.length === 0) {
    const failed = [turnoverRow, borrowingRow].filter(
      (c) => c.result === ICFR_CONDITION_RESULT.failed,
    );
    const what = failed
      .map((c) => `${c.label.toLowerCase()} ${c.actualDisplay} does not meet ${c.requirement}`)
      .join('; ');
    return finish({
      outcome: ICFR_OUTCOME.applicable,
      route: PRIV,
      basis: `Private company — not an OPC or small company, and the monetary exemption fails (${what}). ${joinMode === 'and' ? 'Both conditions are required' : 'Neither condition is met'}, so §143(3)(i) ICFR reporting applies.`,
      reason: `${failed.map((c) => (c.key === ICFR_CONDITION.turnover ? 'Turnover' : 'Borrowing')).join(' and ')} condition failed; exemption unavailable`,
      ruleVersionId: failed[0]!.ruleVersionId,
    });
  }

  if (!rules.turnover || !rules.borrowings) {
    if (pendingRoutes.length === 0)
      return finish({
        outcome: ICFR_OUTCOME.furtherAssessment,
        route: PRIV,
        basis:
          'Not an OPC or small company, and no monetary exemption limits are in force for the period — assess ICFR reporting manually.',
        reason: 'Monetary limits not configured for the period',
      });
  }

  const missing = [
    ...routeMissing,
    ...conditionMissing(testMonetary ? [turnoverRow, borrowingRow] : []),
  ];
  return finish({
    outcome: ICFR_OUTCOME.informationInsufficient,
    route: PRIV,
    basis: `Private-company exemption test pending: ${missing.map((m) => m.label.toLowerCase()).join(', ') || 'route not concluded'}.`,
    reason: 'Exemption assessment pending',
    missing,
  });
}

function within(r: IcfrConditionResult): boolean | null {
  return r === ICFR_CONDITION_RESULT.satisfied
    ? true
    : r === ICFR_CONDITION_RESULT.failed
      ? false
      : null;
}

/** Combine the two monetary results per the configured join (rule data). */
function joinOf(
  mode: 'and' | 'or',
  a: IcfrConditionResult,
  b: IcfrConditionResult,
): IcfrConditionResult {
  const S = ICFR_CONDITION_RESULT.satisfied;
  const F = ICFR_CONDITION_RESULT.failed;
  if (mode === 'and') {
    if (a === F || b === F) return F;
    if (a === S && b === S) return S;
    return ICFR_CONDITION_RESULT.pending;
  }
  if (a === S || b === S) return S;
  if (a === F && b === F) return F;
  return ICFR_CONDITION_RESULT.pending;
}
