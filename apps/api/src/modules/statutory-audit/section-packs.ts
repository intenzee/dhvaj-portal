/**
 * Statutory Audit — Sections 01–04 drafted from the file.
 *
 * The same shape as the Section 09 sign-off and Section 10 archive packs: for
 * each section, what its approval needs (the server's own rule, so `ready`
 * matches what the approve endpoint enforces), what the approver should know
 * and never blocks, each with the facts behind it and where it is put right,
 * and a draft memo recorded when the approver leaves the memo blank.
 *
 *   01 Acceptance — segments resolved, blocking matters; adverse answers, the
 *      client's acknowledgement, master facts; a suggested conclusion.
 *   02 Framework  — every area decided, blocking matters; overrides with no
 *      basis, other matters.
 *   03 Planning   — framework approved, every sub-area complete; materiality
 *      set and consistent, completed sub-areas with nothing written.
 *   04 Risk       — no approval of its own: planning approved, a register, a
 *      response for every significant risk (§29); SA 240 presumed risks,
 *      procedures answering significant risks, details still blank.
 *
 * Pure: no database, unit-tested on its own.
 */
import {
  ACCEPTANCE_QUESTIONS,
  ACCEPTANCE_SEGMENT_KEY,
  FRAMEWORK_DECIDED_STATES,
  type AcceptanceConclusion,
  type AcceptancePack,
  type CompletionGoTo,
  type FrameworkState,
  type SectionPack,
  type SignOffCheck,
} from '@hsdg/contracts';
import { money, periodEndLabel } from './completion-automation';

const MAX_LISTED = 4;

function listed(names: readonly string[]): string[] {
  const out = names.slice(0, MAX_LISTED).map((n) => `• ${n}`);
  if (names.length > MAX_LISTED) out.push(`+${names.length - MAX_LISTED} more`);
  return out;
}

function check(
  key: string,
  label: string,
  ok: boolean,
  blocking: boolean,
  facts: string[],
  goTo: CompletionGoTo,
): SignOffCheck {
  return { key, label, ok, blocking, facts, goTo: ok ? null : goTo };
}

function pack(checks: SignOffCheck[], draftMemo: string | null): SectionPack {
  return {
    checks,
    ready: checks.filter((c) => c.blocking).every((c) => c.ok),
    attention: checks.filter((c) => !c.blocking && !c.ok).length,
    draftMemo,
  };
}

function heading(section: string, financialYear: string | null): string {
  return `${section} — financial year ${financialYear ?? ''} (period ended ${periodEndLabel(financialYear)}).`;
}

const go = (phaseKey: string, label: string, anchor?: string): CompletionGoTo =>
  anchor ? { phaseKey, label, anchor } : { phaseKey, label };

export interface PackMatter {
  title: string;
  isBlocking: boolean;
  severity: string | null;
}

// ── 01 Acceptance ────────────────────────────────────────────────────────────

export interface AcceptancePackFacts {
  financialYear: string | null;
  segments: readonly {
    segmentKey: string;
    title: string;
    state: string;
    answers: readonly { questionKey: string; answer: string | null; narrative: string | null }[];
  }[];
  /** Open acceptance matters (open / under review / blocking). */
  openMatters: readonly PackMatter[];
  /** Engagement-profile facts the client master does not hold yet. */
  missingMasterFacts: readonly string[];
}

const RESOLVED_SEGMENT = ['complete', 'not_applicable'];

/** Short form of a question prompt for a fact line. */
function prompt(questionKey: string): string {
  const q = ACCEPTANCE_QUESTIONS.find((x) => x.questionKey === questionKey);
  return (q?.prompt ?? questionKey).replace(/\.$/, '');
}

function conclusionLine(c: AcceptanceConclusion): string {
  return c === 'decline'
    ? 'Conclusion: decline — a critical concern prevents acceptance.'
    : c === 'accept_with_conditions'
      ? 'Conclusion: accept with conditions — the concerns above are addressed by the safeguards recorded.'
      : 'Conclusion: accept — the firm is eligible and independent, the preconditions for an audit are present and the engagement letter is in place.';
}

