import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_MATTER_CATEGORY_LABEL,
  FRAMEWORK_SOURCE_SECTION_LABEL,
  REPORTING_APPLICABILITY,
  REPORTING_APPLICABILITY_LABEL,
  SUB_SECTION_KEY,
  formatInrCrore,
  type FrameworkSnapshotFacts,
  type ReportingApplicability,
  type StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import { formatLongDate } from './acceptance-merge-values';
import { readOtherReportingResultOn } from './other-reporting-read';

/**
 * The Audit Framework Memorandum merge values (02.8 §10): one `afm.*` field per
 * memorandum section (16) plus the numerical tests. Every value is drawn from
 * the approved framework — the 02.8 summary, the 02.x bases and the engines'
 * stored detail — never re-entered. Where a conclusion depends on a threshold,
 * the memo shows "Actual | Limit | Operator | Result", not "criteria satisfied".
 */

/** One numerical test line (§10). */
/** A section's stored system_detail — shapes vary by 02.x, every read is guarded. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDetail = Record<string, any>;

export interface MemoNumericTest {
  label: string;
  actual: string | null;
  limit: string | null;
  operator: string | null;
  result: string;
}

/** The 02.x bases and engine detail the memorandum reads beyond the summary. */
export interface FrameworkMemoDetails {
  bases: Array<{
    subSectionKey: string;
    title: string;
    systemOutcome: string | null;
    systemBasis: string | null;
    conclusion: string | null;
    basis: string | null;
    isOverridden: boolean;
  }>;
  profile: {
    smallCompanyBasis: string | null;
    smallCompanyOverrideReason: string | null;
    specialEntityTypes: string[];
    regulator: string | null;
  };
  numericTests: MemoNumericTest[];
  reportingCards: Array<{
    requirement: string;
    clause: string;
    applicability: ReportingApplicability;
  }>;
  perimeter: Array<{ name: string; relationship: string; method: string; included: string }>;
}

const RESULT_LABEL: Record<string, string> = {
  satisfied: 'Pass',
  met: 'Pass',
  pass: 'Pass',
  failed: 'Fail',
  not_met: 'Fail',
  fail: 'Fail',
  pending: 'Pending',
  not_tested: 'Not tested',
};

export function numericLine(t: MemoNumericTest): string {
  return [
    t.label,
    `Actual ${t.actual ?? '—'}`,
    `Limit ${t.limit ?? '—'}`,
    `Operator ${t.operator ?? '—'}`,
    `Result: ${t.result}`,
  ].join(' | ');
}

interface StoredCondition {
  label?: string;
  result?: string;
  operator?: string | null;
  actualDisplay?: string | null;
  limitDisplay?: string | null;
  actual?: number | null;
  threshold?: number | null;
}

function conditionTests(
  prefix: string,
  conditions: StoredCondition[] | undefined,
): MemoNumericTest[] {
  return (conditions ?? [])
    .filter((c) => c.result && c.result !== 'not_tested' && (c.actualDisplay || c.actual != null))
    .map((c) => ({
      label: `${prefix} — ${c.label ?? 'condition'}`,
      actual: c.actualDisplay ?? (c.actual != null ? formatInrCrore(c.actual) : null),
      limit: c.limitDisplay ?? (c.threshold != null ? formatInrCrore(c.threshold) : null),
      operator: c.operator ?? null,
      result: RESULT_LABEL[c.result!] ?? c.result!,
    }));
}

const crore = (v: number | null | undefined) => (v == null ? null : formatInrCrore(v));

