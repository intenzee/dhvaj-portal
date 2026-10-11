import {
  AUDIT_TRAIL_CONCLUSION,
  EMPTY_OTHER_REPORTING_CAPTURED,
  EMPTY_RULE11E,
  FRAMEWORK_AREA_KEY,
  FRAUD_ROUTE,
  MANAGERIAL_CATEGORY,
  MANAGERIAL_CATEGORY_LABEL,
  OTHER_REPORTING_OUTCOME,
  OTHER_REPORTING_REFERENCE_ANCHOR as ANCHOR,
  OTHER_REPORTING_RULE_CODE,
  REMUNERATION_OUTCOME,
  REPORTING_APPLICABILITY as APPL,
  REPORTING_APPLICABILITY_LABEL,
  REPORTING_CARD as CARD,
  REPORTING_CARD_GROUP as GROUP,
  REPORTING_STATUS as RS,
  REPORTING_WORK_CONFIGURED as WC,
  REPORTING_WORK_STATUS,
  RULE_CRITERION,
  formatInrCrore,
  type AuditTrailConclusion,
  type AuditTrailSystemResult,
  type FraudResult,
  type FrameworkState,
  type ManagerialPersonInput,
  type OtherReportingBaseFacts,
  type OtherReportingCapturedFacts,
  type OtherReportingDetail,
  type OtherReportingMissingFact,
  type OtherReportingResult,
  type OtherReportingRuleUsed,
  type RemunerationCategoryTest,
  type RemunerationResult,
  type ReportingApplicability,
  type ReportingCard,
  type ReportingCardGroup,
  type ReportingCardKey,
  type ReportingCardState,
  type ReportingMatter,
  type ReportingStatus,
  type ReportingWorkConfigured,
  type ResolvedRule,
  type Rule11eAssessment,
  type Rule11efResult,
  type Rule11gResult,
  type RuleResolver,
  type ScheduleVBand,
  type ScheduleVResult,
  type SoftwareSystemInput,
} from '@hsdg/contracts';

/**
 * 02.7 Other Companies Act & Statutory Reporting — pure engine (DHVAJ 02.7
 * spec v1.0, Track A). A statutory reporting CONFIGURATOR (spec §22): it turns
 * the captured facts, the 02.1 / 02.4 / 02.5 / 02.6 inputs and Track B's
 * records (fraud matters, director workpaper, evidence) into one requirement
 * card per obligation — applicability, where the work lives, the expected
 * reporting wording and the exceptions — plus the Rule 11(g) register result,
 * the §197(16) category tests and the Schedule V band. It never reaches the
 * audit conclusions themselves (those are completed later on each card).
 *
 * Every %, ₹ threshold, day count, retention period and effective date
 * resolves from the Audit Rules Library (`resolve`) — no statutory number in
 * code. Unit-tests without a database.
 */

const AREA_143 = FRAMEWORK_AREA_KEY.section143;
const AREA_11 = FRAMEWORK_AREA_KEY.rule11;
const C = RULE_CRITERION;

const APPOINTMENT_RULES = new Set<string>([
  OTHER_REPORTING_RULE_CODE.managerialTermMaxYears,
  OTHER_REPORTING_RULE_CODE.managerialMinAge,
  OTHER_REPORTING_RULE_CODE.managerialAgeSrTrigger,
]);
const EXECUTIVE = new Set<string>([
  MANAGERIAL_CATEGORY.managingDirector,
  MANAGERIAL_CATEGORY.wholeTimeDirector,
  MANAGERIAL_CATEGORY.manager,
]);

/** Default per-card work state (the service overlays the stored one). */
export const DEFAULT_CARD_STATE: ReportingCardState = {
  workStatus: REPORTING_WORK_STATUS.notStarted,
  reportingStatus: null,
  proposedConclusion: null,
  exceptions: 0,
  exceptionNote: null,
  sourceWorkpaper: null,
  reviewedByName: null,
  reviewedAt: null,
  version: 0,
};

// ── Fact normalisation (older rows carry only the legacy fields) ─────────────

/** The Rule 11(e) assessments, seeded from the legacy flags when never captured. */
function rule11eOf(
  a: Partial<Rule11eAssessment> | undefined,
  moved: boolean,
  repsObtained: boolean,
): Rule11eAssessment {
  if (a && Object.keys(a).length > 0) return { ...EMPTY_RULE11E, ...a };
  if (!moved && !repsObtained) return { ...EMPTY_RULE11E };
  return {
    ...EMPTY_RULE11E,
    transactionsIdentified: moved ? 'yes' : 'pending',
    representationObtained: repsObtained ? 'yes' : 'pending',
  };
}

/** Normalise a software row to the full spec §11 register shape. */
export function normaliseSystem(s: SoftwareSystemInput, i: number): Required<SoftwareSystemInput> {
  const featureStatus = s.featureStatus ?? (s.hasAuditTrailFeature ? 'available' : 'not_available');
  const enabledThroughout =
    s.enabledThroughout ?? (s.auditTrailOperatedAllYear ? 'yes' : 'pending');
  return {
    id: s.id ?? `sys-${i + 1}`,
    name: s.name,
    hasAuditTrailFeature: featureStatus === 'available',
    auditTrailOperatedAllYear: enabledThroughout === 'yes',
    module: s.module ?? 'gl',
    moduleOther: s.moduleOther ?? null,
    booksAffected: s.booksAffected ?? null,
    featureStatus,
    enabledThroughout,
    enabledNote: s.enabledNote ?? null,
    transactionsCovered: s.transactionsCovered ?? 'pending',
    privilegedUsers: s.privilegedUsers ?? null,
    canAlterOrDisable: s.canAlterOrDisable ?? 'pending',
    tampering: s.tampering ?? 'pending',
    preservation: s.preservation ?? 'pending',
    evidence: s.evidence ?? null,
    conclusion: s.conclusion ?? AUDIT_TRAIL_CONCLUSION.pending,
    icfrCrossRef: s.icfrCrossRef ?? null,
    booksCrossRef: s.booksCrossRef ?? false,
  };
}

/**
 * Merge stored (possibly partial / legacy) facts over the blank shape, deriving
 * the structured Rule 11 facts from the legacy booleans when never captured.
 */
export function normaliseCaptured(
  facts: Partial<OtherReportingCapturedFacts> | null | undefined,
): OtherReportingCapturedFacts {
  const f = facts ?? {};
  const base = EMPTY_OTHER_REPORTING_CAPTURED;
  const litigation = { ...base.litigation, ...(f.litigation ?? {}) };
  if (!f.litigation && f.pendingLitigationDisclosed != null) {
    litigation.identified = 'yes';
    litigation.disclosure = f.pendingLitigationDisclosed ? 'disclosed' : 'not_disclosed';
  }
  const foreseeableLosses = { ...base.foreseeableLosses, ...(f.foreseeableLosses ?? {}) };
  if (!f.foreseeableLosses && f.foreseeableLossesProvided != null) {
    foreseeableLosses.hasLongTermContracts = 'yes';
    foreseeableLosses.provisionAdequate = f.foreseeableLossesProvided ? 'yes' : 'no';
  }
  const iepf = { ...base.iepf, ...(f.iepf ?? {}) };
  if (!f.iepf && f.iepfTransferDelay != null)
    iepf.status = f.iepfTransferDelay ? 'delay' : 'no_delay';
  const dividend = { ...base.dividend, ...(f.dividend ?? {}) };
  if (!f.dividend && f.dividendCompliesSec123 != null) {
    dividend.declaredOrPaid = true;
    dividend.section123Compliant = f.dividendCompliesSec123 ? 'yes' : 'no';
  }
  const repsObtained = f.fundingRepresentationsObtained ?? false;
  return {
    ...base,
    ...f,
    softwareSystems: (f.softwareSystems ?? []).map((s, i) => ({
      ...s,
      id: s.id ?? `sys-${i + 1}`,
    })),
    managerialPersons: (f.managerialPersons ?? []).map((p, i) => ({
      ...p,
      id: p.id ?? `mp-${i + 1}`,
    })),
    approvals: { ...base.approvals, ...(f.approvals ?? {}) },
    rule11eAdvanced: rule11eOf(f.rule11eAdvanced, !!f.intermediaryFundsAdvanced, repsObtained),
    rule11eReceived: rule11eOf(
      f.rule11eReceived,
      !!f.ultimateBeneficiaryFundsReceived,
      repsObtained,
    ),
    litigation,
    foreseeableLosses,
    iepf,
    dividend,
    applicabilityOverrides: { ...(f.applicabilityOverrides ?? {}) },
  };
}

