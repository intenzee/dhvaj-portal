import {
  CANDIDATE_BENCHMARKS,
  MATERIALITY_BENCHMARK_LABEL,
  MATERIALITY_RULE_AREA,
  MATERIALITY_RULE_CRITERION,
  PLANNING_CHANGE_CATEGORY_LABEL,
  QUALITATIVE_CONSIDERATIONS,
  REVISION_TRIGGER_LABEL,
  SPECIFIC_SCOPE_TYPE_LABEL,
  type BenchmarkAssessment,
  type BenchmarkCandidate,
  type CandidateBenchmark,
  type JudgmentFactor,
  type MaterialityBaseline,
  type MaterialityComputed,
  type MaterialityDatasetInfo,
  type MaterialityDetermination,
  type MaterialityGuidance,
  type MaterialityMethodology,
  type MaterialityPrompt,
  type MethodologyStatus,
  type NormalisationAdjustment,
  type NormalisationSummary,
  type PartnerAttentionTrigger,
  type PlanningChangeCategory,
  type PlanningCompletionCheck,
  type QualitativeChallengeItem,
  type ResolvedRule,
  type RuleResolver,
  type SensitivityRow,
  type SpecificMaterialityRecord,
  type UserFocusMeasure,
} from '@hsdg/contracts';

/**
 * 03.3 Materiality — pure calculation / challenge engine (DHVAJ 03.3).
 *
 * The engine calculates, compares and prompts; it NEVER selects a benchmark or
 * percentage, ranks a "best" benchmark, scores judgment factors or passes/fails
 * a sensitivity check. Every percentage, attention parameter and rounding step
 * comes from the Materiality Methodology Library (Audit Rules Library, area
 * `materiality`) through the injected RuleResolver — none lives in this file.
 */

const PCT = 100;
const EPSILON = 0.5; // rupee tolerance when comparing selected vs calculated amounts

// ── Methodology ──────────────────────────────────────────────────────────────

function toGuidance(rule: ResolvedRule | null): MaterialityGuidance | null {
  if (!rule) return null;
  return {
    criterion: rule.criterion,
    lowPct: rule.threshold,
    highPct: rule.operator === 'between' ? rule.thresholdHigh : null,
    ruleCode: rule.ruleCode,
    ruleVersion: rule.version,
    reference: rule.guidanceReference,
    provisional: /provisional/i.test(rule.guidanceReference ?? ''),
  };
}

/** Resolve every materiality guidance rule in force for the engagement period. */
export function resolveMaterialityMethodology(resolve: RuleResolver): MaterialityMethodology {
  const get = (criterion: string) => resolve(MATERIALITY_RULE_AREA, criterion, null);
  const used: ResolvedRule[] = [];
  const take = (criterion: string) => {
    const r = get(criterion);
    if (r) used.push(r);
    return r;
  };
  const omGuidance: MaterialityMethodology['omGuidance'] = {};
  for (const key of CANDIDATE_BENCHMARKS) {
    const g = toGuidance(take(MATERIALITY_RULE_CRITERION.omPct[key]));
    if (g) omGuidance[key] = g;
  }
  const pm = toGuidance(take(MATERIALITY_RULE_CRITERION.pmPct));
  const ctt = toGuidance(take(MATERIALITY_RULE_CRITERION.cttPct));
  const py = take(MATERIALITY_RULE_CRITERION.pyChangeAttention);
  const vol = take(MATERIALITY_RULE_CRITERION.volatilityAttention);
  const be = take(MATERIALITY_RULE_CRITERION.nearBreakevenMargin);
  const rounding = take(MATERIALITY_RULE_CRITERION.roundingStep);
  return {
    versionLabel: used.length
      ? used.map((r) => `${r.ruleCode}@${r.version}`).join(', ')
      : 'No materiality guidance configured',
    omGuidance,
    pmGuidance: pm,
    cttGuidance: ctt,
    pyChangeAttentionPct: py?.threshold ?? null,
    volatilityAttentionPct: vol?.threshold ?? null,
    nearBreakevenMarginPct: be?.threshold ?? null,
    roundingStep: rounding?.threshold && rounding.threshold > 0 ? rounding.threshold : null,
    anyProvisional: used.some((r) => /provisional/i.test(r.guidanceReference ?? '')),
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatInr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function formatPct(n: number | null, dp = 2): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `${Number(n.toFixed(dp))}%`;
}

function signedPct(n: number): string {
  const v = Number(n.toFixed(1));
  return `${v > 0 ? '+' : ''}${v}%`;
}

/** Dataset figures carry two decimals; avoid float noise such as 10.3999…. */
const round2 = (n: number) => Math.round(n * PCT) / PCT;

const near = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) <= EPSILON;

/** Round DOWN to the methodology rounding step (display only; unrounded is stored). */
export function roundToStep(amount: number | null, step: number | null): number | null {
  if (amount === null) return null;
  if (!step) return Math.round(amount * PCT) / PCT;
  return Math.floor(amount / step) * step;
}

export function methodologyStatus(
  pct: number | null,
  guidance: MaterialityGuidance | null | undefined,
): MethodologyStatus {
  if (!guidance || guidance.lowPct === null) return 'no_guidance';
  if (pct === null) return 'no_guidance';
  const low = guidance.lowPct;
  const high = guidance.highPct ?? guidance.lowPct;
  return pct >= low && pct <= high ? 'within_guidance' : 'outside_guidance';
}

// ── Facts consumed from Sections 01/02 and 03.1/03.2 (read-only) ─────────────

export interface MaterialityFacts {
  initialAudit: boolean | null;
  specialEntityTypes: string[];
  industryProfile: string | null;
  /** PI-01 change categories recorded in 03.1. */
  changeCategories: PlanningChangeCategory[];
  focusAreas: { code: string; name: string }[];
  /** Planning Signals (all, with display codes). */
  signals: { code: string; observation: string; ruleKey: string | null; attention: string }[];
  /** 03.2.6 covenants / external measures answer. */
  covenantsNote: string | null;
  /** 03.2.4 major system change. */
  erpChange: boolean;
  /** 03.2.7 related-party figures entered. */
  relatedPartyFigures: boolean;
  /** 03.2 investigation cards at Enhanced / Immediate Partner Attention. */
  elevatedAnalytics: number;
}

const REGULATED_TYPES = new Set(['bank', 'insurance', 'nbfc', 'hfc', 'nidhi', 'other_regulator']);
const PUBLIC_INTEREST_TYPES = new Set(['bank', 'insurance', 'nbfc', 'hfc', 'nidhi']);

const hasChange = (f: MaterialityFacts, ...cats: PlanningChangeCategory[]) =>
  f.changeCategories.some((c) => cats.includes(c));
const changeLabels = (f: MaterialityFacts, ...cats: PlanningChangeCategory[]) =>
  f.changeCategories
    .filter((c) => cats.includes(c))
    .map((c) => PLANNING_CHANGE_CATEGORY_LABEL[c])
    .join(', ');
