import {
  CARO_ANSWER,
  CARO_CONDITION,
  CARO_CONDITION_RESULT,
  CARO_CONTEXT_STATUS,
  CARO_ENTITY_ROUTE,
  CARO_OUTCOME,
  CARO_PROFESSIONAL_ACTION,
  type CaroCompletion,
  type CaroCompletionItem,
  type CaroConditionKey,
  type CaroContextStatus,
  type CaroDetail,
  type CaroOutcome,
  type CaroProfessionalAction,
  type FrameworkConclusion,
  type FrameworkState,
} from '@hsdg/contracts';

/**
 * 02.4 completion rules (spec §19), the CARO-06 partner-approval trigger, the
 * re-evaluation rule map (spec §2) and the Phase-02 mirror — pure, so the
 * service, downstream readers and unit tests share one definition.
 */

const DECISIVE = new Set<string>([CARO_OUTCOME.applicable, CARO_OUTCOME.notApplicableExempt]);

/** Fallback rule IDs when a frozen detail did not reach the private-company test. */
const RULE_ID: Record<CaroConditionKey, string> = {
  public_group: 'CARO_PVT_PUBLIC_GROUP',
  capital_reserves: 'CARO_PVT_CAPITAL_RESERVES',
  borrowings: 'CARO_PVT_BORROWINGS',
  revenue: 'CARO_PVT_REVENUE',
};

const FACT_RULES: Record<string, Array<CaroConditionKey | string>> = {
  company_type: ['Entity route', 'CARO-04', 'CARO-05', ...Object.values(CARO_CONDITION)],
  banking: ['CARO-01'],
  insurance: ['CARO-02'],
  section_8: ['CARO-03'],
  opc: ['CARO-04'],
  small_company: ['CARO-05'],
  public_group: [CARO_CONDITION.publicGroup],
  paid_up_capital: [CARO_CONDITION.capitalReserves],
  reserves_and_surplus: [CARO_CONDITION.capitalReserves],
  capital_plus_reserves: [CARO_CONDITION.capitalReserves],
  peak_borrowings: [CARO_CONDITION.borrowings],
  revenue_from_operations: [CARO_CONDITION.revenue],
  other_income: [CARO_CONDITION.revenue],
  discontinued_revenue: [CARO_CONDITION.revenue],
  total_revenue: [CARO_CONDITION.revenue],
  cfs_in_scope: ['Consolidated context (clause 3(xxi))'],
};

/** The rule IDs / tests a changed source fact feeds (Needs Re-evaluation names them). */
export function affectedRulesFor(factKey: string, detail: CaroDetail | null): string[] {
  const conditionKeys = new Set<string>(Object.values(CARO_CONDITION));
  return (FACT_RULES[factKey] ?? []).map((r) =>
    conditionKeys.has(r)
      ? (detail?.privateTest?.conditions.find((c) => c.key === r)?.ruleCode ??
        RULE_ID[r as CaroConditionKey])
      : r,
  );
}

/**
 * A significant override or a complex conclusion needs the Engagement Partner
 * (CARO-06): any override of a decisive system result, a Further Assessment
 * Required conclusion, or a conclusion the system itself could not reach.
 */
export function caroPartnerApprovalReason(d: {
  conclusion: CaroOutcome | null;
  systemOutcome: CaroOutcome | null;
  isOverridden: boolean;
}): string | null {
  if (!d.conclusion) return null;
  if (d.isOverridden)
    return 'The conclusion overrides the system assessment (significant override).';
  if (d.conclusion === CARO_OUTCOME.furtherAssessment)
    return 'Further Assessment Required concluded — complex conclusion.';
  if (d.systemOutcome && !DECISIVE.has(d.systemOutcome))
    return 'The system could not determine CARO applicability — professional conclusion.';
  return null;
}