// ── Rule 11(g) audit trail (spec §11) ───────────────────────────────────────

function systemResult(raw: SoftwareSystemInput, i: number): AuditTrailSystemResult {
  const s = normaliseSystem(raw, i);
  const exceptions: string[] = [];
  if (s.featureStatus === 'not_available') exceptions.push('No audit-trail (edit-log) feature');
  if (s.enabledThroughout === 'no') exceptions.push('Audit trail not enabled throughout the year');
  if (s.enabledThroughout === 'exceptions')
    exceptions.push(
      `Audit trail disabled for part of the year${s.enabledNote ? ` — ${s.enabledNote}` : ''}`,
    );
  if (s.transactionsCovered === 'gaps') exceptions.push('Not all transactions are covered');
  if (s.canAlterOrDisable === 'yes')
    exceptions.push('Privileged users can alter or disable the audit trail');
  if (s.tampering === 'yes') exceptions.push('Tampering with the audit trail identified');
  if (s.preservation === 'exception') exceptions.push('Audit trail not preserved as required');

  const pendingFields: string[] = [];
  if (s.featureStatus === 'pending') pendingFields.push('audit-trail feature');
  if (s.enabledThroughout === 'pending') pendingFields.push('enabled throughout the period');
  if (s.transactionsCovered === 'pending') pendingFields.push('transactions covered');
  if (s.canAlterOrDisable === 'pending') pendingFields.push('privileged access');
  if (s.tampering === 'pending') pendingFields.push('tampering');
  if (s.preservation === 'pending') pendingFields.push('preservation');

  const suggestedConclusion: AuditTrailConclusion =
    exceptions.length > 0
      ? AUDIT_TRAIL_CONCLUSION.modifiedExpected
      : pendingFields.length > 0
        ? AUDIT_TRAIL_CONCLUSION.furtherWork
        : AUDIT_TRAIL_CONCLUSION.compliant;
  const conclusion =
    s.conclusion !== AUDIT_TRAIL_CONCLUSION.pending ? s.conclusion : suggestedConclusion;
  return {
    id: s.id,
    name: s.name,
    module: s.module,
    suggestedConclusion,
    conclusion,
    exceptions,
    pendingFields,
    adequate: s.featureStatus === 'available' && s.enabledThroughout === 'yes',
    basis:
      exceptions.length > 0
        ? `${exceptions.join('; ')} — modified Rule 11(g) reporting expected.`
        : pendingFields.length > 0
          ? `Further work: ${pendingFields.join(', ')}.`
          : 'Audit-trail feature operated throughout the year for all transactions, with no tampering, and is preserved.',
  };
}

function rule11g(f: OtherReportingBaseFacts, resolve: RuleResolver): Rule11gResult {
  const eff = resolve(AREA_11, C.auditTrailEffective);
  const inForce = eff != null || f.auditTrailInForce;
  const effectiveFrom = eff?.effectiveFrom ?? f.auditTrailEffectiveFrom ?? null;
  if (!inForce)
    return {
      applicable: false,
      effectiveFrom: null,
      systems: [],
      retentionYears: null,
      allAdequate: true,
      basis:
        'Rule 11(g) audit-trail reporting is not in force for this audit period — the historical Rule 11 version (clauses (a)–(f)) applies.',
    };
  const retentionYears = resolve(AREA_11, C.retentionYears)?.threshold ?? null;
  const systems = f.softwareSystems.map(systemResult);
  const allAdequate =
    systems.length > 0 && systems.every((s) => s.conclusion === AUDIT_TRAIL_CONCLUSION.compliant);
  return {
    applicable: true,
    effectiveFrom,
    systems,
    retentionYears,
    allAdequate,
    basis:
      systems.length === 0
        ? `Rule 11(g) applies (FY commencing on/after ${effectiveFrom ?? '—'}) — register each accounting software / module to assess its audit trail.`
        : `Rule 11(g) applies — ${systems.length} system(s) on the register; preservation baseline ${retentionYears ?? '—'} financial years (Section 128(5), rule data).`,
  };
}

// ── Section 197(16) managerial remuneration (spec §13) ──────────────────────

function sum(xs: Array<number | null | undefined>): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length === xs.length && v.length > 0 ? v.reduce((a, b) => a + b, 0) : null;
}

function scheduleVBandsOf(rule: ResolvedRule | null): ScheduleVBand[] {
  if (!rule) return [];
  const cond = (rule.condition ?? {}) as {
    excess_percent?: number;
    doubled_by_special_resolution?: boolean;
  };
  return [...rule.bands]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b) => ({
      id: b.id,
      version: rule.version,
      effectiveFrom: rule.effectiveFrom,
      capitalFrom: b.lower,
      capitalTo: b.upper,
      annualCeiling: b.ceilingValue ?? 0,
      excessPercent: b.upper == null ? (cond.excess_percent ?? null) : null,
      doubledBySpecialResolution: cond.doubled_by_special_resolution === true,
      label: b.label ?? '',
    }));
}

function scheduleV(
  f: OtherReportingBaseFacts,
  resolve: RuleResolver,
  triggered: boolean,
  reason: string | null,
  executives: ManagerialPersonInput[],
): ScheduleVResult {
  const resolved = scheduleVBandsOf(resolve(AREA_143, C.scheduleVCeiling));
  const bands = resolved.length > 0 ? resolved : f.scheduleVBands;
  const ec = f.effectiveCapital;
  if (!triggered)
    return {
      triggered: false,
      reason: null,
      effectiveCapital: ec,
      bands,
      band: null,
      ceiling: null,
      doubled: false,
      exceeding: [],
      basis: 'Schedule V not triggered — the ordinary Section 197 limits apply.',
    };
  if (bands.length === 0)
    return {
      triggered: true,
      reason,
      effectiveCapital: ec,
      bands,
      band: null,
      ceiling: null,
      doubled: false,
      exceeding: [],
      basis: `${reason} — the Schedule V band table is not configured in the Rules Library for this period.`,
    };
  if (ec == null)
    return {
      triggered: true,
      reason,
      effectiveCapital: null,
      bands,
      band: null,
      ceiling: null,
      doubled: false,
      exceeding: [],
      basis: `${reason} — capture the effective capital to select the Schedule V band.`,
    };
  const band =
    bands.find(
      (b) =>
        (b.capitalFrom == null || ec >= b.capitalFrom) && (b.capitalTo == null || ec < b.capitalTo),
    ) ?? null;
  let ceiling: number | null = null;
  let doubled = false;
  if (band) {
    ceiling = band.annualCeiling;
    if (band.excessPercent != null && band.capitalFrom != null && ec > band.capitalFrom)
      ceiling += ((ec - band.capitalFrom) * band.excessPercent) / 100;
    doubled = band.doubledBySpecialResolution && f.approvals.scheduleVSpecialResolution;
    if (doubled) ceiling *= 2;
  }
  const exceeding =
    ceiling == null
      ? []
      : executives
          .filter((p) => p.remuneration != null && p.remuneration > ceiling!)
          .map((p) => p.name);
  return {
    triggered: true,
    reason,
    effectiveCapital: ec,
    bands,
    band,
    ceiling,
    doubled,
    exceeding,
    basis: band
      ? `${reason} — effective capital ${formatInrCrore(ec)} falls in "${band.label}" (Schedule V v${band.version} from ${band.effectiveFrom}): ceiling ${formatInrCrore(ceiling!)} per managerial person per annum${doubled ? ' (doubled — special resolution)' : ''}${exceeding.length ? `; exceeded by ${exceeding.join(', ')}` : '; no managerial person exceeds it'}.`
      : `${reason} — no Schedule V band matches effective capital ${formatInrCrore(ec)}.`,
  };
}

