import {
  ACCOUNTING_ENVIRONMENT,
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  SA_TRIGGER_CODE,
  SERVICE_ORGANISATION_ENVIRONMENTS,
  SMALL_COMPANY_OUTCOME,
  SPECIAL_ENTITY_TYPE,
  formatInrCrore,
  ruleMeets,
  type AccountingEnvironment,
  type ResolvedRule,
  type RuleResolver,
  type SaTrigger,
  type SmallCompanyAssessment,
  type SpecialEntityType,
} from '@hsdg/contracts';

/**
 * 02.1 Entity & Regulatory Profile — pure engine (Implementation Guide §9.1, §7).
 *
 * Two deterministic, DB-free computations the profile owns:
 *   • The Small Company assessment (§2(85)) — COMPUTED, never a checkbox: it reads
 *     facts, resolves the paid-up-capital and turnover ceilings from the Audit
 *     Rules Library through the injected {@link RuleResolver}, and renders the
 *     ACTUAL limits + cited provision in its basis. NO statutory number lives
 *     here (guide §1). Where a deciding fact is absent it returns `pending`;
 *     where the library holds no rule for the period it returns `pending` with an
 *     "Information Insufficient" basis — it never guesses.
 *   • The SA 510 / 402 / 299 triggers carried forward to 02.8 and Planning.
 *
 * Mirrors framework-suggestions.ts so it unit-tests without a database.
 */

/** Special-entity types that exclude a company from the §2(85) definition. */
const SMALL_COMPANY_EXCLUDING: readonly SpecialEntityType[] = [
  SPECIAL_ENTITY_TYPE.bank,
  SPECIAL_ENTITY_TYPE.insurance,
  SPECIAL_ENTITY_TYPE.nbfc,
  SPECIAL_ENTITY_TYPE.hfc,
  SPECIAL_ENTITY_TYPE.section_8,
  SPECIAL_ENTITY_TYPE.nidhi,
  SPECIAL_ENTITY_TYPE.other_regulator,
];

/** Normalised facts the small-company engine reads (unknowns are null). */
export interface SmallCompanyFacts {
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  /** A holding or subsidiary company — excluded from §2(85) by the proviso. */
  isHoldingOrSubsidiary: boolean | null;
  /** Special-entity types captured on the profile (excluders gate the result). */
  specialEntityTypes: readonly SpecialEntityType[];
  paidUpCapital: number | null;
  turnover: number | null;
}

function small(basis: string, capRule: ResolvedRule): SmallCompanyAssessment {
  return {
    outcome: SMALL_COMPANY_OUTCOME.small,
    basis,
    ruleVersionId: capRule.ruleVersionId,
    authorityProvisionId: capRule.authorityProvisionId,
  };
}
function notSmall(basis: string, capRule?: ResolvedRule): SmallCompanyAssessment {
  return {
    outcome: SMALL_COMPANY_OUTCOME.notSmall,
    basis,
    ruleVersionId: capRule?.ruleVersionId ?? null,
    authorityProvisionId: capRule?.authorityProvisionId ?? null,
  };
}
function notApplicable(basis: string): SmallCompanyAssessment {
  return {
    outcome: SMALL_COMPANY_OUTCOME.notApplicable,
    basis,
    ruleVersionId: null,
    authorityProvisionId: null,
  };
}
function pending(basis: string): SmallCompanyAssessment {
  return {
    outcome: SMALL_COMPANY_OUTCOME.pending,
    basis,
    ruleVersionId: null,
    authorityProvisionId: null,
  };
}

/**
 * Compute the Small Company system assessment (guide §9.1 Card E). Applies the
 * §2(85) exclusions from facts, then tests both ceilings via the resolver.
 */
