import {
  CONSOLIDATION_METHOD,
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  INVESTEE_RELATIONSHIP,
  REPORTING_FRAMEWORK_OUTCOME,
  RULE_CRITERION,
  ruleMeets,
  type ConsolidationDetail,
  type ConsolidationFacts,
  type ConsolidationResult,
  type FrameworkState,
  type InvesteeClassification,
  type InvesteeInput,
  type Rule6Assessment,
  type RuleResolver,
} from '@hsdg/contracts';

/**
 * 02.6 Consolidation / Group Audit Framework — pure engine (Guide §9.6).
 *
 * Classifies each investee (percentages are inputs / rebuttable presumptions,
 * never the whole test: a captured control judgment overrides the >50%
 * presumption — Ind AS 110 is principle-based — and significant influence is a
 * 20% presumption rebuttable both ways), then decides whether CFS is required
 * under §129(3), applying the Rule 6 exemption condition-by-condition (cumulative;
 * a missing parent-CFS-filing status leaves it pending). Frames SA 600 (other
 * auditors) and §143(8) (branches). No fixed materiality % here (guide §9.6).
 *
 * NO statutory number lives here (guide §1): the >50% / 20% presumptions resolve
 * from the Audit Rules Library through the injected {@link RuleResolver}.
 *
 * Mirrors caro.ts so it unit-tests without a database.
 */

const AREA = FRAMEWORK_AREA_KEY.cfs;
const MATERIALITY_NOTE =
  'No fixed materiality % is set here — the consolidation perimeter passes to Section 03.3 for materiality.';
const CROSS_LINK_NOTE =
  'This one group structure feeds CARO clause 3(xxi) (02.4) and consolidated ICFR (02.5) — no duplicate component entry.';

/**
 * Classify one investee. Control is the captured judgment when given (Ind AS 110
 * principle-based), else the >50% presumption; significant influence is the 20%
 * presumption, rebuttable both ways. The method follows the applicable framework.
 */
export function classifyInvestee(
  inv: InvesteeInput,
  indAs: boolean,
  resolve: RuleResolver,
): InvesteeClassification {
  const base = {
    name: inv.name,
    ownershipPercent: inv.ownershipPercent,
    auditedByOtherAuditor: inv.auditedByOtherAuditor,
  };

  // Joint arrangements route out first (Ind AS 111 / AS 27).
  if (inv.isJointArrangement) {
    if (inv.jointArrangementIsOperation)
      return {
        ...base,
        relationship: INVESTEE_RELATIONSHIP.jointOperation,
        method: CONSOLIDATION_METHOD.jointOperationLineByLine,
        basis: indAs
          ? 'Joint operation — Ind AS 111: recognise assets, liabilities, income and expenses line-by-line.'
          : 'Joint operation — account for the share of assets, liabilities, income and expenses.',
      };
    return {
      ...base,
      relationship: INVESTEE_RELATIONSHIP.jointVenture,
      method: indAs
        ? CONSOLIDATION_METHOD.equityMethod
        : CONSOLIDATION_METHOD.proportionateConsolidation,
      basis: indAs
        ? 'Joint venture — Ind AS 111: equity method (Ind AS 28).'
        : 'Joint venture — AS 27: proportionate consolidation.',
    };
  }

  // Subsidiary — control. Captured judgment overrides the ownership presumption.
  const controlRule = resolve(AREA, RULE_CRITERION.controlOwnership);
  const presumedControl =
    inv.ownershipPercent != null &&
    controlRule != null &&
    ruleMeets(inv.ownershipPercent, controlRule);
  const hasControl = inv.hasControl !== null ? inv.hasControl : presumedControl;
  if (hasControl) {
    const via =
      inv.hasControl !== null
        ? `professional control judgment (${indAs ? 'Ind AS 110 — principle-based control' : 'AS 21 — control of the board or > 50% voting power'})`
        : `the > ${fmt(controlRule?.threshold)}% ownership presumption (${indAs ? 'Ind AS 110' : 'AS 21'})`;
    return {
      ...base,
      relationship: INVESTEE_RELATIONSHIP.subsidiary,
      method: CONSOLIDATION_METHOD.fullConsolidation,
      basis: `Subsidiary — control established via ${via}; full consolidation.`,
    };
  }

  // Associate — significant influence (20% presumption, rebuttable both ways).
  const siRule = resolve(AREA, RULE_CRITERION.significantInfluenceOwnership);
  const presumedSi =
    inv.ownershipPercent != null && siRule != null && ruleMeets(inv.ownershipPercent, siRule);
  const hasSi =
    inv.significantInfluenceRebutted === true
      ? false
      : inv.significantInfluenceRebutted === false
        ? true
        : presumedSi;
  if (hasSi) {
    const via =
      inv.significantInfluenceRebutted === false
        ? 'significant influence established despite ownership below the presumption'
        : inv.significantInfluenceRebutted === true
          ? 'presumption rebutted but significant influence retained' // unreachable; kept for clarity
          : `the >= ${fmt(siRule?.threshold)}% presumption`;
    return {
      ...base,
      relationship: INVESTEE_RELATIONSHIP.associate,
      method: CONSOLIDATION_METHOD.equityMethod,
      basis: `Associate — significant influence via ${via} (${indAs ? 'Ind AS 28' : 'AS 23'}); equity method.`,
    };
  }

  return {
    ...base,
    relationship: INVESTEE_RELATIONSHIP.none,
    method: CONSOLIDATION_METHOD.none,
    basis:
      'Neither control, significant influence nor a joint arrangement — outside the consolidation perimeter.',
  };
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : String(n);
}

