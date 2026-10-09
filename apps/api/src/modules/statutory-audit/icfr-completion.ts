import {
  ICFR_CONDITION,
  ICFR_CONDITION_RESULT,
  ICFR_CONTEXT_STATUS,
  ICFR_ENTITY_ROUTE,
  ICFR_OUTCOME,
  ICFR_PROFESSIONAL_ACTION,
  ICFR_ROUTE,
  ICFR_ROUTE_RESULT,
  type FrameworkConclusion,
  type FrameworkState,
  type IcfrCompletion,
  type IcfrCompletionItem,
  type IcfrContextStatus,
  type IcfrDetail,
  type IcfrOutcome,
  type IcfrProfessionalAction,
} from '@hsdg/contracts';

/**
 * 02.5 completion rules (spec §23), the IFC-04 partner-approval trigger, the
 * re-evaluation rule map (spec §2) and the Section 02 mirror — pure, so the
 * service, the DI-free downstream reader and unit tests share one definition.
 */

const DECISIVE = new Set<string>([ICFR_OUTCOME.applicable, ICFR_OUTCOME.exempt]);

/** The rule IDs / tests a changed source fact feeds (Needs Re-evaluation names them). */
const FACT_RULES: Record<string, string[]> = {
  company_type: ['Entity route', 'ICFR_OPC_ROUTE', 'ICFR_SMALL_COMPANY_ROUTE'],
  opc: ['ICFR_OPC_ROUTE'],
  small_company: ['ICFR_SMALL_COMPANY_ROUTE'],
  turnover: ['ICFR_EXEMPT_TURNOVER', 'ICFR_PRIVATE_MONETARY_JOIN'],
  peak_borrowings: ['ICFR_EXEMPT_BORROWINGS', 'ICFR_PRIVATE_MONETARY_JOIN'],
  filing: ['ICFR_FILING_CONDITION'],
  cfs_in_scope: ['Consolidated ICFR reporting consideration'],
};

export function affectedRulesFor(factKey: string, detail: IcfrDetail | null): string[] {
  const fromDetail = (k: string) => detail?.conditions?.find((c) => c.key === k)?.ruleCode ?? null;
  const rules = FACT_RULES[factKey] ?? [];
  if (factKey === 'turnover') return [fromDetail(ICFR_CONDITION.turnover) ?? rules[0]!, rules[1]!];
  if (factKey === 'peak_borrowings')
    return [fromDetail(ICFR_CONDITION.borrowings) ?? rules[0]!, rules[1]!];
  return rules;
}

/**
 * A significant override or a complex assessment needs the Engagement Partner
 * (IFC-04): any override of a decisive system result, a Further Assessment
 * Required conclusion, or a conclusion the system itself could not reach.
 */
export function icfrPartnerApprovalReason(d: {
  conclusion: IcfrOutcome | null;
  systemOutcome: IcfrOutcome | null;
  isOverridden: boolean;
}): string | null {
  if (!d.conclusion) return null;
  if (d.isOverridden)
    return 'The conclusion overrides the system assessment (significant override).';
  if (d.conclusion === ICFR_OUTCOME.furtherAssessment)
    return 'Further Assessment Required concluded — complex assessment.';
  if (d.systemOutcome && !DECISIVE.has(d.systemOutcome))
    return 'The system could not determine ICFR reporting applicability — professional conclusion.';
  return null;
}

/** The Section 02 "IFC" area state that mirrors 02.5. */
export function legacyMirror(
  systemOutcome: IcfrOutcome,
  conclusion: IcfrOutcome | null,
  isOverridden: boolean,
  informationPending = false,
): {
  suggestion: FrameworkConclusion | null;
  conclusion: FrameworkConclusion | null;
  state: FrameworkState;
} {
  const map = (o: IcfrOutcome | null): FrameworkConclusion | null =>
    o === ICFR_OUTCOME.applicable
      ? 'applicable'
      : o === ICFR_OUTCOME.exempt
        ? 'not_applicable'
        : null;
  const suggestion = map(systemOutcome);
  const concluded = map(conclusion);
  if (concluded)
    return { suggestion, conclusion: concluded, state: isOverridden ? 'overridden' : concluded };
  if (conclusion === ICFR_OUTCOME.furtherAssessment)
    return { suggestion, conclusion: null, state: 'professional_judgement_required' };
  if (informationPending) return { suggestion, conclusion: null, state: 'pending_information' };
  const state: FrameworkState =
    systemOutcome === ICFR_OUTCOME.applicable
      ? 'system_suggested_applicable'
      : systemOutcome === ICFR_OUTCOME.exempt
        ? 'system_suggested_not_applicable'
        : systemOutcome === ICFR_OUTCOME.furtherAssessment
          ? 'professional_judgement_required'
          : 'pending_information';
  return { suggestion, conclusion: null, state };
}

