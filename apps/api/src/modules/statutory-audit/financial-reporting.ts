import {
  APPLICABILITY_TYPE,
  ENTITY_BRANCH,
  FRAMEWORK_AREA_KEY,
  FRF_CONFIDENCE,
  FRF_LISTING_STATUS,
  FRF_TEST_RESULT,
  GROUP_EFFECT,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  SMC_STATUS,
  formatInrCrore,
  ruleMeets,
  type ApplicabilityType,
  type EntityBranch,
  type FinancialReportingDetail,
  type FinancialReportingFacts,
  type FinancialReportingResult,
  type FrameworkState,
  type FrfAppliedRule,
  type FrfConfidence,
  type FrfFactUsed,
  type FrfGroupAssessment,
  type FrfGroupRow,
  type FrfListingAssessment,
  type FrfListingStatus,
  type FrfMissingFact,
  type FrfNetWorthAssessment,
  type FrfSmcAssessment,
  type FrfSmcCondition,
  type FrfTestResult,
  type NetWorthPoint,
  type ReportingFrameworkOutcome,
  type ResolvedRule,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.2 Financial Reporting Framework — pure engine (Section 02.2 spec §3–§17).
 *
 * Runs the Rule 4 sequence of spec §9 over the confirmed 02.1 facts:
 *   1. entity branch (§8) — specialised routes resolve from the Rules Library;
 *   2. prior / continuing Ind AS (§6) — wins over a low current net worth;
 *   3. voluntary adoption (§7, Rule 4(1)(i));
 *   4. SME exchange / ITP proviso (§12) — removes the MANDATORY roadmap only;
 *   5. listing route and net-worth route by phase (§3, §9, §13), with the Rule 4
 *      timing mechanics (§10): measured from the configured base date, and a
 *      company first meeting a threshold at a year end applies Ind AS from the
 *      next year;
 *   6. group relationships (§11);
 *   7. otherwise Accounting Standards, with the SMC sub-assessment (§16).
 *
 * NO statutory number or date lives here (spec §2): thresholds, phase dates,
 * base dates, the SME exception, specialised routes and SMC ceilings all resolve
 * from the Audit Rules Library through the injected {@link RuleResolver} for the
 * audit period. Where a deciding fact or rule is absent the engine reports it
 * (`missingFacts`) and never guesses. Unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;

/** Rule criteria / entity classes the 02.2 Rules Library rows are keyed by (structure, not data). */
export const FRF_CRITERION = {
  netWorth: RULE_CRITERION.netWorth,
  listed: 'listed',
  listingException: 'listing_exception',
  voluntary: 'voluntary_adoption',
  group: 'group_relationship',
  route: 'entity_route',
  turnover: RULE_CRITERION.turnover,
  borrowings: RULE_CRITERION.borrowings,
} as const;

/** One roadmap phase rule (§3): class key + criterion, evaluated in order. */
interface PhaseSpec {
  entityClass: string;
  criterion: string;
  label: string;
}

const CORPORATE_PHASES: PhaseSpec[] = [
  { entityClass: 'corporate_p1', criterion: FRF_CRITERION.netWorth, label: 'Phase I' },
  {
    entityClass: 'corporate_listed_p2',
    criterion: FRF_CRITERION.listed,
    label: 'Phase II (listed)',
  },
  {
    entityClass: 'corporate_unlisted_p2',
    criterion: FRF_CRITERION.netWorth,
    label: 'Phase II (unlisted)',
  },
];
const NBFC_PHASES: PhaseSpec[] = [
  { entityClass: 'nbfc_p1', criterion: FRF_CRITERION.netWorth, label: 'NBFC Phase I' },
  {
    entityClass: 'nbfc_listed_p2',
    criterion: FRF_CRITERION.listed,
    label: 'NBFC Phase II (listed)',
  },
  {
    entityClass: 'nbfc_unlisted_p2',
    criterion: FRF_CRITERION.netWorth,
    label: 'NBFC Phase II (unlisted)',
  },
];

/** DOM anchors of the source fields (02.1 cards and 02.2 controls). */
export const FRF_ANCHOR = {
  card: (k: string) => `profile-card-${k}`,
  frf01: 'frf-01',
  frf02: 'frf-02',
  frf03: 'frf-03',
  frf04: 'frf-04',
  netWorth: 'frf-net-worth',
  group: 'frf-group',
  smc: 'frf-smc',
} as const;

// ── Financial-year helpers ────────────────────────────────────────────────────

/** The FY ('YYYY-YY') containing an ISO date (India: April–March). */
export function fyOf(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function nextFy(fy: string): string {
  const s = Number(fy.slice(0, 4)) + 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
const maxFy = (a: string, b: string) => (a >= b ? a : b);

function exact(
  resolve: RuleResolver,
  criterion: string,
  entityClass: string | null,
): ResolvedRule | null {
  const r = resolve(AREA, criterion, entityClass);
  // The resolver falls back to a class-agnostic rule; a phase must match exactly.
  if (!r || (r.entityClass ?? null) !== entityClass) return null;
  return r;
}

const cr = (v: number | null | undefined) => (v == null ? '—' : formatInrCrore(v));
const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    .replace(/ /g, '-');
};

function applied(r: ResolvedRule, label: string, result: FrfAppliedRule['result']): FrfAppliedRule {
  return {
    ruleCode: r.ruleCode,
    ruleVersionId: r.ruleVersionId,
    authorityProvisionId: r.authorityProvisionId,
    label,
    operator: r.criterion === FRF_CRITERION.netWorth ? r.operator : null,
    threshold: r.criterion === FRF_CRITERION.netWorth ? r.threshold : null,
    effectiveFrom: r.effectiveFrom,
    result,
  };
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function listingStatusOf(f: FinancialReportingFacts): FrfListingStatus {
  return f.listingStatus ?? (f.isListed ? FRF_LISTING_STATUS.listed : FRF_LISTING_STATUS.unlisted);
}

/** FRF-02 answer, falling back to the legacy boolean and FRF-01. */
function alreadyIndAs(f: FinancialReportingFacts): 'yes' | 'no' | 'pending' | null {
  if (f.indAsAlreadyApplicable) return f.indAsAlreadyApplicable;
  if (f.priorIndAs || f.priorFramework === 'ind_as') return 'yes';
  if (f.priorFramework === 'accounting_standards') return 'no';
  return null;
}

function voluntaryOf(f: FinancialReportingFacts): 'yes' | 'no' | 'pending' | null {
  if (f.voluntaryAnswer) return f.voluntaryAnswer;
  return f.voluntaryIndAs ? 'yes' : null;
}

function branchOf(
  f: FinancialReportingFacts,
  resolve: RuleResolver,
): { branch: EntityBranch; route: ResolvedRule | null; routeType: string | null } {
  if (f.isCompany === false)
    return { branch: ENTITY_BRANCH.nonCompany, route: null, routeType: null };
  const types = new Set(f.specialEntityTypes ?? []);
  if (f.isBank) types.add('bank');
  if (f.isInsurance) types.add('insurance');
  if (f.isBankOrInsurance && !f.isBank && !f.isInsurance) types.add('bank');
  for (const t of types) {
    const route = exact(resolve, FRF_CRITERION.route, t);
    if (route) {
      const branch =
        t === 'bank'
          ? ENTITY_BRANCH.bank
          : t === 'insurance'
            ? ENTITY_BRANCH.insurance
            : ENTITY_BRANCH.otherSpecial;
      return { branch, route, routeType: t };
    }
  }
  // A bank / insurer with no configured route is never pushed down the ordinary roadmap.
  if (types.has('bank')) return { branch: ENTITY_BRANCH.bank, route: null, routeType: 'bank' };
  if (types.has('insurance'))
    return { branch: ENTITY_BRANCH.insurance, route: null, routeType: 'insurance' };
  if (f.isNbfc) return { branch: ENTITY_BRANCH.nbfc, route: null, routeType: null };
  return { branch: ENTITY_BRANCH.ordinary, route: null, routeType: null };
}

// ── Net worth (§10) ───────────────────────────────────────────────────────────

/** Net-worth points measured BEFORE the audit period, oldest first. */
function netWorthPoints(f: FinancialReportingFacts, periodStart: string): NetWorthPoint[] {
  const pts = [...(f.netWorthHistory ?? [])].filter((p) => p.asAt < periodStart);
  if (f.netWorth != null && pts.length === 0) {
    // The single 02.1 figure is the preceding year's audited standalone net worth.
    const asAt = `${Number(periodStart.slice(0, 4))}-03-31`;
    pts.push({
      asAt,
      financialYear: fyOf(asAt),
      value: f.netWorth,
      source: '02.1 applicability financials',
    });
  }
  return pts.sort((a, b) => a.asAt.localeCompare(b.asAt));
}

interface PhaseHit {
  rule: ResolvedRule;
  spec: PhaseSpec;
  appliesFromFy: string;
  measuredAt: NetWorthPoint | null;
  firstMetFy: string | null;
}

/**
 * Rule 4 timing (§10): from the configured base date (`condition.measurementBaseDate`),
 * the first year-end at which the threshold is met decides. Met at the base
 * measurement → the phase start; first met later → the year after
 * (`condition.firstMeetsAppliesFrom` = 'next_year', the Rule 4 default).
 */
function netWorthHit(
  rule: ResolvedRule,
  spec: PhaseSpec,
  points: NetWorthPoint[],
): { hit: PhaseHit | null; latest: NetWorthPoint | null } {
  const base = String(rule.condition?.measurementBaseDate ?? '0000-01-01');
  const phaseStartFy = fyOf(rule.effectiveFrom);
  const relevant = points.filter((p) => p.asAt >= base);
  const latest = relevant.length ? relevant[relevant.length - 1]! : null;
  for (let i = 0; i < relevant.length; i++) {
    const p = relevant[i]!;
    if (!ruleMeets(p.value, rule)) continue;
    const isBase = i === 0 && p.asAt.slice(0, 4) === base.slice(0, 4);
    const sameYear = rule.condition?.firstMeetsAppliesFrom === 'same_year';
    const appliesFromFy = isBase
      ? maxFy(phaseStartFy, nextFy(p.financialYear))
      : maxFy(phaseStartFy, sameYear ? p.financialYear : nextFy(p.financialYear));
    return {
      hit: { rule, spec, appliesFromFy, measuredAt: p, firstMetFy: p.financialYear },
      latest,
    };
  }
  return { hit: null, latest };
}

// ── Group (§11) ───────────────────────────────────────────────────────────────

const REL_LABEL: Record<string, string> = {
  holding: 'holding company',
  subsidiary: 'subsidiary',
  joint_venture: 'joint venture',
  associate: 'associate',
};

function groupAssessment(
  f: FinancialReportingFacts,
  rule: ResolvedRule | null,
): FrfGroupAssessment {
  const rows: FrfGroupRow[] = (f.relatedEntities ?? []).map((r) => ({
    relatedEntity: r.name,
    relationship: r.relationship,
    relatedFramework: r.framework,
    relatedFrameworkSource: r.frameworkSource,
    effect:
      r.framework === 'ind_as'
        ? GROUP_EFFECT.triggers
        : r.framework === 'accounting_standards'
          ? GROUP_EFFECT.noTrigger
          : GROUP_EFFECT.reviewRequired,
  }));
  if (!rule) {
    // No group rule in force for the period: relationships cannot trigger Ind AS.
    return {
      rows: rows.map((r) => ({ ...r, effect: GROUP_EFFECT.noTrigger })),
      result: rows.length ? GROUP_EFFECT.noTrigger : 'none',
      path: null,
      ruleCode: null,
    };
  }
  const answer = f.groupAnswer ?? (f.groupTriggersIndAs ? 'yes' : null);
  const trig = rows.find((r) => r.effect === GROUP_EFFECT.triggers);
  let result: FrfGroupAssessment['result'];
  if (answer === 'yes') result = GROUP_EFFECT.triggers;
  else if (answer === 'no') result = rows.length ? GROUP_EFFECT.noTrigger : 'none';
  else if (trig) result = GROUP_EFFECT.triggers;
  else if (rows.some((r) => r.effect === GROUP_EFFECT.reviewRequired))
    result = GROUP_EFFECT.reviewRequired;
  else result = rows.length ? GROUP_EFFECT.noTrigger : 'none';
  const path =
    result === GROUP_EFFECT.triggers
      ? trig
        ? `This company → ${REL_LABEL[trig.relationship] ?? 'group company'} ${trig.relatedEntity} (Ind AS${trig.relatedFrameworkSource ? ` — ${trig.relatedFrameworkSource}` : ''})`
        : 'This company → group company applying Ind AS (confirmed by the team)'
      : null;
  return { rows, result, path, ruleCode: rule.ruleCode };
}

// ── SMC (§4, §16) ─────────────────────────────────────────────────────────────

function smcAssessment(
  f: FinancialReportingFacts,
  resolve: RuleResolver,
  branch: EntityBranch,
): FrfSmcAssessment & { rules: ResolvedRule[] } {
  const turnRule = resolve(AREA, FRF_CRITERION.turnover, null);
  const borrowRule = resolve(AREA, FRF_CRITERION.borrowings, null);
  const conditions: FrfSmcCondition[] = [];
  const listing = listingStatusOf(f);
  conditions.push({
    key: 'listing',
    label: 'Securities not listed / in process of listing (India or outside)',
    result: listing === FRF_LISTING_STATUS.unlisted ? FRF_TEST_RESULT.met : FRF_TEST_RESULT.notMet,
    detail:
      listing === FRF_LISTING_STATUS.unlisted
        ? 'Unlisted.'
        : `${listing === 'listed' ? 'Listed' : 'In process of listing'}${f.isListedOnSmeExchange ? ' (SME exchange / ITP — still a listing)' : ''}.`,
  });
  const fin = branch === ENTITY_BRANCH.nbfc;
  conditions.push({
    key: 'entity_type',
    label: 'Not a bank, financial institution or insurance company',
    result: fin ? FRF_TEST_RESULT.notMet : FRF_TEST_RESULT.met,
    detail: fin ? 'NBFC — treated as a financial institution.' : 'Not a bank, FI or insurer.',
  });
  const limit = (
    key: 'turnover' | 'borrowings',
    label: string,
    value: number | null,
    rule: ResolvedRule | null,
  ) => {
    if (!rule || rule.threshold == null)
      conditions.push({
        key,
        label,
        result: FRF_TEST_RESULT.insufficient,
        detail: 'No SMC limit in the Rules Library for this period.',
      });
    else if (value == null)
      conditions.push({
        key,
        label,
        result: FRF_TEST_RESULT.insufficient,
        detail: 'Not captured.',
      });
    else
      conditions.push({
        key,
        label,
        result: ruleMeets(value, rule) ? FRF_TEST_RESULT.met : FRF_TEST_RESULT.notMet,
        detail: `${cr(value)} ${rule.operator} ${cr(rule.threshold)} (${rule.ruleCode})`,
      });
  };
  limit('turnover', 'Turnover of the preceding year (excl. other income)', f.turnover, turnRule);
  limit(
    'borrowings',
    'Borrowings at any time in the preceding year (incl. public deposits)',
    f.borrowings,
    borrowRule,
  );
  const hasGroup = (f.relatedEntities ?? []).some(
    (r) => r.relationship === 'holding' || r.relationship === 'subsidiary',
  );
  conditions.push({
    key: 'group',
    label: 'Not a holding or subsidiary of a non-SMC company',
    result:
      f.groupNonSmc === 'yes'
        ? FRF_TEST_RESULT.notMet
        : f.groupNonSmc === 'no' || !hasGroup
          ? FRF_TEST_RESULT.met
          : FRF_TEST_RESULT.insufficient,
    detail:
      f.groupNonSmc === 'yes'
        ? 'Holding / subsidiary of a non-SMC company.'
        : f.groupNonSmc === 'no'
          ? 'Confirmed: no holding / subsidiary is a non-SMC.'
          : hasGroup
            ? 'Holding / subsidiary relationships exist — confirm whether any is a non-SMC.'
            : 'No holding / subsidiary relationships on record.',
  });
  const status = conditions.some((c) => c.result === FRF_TEST_RESULT.notMet)
    ? SMC_STATUS.nonSmc
    : conditions.some((c) => c.result !== FRF_TEST_RESULT.met)
      ? SMC_STATUS.informationInsufficient
      : SMC_STATUS.smc;
  return {
    status,
    turnover: f.turnover,
    turnoverThreshold: turnRule?.threshold ?? null,
    borrowings: f.borrowings,
    borrowingsThreshold: borrowRule?.threshold ?? null,
    conditions,
    ruleCodes: [turnRule?.ruleCode, borrowRule?.ruleCode].filter((c): c is string => !!c),
    authorityProvisionId:
      turnRule?.authorityProvisionId ?? borrowRule?.authorityProvisionId ?? null,
    rules: [turnRule, borrowRule].filter((r): r is ResolvedRule => r != null),
  };
}

// ── The engine ────────────────────────────────────────────────────────────────

export function assessFinancialReporting(
  f: FinancialReportingFacts,
  resolve: RuleResolver,
): FinancialReportingResult {
  const periodStart = f.auditPeriodStart ?? '9999-04-01';
  const auditFy = f.auditFinancialYear ?? fyOf(periodStart);
  const missing: FrfMissingFact[] = [];
  const rulesApplied: FrfAppliedRule[] = [];
  const secondary: string[] = [];
  const { branch, route, routeType } = branchOf(f, resolve);
  const isNbfc = branch === ENTITY_BRANCH.nbfc;
  const listingStatus = listingStatusOf(f);
  const smeOrItp = listingStatus !== FRF_LISTING_STATUS.unlisted && f.isListedOnSmeExchange;

  const factsUsed: FrfFactUsed[] = [
    {
      key: 'entity_branch',
      label: 'Entity category',
      value:
        branch === ENTITY_BRANCH.ordinary
          ? `Company${f.isPrivateCompany ? ' (private)' : f.isPrivateCompany === false ? ' (public)' : ''}`
          : branch.replace(/_/g, ' '),
      source: '02.1 Cards A–B',
      anchor: FRF_ANCHOR.card('B'),
    },
    {
      key: 'listing',
      label: 'Listing status',
      value: `${listingStatus.replace(/_/g, ' ')}${(f.listingExchanges ?? []).length ? ` — ${(f.listingExchanges ?? []).map((x) => x.toUpperCase()).join(', ')}` : ''}${smeOrItp ? ' (SME / ITP)' : ''}`,
      source: '02.1 Card A / listings master',
      anchor: FRF_ANCHOR.frf04,
    },
  ];
  if (f.priorFramework)
    factsUsed.push({
      key: 'prior_framework',
      label: 'Prior-year framework',
      value: f.priorFramework.replace(/_/g, ' '),
      source: f.priorFrameworkSource ?? '02.2 FRF-01',
      anchor: FRF_ANCHOR.frf01,
    });

  // Listing / exception (§12) — evaluated for every company so the screen shows it.
  const provisoRule = smeOrItp ? exact(resolve, FRF_CRITERION.listingException, 'sme_itp') : null;
  const listing: FrfListingAssessment = {
    status: listingStatus,
    exchanges: f.listingExchanges ?? [],
    smeOrItp,
    provisoApplies: provisoRule != null,
    provisoRuleCode: provisoRule?.ruleCode ?? null,
    note: provisoRule
      ? 'SME exchange / ITP: the mandatory roadmap does not apply; voluntary adoption is still tested.'
      : smeOrItp
        ? 'SME exchange / ITP listing, but no exception is configured for this period — the roadmap applies.'
        : listingStatus === FRF_LISTING_STATUS.unlisted
          ? 'Unlisted — the unlisted net-worth route applies.'
          : 'Main-board listing / in process — the listing route applies.',
  };

  const base = {
    branch,
    isNbfc,
    listing,
    factsUsed,
    missing,
    rulesApplied,
    secondary,
  };

  // 1. Entity type (§8).
  if (f.isCompany == null) {
    missing.push({
      key: 'entity_type',
      label: 'Entity type (company / other)',
      source: '02.1 Card A',
      anchor: FRF_ANCHOR.card('A'),
    });
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      basis: 'Entity type not confirmed — confirm 02.1 before assessing the reporting framework.',
    });
  }
  if (branch === ENTITY_BRANCH.nonCompany)
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.professionalReview,
      basis:
        'Not a company under the Companies Act — determine the applicable framework professionally (e.g. AS for an LLP).',
    });
  if (
    branch === ENTITY_BRANCH.bank ||
    branch === ENTITY_BRANCH.insurance ||
    branch === ENTITY_BRANCH.otherSpecial
  ) {
    if (route) rulesApplied.push(applied(route, `Specialised route — ${routeType}`, 'triggered'));
    const outcome =
      route?.outcome === REPORTING_FRAMEWORK_OUTCOME.professionalReview
        ? REPORTING_FRAMEWORK_OUTCOME.professionalReview
        : REPORTING_FRAMEWORK_OUTCOME.specialised;
    return finish(base, {
      outcome,
      rule: route,
      primaryTrigger: `${branch.replace(/_/g, ' ')} — specialised methodology`,
      basis: route
        ? `${routeType === 'bank' ? 'Banking company' : routeType === 'insurance' ? 'Insurance company' : 'Special entity'} — routed by rule ${route.ruleCode} to the specialised methodology / regulatory assessment; the ordinary Ind AS roadmap is not applied.`
        : `${branch === ENTITY_BRANCH.bank ? 'Banking company' : 'Insurance company'} — no specialised route is configured for this period; professional review required (the ordinary roadmap is not applied).`,
    });
  }

  // 2. Prior / continuing Ind AS (§6).
  const already = alreadyIndAs(f);
  if (already === 'yes') {
    if (!f.firstIndAsFy)
      missing.push({
        key: 'first_ind_as_fy',
        label: 'First Ind AS financial year',
        source: '02.2 FRF-02',
        anchor: FRF_ANCHOR.frf02,
      });
    const firstTime = f.firstIndAsFy === auditFy;
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.indAs,
      applicabilityType: firstTime ? APPLICABILITY_TYPE.mandatory : APPLICABILITY_TYPE.continuing,
      effectiveFromFy: f.firstIndAsFy ?? null,
      firstTimeIndAs: firstTime,
      primaryTrigger: `Ind AS already applicable${f.firstIndAsFy ? ` from FY ${f.firstIndAsFy}` : ''}${f.originalTrigger ? ` (${f.originalTrigger})` : ''}`,
      basis: `Ind AS already applied / adopted in an earlier year${f.firstIndAsFy ? ` (first Ind AS FY ${f.firstIndAsFy})` : ''} — Ind AS continues to apply; current-year net worth is not re-tested.`,
      limitApplied: 'Not applicable (continuing)',
    });
  }

  // 3. Voluntary adoption (§7).
  const voluntary = voluntaryOf(f);
  if (voluntary === 'yes') {
    const vRule = exact(resolve, FRF_CRITERION.voluntary, null);
    if (!vRule)
      return finish(base, {
        outcome: REPORTING_FRAMEWORK_OUTCOME.professionalReview,
        basis:
          'Voluntary Ind AS adoption recorded, but no voluntary-adoption rule is in force for this period — professional review.',
      });
    rulesApplied.push(applied(vRule, 'Voluntary adoption — Rule 4(1)(i)', 'triggered'));
    if (!f.voluntaryFirstIndAsFy)
      missing.push({
        key: 'voluntary_first_fy',
        label: 'First Ind AS financial year (voluntary)',
        source: '02.2 FRF-03',
        anchor: FRF_ANCHOR.frf03,
      });
    const effective = f.voluntaryFirstIndAsFy ?? auditFy;
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.indAs,
      rule: vRule,
      applicabilityType:
        effective < auditFy ? APPLICABILITY_TYPE.continuing : APPLICABILITY_TYPE.voluntary,
      effectiveFromFy: effective,
      firstTimeIndAs: effective === auditFy,
      primaryTrigger: 'Voluntary adoption under Rule 4(1)(i)',
      basis: `Ind AS voluntarily adopted from FY ${effective} (rule ${vRule.ruleCode}) — Ind AS applies to this and all later periods.`,
      limitApplied: 'Not applicable (voluntary)',
    });
  }

  // 4. SME exchange / ITP exception (§12) — removes the mandatory roadmap only.
  const points = netWorthPoints(f, periodStart);
  if (provisoRule) {
    rulesApplied.push(
      applied(provisoRule, 'SME exchange / ITP exception — Rule 4 proviso', 'exception_applied'),
    );
    if (voluntary === 'pending' || voluntary == null)
      missing.push({
        key: 'voluntary',
        label: 'Voluntary adoption (FRF-03)',
        source: '02.2 FRF-03',
        anchor: FRF_ANCHOR.frf03,
      });
    if (voluntary === 'pending')
      return finish(base, {
        outcome: REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
        basis:
          'SME exchange / ITP exception applies to the mandatory roadmap; voluntary adoption is still Information Pending.',
      });
    return asOutcome(base, f, resolve, {
      rule: provisoRule,
      netWorth: nwView(points, null, null),
      basis: `SME exchange / ITP listing — the mandatory Ind AS roadmap does not apply (rule ${provisoRule.ruleCode}); not voluntarily adopted → Accounting Standards.`,
    });
  }

  // 5. Mandatory roadmap by phase (§3, §9, §13).
  const phases = isNbfc ? NBFC_PHASES : CORPORATE_PHASES;
  const listedForRoadmap = listingStatus !== FRF_LISTING_STATUS.unlisted;
  const hits: PhaseHit[] = [];
  let decisiveNw: { rule: ResolvedRule; latest: NetWorthPoint | null } | null = null;
  let nwRulesInForce = 0;
  let nwHitSeen = false;
  for (const spec of phases) {
    const rule = exact(resolve, spec.criterion, spec.entityClass);
    if (!rule) continue;
    if (spec.criterion === FRF_CRITERION.listed) {
      if (!listedForRoadmap) continue;
      const appliesFromFy = fyOf(rule.effectiveFrom);
      hits.push({ rule, spec, appliesFromFy, measuredAt: null, firstMetFy: null });
      rulesApplied.push(
        applied(rule, `${spec.label}: listed / in process of listing (any net worth)`, 'triggered'),
      );
      continue;
    }
    // A listed company's Phase II is the listing route; the unlisted net-worth rule is for unlisted.
    if (spec.entityClass.endsWith('unlisted_p2') && listedForRoadmap) continue;
    nwRulesInForce++;
    const { hit, latest } = netWorthHit(rule, spec, points);
    const label = `${spec.label}: net worth ${rule.operator} ${cr(rule.threshold)}`;
    rulesApplied.push(applied(rule, label, hit ? 'triggered' : 'not_triggered'));
    if (hit) hits.push(hit);
    // The decisive net-worth rule: the one that fired, else the last (lowest) phase tested.
    if (hit || !nwHitSeen) decisiveNw = { rule, latest };
    if (hit) nwHitSeen = true;
  }
  hits.sort((a, b) => a.appliesFromFy.localeCompare(b.appliesFromFy));
  const nwHit = hits.find((h) => h.spec.criterion === FRF_CRITERION.netWorth) ?? null;
  const netWorth = nwView(points, nwHit, decisiveNw);

  // 6. Group relationships (§11).
  const groupRule = exact(resolve, FRF_CRITERION.group, isNbfc ? 'nbfc' : 'corporate');
  const group = groupAssessment(f, groupRule);
  if (group.result === GROUP_EFFECT.triggers && groupRule) {
    rulesApplied.push(applied(groupRule, `Group relationship — ${group.path ?? ''}`, 'triggered'));
  }
  if (f.relatedEntities?.length || f.groupTriggersIndAs)
    factsUsed.push({
      key: 'group',
      label: 'Group relationships',
      value:
        (f.relatedEntities ?? [])
          .map((r) => `${r.name} (${REL_LABEL[r.relationship]}; ${r.framework.replace(/_/g, ' ')})`)
          .join('; ') || 'Group trigger confirmed by the team',
      source: '02.1 Card C / group master',
      anchor: FRF_ANCHOR.group,
    });
  if (netWorth.value != null)
    factsUsed.push({
      key: 'net_worth',
      label: 'Applicable net worth',
      value: `${cr(netWorth.value)}${netWorth.measurementDate ? ` at ${fmtDate(netWorth.measurementDate)}` : ''}`,
      source: netWorth.source ?? '02.1 Card D',
      anchor: FRF_ANCHOR.netWorth,
    });

  const applicable = hits.filter((h) => h.appliesFromFy <= auditFy);
  const due = applicable[0] ?? null;
  if (due) {
    for (const h of applicable.slice(1)) secondary.push(`${h.spec.label} (${h.rule.ruleCode})`);
    if (group.result === GROUP_EFFECT.triggers && group.path) secondary.push(group.path);
    const isListedRoute = due.spec.criterion === FRF_CRITERION.listed;
    // A listing route has no measurement date: a company that followed AS last
    // year has just listed / entered the listing process → first Ind AS year now.
    const newlyListed = isListedRoute && f.priorFramework === 'accounting_standards';
    const effectiveFy = newlyListed ? auditFy : due.appliesFromFy;
    const firstTime = effectiveFy === auditFy && f.priorFramework !== 'ind_as';
    const shouldHaveApplied =
      !newlyListed && effectiveFy < auditFy && f.priorFramework === 'accounting_standards';
    if (shouldHaveApplied)
      secondary.push(
        `Ind AS should have applied from FY ${due.appliesFromFy} but the prior year followed AS — professional review.`,
      );
    const phrase = isListedRoute
      ? `${listingStatus === 'listed' ? 'Listed' : 'In-process-of-listing'} ${isNbfc ? 'NBFC' : 'company'}; listing route ${due.spec.label}; rule ${due.rule.ruleCode} effective ${fmtDate(due.rule.effectiveFrom)}; Ind AS applicable from FY ${effectiveFy}.`
      : `${listedForRoadmap ? 'Listed' : 'Unlisted'} ${isNbfc ? 'NBFC' : 'company'}; applicable net worth ${cr(due.measuredAt?.value)}${due.measuredAt ? ` at ${fmtDate(due.measuredAt.asAt)}` : ''}; threshold ${cr(due.rule.threshold)}; rule ${due.rule.ruleCode} effective ${fmtDate(due.rule.effectiveFrom)}; Ind AS applicable from FY ${effectiveFy}.`;
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.indAs,
      rule: due.rule,
      forceReview: shouldHaveApplied,
      applicabilityType: firstTime ? APPLICABILITY_TYPE.mandatory : APPLICABILITY_TYPE.continuing,
      effectiveFromFy: effectiveFy,
      firstTimeIndAs: firstTime && !shouldHaveApplied,
      primaryTrigger: isListedRoute
        ? `${listingStatus === 'listed' ? 'Listed' : 'In process of listing'} — ${due.spec.label}`
        : `Net worth ${cr(due.measuredAt?.value)} ${due.rule.operator} ${cr(due.rule.threshold)} — ${due.spec.label}`,
      limitApplied: isListedRoute ? 'Not applicable (listing route)' : cr(due.rule.threshold),
      indAsThreshold: isListedRoute ? null : due.rule.threshold,
      netWorth,
      group,
      basis: phrase,
    });
  }
  for (const h of hits)
    secondary.push(
      `Threshold met (${h.rule.ruleCode}) — Ind AS applies from FY ${h.appliesFromFy}, not this year.`,
    );

  if (group.result === GROUP_EFFECT.triggers && groupRule) {
    const firstTime = f.priorFramework !== 'ind_as';
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.indAs,
      rule: groupRule,
      applicabilityType: firstTime ? APPLICABILITY_TYPE.mandatory : APPLICABILITY_TYPE.continuing,
      effectiveFromFy: firstTime ? auditFy : null,
      firstTimeIndAs: firstTime,
      primaryTrigger: group.path ?? 'Group company applying Ind AS',
      limitApplied: 'Not applicable (group route)',
      netWorth,
      group,
      basis: `Below the direct thresholds, but ${group.path ?? 'a group company applies Ind AS'} — Ind AS applies through the group rule ${groupRule.ruleCode} (${isNbfc ? 'NBFC group provisions' : 'corporate roadmap'}).`,
    });
  }

  // Not triggered: decide whether that is a determination or missing information.
  if (nwRulesInForce === 0 && !hits.length)
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      netWorth,
      group,
      basis: `No Ind AS ${isNbfc ? 'NBFC ' : ''}roadmap rule is in force in the Rules Library for FY ${auditFy} — Information Insufficient.`,
      forceReview: true,
    });
  if (netWorth.result === FRF_TEST_RESULT.insufficient) {
    missing.push({
      key: 'net_worth',
      label: 'Net worth (audited standalone, preceding year end)',
      source: '02.1 Card D',
      anchor: FRF_ANCHOR.card('D'),
    });
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      netWorth,
      group,
      basis: 'Net worth not captured — needed to test the Ind AS net-worth roadmap.',
    });
  }
  if (group.result === GROUP_EFFECT.reviewRequired) {
    missing.push({
      key: 'group',
      label: 'Framework of related group companies (review required)',
      source: '02.2 group test',
      anchor: FRF_ANCHOR.group,
    });
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      netWorth,
      group,
      basis:
        'Below the direct thresholds, but the framework of one or more group companies is unknown — confirm the group test.',
    });
  }
  if (voluntary === 'pending') {
    missing.push({
      key: 'voluntary',
      label: 'Voluntary adoption (FRF-03)',
      source: '02.2 FRF-03',
      anchor: FRF_ANCHOR.frf03,
    });
    return finish(base, {
      outcome: REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      netWorth,
      group,
      basis: 'Mandatory roadmap not triggered; voluntary adoption is Information Pending.',
    });
  }
  const nwRule = decisiveNw?.rule ?? null;
  return asOutcome(base, f, resolve, {
    rule: nwRule,
    netWorth,
    group,
    basis: `Accounting Standards apply — ${listedForRoadmap ? 'listed' : 'unlisted'} ${isNbfc ? 'NBFC' : 'company'}; applicable net worth ${cr(netWorth.value)}${netWorth.measurementDate ? ` at ${fmtDate(netWorth.measurementDate)}` : ''} below the configured threshold ${cr(nwRule?.threshold)}${nwRule ? ` (rule ${nwRule.ruleCode} effective ${fmtDate(nwRule.effectiveFrom)})` : ''}; no group trigger.`,
  });
}

