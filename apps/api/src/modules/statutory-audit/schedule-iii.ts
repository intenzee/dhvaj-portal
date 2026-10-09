import {
  CASH_FLOW_STATUS,
  COMPARATIVES_STATUS,
  DISCLOSURE_TRIGGER_LABEL,
  FRAMEWORK_AREA_KEY,
  FS_COMPONENTS,
  REPORTING_FRAMEWORK_LABEL,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  SCH01_RESULT,
  SCH_ANSWER,
  SCH_PROFESSIONAL_ACTION,
  SCH_PROVISION_CODE,
  SCHEDULE_III_OUTCOME,
  SCHEDULE_III_OUTCOME_LABEL,
  auditPeriodStartFromFinancialYear,
  formatInrCrore,
  ruleMeets,
  type ComparativesStatus,
  type DisclosureCategory,
  type DisclosureTrigger,
  type FrameworkState,
  type FrfCompletion as FrfCompletionShape,
  type FsComponent,
  type ResolvedRule,
  type RuleResolver,
  type Sch01Result,
  type SchAnswer,
  type ScheduleIiiCapturedFacts,
  type ScheduleIiiCashFlow,
  type ScheduleIiiComparatives,
  type ScheduleIiiComponentLine,
  type ScheduleIiiDetail,
  type ScheduleIiiDisclosure,
  type ScheduleIiiDownstreamOutput,
  type ScheduleIiiFactUsed,
  type ScheduleIiiFacts,
  type ScheduleIiiFrameworkVersion,
  type ScheduleIiiMissingFact,
  type ScheduleIiiOutcome,
  type ScheduleIiiPresentationMateriality,
  type ScheduleIiiResult,
  type ScheduleIiiRounding,
  type ScheduleIiiRuleApplied,
  type ScheduleIiiSpecialisedFormat,
  type ScheduleIiiSpecialisedRule,
} from '@hsdg/contracts';

/**
 * 02.3 Schedule III & Presentation Framework — pure engine (Implementation
 * Guide §9.3; DHVAJ Section 02.3 spec).
 *
 * Routes the Schedule III Division from the 02.2 reporting-framework conclusion
 * (AS → Division I; Ind AS non-NBFC → Division II; Ind AS NBFC → Division III),
 * sends an entity whose 02.1 category is governed by another statute's format
 * (library rules — bank, insurer, …) to the specialised-format assessment
 * instead of forcing a Division, then derives — from the versioned
 * presentation library for the audit period — the FS components, the
 * cash-flow requirement (consuming the 02.1 OPC/small/dormant results), the
 * rounding framework, the presentation-materiality threshold, the comparative
 * status and the disclosure library.
 *
 * NOTHING statutory lives here (spec §8): components, requirements, specialised
 * formats and framework versions arrive in {@link ScheduleIiiLibrary}; the
 * rounding band, its measure and permitted units, and the presentation
 * thresholds resolve from the Audit Rules Library through the injected
 * {@link RuleResolver}. A missing library row is reported as a missing fact —
 * the engine never falls back to a constant.
 *
 * Mirrors financial-reporting.ts so it unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.scheduleIii;
const PRESENTATION_MATERIALITY = 'presentation_materiality';

type Division = 'I' | 'II' | 'III';

/** A component line as stored on a framework version (`components` jsonb). */
export interface ScheduleIiiComponentSpec {
  key: string;
  label: string;
  when: 'always' | 'cash_flow_required';
  oci?: boolean;
}

/** A disclosure requirement row in force for the period. */
export interface ScheduleIiiRequirementRow {
  code: string;
  category: DisclosureCategory;
  label: string;
  description: string | null;
  trigger: DisclosureTrigger | null;
  provisionCode: string | null;
  crossLink: string | null;
  effectiveFrom: string;
}

/** The presentation library in force for the audit period, loaded by the service. */
export interface ScheduleIiiLibrary {
  frameworkVersions: Partial<
    Record<
      Division,
      { version: ScheduleIiiFrameworkVersion; components: ScheduleIiiComponentSpec[] }
    >
  >;
  requirements: Partial<Record<Division, ScheduleIiiRequirementRow[]>>;
  specialisedRules: ScheduleIiiSpecialisedRule[];
}

export const EMPTY_SCHEDULE_III_LIBRARY: ScheduleIiiLibrary = {
  frameworkVersions: {},
  requirements: {},
  specialisedRules: [],
};

/** Engagement context the service supplies (comparatives, SCH-04). */
export interface ScheduleIiiContext {
  priorEngagementId?: string | null;
  priorYearFileCount?: number;
}

const DIVISION_OF: Partial<Record<ScheduleIiiOutcome, Division>> = {
  division_i: 'I',
  division_ii: 'II',
  division_iii: 'III',
};
const ENTITY_CLASS_OF: Record<Division, string> = {
  I: 'division_i',
  II: 'division_ii',
  III: 'division_iii',
};