/** Whether consolidated FS are in scope, from the stored facts (null = 02.6 pending). */
export function cfsInScopeOf(detail: IcfrDetail | null): boolean | null {
  const v = detail?.factsUsed?.find((f) => f.key === 'cfs_in_scope')?.value;
  return v === 'Yes' ? true : v === 'No' ? false : null;
}

/**
 * Report-context status. A CFS in scope always needs the Consolidated ICFR
 * Reporting Consideration (spec §17) — component applicability is decided there;
 * until 02.6 concludes it is Pending without blocking the standalone conclusion.
 */
export function contextStatuses(
  outcome: IcfrOutcome | null,
  cfsInScope: boolean | null,
): { standalone: IcfrContextStatus; consolidated: IcfrContextStatus } {
  const standalone: IcfrContextStatus =
    outcome === ICFR_OUTCOME.applicable
      ? ICFR_CONTEXT_STATUS.applicable
      : outcome === ICFR_OUTCOME.exempt
        ? ICFR_CONTEXT_STATUS.notApplicable
        : ICFR_CONTEXT_STATUS.pending;
  const consolidated: IcfrContextStatus =
    cfsInScope === false
      ? ICFR_CONTEXT_STATUS.notApplicable
      : cfsInScope == null
        ? ICFR_CONTEXT_STATUS.pending
        : ICFR_CONTEXT_STATUS.applicable;
  return { standalone, consolidated };
}

/** Track B's Section 05 / consolidated status (null = not available on this build). */
export interface IcfrDownstreamStatus {
  workstream: { instantiated: boolean } | null;
  consolidated: { configured: boolean } | null;
}

export interface IcfrCompletionInput {
  detail: IcfrDetail | null;
  conclusion: IcfrOutcome | null;
  decided: boolean;
  professionalAction: IcfrProfessionalAction | null;
  partnerRequired: boolean;
  partnerApproved: boolean;
  needsReevaluation: boolean;
  upstreamReady: boolean;
  blockingMatterOpen: boolean;
  started: boolean;
  downstream: IcfrDownstreamStatus;
}

function item(key: string, label: string, met: boolean | null, detail: string | null = null) {
  return { key, label, met, detail } satisfies IcfrCompletionItem;
}

