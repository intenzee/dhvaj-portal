import {
  CONSOLIDATION_OUTCOME_LABEL,
  FRAMEWORK_SOURCE_ANCHOR,
  FRAMEWORK_SOURCE_SECTIONS,
  ICFR_OUTCOME_LABEL,
  OTHER_REPORTING_OUTCOME_LABEL,
  SCHEDULE_III_OUTCOME_LABEL,
  SMALL_COMPANY_OUTCOME_LABEL,
  type DownstreamPreviewItem,
  type FrameworkBaselineStatus,
  type FrameworkCompletionCheck,
  type FrameworkDashboardRow,
  type FrameworkMemoCard,
  type FrameworkReturnItem,
  type FrameworkSourceSection,
  type FrameworkState,
  type FrameworkSummaryMatter,
  type FrameworkSummarySection,
  type FrameworkSummaryStatus,
  type SubSectionKey,
} from '@hsdg/contracts';

/**
 * 02.8 Audit Framework Summary — the pure rules (spec §3, §4, §9, §12, §15, §18).
 * No I/O: the summary service loads the facts and asks these functions what the
 * dashboard, the gates and the completion checklist are.
 */

/** Phase-02 framework area cards that have no 02.x workspace of their own. */
export const OTHER_AREA_KEYS = [
  'internal_audit',
  'cost_records',
  'secretarial_audit',
  'csr',
  'sa_matrix',
  'other_regulatory',
  'audit_reporting_framework',
] as const;

/** The legacy Phase-02 area rows each source section mirrors / owns. */
export const LEGACY_AREA_KEYS_BY_SECTION: Record<FrameworkSourceSection, readonly string[]> = {
  '02.1': ['entity_regulatory_profile'],
  '02.2': ['financial_reporting_framework', 'ind_as_as'],
  '02.3': ['schedule_iii'],
  '02.4': ['caro'],
  '02.5': ['ifc'],
  '02.6': ['cfs'],
  '02.7': ['rule_11', 'section_143'],
  other_areas: OTHER_AREA_KEYS,
};

/** Which Section 02 source an audit rule's area belongs to (null = not Section 02). */
export function sectionForRuleArea(areaKey: string): FrameworkSourceSection | null {
  switch (areaKey) {
    case 'entity_regulatory_profile':
      return '02.1';
    case 'financial_reporting_framework':
    case 'ind_as_as':
      return '02.2';
    case 'schedule_iii':
      return '02.3';
    case 'caro':
      return '02.4';
    case 'ifc':
      return '02.5';
    case 'cfs':
      return '02.6';
    case 'rule_11':
    case 'section_143':
    case 'other_reporting':
      return '02.7';
    default:
      return (OTHER_AREA_KEYS as readonly string[]).includes(areaKey) ? 'other_areas' : null;
  }
}

/** The Section 02 rule areas whose in-force versions the approval record freezes. */
export const SECTION_02_RULE_AREAS = [
  'entity_regulatory_profile',
  'financial_reporting_framework',
  'ind_as_as',
  'schedule_iii',
  'caro',
  'ifc',
  'cfs',
  'rule_11',
  'section_143',
  'other_reporting',
  ...OTHER_AREA_KEYS,
];

const FRF_LABEL: Record<string, string> = {
  ind_as: 'Ind AS',
  accounting_standards: 'Accounting Standards (AS)',
  specialised_framework: 'Specialised statutory framework',
  information_insufficient: 'Information Pending',
  professional_review_required: 'Further Assessment',
};

const CARO_LABEL: Record<string, string> = {
  applicable: 'CARO 2020 Applicable',
  not_applicable_exempt: 'Exempt',
  further_assessment: 'Further Assessment',
  information_insufficient: 'Information Pending',
};

/** The human conclusion of a 02.2–02.7 outcome string. */
export function conclusionLabel(sub: SubSectionKey, outcome: string | null): string | null {
  if (!outcome) return null;
  const table: Record<string, string> =
    sub === '02.2'
      ? FRF_LABEL
      : sub === '02.3'
        ? (SCHEDULE_III_OUTCOME_LABEL as Record<string, string>)
        : sub === '02.4'
          ? CARO_LABEL
          : sub === '02.5'
            ? (ICFR_OUTCOME_LABEL as Record<string, string>)
            : sub === '02.6'
              ? (CONSOLIDATION_OUTCOME_LABEL as Record<string, string>)
              : (OTHER_REPORTING_OUTCOME_LABEL as Record<string, string>);
  return table[outcome] ?? outcome.replace(/_/g, ' ');
}