/** The drafted memo, ending on the conclusion the partner actually chose. */
export function acceptanceMemoFor(draftMemo: string, conclusion: AcceptanceConclusion): string {
  const lines = draftMemo.split('\n');
  lines[lines.length - 1] = conclusionLine(conclusion);
  return lines.join('\n');
}

export function planAcceptance(f: AcceptancePackFacts): AcceptancePack {
  const checks: SignOffCheck[] = [];
  const segments = f.segments.filter(
    (s) => s.segmentKey !== ACCEPTANCE_SEGMENT_KEY.finalAcceptance,
  );
  const questionsIn = (key: string) => ACCEPTANCE_QUESTIONS.filter((q) => q.segmentKey === key);
  const answered = (s: (typeof segments)[number]) =>
    s.answers.filter((a) => a.answer != null).length;

  const open = segments.filter((s) => !RESOLVED_SEGMENT.includes(s.state));
  checks.push(
    check(
      'segments_resolved',
      'Acceptance segments resolved (01.1–01.7)',
      open.length === 0,
      true,
      open.length === 0
        ? [`All ${segments.length} segments complete or not applicable.`]
        : [
            `${segments.length - open.length} of ${segments.length} segments resolved; still open:`,
            ...listed(
              open.map((s) => {
                const total = questionsIn(s.segmentKey).length;
                return total > 0 ? `${s.title} — ${answered(s)} of ${total} answered` : s.title;
              }),
            ),
          ],
      go(
        'acceptance',
        `Open ${open[0]?.title ?? 'acceptance'}`,
        open[0] && `segment-${open[0].segmentKey}`,
      ),
    ),
  );

  const blocking = f.openMatters.filter((m) => m.isBlocking);
  checks.push(
    check(
      'blocking_matters',
      'No blocking acceptance matter',
      blocking.length === 0,
      true,
      blocking.length === 0
        ? ['No blocking matter is open.']
        : [`${blocking.length} blocking matter(s) open:`, ...listed(blocking.map((m) => m.title))],
      go('acceptance', 'Open matters', 'acceptance-matters'),
    ),
  );

  // What the partner should know.
  const adverse = segments.flatMap((s) =>
    s.answers
      .filter((a) => {
        const q = ACCEPTANCE_QUESTIONS.find((x) => x.questionKey === a.questionKey);
        return q && a.answer === q.adverseAnswer;
      })
      .map((a) => ({ segment: s, answer: a })),
  );
  const firstAdverse = adverse[0];
  checks.push(
    check(
      'adverse_answers',
      'Answers that raise a concern',
      adverse.length === 0,
      false,
      adverse.length === 0
        ? ['No answer raises a concern.']
        : [
            `${adverse.length} answer(s) raise a concern:`,
            ...listed(
              adverse.map(
                ({ answer }) =>
                  `${prompt(answer.questionKey)} — ${answer.answer}${answer.narrative?.trim() ? '' : ', no explanation recorded'}`,
              ),
            ),
          ],
      go(
        'acceptance',
        `Open ${firstAdverse?.segment.title ?? 'acceptance'}`,
        firstAdverse && `segment-${firstAdverse.segment.segmentKey}`,
      ),
    ),
  );

  const ack = segments
    .find((s) => s.segmentKey === ACCEPTANCE_SEGMENT_KEY.engagementLetter)
    ?.answers.find((a) => a.questionKey === 'client_acknowledged');
  checks.push(
    check(
      'client_acknowledged',
      'Engagement letter acknowledged by the client',
      ack?.answer === 'yes',
      false,
      ack?.answer === 'yes'
        ? ['The client has acknowledged the engagement letter.']
        : ack?.answer === 'no'
          ? ['The client has not acknowledged the engagement letter yet.']
          : ['Not recorded yet whether the client has acknowledged the engagement letter.'],
      go(
        'acceptance',
        'Open engagement letter',
        `segment-${ACCEPTANCE_SEGMENT_KEY.engagementLetter}`,
      ),
    ),
  );

  checks.push(
    check(
      'master_facts',
      'Engagement profile complete on the client master',
      f.missingMasterFacts.length === 0,
      false,
      f.missingMasterFacts.length === 0
        ? ['Every engagement-profile fact is on the client master.']
        : [
            `${f.missingMasterFacts.length} fact(s) not on the client master:`,
            ...listed(f.missingMasterFacts),
          ],
      go('acceptance', 'Open engagement profile', 'engagement-profile'),
    ),
  );

  const others = f.openMatters.filter((m) => !m.isBlocking);
  checks.push(
    check(
      'other_matters',
      'Other open matters',
      others.length === 0,
      false,
      others.length === 0
        ? ['No other matter is open.']
        : [`${others.length} matter(s) open:`, ...listed(others.map((m) => m.title))],
      go('acceptance', 'Open matters', 'acceptance-matters'),
    ),
  );

  // Suggested conclusion: a critical concern points to declining; any concern
  // or open matter to accepting with conditions; otherwise accept.
  const critical =
    adverse.some(
      ({ answer }) =>
        ACCEPTANCE_QUESTIONS.find((q) => q.questionKey === answer.questionKey)?.severity ===
        'critical',
    ) || blocking.some((m) => m.severity === 'critical');
  const suggestedConclusion: AcceptanceConclusion = critical
    ? 'decline'
    : adverse.length > 0 || f.openMatters.length > 0
      ? 'accept_with_conditions'
      : 'accept';

  const lines = [heading('Engagement acceptance', f.financialYear)];
  for (const s of segments) {
    if (s.state === 'not_applicable') {
      lines.push(`${s.title}: not applicable.`);
      continue;
    }
    const concerns = adverse.filter((a) => a.segment.segmentKey === s.segmentKey);
    const total = questionsIn(s.segmentKey).length;
    if (concerns.length > 0) {
      lines.push(
        `${s.title}: ${concerns
          .map(
            ({ answer }) =>
              `${prompt(answer.questionKey)} — ${answer.answer}${answer.narrative?.trim() ? ` (${answer.narrative.trim()})` : ''}`,
          )
          .join('; ')}.`,
      );
    } else if (total > 0 && answered(s) === total) {
      lines.push(`${s.title}: no concerns.`);
    } else if (total > 0) {
      lines.push(`${s.title}: ${answered(s)} of ${total} questions answered.`);
    }
  }
  if (f.openMatters.length > 0) {
    lines.push(`Open matters: ${f.openMatters.map((m) => m.title).join('; ')}.`);
  }
  // No conclusion is claimed while segments are still open; recording the
  // approval replaces this line with the conclusion chosen.
  lines.push(
    open.length > 0
      ? `Conclusion: not yet reached — ${open.length} segment(s) still open.`
      : conclusionLine(suggestedConclusion),
  );

  return { ...pack(checks, lines.join('\n')), suggestedConclusion };
}

