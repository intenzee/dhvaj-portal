import {
  CARO_OUTCOME,
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  formatInrCrore,
  ruleMeets,
  type CaroDetail,
  type CaroFacts,
  type CaroPrivateTest,
  type CaroResult,
  type FrameworkState,
  type ResolvedRule,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.4 CARO 2020 Applicability — pure engine (Implementation Guide §9.4).
 *
 * Decides Level 1 (does CARO apply to the report): direct exemptions first
 * (banking / insurance / §8 / OPC / small company — consumed from 02.1, never
 * recomputed), then the cumulative private-company test (not a holding/subsidiary
 * of a public company AND capital+reserves, aggregate bank/FI borrowings peak,
 * and total revenue each within the CARO limits). Any one condition failing → CARO
 * may apply. A public company that is not otherwise exempt → CARO applies.
 *
 * NO statutory number lives here (guide §1): the ₹1cr / ₹1cr / ₹10cr limits
 * resolve from the Audit Rules Library through the injected {@link RuleResolver}
 * and the basis names the ACTUAL limits + measurement bases. CARO 2020 is
 * effective FY 2021-22 onward, so a period with no resolved rule returns Further
 * Assessment (assess CARO 2016 separately) — it never guesses.
 *
 * Mirrors financial-reporting.ts so it unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.caro;

function detail(overrides: Partial<CaroDetail> = {}): CaroDetail {
  return {
    level1Applies: false,
    exemptionReason: null,
    privateTest: null,
    instantiatesClauseProgramme: false,
    caroScope: null,
    ...overrides,
  };
}

function result(
  outcome: CaroResult['outcome'],
  state: FrameworkState,
  basis: string,
  d: CaroDetail,
  ruleVersionId: string | null = null,
): CaroResult {
  return { outcome, state, basis, ruleVersionId, authorityProvisionId: null, detail: d };
}

/** Exempt (direct or cumulative): CARO does not apply to the report. */
function exempt(reason: string, privateTest: CaroPrivateTest | null = null): CaroResult {
  return result(
    CARO_OUTCOME.notApplicableExempt,
    'system_suggested_not_applicable',
    reason,
    detail({ level1Applies: false, exemptionReason: reason, privateTest }),
  );
}

/** CARO applies: Level 1 true, instantiate the standalone paragraph-3 programme. */
function applies(
  basis: string,
  ruleVersionId: string | null = null,
  privateTest: CaroPrivateTest | null = null,
): CaroResult {
  return result(
    CARO_OUTCOME.applicable,
    'system_suggested_applicable',
    basis,
    detail({
      level1Applies: true,
      instantiatesClauseProgramme: true,
      caroScope: 'standalone_paragraph_3',
      privateTest,
    }),
    ruleVersionId,
  );
}

/**
 * The 02.4 decision sequence (guide §9.4). Order matters: period effectiveness
 * gates first; then direct exemptions (no threshold test); then the cumulative
 * private-company test; a public company that is not otherwise exempt → applies.
 */
export function assessCaro(f: CaroFacts, resolve: RuleResolver): CaroResult {
  const capRule = resolve(AREA, RULE_CRITERION.capitalAndReserves);
  const borRule = resolve(AREA, RULE_CRITERION.borrowings);
  const revRule = resolve(AREA, RULE_CRITERION.revenue);

  // 1. CARO 2020 effective FY 2021-22+ — no rule for the period ⇒ Further Assessment.
  if (!capRule || !borRule || !revRule)
    return result(
      CARO_OUTCOME.furtherAssessment,
      'professional_judgement_required',
      'CARO 2020 applies for financial years commencing on or after 01-Apr-2021; this audit period predates it — assess CARO 2016 separately.',
      detail(),
    );

  // 2. Must be a company.
  if (f.isCompany === false)
    return exempt('CARO applies only to companies under the Companies Act — not applicable here.');
  if (f.isCompany == null)
    return result(
      CARO_OUTCOME.informationInsufficient,
      'pending_information',
      'Entity type not confirmed — confirm 02.1 before assessing CARO applicability.',
      detail(),
    );

  // 3. Direct exemptions — no threshold test (guide §9.4).
  if (f.isBanking) return exempt('Banking company — directly exempt from CARO 2020.');
  if (f.isInsurance) return exempt('Insurance company — directly exempt from CARO 2020.');
  if (f.isSection8)
    return exempt('Section 8 (not-for-profit) company — directly exempt from CARO 2020.');
  if (f.isOpc) return exempt('One Person Company — directly exempt from CARO 2020.');
  if (f.isSmallCompany)
    return exempt(
      'Small company (§2(85), per the confirmed 02.1 assessment) — directly exempt from CARO 2020.',
    );

  // 4. A public company that is not otherwise exempt → CARO applies.
  if (f.isPrivateCompany === false)
    return applies('Public company, not otherwise exempt — CARO 2020 applies to the report.');
  if (f.isPrivateCompany == null)
    return result(
      CARO_OUTCOME.informationInsufficient,
      'pending_information',
      'Private/public status not confirmed — needed for the CARO private-company exemption test.',
      detail(),
    );

  // 5. Cumulative private-company exemption test (all conditions must hold).
  if (f.isHoldingOrSubsidiaryOfPublic)
    return applies(
      'Private company that is a holding/subsidiary of a public company — the private-company exemption is unavailable, so CARO 2020 applies.',
      null,
      {
        tested: true,
        noPublicGroupRelationship: false,
        capitalWithinLimit: null,
        borrowingsWithinLimit: null,
        revenueWithinLimit: null,
      },
    );

  // The exemption needs ALL three within limit, so one captured figure over its
  // limit already defeats it — the missing figures are moot.
  const over = (
    [
      ['capital + reserves', f.capitalPlusReserves, capRule],
      ['aggregate bank/FI borrowings (peak in the year)', f.peakBankFiBorrowings, borRule],
      ['total revenue', f.totalRevenue, revRule],
    ] as const
  ).find(([, value, rule]) => value != null && !ruleMeets(value, rule));
  const anyMissing =
    f.capitalPlusReserves == null || f.peakBankFiBorrowings == null || f.totalRevenue == null;
  if (over && anyMissing) {
    const [label, value, rule] = over;
    const within = (v: number | null, r: ResolvedRule) => (v == null ? null : ruleMeets(v, r));
    return applies(
      `Private company exceeds a CARO 2020 exemption limit (${label} ${formatInrCrore(value!)} ${rule.operator} ${formatInrCrore(rule.threshold!)} fails) — the cumulative exemption is unavailable, so CARO 2020 applies.`,
      rule.ruleVersionId,
      {
        tested: true,
        noPublicGroupRelationship: true,
        capitalWithinLimit: within(f.capitalPlusReserves, capRule),
        borrowingsWithinLimit: within(f.peakBankFiBorrowings, borRule),
        revenueWithinLimit: within(f.totalRevenue, revRule),
      },
    );
  }

  const missing: string[] = [];
  if (f.capitalPlusReserves == null) missing.push('paid-up capital + reserves');
  if (f.peakBankFiBorrowings == null)
    missing.push('aggregate bank/FI borrowings (peak in the year)');
  if (f.totalRevenue == null) missing.push('total revenue');
  if (missing.length > 0)
    return result(
      CARO_OUTCOME.informationInsufficient,
      'pending_information',
      `Not captured — needed for the CARO private-company exemption test: ${missing.join(', ')}.`,
      detail({
        privateTest: {
          tested: false,
          noPublicGroupRelationship: true,
          capitalWithinLimit: null,
          borrowingsWithinLimit: null,
          revenueWithinLimit: null,
        },
      }),
    );

  const capWithin = ruleMeets(f.capitalPlusReserves!, capRule);
  const borWithin = ruleMeets(f.peakBankFiBorrowings!, borRule);
  const revWithin = ruleMeets(f.totalRevenue!, revRule);
  const privateTest: CaroPrivateTest = {
    tested: true,
    noPublicGroupRelationship: true,
    capitalWithinLimit: capWithin,
    borrowingsWithinLimit: borWithin,
    revenueWithinLimit: revWithin,
  };
  const limits =
    `capital+reserves ${formatInrCrore(f.capitalPlusReserves!)} ${capRule.operator} ${formatInrCrore(capRule.threshold!)}, ` +
    `bank/FI borrowings (peak) ${formatInrCrore(f.peakBankFiBorrowings!)} ${borRule.operator} ${formatInrCrore(borRule.threshold!)}, ` +
    `revenue ${formatInrCrore(f.totalRevenue!)} ${revRule.operator} ${formatInrCrore(revRule.threshold!)}`;

  if (capWithin && borWithin && revWithin)
    return exempt(
      `Private company within all CARO 2020 exemption limits (${limits}) and not a holding/subsidiary of a public company — CARO does not apply.`,
      privateTest,
    );

  const exceeded = [
    !capWithin ? 'capital + reserves' : null,
    !borWithin ? 'aggregate bank/FI borrowings (peak in the year)' : null,
    !revWithin ? 'total revenue' : null,
  ].filter(Boolean);
  return applies(
    `Private company exceeds a CARO 2020 exemption limit (${exceeded.join(', ')}) — the cumulative exemption fails, so CARO applies (${limits}).`,
    // Freeze the version of whichever limit was breached first (traceable).
    (!capWithin ? capRule : !borWithin ? borRule : revRule).ruleVersionId,
    privateTest,
  );
}

/** The CARO threshold rule whose version the service cites when applicable via the public branch. */
export function caroReferenceRule(resolve: RuleResolver): ResolvedRule | null {
  return resolve(AREA, RULE_CRITERION.revenue);
}
