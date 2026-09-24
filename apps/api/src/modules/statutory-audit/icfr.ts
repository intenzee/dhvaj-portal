import {
  FRAMEWORK_AREA_KEY,
  ICFR_OUTCOME,
  RULE_CRITERION,
  formatInrCrore,
  ruleMeets,
  type FrameworkState,
  type IcfrDetail,
  type IcfrFacts,
  type IcfrMonetaryTest,
  type IcfrResult,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.5 Internal Financial Controls / ICFR Reporting — pure engine (Guide §9.5).
 *
 * Decides Section 143(3)(i) reporting: a non-private company always reports; a
 * private company is exempt only when it is an OPC or small company (consumed
 * from 02.1), or both its turnover < ₹50cr AND its peak aggregate covered
 * borrowings < ₹25cr — AND it has not defaulted in filing under §92/§137. A
 * filing default blocks the exemption even if the monetary conditions pass.
 *
 * NO statutory number lives here (guide §1): the ₹50cr / ₹25cr limits (strict
 * `<`) resolve from the Audit Rules Library through the injected {@link RuleResolver}
 * and the basis names the ACTUAL limits. When the exemption framework is not in
 * force for the period a private company returns Further Assessment — it never
 * guesses. An exemption never disables the Controls phase (detail flag).
 *
 * Mirrors caro.ts so it unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.ifc;

function detail(overrides: Partial<IcfrDetail> = {}): IcfrDetail {
  return {
    reportingApplies: false,
    exemptionReason: null,
    monetaryTest: null,
    filingDefaultBlocks: false,
    configuresIcfrWorkstream: false,
    controlsPhaseUnaffected: true,
    rule11gSeparate: true,
    ...overrides,
  };
}

function result(
  outcome: IcfrResult['outcome'],
  state: FrameworkState,
  basis: string,
  d: IcfrDetail,
  ruleVersionId: string | null = null,
): IcfrResult {
  return { outcome, state, basis, ruleVersionId, authorityProvisionId: null, detail: d };
}

/** ICFR reporting applies: configure the ICFR workstream in the Controls phase. */
function applies(
  basis: string,
  opts: {
    ruleVersionId?: string | null;
    monetaryTest?: IcfrMonetaryTest | null;
    filingDefaultBlocks?: boolean;
  } = {},
): IcfrResult {
  return result(
    ICFR_OUTCOME.applicable,
    'system_suggested_applicable',
    basis,
    detail({
      reportingApplies: true,
      configuresIcfrWorkstream: true,
      monetaryTest: opts.monetaryTest ?? null,
      filingDefaultBlocks: opts.filingDefaultBlocks ?? false,
    }),
    opts.ruleVersionId ?? null,
  );
}

/** ICFR reporting is exempt — but the Controls phase stays active (guide §9.5). */
function exempt(reason: string, monetaryTest: IcfrMonetaryTest | null = null): IcfrResult {
  return result(
    ICFR_OUTCOME.exempt,
    'system_suggested_not_applicable',
    `${reason} (An ICFR reporting exemption does not disable the Controls phase — ordinary SA control work continues.)`,
    detail({ reportingApplies: false, exemptionReason: reason, monetaryTest }),
  );
}

/**
 * The 02.5 decision sequence (guide §9.5). Order matters: a non-private company
 * always reports; then the private-company exemption is tested, with the filing
 * default gating the whole exemption before the OPC/small/monetary paths.
 */
export function assessIcfr(f: IcfrFacts, resolve: RuleResolver): IcfrResult {
  // 1. Must be a company.
  if (f.isCompany === false)
    return exempt(
      'Not a company under the Companies Act — §143(3)(i) ICFR reporting does not apply.',
    );
  if (f.isCompany == null)
    return result(
      ICFR_OUTCOME.informationInsufficient,
      'pending_information',
      'Entity type not confirmed — confirm 02.1 before assessing ICFR reporting.',
      detail(),
    );

  // 2. A non-private (public) company always reports under §143(3)(i).
  if (f.isPrivateCompany === false)
    return applies('Public company — §143(3)(i) ICFR reporting always applies.');
  if (f.isPrivateCompany == null)
    return result(
      ICFR_OUTCOME.informationInsufficient,
      'pending_information',
      'Private/public status not confirmed — needed for the ICFR private-company exemption test.',
      detail(),
    );

  // 3. Private company — the MCA exemption. Resolve the period's limits first.
  const turnRule = resolve(AREA, RULE_CRITERION.turnover);
  const borRule = resolve(AREA, RULE_CRITERION.borrowings);
  if (!turnRule || !borRule)
    return result(
      ICFR_OUTCOME.furtherAssessment,
      'professional_judgement_required',
      'The §143(3)(i) private-company ICFR-reporting exemption is not in force for this audit period — assess ICFR reporting manually.',
      detail(),
    );

  // 4. A §92/§137 filing default blocks the exemption entirely (even if money passes).
  if (f.filingDefault)
    return applies(
      'A default in filing financial statements (§137) or the annual return (§92) removes the private-company ICFR exemption — §143(3)(i) reporting applies.',
      { filingDefaultBlocks: true },
    );

  // 5. Direct private-company exemptions.
  if (f.isOpc) return exempt('One Person Company — exempt from §143(3)(i) ICFR reporting.');
  if (f.isSmallCompany)
    return exempt(
      'Small company (§2(85), per the confirmed 02.1 assessment) — exempt from §143(3)(i) ICFR reporting.',
    );

  // 6. The cumulative monetary test — BOTH conditions required, so one captured
  //    figure at/over its limit already defeats the exemption (the other is moot).
  const turnoverOver = f.turnover != null && !ruleMeets(f.turnover, turnRule);
  const borrowingsOver =
    f.peakCoveredBorrowings != null && !ruleMeets(f.peakCoveredBorrowings, borRule);
  if ((turnoverOver || borrowingsOver) && (f.turnover == null || f.peakCoveredBorrowings == null)) {
    const [label, value, rule] = turnoverOver
      ? (['turnover', f.turnover!, turnRule] as const)
      : (['peak aggregate covered borrowings', f.peakCoveredBorrowings!, borRule] as const);
    return applies(
      `Private company meets or exceeds a §143(3)(i) exemption limit (${label} ${formatInrCrore(value)} ${rule.operator} ${formatInrCrore(rule.threshold!)} fails) — ICFR reporting applies whatever the other figure is.`,
      {
        ruleVersionId: rule.ruleVersionId,
        monetaryTest: {
          tested: true,
          turnoverWithinLimit: f.turnover == null ? null : !turnoverOver,
          borrowingsWithinLimit: f.peakCoveredBorrowings == null ? null : !borrowingsOver,
        },
      },
    );
  }
  if (f.turnover == null || f.peakCoveredBorrowings == null) {
    const missing = [
      f.turnover == null ? 'turnover' : null,
      f.peakCoveredBorrowings == null ? 'peak aggregate covered borrowings' : null,
    ].filter(Boolean);
    return result(
      ICFR_OUTCOME.informationInsufficient,
      'pending_information',
      `Not captured — needed for the ICFR private-company exemption test: ${missing.join(', ')}.`,
      detail({
        monetaryTest: { tested: false, turnoverWithinLimit: null, borrowingsWithinLimit: null },
      }),
    );
  }

  const turnoverWithin = ruleMeets(f.turnover, turnRule);
  const borrowingsWithin = ruleMeets(f.peakCoveredBorrowings, borRule);
  const monetaryTest: IcfrMonetaryTest = {
    tested: true,
    turnoverWithinLimit: turnoverWithin,
    borrowingsWithinLimit: borrowingsWithin,
  };
  const limits =
    `turnover ${formatInrCrore(f.turnover)} ${turnRule.operator} ${formatInrCrore(turnRule.threshold!)} and ` +
    `peak covered borrowings ${formatInrCrore(f.peakCoveredBorrowings)} ${borRule.operator} ${formatInrCrore(borRule.threshold!)}`;

  if (turnoverWithin && borrowingsWithin)
    return exempt(
      `Private company within both §143(3)(i) exemption limits (${limits}) with no filing default — exempt from ICFR reporting`,
      monetaryTest,
    );

  const exceeded = [
    !turnoverWithin ? 'turnover' : null,
    !borrowingsWithin ? 'peak aggregate covered borrowings' : null,
  ].filter(Boolean);
  return applies(
    `Private company meets or exceeds a §143(3)(i) exemption limit (${exceeded.join(', ')}) — ICFR reporting applies (${limits}).`,
    { ruleVersionId: (!turnoverWithin ? turnRule : borRule).ruleVersionId, monetaryTest },
  );
}