export function icfrCompletion(i: IcfrCompletionInput): IcfrCompletion {
  const d = i.detail;
  const route = d?.entityRoute ?? ICFR_ENTITY_ROUTE.unknown;
  const priv = route === ICFR_ENTITY_ROUTE.privateCompany;
  const routes = d?.routes ?? [];
  const pendingRoutes = routes.filter((r) => r.result === ICFR_ROUTE_RESULT.pending);
  const cond = (k: string) => d?.conditions?.find((c) => c.key === k);
  const turnover = cond(ICFR_CONDITION.turnover);
  const borrowings = cond(ICFR_CONDITION.borrowings);
  const filing = cond(ICFR_CONDITION.filing);
  const tested = (c: typeof turnover) => c != null && c.result !== ICFR_CONDITION_RESULT.notTested;
  const final =
    i.decided && (i.conclusion === ICFR_OUTCOME.applicable || i.conclusion === ICFR_OUTCOME.exempt);
  const cfsInScope = cfsInScopeOf(d);
  const status = contextStatuses(final ? i.conclusion : null, cfsInScope);
  const opc = routes.find((r) => r.key === ICFR_ROUTE.opc);

  const items: IcfrCompletionItem[] = [
    item(
      'facts_available',
      'Required 02.1 facts are available (Entity & Regulatory Profile confirmed)',
      i.upstreamReady,
      i.upstreamReady ? null : 'Confirm 02.1 so 02.5 reads its approved classifications.',
    ),
    item(
      'version_resolved',
      'Applicable legal / exemption version resolved for the audit period',
      priv ? d?.notificationVersion != null : d != null && route !== ICFR_ENTITY_ROUTE.unknown,
      priv && !d?.notificationVersion
        ? 'No private-company exemption rule version in force for the period.'
        : null,
    ),
    item(
      'entity_route',
      'Entity route determined',
      d != null && route !== ICFR_ENTITY_ROUTE.unknown,
    ),
    item(
      'routes_evaluated',
      'OPC and Small Company routes evaluated',
      priv ? pendingRoutes.length === 0 : null,
      pendingRoutes.length ? `Pending: ${pendingRoutes.map((r) => r.label).join(', ')}` : null,
    ),
    item(
      'turnover',
      'Turnover condition determined on the correct source / measurement basis',
      priv && tested(turnover) ? turnover!.result !== ICFR_CONDITION_RESULT.pending : null,
      turnover?.pendingReason ?? null,
    ),
    item(
      'borrowings',
      'Maximum aggregate covered borrowings determined (covered sources, intra-year)',
      priv && tested(borrowings) ? borrowings!.result !== ICFR_CONDITION_RESULT.pending : null,
      borrowings?.pendingReason ?? null,
    ),
    item(
      'filing',
      'Filing-default condition evaluated where the exemption requires it',
      priv && tested(filing) ? filing!.result !== ICFR_CONDITION_RESULT.pending : null,
      filing?.pendingReason ?? null,
    ),
    item(
      'system_conclusion',
      'System conclusion generated with actual values, limits, operators and legal basis',
      d?.conclusion != null,
    ),
    item(
      'professional_conclusion',
      'Manager confirmed or properly overrode the conclusion',
      final,
      i.professionalAction === ICFR_PROFESSIONAL_ACTION.informationPending
        ? 'Information Pending recorded.'
        : i.decided && i.conclusion === ICFR_OUTCOME.furtherAssessment
          ? 'Further Assessment Required — resolve to a final conclusion.'
          : null,
    ),
    item(
      'partner_approval',
      'Engagement Partner approval for significant override / complex assessment',
      i.partnerRequired ? i.partnerApproved : null,
    ),
    item(
      'workstream',
      'ICFR audit workstream instantiated in Section 05',
      status.standalone === ICFR_CONTEXT_STATUS.applicable && i.downstream.workstream
        ? i.downstream.workstream.instantiated
        : null,
    ),
    item(
      'consolidated',
      'Consolidated ICFR consideration created or marked Pending for 02.6',
      cfsInScope === false
        ? null
        : cfsInScope == null
          ? true
          : i.downstream.consolidated
            ? i.downstream.consolidated.configured
            : null,
      cfsInScope == null ? 'Consolidated consideration Pending — 02.6 not concluded.' : null,
    ),
    item('reevaluation', 'No source-fact change awaiting re-evaluation', !i.needsReevaluation),
    item(
      'no_blocking_matter',
      'No blocking ICFR applicability matter remains',
      !i.blockingMatterOpen,
    ),
  ];
  // An OPC never reaches the monetary test; keep its row honest.
  if (opc?.result === ICFR_ROUTE_RESULT.exemptRoute) {
    for (const k of ['turnover', 'borrowings']) {
      const x = items.find((it) => it.key === k);
      if (x && x.met === null) x.detail = 'Not required — OPC route.';
    }
  }

  const relevant = items.filter((x) => x.met !== null);
  const complete = relevant.every((x) => x.met === true);
  return {
    complete,
    status: complete ? 'complete' : i.started || i.decided ? 'in_progress' : 'not_started',
    items,
  };
}

/**
 * A professional conclusion is recorded: a decided state, or a recorded
 * "Further Assessment Required" conclusion (state professional_judgement_required
 * with a conclusion — the system's own undecided state never carries one).
 */
export function isIcfrDecided(state: FrameworkState, conclusion: string | null = null): boolean {
  return (
    state === 'applicable' ||
    state === 'not_applicable' ||
    state === 'overridden' ||
    state === 'approved' ||
    state === 'reassessment_required' ||
    (state === 'professional_judgement_required' && conclusion != null)
  );
}
