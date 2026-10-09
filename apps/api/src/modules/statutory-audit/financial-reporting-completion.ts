import {
  ENTITY_BRANCH,
  FRAMEWORK_DECIDED_STATES,
  FRF_CONFIDENCE,
  FRF_TEST_RESULT,
  REPORTING_FRAMEWORK_OUTCOME,
  SMC_STATUS,
  type FinancialReportingCapturedFacts,
  type FinancialReportingDetail,
  type FinancialReportingFacts,
  type FrameworkState,
  type FrfCompletion,
  type FrfCompletionItem,
} from '@hsdg/contracts';

/**
 * 02.2 completion rules (spec §21) and the FRF-05 partner-approval trigger —
 * pure, so the service, the downstream result helper and the unit tests share
 * one definition of "02.2 COMPLETE".
 */

export interface FrfDecisionState {
  state: FrameworkState;
  conclusion: string | null;
  systemOutcome: string | null;
  isOverridden: boolean;
}

/**
 * A significant override or a complex conclusion needs the Engagement Partner
 * (FRF-05, §21): any override, a specialised / further-assessment conclusion, or
 * a system result that itself needed professional review.
 */
export function partnerApprovalReason(
  d: FrfDecisionState,
  detail: FinancialReportingDetail | null,
): string | null {
  if (d.isOverridden) return 'The conclusion overrides the system assessment.';
  if (d.conclusion === REPORTING_FRAMEWORK_OUTCOME.specialised)
    return 'Specialised / further-assessment framework concluded.';
  if (
    d.conclusion &&
    (detail?.confidence === FRF_CONFIDENCE.professionalReview ||
      d.systemOutcome === REPORTING_FRAMEWORK_OUTCOME.professionalReview)
  )
    return 'The system could not determine the framework — professional review conclusion.';
  return null;
}

/** The framework downstream uses: the conclusion once decided, else none. */
export function decidedFramework(d: FrfDecisionState): string | null {
  return FRAMEWORK_DECIDED_STATES.includes(d.state) ? d.conclusion : null;
}

export interface FrfCompletionInput {
  decision: FrfDecisionState;
  detail: FinancialReportingDetail | null;
  facts: FinancialReportingFacts;
  captured: FinancialReportingCapturedFacts;
  profileConfirmed: boolean;
  partnerRequired: boolean;
  partnerApproved: boolean;
  blockingReviewOpen: boolean;
}

function item(key: string, label: string, met: boolean | null, detail: string | null = null) {
  return { key, label, met, detail } satisfies FrfCompletionItem;
}

export function financialReportingCompletion(i: FrfCompletionInput): FrfCompletion {
  const { decision, detail, facts, captured } = i;
  const branch = detail?.entityBranch ?? ENTITY_BRANCH.ordinary;
  const company = branch !== ENTITY_BRANCH.nonCompany;
  const roadmapBranch = branch === ENTITY_BRANCH.ordinary || branch === ENTITY_BRANCH.nbfc;
  const framework = decidedFramework(decision) ?? decision.systemOutcome;
  const decided = FRAMEWORK_DECIDED_STATES.includes(decision.state) && decision.conclusion != null;
  const missing02_1 = (detail?.missingFacts ?? []).filter((m) => m.source.startsWith('02.1'));

  const alreadyAnswered =
    facts.indAsAlreadyApplicable === 'yes' || facts.indAsAlreadyApplicable === 'no';
  const priorAssessed =
    facts.priorFramework != null &&
    alreadyAnswered &&
    (facts.indAsAlreadyApplicable !== 'yes' || !!facts.firstIndAsFy);
  const voluntaryAnswered =
    facts.voluntaryAnswer === 'no' ||
    (facts.voluntaryAnswer === 'yes' && !!facts.voluntaryFirstIndAsFy);
  const continuingOrVoluntary =
    detail?.applicabilityType === 'continuing' || detail?.applicabilityType === 'voluntary';

  const nw = detail?.netWorth?.result;
  const group = detail?.group?.result;
  const roadmapEvaluated =
    continuingOrVoluntary ||
    (nw != null &&
      nw !== FRF_TEST_RESULT.insufficient &&
      group !== 'review_required' &&
      detail?.listing != null);

  const listed = (facts.listingStatus ?? (facts.isListed ? 'listed' : 'unlisted')) !== 'unlisted';
  const isAs = framework === REPORTING_FRAMEWORK_OUTCOME.accountingStandards;
  const isIndAs = framework === REPORTING_FRAMEWORK_OUTCOME.indAs;
  const smcStatus = detail?.smc?.status ?? detail?.smcStatus;

  const items: FrfCompletionItem[] = [
    item(
      'facts_available',
      'Required 02.1 facts are available',
      i.profileConfirmed && missing02_1.length === 0,
      !i.profileConfirmed
        ? '02.1 Entity & Regulatory Profile is not confirmed.'
        : missing02_1.length
          ? `Missing: ${missing02_1.map((m) => m.label).join(', ')}`
          : null,
    ),
    item(
      'prior_framework',
      'Prior-year / continuing framework status assessed',
      company ? priorAssessed : null,
    ),
    item(
      'voluntary',
      'Voluntary adoption assessed',
      company && roadmapBranch && facts.indAsAlreadyApplicable !== 'yes' ? voluntaryAnswered : null,
    ),
    item('entity_branch', 'Correct entity branch selected', facts.isCompany != null),
    item(
      'roadmap_rules',
      'Listing, net-worth and group rules evaluated',
      roadmapBranch ? roadmapEvaluated : null,
    ),
    item(
      'exception',
      'SME exchange / other exception evaluated',
      roadmapBranch && listed ? detail?.listing != null : null,
    ),
    item(
      'nbfc_roadmap',
      'NBFC-specific roadmap used',
      branch === ENTITY_BRANCH.nbfc
        ? continuingOrVoluntary ||
            (detail?.rulesApplied ?? []).some((r) => r.ruleCode.includes('NBFC'))
        : null,
    ),
    item(
      'system_conclusion',
      'System conclusion generated with rule basis and limits',
      decision.systemOutcome != null && (detail?.rulesApplied != null || !roadmapBranch),
    ),
    item('professional_conclusion', 'Manager confirmed or overrode the conclusion', decided),
    item(
      'partner_approval',
      'Partner approval for significant override / complex conclusion',
      i.partnerRequired ? i.partnerApproved : null,
    ),
    item(
      'smc',
      'SMC sub-assessment completed',
      isAs ? smcStatus === SMC_STATUS.smc || smcStatus === SMC_STATUS.nonSmc : null,
    ),
    item(
      'first_time',
      'First-time Ind AS status determined',
      isIndAs ? captured.firstTimeAdoption != null : null,
    ),
    item('no_blocking_review', 'No blocking Framework Review open', !i.blockingReviewOpen),
  ];

  const relevant = items.filter((x) => x.met !== null);
  const complete = relevant.every((x) => x.met === true);
  const touched =
    decided ||
    facts.priorFramework != null ||
    facts.voluntaryAnswer != null ||
    facts.indAsAlreadyApplicable != null;
  return {
    complete,
    status: complete ? 'complete' : touched ? 'in_progress' : 'not_started',
    items,
  };
}
