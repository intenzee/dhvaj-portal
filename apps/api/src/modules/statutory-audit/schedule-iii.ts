import {
  FRAMEWORK_AREA_KEY,
  FS_COMPONENT,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  SCHEDULE_III_OUTCOME,
  formatInrCrore,
  ruleMeets,
  type FsComponent,
  type ScheduleIiiDetail,
  type ScheduleIiiFacts,
  type ScheduleIiiResult,
  type FrameworkState,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.3 Schedule III & Presentation Framework — pure engine (Implementation
 * Guide §9.3).
 *
 * Routes the Schedule III Division from the 02.2 reporting-framework conclusion
 * (AS → Division I; Ind AS non-NBFC → Division II; Ind AS NBFC → Division III),
 * lets a bank/insurer/regulated entity fall to a specialised statutory format
 * (never forcing a Division), then derives the required FS components, the
 * cash-flow requirement/exemption (consuming the 02.1 OPC/small/dormant flags),
 * the rounding band and the disclosure library.
 *
 * NO statutory number lives here (guide §1): the ₹100cr rounding turnover band
 * resolves from the Audit Rules Library through the injected {@link RuleResolver}
 * and the basis names the ACTUAL limit; the Division's Schedule III provision is
 * cited by code and frozen period-correct by the service. Where 02.2 is not yet
 * concluded it returns `information_insufficient` — it never guesses.
 *
 * Mirrors financial-reporting.ts so it unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.scheduleIii;

/** Presentation rounding units (Schedule III General Instructions) — labels, not thresholds. */
const ROUNDING_UNITS_BELOW = ['hundreds', 'thousands', 'lakhs', 'millions'];
const ROUNDING_UNITS_AT_OR_ABOVE = ['lakhs', 'millions', 'crores'];

/** Ind AS 101 first-time-adoption reconciliation disclosure (fact-triggered). */
const INDAS_101_DISCLOSURE = 'First-time adoption reconciliations (Ind AS 101)';

/** Baseline rule-required disclosures per Division (never suppressed by a zero balance). */
const DIVISION_I_DISCLOSURES = [
  'Significant accounting policies (AS 1)',
  'Contingent liabilities and commitments',
  'Related party disclosures (AS 18)',
  'Ageing schedules — trade receivables & trade payables (Schedule III)',
  'Prescribed financial ratios (Schedule III General Instructions)',
];
const IND_AS_DISCLOSURES = [
  'Material accounting policy information (Ind AS 1)',
  'Financial instruments — categories & fair value (Ind AS 107 / 113)',
  'Related party disclosures (Ind AS 24)',
  'Ageing schedules — trade receivables & trade payables (Schedule III)',
  'Prescribed financial ratios (Schedule III General Instructions)',
];

function detail(overrides: Partial<ScheduleIiiDetail> = {}): ScheduleIiiDetail {
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

function result(
  outcome: ScheduleIiiResult['outcome'],
  state: FrameworkState,
  basis: string,
  d: ScheduleIiiDetail,
  ruleVersionId: string | null = null,
): ScheduleIiiResult {
  return { outcome, state, basis, ruleVersionId, authorityProvisionId: null, detail: d };
}

/**
 * Resolve the Schedule III rounding band from the library. Returns the threshold,
 * the permitted rounding units for the entity's turnover, and the rule version to
 * freeze. Rounding is presentation-only, so a missing rule/turnover never blocks
 * the Division conclusion — it just leaves the band pending.
 */
function resolveRounding(
  f: ScheduleIiiFacts,
  resolve: RuleResolver,
): { threshold: number | null; units: string[]; ruleVersionId: string | null; note: string } {
  const rule = resolve(AREA, RULE_CRITERION.turnover);
  if (!rule || rule.threshold == null)
    return {
      threshold: null,
      units: [],
      ruleVersionId: null,
      note: 'Rounding band pending — no Schedule III rounding rule in the library for this period.',
    };
  if (f.turnover == null)
    return {
      threshold: rule.threshold,
      units: [],
      ruleVersionId: rule.ruleVersionId,
      note: `Rounding band pending — turnover not captured (band splits at ${formatInrCrore(rule.threshold)}).`,
    };
  const atOrAbove = ruleMeets(f.turnover, rule);
  return {
    threshold: rule.threshold,
    units: atOrAbove ? ROUNDING_UNITS_AT_OR_ABOVE : ROUNDING_UNITS_BELOW,
    ruleVersionId: rule.ruleVersionId,
    note: `Turnover ${formatInrCrore(f.turnover)} ${atOrAbove ? '≥' : '<'} ${formatInrCrore(rule.threshold)} — round to nearest ${(atOrAbove ? ROUNDING_UNITS_AT_OR_ABOVE : ROUNDING_UNITS_BELOW).join(' / ')}.`,
  };
}

/**
 * Test the §2(40) cash-flow exemption. A One Person Company, small company or
 * dormant company need not include a Cash Flow Statement; every other company
 * must. Consumes the 02.1 classifications — never re-asked here.
 */
function cashFlow(f: ScheduleIiiFacts): { required: boolean; reason: string | null } {
  const exemptors: string[] = [];
  if (f.isOpc) exemptors.push('One Person Company');
  if (f.isSmallCompany) exemptors.push('small company (§2(85))');
  if (f.isDormant) exemptors.push('dormant company');
  return exemptors.length > 0
    ? { required: false, reason: `Exempt under the §2(40) proviso — ${exemptors.join(', ')}.` }
    : { required: true, reason: null };
}

/** The FS components a Division requires, adding SoCE for Ind AS and cash-flow when not exempt. */
function components(indAs: boolean, cashFlowRequired: boolean): FsComponent[] {
  const out: FsComponent[] = [FS_COMPONENT.balanceSheet, FS_COMPONENT.statementOfProfitAndLoss];
  if (indAs) out.push(FS_COMPONENT.statementOfChangesInEquity);
  if (cashFlowRequired) out.push(FS_COMPONENT.cashFlowStatement);
  out.push(FS_COMPONENT.notes);
  return out;
}

/**
 * Assemble a Division conclusion (I / II / III). `indAs` drives the SoCE
 * component and the Ind AS disclosure baseline; `provisionCode` names the
 * Schedule III Division provision the service freezes period-correct.
 */
function division(
  f: ScheduleIiiFacts,
  resolve: RuleResolver,
  opts: {
    outcome: ScheduleIiiResult['outcome'];
    label: string;
    provisionCode: string;
    indAs: boolean;
    baseDisclosures: string[];
  },
): ScheduleIiiResult {
  const rounding = resolveRounding(f, resolve);
  const cf = cashFlow(f);
  const disclosures = [...opts.baseDisclosures];
  if (opts.indAs && f.firstTimeIndAs) disclosures.push(INDAS_101_DISCLOSURE);
  const basis =
    `${opts.label} applies — routed from the 02.2 reporting-framework conclusion. ` +
    `${cf.required ? 'Cash Flow Statement required.' : cf.reason} ${rounding.note}`;
  return result(
    opts.outcome,
    'system_suggested_applicable',
    basis,
    detail({
      division: opts.outcome,
      divisionProvisionCode: opts.provisionCode,
      cashFlowRequired: cf.required,
      cashFlowExemptionReason: cf.reason,
      requiredComponents: components(opts.indAs, cf.required),
      roundingThreshold: rounding.threshold,
      roundingUnits: rounding.units,
      disclosures,
    }),
    rounding.ruleVersionId,
  );
}

/**
 * The 02.3 decision sequence (guide §9.3). Order matters: 02.2 must be concluded
 * first; a bank/insurer/regulated entity routes to a specialised format before
 * any Division; otherwise the 02.2 conclusion selects the Division.
 */
export function assessScheduleIii(f: ScheduleIiiFacts, resolve: RuleResolver): ScheduleIiiResult {
  // 1. 02.2 must be concluded — 02.3 routes from it, never re-decides it.
  if (f.reportingFramework == null)
    return result(
      SCHEDULE_III_OUTCOME.informationInsufficient,
      'pending_information',
      'The 02.2 financial-reporting framework is not concluded — conclude it before routing Schedule III.',
      detail(),
    );

  // 2. Bank / insurer / regulated → a specialised statutory format (no Division forced).
  if (f.isBankOrInsurance || f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.specialised) {
    const cf = cashFlow(f);
    return result(
      SCHEDULE_III_OUTCOME.specialisedFormat,
      'professional_judgement_required',
      'A specialised statutory presentation format applies (bank / insurer / regulated entity) — Schedule III Divisions are not forced; use the regulator-prescribed format.',
      detail({
        cashFlowRequired: cf.required,
        cashFlowExemptionReason: cf.reason,
        requiredComponents: components(false, cf.required),
      }),
    );
  }

  // 3. Route the Division from the 02.2 conclusion.
  switch (f.reportingFramework) {
    case REPORTING_FRAMEWORK_OUTCOME.accountingStandards:
      return division(f, resolve, {
        outcome: SCHEDULE_III_OUTCOME.divisionI,
        label: 'Schedule III Division I (Accounting Standards)',
        provisionCode: 'SCH_III_DIV_I',
        indAs: false,
        baseDisclosures: DIVISION_I_DISCLOSURES,
      });
    case REPORTING_FRAMEWORK_OUTCOME.indAs:
      return f.isNbfc
        ? division(f, resolve, {
            outcome: SCHEDULE_III_OUTCOME.divisionIII,
            label: 'Schedule III Division III (Ind AS, NBFC)',
            provisionCode: 'SCH_III_DIV_III',
            indAs: true,
            baseDisclosures: IND_AS_DISCLOSURES,
          })
        : division(f, resolve, {
            outcome: SCHEDULE_III_OUTCOME.divisionII,
            label: 'Schedule III Division II (Ind AS)',
            provisionCode: 'SCH_III_DIV_II',
            indAs: true,
            baseDisclosures: IND_AS_DISCLOSURES,
          });
    default:
      // information_insufficient / professional_review carried through from 02.2.
      return result(
        SCHEDULE_III_OUTCOME.informationInsufficient,
        'pending_information',
        'The 02.2 conclusion is not a decisive framework (Ind AS / AS / specialised) — resolve 02.2 before routing Schedule III.',
        detail(),
      );
  }
}
