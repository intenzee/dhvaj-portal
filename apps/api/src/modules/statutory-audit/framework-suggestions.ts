import {
  FRAMEWORK_AREA_KEY,
  RULE_CRITERION,
  auditPeriodStartFromFinancialYear,
  formatInrCrore,
  ruleMeets,
  type FrameworkAreaKey,
  type FrameworkConclusion,
  type FrameworkState,
  type ResolvedRule,
  type RuleResolver,
} from '@hsdg/contracts';

// Re-export so callers keep a single import site for the period helper.
export { auditPeriodStartFromFinancialYear };

/**
 * Framework applicability SUGGESTION engine (Audit Spec §19; Implementation
 * Guide §4, §7). Pure and deterministic — mirrors the engagement-components
 * evaluateApplicability precedent so it can be unit-tested without a database.
 *
 * IMPORTANT: every output here is ADVISORY (§19 "rule engine suggestion awaiting
 * professional decision"). The professional records the actual conclusion and may
 * override any suggestion (§19 Overridden).
 *
 * NO statutory number lives in this file (guide §1). Every threshold, ratio and
 * effective date is resolved from the Audit Rules Library through the injected
 * {@link RuleResolver}, and the basis string names the ACTUAL rule + limit used
 * so the reviewer sees the reasoning and the provision it rests on. Where a safe
 * call cannot be made the engine returns `professional_judgement_required`; where
 * deciding facts are absent it returns `pending_information`; where the library
 * holds no rule for the audit period it returns `professional_judgement_required`
 * with an "Information Insufficient" basis — it never guesses.
 */

/** Normalised entity facts the engine reads (unknowns are null, never assumed). */
export interface FrameworkFacts {
  /** True for a company under the Companies Act; false for LLP/firm/individual/…; null if unknown. */
  isCompany: boolean | null;
  isPrivateCompany: boolean | null;
  isListed: boolean | null;
  hasSubsidiariesOrAssociates: boolean | null;
  isGovernmentCompany: boolean | null;
  acceptsPublicDeposits: boolean | null;
  regulatedSector: boolean | null;
  // Financials (rupees); null when not captured.
  netWorth: number | null;
  turnover: number | null;
  netProfit: number | null;
  paidUpCapital: number | null;
  totalBorrowings: number | null;
  publicDeposits: number | null;
}

export interface AreaSuggestion {
  suggestion: FrameworkConclusion | null;
  state: FrameworkState;
  basis: string;
  /** The rule version frozen onto the conclusion, when a library rule drove it. */
  ruleVersionId?: string | null;
  /** The provision the conclusion rests on, for `View Provision`. */
  authorityProvisionId?: string | null;
}

const applies = (basis: string, r?: ResolvedRule): AreaSuggestion => ({
  suggestion: 'applicable',
  state: 'system_suggested_applicable',
  basis,
  ruleVersionId: r?.ruleVersionId ?? null,
  authorityProvisionId: r?.authorityProvisionId ?? null,
});
const notApplies = (basis: string, r?: ResolvedRule): AreaSuggestion => ({
  suggestion: 'not_applicable',
  state: 'system_suggested_not_applicable',
  basis,
  ruleVersionId: r?.ruleVersionId ?? null,
  authorityProvisionId: r?.authorityProvisionId ?? null,
});
const judgement = (basis: string): AreaSuggestion => ({
  suggestion: null,
  state: 'professional_judgement_required',
  basis,
});
const pending = (basis: string): AreaSuggestion => ({
  suggestion: null,
  state: 'pending_information',
  basis,
});
/** No library rule covers the audit period — Information Insufficient (§4.3). */
const unresolved = (what: string): AreaSuggestion =>
  judgement(
    `${what} not found in the Audit Rules Library for this audit period — Information Insufficient.`,
  );

/** Short "rule X effective YYYY-MM-DD" trailer for a traceable basis string. */
function ruleTag(r: ResolvedRule): string {
  return `rule ${r.ruleCode} effective ${r.effectiveFrom}`;
}

