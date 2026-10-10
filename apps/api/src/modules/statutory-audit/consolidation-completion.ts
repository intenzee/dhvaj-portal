import {
  CONSOLIDATION_METHOD,
  CONSOLIDATION_OUTCOME,
  CONSOLIDATION_PROFESSIONAL_ACTION,
  INVESTEE_RELATIONSHIP,
  PERIMETER_INCLUSION,
  RULE6_RESULT,
  type ConsolidationCompletion,
  type ConsolidationCompletionItem,
  type ConsolidationCrossLinks,
  type ConsolidationDetail,
  type ConsolidationOutcome,
  type ConsolidationPriorYearChange,
  type ConsolidationProfessionalAction,
  type ConsolidationSummary,
  type FrameworkConclusion,
  type FrameworkState,
  type GroupAuditStatus,
  type InvesteeClassification,
} from '@hsdg/contracts';

/**
 * 02.6 completion rules (spec §24), the CFS-05 Engagement Partner trigger
 * (spec §22), the CFS-05 summary, the prior-year change indicators (spec §21)
 * and the Section 02 "CFS" mirror — pure, so the service, the DI-free
 * downstream reader and unit tests share one definition.
 */

/** Outcomes the system decides on its own (anything else needs a professional conclusion). */
export const CONSOLIDATION_DECISIVE = new Set<string>([
  CONSOLIDATION_OUTCOME.cfsRequired,
  CONSOLIDATION_OUTCOME.cfsExempt,
  CONSOLIDATION_OUTCOME.notApplicable,
]);

/** Relationships that make a perimeter entry a CFS component. */
const COMPONENT = new Set<string>([
  INVESTEE_RELATIONSHIP.subsidiary,
  INVESTEE_RELATIONSHIP.associate,
  INVESTEE_RELATIONSHIP.jointVenture,
  INVESTEE_RELATIONSHIP.jointOperation,
]);

/** The included CFS components of a perimeter. */
export function includedComponents(detail: ConsolidationDetail | null): InvesteeClassification[] {
  return (detail?.perimeter ?? []).filter(
    (p) => p.included === PERIMETER_INCLUSION.yes && COMPONENT.has(p.relationship),
  );
}

/** Perimeter entries whose inclusion was changed from the system proposal (a perimeter dispute). */
export function perimeterDisputes(detail: ConsolidationDetail | null): InvesteeClassification[] {
  return (detail?.perimeter ?? []).filter(
    (p) => p.systemIncluded != null && p.included !== p.systemIncluded,
  );
}

/** Perimeter entries whose relationship conclusion rebuts a rule presumption (a control dispute). */
export function controlDisputes(detail: ConsolidationDetail | null): InvesteeClassification[] {
  return (detail?.perimeter ?? []).filter((p) => !!p.presumptionRebutted);
}

/**
 * CFS-05: a significant override, a control dispute or a perimeter dispute
 * needs the Engagement Partner (spec §22) — any override of a decisive system
 * result, a Further Assessment Required conclusion, a conclusion the system
 * itself could not reach, an inclusion changed from the system proposal, or a
 * relationship conclusion that rebuts a control / influence presumption.
 */
export function consolidationPartnerApprovalReason(d: {
  conclusion: ConsolidationOutcome | null;
  systemOutcome: ConsolidationOutcome | null;
  isOverridden: boolean;
  detail: ConsolidationDetail | null;
}): string | null {
  if (!d.conclusion) return null;
  if (d.isOverridden)
    return 'The conclusion overrides the system assessment (significant override).';
  if (d.conclusion === CONSOLIDATION_OUTCOME.furtherAssessment)
    return 'Further Assessment Required concluded — complex group assessment.';
  if (d.systemOutcome && !CONSOLIDATION_DECISIVE.has(d.systemOutcome))
    return 'The system could not determine CFS applicability — professional conclusion.';
  const control = controlDisputes(d.detail);
  if (control.length)
    return `Control / influence dispute: ${control.map((p) => `${p.name} — ${p.presumptionRebutted}`).join(' ')}`;
  const perimeter = perimeterDisputes(d.detail);
  if (perimeter.length)
    return `Perimeter dispute: inclusion changed from the system proposal for ${perimeter.map((p) => p.name).join(', ')}.`;
  return null;
}