const signalsMatching = (f: MaterialityFacts, re: RegExp) =>
  f.signals.filter((s) => re.test(s.observation) || re.test(s.ruleKey ?? ''));
const regulated = (f: MaterialityFacts) =>
  f.specialEntityTypes.some((t) => REGULATED_TYPES.has(t)) || f.industryProfile === 'nbfc';
const notForProfit = (f: MaterialityFacts) =>
  f.specialEntityTypes.includes('section_8') || f.industryProfile === 'section8';

// ── 03.3.2 Candidate benchmarks ──────────────────────────────────────────────

export interface CandidateInput {
  dataset: MaterialityDatasetInfo;
  /** Canonical 03.2 metric values; PY already converted to CY units. */
  metrics: Record<string, { cy: number | null; py: number | null }>;
  adjustmentsTotal: number;
  hasAdjustments: boolean;
  userFocus: UserFocusMeasure[];
  principalUsers: string[];
  methodology: MaterialityMethodology;
  assessments: Partial<
    Record<
      CandidateBenchmark,
      { assessment: BenchmarkAssessment; rationale: string | null; version: number }
    >
  >;
  facts: MaterialityFacts;
}

const FOCUS_OF: Record<CandidateBenchmark, UserFocusMeasure> = {
  pbt: 'profit',
  normalised_pbt: 'profit',
  revenue: 'revenue',
  total_assets: 'assets',
  net_assets: 'net_assets',
  expenditure: 'expenditure',
};

export function movementOf(
  cy: number | null,
  py: number | null,
): { pct: number | null; label: string } {
  if (cy === null || py === null) return { pct: null, label: '—' };
  if (py === 0) return { pct: null, label: 'N/M' };
  const pct = ((cy - py) / Math.abs(py)) * PCT;
  return { pct, label: signedPct(pct) };
}

export function buildCandidates(input: CandidateInput): BenchmarkCandidate[] {
  const { metrics, methodology, dataset, facts } = input;
  const v = (k: string) => metrics[k] ?? { cy: null, py: null };
  const pbt = v('pbt');
  const revenue = v('revenue');
  const otherIncome = v('other_income');
  const expend = (p: 'cy' | 'py') => {
    const r = revenue[p];
    const b = pbt[p];
    if (r === null || b === null) return null;
    return r + (otherIncome[p] ?? 0) - b;
  };
  const margin =
    pbt.cy !== null && revenue.cy !== null && revenue.cy > 0 ? (pbt.cy / revenue.cy) * PCT : null;
  const nearBreakeven =
    margin !== null &&
    methodology.nearBreakevenMarginPct !== null &&
    Math.abs(margin) <= methodology.nearBreakevenMarginPct;

  const defs: Record<
    CandidateBenchmark,
    { formula: string; cy: number | null; py: number | null; missing: string; nm: string }
  > = {
    pbt: {
      formula: 'Profit before tax (03.2.7)',
      cy: pbt.cy,
      py: pbt.py,
      missing: 'Enter profit before tax in 03.2.7.',
      nm: 'Loss or nil profit — a percentage of a loss is not meaningful (N/M).',
    },
    normalised_pbt: {
      formula: 'Profit before tax + normalisation adjustments (03.3.3)',
      cy: input.hasAdjustments && pbt.cy !== null ? round2(pbt.cy + input.adjustmentsTotal) : null,
      py: null,
      missing: input.hasAdjustments
        ? 'Enter profit before tax in 03.2.7.'
        : 'Available only through a normalisation adjustment schedule (03.3.3).',
      nm: 'Normalised result is a loss or nil — not meaningful (N/M).',
    },
    revenue: {
      formula: 'Revenue from operations (03.2.7)',
      cy: revenue.cy,
      py: revenue.py,
      missing: 'Enter revenue in 03.2.7.',
      nm: 'Nil or negative revenue — not meaningful.',
    },
    total_assets: {
      formula: 'Total assets (03.2.7)',
      cy: v('total_assets').cy,
      py: v('total_assets').py,
      missing: 'Enter total assets in 03.2.7.',
      nm: 'Nil or negative total assets — not meaningful.',
    },
    net_assets: {
      formula: 'Net worth / total equity (03.2.7)',
      cy: v('net_worth').cy,
      py: v('net_worth').py,
      missing: 'Enter net worth in 03.2.7.',
      nm: 'Negative or nil net worth — not meaningful (N/M).',
    },
    expenditure: {
      formula: 'Revenue + other income − profit before tax (03.2.7)',
      cy: expend('cy'),
      py: expend('py'),
      missing: 'Needs revenue and profit before tax in 03.2.7.',
      nm: 'Nil or negative expenditure — not meaningful.',
    },
  };

  const lenders = input.principalUsers.includes('lenders_banks');
  return CANDIDATE_BENCHMARKS.map((key) => {
    const d = defs[key];
    const mv = movementOf(d.cy, d.py);
    const status: BenchmarkCandidate['status'] = !dataset.ready
      ? 'insufficient_data'
      : d.cy === null
        ? 'insufficient_data'
        : d.cy <= 0
          ? 'not_meaningful'
          : 'available';
    const reason =
      status === 'available'
        ? null
        : !dataset.ready
          ? dataset.reason
          : d.cy === null
            ? d.missing
            : d.nm;
    const amountInr =
      status === 'available' && dataset.unitFactor ? d.cy! * dataset.unitFactor : null;
    const guidance = methodology.omGuidance[key] ?? null;
    const volatile =
      mv.pct !== null &&
      methodology.volatilityAttentionPct !== null &&
      Math.abs(mv.pct) >= methodology.volatilityAttentionPct;

    const prompts: string[] = [];
    if (volatile)
      prompts.push(`Moved ${mv.label} year on year — consider stability as a benchmark.`);
    if ((key === 'pbt' || key === 'normalised_pbt') && nearBreakeven) {
      prompts.push(
        `Profit is near break-even (PBT ${formatPct(margin)} of revenue) — consider whether profit is a stable measure for users.`,
      );
    }
    if (key === 'pbt' && pbt.cy !== null && pbt.cy <= 0) {
      prompts.push(
        'Current-year result is a loss — alternative benchmark judgment is significant.',
      );
    }
    if ((key === 'revenue' || key === 'expenditure') && notForProfit(facts)) {
      prompts.push('Not-for-profit / member entity — users often focus on revenue or expenditure.');
    }
    if ((key === 'total_assets' || key === 'net_assets') && regulated(facts)) {
      prompts.push(
        'Asset-based / regulated entity — users often focus on assets, equity or capital.',
      );
    }
    if ((key === 'net_assets' || key === 'total_assets') && lenders) {
      prompts.push(
        'Lenders are principal users — financing measures may be of particular interest.',
      );
    }
    if (facts.initialAudit && (key === 'pbt' || key === 'net_assets')) {
      prompts.push('Initial audit — the prior-year comparative is unaudited by this firm.');
    }
    const a = input.assessments[key];
    return {
      key,
      label: MATERIALITY_BENCHMARK_LABEL[key],
      formula: d.formula,
      cy: d.cy,
      py: d.py,
      movementPct: mv.pct,
      movementLabel: mv.label,
      volatile,
      status,
      reason,
      amountInr,
      userFocusLinked: input.userFocus.includes(FOCUS_OF[key]),
      prompts,
      guidance,
      indicativeLowInr:
        amountInr !== null && guidance?.lowPct != null ? (amountInr * guidance.lowPct) / PCT : null,
      indicativeHighInr:
        amountInr !== null && guidance?.highPct != null
          ? (amountInr * guidance.highPct) / PCT
          : null,
      assessment: a?.assessment ?? null,
      rationale: a?.rationale ?? null,
      version: a?.version ?? 0,
    };
  });
}