// ── 02 Framework ─────────────────────────────────────────────────────────────

export interface FrameworkPackFacts {
  financialYear: string | null;
  areas: readonly {
    title: string;
    kind: 'applicability' | 'descriptive';
    state: FrameworkState;
    conclusion: string | null;
    isOverridden: boolean;
    basis: string | null;
  }[];
  openMatters: readonly PackMatter[];
}

const UNDECIDED_LABEL: Partial<Record<FrameworkState, string>> = {
  not_assessed: 'not assessed',
  pending_information: 'waiting for figures on the client master',
  system_suggested_applicable: 'suggested applicable — accept or override',
  system_suggested_not_applicable: 'suggested not applicable — accept or override',
  professional_judgement_required: 'needs professional judgement',
  reassessment_required: 'reopened for reassessment',
};

export function planFramework(f: FrameworkPackFacts): SectionPack {
  const checks: SignOffCheck[] = [];
  const undecided = f.areas.filter((a) => !FRAMEWORK_DECIDED_STATES.includes(a.state));
  const suggested = undecided.filter((a) => a.state.startsWith('system_suggested_'));
  checks.push(
    check(
      'areas_decided',
      'Every framework area concluded (02.1–02.8)',
      undecided.length === 0,
      true,
      undecided.length === 0
        ? [`All ${f.areas.length} areas concluded.`]
        : [
            `${f.areas.length - undecided.length} of ${f.areas.length} areas concluded; still open:`,
            ...listed(undecided.map((a) => `${a.title} — ${UNDECIDED_LABEL[a.state] ?? a.state}`)),
            ...(suggested.length > 0
              ? [
                  `${suggested.length} only need the suggestion accepted — "Accept all" does them in one step.`,
                ]
              : []),
          ],
      go('framework', 'Open framework'),
    ),
  );

  const blocking = f.openMatters.filter((m) => m.isBlocking);
  checks.push(
    check(
      'blocking_matters',
      'No blocking framework matter',
      blocking.length === 0,
      true,
      blocking.length === 0
        ? ['No blocking matter is open.']
        : [`${blocking.length} blocking matter(s) open:`, ...listed(blocking.map((m) => m.title))],
      go('framework', 'Open matters', 'framework-matters'),
    ),
  );

  const bareOverrides = f.areas.filter((a) => a.isOverridden && !a.basis?.trim());
  checks.push(
    check(
      'override_basis',
      'Overrides carry a basis',
      bareOverrides.length === 0,
      false,
      bareOverrides.length === 0
        ? [
            f.areas.some((a) => a.isOverridden)
              ? 'Every override of a suggestion records its basis.'
              : 'No suggestion has been overridden.',
          ]
        : [
            `${bareOverrides.length} override(s) with no basis recorded:`,
            ...listed(bareOverrides.map((a) => a.title)),
          ],
      go('framework', 'Open framework'),
    ),
  );

  const others = f.openMatters.filter((m) => !m.isBlocking);
  checks.push(
    check(
      'other_matters',
      'Other open matters',
      others.length === 0,
      false,
      others.length === 0
        ? ['No other matter is open.']
        : [`${others.length} matter(s) open:`, ...listed(others.map((m) => m.title))],
      go('framework', 'Open matters', 'framework-matters'),
    ),
  );

  const titles = (pred: (a: FrameworkPackFacts['areas'][number]) => boolean) =>
    f.areas.filter(pred).map((a) => a.title);
  const applicable = titles((a) => a.kind === 'applicability' && a.conclusion === 'applicable');
  const notApplicable = titles(
    (a) => a.kind === 'applicability' && a.conclusion === 'not_applicable',
  );
  const confirmed = titles((a) => a.kind === 'descriptive' && a.conclusion != null);
  const overrides = f.areas.filter((a) => a.isOverridden);
  const memo = [
    heading('Audit framework', f.financialYear),
    ...(confirmed.length > 0 ? [`Confirmed: ${confirmed.join(', ')}.`] : []),
    `Applicable: ${applicable.length > 0 ? applicable.join(', ') : 'none'}.`,
    `Not applicable: ${notApplicable.length > 0 ? notApplicable.join(', ') : 'none'}.`,
    ...(overrides.length > 0
      ? [
          `Overridden suggestions: ${overrides
            .map((a) => `${a.title}${a.basis?.trim() ? ` (${a.basis.trim()})` : ''}`)
            .join('; ')}.`,
        ]
      : [
          'Every conclusion agrees with the suggestion from the client master and the Audit Rules Library.',
        ]),
    ...(undecided.length > 0
      ? [`Still to conclude: ${undecided.map((a) => a.title).join(', ')}.`]
      : []),
    'The audit framework above sets the reports, workstreams and procedures for this engagement.',
  ].join('\n');

  return pack(checks, memo);
}