/** The Section 02 "CFS" area state that mirrors 02.6. */
export function consolidationLegacyMirror(
  systemOutcome: ConsolidationOutcome,
  conclusion: ConsolidationOutcome | null,
  isOverridden: boolean,
  informationPending = false,
): {
  suggestion: FrameworkConclusion | null;
  conclusion: FrameworkConclusion | null;
  state: FrameworkState;
} {
  const map = (o: ConsolidationOutcome | null): FrameworkConclusion | null =>
    o === CONSOLIDATION_OUTCOME.cfsRequired
      ? 'applicable'
      : o === CONSOLIDATION_OUTCOME.cfsExempt || o === CONSOLIDATION_OUTCOME.notApplicable
        ? 'not_applicable'
        : null;
  const suggestion = map(systemOutcome);
  const concluded = map(conclusion);
  if (concluded)
    return { suggestion, conclusion: concluded, state: isOverridden ? 'overridden' : concluded };
  if (conclusion === CONSOLIDATION_OUTCOME.furtherAssessment)
    return { suggestion, conclusion: null, state: 'professional_judgement_required' };
  if (informationPending) return { suggestion, conclusion: null, state: 'pending_information' };
  const state: FrameworkState =
    suggestion === 'applicable'
      ? 'system_suggested_applicable'
      : suggestion === 'not_applicable'
        ? 'system_suggested_not_applicable'
        : systemOutcome === CONSOLIDATION_OUTCOME.furtherAssessment
          ? 'professional_judgement_required'
          : 'pending_information';
  return { suggestion, conclusion: null, state };
}

/**
 * A professional conclusion is recorded: a decided state, or a recorded
 * "Further Assessment Required" conclusion (the system's own undecided state
 * never carries one).
 */
export function isConsolidationDecided(
  state: FrameworkState,
  conclusion: string | null = null,
): boolean {
  return (
    state === 'applicable' ||
    state === 'not_applicable' ||
    state === 'overridden' ||
    state === 'approved' ||
    state === 'reassessment_required' ||
    (state === 'professional_judgement_required' && conclusion != null)
  );
}

/** A comparable fingerprint of what the conclusion rests on (re-evaluation trigger). */
export function perimeterFingerprint(
  outcome: string | null,
  detail: ConsolidationDetail | null,
): string {
  const rows = (detail?.perimeter ?? [])
    // Everything the conclusion and its EP triggers rest on (not CFS-03 / 04 data).
    .map((p) =>
      [
        p.id,
        p.relationship,
        p.included,
        p.systemIncluded,
        p.method,
        p.presumptionRebutted ? 'rebutted' : '',
      ].join('|'),
    )
    .sort();
  return [outcome ?? '', detail?.groupFramework ?? '', detail?.rule6?.result ?? '', ...rows].join(
    ';',
  );
}

export interface ConsolidationCompletionInput {
  detail: ConsolidationDetail | null;
  conclusion: ConsolidationOutcome | null;
  decided: boolean;
  professionalAction: ConsolidationProfessionalAction | null;
  partnerRequired: boolean;
  partnerApproved: boolean;
  needsReevaluation: boolean;
  upstreamReady: boolean;
  /** The §129(3) provision resolved for the period (frozen authority). */
  provisionResolved: boolean;
  started: boolean;
  /** Is the company itself a subsidiary of another company (Rule 6 relevant)? */
  isSubsidiary: boolean;
  groupAudit: GroupAuditStatus | null;
  crossLinks: ConsolidationCrossLinks;
  /** Open CFS-04 conversion items. */
  conversionsOpen: number;
}

function item(
  key: string,
  label: string,
  met: boolean | null,
  detail: string | null = null,
): ConsolidationCompletionItem {
  return { key, label, met, detail };
}