/** The 02.1 profile facts the dashboard and the gates read. */
export interface ProfileSummaryFacts {
  state: 'draft' | 'confirmed' | null;
  listingAnswer: string | null;
  smallCompanyOutcome: string | null;
  smallCompanyOverride: string | null;
  smallCompanyOverrideReason: string | null;
  initialAudit: boolean | null;
  jointAudit: boolean | null;
  specialEntityTypes: string[];
  needsReevaluation: boolean;
}

/** "Unlisted · Small company · Continuing audit · NBFC" — the 02.1 conclusion. */
export function profileConclusion(p: ProfileSummaryFacts): string | null {
  if (p.state == null) return null;
  const parts: string[] = [];
  if (p.listingAnswer === 'yes') parts.push('Listed');
  else if (p.listingAnswer === 'no') parts.push('Unlisted');
  const sc = p.smallCompanyOverride ?? p.smallCompanyOutcome;
  if (sc)
    parts.push(
      (SMALL_COMPANY_OUTCOME_LABEL as Record<string, string>)[sc] ?? sc.replace(/_/g, ' '),
    );
  if (p.initialAudit != null) parts.push(p.initialAudit ? 'Initial audit' : 'Continuing audit');
  if (p.jointAudit) parts.push('Joint audit');
  for (const t of p.specialEntityTypes) parts.push(t.replace(/_/g, ' ').toUpperCase());
  return parts.length ? parts.join(' · ') : null;
}

/** A Phase-02 area card with no 02.x workspace. */
export interface OtherAreaFacts {
  areaKey: string;
  title: string;
  state: FrameworkState;
  conclusion: string | null;
  isOverridden: boolean;
  basis: string | null;
}

const DECIDED = new Set<string>(['applicable', 'not_applicable', 'overridden', 'approved']);

export function isDecidedState(state: string | null | undefined): boolean {
  return state != null && DECIDED.has(state);
}

/** Build the §4 dashboard: 02.1, 02.2–02.7 and the other framework areas. */
export function buildDashboard(input: {
  profile: ProfileSummaryFacts;
  sections: FrameworkSummarySection[];
  otherAreas: OtherAreaFacts[];
  matters: FrameworkSummaryMatter[];
  returns: FrameworkReturnItem[];
  preview: DownstreamPreviewItem[];
}): FrameworkDashboardRow[] {
  const openMatters = (s: FrameworkSourceSection) =>
    input.matters.filter((m) => m.open && m.source === s);
  const openReturns = (s: FrameworkSourceSection) =>
    input.returns.filter((r) => r.status === 'open' && r.section === s);
  const common = (s: FrameworkSourceSection): string[] => {
    const out: string[] = [];
    const m = openMatters(s);
    if (m.some((x) => x.blocking)) out.push('Blocking matter open');
    else if (m.length) out.push(`${m.length} open matter${m.length === 1 ? '' : 's'}`);
    for (const r of openReturns(s)) out.push(`Returned (${r.gate}): ${r.action}`);
    return out;
  };

  const rows: FrameworkDashboardRow[] = [];

  // 02.1 — the profile is complete once confirmed.
  {
    const p = input.profile;
    const attention: string[] = [];
    if (p.state !== 'confirmed') attention.push('Profile not confirmed');
    if (p.needsReevaluation) attention.push('Re-evaluation required');
    if (p.smallCompanyOverride && !p.smallCompanyOverrideReason?.trim())
      attention.push('Override reason missing');
    attention.push(...common('02.1'));
    rows.push({
      section: '02.1',
      title: 'Entity & Regulatory Profile',
      conclusion: profileConclusion(p),
      detail: null,
      status: attention.length ? 'attention_required' : 'complete',
      attention,
      state: null,
      decided: p.state === 'confirmed',
      isOverridden: p.smallCompanyOverride != null,
      ruleVersionId: null,
      anchor: FRAMEWORK_SOURCE_ANCHOR['02.1'],
    });
  }

  const previewResult = (key: string) => input.preview.find((p) => p.key === key)?.result ?? null;
  for (const s of input.sections) {
    const sub = s.subSectionKey as FrameworkSourceSection;
    const attention: string[] = [];
    if (!s.decided)
      attention.push(
        s.state === 'reassessment_required' ? 'Reassessment required' : 'Conclusion pending',
      );
    if (s.needsReevaluation) attention.push('Re-evaluation required');
    attention.push(...common(sub));
    const outcome = s.conclusion ?? s.systemOutcome;
    let detail: string | null = null;
    if (s.subSectionKey === '02.6') {
      const parts = [previewResult('component_auditor_work'), previewResult('branch_auditor_work')]
        .filter((x): x is string => x != null && x !== 'Not Required')
        .map((x, i) => (i === 0 ? `Components: ${x}` : `Branches: ${x}`));
      detail = parts.length ? parts.join(' · ') : null;
    }
    if (s.isOverridden) detail = detail ? `${detail} · Overridden` : 'Overridden';
    rows.push({
      section: sub,
      title: s.title,
      conclusion: conclusionLabel(s.subSectionKey, outcome),
      detail,
      status: attention.length ? 'attention_required' : 'complete',
      attention,
      state: s.state,
      decided: s.decided,
      isOverridden: s.isOverridden,
      ruleVersionId: s.ruleVersionId,
      anchor: FRAMEWORK_SOURCE_ANCHOR[sub],
    });
  }

  // Other framework areas — one row summarising the remaining Phase-02 cards.
  {
    const undecided = input.otherAreas.filter((a) => !isDecidedState(a.state));
    const applicable = input.otherAreas.filter(
      (a) => isDecidedState(a.state) && a.conclusion === 'applicable',
    );
    const attention: string[] = [];
    if (undecided.length)
      attention.push(
        `${undecided.length} area${undecided.length === 1 ? '' : 's'} undecided: ${undecided
          .map((a) => a.title)
          .join(', ')}`,
      );
    if (input.otherAreas.some((a) => a.state === 'reassessment_required'))
      attention.push('Reassessment required');
    attention.push(...common('other_areas'));
    rows.push({
      section: 'other_areas',
      title: 'Other framework areas',
      conclusion: input.otherAreas.length
        ? applicable.length
          ? `Applicable: ${applicable.map((a) => a.title).join(', ')}`
          : 'None applicable'
        : null,
      detail: input.otherAreas.length
        ? `${input.otherAreas.length - undecided.length}/${input.otherAreas.length} decided`
        : null,
      status: attention.length ? 'attention_required' : 'complete',
      attention,
      state: null,
      decided: input.otherAreas.length > 0 && undecided.length === 0,
      isOverridden: input.otherAreas.some((a) => a.isOverridden),
      ruleVersionId: null,
      anchor: FRAMEWORK_SOURCE_ANCHOR.other_areas,
    });
  }
  return rows;
}

