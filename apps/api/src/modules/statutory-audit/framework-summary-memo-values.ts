import type { PoolClient } from 'pg';
import {
  ASSESSMENT_ANSWER,
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_JUDGMENT_CATEGORIES,
  FRAMEWORK_MATTER_CATEGORY_LABEL,
  FRAMEWORK_SOURCE_SECTION_LABEL,
  FRAUD_MATTER_ROUTE_LABEL,
  INVESTEE_RELATIONSHIP,
  INVESTEE_RELATIONSHIP_LABEL,
  REPORTING_APPLICABILITY,
  REPORTING_APPLICABILITY_LABEL,
  SUB_SECTION_KEY,
  formatInrCrore,
  type AssessmentAnswer,
  type FraudMatter,
  type FrameworkSnapshotFacts,
  type FrameworkSystemOverride,
  type InvesteeRelationship,
  type ReportingApplicability,
  type StatutoryAuditFrameworkSummary,
} from '@hsdg/contracts';
import { formatLongDate } from './acceptance-merge-values';
import { readFrameworkOverridesOn } from './framework-summary-overrides';
import { readOtherReportingResultOn } from './other-reporting-read';
import { readFraudMattersOn, workflowPeriodStartOn } from './other-reporting-records-read';

/**
 * The Audit Framework Memorandum merge values (02.8 §10): one `afm.*` field per
 * memorandum section (16) plus the numerical tests. Every value is drawn from
 * the approved framework — the 02.8 summary, the 02.x bases and the engines'
 * stored detail — never re-entered. Where a conclusion depends on a threshold,
 * the memo shows "Actual | Limit | Operator | Result", not "criteria satisfied".
 */

/** A section's stored system_detail — shapes vary by 02.x, every read is guarded. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseDetail = Record<string, any>;

/** One numerical test line (§10). */
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
  /** 02.6: the non-percentage control / influence basis of each associate and joint venture. */
  influenceBasis: string[];
  /** §12: every system result a professional overrode (the review screen's list). */
  overrides: FrameworkSystemOverride[];
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
const pct = (v: number) => `${Number(v.toFixed(2))}%`;
const OPERATOR_SIGN: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<' };

/** The significant-influence presumption in force (Rules Library, area `cfs`). */
export interface InfluenceRule {
  threshold: number;
  operator: string;
}

/** The 02.6 perimeter entry and the captured investee facts the memo reads. */
export interface InfluenceInvestee {
  name: string;
  relationship: InvesteeRelationship;
  ownershipPercent: number | null;
  votingDirect: number | null;
  votingIndirect: number | null;
  factors: string[];
  basis: string | null;
  significantInfluence: AssessmentAnswer | null;
  jointControl: AssessmentAnswer | null;
}

const ANSWER_WORD: Record<AssessmentAnswer, string> = {
  yes: 'Yes',
  no: 'No',
  further_assessment: 'Further assessment',
};
const INFLUENCE_RELATIONSHIPS: readonly InvesteeRelationship[] = [
  INVESTEE_RELATIONSHIP.associate,
  INVESTEE_RELATIONSHIP.jointVenture,
];

/**
 * 02.6 associates and joint ventures (§10): voting power (direct + indirect)
 * against the significant-influence presumption, and the non-percentage basis
 * the relationship rests on (pure).
 */