export function assessSmallCompany(
  f: SmallCompanyFacts,
  resolve: RuleResolver,
): SmallCompanyAssessment {
  if (f.isCompany === false)
    return notApplicable('Not a company — the small-company definition u/s 2(85) does not apply.');
  if (f.isCompany == null)
    return pending(
      'Entity type not confirmed — needed to compute the §2(85) small-company status.',
    );
  if (f.isPrivateCompany === false)
    return notSmall('A public company is excluded from the small-company definition (§2(85)).');
  if (f.isPrivateCompany == null)
    return pending('Private/public status not confirmed — needed for the §2(85) test.');
  if (f.isHoldingOrSubsidiary)
    return notSmall(
      'A holding or subsidiary company is excluded from the small-company definition (§2(85) proviso).',
    );
  const excluder = f.specialEntityTypes.find((t) => SMALL_COMPANY_EXCLUDING.includes(t));
  if (excluder)
    return notSmall(
      `Excluded from the small-company definition by the §2(85) proviso (special entity: ${excluder}).`,
    );

  if (f.paidUpCapital == null || f.turnover == null)
    return pending(
      'Paid-up capital / turnover not captured — needed to test the §2(85) small-company ceilings.',
    );

  const capRule = resolve(FRAMEWORK_AREA_KEY.entityRegulatoryProfile, RULE_CRITERION.paidUpCapital);
  const turnRule = resolve(FRAMEWORK_AREA_KEY.entityRegulatoryProfile, RULE_CRITERION.turnover);
  if (!capRule || capRule.threshold == null || !turnRule || turnRule.threshold == null)
    return pending(
      '§2(85) small-company ceilings not found in the Audit Rules Library for this audit period — Information Insufficient.',
    );

  const capOk = ruleMeets(f.paidUpCapital, capRule);
  const turnOk = ruleMeets(f.turnover, turnRule);
  const detail =
    `paid-up ${formatInrCrore(f.paidUpCapital)} ${capRule.operator} ${formatInrCrore(capRule.threshold)}, ` +
    `turnover ${formatInrCrore(f.turnover)} ${turnRule.operator} ${formatInrCrore(turnRule.threshold)}; ` +
    `rule ${capRule.ruleCode} effective ${capRule.effectiveFrom}`;
  return capOk && turnOk
    ? small(`Private company within both §2(85) ceilings (${detail}).`, capRule)
    : notSmall(
        `Private company exceeds a §2(85) ceiling (${detail}) — not a small company.`,
        capRule,
      );
}

/** The professional facts that drive the SA triggers (guide §9.1). */
export interface SaTriggerFacts {
  initialAudit: boolean;
  accountingEnvironment: AccountingEnvironment | null;
  jointAudit: boolean;
}

/**
 * Derive the SA 510 / 402 / 299 triggers carried forward to 02.8 & Planning
 * (guide §9.1). Deterministic from the captured facts.
 */
export function deriveSaTriggers(f: SaTriggerFacts): SaTrigger[] {
  const usesServiceOrg =
    f.accountingEnvironment != null &&
    SERVICE_ORGANISATION_ENVIRONMENTS.includes(f.accountingEnvironment);
  return [
    {
      code: SA_TRIGGER_CODE.sa510,
      triggered: f.initialAudit,
      basis: f.initialAudit
        ? 'Initial (first-year) audit — opening balances require SA 510 consideration.'
        : 'Continuing audit — SA 510 opening-balance procedures not triggered by first-year status.',
    },
    {
      code: SA_TRIGGER_CODE.sa402,
      triggered: usesServiceOrg,
      basis: usesServiceOrg
        ? `Accounting is ${f.accountingEnvironment === ACCOUNTING_ENVIRONMENT.hybrid ? 'partly' : ''} handled by a service organisation — SA 402 applies.`.replace(
            '  ',
            ' ',
          )
        : 'Accounting is maintained in-house — SA 402 (service organisation) not triggered.',
    },
    {
      code: SA_TRIGGER_CODE.sa299,
      triggered: f.jointAudit,
      basis: f.jointAudit
        ? 'Joint audit — SA 299 (responsibility of joint auditors) applies.'
        : 'Sole audit — SA 299 not triggered.',
    },
  ];
}