/** Read the bases, the profile classification and the stored engine detail (DI-free). */
export async function readFrameworkMemoDetailsOn(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<FrameworkMemoDetails> {
  const { rows: subs } = await client.query<{
    sub_section_key: string;
    area_key: string;
    title: string;
    system_outcome: string | null;
    system_basis: string | null;
    conclusion: string | null;
    basis: string | null;
    is_overridden: boolean;
    system_detail: Record<string, unknown> | null;
  }>(
    `SELECT sub_section_key, area_key, title, system_outcome, system_basis, conclusion, basis,
            is_overridden, system_detail
       FROM hsdg.audit_framework_subassessment
      WHERE workflow_instance_id = $1
      ORDER BY sub_section_key`,
    [workflowInstanceId],
  );
  const { rows: prof } = await client.query<{
    small_company_basis: string | null;
    small_company_override_reason: string | null;
    special_entity_types: string[] | null;
    regulator: string | null;
  }>(
    `SELECT small_company_basis, small_company_override_reason, special_entity_types, regulator
       FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
    [workflowInstanceId],
  );
  const detailOf = (sub: string) =>
    (subs.find((s) => s.sub_section_key === sub)?.system_detail ?? null) as LooseDetail | null;

  const tests: MemoNumericTest[] = [];
  const frf = detailOf(SUB_SECTION_KEY.financialReporting);
  if (frf?.netWorth?.value != null && frf.netWorth.threshold != null)
    tests.push({
      label: 'Ind AS net-worth test (02.2)',
      actual: crore(frf.netWorth.value),
      limit: crore(frf.netWorth.threshold),
      operator: '≥',
      result:
        frf.netWorth.result === 'met' || frf.netWorth.value >= frf.netWorth.threshold
          ? 'Threshold met'
          : 'Below threshold',
    });
  const smc = frf?.smc;
  if (smc?.turnover != null && smc.turnoverThreshold != null)
    tests.push({
      label: 'SMC turnover test (02.2)',
      actual: crore(smc.turnover),
      limit: crore(smc.turnoverThreshold),
      operator: '≤',
      result: smc.turnover <= smc.turnoverThreshold ? 'Pass' : 'Fail',
    });
  if (smc?.borrowings != null && smc.borrowingsThreshold != null)
    tests.push({
      label: 'SMC borrowings test (02.2)',
      actual: crore(smc.borrowings),
      limit: crore(smc.borrowingsThreshold),
      operator: '≤',
      result: smc.borrowings <= smc.borrowingsThreshold ? 'Pass' : 'Fail',
    });
  const caro = detailOf(SUB_SECTION_KEY.caro);
  tests.push(...conditionTests('CARO private-company test (02.4)', caro?.privateTest?.conditions));
  const icfr = detailOf(SUB_SECTION_KEY.icfr);
  tests.push(...conditionTests('ICFR exemption test (02.5)', icfr?.conditions));

  const other = await readOtherReportingResultOn(client, workflowInstanceId);
  const cfs = subs.find((s) => s.area_key === FRAMEWORK_AREA_KEY.cfs)?.system_detail as {
    perimeter?: Array<{ name?: string; relationship?: string; method?: string; included?: string }>;
  } | null;
  return {
    bases: subs.map((s) => ({
      subSectionKey: s.sub_section_key,
      title: s.title,
      systemOutcome: s.system_outcome,
      systemBasis: s.system_basis,
      conclusion: s.conclusion,
      basis: s.basis,
      isOverridden: s.is_overridden,
    })),
    profile: {
      smallCompanyBasis: prof[0]?.small_company_basis ?? null,
      smallCompanyOverrideReason: prof[0]?.small_company_override_reason ?? null,
      specialEntityTypes: prof[0]?.special_entity_types ?? [],
      regulator: prof[0]?.regulator ?? null,
    },
    numericTests: tests,
    reportingCards: (other?.cards ?? []).map((c) => ({
      requirement: c.requirement,
      clause: c.clause,
      applicability: c.applicability,
    })),
    perimeter: (cfs?.perimeter ?? [])
      .filter((p) => p.name?.trim())
      .map((p) => ({
        name: p.name!.trim(),
        relationship: p.relationship ?? 'none',
        method: p.method ?? 'none',
        included: p.included ?? 'no',
      })),
  };
}

const lines = (xs: Array<string | null | undefined>, none = 'None.') => {
  const kept = xs.filter((x): x is string => !!x && x.trim().length > 0);
  return kept.length ? kept.join('\n') : none;
};
const human = (v: string | null | undefined) => (v ? v.replace(/_/g, ' ') : null);

/** The `afm.*` merge values of the memorandum (pure). */
export function frameworkMemorandumValues(
  s: StatutoryAuditFrameworkSummary,
  d: FrameworkMemoDetails,
  facts: FrameworkSnapshotFacts,
): Record<string, string> {
  const row = (section: string) => s.dashboard.find((r) => r.section === section);
  const base = (sub: string) => d.bases.find((b) => b.subSectionKey === sub);
  const conclusionOf = (section: string, sub?: string) => {
    const r = row(section);
    const b = sub ? base(sub) : undefined;
    return lines([
      r
        ? `Conclusion: ${r.conclusion ?? 'Not concluded'}${r.detail ? ` (${r.detail})` : ''}`
        : null,
      b?.basis ? `Basis: ${b.basis}` : b?.systemBasis ? `Basis: ${b.systemBasis}` : null,
    ]);
  };
  const tests = (needle: string) =>
    d.numericTests.filter((t) => t.label.includes(needle)).map(numericLine);
  const h = s.header;
  const baseline = s.baseline;

  const applicableCards = d.reportingCards.filter(
    (c) =>
      c.applicability === REPORTING_APPLICABILITY.applicable ||
      c.applicability === REPORTING_APPLICABILITY.conditional,
  );
  const judgments = s.matters.filter((m) =>
    ['technical_judgment', 'legal_interpretation', 'partner_consultation'].includes(m.category),
  );
  const openNonBlocking = s.matters.filter((m) => m.open && !m.blocking);
  const conditions = (s.approval?.conditions ?? []).filter((c) => c.status === 'open');

  return {
    'afm.baselineVersion': baseline?.version ?? '—',
    'afm.methodologyVersion': h.methodologyVersion,
    'afm.s01EngagementDetails': lines([
      `Audit period: ${h.periodLabel}`,
      `Engagement Partner: ${h.engagementPartnerName ?? '—'}`,
      `Engagement Manager: ${h.engagementManagerName ?? '—'}`,
      `Prepared by: ${h.preparedByName ?? '—'}`,
      `Framework version: ${h.frameworkVersion}`,
    ]),
    'afm.s02EntityClassification': lines([
      row('02.1')
        ? `Conclusion: ${row('02.1')!.conclusion ?? '—'}${row('02.1')!.detail ? ` (${row('02.1')!.detail})` : ''}`
        : null,
      facts.entityClass ? `Entity class: ${facts.entityClass}` : null,
      facts.listed == null ? null : `Listing: ${facts.listed ? 'Listed' : 'Unlisted'}`,
      d.profile.specialEntityTypes.length
        ? `Special entity types: ${d.profile.specialEntityTypes.map(human).join(', ')}`
        : null,
      d.profile.regulator ? `Regulator: ${human(d.profile.regulator)}` : null,
      d.profile.smallCompanyBasis ? `Small Company: ${d.profile.smallCompanyBasis}` : null,
      d.profile.smallCompanyOverrideReason
        ? `Small Company override reason: ${d.profile.smallCompanyOverrideReason}`
        : null,
    ]),
    'afm.s03ReportingFramework': lines([conclusionOf('02.2', '02.2'), ...tests('(02.2)')]),
    'afm.s04ScheduleIii': conclusionOf('02.3', '02.3'),
    'afm.s05Caro': lines([conclusionOf('02.4', '02.4'), ...tests('(02.4)')]),
    'afm.s06Icfr': lines([conclusionOf('02.5', '02.5'), ...tests('(02.5)')]),
    'afm.s07Consolidation': lines([
      conclusionOf('02.6', '02.6'),
      ...d.perimeter
        .filter((p) => p.relationship !== 'none')
        .map(
          (p) =>
            `${p.name} — ${human(p.relationship)}; ${human(p.method)}; ${p.included === 'yes' ? 'in perimeter' : 'excluded'}`,
        ),
    ]),
    'afm.s08OtherAuditors': lines(
      [
        ...facts.componentAuditors.map((c) => `Component ${c.component}: audited by ${c.auditor}`),
        ...facts.branchAuditors.map((b) => `Branch ${b.branch}: audited by ${b.auditor}`),
      ],
      'No component or branch auditors.',
    ),
    'afm.s09OtherReporting': lines([
      conclusionOf('02.7', '02.7'),
      ...applicableCards.map(
        (c) => `${c.clause} ${c.requirement} — ${REPORTING_APPLICABILITY_LABEL[c.applicability]}`,
      ),
    ]),
    'afm.s10TriggeredConsiderations': lines(
      s.triggeredRequirements.map(
        (t) =>
          `${t.requirement} — trigger: ${t.trigger} (${t.source}); downstream: ${t.downstreamWork}`,
      ),
      'No circumstance-driven requirements triggered.',
    ),
    'afm.s11Judgments': lines(
      judgments.map(
        (m) =>
          `${m.code} ${FRAMEWORK_MATTER_CATEGORY_LABEL[m.category]} (${m.source}): ${m.title}${m.resolution ? ` — ${m.resolution}` : ''}`,
      ),
      'No significant framework judgments recorded.',
    ),
    'afm.s12Overrides': lines(
      d.bases
        .filter((b) => b.isOverridden)
        .map(
          (b) =>
            `${b.title}: system ${human(b.systemOutcome) ?? '—'} → conclusion ${human(b.conclusion) ?? '—'}; reason: ${b.basis ?? '—'}`,
        ),
      'No system results overridden.',
    ),
    'afm.s13PriorYearChanges': s.priorYear.available
      ? lines(
          s.priorYear.changes.map(
            (c) =>
              `${c.label}: ${c.previous ?? '—'} → ${c.current ?? '—'} (${FRAMEWORK_SOURCE_SECTION_LABEL[c.source]})`,
          ),
          `No meaningful change from the ${s.priorYear.priorPeriodLabel ?? 'prior'} approved framework.`,
        )
      : (s.priorYear.reason ?? 'Not available.'),
    'afm.s14OpenMatters': lines(
      [
        ...openNonBlocking.map(
          (m) =>
            `${m.code} ${m.title} — owner ${m.ownerName ?? '—'}; due ${m.dueDate ? formatLongDate(m.dueDate) : '—'}${m.impact ? `; impact: ${m.impact}` : ''}`,
        ),
        ...conditions.map(
          (c) =>
            `Condition: ${c.condition} — owner ${c.ownerName ?? '—'}; due ${formatLongDate(c.dueDate) ?? '—'}; impact: ${c.impact}`,
        ),
      ],
      'No open non-blocking matters.',
    ),
    'afm.s15ManagerConclusion': baseline?.managerConfirmedAt
      ? lines([
          `AF-01: Yes — submitted for Partner approval by ${baseline.managerConfirmedByName ?? '—'} on ${formatLongDate(baseline.managerConfirmedAt) ?? '—'}.`,
          baseline.previewReviewedAt ? 'Downstream configuration preview reviewed.' : null,
          baseline.managerNote ? `Note: ${baseline.managerNote}` : null,
        ])
      : 'AF-01 not yet recorded.',
    'afm.s16PartnerApproval': baseline?.epApprovedAt
      ? `AF-02: ${baseline.epDecision ?? 'approve'} by ${baseline.epApprovedByName ?? '—'} on ${formatLongDate(baseline.epApprovedAt) ?? '—'}.`
      : 'AF-02 Engagement Partner conclusion — recorded electronically in the portal on approval (immutable approval record).',
    'afm.numericTests': lines(
      d.numericTests.map(numericLine),
      'No numerical thresholds decided the framework.',
    ),
    'afm.downstreamConfiguration': lines(
      s.downstreamPreview.map((p) => `${p.item}: ${p.result} (${p.source})`),
    ),
  };
}