// ── Assembly helpers ──────────────────────────────────────────────────────────

interface Base {
  branch: EntityBranch;
  isNbfc: boolean;
  listing: FrfListingAssessment;
  factsUsed: FrfFactUsed[];
  missing: FrfMissingFact[];
  rulesApplied: FrfAppliedRule[];
  secondary: string[];
}

function nwView(
  points: NetWorthPoint[],
  hit: PhaseHit | null,
  decisive: { rule: ResolvedRule; latest: NetWorthPoint | null } | null,
): FrfNetWorthAssessment {
  const shown = hit?.measuredAt ?? decisive?.latest ?? points[points.length - 1] ?? null;
  const rule = hit?.rule ?? decisive?.rule ?? null;
  const result: FrfTestResult = hit
    ? FRF_TEST_RESULT.met
    : !rule
      ? FRF_TEST_RESULT.notApplicable
      : shown
        ? FRF_TEST_RESULT.notMet
        : FRF_TEST_RESULT.insufficient;
  const base = rule?.condition?.measurementBaseDate;
  return {
    value: shown?.value ?? null,
    measurementDate: shown?.asAt ?? null,
    source: shown?.source ?? null,
    sourceDocumentId: shown?.sourceDocumentId ?? null,
    sourceUrl: shown?.sourceUrl ?? null,
    threshold: rule?.threshold ?? null,
    ruleCode: rule?.ruleCode ?? null,
    result,
    firstMetFy: hit?.firstMetFy ?? null,
    appliesFromFy: hit?.appliesFromFy ?? null,
    note: base
      ? `Measured on standalone audited financial statements from ${fmtDate(String(base))}; a company first meeting the threshold at a year end applies Ind AS from the next year.`
      : null,
  };
}