/** An overridden sub-assessment / area whose reason is missing (§18). */
export function undocumentedOverrides(input: {
  sections: Array<{ title: string; isOverridden: boolean; basis: string | null }>;
  otherAreas: OtherAreaFacts[];
  profile: ProfileSummaryFacts;
}): string[] {
  const out: string[] = [];
  for (const s of input.sections) if (s.isOverridden && !s.basis?.trim()) out.push(s.title);
  for (const a of input.otherAreas) if (a.isOverridden && !a.basis?.trim()) out.push(a.title);
  if (input.profile.smallCompanyOverride && !input.profile.smallCompanyOverrideReason?.trim())
    out.push('Small company status (02.1)');
  return out;
}

/** Everything the §18 completion checklist and the gates read. */
export interface CompletionInput {
  dashboard: FrameworkDashboardRow[];
  sections: FrameworkSummarySection[];
  matters: FrameworkSummaryMatter[];
  undocumentedOverrides: string[];
  openReturns: number;
  baselineStatus: FrameworkBaselineStatus | null;
  previewReviewed: boolean;
  previewItemCount: number;
  memo: FrameworkMemoCard | null;
  isRevision: boolean;
  impactConfirmed: boolean;
  /** Approval record stored: methodology + rule versions. */
  versionsStored: boolean;
  viewerIsPartner: boolean;
}

export interface CompletionResult {
  checks: FrameworkCompletionCheck[];
  allSectionsDecided: boolean;
  hasBlockingMatter: boolean;
  canConfirm: boolean;
  canCreateMemo: boolean;
  canApprove: boolean;
  canReopen: boolean;
  confirmBlockers: string[];
  approveBlockers: string[];
}