export function consolidationCompletion(i: ConsolidationCompletionInput): ConsolidationCompletion {
  const d = i.detail;
  const final = i.decided && i.conclusion != null && CONSOLIDATION_DECISIVE.has(i.conclusion);
  const cfsRequired = final && i.conclusion === CONSOLIDATION_OUTCOME.cfsRequired;
  const perimeter = d?.perimeter ?? [];
  const components = includedComponents(d);
  const furtherRel = perimeter.filter(
    (p) => p.relationship === INVESTEE_RELATIONSHIP.furtherAssessment,
  );
  const pendingInclusion = perimeter.filter((p) => p.included === PERIMETER_INCLUSION.pending);
  const methodOpen = components.filter(
    (p) => p.method === CONSOLIDATION_METHOD.none || p.judgementRequired,
  );
  const reportingComponents = components.filter(
    (p) => p.relationship !== INVESTEE_RELATIONSHIP.jointOperation,
  );
  const differencesOpen = reportingComponents.filter(
    (p) => p.reportingDate?.sameAsGroup == null || !p.policy?.localFramework,
  );
  const g = i.groupAudit;
  const caroLinked = i.crossLinks.caroComponents;
  const icfrLinked = i.crossLinks.icfrComponents;
  const crossRelevant = cfsRequired && (caroLinked != null || icfrLinked != null);
  const blocking = [
    ...(g?.blockingMatters ?? []),
    ...(d?.missingFacts ?? []).filter((m) => m.blocking).map((m) => m.label),
  ];

  const items: ConsolidationCompletionItem[] = [
    item(
      'versions_resolved',
      'Applicable Section 129 / Rule 6 / accounting-framework versions resolved',
      i.upstreamReady && d?.groupFramework != null && (!final || i.provisionResolved),
      !i.upstreamReady
        ? 'Confirm 02.1 and conclude 02.2 so 02.6 reads their frozen outputs.'
        : final && !i.provisionResolved
          ? 'No §129(3) provision version in force for the audit period.'
          : null,
    ),
    item(
      'relationships_confirmed',
      'Group relationships confirmed sufficiently to determine CFS applicability',
      d != null && furtherRel.length === 0,
      furtherRel.length ? `Under assessment: ${furtherRel.map((p) => p.name).join(', ')}` : null,
    ),
    item(
      'rule6_tested',
      'Rule 6 exemption tested condition-by-condition',
      d?.cfsTriggered && i.isSubsidiary ? d.rule6?.result !== RULE6_RESULT.pending : null,
      d?.rule6?.result === RULE6_RESULT.pending ? d.rule6.basis : null,
    ),
    item(
      'cfs_concluded',
      'CFS applicability confirmed / overridden',
      final,
      i.professionalAction === CONSOLIDATION_PROFESSIONAL_ACTION.informationPending
        ? 'Information Pending recorded.'
        : i.decided && i.conclusion === CONSOLIDATION_OUTCOME.furtherAssessment
          ? 'Further Assessment Required — resolve to a final conclusion.'
          : null,
    ),
    item(
      'perimeter_recorded',
      'Consolidation perimeter and relationship conclusions recorded',
      perimeter.length ? pendingInclusion.length === 0 : null,
      pendingInclusion.length
        ? `Inclusion pending: ${pendingInclusion.map((p) => p.name).join(', ')}`
        : null,
    ),
    item(
      'method_confirmed',
      'Accounting method proposed from the applicable AS / Ind AS and confirmed where required',
      components.length ? methodOpen.length === 0 : null,
      methodOpen.length ? `Confirm: ${methodOpen.map((p) => p.name).join(', ')}` : null,
    ),
    item(
      'differences_identified',
      'Reporting-date and accounting-policy differences identified',
      cfsRequired && reportingComponents.length ? differencesOpen.length === 0 : null,
      differencesOpen.length
        ? `Capture reporting date / local framework: ${differencesOpen.map((p) => p.name).join(', ')}`
        : i.conversionsOpen
          ? `${i.conversionsOpen} conversion work item(s) open.`
          : null,
    ),
    item(
      'auditor_matrix',
      'Component / branch auditor matrix complete',
      cfsRequired && g
        ? g.matrixComplete && g.tbdComponents === 0 && g.branchAuditPresent !== 'pending'
        : null,
      g && cfsRequired && !g.matrixComplete
        ? 'Record the auditor of every included component.'
        : g && g.branchAuditPresent === 'pending'
          ? 'Answer BR-01 (branch auditors).'
          : null,
    ),
    item(
      'sa600_configured',
      'Required SA 600 assessments / instructions configured',
      g?.sa600Required ? g.sa600Pending === 0 && g.instructionsPending === 0 : null,
      g?.sa600Required && (g.sa600Pending || g.instructionsPending)
        ? `${g.sa600Pending} SA 600 answer(s) pending, ${g.instructionsPending} instruction(s) not issued.`
        : null,
    ),
    item(
      'cross_links',
      'CARO and ICFR component cross-links created where relevant',
      crossRelevant ? (caroLinked ?? 1) > 0 && (icfrLinked ?? 1) > 0 : null,
      crossRelevant && (caroLinked === 0 || icfrLinked === 0)
        ? 'Open 02.4 / 02.5 so they read the 02.6 component universe.'
        : null,
    ),
    item(
      'work_programme',
      'Consolidation work programme generated (CFS required)',
      cfsRequired && g ? g.workProgrammeGenerated : null,
    ),
    item(
      'manager_and_partner',
      'Manager confirmed the framework; required Engagement Partner reviews complete',
      final && (!i.partnerRequired || i.partnerApproved),
      final && i.partnerRequired && !i.partnerApproved
        ? 'Engagement Partner approval pending.'
        : null,
    ),
    item(
      'no_blocking_matter',
      'No unresolved blocking perimeter / component-auditor matter',
      blocking.length === 0 && !i.needsReevaluation,
      i.needsReevaluation
        ? 'Facts changed after the conclusion — re-evaluate.'
        : blocking.length
          ? blocking.join(' ')
          : null,
    ),
  ];

  const relevant = items.filter((x) => x.met !== null);
  const complete = relevant.every((x) => x.met === true);
  return {
    complete,
    status: complete ? 'complete' : i.started || i.decided ? 'in_progress' : 'not_started',
    items,
  };
}