/**
 * Section 196 appointment checks for each MD / WTD / Manager (spec §2 —
 * "only where relevant to the remuneration / appointment workpaper"): term
 * not above the Rules Library maximum, age not below the minimum, and an
 * appointment at/above the special-resolution age carries one. Only recorded
 * facts are tested — a blank age or term raises nothing.
 */
export function appointmentFlags(
  persons: ManagerialPersonInput[],
  resolve: RuleResolver,
): string[] {
  const maxTerm = resolve(AREA_143, C.managerialTermMaxYears)?.threshold ?? null;
  const minAge = resolve(AREA_143, C.managerialMinAge)?.threshold ?? null;
  const srAge = resolve(AREA_143, C.managerialAgeSrTrigger)?.threshold ?? null;
  const flags: string[] = [];
  for (const p of persons) {
    if (!EXECUTIVE.has(p.category)) continue;
    const who = p.name || MANAGERIAL_CATEGORY_LABEL[p.category];
    if (maxTerm != null && p.termYears != null && p.termYears > maxTerm)
      flags.push(
        `${who}: appointed for ${p.termYears} years — Section 196(2) allows at most ${maxTerm} years at a time.`,
      );
    if (minAge != null && p.age != null && p.age < minAge)
      flags.push(`${who}: age ${p.age} is below the Section 196(3)(a) minimum of ${minAge}.`);
    if (srAge != null && p.age != null && p.age >= srAge && !p.ageSpecialResolution)
      flags.push(
        `${who}: age ${p.age} (${srAge} or above) — Section 196(3)(a) requires a special resolution; none recorded.`,
      );
  }
  return flags;
}

function remuneration(f: OtherReportingBaseFacts, resolve: RuleResolver): RemunerationResult {
  return {
    ...remunerationLimits(f, resolve),
    appointmentFlags: appointmentFlags(f.managerialPersons, resolve),
  };
}

function remunerationLimits(
  f: OtherReportingBaseFacts,
  resolve: RuleResolver,
): Omit<RemunerationResult, 'appointmentFlags'> {
  const persons = f.managerialPersons;
  const executives = persons.filter((p) => EXECUTIVE.has(p.category));
  const nonExec = persons.filter((p) => p.category === MANAGERIAL_CATEGORY.nonExecutiveDirector);
  const hasMgmt = executives.length > 0 || f.hasManagingOrWholeTimeDirector;
  const paidTotal =
    persons.length > 0 ? sum(persons.map((p) => p.remuneration)) : f.managerialRemunerationPaid;
  const np = f.section198NetProfit;

  const overallRule = resolve(AREA_143, C.managerialRemunerationPercent);
  const limitPercent = overallRule?.threshold ?? null;
  const notTriggered = scheduleV(f, resolve, false, null, executives);

  if (f.isPublicCompany !== true)
    return {
      applicable: false,
      outcome:
        f.isPublicCompany == null && f.isCompany !== false
          ? REMUNERATION_OUTCOME.informationInsufficient
          : REMUNERATION_OUTCOME.notApplicable,
      limitPercent,
      section198NetProfit: np,
      permittedAmount: null,
      paidAmount: paidTotal,
      scheduleVRoute: false,
      categories: [],
      scheduleV: notTriggered,
      basis:
        f.isPublicCompany == null && f.isCompany !== false
          ? 'REM-01: confirm in 02.1 whether the company is a public company — Section 197(16) reporting applies to public companies.'
          : 'REM-01: not a public company — Section 197(16) reporting does not apply (ICAI advisory: public companies only).',
    };

  const pct = (rule: ResolvedRule | null) => rule?.threshold ?? null;
  const ap = f.approvals;
  const test = (
    key: RemunerationCategoryTest['key'],
    label: string,
    ruleCode: string,
    rule: ResolvedRule | null,
    applicable: boolean,
    paid: number | null,
    approved: boolean,
  ): RemunerationCategoryTest => {
    const limit = pct(rule);
    if (!applicable)
      return {
        key,
        label,
        ruleCode,
        applicable: false,
        limitPercent: limit,
        permittedAmount: null,
        paidAmount: null,
        paidPercent: null,
        within: null,
        approvalRoute: false,
        basis: "Not relevant to this company's managerial structure.",
      };
    if (limit == null || np == null || np <= 0 || paid == null)
      return {
        key,
        label,
        ruleCode,
        applicable: true,
        limitPercent: limit,
        permittedAmount: null,
        paidAmount: paid,
        paidPercent: null,
        within: null,
        approvalRoute: false,
        basis:
          limit == null
            ? `Rules Library value ${ruleCode} is missing for the audit period.`
            : np == null
              ? 'Capture the Section 198 net profit.'
              : np <= 0
                ? 'No Section 198 profit — Schedule V governs instead of the ratio.'
                : 'Capture the remuneration paid in this category.',
      };
    const permitted = (np * limit) / 100;
    const within = paid <= permitted;
    return {
      key,
      label,
      ruleCode,
      applicable: true,
      limitPercent: limit,
      permittedAmount: permitted,
      paidAmount: paid,
      paidPercent: (paid / np) * 100,
      within,
      approvalRoute: !within && approved,
      basis: `${formatInrCrore(paid)} vs ${limit}% of Section 198 net profit (${formatInrCrore(permitted)}) — ${within ? 'within the limit' : approved ? 'exceeds the ordinary limit; special-resolution approval recorded' : 'exceeds the ordinary limit with no approval recorded'}.`,
    };
  };

  const R = OTHER_REPORTING_RULE_CODE;
  const categories: RemunerationCategoryTest[] = [
    test(
      'overall',
      'Overall managerial remuneration',
      R.overallLimit,
      overallRule,
      true,
      paidTotal,
      ap.overallSpecialResolution,
    ),
    test(
      'one_executive',
      'One MD / WTD / Manager',
      R.oneExecutive,
      resolve(AREA_143, C.remunerationOneExecutivePercent),
      executives.length === 1,
      executives.length === 1 ? (executives[0]!.remuneration ?? null) : null,
      ap.executiveSpecialResolution,
    ),
    test(
      'multiple_executives',
      'More than one MD / WTD / Manager (aggregate)',
      R.multipleExecutives,
      resolve(AREA_143, C.remunerationMultiExecutivePercent),
      executives.length > 1,
      executives.length > 1 ? sum(executives.map((p) => p.remuneration)) : null,
      ap.executiveSpecialResolution,
    ),
    test(
      'non_exec_with_mgmt',
      'Directors neither MD nor WTD — company has an MD / WTD / Manager',
      R.nonExecWithMgmt,
      resolve(AREA_143, C.remunerationNonExecWithMgmtPercent),
      nonExec.length > 0 && hasMgmt,
      nonExec.length > 0 && hasMgmt ? sum(nonExec.map((p) => p.remuneration)) : null,
      ap.nonExecutiveSpecialResolution,
    ),
    test(
      'non_exec_without_mgmt',
      'Directors neither MD nor WTD — any other case',
      R.nonExecWithoutMgmt,
      resolve(AREA_143, C.remunerationNonExecWithoutMgmtPercent),
      nonExec.length > 0 && !hasMgmt,
      nonExec.length > 0 && !hasMgmt ? sum(nonExec.map((p) => p.remuneration)) : null,
      ap.nonExecutiveSpecialResolution,
    ),
  ];

  const base = {
    applicable: true,
    limitPercent,
    section198NetProfit: np,
    paidAmount: paidTotal,
    categories,
  };
  if (np == null || paidTotal == null)
    return {
      ...base,
      outcome: REMUNERATION_OUTCOME.informationInsufficient,
      permittedAmount: null,
      scheduleVRoute: false,
      scheduleV: notTriggered,
      basis:
        'Section 197(16) applies — capture the Section 198 net profit (not PBT / PAT) and the remuneration by managerial person.',
    };

  const reason =
    np <= 0
      ? 'No Section 198 profit'
      : f.inadequateProfits
        ? 'Inadequate Section 198 profit (recorded by the team)'
        : null;
  const sv = scheduleV(f, resolve, reason != null, reason, executives);
  const permittedAmount = limitPercent != null && np > 0 ? (np * limitPercent) / 100 : null;
  if (sv.triggered)
    return {
      ...base,
      outcome:
        sv.ceiling == null
          ? REMUNERATION_OUTCOME.informationInsufficient
          : REMUNERATION_OUTCOME.scheduleVRoute,
      permittedAmount,
      scheduleVRoute: true,
      scheduleV: sv,
      basis: sv.basis,
    };

  const breached = categories.filter((t) => t.applicable && t.within === false && !t.approvalRoute);
  const unknown = categories.some((t) => t.applicable && t.within == null);
  return {
    ...base,
    outcome: breached.length
      ? REMUNERATION_OUTCOME.exceedsLimit
      : unknown
        ? REMUNERATION_OUTCOME.informationInsufficient
        : REMUNERATION_OUTCOME.withinLimit,
    permittedAmount,
    scheduleVRoute: false,
    scheduleV: sv,
    basis: breached.length
      ? `Exceeds without an approval route: ${breached.map((t) => `${t.label} (${t.limitPercent}%)`).join('; ')}.`
      : unknown
        ? 'Section 197(16): complete the remuneration of every relevant category.'
        : `Within the Section 197 limits for every relevant category on Section 198 net profit of ${formatInrCrore(np)}.`,
  };
}