/**
 * Suggest applicability for one area from the entity's facts, resolving every
 * statutory value through `resolve`. Returns null suggestion (leaving the
 * professional to decide) for descriptive areas and wherever a safe rule cannot
 * be applied.
 */
export function suggestArea(
  areaKey: FrameworkAreaKey,
  f: FrameworkFacts,
  resolve: RuleResolver,
): AreaSuggestion {
  switch (areaKey) {
    case FRAMEWORK_AREA_KEY.indAsAs: {
      // Ind AS: mandatory for listed companies; else by the net-worth threshold.
      if (f.isCompany === false)
        return notApplies(
          'Not a company — Ind AS/AS under the Companies (Accounts) Rules does not apply.',
        );
      if (f.isListed)
        return applies('Listed company — Ind AS applies (Companies (Ind AS) Rules, Rule 4).');
      if (f.netWorth == null)
        return pending('Net worth not captured — needed to test the Ind AS net-worth threshold.');
      const rule = resolve(FRAMEWORK_AREA_KEY.indAsAs, RULE_CRITERION.netWorth);
      if (!rule || rule.threshold == null) return unresolved('Ind AS net-worth threshold');
      return ruleMeets(f.netWorth, rule)
        ? applies(
            `Net worth ${formatInrCrore(f.netWorth)} ${rule.operator} ${formatInrCrore(rule.threshold)} — Ind AS applies (${ruleTag(rule)}).`,
            rule,
          )
        : notApplies(
            `Net worth ${formatInrCrore(f.netWorth)} below ${formatInrCrore(rule.threshold)} and unlisted — AS framework indicated, not Ind AS (${ruleTag(rule)}).`,
            rule,
          );
    }

    case FRAMEWORK_AREA_KEY.scheduleIii: {
      // Schedule III governs the form of a company's financial statements.
      if (f.isCompany == null)
        return judgement('Entity type unknown — confirm whether Schedule III applies.');
      return f.isCompany
        ? applies('Company under the Companies Act — financial statements follow Schedule III.')
        : notApplies('Not a company — Schedule III does not apply.');
    }

    case FRAMEWORK_AREA_KEY.caro: {
      // CARO 2020 applies to companies, excluding banking/insurance/sec-8 and
      // small/OPC and small private companies below the thresholds.
      if (f.isCompany === false) return notApplies('Not a company — CARO 2020 does not apply.');
      if (f.isCompany == null)
        return judgement('Entity type unknown — confirm CARO applicability.');
      if (f.isPrivateCompany) {
        const capital = f.paidUpCapital;
        const borrow = f.totalBorrowings;
        const rev = f.turnover;
        if (capital == null || borrow == null || rev == null)
          return pending(
            'Private company — capital/borrowings/turnover needed to test the CARO small-company exemption.',
          );
        const capRule = resolve(FRAMEWORK_AREA_KEY.caro, RULE_CRITERION.paidUpCapital);
        const borrowRule = resolve(FRAMEWORK_AREA_KEY.caro, RULE_CRITERION.borrowings);
        const revRule = resolve(FRAMEWORK_AREA_KEY.caro, RULE_CRITERION.revenue);
        if (!capRule || !borrowRule || !revRule)
          return unresolved('CARO private-company exemption thresholds');
        const exempt =
          ruleMeets(capital, capRule) && ruleMeets(borrow, borrowRule) && ruleMeets(rev, revRule);
        return exempt
          ? notApplies(
              `Private company within CARO exemption (paid-up ${formatInrCrore(capital)} ${capRule.operator} ${formatInrCrore(capRule.threshold!)}, borrowings ${formatInrCrore(borrow)} ${borrowRule.operator} ${formatInrCrore(borrowRule.threshold!)}, revenue ${formatInrCrore(rev)} ${revRule.operator} ${formatInrCrore(revRule.threshold!)}; ${ruleTag(capRule)}).`,
              capRule,
            )
          : applies(
              'Private company above the CARO small-company exemption thresholds — CARO 2020 applies.',
              capRule,
            );
      }
      return applies(
        'Company (non-private) — CARO 2020 applies, subject to the banking/insurance/sec-8 exclusions.',
      );
    }

    case FRAMEWORK_AREA_KEY.ifc: {
      // IFC reporting u/s 143(3)(i): all companies (certain small private cos exempt).
      if (f.isCompany === false)
        return notApplies('Not a company — IFC reporting u/s 143(3)(i) does not apply.');
      if (f.isCompany == null)
        return judgement('Entity type unknown — confirm IFC reporting applicability.');
      return applies(
        'Company — IFC-over-financial-reporting is reportable u/s 143(3)(i) (confirm any small-private-company exemption).',
      );
    }

    case FRAMEWORK_AREA_KEY.cfs: {
      // Consolidation: a company with subsidiaries/associates/JVs prepares CFS.
      if (f.hasSubsidiariesOrAssociates == null)
        return pending(
          'Group structure not captured — needed to test consolidation applicability.',
        );
      return f.hasSubsidiariesOrAssociates
        ? applies(
            'Entity has subsidiaries/associates/JVs — consolidated financial statements are required (Sec 129(3)).',
          )
        : notApplies('No subsidiaries/associates/JVs on record — CFS not indicated.');
    }

    case FRAMEWORK_AREA_KEY.internalAudit: {
      // Sec 138 / Rule 13 thresholds (paid-up / turnover / borrowings / deposits).
      if (f.isCompany === false)
        return notApplies('Not a company — Sec 138 internal audit does not apply.');
      if (f.isListed) return applies('Listed company — internal audit is mandatory (Sec 138).');
      const { turnover: t, totalBorrowings: b, paidUpCapital: c, publicDeposits: d } = f;
      if (t == null && b == null && c == null && d == null)
        return pending(
          'Turnover/borrowings/capital/deposits not captured — needed for the Sec 138 thresholds.',
        );
      const capRule = resolve(FRAMEWORK_AREA_KEY.internalAudit, RULE_CRITERION.paidUpCapital);
      const turnRule = resolve(FRAMEWORK_AREA_KEY.internalAudit, RULE_CRITERION.turnover);
      const borrowRule = resolve(FRAMEWORK_AREA_KEY.internalAudit, RULE_CRITERION.borrowings);
      const depRule = resolve(FRAMEWORK_AREA_KEY.internalAudit, RULE_CRITERION.deposits);
      if (!capRule || !turnRule || !borrowRule || !depRule)
        return unresolved('Sec 138 internal-audit thresholds');
      const hit =
        (c != null && ruleMeets(c, capRule)) ||
        (t != null && ruleMeets(t, turnRule)) ||
        (b != null && ruleMeets(b, borrowRule)) ||
        (d != null && ruleMeets(d, depRule));
      return hit
        ? applies(
            `Meets a Sec 138 threshold (paid-up ${capRule.operator} ${formatInrCrore(capRule.threshold!)} / turnover ${turnRule.operator} ${formatInrCrore(turnRule.threshold!)} / borrowings ${borrowRule.operator} ${formatInrCrore(borrowRule.threshold!)} / deposits ${depRule.operator} ${formatInrCrore(depRule.threshold!)}; ${ruleTag(capRule)}).`,
            capRule,
          )
        : judgement(
            'Below the common Sec 138 thresholds on captured facts — confirm class-specific limits before concluding.',
          );
    }

    case FRAMEWORK_AREA_KEY.secretarialAudit: {
      // Sec 204 / Rule 9: listed, or public above the paid-up / turnover limits.
      if (f.isListed) return applies('Listed company — secretarial audit is mandatory (Sec 204).');
      if (f.isPrivateCompany)
        return judgement(
          'Private company — Sec 204 generally does not apply unless a borrowing threshold is met; confirm.',
        );
      const { paidUpCapital: c, turnover: t } = f;
      if (c == null && t == null)
        return pending(
          'Paid-up capital/turnover not captured — needed for the Sec 204 thresholds.',
        );
      const capRule = resolve(FRAMEWORK_AREA_KEY.secretarialAudit, RULE_CRITERION.paidUpCapital);
      const turnRule = resolve(FRAMEWORK_AREA_KEY.secretarialAudit, RULE_CRITERION.turnover);
      if (!capRule || !turnRule) return unresolved('Sec 204 secretarial-audit thresholds');
      const hit = (c != null && ruleMeets(c, capRule)) || (t != null && ruleMeets(t, turnRule));
      return hit
        ? applies(
            `Public company meeting a Sec 204 threshold (paid-up ${capRule.operator} ${formatInrCrore(capRule.threshold!)} or turnover ${turnRule.operator} ${formatInrCrore(turnRule.threshold!)}; ${ruleTag(capRule)}).`,
            capRule,
          )
        : notApplies('Public company below the Sec 204 thresholds on captured facts.', capRule);
    }

    case FRAMEWORK_AREA_KEY.csr: {
      // Sec 135: net worth / turnover / net profit thresholds.
      const { netWorth: nw, turnover: t, netProfit: np } = f;
      if (nw == null && t == null && np == null)
        return pending(
          'Net worth/turnover/net profit not captured — needed for the Sec 135 CSR thresholds.',
        );
      const nwRule = resolve(FRAMEWORK_AREA_KEY.csr, RULE_CRITERION.netWorth);
      const turnRule = resolve(FRAMEWORK_AREA_KEY.csr, RULE_CRITERION.turnover);
      const npRule = resolve(FRAMEWORK_AREA_KEY.csr, RULE_CRITERION.netProfit);
      if (!nwRule || !turnRule || !npRule) return unresolved('Sec 135 CSR thresholds');
      const hit =
        (nw != null && ruleMeets(nw, nwRule)) ||
        (t != null && ruleMeets(t, turnRule)) ||
        (np != null && ruleMeets(np, npRule));
      return hit
        ? applies(
            `Meets a Sec 135 threshold (net worth ${nwRule.operator} ${formatInrCrore(nwRule.threshold!)} / turnover ${turnRule.operator} ${formatInrCrore(turnRule.threshold!)} / net profit ${npRule.operator} ${formatInrCrore(npRule.threshold!)}; ${ruleTag(nwRule)}) — CSR applies.`,
            nwRule,
          )
        : notApplies('Below all Sec 135 CSR thresholds on captured facts.', nwRule);
    }

    case FRAMEWORK_AREA_KEY.rule11:
    case FRAMEWORK_AREA_KEY.section143: {
      // Auditor reporting under Rule 11 / Sec 143 applies to every company audit.
      if (f.isCompany === false)
        return notApplies(
          'Not a company — auditor reporting under the Companies Act does not apply.',
        );
      if (f.isCompany == null)
        return judgement('Entity type unknown — confirm auditor-reporting applicability.');
      return applies('Company audit — auditor reporting under Sec 143 / Rule 11 applies.');
    }

    case FRAMEWORK_AREA_KEY.costRecords: {
      // Sec 148 is sector-driven; needs the specific CETA/industry mapping.
      return f.regulatedSector
        ? judgement(
            'Entity is in a regulated sector — verify Sec 148 cost records/audit applicability for the specific industry.',
          )
        : judgement(
            'Cost records/audit under Sec 148 is industry-specific — confirm against the Sec 148 industry list.',
          );
    }

    case FRAMEWORK_AREA_KEY.otherRegulatory:
      return judgement(
        'Industry/entity-specific — document any other regulatory or industry requirements.',
      );

    // Descriptive areas: the professional documents these; no auto-suggestion.
    default:
      return { suggestion: null, state: 'not_assessed', basis: '' };
  }
}