function asOutcome(
  base: Base,
  f: FinancialReportingFacts,
  resolve: RuleResolver,
  o: {
    rule: ResolvedRule | null;
    netWorth: FrfNetWorthAssessment;
    group?: FrfGroupAssessment;
    basis: string;
  },
): FinancialReportingResult {
  const { rules: smcRules, ...smc } = smcAssessment(f, resolve, base.branch);
  for (const r of smcRules)
    base.rulesApplied.push({
      ...applied(r, `SMC limit — ${r.criterion} ${r.operator} ${cr(r.threshold)}`, 'triggered'),
      operator: r.operator,
      threshold: r.threshold,
    });
  if (f.turnover != null)
    base.factsUsed.push({
      key: 'turnover',
      label: 'Turnover (preceding year)',
      value: cr(f.turnover),
      source: '02.1 Card D',
      anchor: FRF_ANCHOR.card('D'),
    });
  if (f.borrowings != null)
    base.factsUsed.push({
      key: 'borrowings',
      label: 'Borrowings (preceding year)',
      value: cr(f.borrowings),
      source: '02.1 Card D / 02.2 SMC',
      anchor: FRF_ANCHOR.smc,
    });
  return finish(base, {
    outcome: REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
    rule: o.rule,
    netWorth: o.netWorth,
    group: o.group,
    smc,
    limitApplied: o.rule?.threshold != null ? cr(o.rule.threshold) : 'Not applicable',
    indAsThreshold: o.rule?.threshold ?? null,
    primaryTrigger: 'Ind AS roadmap not triggered',
    basis: `${o.basis} SMC status: ${smc.status.replace(/_/g, ' ')}.`,
  });
}