// ── 03 Planning ──────────────────────────────────────────────────────────────

export interface PlanningPackFacts {
  financialYear: string | null;
  frameworkApproved: boolean;
  items: readonly { itemKey: string; title: string; state: string; narrative: string | null }[];
  materiality: {
    overall: number | null;
    performance: number | null;
    trivial: number | null;
    benchmark: string | null;
  } | null;
}

/** Sub-areas backed by their own workspace (03.1–03.5) — no narrative is expected. */
const STRUCTURED_ITEMS = [
  'audit_strategy',
  'engagement_understanding',
  'materiality',
  'audit_approach',
  'overall_audit_plan',
  'areas_and_assertions',
];

export function planPlanning(f: PlanningPackFacts): SectionPack {
  const checks: SignOffCheck[] = [];
  checks.push(
    check(
      'framework_approved',
      'Framework approved (02)',
      f.frameworkApproved,
      true,
      [
        f.frameworkApproved
          ? 'The framework memo is approved.'
          : 'The framework memo is not approved yet — planning is approved after it.',
      ],
      go('framework', 'Open framework'),
    ),
  );

  const incomplete = f.items.filter((i) => i.state !== 'complete');
  checks.push(
    check(
      'items_complete',
      'Every planning sub-area complete',
      incomplete.length === 0,
      true,
      incomplete.length === 0
        ? [`All ${f.items.length} sub-areas complete.`]
        : [
            `${f.items.length - incomplete.length} of ${f.items.length} sub-areas complete; not yet:`,
            ...listed(incomplete.map((i) => `${i.title} (${i.state.replace(/_/g, ' ')})`)),
          ],
      go(
        'planning',
        `Open ${incomplete[0]?.title ?? 'planning'}`,
        incomplete[0] && `planning-${incomplete[0].itemKey}`,
      ),
    ),
  );

  const m = f.materiality;
  const problems: string[] = [];
  if (!m || m.overall == null) problems.push('Overall materiality is not set.');
  if (!m || m.performance == null) problems.push('Performance materiality is not set.');
  if (!m || m.trivial == null) problems.push('The clearly-trivial threshold is not set.');
  if (m?.overall != null && m.performance != null && m.performance > m.overall)
    problems.push('Performance materiality is above overall materiality.');
  if (m?.performance != null && m.trivial != null && m.trivial > m.performance)
    problems.push('The clearly-trivial threshold is above performance materiality.');
  if (m && m.overall != null && !m.benchmark?.trim()) problems.push('No benchmark recorded.');
  checks.push(
    check(
      'materiality',
      'Materiality set',
      problems.length === 0,
      false,
      problems.length === 0
        ? [
            `Overall ${money(m!.overall)}, performance ${money(m!.performance)}, clearly trivial ${money(m!.trivial)}${m!.benchmark ? ` — ${m!.benchmark}` : ''}.`,
          ]
        : problems,
      go('planning', 'Open materiality', 'planning-materiality'),
    ),
  );

  const empty = f.items.filter(
    (i) => i.state === 'complete' && !STRUCTURED_ITEMS.includes(i.itemKey) && !i.narrative?.trim(),
  );
  checks.push(
    check(
      'narratives',
      'Completed sub-areas say what was planned',
      empty.length === 0,
      false,
      empty.length === 0
        ? ['Every completed sub-area records its planning.']
        : [
            `${empty.length} completed sub-area(s) with nothing written:`,
            ...listed(empty.map((i) => i.title)),
          ],
      go(
        'planning',
        `Open ${empty[0]?.title ?? 'planning'}`,
        empty[0] && `planning-${empty[0].itemKey}`,
      ),
    ),
  );

  const done = f.items.filter((i) => i.state === 'complete').map((i) => i.title);
  const memo: string[] = [
    heading('Audit planning', f.financialYear),
    f.frameworkApproved
      ? 'The audit framework (Section 02) is approved.'
      : 'The audit framework (Section 02) is not yet approved.',
    m && m.overall != null
      ? `Materiality: overall ${money(m.overall)}${m.benchmark ? ` (${m.benchmark})` : ''}${m.performance != null ? `, performance ${money(m.performance)}` : ''}${m.trivial != null ? `, clearly trivial ${money(m.trivial)}` : ''}.`
      : 'Materiality: not yet set.',
    `Planning documented: ${done.length > 0 ? done.join(', ') : 'none'}${incomplete.length > 0 ? `; still open: ${incomplete.map((i) => i.title).join(', ')}` : ''}.`,
  ];
  const p = pack(checks, '');
  memo.push(
    p.ready
      ? 'The overall audit strategy and plan are approved; risk assessment (Section 04) proceeds on this basis.'
      : 'Not yet ready for approval — see what approval needs.',
  );
  return { ...p, draftMemo: memo.join('\n') };
}