export function influenceTests(
  investees: InfluenceInvestee[],
  rule: InfluenceRule | null,
): { tests: MemoNumericTest[]; basis: string[] } {
  const tests: MemoNumericTest[] = [];
  const basis: string[] = [];
  for (const inv of investees.filter((i) => INFLUENCE_RELATIONSHIPS.includes(i.relationship))) {
    const label = INVESTEE_RELATIONSHIP_LABEL[inv.relationship];
    const captured = inv.votingDirect != null || inv.votingIndirect != null;
    const voting = captured ? (inv.votingDirect ?? 0) + (inv.votingIndirect ?? 0) : null;
    const indicator = voting ?? inv.ownershipPercent;
    const meets =
      indicator == null || !rule
        ? null
        : rule.operator === '>'
          ? indicator > rule.threshold
          : indicator >= rule.threshold;
    tests.push({
      label: `Significant influence — ${inv.name} (02.6)`,
      actual:
        voting != null
          ? `Voting power ${pct(voting)} (direct ${pct(inv.votingDirect ?? 0)} + indirect ${pct(inv.votingIndirect ?? 0)})`
          : inv.ownershipPercent != null
            ? `Ownership ${pct(inv.ownershipPercent)} (no voting % captured)`
            : null,
      limit: rule ? pct(rule.threshold) : null,
      operator: rule ? (OPERATOR_SIGN[rule.operator] ?? rule.operator) : null,
      result:
        meets == null
          ? `${label} — not tested against a percentage`
          : meets
            ? `${label} — presumption met`
            : `${label} — below the presumption; rests on the basis below`,
    });
    const factors = inv.factors.filter((f) => !/^(Ownership interest|Voting power) /.test(f));
    basis.push(
      `${inv.name} (${label}) basis: ${[
        ...factors,
        inv.significantInfluence
          ? `Significant influence concluded: ${ANSWER_WORD[inv.significantInfluence]}`
          : null,
        inv.jointControl ? `Joint control concluded: ${ANSWER_WORD[inv.jointControl]}` : null,
        inv.basis,
      ]
        .filter(Boolean)
        .join('; ')}`,
    );
  }
  return { tests, basis };
}

const DEADLINE_STATUS_WORD: Record<FraudMatter['deadlines'][number]['status'], string> = {
  met: 'Met',
  met_late: 'Met late',
  due: 'Due',
  overdue: 'Overdue',
};

/**
 * 02.7 Fraud Matters (§10): for each live matter, the reporting route against
 * the Rule 13 amount threshold, then each Rule 13 step against its statutory
 * period (pure). Withdrawn matters are not reported.
 */
export function fraudTests(
  matters: FraudMatter[],
  thresholdAmount: number | null,
): MemoNumericTest[] {
  const tests: MemoNumericTest[] = [];
  for (const m of matters.filter((x) => !x.withdrawn)) {
    tests.push({
      label: `${m.ref} ${m.nature} — reporting route, Section 143(12) (02.7)`,
      actual:
        m.amount != null
          ? `${formatInrCrore(m.amount)}${m.amountEstimated ? ' (estimated)' : ''}`
          : 'Not yet determined',
      limit: crore(thresholdAmount),
      operator: '≥',
      result: FRAUD_MATTER_ROUTE_LABEL[m.route],
    });
    for (const d of m.deadlines)
      tests.push({
        label: `${m.ref} — ${d.label} (02.7)`,
        actual: d.metOn ? `Done ${formatLongDate(d.metOn)}` : 'Not yet done',
        limit: `${d.days} days from ${d.fromEvent} (${formatLongDate(d.fromDate)}) — due ${formatLongDate(d.dueDate)}`,
        operator: '≤',
        result: `${DEADLINE_STATUS_WORD[d.status]}${d.provisional ? ' (route provisional)' : ''}`,
      });
  }
  return tests;
}

/** The significant-influence rule version in force on `onDate` (null = none active). */
async function influenceRuleOn(client: PoolClient, onDate: string): Promise<InfluenceRule | null> {
  const { rows } = await client.query<{ threshold: string; operator: string }>(
    `SELECT v.threshold::text AS threshold, r.operator
       FROM hsdg.audit_rule r
       JOIN hsdg.audit_rule_version v ON v.audit_rule_id = r.id
      WHERE r.area_key = 'cfs' AND r.criterion = 'significant_influence_ownership' AND r.is_active
        AND v.effective_from <= $1::date AND (v.effective_to IS NULL OR v.effective_to >= $1::date)
      ORDER BY v.effective_from DESC
      LIMIT 1`,
    [onDate],
  );
  return rows[0] ? { threshold: Number(rows[0].threshold), operator: rows[0].operator } : null;
}