/** CFS-05 summary (spec §22). */
export function consolidationSummary(
  outcome: ConsolidationOutcome | null,
  detail: ConsolidationDetail | null,
  groupAudit: GroupAuditStatus | null,
): ConsolidationSummary {
  const g = groupAudit;
  return {
    cfsRequired:
      outcome === CONSOLIDATION_OUTCOME.cfsRequired
        ? true
        : outcome === CONSOLIDATION_OUTCOME.cfsExempt ||
            outcome === CONSOLIDATION_OUTCOME.notApplicable
          ? false
          : null,
    counts: detail?.counts ?? {},
    dhvajComponents: g?.dhvajComponents ?? 0,
    otherAuditorComponents: g?.otherAuditorComponents ?? 0,
    branchAuditors: g?.branchAuditors ?? 0,
    pendingReports: g?.pendingReports ?? 0,
    framework:
      detail?.groupFramework === 'ind_as'
        ? 'Ind AS'
        : detail?.groupFramework === 'as'
          ? 'AS'
          : null,
    workProgrammeGenerated: g?.workProgrammeGenerated ?? false,
  };
}

const keyOf = (p: Pick<InvesteeClassification, 'id' | 'name'>) => p.id;
const nameKey = (p: Pick<InvesteeClassification, 'name'>) => p.name.trim().toLowerCase();

/**
 * Roll-forward change indicators against the prior-year 02.6 (spec §21): a
 * new / disposed component, an ownership or voting change, a reporting-date
 * or framework change and a changed conclusion. Components are matched by id,
 * falling back to the name for files captured before ids existed.
 */