export function summariseNormalisation(
  adjustments: readonly NormalisationAdjustment[],
  reportedPbt: number | null,
): NormalisationSummary {
  const total = round2(adjustments.reduce((s, a) => s + a.amount, 0));
  return {
    reportedPbt,
    adjustmentsTotal: total,
    normalisedPbt: adjustments.length && reportedPbt !== null ? round2(reportedPbt + total) : null,
  };
}

// ── 03.3.5 / 03.3.6 / 03.3.8 calculations ────────────────────────────────────

/** Live benchmark amount (dataset units) for the selected benchmark. */
export function selectedBenchmarkAmount(
  det: Pick<MaterialityDetermination, 'selectedBenchmark' | 'otherBenchmarkAmount'>,
  candidates: readonly BenchmarkCandidate[],
): number | null {
  if (!det.selectedBenchmark) return null;
  if (det.selectedBenchmark === 'other') return det.otherBenchmarkAmount;
  const c = candidates.find((x) => x.key === det.selectedBenchmark);
  return c && c.status === 'available' ? c.cy : null;
}

export function computeMateriality(input: {
  det: MaterialityDetermination;
  candidates: readonly BenchmarkCandidate[];
  methodology: MaterialityMethodology;
  unitFactor: number | null;
  aggregation: readonly JudgmentFactor[];
}): MaterialityComputed {
  const { det, candidates, methodology, unitFactor } = input;
  const live = selectedBenchmarkAmount(det, candidates);
  const liveInr = live !== null && unitFactor ? live * unitFactor : null;
  const liveCalculatedOm =
    liveInr !== null && det.selectedPct !== null ? (liveInr * det.selectedPct) / PCT : null;
  const roundedOm = roundToStep(liveCalculatedOm, methodology.roundingStep);
  const effectiveOmPct =
    det.selectedOm !== null && liveInr ? (det.selectedOm / liveInr) * PCT : null;
  const omGuidance =
    det.selectedBenchmark && det.selectedBenchmark !== 'other'
      ? methodology.omGuidance[det.selectedBenchmark]
      : null;
  // Methodology rounding is not an override: judge the selected % in that case.
  const omPctForStatus =
    det.selectedOm === null ||
    near(det.selectedOm, roundedOm) ||
    near(det.selectedOm, liveCalculatedOm)
      ? det.selectedPct
      : effectiveOmPct;

  const liveCalculatedPm =
    det.selectedOm !== null && det.pmPct !== null ? (det.selectedOm * det.pmPct) / PCT : null;
  const roundedPm = roundToStep(liveCalculatedPm, methodology.roundingStep);
  const effectivePmPct =
    det.selectedPm !== null && det.selectedOm ? (det.selectedPm / det.selectedOm) * PCT : null;
  const pmPctForStatus =
    det.selectedPm === null ||
    near(det.selectedPm, roundedPm) ||
    near(det.selectedPm, liveCalculatedPm)
      ? det.pmPct
      : effectivePmPct;
  const effectiveCttPct =
    det.selectedCtt !== null && det.selectedOm ? (det.selectedCtt / det.selectedOm) * PCT : null;

  let sourceChanged = false;
  let sourceChangeDetail: string | null = null;
  if (det.selectedBenchmark && det.selectedBenchmark !== 'other' && det.benchmarkAmount !== null) {
    if (live === null) {
      sourceChanged = true;
      sourceChangeDetail = `${MATERIALITY_BENCHMARK_LABEL[det.selectedBenchmark]} is no longer available in 03.2 (was ${det.benchmarkAmount}).`;
    } else if (Math.abs(live - det.benchmarkAmount) > 0.005) {
      sourceChanged = true;
      sourceChangeDetail = `${MATERIALITY_BENCHMARK_LABEL[det.selectedBenchmark]} changed in 03.2 from ${det.benchmarkAmount} to ${live} (dataset units) since it was selected.`;
    }
  }

  const considered = input.aggregation.filter((f) => f.considered);
  const pmRationaleDraft = considered.length
    ? `Performance materiality set at ${formatPct(det.pmPct)} of overall materiality, considering: ${considered
        .map((f) => f.label.toLowerCase() + (f.detail ? ` (${f.detail})` : ''))
        .join('; ')}.${det.aggregationOther ? ` Other: ${det.aggregationOther}.` : ''}`
    : null;

  return {
    liveBenchmarkAmount: live,
    liveCalculatedOm,
    roundedOm,
    effectiveOmPct,
    omMethodologyStatus: det.selectedBenchmark
      ? methodologyStatus(omPctForStatus, omGuidance)
      : 'no_guidance',
    liveCalculatedPm,
    roundedPm,
    effectivePmPct,
    pmMethodologyStatus: methodologyStatus(pmPctForStatus, methodology.pmGuidance),
    effectiveCttPct,
    cttMethodologyStatus: methodologyStatus(effectiveCttPct, methodology.cttGuidance),
    sourceChanged,
    sourceChangeDetail,
    pmRationaleDraft,
  };
}

/** Selected amount equals the calculated (or methodology-rounded) amount. */
export function matchesCalculated(
  selected: number | null,
  calculated: number | null,
  rounded: number | null,
): boolean {
  return near(selected, calculated) || near(selected, rounded);
}

// ── Judgment assistants (§10, §11, §12, §14) ─────────────────────────────────