/** The audit period end for a period start (start + 1 year − 1 day). */
function periodEndOf(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const answerOf = (v: unknown) =>
  (Object.values(ASSESSMENT_ANSWER) as string[]).includes(v as string)
    ? (v as AssessmentAnswer)
    : null;

/** Join the 02.6 perimeter to the captured investee facts by id (stored shapes are guarded). */
function influenceInvestees(
  detail: LooseDetail | null,
  facts: LooseDetail | null,
): InfluenceInvestee[] {
  const captured = new Map<string, LooseDetail>(
    ((facts?.investees ?? []) as LooseDetail[])
      .filter((i) => typeof i?.id === 'string')
      .map((i) => [i.id as string, i]),
  );
  return ((detail?.perimeter ?? []) as LooseDetail[])
    .filter((p) => typeof p?.name === 'string' && p.name.trim())
    .map((p) => {
      const f = captured.get(p.id) ?? {};
      return {
        name: (p.name as string).trim(),
        relationship: p.relationship as InvesteeRelationship,
        ownershipPercent: num(p.ownershipPercent),
        votingDirect: num(f.votingDirect),
        votingIndirect: num(f.votingIndirect),
        factors: Array.isArray(p.factors) ? (p.factors as string[]) : [],
        basis: typeof p.basis === 'string' ? p.basis : null,
        significantInfluence: answerOf(f.significantInfluence),
        jointControl: answerOf(f.jointControl),
      };
    });
}

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
    facts: Record<string, unknown> | null;
  }>(
    `SELECT sub_section_key, area_key, title, system_outcome, system_basis, conclusion, basis,
            is_overridden, system_detail, facts
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

  const cfsRow = subs.find((s) => s.area_key === FRAMEWORK_AREA_KEY.cfs);
  const cfs = (cfsRow?.system_detail ?? null) as LooseDetail | null;
  const periodStart = await workflowPeriodStartOn(client, workflowInstanceId);
  const influence = influenceTests(
    influenceInvestees(cfs, (cfsRow?.facts ?? null) as LooseDetail | null),
    await influenceRuleOn(client, periodEndOf(periodStart)),
  );
  tests.push(...influence.tests);
  const fraud = await readFraudMattersOn(client, workflowInstanceId, periodStart);
  tests.push(...fraudTests(fraud.matters, fraud.periodRules.thresholdAmount));

  const other = await readOtherReportingResultOn(client, workflowInstanceId);
  const overrides = await readFrameworkOverridesOn(client, workflowInstanceId);
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
    perimeter: ((cfs?.perimeter ?? []) as LooseDetail[])
      .filter((p) => typeof p.name === 'string' && p.name.trim())
      .map((p) => ({
        name: (p.name as string).trim(),
        relationship: p.relationship ?? 'none',
        method: p.method ?? 'none',
        included: p.included ?? 'no',
      })),
    influenceBasis: influence.basis,
    overrides,
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
  const judgments = s.matters.filter((m) => FRAMEWORK_JUDGMENT_CATEGORIES.includes(m.category));
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
      ...tests('(02.6)'),
      ...d.influenceBasis,
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
      ...tests('(02.7)'),
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
      d.overrides.map(
        (o) =>
          `${o.title} (${FRAMEWORK_SOURCE_SECTION_LABEL[o.source]}): system ${o.systemResult ?? '—'} → conclusion ${o.conclusion ?? '—'}; reason: ${o.reason ?? '—'}${o.overriddenByName ? `; by ${o.overriddenByName}` : ''}${o.overriddenAt ? ` on ${formatLongDate(o.overriddenAt)}` : ''}`,
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