const AUDIT_MATERIALITY_NOTE =
  'Audit materiality (SA 320) is not calculated here — it is determined in Section 03 (Planning).';

// ── small helpers ─────────────────────────────────────────────────────────────

function yesNo(v: boolean | null | undefined): string {
  return v == null ? 'Not known' : v ? 'Yes' : 'No';
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function priorFy(fy: string | null | undefined): string | null {
  if (!fy || !/^\d{4}-\d{2}$/.test(fy)) return null;
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function periodEnd(start: string): string {
  return `${Number(start.slice(0, 4)) + 1}-03-31`;
}

function ruleApplied(rule: ResolvedRule, label: string, condition: string): ScheduleIiiRuleApplied {
  return {
    ruleCode: rule.ruleCode,
    ruleVersionId: rule.ruleVersionId,
    label,
    effectiveFrom: rule.effectiveFrom,
    condition,
    provisionId: rule.authorityProvisionId,
  };
}

// ── SCH-01 / SCH-02 — specialised statutory format (spec §5, §7) ──────────────

function assessSpecialised(
  f: ScheduleIiiFacts,
  library: ScheduleIiiLibrary,
  captured: ScheduleIiiCapturedFacts,
): ScheduleIiiSpecialisedFormat {
  const types = f.specialEntityTypes ?? [];
  const matched = library.specialisedRules.filter((r) => types.includes(r.entityCategory));
  let systemSuggested: SchAnswer = SCH_ANSWER.no;
  if (matched.length > 0) systemSuggested = SCH_ANSWER.yes;
  else if (
    f.isBankOrInsurance ||
    types.includes('other_regulator') ||
    f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.specialised
  )
    // Regulated, but no library rule says how — never force a Division.
    systemSuggested = SCH_ANSWER.furtherAssessment;

  const answer = captured.specialisedAnswer ?? null;
  const effective = answer ?? systemSuggested;
  const rule = matched[0] ?? null;
  const governingAuthority = captured.governingAuthority ?? rule?.governingAuthority ?? null;
  const frameworkName = captured.frameworkName ?? rule?.frameworkName ?? null;
  const effect = captured.specialisedEffect ?? rule?.effect ?? null;
  const provisionId = captured.specialisedProvisionId ?? rule?.provisionId ?? null;
  const reference =
    captured.specialisedReference ?? (rule?.provisionCode ? rule.provisionCode : null);

  let sch01: Sch01Result = SCH01_RESULT.yes;
  if (effective === SCH_ANSWER.yes) sch01 = SCH01_RESULT.specialised;
  else if (effective === SCH_ANSWER.furtherAssessment) sch01 = SCH01_RESULT.furtherAssessment;

  const resolved =
    effective === SCH_ANSWER.no
      ? systemSuggested === SCH_ANSWER.no || answer === SCH_ANSWER.no
      : effective === SCH_ANSWER.yes &&
        answer === SCH_ANSWER.yes &&
        !!governingAuthority &&
        !!frameworkName &&
        !!effect &&
        (!!provisionId || !!reference);

  return {
    sch01,
    systemSuggested,
    matchedRules: matched,
    answer,
    governingAuthority,
    frameworkName,
    effect,
    effectiveVersion: captured.specialisedVersion ?? rule?.effectiveFrom ?? null,
    provisionId,
    reference,
    resolved,
  };
}

// ── SCH-03 — cash flow (spec §10) ─────────────────────────────────────────────

function assessCashFlow(f: ScheduleIiiFacts): ScheduleIiiCashFlow {
  const exemptors: string[] = [];
  if (f.isOpc) exemptors.push('One Person Company');
  if (f.isSmallCompany) exemptors.push('small company (§2(85), 02.1)');
  if (f.isDormant) exemptors.push('dormant company (§455, 02.1)');
  const classifications = [
    `One Person Company: ${yesNo(f.isOpc)}`,
    `Small company (02.1): ${yesNo(f.isSmallCompany)}`,
    `Dormant company: ${yesNo(f.isDormant)}`,
  ];
  if (exemptors.length > 0)
    return {
      status: CASH_FLOW_STATUS.exempt,
      basis: `Exempt under the §2(40) proviso — ${exemptors.join(', ')}.`,
      classifications,
      provisionCode: SCH_PROVISION_CODE.cashFlowExemption,
      provisionId: null,
    };
  if (f.profileConfirmed === false)
    return {
      status: CASH_FLOW_STATUS.furtherAssessment,
      basis:
        'No exemption applies on the current 02.1 facts, but 02.1 is not confirmed yet — the small-company result is not final.',
      classifications,
      provisionCode: SCH_PROVISION_CODE.cashFlowExemption,
      provisionId: null,
    };
  return {
    status: CASH_FLOW_STATUS.required,
    basis:
      'Required — the company is not a One Person Company, small company or dormant company (§2(40) proviso does not apply).',
    classifications,
    provisionCode: SCH_PROVISION_CODE.cashFlowExemption,
    provisionId: null,
  };
}

// ── SCH-05 — rounding (spec §14) ──────────────────────────────────────────────

function assessRounding(
  f: ScheduleIiiFacts,
  resolve: RuleResolver,
  captured: ScheduleIiiCapturedFacts,
  applies: boolean,
): {
  rounding: ScheduleIiiRounding;
  rule: ResolvedRule | null;
  applied: ScheduleIiiRuleApplied | null;
} {
  const base: ScheduleIiiRounding = {
    sourceLabel: 'Turnover (02.1)',
    sourceAmount: f.turnover,
    ruleCode: null,
    ruleVersionId: null,
    effectiveFrom: null,
    threshold: null,
    band: null,
    permittedUnits: [],
    systemUnit: null,
    selectedUnit: captured.roundingUnit ?? null,
    overridden: false,
    reason: captured.roundingReason ?? null,
    provisionId: null,
    basis: '',
  };
  if (!applies)
    return {
      rounding: {
        ...base,
        basis: 'Rounding follows the specialised statutory format, not the Schedule III rule.',
      },
      rule: null,
      applied: null,
    };
  const rule = resolve(AREA, RULE_CRITERION.turnover);
  if (!rule || rule.threshold == null)
    return {
      rounding: {
        ...base,
        basis: 'No Schedule III rounding rule in the Rules Library for this period.',
      },
      rule: null,
      applied: null,
    };
  const c = rule.condition ?? {};
  const measure = str(c.measure) ?? 'turnover';
  const measureLabel = str(c.measureLabel) ?? 'Turnover';
  const sourceLabel =
    measure === 'turnover'
      ? `${measureLabel} (02.1)`
      : `${measureLabel} — 02.1 turnover used as proxy (02.1 holds no ${measureLabel.toLowerCase()} figure)`;
  const below = strList(c.belowUnits);
  const above = strList(c.atOrAboveUnits);
  const mandatory = c.mandatory === true;
  const common = {
    ...base,
    sourceLabel,
    ruleCode: rule.ruleCode,
    ruleVersionId: rule.ruleVersionId,
    effectiveFrom: rule.effectiveFrom,
    threshold: rule.threshold,
  };
  if (f.turnover == null)
    return {
      rounding: {
        ...common,
        basis: `Band pending — ${measureLabel.toLowerCase()} not captured in 02.1 (band splits at ${formatInrCrore(rule.threshold)}).`,
      },
      rule,
      applied: ruleApplied(rule, 'Schedule III rounding band', 'Measure not captured'),
    };
  const atOrAbove = ruleMeets(f.turnover, rule);
  const permitted = atOrAbove ? above : below;
  const suggested = str(atOrAbove ? c.suggestedAtOrAbove : c.suggestedBelow);
  const systemUnit =
    suggested && permitted.includes(suggested) ? suggested : (permitted[0] ?? null);
  const selected = captured.roundingUnit ?? null;
  const condition = `${measureLabel} ${formatInrCrore(f.turnover)} ${atOrAbove ? '≥' : '<'} ${formatInrCrore(rule.threshold)}`;
  return {
    rounding: {
      ...common,
      band: atOrAbove ? 'at_or_above' : 'below',
      permittedUnits: permitted,
      systemUnit,
      selectedUnit: selected,
      overridden: selected != null && systemUnit != null && selected !== systemUnit,
      basis:
        permitted.length === 0
          ? `${condition} — the rule version lists no permitted units.`
          : `${condition} — ${mandatory ? 'figures shall be rounded' : 'figures may be rounded'} to the nearest ${permitted.join(' / ')} (or decimals thereof).`,
    },
    rule,
    applied: ruleApplied(rule, 'Schedule III rounding band', condition),
  };
}

// ── §15 — presentation materiality ────────────────────────────────────────────

function assessPresentationMateriality(
  f: ScheduleIiiFacts,
  resolve: RuleResolver,
  division: Division | null,
): { pm: ScheduleIiiPresentationMateriality; applied: ScheduleIiiRuleApplied | null } {
  const empty: ScheduleIiiPresentationMateriality = {
    label: 'Financial Statement Presentation Materiality / Disclosure Threshold',
    ruleCode: null,
    ruleVersionId: null,
    percentOfRevenue: null,
    floor: null,
    measureLabel: 'Revenue from operations',
    measureAmount: f.turnover,
    amount: null,
    basis: '',
    provisionId: null,
    auditMaterialityNote: AUDIT_MATERIALITY_NOTE,
  };
  if (!division)
    return {
      pm: {
        ...empty,
        basis: 'Set by the governing framework once the presentation route is determined.',
      },
      applied: null,
    };
  const rule = resolve(AREA, PRESENTATION_MATERIALITY, ENTITY_CLASS_OF[division]);
  if (!rule)
    return {
      pm: {
        ...empty,
        basis: `No presentation threshold in the Rules Library for Division ${division}.`,
      },
      applied: null,
    };
  const c = rule.condition ?? {};
  const pct = num(c.percentOfMeasure);
  const measure = str(c.measure) ?? 'revenue_from_operations';
  const label = str(c.measureLabel) ?? 'Revenue from operations';
  const measureLabel =
    measure === 'revenue_from_operations'
      ? `${label} (02.1 turnover)`
      : `${label} — 02.1 turnover used as proxy`;
  const floor = rule.threshold;
  const pctAmount = pct != null && f.turnover != null ? (f.turnover * pct) / 100 : null;
  const amount =
    pctAmount == null && floor == null
      ? null
      : c.whicheverHigher === false
        ? (pctAmount ?? floor)
        : Math.max(pctAmount ?? 0, floor ?? 0);
  const parts = [
    pct != null ? `${pct}% of ${label.toLowerCase()}` : null,
    floor != null ? formatInrCrore(floor) : null,
  ].filter(Boolean);
  const basis =
    f.turnover == null
      ? `Items above ${parts.join(' or ')}, whichever is higher, are disclosed separately — ${label.toLowerCase()} not captured, so the floor applies until it is.`
      : `Items of income or expenditure above ${parts.join(' or ')}, whichever is higher (= ${formatInrCrore(amount ?? 0)}), are disclosed separately.`;
  return {
    pm: {
      ...empty,
      ruleCode: rule.ruleCode,
      ruleVersionId: rule.ruleVersionId,
      percentOfRevenue: pct,
      floor,
      measureLabel,
      amount: f.turnover == null ? floor : amount,
      basis,
      provisionId: rule.authorityProvisionId,
    },
    applied: ruleApplied(rule, `Division ${division} presentation threshold`, basis),
  };
}

// ── §11 / §12 — disclosure library ────────────────────────────────────────────

function triggerReason(
  trigger: DisclosureTrigger,
  value: boolean | null | undefined,
): { applicability: ScheduleIiiDisclosure['applicability']; reason: string } {
  const label = DISCLOSURE_TRIGGER_LABEL[trigger];
  if (value === true) return { applicability: 'triggered', reason: `Triggered — ${label}.` };
  if (value === false)
    return { applicability: 'not_triggered', reason: `Not triggered — ${label}: No.` };
  return {
    applicability: 'included_pending_fact',
    reason: `Included — whether "${label.toLowerCase()}" is not yet known; an unknown or zero balance never suppresses a rule-required disclosure.`,
  };
}

function disclosureLibrary(
  f: ScheduleIiiFacts,
  rows: ScheduleIiiRequirementRow[],
): ScheduleIiiDisclosure[] {
  return rows.map((r) => {
    const t = r.trigger
      ? triggerReason(r.trigger, f.triggers?.[r.trigger])
      : {
          applicability: 'baseline' as const,
          reason: 'Mandatory under the applicable Schedule III version.',
        };
    return {
      code: r.code,
      category: r.category,
      label: r.label,
      description: r.description,
      trigger: r.trigger,
      applicability: t.applicability,
      reason: t.reason,
      provisionCode: r.provisionCode,
      provisionId: null,
      crossLink: r.crossLink,
      effectiveFrom: r.effectiveFrom,
    };
  });
}

// ── §9 — components ───────────────────────────────────────────────────────────

function componentLines(
  specs: ScheduleIiiComponentSpec[],
  cashFlow: ScheduleIiiCashFlow,
): ScheduleIiiComponentLine[] {
  return specs.map((s) => {
    if (s.when === 'cash_flow_required') {
      const required = cashFlow.status !== CASH_FLOW_STATUS.exempt;
      return {
        key: s.key,
        label: s.label,
        required,
        basis:
          cashFlow.status === CASH_FLOW_STATUS.exempt
            ? cashFlow.basis
            : cashFlow.status === CASH_FLOW_STATUS.furtherAssessment
              ? 'Loaded until the SCH-03 exemption test is final.'
              : 'Required — no §2(40) exemption applies.',
      };
    }
    return {
      key: s.key,
      label: s.label,
      required: true,
      basis: 'Required by the applicable Schedule III Division.',
      ...(s.oci ? { includesOci: true } : {}),
    };
  });
}

// ── SCH-04 — comparatives (spec §13) ──────────────────────────────────────────

function assessComparatives(
  f: ScheduleIiiFacts,
  captured: ScheduleIiiCapturedFacts,
  ctx: ScheduleIiiContext,
): ScheduleIiiComparatives {
  const fy = f.financialYear ?? null;
  const prior = priorFy(fy);
  const inc = f.incorporationDate ?? null;
  let firstFinancialYear = false;
  let system: ComparativesStatus = COMPARATIVES_STATUS.required;
  let basis: string;
  if (!fy) {
    system = COMPARATIVES_STATUS.furtherAssessment;
    basis = 'The audit financial year is not set on the engagement.';
  } else {
    const start = auditPeriodStartFromFinancialYear(fy);
    if (inc && inc >= start && inc <= periodEnd(start)) {
      firstFinancialYear = true;
      system = COMPARATIVES_STATUS.notApplicable;
      basis = `First financial year — incorporated on ${inc}, so there is no immediately preceding reporting period.`;
    } else {
      basis = inc
        ? `Corresponding amounts for ${prior} are required (incorporated ${inc}, before this period).`
        : `Corresponding amounts for ${prior} are required — the incorporation date is not on the entity master; confirm it is not the first financial year.`;
    }
  }
  const confirmed = captured.comparativesStatus ?? null;
  return {
    system,
    status: confirmed ?? system,
    confirmed,
    reason: captured.comparativesReason ?? null,
    firstFinancialYear,
    incorporationDate: inc,
    priorPeriod: firstFinancialYear ? null : prior,
    priorEngagementId: ctx.priorEngagementId ?? null,
    priorYearFileCount: ctx.priorYearFileCount ?? 0,
    basis,
  };
}

// ── facts used / missing (spec §2, §3) ────────────────────────────────────────

function factsUsed(f: ScheduleIiiFacts): ScheduleIiiFactUsed[] {
  const t = f.triggers ?? {};
  const fact = (
    key: string,
    label: string,
    value: string,
    source: string,
  ): ScheduleIiiFactUsed => ({
    key,
    label,
    value,
    source,
    anchor: null,
  });
  return [
    fact(
      'reporting_framework',
      'Financial reporting framework',
      f.reportingFramework ? REPORTING_FRAMEWORK_LABEL[f.reportingFramework] : 'Not concluded',
      '02.2',
    ),
    fact('first_time_ind_as', 'First-time Ind AS adoption', yesNo(f.firstTimeIndAs), '02.2'),
    fact(
      'special_entity_types',
      'Regulated / special entity classification',
      (f.specialEntityTypes ?? []).length ? (f.specialEntityTypes ?? []).join(', ') : 'None',
      '02.1',
    ),
    fact('nbfc', 'NBFC / HFC', yesNo(f.isNbfc), '02.1'),
    fact('opc', 'One Person Company', yesNo(f.isOpc), '02.1'),
    fact('small_company', 'Small company (§2(85))', yesNo(f.isSmallCompany), '02.1'),
    fact('dormant', 'Dormant company', yesNo(f.isDormant), '02.1'),
    fact(
      'turnover',
      'Turnover',
      f.turnover == null ? 'Not captured' : formatInrCrore(f.turnover),
      '02.1',
    ),
    fact(
      'borrowings',
      'Borrowings',
      f.borrowings == null ? 'Not captured' : formatInrCrore(f.borrowings),
      '02.1',
    ),
    fact('csr_applicable', 'CSR applicable', yesNo(t.csr_applicable), 'Section 02'),
    fact('cfs_required', 'Consolidated FS required', yesNo(t.cfs_required), '02.6'),
    fact(
      'incorporation_date',
      'Incorporation date',
      f.incorporationDate ?? 'Not recorded',
      'Entity master',
    ),
    fact('financial_year', 'Financial year', f.financialYear ?? 'Not set', 'Engagement'),
  ];
}

function missing(key: string, label: string, source: string): ScheduleIiiMissingFact {
  return { key, label, source, anchor: null };
}

// ── result assembly ───────────────────────────────────────────────────────────

function emptyDetail(overrides: Partial<ScheduleIiiDetail> = {}): ScheduleIiiDetail {
  return {
    division: null,
    divisionProvisionCode: null,
    cashFlowRequired: false,
    cashFlowExemptionReason: null,
    cashFlowProvisionId: null,
    requiredComponents: [],
    roundingThreshold: null,
    roundingUnits: [],
    disclosures: [],
    ...overrides,
  };
}

function downstream(
  outcome: ScheduleIiiOutcome,
  d: Pick<
    ScheduleIiiDetail,
    | 'frameworkVersion'
    | 'cashFlow'
    | 'rounding'
    | 'disclosureLibrary'
    | 'componentLines'
    | 'specialised'
    | 'cfsPresentationRequired'
  >,
): ScheduleIiiDownstreamOutput[] {
  const lib = (d.disclosureLibrary ?? []).filter((r) => r.applicability !== 'not_triggered');
  const comps = (d.componentLines ?? []).filter((c) => c.required).map((c) => c.label);
  const unit = d.rounding?.selectedUnit ?? d.rounding?.systemUnit ?? null;
  return [
    {
      key: 'division',
      label: 'Schedule III Division + version',
      value: d.frameworkVersion
        ? `${SCHEDULE_III_OUTCOME_LABEL[outcome]} — ${d.frameworkVersion.versionLabel}`
        : SCHEDULE_III_OUTCOME_LABEL[outcome],
      usedBy: 'Financial-statement review, Section 06 and Section 07 Completion',
    },
    {
      key: 'components',
      label: 'Financial-statement components',
      value: comps.length ? comps.join(', ') : 'Per the governing format',
      usedBy: 'FS workbook / completion review',
    },
    {
      key: 'cash_flow',
      label: 'Cash-flow applicability',
      value: d.cashFlow ? d.cashFlow.status.replace('_', ' ') : '—',
      usedBy: 'FS preparation / review',
    },
    {
      key: 'disclosures',
      label: 'Disclosure library',
      value: `${lib.length} requirement(s)`,
      usedBy: 'Audit Areas and final disclosure review',
    },
    {
      key: 'rounding',
      label: 'Rounding framework',
      value: unit ? `Nearest ${unit}` : 'Pending',
      usedBy: 'FS workbook / presentation review',
    },
    {
      key: 'specialised',
      label: 'Special regulatory modifications',
      value:
        d.specialised && d.specialised.sch01 === SCH01_RESULT.specialised
          ? `${d.specialised.frameworkName ?? 'Specialised format'} (${d.specialised.effect ?? 'effect pending'})`
          : 'None',
      usedBy: 'Relevant audit / reporting work',
    },
    {
      key: 'template',
      label: 'Template version',
      value: d.frameworkVersion?.templateKey ?? 'Not mapped',
      usedBy: 'SharePoint FS workbook',
    },
    {
      key: 'cfs',
      label: 'CFS presentation flags',
      value: d.cfsPresentationRequired ? 'Consolidated presentation required' : 'Not required',
      usedBy: '02.6 / group and consolidated FS work',
    },
  ];
}

/**
 * The 02.3 decision sequence (spec §5–§15). Order matters: 02.2 must be
 * concluded; SCH-01/02 test a specialised statutory format before any
 * Division; otherwise the 02.2 conclusion selects the Division and the
 * versioned library supplies everything presented.
 */
export function assessScheduleIii(
  f: ScheduleIiiFacts,
  resolve: RuleResolver,
  library: ScheduleIiiLibrary = EMPTY_SCHEDULE_III_LIBRARY,
  captured: ScheduleIiiCapturedFacts = {},
  ctx: ScheduleIiiContext = {},
): ScheduleIiiResult {
  const used = factsUsed(f);
  const missingFacts: ScheduleIiiMissingFact[] = [];
  if (f.profileConfirmed === false)
    missingFacts.push(
      missing('profile_confirmed', '02.1 Entity & Regulatory Profile confirmation', '02.1'),
    );

  // 1. 02.2 must be concluded — 02.3 routes from it, never re-decides it.
  if (f.reportingFramework == null) {
    missingFacts.push(
      missing('reporting_framework', 'Financial reporting framework (02.2)', '02.2'),
    );
    return {
      outcome: SCHEDULE_III_OUTCOME.informationInsufficient,
      state: 'pending_information',
      basis:
        'The 02.2 financial-reporting framework is not concluded — conclude it before routing Schedule III.',
      ruleVersionId: null,
      authorityProvisionId: null,
      detail: emptyDetail({ factsUsed: used, missingFacts, blockingReview: true }),
    };
  }

  const specialised = assessSpecialised(f, library, captured);
  const cashFlow = assessCashFlow(f);
  const comparatives = assessComparatives(f, captured, ctx);
  const cfsPresentationRequired = f.triggers?.cfs_required === true;

  // 2. Route: specialised format / further assessment / Division.
  let outcome: ScheduleIiiOutcome;
  let division: Division | null = null;
  let label: string;
  if (specialised.sch01 === SCH01_RESULT.specialised) {
    outcome = SCHEDULE_III_OUTCOME.specialisedFormat;
    label = `A specialised statutory format applies — ${specialised.frameworkName ?? 'governing format to be recorded'} (${specialised.governingAuthority ?? 'authority to be recorded'}); no Schedule III Division is forced.`;
  } else if (specialised.sch01 === SCH01_RESULT.furtherAssessment) {
    outcome = SCHEDULE_III_OUTCOME.professionalReview;
    label =
      'The entity is regulated but no library rule settles whether another statute prescribes its format — further assessment required (SCH-02).';
  } else if (f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.accountingStandards) {
    outcome = SCHEDULE_III_OUTCOME.divisionI;
    division = 'I';
    label =
      'Schedule III Division I (Accounting Standards) applies — routed from the 02.2 conclusion.';
  } else if (f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.indAs) {
    outcome = f.isNbfc ? SCHEDULE_III_OUTCOME.divisionIII : SCHEDULE_III_OUTCOME.divisionII;
    division = f.isNbfc ? 'III' : 'II';
    label = f.isNbfc
      ? 'Schedule III Division III (Ind AS, NBFC) applies — routed from the 02.2 conclusion.'
      : 'Schedule III Division II (Ind AS, other than NBFC) applies — routed from the 02.2 conclusion.';
  } else {
    missingFacts.push(
      missing('reporting_framework', 'A decisive 02.2 conclusion (Ind AS / AS)', '02.2'),
    );
    return {
      outcome: SCHEDULE_III_OUTCOME.informationInsufficient,
      state: 'pending_information',
      basis:
        'The 02.2 conclusion is not a decisive framework (Ind AS / AS) and no specialised format applies — resolve 02.2 before routing Schedule III.',
      ruleVersionId: null,
      authorityProvisionId: null,
      detail: emptyDetail({
        sch01: specialised.sch01,
        specialised,
        cashFlow,
        comparatives,
        factsUsed: used,
        missingFacts,
        blockingReview: true,
      }),
    };
  }

  // 3. The versioned framework for the period (spec §8, §9).
  const fv = division ? (library.frameworkVersions[division] ?? null) : null;
  if (division && !fv)
    missingFacts.push(
      missing(
        'framework_version',
        `Schedule III Division ${division} version for the audit period`,
        'Presentation library',
      ),
    );
  const lines = fv ? componentLines(fv.components, cashFlow) : [];
  const lib = division ? disclosureLibrary(f, library.requirements[division] ?? []) : [];
  if (division && fv && lib.length === 0)
    missingFacts.push(
      missing(
        'disclosure_library',
        'Disclosure requirements for the version',
        'Presentation library',
      ),
    );

  const {
    rounding,
    rule: roundingRule,
    applied: roundingApplied,
  } = assessRounding(f, resolve, captured, division != null);
  if (division && f.turnover == null)
    missingFacts.push(missing('turnover', 'Turnover / total income', '02.1'));
  const { pm, applied: pmApplied } = assessPresentationMateriality(f, resolve, division);

  const rulesApplied = [roundingApplied, pmApplied].filter(
    (r): r is ScheduleIiiRuleApplied => r != null,
  );
  const requiredComponents = lines
    .filter((l) => l.required && (FS_COMPONENTS as string[]).includes(l.key))
    .map((l) => l.key as FsComponent);
  const blockingReview =
    outcome === SCHEDULE_III_OUTCOME.professionalReview ||
    (outcome === SCHEDULE_III_OUTCOME.specialisedFormat && !specialised.resolved) ||
    (division != null && !fv);

  const partial: ScheduleIiiDetail = emptyDetail({
    division: division ? outcome : null,
    divisionProvisionCode:
      fv?.version.provisionCode ??
      (division ? SCH_PROVISION_CODE[`division${division}` as 'divisionI'] : null),
    cashFlowRequired: cashFlow.status !== CASH_FLOW_STATUS.exempt,
    cashFlowExemptionReason: cashFlow.status === CASH_FLOW_STATUS.exempt ? cashFlow.basis : null,
    requiredComponents,
    roundingThreshold: rounding.threshold,
    roundingUnits: rounding.permittedUnits,
    disclosures: lib.filter((r) => r.applicability !== 'not_triggered').map((r) => r.label),
    sch01: specialised.sch01,
    frameworkVersion: fv?.version ?? null,
    componentLines: lines,
    cashFlow,
    rounding,
    presentationMateriality: pm,
    disclosureLibrary: lib,
    specialised,
    comparatives,
    rulesApplied,
    factsUsed: used,
    missingFacts,
    cfsPresentationRequired,
    blockingReview,
  });
  partial.downstream = downstream(outcome, partial);

  const basis = [
    label,
    fv ? `${fv.version.title}, ${fv.version.versionLabel}.` : null,
    `Cash Flow Statement: ${cashFlow.basis}`,
    division ? rounding.basis : null,
  ]
    .filter(Boolean)
    .join(' ');

  const state: FrameworkState =
    outcome === SCHEDULE_III_OUTCOME.specialisedFormat ||
    outcome === SCHEDULE_III_OUTCOME.professionalReview
      ? 'professional_judgement_required'
      : 'system_suggested_applicable';

  return {
    outcome,
    state,
    basis,
    ruleVersionId: roundingRule?.ruleVersionId ?? null,
    authorityProvisionId: null,
    detail: partial,
  };
}

/** The division letter for a Division outcome, else null. */
export function divisionOf(outcome: ScheduleIiiOutcome | string | null): Division | null {
  return outcome ? (DIVISION_OF[outcome as ScheduleIiiOutcome] ?? null) : null;
}

// ── §20 completion ────────────────────────────────────────────────────────────

export interface ScheduleIiiCompletionInput {
  detail: ScheduleIiiDetail | null;
  /** The decided conclusion (null when undecided). */
  conclusion: ScheduleIiiOutcome | null;
  professionalAction: string | null;
  partnerRequired: boolean;
  partnerApproved: boolean;
  needsReevaluation: boolean;
  /** Something has been recorded (answers or a decision). */
  started: boolean;
}

/**
 * Spec §20 — 02.3 is COMPLETE only when every criterion is met. `met: null`
 * marks a criterion that does not apply to this engagement (e.g. the Division
 * when a specialised format replaces Schedule III).
 */
export function scheduleIiiCompletion(i: ScheduleIiiCompletionInput): FrfCompletionShape {
  const d = i.detail;
  const isDivision = divisionOf(i.conclusion) != null;
  const specialised = i.conclusion === SCHEDULE_III_OUTCOME.specialisedFormat;
  const sch = d?.specialised;
  const specialisedRelevant =
    specialised || (sch != null && (sch.systemSuggested !== SCH_ANSWER.no || sch.answer != null));
  const comps = d?.comparatives;
  const unit = d?.rounding?.selectedUnit ?? null;
  const items: FrfCompletionShape['items'] = [
    {
      key: 'route',
      label: 'Schedule III / specialised statutory-format route determined',
      met: i.conclusion != null && d?.sch01 !== SCH01_RESULT.furtherAssessment,
      detail: d?.sch01 ? `SCH-01: ${d.sch01.replace('_', ' ')}` : null,
    },
    {
      key: 'division',
      label: 'Correct Division determined where Schedule III applies',
      met: specialised ? null : isDivision,
      detail: i.conclusion ? SCHEDULE_III_OUTCOME_LABEL[i.conclusion] : null,
    },
    {
      key: 'version',
      label: 'Applicable Schedule III version and guidance version resolved',
      met: specialised ? null : !!d?.frameworkVersion && !!d.frameworkVersion.guidanceVersion,
      detail: d?.frameworkVersion
        ? `${d.frameworkVersion.versionLabel}; ICAI Guidance Note ${d.frameworkVersion.guidanceVersion ?? '—'}`
        : null,
    },
    {
      key: 'components',
      label: 'Required financial-statement components loaded',
      met: specialised ? null : (d?.componentLines ?? []).some((c) => c.required),
      detail: null,
    },
    {
      key: 'cash_flow',
      label: 'Cash-flow requirement / exemption determined',
      met: d?.cashFlow ? d.cashFlow.status !== CASH_FLOW_STATUS.furtherAssessment : false,
      detail: d?.cashFlow?.basis ?? null,
    },
    {
      key: 'rounding',
      label: 'Rounding framework determined (unit confirmed)',
      met: specialised ? null : unit != null && (d?.rounding?.permittedUnits ?? []).includes(unit),
      detail: unit ? `Nearest ${unit}` : 'Confirm or override the unit (SCH-05).',
    },
    {
      key: 'disclosures',
      label: 'Applicable disclosure library loaded',
      met: specialised ? null : (d?.disclosureLibrary ?? []).length > 0,
      detail: d?.disclosureLibrary ? `${d.disclosureLibrary.length} requirement(s)` : null,
    },
    {
      key: 'comparatives',
      label: 'Comparative-information status established',
      met:
        comps == null
          ? false
          : comps.status === COMPARATIVES_STATUS.notApplicable
            ? true
            : comps.status === COMPARATIVES_STATUS.required
              ? comps.priorYearFileCount > 0 || comps.priorEngagementId != null
              : false,
      detail:
        comps?.status === COMPARATIVES_STATUS.required &&
        comps.priorYearFileCount === 0 &&
        comps.priorEngagementId == null
          ? `Link the ${comps.priorPeriod ?? 'prior-year'} financial statements (SCH-04).`
          : (comps?.basis ?? null),
    },
    {
      key: 'specialised',
      label: 'Any specialised-format issue resolved or approved',
      met: specialisedRelevant
        ? (sch?.resolved ?? false) || (specialised && i.partnerApproved)
        : null,
      detail: sch?.frameworkName ?? null,
    },
    {
      key: 'conclusion',
      label: 'Manager confirms the system assessment or documents an override',
      met:
        i.conclusion != null &&
        (i.professionalAction === SCH_PROFESSIONAL_ACTION.confirm ||
          i.professionalAction === SCH_PROFESSIONAL_ACTION.override),
      detail: i.professionalAction,
    },
    {
      key: 'partner',
      label: 'Engagement Partner approval for a significant override',
      met: i.partnerRequired ? i.partnerApproved : null,
      detail: null,
    },
    {
      key: 'blocking',
      label: 'No blocking presentation-framework matter remains',
      met:
        !i.needsReevaluation &&
        i.professionalAction !== SCH_PROFESSIONAL_ACTION.informationPending &&
        !(d?.blockingReview && !(specialised && (sch?.resolved || i.partnerApproved))),
      detail: i.needsReevaluation ? 'An upstream fact changed — re-evaluate 02.3.' : null,
    },
  ];
  const complete = items.every((it) => it.met !== false);
  return {
    complete,
    status: complete ? 'complete' : i.started ? 'in_progress' : 'not_started',
    items,
  };
}