export function percentageFactors(input: {
  facts: MaterialityFacts;
  det: MaterialityDetermination;
  candidates: readonly BenchmarkCandidate[];
  borrowingsCy: number | null;
}): JudgmentFactor[] {
  const { facts, det } = input;
  const sel = input.candidates.find((c) => c.key === det.selectedBenchmark);
  const broad =
    det.principalUsers.includes('public_investors') ||
    facts.specialEntityTypes.some((t) => PUBLIC_INTEREST_TYPES.has(t));
  const lenders = det.principalUsers.includes('lenders_banks') || (input.borrowingsCy ?? 0) > 0;
  const complexity = [...facts.focusAreas.map((f) => f.code)];
  const elevated = facts.signals.filter((s) => s.attention !== 'standard').map((s) => s.code);
  const concerns =
    hasChange(facts, 'erp_accounting_system', 'accounting_policies') || facts.erpChange;
  const f = (
    key: string,
    label: string,
    present: boolean | null,
    detail: string | null,
    source: string,
  ): JudgmentFactor => ({
    key,
    label,
    present,
    detail,
    source,
    considered: det.pctFactorsConsidered.includes(key),
  });
  return [
    f(
      'broad_user_base',
      'Broad / public user base',
      broad,
      broad ? 'Public investors or a public-interest entity.' : null,
      'MAT-01 / 02.1',
    ),
    f(
      'lender_dependence',
      'External financing / lender dependence',
      lenders,
      input.borrowingsCy
        ? `Borrowings ${input.borrowingsCy} (dataset units) in 03.2.7.`
        : lenders
          ? 'Lenders are principal users.'
          : null,
      '03.2 / MAT-01',
    ),
    f(
      'benchmark_volatility',
      'Benchmark volatility',
      sel ? sel.volatile : null,
      sel && sel.movementLabel !== '—' ? `Selected benchmark moved ${sel.movementLabel}.` : null,
      'System calculated',
    ),
    f('initial_audit', 'Initial audit', facts.initialAudit, null, '02.1'),
    f(
      'audit_differences_history',
      'History of audit differences',
      det.pyAuditDifferences ? true : null,
      det.pyAuditDifferences,
      'Prior year (where available)',
    ),
    f(
      'complexity_estimates',
      'Complexity / significant estimates',
      complexity.length || elevated.length ? true : null,
      complexity.length || elevated.length
        ? [
            complexity.length && `Areas of Focus ${complexity.join(', ')}`,
            elevated.length && `elevated signals ${elevated.join(', ')}`,
          ]
            .filter(Boolean)
            .join('; ')
        : null,
      '03.1 Planning Signals / Areas of Focus',
    ),
    f(
      'reporting_control_concerns',
      'Financial-reporting / control concerns',
      concerns || facts.elevatedAnalytics > 0 ? true : null,
      [
        changeLabels(facts, 'erp_accounting_system', 'accounting_policies'),
        facts.erpChange && 'major system change (03.2.4)',
        facts.elevatedAnalytics > 0 && `${facts.elevatedAnalytics} elevated analytics exception(s)`,
      ]
        .filter(Boolean)
        .join('; ') || null,
      '03.1 / 03.2',
    ),
    f('stable_simple_operations', 'Stable / simple operations', null, null, 'Auditor-confirmed'),
  ];
}

export function aggregationRiskFactors(input: {
  facts: MaterialityFacts;
  det: MaterialityDetermination;
}): JudgmentFactor[] {
  const { facts, det } = input;
  const control = signalsMatching(facts, /control|icfr|deficien/i);
  const fraud = signalsMatching(facts, /fraud/i);
  const locations = signalsMatching(facts, /cfs|component|branch|subsidiar/i);
  const f = (
    key: string,
    label: string,
    present: boolean | null,
    detail: string | null,
    source: string,
  ): JudgmentFactor => ({
    key,
    label,
    present,
    detail,
    source,
    considered: det.aggregationFactors.includes(key),
  });
  const pyNote = det.pyAuditDifferences;
  return [
    f(
      'prior_misstatements',
      'Prior uncorrected / corrected misstatements',
      pyNote ? true : null,
      pyNote,
      'Prior engagement (where available)',
    ),
    f(
      'prior_differences',
      'Number / nature of prior audit differences',
      pyNote ? true : null,
      pyNote,
      'Prior engagement',
    ),
    f(
      'control_deficiencies',
      'Control deficiencies',
      control.length ? true : null,
      control.length ? `Signals ${control.map((s) => s.code).join(', ')}` : null,
      'Planning Signals',
    ),
    f('initial_audit', 'Initial audit', facts.initialAudit, null, '02.1'),
    f(
      'management_system_changes',
      'Management / system changes',
      hasChange(facts, 'key_management', 'erp_accounting_system') || facts.erpChange,
      [
        changeLabels(facts, 'key_management', 'erp_accounting_system'),
        facts.erpChange && 'major system change (03.2.4)',
      ]
        .filter(Boolean)
        .join('; ') || null,
      '03.1 / 03.2',
    ),
    f(
      'complex_estimates',
      'Complex transactions / significant estimates',
      facts.focusAreas.length ? true : null,
      facts.focusAreas.length
        ? facts.focusAreas.map((a) => `${a.code} ${a.name}`).join('; ')
        : null,
      '03.1 / 03.2',
    ),
    f(
      'multiple_locations',
      'Multiple locations / components',
      locations.length || hasChange(facts, 'geography_locations', 'subsidiary_jv_associate')
        ? true
        : null,
      [
        locations.map((s) => s.code).join(', '),
        changeLabels(facts, 'geography_locations', 'subsidiary_jv_associate'),
      ]
        .filter(Boolean)
        .join('; ') || null,
      '02.6',
    ),
    f(
      'fraud',
      'Fraud considerations',
      fraud.length || hasChange(facts, 'fraud') ? true : null,
      [fraud.map((s) => s.code).join(', '), changeLabels(facts, 'fraud')]
        .filter(Boolean)
        .join('; ') || null,
      'Planning Signals',
    ),
    f(
      'other',
      'Other factor',
      det.aggregationOther ? true : null,
      det.aggregationOther,
      'Manager input',
    ),
  ];
}

export function specificMaterialityPrompts(facts: MaterialityFacts): MaterialityPrompt[] {
  const p = (
    key: string,
    label: string,
    present: boolean | null,
    detail: string | null,
    source: string,
  ): MaterialityPrompt => ({ key, label, present, detail, source });
  return [
    p(
      'related_parties',
      'Related-party disclosures / promoter transactions',
      hasChange(facts, 'related_parties', 'ownership_promoters') || facts.relatedPartyFigures
        ? true
        : null,
      [
        changeLabels(facts, 'related_parties', 'ownership_promoters'),
        facts.relatedPartyFigures && 'related-party figures in 03.2.7',
      ]
        .filter(Boolean)
        .join('; ') || null,
      '03.1 / 03.2',
    ),
    p(
      'kmp_remuneration',
      'Directors / KMP remuneration',
      hasChange(facts, 'key_management') ? true : null,
      changeLabels(facts, 'key_management') || null,
      '02.7 / 03.2',
    ),
    p(
      'regulatory_capital',
      'Regulatory / capital requirements',
      regulated(facts) ? true : null,
      regulated(facts) ? 'Regulated entity type (02.1).' : null,
      '02.1',
    ),
    p(
      'debt_covenants',
      'Debt covenants',
      facts.covenantsNote ? true : null,
      facts.covenantsNote,
      '03.2',
    ),
    p('sensitive_disclosures', 'Sensitive statutory disclosures', null, null, '02.7'),
    p(
      'segment_information',
      'Segment / disaggregated information',
      null,
      null,
      'FRF / business understanding',
    ),
    p(
      'acquisition_disposal',
      'Acquisition / disposal disclosures',
      hasChange(facts, 'acquisition_disposal', 'subsidiary_jv_associate') ? true : null,
      changeLabels(facts, 'acquisition_disposal', 'subsidiary_jv_associate') || null,
      '03.1 / 03.2',
    ),
    p('other', 'Other user-sensitive matter', null, null, 'Manager / Partner'),
  ];
}