function detail(overrides: Partial<ConsolidationDetail>): ConsolidationDetail {
  return {
    cfsTriggered: false,
    rule6: null,
    perimeter: [],
    usesOtherAuditors: false,
    saFramework: null,
    hasBranches: false,
    materialityNote: MATERIALITY_NOTE,
    crossLinkNote: CROSS_LINK_NOTE,
    ...overrides,
  };
}

function result(
  outcome: ConsolidationResult['outcome'],
  state: FrameworkState,
  basis: string,
  d: ConsolidationDetail,
): ConsolidationResult {
  return { outcome, state, basis, ruleVersionId: null, authorityProvisionId: null, detail: d };
}

/**
 * The 02.6 decision sequence (guide §9.6): classify the perimeter, test the
 * §129(3) trigger, then the cumulative Rule 6 exemption condition-by-condition.
 */
export function assessConsolidation(
  f: ConsolidationFacts,
  resolve: RuleResolver,
): ConsolidationResult {
  if (f.reportingFramework == null)
    return result(
      CONSOLIDATION_OUTCOME.informationInsufficient,
      'pending_information',
      'The 02.2 reporting framework is not concluded — conclude it before selecting the consolidation standards.',
      detail({}),
    );

  const indAs = f.reportingFramework === REPORTING_FRAMEWORK_OUTCOME.indAs;
  const perimeter = f.investees.map((inv) => classifyInvestee(inv, indAs, resolve));
  const inPerimeter = perimeter.filter((p) => p.relationship !== INVESTEE_RELATIONSHIP.none);
  const usesOtherAuditors = f.investees.some((i) => i.auditedByOtherAuditor);
  const common = {
    perimeter,
    usesOtherAuditors,
    saFramework: usesOtherAuditors ? ('SA 600' as const) : null,
    hasBranches: f.hasBranches,
  };

  // §129(3): no subsidiary/associate/JV → CFS not required.
  if (inPerimeter.length === 0)
    return result(
      CONSOLIDATION_OUTCOME.notApplicable,
      'system_suggested_not_applicable',
      'No subsidiary, associate or joint venture in the perimeter — §129(3) does not require CFS.',
      detail({ ...common, cfsTriggered: false }),
    );

  // §129(3) triggers. Test the Rule 6 exemption condition-by-condition.
  const isSubsidiary = f.isWhollyOwnedSubsidiary || f.isPartiallyOwnedSubsidiary;
  if (!isSubsidiary) {
    const rule6: Rule6Assessment = {
      applies: false,
      ownershipCondition: false,
      notListedCondition: !f.securitiesListedOrInProcess,
      parentFilesCfsCondition: f.parentFilesCompliantCfs,
      basis: 'Not a subsidiary of another company — the Rule 6 CFS exemption is unavailable.',
    };
    return result(
      CONSOLIDATION_OUTCOME.cfsRequired,
      'system_suggested_applicable',
      `CFS required under §129(3) (${inPerimeter.length} investee(s) in the perimeter). Rule 6 exemption unavailable — the entity is not a subsidiary.`,
      detail({ ...common, cfsTriggered: true, rule6 }),
    );
  }

  const ownershipCondition =
    f.isWhollyOwnedSubsidiary ||
    (f.isPartiallyOwnedSubsidiary && f.otherMembersIntimatedNoObjection);
  const notListedCondition = !f.securitiesListedOrInProcess;

  // A failed hard condition → not exempt → CFS required.
  if (!ownershipCondition || !notListedCondition) {
    const why = !notListedCondition
      ? 'its securities are listed or in the process of listing'
      : 'a partially-owned subsidiary has not intimated all other members in writing with no objection';
    const rule6: Rule6Assessment = {
      applies: false,
      ownershipCondition,
      notListedCondition,
      parentFilesCfsCondition: f.parentFilesCompliantCfs,
      basis: `Rule 6 exemption fails — ${why}.`,
    };
    return result(
      CONSOLIDATION_OUTCOME.cfsRequired,
      'system_suggested_applicable',
      `CFS required under §129(3) — the Rule 6 exemption fails (${why}).`,
      detail({ ...common, cfsTriggered: true, rule6 }),
    );
  }

  // The parent-CFS-filing condition — unknown leaves the exemption pending.
  if (f.parentFilesCompliantCfs == null) {
    const rule6: Rule6Assessment = {
      applies: null,
      ownershipCondition,
      notListedCondition,
      parentFilesCfsCondition: null,
      basis:
        'Rule 6 exemption pending — whether an intermediate/ultimate parent files Companies-Act-compliant CFS with the Registrar is not yet confirmed.',
    };
    return result(
      CONSOLIDATION_OUTCOME.informationInsufficient,
      'pending_information',
      'Rule 6 exemption cannot be confirmed — the parent-CFS-filing status is unknown.',
      detail({ ...common, cfsTriggered: true, rule6 }),
    );
  }

  if (f.parentFilesCompliantCfs === false) {
    const rule6: Rule6Assessment = {
      applies: false,
      ownershipCondition,
      notListedCondition,
      parentFilesCfsCondition: false,
      basis:
        'Rule 6 exemption fails — no parent files Companies-Act-compliant CFS with the Registrar.',
    };
    return result(
      CONSOLIDATION_OUTCOME.cfsRequired,
      'system_suggested_applicable',
      'CFS required under §129(3) — the Rule 6 exemption fails: no compliant parent CFS filing.',
      detail({ ...common, cfsTriggered: true, rule6 }),
    );
  }

  // All cumulative conditions hold → exempt.
  const rule6: Rule6Assessment = {
    applies: true,
    ownershipCondition: true,
    notListedCondition: true,
    parentFilesCfsCondition: true,
    basis:
      'Rule 6 exemption holds — a subsidiary (wholly-owned, or partially-owned with all members intimated and no objection), not listed / in process, and a parent files compliant CFS.',
  };
  return result(
    CONSOLIDATION_OUTCOME.cfsExempt,
    'system_suggested_not_applicable',
    'CFS is not required — all cumulative Rule 6 exemption conditions are met.',
    detail({ ...common, cfsTriggered: true, rule6 }),
  );
}
