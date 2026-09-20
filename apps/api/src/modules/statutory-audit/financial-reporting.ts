import {
  FRAMEWORK_AREA_KEY,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  SMC_STATUS,
  formatInrCrore,
  ruleMeets,
  type FinancialReportingFacts,
  type FinancialReportingResult,
  type FrameworkState,
  type ResolvedRule,
  type RuleResolver,
  type SmcStatus,
} from '@hsdg/contracts';

/**
 * 02.2 Financial Reporting Framework — pure engine (Implementation Guide §9.2).
 *
 * Runs the Rule-4 roadmap sequence (02.2D) over the confirmed 02.1 facts to
 * conclude Ind AS / Accounting Standards / a specialised framework. NO statutory
 * number lives here (guide §1): the ₹500cr/₹250cr net-worth roadmap (phased by
 * audit period through effective-dated rule VERSIONS) and the SMC ceilings
 * resolve from the Audit Rules Library through the injected {@link RuleResolver},
 * and the basis names the ACTUAL limit + cited provision. Where a deciding fact
 * is absent it returns `information_insufficient` (state `pending_information`);
 * where the library holds no rule for the period it returns
 * `information_insufficient` — it never guesses.
 *
 * Mirrors framework-suggestions.ts so it unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;

function result(
  outcome: FinancialReportingResult['outcome'],
  state: FrameworkState,
  basis: string,
  opts: {
    rule?: ResolvedRule | null;
    smcStatus?: SmcStatus;
    firstTimeIndAs?: boolean;
    indAsThreshold?: number | null;
    isNbfc?: boolean;
  } = {},
): FinancialReportingResult {
  return {
    outcome,
    state,
    basis,
    ruleVersionId: opts.rule?.ruleVersionId ?? null,
    authorityProvisionId: opts.rule?.authorityProvisionId ?? null,
    detail: {
      smcStatus: opts.smcStatus ?? SMC_STATUS.notApplicable,
      firstTimeIndAs: opts.firstTimeIndAs ?? false,
      indAsThreshold: opts.indAsThreshold ?? null,
      isNbfc: opts.isNbfc ?? false,
    },
  };
}

/**
 * Compute the SMC (Small & Medium Company) sub-status when Accounting Standards
 * apply. A company is NON-SMC if it is listed, or exceeds the turnover or the
 * borrowings ceiling; otherwise SMC. Ceilings resolve from the Rules Library.
 */
function computeSmc(
  f: FinancialReportingFacts,
  resolve: RuleResolver,
): {
  status: SmcStatus;
  basis: string;
} {
  if (f.isListed && !f.isListedOnSmeExchange)
    return { status: SMC_STATUS.nonSmc, basis: 'Listed company — non-SMC.' };
  if (f.turnover == null || f.borrowings == null)
    return {
      status: SMC_STATUS.notApplicable,
      basis: 'SMC sub-status pending — turnover / borrowings not captured.',
    };
  const turnRule = resolve(AREA, RULE_CRITERION.turnover);
  const borrowRule = resolve(AREA, RULE_CRITERION.borrowings);
  if (!turnRule || turnRule.threshold == null || !borrowRule || borrowRule.threshold == null)
    return {
      status: SMC_STATUS.notApplicable,
      basis: 'SMC ceilings not found in the Audit Rules Library for this audit period.',
    };
  const withinTurn = ruleMeets(f.turnover, turnRule);
  const withinBorrow = ruleMeets(f.borrowings, borrowRule);
  return withinTurn && withinBorrow
    ? {
        status: SMC_STATUS.smc,
        basis: `SMC — turnover ${formatInrCrore(f.turnover)} ${turnRule.operator} ${formatInrCrore(turnRule.threshold)} and borrowings ${formatInrCrore(f.borrowings)} ${borrowRule.operator} ${formatInrCrore(borrowRule.threshold)}.`,
      }
    : {
        status: SMC_STATUS.nonSmc,
        basis: `Non-SMC — exceeds the turnover (${formatInrCrore(turnRule.threshold)}) or borrowings (${formatInrCrore(borrowRule.threshold)}) ceiling.`,
      };
}

