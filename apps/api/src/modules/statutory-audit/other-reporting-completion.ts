import {
  AUDIT_TRAIL_CONCLUSION,
  OTHER_REPORTING_ACTION,
  OTHER_REPORTING_OUTCOME,
  REMUNERATION_OUTCOME,
  REPORTING_APPLICABILITY as APPL,
  REPORTING_CARD as CARD,
  type FrameworkConclusion,
  type FrameworkState,
  type OtherReportingAction,
  type OtherReportingCompletion,
  type OtherReportingCompletionItem,
  type OtherReportingDetail,
  type OtherReportingOutcome,
  type ReportingCrossRefs,
  type DirectorDisqualificationStatus,
  type FraudFrameworkStatus,
} from '@hsdg/contracts';

/**
 * 02.7 completion rules (spec §20), the Engagement Partner trigger, the
 * re-evaluation fingerprint and the Section 02 rule_11 / section_143 mirror —
 * pure, so the service, the DI-free downstream reader and the unit tests share
 * one definition.
 */

/** Outcomes the team may confirm as they stand. */
export const OTHER_REPORTING_DECISIVE = new Set<string>([
  OTHER_REPORTING_OUTCOME.configured,
  OTHER_REPORTING_OUTCOME.attentionRequired,
]);

const NOT_APPLICABLE = new Set<string>([APPL.notApplicable, APPL.notApplicableToFacts]);

/** A professional conclusion is recorded on the 02.7 row. */
export function isOtherReportingDecided(state: FrameworkState): boolean {
  return (
    state === 'applicable' ||
    state === 'not_applicable' ||
    state === 'overridden' ||
    state === 'approved'
  );
}

/**
 * The Engagement Partner approves a significant override (spec §3, §20): the
 * conclusion overrides the system outcome, or a team override removes a
 * statutory obligation the system identified.
 */
export function otherReportingPartnerApprovalReason(d: {
  conclusion: OtherReportingOutcome | null;
  isOverridden: boolean;
  detail: OtherReportingDetail | null;
}): string | null {
  if (!d.conclusion) return null;
  if (d.isOverridden)
    return 'The conclusion overrides the system assessment (significant override).';
  const removed = d.detail?.removedObligations ?? [];
  if (removed.length)
    return `Applicability override removes statutory obligation(s): ${removed.join('; ')}.`;
  return null;
}

/**
 * What a decided 02.7 conclusion depends on — when it changes the row needs a
 * controlled re-evaluation (spec §20). Card exceptions and work state do not
 * count: cards stay workable after approval.
 */
export function otherReportingFingerprint(
  outcome: string | null,
  detail: OtherReportingDetail | null,
): string {
  if (!detail) return `${outcome ?? ''}|`;
  const cards = [...detail.cards]
    .map((c) => `${c.key}:${c.applicability}`)
    .sort()
    .join(',');
  return [
    outcome ?? '',
    cards,
    detail.rule11g.applicable ? '11g' : '',
    detail.remuneration.applicable ? detail.remuneration.outcome : '',
    detail.remuneration.scheduleV.triggered ? 'schV' : '',
    detail.rule11Version?.effectiveFrom ?? '',
  ].join('|');
}