/** System prompts for the 03.3.9 qualitative challenge (facts, not conclusions). */
export function qualitativePrompts(input: {
  facts: MaterialityFacts;
  pbtInr: number | null;
  selectedOm: number | null;
}): Record<string, string | null> {
  const { facts } = input;
  const fraud = signalsMatching(facts, /fraud/i);
  let flip: string | null = null;
  if (input.pbtInr !== null && input.pbtInr <= 0) {
    flip =
      'The current-year result is a loss or nil — small misstatements may change the reported trend.';
  } else if (
    input.pbtInr !== null &&
    input.selectedOm !== null &&
    input.pbtInr <= input.selectedOm
  ) {
    flip = `Profit before tax (${formatInr(input.pbtInr)}) is within overall materiality (${formatInr(input.selectedOm)}) of break-even — a misstatement below OM could turn profit into loss.`;
  }
  return {
    fraud:
      fraud.length || hasChange(facts, 'fraud')
        ? `Recorded in planning: ${[fraud.map((s) => s.code).join(', '), changeLabels(facts, 'fraud')].filter(Boolean).join('; ')}.`
        : null,
    related_parties: hasChange(facts, 'related_parties', 'ownership_promoters')
      ? `PI-01: ${changeLabels(facts, 'related_parties', 'ownership_promoters')}.`
      : facts.relatedPartyFigures
        ? 'Related-party figures recorded in 03.2.7.'
        : null,
    directors_kmp: hasChange(facts, 'key_management') ? 'PI-01: change in key management.' : null,
    law_regulation:
      hasChange(facts, 'regulatory_environment', 'litigation') || regulated(facts)
        ? [
            changeLabels(facts, 'regulatory_environment', 'litigation'),
            regulated(facts) && 'regulated entity',
          ]
            .filter(Boolean)
            .join('; ')
        : null,
    covenant_regulatory_threshold: facts.covenantsNote
      ? `03.2.6 covenants / external measures: ${facts.covenantsNote}`
      : null,
    profit_loss_flip: flip,
    remuneration_threshold: null,
    sensitive_disclosure: null,
    accounting_policy: hasChange(facts, 'accounting_policies')
      ? 'PI-01: accounting-policy change.'
      : null,
    segment_information: null,
    other: null,
  };
}

// ── 03.3.10 Sensitivity — challenge screen, no pass/fail ─────────────────────

export function buildSensitivity(input: {
  det: MaterialityDetermination;
  candidates: readonly BenchmarkCandidate[];
}): SensitivityRow[] {
  const { det } = input;
  const om = det.selectedOm;
  const amt = (k: CandidateBenchmark) => input.candidates.find((c) => c.key === k);
  const ratioRow = (
    key: string,
    label: string,
    formula: string,
    k: CandidateBenchmark,
  ): SensitivityRow => {
    const c = amt(k);
    if (om === null)
      return {
        key,
        label,
        formula,
        value: null,
        display: '—',
        note: 'Select overall materiality first.',
      };
    if (!c || c.cy === null)
      return {
        key,
        label,
        formula,
        value: null,
        display: '—',
        note: c?.reason ?? 'Not available.',
      };
    if (c.status !== 'available' || c.amountInr === null) {
      return { key, label, formula, value: null, display: 'N/M', note: c.reason };
    }
    const value = (om / c.amountInr) * PCT;
    return { key, label, formula, value, display: formatPct(value, 3), note: null };
  };
  const rows: SensitivityRow[] = [
    ratioRow('om_revenue', 'OM / Revenue', 'Selected OM / Revenue', 'revenue'),
    ratioRow('om_pbt', 'OM / Reported PBT', 'Selected OM / Profit before tax', 'pbt'),
  ];
  const norm = amt('normalised_pbt');
  if (norm && norm.status !== 'insufficient_data') {
    rows.push(
      ratioRow(
        'om_normalised_pbt',
        'OM / Normalised PBT',
        'Selected OM / Normalised PBT',
        'normalised_pbt',
      ),
    );
  }
  rows.push(
    ratioRow('om_total_assets', 'OM / Total assets', 'Selected OM / Total assets', 'total_assets'),
    ratioRow('om_net_assets', 'OM / Net assets / equity', 'Selected OM / Net worth', 'net_assets'),
  );
  const py = det.pyOverallMateriality;
  if (om !== null && py) {
    const pct = ((om - py) / py) * PCT;
    rows.push({
      key: 'py_change',
      label: 'Change from prior-year OM',
      formula: '(Selected OM − PY OM) / PY OM',
      value: pct,
      display: `${formatInr(om - py)} (${signedPct(pct)})`,
      note: det.pySource ? `PY source: ${det.pySource}` : null,
    });
  } else {
    rows.push({
      key: 'py_change',
      label: 'Change from prior-year OM',
      formula: '(Selected OM − PY OM) / PY OM',
      value: null,
      display: '—',
      note: py ? 'Select overall materiality first.' : 'No prior-year materiality recorded.',
    });
  }
  const rel = (key: string, label: string, formula: string, n: number | null): SensitivityRow =>
    om !== null && n !== null
      ? {
          key,
          label,
          formula,
          value: (n / om) * PCT,
          display: formatPct((n / om) * PCT),
          note: null,
        }
      : { key, label, formula, value: null, display: '—', note: null };
  rows.push(
    rel('pm_om', 'PM / OM', 'Selected PM / Selected OM', det.selectedPm),
    rel('ctt_om', 'Clearly trivial / OM', 'Selected CTT / Selected OM', det.selectedCtt),
  );
  return rows;
}

// ── §19 Partner Attention triggers ───────────────────────────────────────────