/** The Phase-02 "CARO" area state that mirrors 02.4. */
export function legacyMirror(
  systemOutcome: CaroOutcome,
  conclusion: CaroOutcome | null,
  isOverridden: boolean,
  informationPending = false,
): {
  suggestion: FrameworkConclusion | null;
  conclusion: FrameworkConclusion | null;
  state: FrameworkState;
} {
  const map = (o: CaroOutcome | null): FrameworkConclusion | null =>
    o === CARO_OUTCOME.applicable
      ? 'applicable'
      : o === CARO_OUTCOME.notApplicableExempt
        ? 'not_applicable'
        : null;
  const suggestion = map(systemOutcome);
  const concluded = map(conclusion);
  if (concluded)
    return { suggestion, conclusion: concluded, state: isOverridden ? 'overridden' : concluded };
  if (conclusion === CARO_OUTCOME.furtherAssessment)
    return { suggestion, conclusion: null, state: 'professional_judgement_required' };
  if (informationPending) return { suggestion, conclusion: null, state: 'pending_information' };
  const state: FrameworkState =
    systemOutcome === CARO_OUTCOME.applicable
      ? 'system_suggested_applicable'
      : systemOutcome === CARO_OUTCOME.notApplicableExempt
        ? 'system_suggested_not_applicable'
        : systemOutcome === CARO_OUTCOME.furtherAssessment
          ? 'professional_judgement_required'
          : 'pending_information';
  return { suggestion, conclusion: null, state };
}

/** Whether consolidated FS are in scope, from the frozen facts (null = 02.6 pending). */
export function cfsInScopeOf(detail: CaroDetail | null): boolean | null {
  const v = detail?.factsUsed.find((f) => f.key === 'cfs_in_scope')?.value;
  return v === 'Yes' ? true : v === 'No' ? false : null;
}

/** Report-context status for an outcome (the consolidated component follows Level 1). */
export function contextStatuses(
  outcome: CaroOutcome | null,
  cfsInScope: boolean | null,
): { standalone: CaroContextStatus; consolidated: CaroContextStatus } {
  const standalone: CaroContextStatus =
    outcome === CARO_OUTCOME.applicable
      ? CARO_CONTEXT_STATUS.applicable
      : outcome === CARO_OUTCOME.notApplicableExempt
        ? CARO_CONTEXT_STATUS.notApplicable
        : CARO_CONTEXT_STATUS.pending;
  const consolidated: CaroContextStatus =
    cfsInScope === false
      ? CARO_CONTEXT_STATUS.notApplicable
      : cfsInScope == null
        ? CARO_CONTEXT_STATUS.pending
        : standalone;
  return { standalone, consolidated };
}

export interface CaroCompletionInput {
  detail: CaroDetail | null;
  conclusion: CaroOutcome | null;
  decided: boolean;
  professionalAction: CaroProfessionalAction | null;
  partnerRequired: boolean;
  partnerApproved: boolean;
  needsReevaluation: boolean;
  upstreamReady: boolean;
  /** Programme contexts instantiated by the Level-2 programme (null = not built yet). */
  programmeContexts: string[] | null;
  blockingMatterOpen: boolean;
  started: boolean;
}

function item(key: string, label: string, met: boolean | null, detail: string | null = null) {
  return { key, label, met, detail } satisfies CaroCompletionItem;
}