export function priorYearChanges(
  prior: { outcome: ConsolidationOutcome | null; detail: ConsolidationDetail | null },
  current: { outcome: ConsolidationOutcome | null; detail: ConsolidationDetail | null },
): ConsolidationPriorYearChange[] {
  const out: ConsolidationPriorYearChange[] = [];
  const prev = prior.detail?.perimeter ?? [];
  const cur = current.detail?.perimeter ?? [];
  const find = (list: InvesteeClassification[], p: InvesteeClassification) =>
    list.find((x) => keyOf(x) === keyOf(p)) ?? list.find((x) => nameKey(x) === nameKey(p));
  const inPerimeter = (p: InvesteeClassification) => p.included !== PERIMETER_INCLUSION.no;

  for (const p of cur) {
    const was = find(prev, p);
    if (!was || (!inPerimeter(was) && inPerimeter(p))) {
      if (inPerimeter(p))
        out.push({
          kind: 'new_component',
          componentId: p.id,
          componentName: p.name,
          message: `${p.name} is new to the perimeter this year — assess the relationship and period impact.`,
        });
      continue;
    }
    if (inPerimeter(was) && !inPerimeter(p))
      out.push({
        kind: 'disposed_component',
        componentId: p.id,
        componentName: p.name,
        message: `${p.name} left the perimeter (${p.inclusionReason}) — prior-year history retained; confirm the current-year period impact.`,
      });
    if (was.ownershipPercent !== p.ownershipPercent || was.votingPercent !== p.votingPercent)
      out.push({
        kind: 'ownership_change',
        componentId: p.id,
        componentName: p.name,
        message: `${p.name}: ownership / voting changed (${fmtPct(was.ownershipPercent)} → ${fmtPct(p.ownershipPercent)} ownership, ${fmtPct(was.votingPercent)} → ${fmtPct(p.votingPercent)} voting) — reassess the relationship and perimeter.`,
      });
    const wasDate = was.reportingDate?.componentDate ?? null;
    const nowDate = p.reportingDate?.componentDate ?? null;
    if (wasDate && nowDate && wasDate.slice(5) !== nowDate.slice(5))
      out.push({
        kind: 'reporting_date_change',
        componentId: p.id,
        componentName: p.name,
        message: `${p.name}: reporting date changed (${wasDate.slice(5)} → ${nowDate.slice(5)}) — reassess CFS-03.`,
      });
    const wasFw = was.policy?.localFramework ?? null;
    const nowFw = p.policy?.localFramework ?? null;
    if (wasFw && nowFw && wasFw !== nowFw)
      out.push({
        kind: 'framework_change',
        componentId: p.id,
        componentName: p.name,
        message: `${p.name}: local framework changed (${wasFw} → ${nowFw}) — reassess conversion / alignment.`,
      });
  }
  for (const was of prev) {
    if (inPerimeter(was) && !find(cur, was))
      out.push({
        kind: 'disposed_component',
        componentId: was.id,
        componentName: was.name,
        message: `${was.name} was in last year's perimeter but is not on this year's group structure — record the disposal / period impact.`,
      });
  }
  if (
    prior.detail?.groupFramework &&
    current.detail?.groupFramework &&
    prior.detail.groupFramework !== current.detail.groupFramework
  )
    out.push({
      kind: 'framework_change',
      componentId: null,
      componentName: null,
      message: `Group framework changed (${prior.detail.groupFramework} → ${current.detail.groupFramework}) — reassess every component's alignment.`,
    });
  if (prior.outcome && current.outcome && prior.outcome !== current.outcome)
    out.push({
      kind: 'conclusion_change',
      componentId: null,
      componentName: null,
      message: `Last year's conclusion (${prior.outcome.replace(/_/g, ' ')}) differs from this year's assessment (${current.outcome.replace(/_/g, ' ')}).`,
    });
  return out;
}

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${v}%`;
}