export function partnerAttentionTriggers(input: {
  det: MaterialityDetermination;
  candidates: readonly BenchmarkCandidate[];
  computed: MaterialityComputed;
  methodology: MaterialityMethodology;
  adjustments: readonly NormalisationAdjustment[];
  specific: readonly SpecificMaterialityRecord[];
  qualitative: readonly QualitativeChallengeItem[];
}): PartnerAttentionTrigger[] {
  const { det, computed, methodology } = input;
  const out: PartnerAttentionTrigger[] = [];
  const add = (key: string, label: string, detail: string) => out.push({ key, label, detail });

  if (input.adjustments.length || det.selectedBenchmark === 'normalised_pbt') {
    add(
      'normalised_benchmark',
      'Normalised benchmark used',
      `${input.adjustments.length} adjustment line(s) in the normalisation schedule.`,
    );
  }
  if (det.selectedBenchmark === 'other') {
    add(
      'unusual_benchmark',
      'Unusual / Other benchmark selected',
      det.otherBenchmarkLabel ?? 'Other benchmark.',
    );
  }
  const outside = (s: MethodologyStatus, what: string, reason: string | null) => {
    if (s === 'outside_guidance') {
      add(
        `${what}_outside_guidance`,
        `Selected ${what.toUpperCase()} outside DHVAJ methodology guidance`,
        reason ? `Override rationale: ${reason}` : 'Override rationale not yet recorded.',
      );
    }
  };
  outside(computed.omMethodologyStatus, 'om', det.omOverrideReason);
  outside(computed.pmMethodologyStatus, 'pm', det.pmOverrideReason);
  outside(computed.cttMethodologyStatus, 'ctt', det.cttOverrideReason);

  if (
    det.selectedOm !== null &&
    det.pyOverallMateriality &&
    methodology.pyChangeAttentionPct !== null
  ) {
    const pct = ((det.selectedOm - det.pyOverallMateriality) / det.pyOverallMateriality) * PCT;
    if (Math.abs(pct) >= methodology.pyChangeAttentionPct) {
      add(
        'py_change',
        'Materiality changes significantly from prior year',
        `${signedPct(pct)} vs PY OM ${formatInr(det.pyOverallMateriality)} (attention parameter ${methodology.pyChangeAttentionPct}%).`,
      );
    }
  }
  const sel = input.candidates.find((c) => c.key === det.selectedBenchmark);
  const pbt = input.candidates.find((c) => c.key === 'pbt');
  const lossOrBreakeven =
    pbt?.status === 'not_meaningful' ||
    (pbt?.prompts.some((p) => p.includes('break-even')) ?? false);
  if (sel?.volatile) {
    add(
      'volatile_benchmark',
      'Selected benchmark is materially volatile',
      `Moved ${sel.movementLabel} year on year.`,
    );
  }
  if (det.selectedBenchmark && lossOrBreakeven && det.selectedBenchmark !== 'pbt') {
    add(
      'loss_breakeven',
      'Loss / near break-even — alternative benchmark judgment is significant',
      `Benchmark selected: ${MATERIALITY_BENCHMARK_LABEL[det.selectedBenchmark]}.`,
    );
  }
  const qualitativeSpecific = input.specific.filter((s) => s.thresholdType === 'qualitative');
  if (input.specific.length > 1 || qualitativeSpecific.length) {
    add(
      'specific_thresholds',
      'Multiple or unusual specific materiality thresholds',
      `${input.specific.length} specific materiality record(s)${qualitativeSpecific.length ? `, ${qualitativeSpecific.length} with no fixed monetary threshold` : ''}.`,
    );
  }
  const significant = input.qualitative.filter((q) => q.significant);
  if (significant.length) {
    add(
      'qualitative_matter',
      'Significant qualitative materiality matter',
      significant.map((q) => q.label).join('; '),
    );
  }
  if (det.versionNo > 1) {
    add(
      'revised',
      'Materiality revised during the audit',
      `${det.revisionTrigger ? REVISION_TRIGGER_LABEL[det.revisionTrigger] : 'Revision'}: ${det.revisionReason ?? ''}`.trim(),
    );
  }
  return out;
}

// ── 03.3.11 Revision impact analysis ─────────────────────────────────────────

export interface RevisionImpact {
  itemKey: string;
  label: string;
  detail: string;
}

export function revisionImpacts(
  det: MaterialityDetermination,
  baseline: MaterialityBaseline | null,
  specificCount: number,
): RevisionImpact[] {
  if (!baseline || det.versionNo <= 1) return [];
  const out: RevisionImpact[] = [];
  const down = (a: number | null, b: number | null) => a !== null && b !== null && a < b - EPSILON;
  const up = (a: number | null, b: number | null) => a !== null && b !== null && a > b + EPSILON;
  const omDown = down(det.selectedOm, baseline.overallMateriality);
  const pmDown = down(det.selectedPm, baseline.performanceMateriality);
  if (omDown || pmDown) {
    const what = [
      omDown && `OM ${formatInr(baseline.overallMateriality)} → ${formatInr(det.selectedOm)}`,
      pmDown && `PM ${formatInr(baseline.performanceMateriality)} → ${formatInr(det.selectedPm)}`,
    ]
      .filter(Boolean)
      .join('; ');
    const items: [string, string][] = [
      ['sampling', 'Sampling sizes and selections'],
      ['scoping', 'Scoping decisions (03.4) and audit areas (03.5)'],
      ['substantive_procedures', 'Completed / in-progress substantive procedures'],
      ['analytics', 'Substantive analytical procedures and thresholds'],
      ['misstatement_evaluation', 'Misstatement evaluation (Section 07)'],
    ];
    for (const [itemKey, label] of items) {
      out.push({
        itemKey,
        label,
        detail: `Materiality decreased (${what}) — reassess where affected.`,
      });
    }
  }
  if (
    up(det.selectedOm, baseline.overallMateriality) ||
    up(det.selectedPm, baseline.performanceMateriality)
  ) {
    out.push({
      itemKey: 'increase_consideration',
      label: 'Work already performed at the lower materiality',
      detail:
        'Materiality increased — do not automatically reduce work already performed; document the auditor’s consideration.',
    });
  }
  if (
    (det.selectedCtt !== null || baseline.clearlyTrivial !== null) &&
    !near(det.selectedCtt, baseline.clearlyTrivial)
  ) {
    out.push({
      itemKey: 'misstatement_register',
      label: 'Misstatement Register accumulation threshold',
      detail: `Clearly trivial ${formatInr(baseline.clearlyTrivial)} → ${formatInr(det.selectedCtt)}.`,
    });
  }
  if (specificCount !== baseline.specificCount) {
    out.push({
      itemKey: 'specific_areas',
      label: 'Areas subject to specific materiality',
      detail: `Specific materiality records ${baseline.specificCount} → ${specificCount} — reassess affected areas.`,
    });
  }
  return out;
}

// ── §22 Completion ───────────────────────────────────────────────────────────