/** The §18 completion rules and the AF-01 / AF-02 gates derived from them. */
export function evaluateCompletion(i: CompletionInput): CompletionResult {
  const undecidedRows = i.dashboard.filter((r) => !r.decided);
  const allSectionsDecided = i.dashboard.length > 0 && undecidedRows.length === 0;
  const missingConclusion = i.sections.filter(
    (s) => s.decided && !(s.conclusion ?? s.systemOutcome),
  );
  const blocking = i.matters.filter((m) => m.open && m.blocking);
  const openConsultations = i.matters.filter(
    (m) => m.open && m.category === 'partner_consultation',
  );
  const status = i.baselineStatus;
  const confirmed = status === 'manager_confirmed' || status === 'approved';
  const approved = status === 'approved';
  const memoSubmitted =
    i.memo != null && (i.memo.status === 'submitted' || i.memo.status === 'approved');

  const checks: FrameworkCompletionCheck[] = [
    {
      key: 'sections_complete',
      label: '02.1 through 02.7 are complete at framework level',
      met: allSectionsDecided,
      detail: undecidedRows.length ? undecidedRows.map((r) => r.title).join(', ') : null,
    },
    {
      key: 'conclusions_exist',
      label: 'All required framework conclusions exist',
      met: allSectionsDecided && missingConclusion.length === 0,
      detail: missingConclusion.length ? missingConclusion.map((s) => s.title).join(', ') : null,
    },
    {
      key: 'no_blocking_matter',
      label: 'No unresolved Blocking Matter remains',
      met: blocking.length === 0,
      detail: blocking.length ? blocking.map((m) => `${m.code} ${m.title}`).join('; ') : null,
    },
    {
      key: 'overrides_documented',
      label: 'System overrides have documented reasons',
      met: i.undocumentedOverrides.length === 0,
      detail: i.undocumentedOverrides.length ? i.undocumentedOverrides.join(', ') : null,
    },
    {
      key: 'consultations_complete',
      label: 'Required technical / Partner consultations are complete',
      met: openConsultations.length === 0,
      detail: openConsultations.length
        ? openConsultations.map((m) => `${m.code} ${m.title}`).join('; ')
        : null,
    },
    {
      key: 'preview_reviewed',
      label: 'Downstream Configuration Preview generated and reviewed',
      met: i.previewReviewed && i.previewItemCount > 0,
      detail: i.previewItemCount === 0 ? 'The preview produced no configuration items.' : null,
    },
    {
      key: 'manager_confirmed',
      label: 'AF-01 Manager confirmation is complete',
      met: confirmed,
      detail: null,
    },
    {
      key: 'memo_submitted',
      label: 'Audit Framework Memorandum generated and submitted',
      met: memoSubmitted,
      detail: i.memo ? `Memorandum status: ${i.memo.status}` : 'Not created yet',
    },
    {
      key: 'partner_approved',
      label: 'AF-02 Engagement Partner approval is recorded',
      met: approved,
      detail: null,
    },
    {
      key: 'versions_stored',
      label: 'Framework baseline and methodology / rule versions are stored',
      met: approved && i.versionsStored,
      detail: null,
    },
  ];

  const confirmBlockers: string[] = [];
  if (approved) confirmBlockers.push('The framework is already approved.');
  else if (status === 'manager_confirmed')
    confirmBlockers.push('AF-01 is already recorded; awaiting the Engagement Partner.');
  if (!allSectionsDecided)
    confirmBlockers.push(
      `Complete the source sections first: ${undecidedRows.map((r) => r.title).join(', ')}.`,
    );
  if (missingConclusion.length) confirmBlockers.push('A decided section has no conclusion.');
  if (blocking.length) confirmBlockers.push('A Blocking Matter is unresolved.');
  if (i.openReturns > 0)
    confirmBlockers.push(
      `${i.openReturns} returned item${i.openReturns === 1 ? '' : 's'} not yet cleared by the source section.`,
    );
  if (i.undocumentedOverrides.length)
    confirmBlockers.push(`Document the override reason: ${i.undocumentedOverrides.join(', ')}.`);
  if (openConsultations.length) confirmBlockers.push('A Partner consultation is still open.');
  if (i.isRevision && !i.impactConfirmed)
    confirmBlockers.push('Confirm the change-impact analysis of this revision first.');

  const approveBlockers: string[] = [];
  if (status !== 'manager_confirmed')
    approveBlockers.push(
      approved ? 'The framework is already approved.' : 'AF-01 Manager confirmation is required.',
    );
  if (blocking.length) approveBlockers.push('A Blocking Matter is unresolved.');
  if (status === 'manager_confirmed' && !memoSubmitted)
    approveBlockers.push('Create and submit the Audit Framework Memorandum.');
  if (!i.viewerIsPartner) approveBlockers.push('Only the Engagement Partner can record AF-02.');

  return {
    checks,
    allSectionsDecided,
    hasBlockingMatter: blocking.length > 0,
    canConfirm: confirmBlockers.length === 0,
    canCreateMemo: status === 'manager_confirmed',
    canApprove: approveBlockers.length === 0,
    canReopen: approved,
    confirmBlockers,
    approveBlockers,
  };
}