// ── 04 Risk ──────────────────────────────────────────────────────────────────

export interface RiskPackFacts {
  planningApproved: boolean;
  risks: readonly {
    id: string;
    riskRef: string;
    description: string;
    fsArea: string | null;
    assertion: string | null;
    rating: string;
    isSignificant: boolean;
    isFraudRisk: boolean;
    response: string | null;
    ownerName: string | null;
    sourceKey: string | null;
  }[];
  /** Procedures in the audit work, by the risk they answer. */
  procedures: readonly { riskId: string | null }[];
}

export function planRisk(f: RiskPackFacts): SectionPack {
  const checks: SignOffCheck[] = [];
  const name = (r: RiskPackFacts['risks'][number]) => `${r.riskRef} ${r.description}`;
  checks.push(
    check(
      'planning_approved',
      'Planning approved (03)',
      f.planningApproved,
      true,
      [
        f.planningApproved
          ? 'Planning is approved.'
          : 'Planning is not approved yet — the register builds on it.',
      ],
      go('planning', 'Open planning'),
    ),
  );

  checks.push(
    check(
      'register',
      'Risks identified',
      f.risks.length > 0,
      true,
      f.risks.length > 0
        ? [
            `${f.risks.length} risk(s) on the register, ${f.risks.filter((r) => r.isSignificant || r.rating === 'significant').length} significant.`,
          ]
        : ['The register is empty — "Suggest risks" drafts it from Sections 02–03.'],
      go('risk', 'Open risk register'),
    ),
  );

  const significant = f.risks.filter((r) => r.isSignificant || r.rating === 'significant');
  const noResponse = significant.filter((r) => !r.response?.trim());
  checks.push(
    check(
      'significant_responses',
      'A response for every significant risk (§29)',
      noResponse.length === 0,
      true,
      significant.length === 0
        ? ['No significant risk on the register.']
        : noResponse.length === 0
          ? [`All ${significant.length} significant risk(s) have a planned response.`]
          : [
              `${noResponse.length} of ${significant.length} significant risk(s) without a planned response:`,
              ...listed(noResponse.map(name)),
            ],
      go('risk', 'Open risk register', noResponse[0] && `risk-${noResponse[0].id}`),
    ),
  );

  const answered = new Set(f.procedures.map((p) => p.riskId).filter(Boolean));
  const noProcedure = significant.filter((r) => !answered.has(r.id));
  checks.push(
    check(
      'significant_procedures',
      'Audit work answers every significant risk',
      noProcedure.length === 0,
      false,
      significant.length === 0
        ? ['No significant risk to answer.']
        : noProcedure.length === 0
          ? [`Every significant risk has a procedure in the audit work.`]
          : [
              `${noProcedure.length} significant risk(s) with no procedure in the audit work:`,
              ...listed(noProcedure.map(name)),
            ],
      go('audit_areas', 'Open audit work'),
    ),
  );

  const presumed: [string, string][] = [
    ['sa240:management_override', 'Management override of controls'],
    ['sa240:revenue_recognition', 'Fraud in revenue recognition'],
  ];
  const missing = presumed.filter(([key]) => !f.risks.some((r) => r.sourceKey === key));
  checks.push(
    check(
      'presumed_risks',
      'SA 240 presumed fraud risks',
      missing.length === 0,
      false,
      missing.length === 0
        ? ['Management override and revenue recognition are both on the register.']
        : [
            `Not on the register: ${missing.map(([, l]) => l).join(', ')}.`,
            'SA 240 presumes these; add them, or record why the revenue presumption is rebutted.',
          ],
      go('risk', 'Open risk register'),
    ),
  );

  const blanks = f.risks.filter((r) => !r.fsArea?.trim() || !r.assertion || !r.ownerName);
  checks.push(
    check(
      'risk_details',
      'Area, assertion and owner on every risk',
      blanks.length === 0,
      false,
      blanks.length === 0
        ? ['Every risk names its area, assertion and owner.']
        : [
            `${blanks.length} risk(s) with details missing:`,
            ...listed(
              blanks.map((r) => {
                const gaps = [
                  !r.fsArea?.trim() && 'area',
                  !r.assertion && 'assertion',
                  !r.ownerName && 'owner',
                ].filter(Boolean);
                return `${r.riskRef} — no ${gaps.join(', ')}`;
              }),
            ),
          ],
      go('risk', 'Open risk register', blanks[0] && `risk-${blanks[0].id}`),
    ),
  );

  return pack(checks, null);
}