/** §20 completion checklist. 02.7 can be COMPLETE while cards stay Work Pending. */
export function otherReportingCompletion(d: {
  detail: OtherReportingDetail | null;
  decided: boolean;
  professionalAction: OtherReportingAction | null;
  partnerRequired: boolean;
  partnerApproved: boolean;
  needsReevaluation: boolean;
  isCompany: boolean | null;
  started: boolean;
  fraud: FraudFrameworkStatus;
  directors: DirectorDisqualificationStatus;
  crossRefs: ReportingCrossRefs;
}): OtherReportingCompletion {
  const det = d.detail;
  const cards = det?.cards ?? [];
  const card = (k: string) => cards.find((c) => c.key === k);
  const applicable = (k: string) => {
    const c = card(k);
    return c != null && !NOT_APPLICABLE.has(c.applicability);
  };
  const items: OtherReportingCompletionItem[] = [];
  const add = (key: string, label: string, met: boolean | null, detail: string | null = null) =>
    items.push({ key, label, met, detail });

  // A card pending on another sub-section's facts (02.6 branches) is shown but
  // does not hold 02.7 open — the engine marks those missing facts non-blocking.
  const nonBlocking = new Set(
    (det?.missingFacts ?? []).filter((m) => !m.blocking).map((m) => m.key),
  );
  const pending = cards.filter((c) => c.applicability === APPL.pending);
  const blockingPending = pending.filter((c) => !nonBlocking.has(c.key));
  const awaiting = pending.filter((c) => nonBlocking.has(c.key));
  add(
    'applicability',
    'Applicability of every statutory reporting obligation determined',
    det ? blockingPending.length === 0 : false,
    [
      blockingPending.length ? `Pending: ${blockingPending.map((c) => c.clause).join(', ')}` : null,
      awaiting.length
        ? `Awaiting other sub-sections: ${awaiting.map((c) => c.clause).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || null,
  );
  add(
    'rule11_version',
    'Rule 11 version in force for the audit period recorded',
    d.isCompany === false ? null : det?.rule11Version != null,
    det?.rule11Version ? `${det.rule11Version.code} from ${det.rule11Version.effectiveFrom}` : null,
  );
  const missingRules = (det?.missingFacts ?? []).filter((m) => m.key.startsWith('rule_'));
  add(
    'rules_library',
    'Rules Library values resolved for the audit period',
    d.isCompany === false ? null : det ? missingRules.length === 0 : false,
    missingRules.length ? missingRules.map((m) => m.label).join('; ') : null,
  );

  const g = det?.rule11g;
  const openSystems = (g?.systems ?? []).filter(
    (s) =>
      s.conclusion === AUDIT_TRAIL_CONCLUSION.furtherWork ||
      s.conclusion === AUDIT_TRAIL_CONCLUSION.pending,
  );
  add(
    'audit_trail',
    'Rule 11(g) software register completed',
    !g?.applicable || !applicable(CARD.r11gAuditTrail)
      ? null
      : g.systems.length > 0 && openSystems.length === 0,
    g?.applicable
      ? g.systems.length === 0
        ? 'No accounting software registered.'
        : openSystems.length
          ? `Further work: ${openSystems.map((s) => s.name).join(', ')}`
          : null
      : null,
  );
  const rem = det?.remuneration;
  add(
    'remuneration',
    'Section 197(16) remuneration assessed (public company)',
    !rem?.applicable || !applicable(CARD.s197Remuneration)
      ? null
      : rem.outcome !== REMUNERATION_OUTCOME.informationInsufficient,
    rem?.applicable ? rem.basis : null,
  );
  add(
    'directors',
    'Section 164(2) director workpaper concluded',
    !applicable(CARD.s143Directors)
      ? null
      : d.directors.conclusion === 'none_found' || d.directors.conclusion === 'identified',
    `${d.directors.total} director(s), ${d.directors.pending} pending`,
  );
  add(
    'fraud_framework',
    'Section 143(12) fraud framework available',
    d.isCompany === false ? null : d.fraud.active,
    d.fraud.overdue ? `${d.fraud.overdue} overdue deadline(s)` : null,
  );
  add(
    'cross_references',
    'CARO / ICFR / branch reporting cross-referenced to 02.4 / 02.5 / 02.6',
    d.isCompany === false
      ? null
      : (d.crossRefs.caro.applicable === false || d.crossRefs.caro.conclusion != null) &&
          (d.crossRefs.icfr.reportingRequired === false || d.crossRefs.icfr.conclusion != null),
    [
      d.crossRefs.caro.conclusion == null && d.crossRefs.caro.applicable !== false
        ? 'CARO (02.4) not concluded'
        : null,
      d.crossRefs.icfr.conclusion == null && d.crossRefs.icfr.reportingRequired !== false
        ? 'ICFR (02.5) not concluded'
        : null,
    ]
      .filter(Boolean)
      .join('; ') || null,
  );
  add(
    'conclusion',
    'Professional conclusion recorded (Confirm / Override)',
    d.decided,
    d.professionalAction === OTHER_REPORTING_ACTION.informationPending
      ? 'Information Pending recorded.'
      : null,
  );
  add(
    'partner_approval',
    'Engagement Partner approval of a significant override',
    d.partnerRequired ? d.partnerApproved : null,
  );
  add(
    'reevaluation',
    'No controlled re-evaluation outstanding',
    !d.needsReevaluation,
    d.needsReevaluation ? 'Facts changed after the conclusion — reassess.' : null,
  );

  const complete = items.every((i) => i.met !== false);
  return {
    complete,
    status: complete ? 'complete' : d.started || d.decided ? 'in_progress' : 'not_started',
    items,
  };
}

/**
 * The Section 02 rule_11 / section_143 area state that mirrors 02.7 — the
 * area's question is applicability (every company audit); 02.7 owns the
 * reporting matrix, so a 02.7 conclusion concludes the area.
 */
export function otherReportingLegacyMirror(
  isCompany: boolean | null,
  decided: boolean,
  isOverridden: boolean,
): {
  suggestion: FrameworkConclusion | null;
  conclusion: FrameworkConclusion | null;
  state: FrameworkState;
} {
  const suggestion: FrameworkConclusion | null =
    isCompany === true ? 'applicable' : isCompany === false ? 'not_applicable' : null;
  if (decided && suggestion)
    return { suggestion, conclusion: suggestion, state: isOverridden ? 'overridden' : suggestion };
  return {
    suggestion,
    conclusion: null,
    state:
      suggestion === 'applicable'
        ? 'system_suggested_applicable'
        : suggestion === 'not_applicable'
          ? 'system_suggested_not_applicable'
          : 'professional_judgement_required',
  };
}