function finish(
  base: Base,
  o: {
    outcome: ReportingFrameworkOutcome;
    basis: string;
    rule?: ResolvedRule | null;
    applicabilityType?: ApplicabilityType | null;
    effectiveFromFy?: string | null;
    firstTimeIndAs?: boolean;
    primaryTrigger?: string | null;
    limitApplied?: string | null;
    indAsThreshold?: number | null;
    netWorth?: FrfNetWorthAssessment | null;
    group?: FrfGroupAssessment | null;
    smc?: FrfSmcAssessment | null;
    forceReview?: boolean;
  },
): FinancialReportingResult {
  const missingBlocks =
    base.missing.length > 0 && o.outcome === REPORTING_FRAMEWORK_OUTCOME.informationInsufficient;
  const confidence: FrfConfidence =
    o.outcome === REPORTING_FRAMEWORK_OUTCOME.informationInsufficient
      ? missingBlocks
        ? FRF_CONFIDENCE.informationPending
        : FRF_CONFIDENCE.professionalReview
      : o.outcome === REPORTING_FRAMEWORK_OUTCOME.professionalReview ||
          o.outcome === REPORTING_FRAMEWORK_OUTCOME.specialised ||
          o.forceReview
        ? FRF_CONFIDENCE.professionalReview
        : base.missing.length
          ? FRF_CONFIDENCE.informationPending
          : FRF_CONFIDENCE.determined;
  const state: FrameworkState =
    confidence === FRF_CONFIDENCE.determined
      ? 'system_suggested_applicable'
      : confidence === FRF_CONFIDENCE.informationPending &&
          o.outcome === REPORTING_FRAMEWORK_OUTCOME.informationInsufficient
        ? 'pending_information'
        : confidence === FRF_CONFIDENCE.informationPending
          ? 'system_suggested_applicable'
          : 'professional_judgement_required';
  const smc = o.smc ?? null;
  const detail: FinancialReportingDetail = {
    smcStatus: smc?.status ?? SMC_STATUS.notApplicable,
    firstTimeIndAs: o.firstTimeIndAs ?? false,
    indAsThreshold: o.indAsThreshold ?? null,
    isNbfc: base.isNbfc,
    applicabilityType:
      o.outcome === REPORTING_FRAMEWORK_OUTCOME.indAs ? (o.applicabilityType ?? null) : null,
    effectiveFromFy:
      o.outcome === REPORTING_FRAMEWORK_OUTCOME.indAs ? (o.effectiveFromFy ?? null) : null,
    primaryTrigger: o.primaryTrigger ?? null,
    secondaryTriggers: base.secondary,
    entityBranch: base.branch,
    confidence,
    rulesApplied: base.rulesApplied,
    limitApplied: o.limitApplied ?? 'Not applicable',
    factsUsed: base.factsUsed,
    missingFacts: base.missing,
    netWorth: o.netWorth ?? null,
    listing: base.listing,
    group: o.group ?? null,
    smc,
    blockingReview:
      o.outcome === REPORTING_FRAMEWORK_OUTCOME.specialised ||
      o.outcome === REPORTING_FRAMEWORK_OUTCOME.professionalReview ||
      (o.outcome === REPORTING_FRAMEWORK_OUTCOME.informationInsufficient && !missingBlocks),
  };
  return {
    outcome: o.outcome,
    state,
    basis: o.basis,
    ruleVersionId: o.rule?.ruleVersionId ?? null,
    authorityProvisionId: o.rule?.authorityProvisionId ?? null,
    detail,
  };
}