/** The displayed Framework Status (§3). */
export function summaryStatus(input: {
  baselineStatus: FrameworkBaselineStatus | null;
  isRevision: boolean;
  canConfirm: boolean;
}): FrameworkSummaryStatus {
  if (input.baselineStatus === 'approved') return 'approved';
  if (input.baselineStatus === 'manager_confirmed') return 'partner_review';
  if (input.isRevision) return 'reopened';
  return input.canConfirm ? 'ready_for_manager_review' : 'draft';
}

/** "FY 2024-25 · 01 Apr 2024 – 31 Mar 2025" from the engagement's financial year. */
export function auditPeriodLabel(
  financialYear: string,
  periodLabel: string | null,
): { label: string; start: string; end: string } {
  const startYear = Number(financialYear.slice(0, 4));
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  const prefix = periodLabel && periodLabel !== 'FY' ? `${periodLabel} · ` : '';
  return {
    label: `${prefix}FY ${financialYear} · 01 Apr ${startYear} – 31 Mar ${startYear + 1}`,
    start,
    end,
  };
}

/** v1.0 → 1.1 (a controlled revision). */
export function bumpMinor(version: string): string {
  const [major, minor] = version.split('.').map((n) => Number(n));
  return `${major}.${(minor ?? 0) + 1}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isSection(s: unknown): s is FrameworkSourceSection {
  return typeof s === 'string' && (FRAMEWORK_SOURCE_SECTIONS as readonly string[]).includes(s);
}

/** AF-01 "No" — every returned item names its section and the required action (§9). */
export function validateReturnItems(
  items: Array<{ section: string; action: string }> | undefined,
): string | null {
  if (!items || items.length === 0)
    return 'AF-01 "No" requires the affected section, the required action and an owner.';
  for (const it of items) {
    if (!isSection(it.section)) return `Unknown source section "${it.section}".`;
    if (!it.action?.trim()) return `State the required action for ${it.section}.`;
  }
  return null;
}

/** AF-02 "Approve Subject to Conditions" — condition, due date and impact each (§12). */
export function validateConditions(
  conditions:
    | Array<{ condition: string; dueDate: string; impact: string; planningMayCommence: boolean }>
    | undefined,
): string | null {
  if (!conditions || conditions.length === 0)
    return 'Approve Subject to Conditions requires at least one condition.';
  for (const c of conditions) {
    if (!c.condition?.trim()) return 'Each condition needs its text.';
    if (!ISO_DATE.test(c.dueDate ?? '') || Number.isNaN(Date.parse(c.dueDate)))
      return 'Each condition needs a due date (YYYY-MM-DD).';
    if (!c.impact?.trim()) return 'Each condition needs its impact.';
    if (typeof c.planningMayCommence !== 'boolean')
      return 'State whether Planning may commence before each condition is resolved.';
  }
  return null;
}

/** AF-02 "Return for Further Work" — reason and affected source section(s) (§12). */
export function validateReturnForFurtherWork(
  reason: string | null | undefined,
  sections: string[] | undefined,
): string | null {
  if (!reason?.trim()) return 'Return for Further Work requires a reason.';
  if (!sections || sections.length === 0)
    return 'Return for Further Work requires the affected source section(s).';
  const bad = sections.find((s) => !isSection(s));
  return bad ? `Unknown source section "${bad}".` : null;
}

/** Controlled reopen — the mandatory §15 fields. */
export function validateReopen(
  input: {
    reason: string;
    affectedSections: string[];
    identifiedAt: string;
    reapprovalRequired: boolean;
  },
  now: Date = new Date(),
): string | null {
  if (!input.reason?.trim()) return 'A reason is required to reopen the framework.';
  if (!input.affectedSections || input.affectedSections.length === 0)
    return 'Name the affected section(s) (02.1–02.7).';
  const bad = input.affectedSections.find((s) => !isSection(s));
  if (bad) return `Unknown source section "${bad}".`;
  const at = Date.parse(input.identifiedAt);
  if (Number.isNaN(at)) return 'State when the change was identified.';
  if (at > now.getTime() + 60_000) return 'The date identified cannot be in the future.';
  if (typeof input.reapprovalRequired !== 'boolean') return 'State whether reapproval is required.';
  return null;
}