export function caroCompletion(i: CaroCompletionInput): CaroCompletion {
  const d = i.detail;
  const route = d?.conclusion.entityRoute;
  const nonCompany = route === CARO_ENTITY_ROUTE.nonCompany;
  const pt = d?.privateTest;
  const pendingDirect = (d?.directTests ?? []).filter((t) => t.answer === CARO_ANSWER.pending);
  const directDecisive = (d?.directTests ?? []).some((t) => t.decisive);
  const pendingConditions = (pt?.conditions ?? []).filter(
    (c) => c.result === CARO_CONDITION_RESULT.pending,
  );
  const borrowings = pt?.conditions.find((c) => c.key === CARO_CONDITION.borrowings);
  const final =
    i.decided &&
    (i.conclusion === CARO_OUTCOME.applicable || i.conclusion === CARO_OUTCOME.notApplicableExempt);
  const cfsInScope = cfsInScopeOf(d);
  const status = contextStatuses(final ? i.conclusion : null, cfsInScope);
  const programme = i.programmeContexts ?? [];

  const items: CaroCompletionItem[] = [
    item(
      'facts_available',
      'Required 02.1 facts are available (Entity & Regulatory Profile confirmed)',
      i.upstreamReady,
      i.upstreamReady ? null : 'Confirm 02.1 so 02.4 reads its approved classifications.',
    ),
    item(
      'version_resolved',
      'Applicable CARO effective version resolved for the financial year',
      d?.orderVersion != null,
      d?.orderVersion ? null : 'No CARO 2020 rule version in force for the period.',
    ),
    item(
      'direct_exemptions',
      'All direct exemption categories determined',
      nonCompany ? null : directDecisive || pendingDirect.length === 0,
      pendingDirect.length && !directDecisive
        ? `Pending: ${pendingDirect.map((t) => t.code).join(', ')}`
        : null,
    ),
    item(
      'private_test',
      'Private-company cumulative exemption test completed',
      pt?.tested ? pt.qualified != null : null,
      pendingConditions.length
        ? `Pending: ${pendingConditions.map((c) => c.label).join(', ')}`
        : null,
    ),
    item(
      'measurement',
      "Measurement data sufficient, including the 'at any point during the year' borrowing test",
      pt?.tested
        ? borrowings?.result !== CARO_CONDITION_RESULT.pending && pendingConditions.length === 0
        : null,
      borrowings?.pendingReason ?? null,
    ),
    item(
      'report_context',
      'Standalone / CFS reporting context identified (CFS may be Pending for 02.6)',
      d != null && d.reportContexts.length === 2,
      cfsInScope == null ? 'Consolidated component Pending — 02.6 not concluded.' : null,
    ),
    item(
      'system_conclusion',
      'System conclusion generated with legal basis and configured limits',
      d != null && d.conclusion != null,
    ),
    item(
      'professional_conclusion',
      'Manager confirmed or properly overrode the conclusion',
      final,
      i.professionalAction === CARO_PROFESSIONAL_ACTION.informationPending
        ? 'Information Pending recorded.'
        : i.decided && i.conclusion === CARO_OUTCOME.furtherAssessment
          ? 'Further Assessment Required — resolve to a final conclusion.'
          : null,
    ),
    item(
      'partner_approval',
      'Engagement Partner approval for significant override / complex conclusion',
      i.partnerRequired ? i.partnerApproved : null,
    ),
    item(
      'work_programme',
      'Versioned CARO paragraph 3 work programme instantiated',
      status.standalone === CARO_CONTEXT_STATUS.applicable
        ? programme.includes('standalone')
        : null,
    ),
    item(
      'clause_3_xxi',
      'Clause 3(xxi) consolidated work item configured (applicable / pending)',
      cfsInScope === false
        ? null
        : status.consolidated === CARO_CONTEXT_STATUS.applicable
          ? programme.includes('consolidated')
          : cfsInScope == null
            ? true
            : null,
    ),
    item('reevaluation', 'No source-fact change awaiting re-evaluation', !i.needsReevaluation),
    item(
      'no_blocking_matter',
      'No blocking CARO applicability matter remains',
      !i.blockingMatterOpen,
    ),
  ];

  const relevant = items.filter((x) => x.met !== null);
  const complete = relevant.every((x) => x.met === true);
  const consolidated =
    cfsInScope === false
      ? null
      : complete &&
        (status.consolidated === CARO_CONTEXT_STATUS.notApplicable ||
          (status.consolidated === CARO_CONTEXT_STATUS.applicable &&
            programme.includes('consolidated')));
  return {
    complete,
    status: complete ? 'complete' : i.started || i.decided ? 'in_progress' : 'not_started',
    items,
    contexts: { standalone: complete, consolidated },
  };
}