export function computeMaterialityCompletion(input: {
  det: MaterialityDetermination;
  dataset: MaterialityDatasetInfo;
  candidates: readonly BenchmarkCandidate[];
  computed: MaterialityComputed;
  adjustments: readonly NormalisationAdjustment[];
  specific: readonly SpecificMaterialityRecord[];
  qualitative: readonly QualitativeChallengeItem[];
  revisionItems: readonly { applicable: boolean; ownerEmployeeId: string | null }[];
  override?: { mat08?: MaterialityDetermination['mat08']; conclusionSummary?: string | null };
}): PlanningCompletionCheck[] {
  const { det, computed } = input;
  const mat08 = input.override?.mat08 !== undefined ? input.override.mat08 : det.mat08;
  const summary =
    input.override?.conclusionSummary !== undefined
      ? input.override.conclusionSummary
      : det.conclusionSummary;
  const check = (
    key: string,
    label: string,
    met: boolean,
    detail: string,
  ): PlanningCompletionCheck => ({
    key,
    label,
    met,
    detail: met ? null : detail,
  });

  const usersOk =
    det.principalUsers.length > 0 &&
    det.userFocus.length > 0 &&
    (!det.principalUsers.includes('other') || !!det.principalUsersOther) &&
    (!det.userFocus.includes('other') || !!det.userFocusOther);

  const available = input.candidates.filter((c) => c.status === 'available');
  const unassessed = available.filter((c) => !c.assessment);
  const selected = input.candidates.find((c) => c.key === det.selectedBenchmark);
  const benchmarkProblems = [
    unassessed.length && `Assess: ${unassessed.map((c) => c.label).join(', ')}.`,
    !det.selectedBenchmark && 'Select the benchmark (MAT-03).',
    selected?.assessment === 'not_suitable' && 'The selected benchmark is assessed Not Suitable.',
    det.selectedBenchmark &&
      det.selectedBenchmark !== 'other' &&
      !selected?.assessment &&
      'Assess the selected benchmark.',
    det.selectedBenchmark === 'other' &&
      !(det.otherBenchmarkLabel && det.otherBenchmarkAmount && det.otherBenchmarkSource) &&
      'Describe the Other benchmark, its amount and source.',
    det.selectedBenchmark &&
      !det.benchmarkRationale &&
      'Record why the selected benchmark is appropriate.',
  ].filter(Boolean) as string[];

  const normalisationUsed =
    input.adjustments.length > 0 || det.selectedBenchmark === 'normalised_pbt';
  const normProblems = normalisationUsed
    ? ([
        !input.adjustments.length && 'Add the adjustment lines behind the normalised benchmark.',
        input.adjustments.some((a) => !a.reason) && 'Every adjustment line needs a reason.',
        !det.normalisationRationale && 'Explain why the normalised measure is more representative.',
      ].filter(Boolean) as string[])
    : [];

  const omProblems = [
    det.selectedPct === null && 'Enter the selected percentage.',
    det.selectedOm === null && 'Select overall materiality.',
    det.selectedOm !== null &&
      !matchesCalculated(det.selectedOm, computed.liveCalculatedOm, computed.roundedOm) &&
      !det.omAdjustmentReason &&
      'Record why the selected OM differs from the calculated amount.',
    det.mat04 !== 'yes' && 'Answer MAT-04 "Yes".',
    computed.sourceChanged && 'Re-confirm the benchmark after the 03.2 figures changed.',
  ].filter(Boolean) as string[];

  const pmProblems = [
    det.pmPct === null && 'Enter the PM percentage.',
    det.selectedPm === null && 'Select performance materiality.',
    det.selectedPm !== null &&
      det.selectedOm !== null &&
      det.selectedPm >= det.selectedOm &&
      'PM must be below OM.',
    det.selectedPm !== null &&
      !matchesCalculated(det.selectedPm, computed.liveCalculatedPm, computed.roundedPm) &&
      !det.pmAdjustmentReason &&
      'Record why the selected PM differs from the calculated amount.',
    !det.aggregationFactors.length &&
      'Tick the aggregation-risk considerations taken into account.',
    !det.pmRationale && 'Record why PM is appropriate (MAT-05).',
  ].filter(Boolean) as string[];

  const needSpecific = input.qualitative.some((q) => q.response === 'specific_materiality');
  const specificProblems = [
    !det.mat06 && 'Answer MAT-06.',
    det.mat06 === 'further_assessment' && 'Conclude the further assessment of MAT-06.',
    det.mat06 === 'yes' && !input.specific.length && 'Add the specific materiality record(s).',
    needSpecific &&
      det.mat06 !== 'yes' &&
      'A qualitative matter calls for specific materiality — answer MAT-06 "Yes" and record it.',
  ].filter(Boolean) as string[];

  const unanswered = input.qualitative.filter((q) => !q.response);
  const furtherQ = input.qualitative.filter((q) => q.response === 'further_assessment');

  const overrideProblems = [
    computed.omMethodologyStatus === 'outside_guidance' &&
      !det.omOverrideReason &&
      'OM outside guidance needs an override rationale.',
    computed.pmMethodologyStatus === 'outside_guidance' &&
      !det.pmOverrideReason &&
      'PM outside guidance needs an override rationale.',
    computed.cttMethodologyStatus === 'outside_guidance' &&
      !det.cttOverrideReason &&
      'Clearly trivial outside guidance needs a rationale.',
  ].filter(Boolean) as string[];

  const traceable =
    det.selectedBenchmark === 'other'
      ? !!det.otherBenchmarkSource
      : input.dataset.ready && !!input.dataset.cySource && !computed.sourceChanged;

  const ownerless = input.revisionItems.filter((i) => i.applicable && !i.ownerEmployeeId);

  const checks: PlanningCompletionCheck[] = [
    check(
      'users',
      'MAT-01 principal users and MAT-02 likely user focus completed',
      usersOk,
      'Complete MAT-01 and MAT-02 (describe any "Other").',
    ),
    check(
      'benchmarks',
      'Candidate benchmarks evaluated with selected benchmark rationale',
      benchmarkProblems.length === 0,
      benchmarkProblems.join(' '),
    ),
    check(
      'normalisation',
      'Any normalisation fully supported and flagged for Partner Attention',
      normProblems.length === 0,
      normProblems.join(' '),
    ),
    check(
      'overall',
      'Overall Materiality calculated, selected and MAT-04 completed',
      omProblems.length === 0,
      omProblems.join(' '),
    ),
    check(
      'performance',
      'Performance Materiality determined with aggregation-risk considerations',
      pmProblems.length === 0,
      pmProblems.join(' '),
    ),
    check(
      'specific',
      'Need for Specific Materiality assessed and records completed',
      specificProblems.length === 0,
      specificProblems.join(' '),
    ),
    check(
      'clearly_trivial',
      'Clearly Trivial threshold selected and documented',
      det.selectedCtt !== null && !!det.cttRationale,
      det.selectedCtt === null
        ? 'Select the clearly trivial threshold.'
        : 'Document the basis for the clearly trivial threshold.',
    ),
    check(
      'qualitative',
      'Qualitative Materiality Challenge completed',
      unanswered.length === 0 && furtherQ.length === 0,
      [
        unanswered.length && `${unanswered.length} consideration(s) not answered.`,
        furtherQ.length &&
          `Conclude further assessment: ${furtherQ.map((q) => q.label).join('; ')}.`,
      ]
        .filter(Boolean)
        .join(' '),
    ),
    check(
      'sensitivity',
      'Sensitivity / cross-check reviewed and MAT-07 completed',
      det.mat07 === 'yes',
      'Review the cross-checks and answer MAT-07 "Yes".',
    ),
    check(
      'overrides',
      'All methodology overrides have rationale and Partner Attention',
      overrideProblems.length === 0,
      overrideProblems.join(' '),
    ),
    check(
      'traceable',
      'Source figures are traceable to 03.2 / evidence',
      traceable,
      det.selectedBenchmark === 'other'
        ? 'Record the source of the Other benchmark.'
        : computed.sourceChanged
          ? (computed.sourceChangeDetail ?? 'Source figures changed.')
          : 'Complete the 03.2.7 dataset header (units, currency, CY source).',
    ),
  ];
  if (det.versionNo > 1) {
    checks.push(
      check(
        'revision',
        'Affected work from the revision assigned for reassessment',
        ownerless.length === 0,
        `${ownerless.length} affected-work item(s) need an owner.`,
      ),
    );
  }
  checks.push(
    check(
      'summary',
      'Materiality conclusion generated',
      !!summary,
      'Draft and save the conclusion.',
    ),
    check(
      'mat08',
      'MAT-08 completed by the Engagement Manager',
      mat08 === 'yes_complete',
      'Answer MAT-08.',
    ),
  );
  return checks;
}