// ── Section 143(12) summary (records are Track B's) ─────────────────────────

function addDaysUtc(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fraud(f: OtherReportingBaseFacts, resolve: RuleResolver): FraudResult {
  const s = f.fraud;
  const thresholdAmount =
    s.thresholdAmount ?? resolve(AREA_143, C.fraudReportingThreshold)?.threshold ?? null;
  if (s.matters > 0)
    return {
      identified: true,
      route:
        s.centralGovernmentRoute > 0
          ? FRAUD_ROUTE.centralGovernment
          : FRAUD_ROUTE.auditCommitteeBoard,
      thresholdAmount,
      amount: null,
      boardReplyByDate: null,
      cgForwardByDate: null,
      formReference: s.centralGovernmentRoute > 0 ? 'ADT-4' : null,
      basis: `${s.matters} fraud matter(s) on the register (${s.centralGovernmentRoute} Central Government route, ${s.belowThreshold} below the threshold)${s.overdue ? `; ${s.overdue} overdue deadline(s)` : ''}${s.nextDeadline ? `; next deadline ${s.nextDeadline}` : ''}.`,
    };
  if (!f.fraudIdentified)
    return {
      identified: false,
      route: FRAUD_ROUTE.none,
      thresholdAmount,
      amount: null,
      boardReplyByDate: null,
      cgForwardByDate: null,
      formReference: null,
      basis: `No fraud matter recorded — the Section 143(12) framework is available (threshold ${thresholdAmount != null ? formatInrCrore(thresholdAmount) : '—'}).`,
    };
  // Legacy single-fraud facts (before the Fraud Matter register): the route and
  // indicative Rule 13 dates from the event date (day counts are rule data).
  const cg = f.fraudAmount != null && thresholdAmount != null && f.fraudAmount >= thresholdAmount;
  const replyDays = resolve(AREA_143, C.boardReplyDays)?.threshold ?? null;
  const cgDays = resolve(AREA_143, C.cgForwardDays)?.threshold ?? null;
  const boardReplyByDate =
    f.fraudEventDate && replyDays != null ? addDaysUtc(f.fraudEventDate, replyDays) : null;
  return {
    identified: true,
    route: cg ? FRAUD_ROUTE.centralGovernment : FRAUD_ROUTE.auditCommitteeBoard,
    thresholdAmount,
    amount: f.fraudAmount,
    boardReplyByDate,
    cgForwardByDate:
      cg && boardReplyByDate && cgDays != null ? addDaysUtc(boardReplyByDate, cgDays) : null,
    formReference: cg ? 'ADT-4' : null,
    basis: `Fraud ${f.fraudAmount != null ? formatInrCrore(f.fraudAmount) : 'amount not captured'} vs the ${thresholdAmount != null ? formatInrCrore(thresholdAmount) : '—'} threshold — ${cg ? 'Central Government route (ADT-4)' : 'Audit Committee / Board route'}. Record it on the Fraud Matter register to run the Rule 13 deadlines.`,
  };
}

function rule11ef(f: OtherReportingBaseFacts): Rule11efResult {
  const a = f.rule11eAdvanced;
  const r = f.rule11eReceived;
  const moved = a.transactionsIdentified === 'yes' || r.transactionsIdentified === 'yes';
  const reps = a.representationObtained === 'yes' && r.representationObtained === 'yes';
  const contrary = a.contraryMatter === 'yes' || r.contraryMatter === 'yes';
  const satisfied = reps && !contrary;
  return {
    intermediaryFundsAdvanced: a.transactionsIdentified === 'yes',
    ultimateBeneficiaryFundsReceived: r.transactionsIdentified === 'yes',
    representationsObtained: reps,
    satisfied,
    basis: contrary
      ? 'Rule 11(e): a contrary matter was noticed — modified reporting expected.'
      : !reps
        ? 'Rule 11(e): both management representations (funds advanced / funds received) are required.'
        : moved
          ? 'Rule 11(e): representations obtained; transactions identified are covered by audit procedures.'
          : 'Rule 11(e): representations obtained; nothing contrary noticed.',
  };
}

// ── Requirement cards (spec §4, §5, §16, §17) ───────────────────────────────

interface CardDraft {
  key: ReportingCardKey;
  group: ReportingCardGroup;
  requirement: string;
  clause: string;
  applicability: ReportingApplicability;
  applicabilityBasis: string;
  applicabilitySource: string;
  workSource: string;
  workConfigured: ReportingWorkConfigured;
  finalStage: string;
  systemExceptions: string[];
  systemReportingStatus: ReportingStatus;
  anchors: string[];
}

const NA = new Set<string>([APPL.notApplicable, APPL.notApplicableToFacts]);

/** Reporting status from a Yes/No/Pending exception fact. */
function triStatus(exception: boolean, pending: boolean): ReportingStatus {
  return exception ? RS.modifiedExpected : pending ? RS.notDetermined : RS.unmodifiedExpected;
}

function buildCards(
  f: OtherReportingBaseFacts,
  g: Rule11gResult,
  rem: RemunerationResult,
  fr: FraudResult,
): CardDraft[] {
  const x = f.crossRefs;
  const d = f.directors;
  const s143 = (
    key: ReportingCardKey,
    clause: string,
    requirement: string,
    rest: Partial<CardDraft>,
  ): CardDraft => ({
    key,
    group: GROUP.section143,
    requirement,
    clause,
    applicability: APPL.applicable,
    applicabilityBasis: 'Applies to every company audit.',
    applicabilitySource: '02.7',
    workSource: 'Completion',
    workConfigured: WC.yes,
    finalStage: 'Completion / Reporting',
    systemExceptions: [],
    systemReportingStatus: RS.notDetermined,
    anchors: [ANCHOR.section143_3],
    ...rest,
  });

  const branchesKnown = x.group.branchesExist;
  const branchAuditors = x.group.branchAuditors;
  const trailBooks = g.systems.filter(
    (s) => s.conclusion === AUDIT_TRAIL_CONCLUSION.modifiedExpected,
  );

  const cards: CardDraft[] = [
    s143(CARD.s143Information, 'Section 143(3)(a)', 'Information and explanations', {
      workSource: 'Audit-wide / completion',
      systemExceptions:
        f.informationObtained === 'no' ? ['Information / explanations not obtained'] : [],
      systemReportingStatus: triStatus(
        f.informationObtained === 'no',
        f.informationObtained === 'pending',
      ),
    }),
    s143(CARD.s143Books, 'Section 143(3)(b)', 'Proper books of account', {
      workSource: 'Books / accounting records assessment',
      applicabilityBasis: trailBooks.length
        ? `Applies to every company audit. Cross-reference: ${trailBooks.length} audit-trail exception(s) under Rule 11(g) — consider proper-books reporting; the conclusions stay separate.`
        : 'Applies to every company audit.',
      systemExceptions: f.booksProper === 'no' ? ['Proper books of account not kept'] : [],
      systemReportingStatus: triStatus(f.booksProper === 'no', f.booksProper === 'pending'),
    }),
    s143(CARD.s143BranchReturns, 'Section 143(3)(b)', 'Proper returns from branches not visited', {
      applicability:
        branchesKnown == null
          ? APPL.pending
          : branchesKnown
            ? APPL.applicable
            : APPL.notApplicableToFacts,
      applicabilityBasis:
        branchesKnown == null
          ? 'Conditional — 02.6 BR-01 has not answered whether the company has branches.'
          : branchesKnown
            ? 'The company has branches (02.6 BR-01) — report on proper returns from branches not visited.'
            : 'No branches (02.6 BR-01).',
      applicabilitySource: '02.6',
      workSource: '02.6 / branch work',
      workConfigured: WC.conditional,
      systemExceptions:
        x.group.branchReturnsReceived === false
          ? ['Proper returns not received from branches not visited']
          : [],
      systemReportingStatus: triStatus(
        x.group.branchReturnsReceived === false,
        x.group.branchReturnsReceived == null,
      ),
      anchors: [ANCHOR.section143_3, ANCHOR.section143_8],
    }),
    s143(CARD.s143BranchReport, 'Section 143(3)(c)', 'Branch auditor report dealt with', {
      applicability:
        branchesKnown == null && branchAuditors === 0
          ? APPL.pending
          : branchAuditors > 0
            ? APPL.applicable
            : APPL.notApplicableToFacts,
      applicabilityBasis:
        branchAuditors > 0
          ? `${branchAuditors} branch auditor(s) on the 02.6 register — state how each branch auditor's report was dealt with.`
          : branchesKnown == null
            ? 'Conditional — 02.6 has not recorded branches or branch auditors.'
            : 'No branch audited by another auditor (02.6).',
      applicabilitySource: '02.6',
      workSource: '02.6',
      workConfigured: WC.conditional,
      systemReportingStatus:
        branchAuditors > 0 && x.group.branchReportsPending === 0
          ? RS.unmodifiedExpected
          : RS.notDetermined,
      anchors: [ANCHOR.section143_3, ANCHOR.section143_8],
    }),
    s143(
      CARD.s143Agreement,
      'Section 143(3)(d)',
      'Financial statements agree with books / returns',
      {
        workSource: 'Completion / FS tie-out',
      },
    ),
    s143(CARD.s143Standards, 'Section 143(3)(e)', 'Compliance with Accounting Standards', {
      workSource: '02.2 + FS review',
    }),
    s143(
      CARD.s143Adverse,
      'Section 143(3)(f)',
      'Observations / comments adversely affecting functioning',
      {
        workSource: 'Completion / significant matters',
        systemExceptions: f.adverseObservations === 'yes' ? ['Adverse observations to report'] : [],
        systemReportingStatus: triStatus(
          f.adverseObservations === 'yes',
          f.adverseObservations === 'pending',
        ),
      },
    ),
    s143(CARD.s143Directors, 'Section 143(3)(g)', 'Director disqualification u/s 164(2)', {
      applicabilityBasis: `Applies where relevant — ${d.total} director(s) on the 02.7 director workpaper.`,
      workSource: 'Director workpaper (Section 164(2))',
      systemExceptions:
        d.disqualified > 0 ? [`${d.disqualified} director(s) disqualified u/s 164(2)`] : [],
      systemReportingStatus:
        d.conclusion === 'identified'
          ? RS.modifiedExpected
          : d.conclusion === 'none_found'
            ? RS.unmodifiedExpected
            : RS.notDetermined,
      anchors: [ANCHOR.section143_3, ANCHOR.section164_2],
    }),
    s143(
      CARD.s143AccountsQualification,
      'Section 143(3)(h)',
      'Qualification / reservation on maintenance of accounts',
      {
        workSource: 'Books / accounting records assessment',
        systemExceptions:
          f.accountsQualification === 'yes'
            ? ['Qualification relating to maintenance of accounts']
            : [],
        systemReportingStatus: triStatus(
          f.accountsQualification === 'yes',
          f.accountsQualification === 'pending',
        ),
      },
    ),
    s143(CARD.s143Icfr, 'Section 143(3)(i)', 'Internal financial controls (ICFR)', {
      applicability: x.icfr.reportingRequired === false ? APPL.notApplicable : APPL.crossReference,
      applicabilityBasis:
        x.icfr.reportingRequired === false
          ? `02.5 concluded ICFR reporting is not required${x.icfr.conclusion ? ` (${x.icfr.conclusion})` : ''}.`
          : `Concluded in 02.5${x.icfr.conclusion ? ` (${x.icfr.conclusion})` : ' — pending'}; 02.7 cross-references it only.`,
      applicabilitySource: '02.5',
      workSource: 'Cross-reference only',
      workConfigured: WC.crossReference,
      finalStage: '02.5 / Section 08',
      systemReportingStatus:
        x.icfr.reportingRequired === false ? RS.notApplicable : RS.crossReference,
    }),
    s143(CARD.s143Other, 'Section 143(3)(j)', 'Other prescribed matters (Rule 11)', {
      applicabilityBasis: 'Reported through the Rule 11 matters below.',
      workSource: 'Rule 11 engine (this section)',
      systemReportingStatus: RS.crossReference,
      anchors: [ANCHOR.section143_3, ANCHOR.rule11],
    }),
  ];

  // ── Rule 11 (spec §6–§11)
  const rule11 = (
    key: ReportingCardKey,
    clause: string,
    requirement: string,
    rest: Partial<CardDraft>,
  ): CardDraft => ({
    key,
    group: GROUP.rule11,
    requirement,
    clause,
    applicability: APPL.applicable,
    applicabilityBasis: 'Rule 11 matter in force for the audit period.',
    applicabilitySource: '02.7',
    workSource: 'This section',
    workConfigured: WC.yes,
    finalStage: 'Completion / Reporting',
    systemExceptions: [],
    systemReportingStatus: RS.notDetermined,
    anchors: [ANCHOR.rule11],
    ...rest,
  });

  const lit = f.litigation;
  const litEx: string[] = [];
  if (lit.disclosure === 'not_disclosed') litEx.push('Impact of pending litigations not disclosed');
  if (lit.disclosure === 'partially_disclosed')
    litEx.push('Impact of pending litigations partially disclosed');
  if ((lit.exceptions ?? 0) > 0) litEx.push(`${lit.exceptions} litigation exception(s)`);
  const fl = f.foreseeableLosses;
  const flYes = fl.hasLongTermContracts === 'yes' || fl.hasDerivativeContracts === 'yes';
  const flNo = fl.hasLongTermContracts === 'no' && fl.hasDerivativeContracts === 'no';
  const iepf = f.iepf;
  const dv = f.dividend;
  const e11 = (a: Rule11eAssessment, label: string) => {
    const ex: string[] = [];
    if (a.representationObtained === 'no')
      ex.push(`${label}: management representation not obtained`);
    if (a.contraryMatter === 'yes' || a.conclusion === 'exception')
      ex.push(`${label}: contrary matter noticed${a.contraryNote ? ` — ${a.contraryNote}` : ''}`);
    return ex;
  };
  const eA = e11(f.rule11eAdvanced, 'Funds advanced');
  const eR = e11(f.rule11eReceived, 'Funds received');
  const trailEx = g.systems.filter((s) => s.conclusion === AUDIT_TRAIL_CONCLUSION.modifiedExpected);

  cards.push(
    rule11(CARD.r11Litigation, 'Rule 11(a)', 'Pending litigations — impact disclosed', {
      applicabilityBasis:
        lit.identified === 'yes'
          ? `R11-01: ${lit.totalMatters ?? '—'} matter(s) on the litigation work, ${lit.materialMatters ?? '—'} material / relevant.`
          : lit.identified === 'no'
            ? 'R11-01: no pending litigations identified — report accordingly.'
            : 'R11-01: confirm from the legal / litigation work whether pending litigations exist.',
      workSource: lit.sourceWorkpaper ?? 'Legal / litigation register',
      systemExceptions: litEx,
      systemReportingStatus:
        lit.identified === 'pending'
          ? RS.notDetermined
          : litEx.length
            ? RS.modifiedExpected
            : lit.identified === 'no' || lit.disclosure === 'disclosed'
              ? RS.unmodifiedExpected
              : RS.notDetermined,
    }),
    rule11(
      CARD.r11Losses,
      'Rule 11(b)',
      'Material foreseeable losses on long-term / derivative contracts',
      {
        applicability: flYes ? APPL.applicable : flNo ? APPL.notApplicableToFacts : APPL.pending,
        applicabilityBasis: flYes
          ? 'R11-02: long-term (incl. derivative) contracts exist — assess provision for material foreseeable losses.'
          : flNo
            ? 'R11-02: no long-term or derivative contracts — Not Applicable to Facts.'
            : 'R11-02: confirm whether long-term contracts, including derivative contracts, exist.',
        workSource: fl.linkedWorkpapers.length
          ? fl.linkedWorkpapers.join('; ')
          : 'Provisions / estimates work',
        workConfigured: WC.conditional,
        systemExceptions:
          flYes && fl.provisionAdequate === 'no'
            ? ['Provision for material foreseeable losses not made']
            : [],
        systemReportingStatus: flNo
          ? RS.notApplicable
          : flYes
            ? triStatus(fl.provisionAdequate === 'no', fl.provisionAdequate === 'pending')
            : RS.notDetermined,
      },
    ),
    rule11(CARD.r11Iepf, 'Rule 11(c)', 'Transfers to the Investor Education and Protection Fund', {
      applicability:
        iepf.status === 'pending'
          ? APPL.pending
          : iepf.status === 'not_applicable'
            ? APPL.notApplicableToFacts
            : APPL.applicable,
      applicabilityBasis:
        iepf.status === 'delay'
          ? `R11-03: delay identified${iepf.delayAmount != null ? ` — ${formatInrCrore(iepf.delayAmount)}` : ''}${iepf.delayPeriod ? ` for ${iepf.delayPeriod}` : ''}.`
          : iepf.status === 'no_delay'
            ? 'R11-03: no delay in transferring amounts required to be transferred.'
            : iepf.status === 'not_applicable'
              ? 'R11-03: no amounts required to be transferred to IEPF.'
              : 'R11-03: assess required transfers and delays from the dividend / unpaid-dividend work.',
      workSource: iepf.sourceWorkpaper ?? 'Dividend / unpaid-dividend / IEPF work',
      workConfigured: WC.conditional,
      systemExceptions: iepf.status === 'delay' ? ['Delay in transfer to IEPF'] : [],
      systemReportingStatus:
        iepf.status === 'delay'
          ? RS.modifiedExpected
          : iepf.status === 'no_delay'
            ? RS.unmodifiedExpected
            : iepf.status === 'not_applicable'
              ? RS.notApplicable
              : RS.notDetermined,
      anchors: [ANCHOR.rule11, ANCHOR.iepf],
    }),
    rule11(
      CARD.r11eAdvanced,
      'Rule 11(e)(i)',
      'Funds advanced / loaned / invested through intermediaries',
      {
        applicabilityBasis:
          'Mirrored assessment linked to the Section 07 Management Representation Letter. No monetary exemption threshold applies.',
        workSource: 'Management representation + audit procedures',
        workConfigured: WC.yes,
        finalStage: 'Completion / MRL / Reporting',
        systemExceptions: eA,
        systemReportingStatus: eA.length
          ? RS.modifiedExpected
          : f.rule11eAdvanced.conclusion === 'no_exception'
            ? RS.unmodifiedExpected
            : RS.notDetermined,
        anchors: [ANCHOR.rule11, ANCHOR.rule11efGuidance],
      },
    ),
    rule11(CARD.r11eReceived, 'Rule 11(e)(ii)', 'Funds received from funding parties', {
      applicabilityBasis:
        'Mirrored assessment linked to the Section 07 Management Representation Letter. No monetary exemption threshold applies.',
      workSource: 'Management representation + audit procedures',
      workConfigured: WC.yes,
      finalStage: 'Completion / MRL / Reporting',
      systemExceptions: eR,
      systemReportingStatus: eR.length
        ? RS.modifiedExpected
        : f.rule11eReceived.conclusion === 'no_exception'
          ? RS.unmodifiedExpected
          : RS.notDetermined,
      anchors: [ANCHOR.rule11, ANCHOR.rule11efGuidance],
    }),
    rule11(CARD.r11fDividend, 'Rule 11(f)', 'Dividend declared / paid — Section 123 compliance', {
      applicability:
        dv.declaredOrPaid == null
          ? APPL.pending
          : dv.declaredOrPaid
            ? APPL.applicable
            : APPL.notApplicableToFacts,
      applicabilityBasis:
        dv.declaredOrPaid == null
          ? 'R11-04: was dividend declared or paid during the year?'
          : dv.declaredOrPaid
            ? `R11-04: dividend declared / paid${dv.kind ? ` (${dv.kind})` : ''} — assess Section 123 compliance.`
            : 'R11-04: no dividend declared or paid — Not Applicable to Facts.',
      workSource: dv.sourceWorkpaper ?? 'Dividend work',
      workConfigured: WC.conditional,
      systemExceptions:
        dv.declaredOrPaid && dv.section123Compliant === 'no'
          ? ['Dividend not compliant with Section 123']
          : [],
      systemReportingStatus:
        dv.declaredOrPaid === false
          ? RS.notApplicable
          : dv.declaredOrPaid
            ? triStatus(dv.section123Compliant === 'no', dv.section123Compliant === 'pending')
            : RS.notDetermined,
      anchors: [ANCHOR.rule11, ANCHOR.section123, ANCHOR.rule11efGuidance],
    }),
    rule11(CARD.r11gAuditTrail, 'Rule 11(g)', 'Accounting software audit trail', {
      applicability: !g.applicable
        ? APPL.notApplicable
        : g.systems.length === 0
          ? APPL.pending
          : APPL.applicable,
      applicabilityBasis: g.basis,
      workSource: 'Audit-trail system register',
      workConfigured: WC.conditional,
      finalStage: 'Reporting',
      systemExceptions: trailEx.map((s) => `${s.name}: ${s.exceptions.join('; ')}`),
      systemReportingStatus: !g.applicable
        ? RS.notApplicable
        : trailEx.length
          ? RS.modifiedExpected
          : g.systems.length > 0 && g.allAdequate
            ? RS.unmodifiedExpected
            : RS.notDetermined,
      anchors: [ANCHOR.rule11g, ANCHOR.rule11gGuidance, ANCHOR.section128_5],
    }),
  );

  // ── §197(16), §143(12), branch, CARO (spec §13–§17)
  const remEx: string[] = [];
  if (rem.outcome === REMUNERATION_OUTCOME.exceedsLimit) remEx.push(rem.basis);
  if (rem.scheduleV.exceeding.length)
    remEx.push(`Above the Schedule V ceiling: ${rem.scheduleV.exceeding.join(', ')}`);
  cards.push(
    {
      key: CARD.s197Remuneration,
      group: GROUP.remuneration,
      requirement: 'Managerial remuneration in accordance with Section 197',
      clause: 'Section 197(16)',
      applicability:
        f.isPublicCompany === true
          ? APPL.applicable
          : f.isPublicCompany == null && f.isCompany !== false
            ? APPL.pending
            : APPL.notApplicable,
      applicabilityBasis: `${rem.basis}${f.publicCompanySource ? ` (public company: ${f.publicCompanySource})` : ''}`,
      applicabilitySource: 'Public company route (02.1)',
      workSource: 'Remuneration workpaper',
      workConfigured: WC.conditional,
      finalStage: 'Reporting',
      systemExceptions: remEx,
      systemReportingStatus:
        f.isPublicCompany !== true
          ? RS.notApplicable
          : remEx.length
            ? RS.modifiedExpected
            : rem.outcome === REMUNERATION_OUTCOME.withinLimit ||
                (rem.outcome === REMUNERATION_OUTCOME.scheduleVRoute &&
                  rem.scheduleV.ceiling != null)
              ? RS.unmodifiedExpected
              : RS.notDetermined,
      anchors: [
        ANCHOR.section197_16,
        ANCHOR.section197,
        ANCHOR.section198,
        ANCHOR.scheduleV,
        ANCHOR.icai197Advisory,
        ANCHOR.section196,
      ],
    },
    {
      key: CARD.s143_12Fraud,
      group: GROUP.fraud,
      requirement: 'Fraud reporting framework',
      clause: 'Section 143(12) / Rule 13',
      applicability: APPL.applicable,
      applicabilityBasis: fr.basis,
      applicabilitySource: 'Event driven',
      workSource: 'Fraud Matter register',
      workConfigured: WC.alwaysAvailable,
      finalStage: 'Immediate / event-driven',
      systemExceptions:
        f.fraud.overdue > 0 ? [`${f.fraud.overdue} Rule 13 deadline(s) overdue`] : [],
      systemReportingStatus: fr.identified ? RS.modifiedExpected : RS.unmodifiedExpected,
      anchors: [ANCHOR.section143_12, ANCHOR.rule13, ANCHOR.formAdt4],
    },
    {
      key: CARD.branchReporting,
      group: GROUP.crossReference,
      requirement: 'Branch reporting (branch audit)',
      clause: 'Section 143(8)',
      applicability:
        branchAuditors > 0 || branchesKnown === true
          ? APPL.applicable
          : branchesKnown === false
            ? APPL.notApplicableToFacts
            : APPL.pending,
      applicabilityBasis:
        branchAuditors > 0
          ? `${branchAuditors} branch auditor(s); ${x.group.branchReportsDealt} report(s) dealt with, ${x.group.branchReportsPending} pending (02.6 — no second register).`
          : branchesKnown === true
            ? 'Branches exist (02.6 BR-01); no branch auditor recorded.'
            : branchesKnown === false
              ? 'No branches (02.6 BR-01).'
              : 'Conditional on 02.6 BR-01.',
      applicabilitySource: '02.6',
      workSource: '02.6 branch auditor records',
      workConfigured: WC.conditional,
      finalStage: 'Reporting',
      systemExceptions: [],
      systemReportingStatus: RS.crossReference,
      anchors: [ANCHOR.section143_8],
    },
    {
      key: CARD.caro,
      group: GROUP.crossReference,
      requirement: "Companies (Auditor's Report) Order, 2020",
      clause: 'Section 143(11) — CARO 2020',
      applicability: x.caro.applicable === false ? APPL.notApplicable : APPL.crossReference,
      applicabilityBasis:
        x.caro.applicable === false
          ? `02.4 concluded CARO does not apply${x.caro.conclusion ? ` (${x.caro.conclusion})` : ''}.`
          : `Concluded in 02.4${x.caro.conclusion ? ` (${x.caro.conclusion})` : ' — pending'}${x.caro.reportableClauses ? `; ${x.caro.reportableClauses} reportable clause(s)` : ''}.`,
      applicabilitySource: '02.4',
      workSource: '02.4 CARO clause programme',
      workConfigured: WC.crossReference,
      finalStage: 'Section 08',
      systemExceptions: [],
      systemReportingStatus: x.caro.applicable === false ? RS.notApplicable : RS.crossReference,
      anchors: [],
    },
  );

  return cards;
}

/** Apply the team's applicability overrides over the system cards. */
function applyOverrides(f: OtherReportingBaseFacts, cards: CardDraft[]): CardDraft[] {
  return cards.map((c) => {
    const o = f.applicabilityOverrides[c.key];
    if (!o) return c;
    return {
      ...c,
      applicability: o.applicability,
      applicabilityBasis: `Team override: ${o.reason} (system: ${REPORTING_APPLICABILITY_LABEL[c.applicability]} — ${c.applicabilityBasis})`,
      workConfigured: NA.has(o.applicability) ? WC.no : c.workConfigured,
      systemReportingStatus: NA.has(o.applicability) ? RS.notApplicable : c.systemReportingStatus,
    };
  });
}

/**
 * Whether a team applicability override removes a statutory obligation the
 * system found (applicable / conditional / cross-reference → not applicable) —
 * a significant override that routes to the Engagement Partner (spec §20).
 */
export function significantOverrides(
  f: Pick<OtherReportingCapturedFacts, 'applicabilityOverrides'>,
  systemCards: Array<Pick<ReportingCard, 'key' | 'requirement' | 'applicability'>>,
): string[] {
  const out: string[] = [];
  for (const c of systemCards) {
    const o = f.applicabilityOverrides[c.key];
    if (o && NA.has(o.applicability) && !NA.has(c.applicability)) out.push(c.requirement);
  }
  return out;
}

// ── Aggregate ───────────────────────────────────────────────────────────────

function ruleUsed(
  code: string,
  label: string,
  unit: string,
  r: ResolvedRule | null,
): OtherReportingRuleUsed {
  return {
    code,
    label,
    value: r?.threshold ?? null,
    unit,
    effectiveFrom: r?.effectiveFrom ?? null,
    ruleVersionId: r?.ruleVersionId ?? null,
  };
}

/** Every Rules Library value 02.7 shows (spec §2, §19, §20 "shown from Rules Library"). */
export function otherReportingRulesUsed(resolve: RuleResolver): OtherReportingRuleUsed[] {
  const R = OTHER_REPORTING_RULE_CODE;
  const eff = resolve(AREA_11, C.auditTrailEffective);
  return [
    ruleUsed(
      R.overallLimit,
      'Overall managerial remuneration',
      '% of Section 198 net profit',
      resolve(AREA_143, C.managerialRemunerationPercent),
    ),
    ruleUsed(
      R.oneExecutive,
      'One MD / WTD / Manager',
      '%',
      resolve(AREA_143, C.remunerationOneExecutivePercent),
    ),
    ruleUsed(
      R.multipleExecutives,
      'More than one MD / WTD / Manager',
      '% aggregate',
      resolve(AREA_143, C.remunerationMultiExecutivePercent),
    ),
    ruleUsed(
      R.nonExecWithMgmt,
      'Non-executive directors (company has MD / WTD / Manager)',
      '% aggregate',
      resolve(AREA_143, C.remunerationNonExecWithMgmtPercent),
    ),
    ruleUsed(
      R.nonExecWithoutMgmt,
      'Non-executive directors (any other case)',
      '% aggregate',
      resolve(AREA_143, C.remunerationNonExecWithoutMgmtPercent),
    ),
    ruleUsed(
      R.managerialTermMaxYears,
      'MD / WTD / Manager — maximum term (Section 196(2))',
      'years',
      resolve(AREA_143, C.managerialTermMaxYears),
    ),
    ruleUsed(
      R.managerialMinAge,
      'MD / WTD / Manager — minimum age (Section 196(3))',
      'years',
      resolve(AREA_143, C.managerialMinAge),
    ),
    ruleUsed(
      R.managerialAgeSrTrigger,
      'MD / WTD / Manager — special resolution from age',
      'years',
      resolve(AREA_143, C.managerialAgeSrTrigger),
    ),
    ruleUsed(
      R.fraudThreshold,
      'Fraud — Central Government route',
      '₹ (>= routes to CG)',
      resolve(AREA_143, C.fraudReportingThreshold),
    ),
    ruleUsed(
      R.fraudInitialNoticeDays,
      'Fraud — initial report to Board / AC',
      'days maximum',
      resolve(AREA_143, C.fraudInitialNoticeDays),
    ),
    ruleUsed(
      R.fraudResponseDays,
      'Fraud — Board / AC reply window',
      'days',
      resolve(AREA_143, C.boardReplyDays),
    ),
    ruleUsed(
      R.fraudForwardDays,
      'Fraud — forward to the CG after reply',
      'days',
      resolve(AREA_143, C.cgForwardDays),
    ),
    {
      code: R.auditTrailEffective,
      label: 'Rule 11(g) audit-trail reporting from',
      value: null,
      unit: eff ? `FY commencing on/after ${eff.effectiveFrom}` : 'not in force for this period',
      effectiveFrom: eff?.effectiveFrom ?? null,
      ruleVersionId: eff?.ruleVersionId ?? null,
    },
    ruleUsed(
      R.booksRetention,
      'Books / audit-trail preservation',
      'financial years baseline',
      resolve(AREA_11, C.retentionYears),
    ),
  ];
}

/** Aggregate the reporting matrix and derive the top-level outcome. */
export function assessOtherReporting(
  facts: OtherReportingBaseFacts,
  resolve: RuleResolver,
): OtherReportingResult {
  const f: OtherReportingBaseFacts = { ...facts, ...normaliseCaptured(facts) };
  const g = rule11g(f, resolve);
  const rem = remuneration(f, resolve);
  const fr = fraud(f, resolve);
  const ef = rule11ef(f);
  const notCompany = f.isCompany === false;
  const systemCards = buildCards(f, g, rem, fr);
  const removedObligations = notCompany ? [] : significantOverrides(f, systemCards);
  const drafts = applyOverrides(f, systemCards).map((c) =>
    notCompany
      ? {
          ...c,
          applicability: APPL.notApplicable,
          applicabilityBasis: 'Not a company — Companies Act auditor reporting does not apply.',
          applicabilitySource: '02.1',
          workConfigured: WC.no,
          systemExceptions: [],
          systemReportingStatus: RS.notApplicable,
        }
      : c,
  );

  const cards: ReportingCard[] = drafts.map((c) => ({
    ...c,
    evidenceCount: f.evidenceCounts[c.key] ?? 0,
    state: DEFAULT_CARD_STATE,
  }));

  const missingFacts: OtherReportingMissingFact[] = [];
  const miss = (key: string, label: string, blocking: boolean, cardKey?: ReportingCardKey) =>
    missingFacts.push({ key, label, blocking, cardKey });
  if (f.isCompany == null) miss('entity_type', 'Entity type (company or not) — 02.1', true);
  for (const c of cards) {
    if (c.applicability !== APPL.pending) continue;
    // Branch facts belong to 02.6 — shown, but they do not block 02.7.
    const blocking =
      c.key !== CARD.s143BranchReturns &&
      c.key !== CARD.s143BranchReport &&
      c.key !== CARD.branchReporting;
    miss(c.key, `${c.clause} — ${c.requirement}`, blocking, c.key);
  }
  if (rem.applicable && rem.outcome === REMUNERATION_OUTCOME.informationInsufficient)
    miss(
      'remuneration_facts',
      'Section 197(16) — Section 198 net profit / remuneration / effective capital',
      false,
      CARD.s197Remuneration,
    );
  const rules = otherReportingRulesUsed(resolve);
  for (const r of notCompany ? [] : rules)
    if (r.code !== OTHER_REPORTING_RULE_CODE.auditTrailEffective && r.value == null)
      miss(
        `rule_${r.code}`,
        `Rules Library value ${r.code} missing for the audit period`,
        // The Section 196 appointment checks are advisory — never block on them.
        !APPOINTMENT_RULES.has(r.code),
      );

  const matters: ReportingMatter[] = [];
  for (const c of cards)
    for (const e of c.systemExceptions)
      matters.push({
        code: c.key,
        cardKey: c.key,
        severity:
          c.key === CARD.s143_12Fraud ||
          c.key === CARD.s197Remuneration ||
          c.key === CARD.s143Directors
            ? 'high'
            : 'medium',
        message: `${c.clause}: ${e}`,
      });
  if (!notCompany)
    for (const flag of rem.appointmentFlags)
      matters.push({
        code: 'section_196_appointment',
        cardKey: CARD.s197Remuneration,
        severity: 'medium',
        message: `Section 196: ${flag}`,
      });
  if (fr.identified && !f.fraud.overdue && !notCompany)
    matters.push({
      code: 'section_143_12_fraud',
      cardKey: CARD.s143_12Fraud,
      severity: fr.route === FRAUD_ROUTE.centralGovernment ? 'high' : 'medium',
      message:
        fr.route === FRAUD_ROUTE.centralGovernment
          ? 'Reportable fraud at/above the threshold — Central Government route (ADT-4).'
          : 'Reportable fraud below the threshold — Audit Committee / Board route.',
    });

  const blocking = missingFacts.filter((m) => m.blocking);
  const outcome = blocking.length
    ? OTHER_REPORTING_OUTCOME.informationInsufficient
    : matters.length
      ? OTHER_REPORTING_OUTCOME.attentionRequired
      : OTHER_REPORTING_OUTCOME.configured;
  const state: FrameworkState = blocking.length
    ? 'pending_information'
    : 'system_suggested_applicable';
  const applicable = cards.filter((c) => !NA.has(c.applicability)).length;
  const basis = notCompany
    ? 'Not a company — Companies Act auditor reporting (Section 143(3), Rule 11, Section 197(16), Section 143(12)) does not apply.'
    : outcome === OTHER_REPORTING_OUTCOME.informationInsufficient
      ? `Pending facts: ${blocking.map((m) => m.label).join('; ')}.`
      : outcome === OTHER_REPORTING_OUTCOME.attentionRequired
        ? `Reporting matrix configured — ${applicable} obligation(s) identified; ${matters.length} matter(s) need attention.`
        : `Reporting matrix configured — ${applicable} obligation(s) identified with their work configured; no exceptions so far.`;

  const detail: OtherReportingDetail = {
    cards,
    rule11g: g,
    remuneration: rem,
    fraud: fr,
    rule11ef: ef,
    dividendCompliesSec123:
      f.dividend.section123Compliant === 'pending'
        ? null
        : f.dividend.section123Compliant === 'yes',
    pendingLitigationDisclosed:
      f.litigation.disclosure === 'pending' ? null : f.litigation.disclosure === 'disclosed',
    foreseeableLossesProvided:
      f.foreseeableLosses.provisionAdequate === 'pending'
        ? null
        : f.foreseeableLosses.provisionAdequate === 'yes',
    iepfTransferDelay:
      f.iepf.status === 'pending' || f.iepf.status === 'not_applicable'
        ? null
        : f.iepf.status === 'delay',
    matters,
    missingFacts,
    rulesUsed: rules,
    rule11Version: f.rule11Version,
    removedObligations,
  };
  return { outcome, state, basis, ruleVersionId: null, authorityProvisionId: null, detail };
}