/**
 * The 02.2D decision sequence (guide §9.2). Order matters: specialised entities
 * route out first; a continuing/voluntary/group Ind AS status wins over a low
 * current-year net worth; otherwise the period-resolved roadmap threshold decides
 * Ind AS vs Accounting Standards (with SMC sub-status).
 */
export function assessFinancialReporting(
  f: FinancialReportingFacts,
  resolve: RuleResolver,
): FinancialReportingResult {
  if (f.isCompany === false)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.professionalReview,
      'professional_judgement_required',
      'Not a company under the Companies Act — determine the applicable framework professionally (e.g. AS for an LLP).',
    );
  if (f.isCompany == null)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      'pending_information',
      'Entity type not confirmed — confirm 02.1 before assessing the reporting framework.',
    );

  // 1. Bank / insurance / regulated → specialised statutory framework (do not
  //    force the ordinary roadmap).
  if (f.isBankOrInsurance)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.specialised,
      'professional_judgement_required',
      'Bank / insurance entity — a specialised statutory reporting framework applies; do not force the ordinary Ind AS/AS roadmap.',
    );

  // 2. Continuing Ind AS wins over a low current-year net worth (irrevocable).
  if (f.priorIndAs)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.indAs,
      'system_suggested_applicable',
      'Ind AS applied in a prior year — continuing Ind AS status is irrevocable and applies regardless of the current net worth.',
      { firstTimeIndAs: false, isNbfc: f.isNbfc },
    );

  // 3. Voluntary adoption → Ind AS (first-time if not a prior adopter).
  if (f.voluntaryIndAs)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.indAs,
      'system_suggested_applicable',
      'Ind AS voluntarily adopted — Ind AS applies (irrevocable once adopted).',
      { firstTimeIndAs: true, isNbfc: f.isNbfc },
    );

  // 4. Group trigger → an entity whose holding/subsidiary applies Ind AS follows it.
  if (f.groupTriggersIndAs)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.indAs,
      'system_suggested_applicable',
      'A group company (holding/subsidiary/associate/JV) applies Ind AS — the entity follows Ind AS under Rule 4.',
      { firstTimeIndAs: true, isNbfc: f.isNbfc },
    );

  // 5. Mandatory net-worth roadmap, phased by audit period. An SME-exchange
  //    listing does NOT trigger the roadmap, so it falls through to the
  //    net-worth test exactly like an unlisted company (the SME proviso).
  if (f.netWorth == null)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      'pending_information',
      'Net worth not captured — needed to test the Ind AS net-worth roadmap.',
      { isNbfc: f.isNbfc },
    );
  const nwRule = resolve(AREA, RULE_CRITERION.netWorth, f.isNbfc ? 'nbfc' : null);
  if (!nwRule || nwRule.threshold == null)
    return result(
      REPORTING_FRAMEWORK_OUTCOME.informationInsufficient,
      'professional_judgement_required',
      'Ind AS net-worth roadmap threshold not found in the Audit Rules Library for this audit period — Information Insufficient.',
      { isNbfc: f.isNbfc },
    );

  const phase = `${f.isNbfc ? 'NBFC ' : ''}net worth ${formatInrCrore(f.netWorth)} ${nwRule.operator} ${formatInrCrore(nwRule.threshold)}; rule ${nwRule.ruleCode} effective ${nwRule.effectiveFrom}`;
  if (ruleMeets(f.netWorth, nwRule))
    return result(
      REPORTING_FRAMEWORK_OUTCOME.indAs,
      'system_suggested_applicable',
      `Ind AS applies via the Rule-4 roadmap (${phase}).`,
      { rule: nwRule, firstTimeIndAs: true, indAsThreshold: nwRule.threshold, isNbfc: f.isNbfc },
    );

  // 6. Below the roadmap threshold and unlisted (or SME-exchange only) → AS; then
  //    compute the SMC sub-status.
  const smc = computeSmc(f, resolve);
  return result(
    REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
    'system_suggested_applicable',
    `Accounting Standards apply — below the Ind AS roadmap threshold (${phase}). ${smc.basis}`,
    { rule: nwRule, smcStatus: smc.status, indAsThreshold: nwRule.threshold, isNbfc: f.isNbfc },
  );
}