// ── 03.3.12 Conclusion ───────────────────────────────────────────────────────

export function composeMaterialityConclusion(input: {
  det: MaterialityDetermination;
  candidates: readonly BenchmarkCandidate[];
  adjustments: readonly NormalisationAdjustment[];
  normalisation: NormalisationSummary;
  specific: readonly SpecificMaterialityRecord[];
  qualitative: readonly QualitativeChallengeItem[];
  partnerAttention: readonly PartnerAttentionTrigger[];
  computed: MaterialityComputed;
  labels: { users: string[]; focus: string[] };
  unitLabel: string | null;
}): string {
  const { det, computed } = input;
  const lines: string[] = [];
  const block = (title: string, items: (string | null | false | undefined)[], empty: string) => {
    const kept = items.filter((x): x is string => !!x);
    if (lines.length) lines.push('');
    lines.push(title, ...(kept.length ? kept.map((x) => `- ${x}`) : [`- ${empty}`]));
  };
  block(
    'Principal users and likely user focus',
    [
      input.labels.users.length > 0 &&
        `Users: ${input.labels.users.join(', ')}${det.principalUsersOther ? ` (${det.principalUsersOther})` : ''}`,
      input.labels.focus.length > 0 &&
        `Measures of focus: ${input.labels.focus.join(', ')}${det.userFocusOther ? ` (${det.userFocusOther})` : ''}`,
    ],
    'Not yet recorded (MAT-01 / MAT-02).',
  );
  const assessed = input.candidates.filter((c) => c.assessment);
  const units = input.unitLabel ? ` ${input.unitLabel}` : '';
  block(
    'Selected benchmark and rationale',
    [
      det.selectedBenchmark &&
        `${MATERIALITY_BENCHMARK_LABEL[det.selectedBenchmark]}${det.selectedBenchmark === 'other' && det.otherBenchmarkLabel ? ` — ${det.otherBenchmarkLabel}` : ''}: ${computed.liveBenchmarkAmount ?? '—'}${units}`,
      det.benchmarkRationale,
      assessed.length > 0 &&
        `Candidates assessed: ${assessed.map((c) => `${c.label} (${c.assessment!.replace(/_/g, ' ')})`).join('; ')}`,
    ],
    'Not yet selected.',
  );
  block(
    'Normalisation',
    input.adjustments.length
      ? [
          `Reported PBT ${input.normalisation.reportedPbt ?? '—'} + adjustments ${input.normalisation.adjustmentsTotal} = normalised PBT ${input.normalisation.normalisedPbt ?? '—'}${units}`,
          ...input.adjustments.map(
            (a) =>
              `${a.code} ${a.description}: ${a.amount}${a.recurring ? ' (recurring)' : ' (non-recurring)'}`,
          ),
          det.normalisationRationale,
        ]
      : [],
    'No normalisation used.',
  );
  block(
    'Overall Materiality',
    [
      det.selectedOm !== null &&
        `${formatInr(det.selectedOm)} (${formatPct(det.selectedPct)} of the benchmark; calculated ${formatInr(computed.liveCalculatedOm)})`,
      det.omAdjustmentReason && `Adjusted from calculated: ${det.omAdjustmentReason}`,
      det.omOverrideReason && `Outside guidance: ${det.omOverrideReason}`,
    ],
    'Not yet determined.',
  );
  block(
    'Performance Materiality',
    [
      det.selectedPm !== null &&
        `${formatInr(det.selectedPm)} (${formatPct(computed.effectivePmPct)} of OM)`,
      det.pmRationale,
      det.pmOverrideReason && `Outside guidance: ${det.pmOverrideReason}`,
    ],
    'Not yet determined.',
  );
  block(
    'Specific Materiality',
    det.mat06 === 'no'
      ? ['Not required (MAT-06: No).', det.mat06Note]
      : input.specific.map(
          (s) =>
            `${s.code} ${SPECIFIC_SCOPE_TYPE_LABEL[s.scopeType]} — ${s.scope}: ${s.thresholdType === 'monetary' ? formatInr(s.amount) : 'qualitative / no fixed threshold'}. ${s.reason}`,
        ),
    'Not yet assessed (MAT-06).',
  );
  block(
    'Clearly Trivial',
    [
      det.selectedCtt !== null &&
        `${formatInr(det.selectedCtt)} (${formatPct(computed.effectiveCttPct)} of OM)`,
      det.cttRationale,
    ],
    'Not yet selected.',
  );
  block(
    'Qualitative considerations',
    input.qualitative
      .filter((q) => q.response && q.response !== 'no_special_implication')
      .map((q) => `${q.label}: ${q.response!.replace(/_/g, ' ')}${q.note ? ` — ${q.note}` : ''}`),
    'No qualitative matter requires special treatment.',
  );
  block(
    'Sensitivity conclusion',
    [
      det.mat07 === 'yes'
        ? 'Selected materiality remains reasonable against alternative measures (MAT-07).'
        : det.mat07 === 'no_reassess'
          ? 'Reassessment required (MAT-07).'
          : null,
      det.mat07Note,
    ],
    'MAT-07 not yet answered.',
  );
  block(
    'Partner Attention',
    input.partnerAttention.map((t) => `${t.label} — ${t.detail}`),
    'None.',
  );
  return lines.join('\n');
}

/** Consumers the determination is published to (§16). OM never auto-excludes an area. */
export const MATERIALITY_IMPACT_PREVIEW = [
  {
    consumer: '03.4 Scope & Approach',
    use: 'Planning consideration, not an automatic scoping rule.',
  },
  {
    consumer: '03.5 Audit Areas & Assertions',
    use: 'Balance comparison plus qualitative / risk considerations.',
  },
  { consumer: '03.6 Risks', use: 'Context only; risk assessment remains separate.' },
  { consumer: '03.7 Audit Programme / sampling', use: 'Parameter where methodology requires.' },
  { consumer: 'Execution workpapers', use: 'Testing / sampling parameters as applicable.' },
  {
    consumer: 'Section 07 Misstatement Register',
    use: 'OM, specific materiality, clearly trivial and current version.',
  },
  {
    consumer: 'Completion / reporting',
    use: 'Evaluation of accumulated misstatements and qualitative factors.',
  },
] as const;

export const QUALITATIVE_KEYS = QUALITATIVE_CONSIDERATIONS.map((q) => q.key);
