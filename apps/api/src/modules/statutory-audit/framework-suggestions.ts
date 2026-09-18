import {
  FRAMEWORK_AREA_KEY,
  type FrameworkAreaKey,
  type FrameworkConclusion,
  type FrameworkState,
} from '@hsdg/contracts';

/**
 * Framework applicability SUGGESTION engine (Audit Spec §19). Pure and
 * deterministic — mirrors the engagement-components evaluateApplicability
 * precedent so it can be unit-tested without a database.
 *
 * IMPORTANT: every output here is ADVISORY (§19 "rule engine suggestion awaiting
 * professional decision"). The professional records the actual conclusion and may
 * override any suggestion (§19 Overridden). The thresholds below are documented
 * heuristics under the Companies Act 2013 / Rules as at the spec date; where a
 * safe call cannot be made the engine returns `professional_judgement_required`,
 * and where the deciding facts are absent it returns `pending_information` — it
 * never guesses. Each suggestion carries a `basis` naming the rule and the facts
 * used, so the reviewer sees the reasoning.
 */

/** One crore, in rupees — financial facts are stored as rupee numerics. */
const CRORE = 10_000_000;

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
}

const applies = (basis: string): AreaSuggestion => ({
  suggestion: 'applicable',
  state: 'system_suggested_applicable',
  basis,
});
const notApplies = (basis: string): AreaSuggestion => ({
  suggestion: 'not_applicable',
  state: 'system_suggested_not_applicable',
  basis,
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

/** ₹ in crore, for readable basis strings. */
function cr(value: number): string {
  return `₹${(value / CRORE).toFixed(2)} cr`;
}

/**
 * Suggest applicability for one area from the entity's facts. Returns null
 * suggestion (leaving the professional to decide) for descriptive areas and
 * wherever a safe rule cannot be applied.
 */
export function suggestArea(areaKey: FrameworkAreaKey, f: FrameworkFacts): AreaSuggestion {
  switch (areaKey) {
    case FRAMEWORK_AREA_KEY.indAsAs: {
      // Ind AS: mandatory for listed companies; else by net worth ≥ ₹250 cr.
      if (f.isCompany === false)
        return notApplies(
          'Not a company — Ind AS/AS under the Companies (Accounts) Rules does not apply.',
        );
      if (f.isListed)
        return applies('Listed company — Ind AS applies (Companies (Ind AS) Rules, Rule 4).');
      if (f.netWorth == null)
        return pending('Net worth not captured — needed to test the Ind AS ₹250 cr threshold.');
      return f.netWorth >= 250 * CRORE
        ? applies(`Net worth ${cr(f.netWorth)} ≥ ₹250 cr — Ind AS applies (Rule 4).`)
        : notApplies(
            `Net worth ${cr(f.netWorth)} < ₹250 cr and unlisted — AS framework indicated, not Ind AS.`,
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
        const exempt = capital <= 1 * CRORE && borrow <= 1 * CRORE && rev <= 10 * CRORE;
        return exempt
          ? notApplies(
              `Private company within CARO exemption (paid-up ${cr(capital)} ≤ ₹1 cr, borrowings ${cr(borrow)} ≤ ₹1 cr, revenue ${cr(rev)} ≤ ₹10 cr).`,
            )
          : applies(
              'Private company above the CARO small-company exemption thresholds — CARO 2020 applies.',
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
      // Sec 138 / Rule 13 thresholds.
      if (f.isCompany === false)
        return notApplies('Not a company — Sec 138 internal audit does not apply.');
      if (f.isListed) return applies('Listed company — internal audit is mandatory (Sec 138).');
      const { turnover: t, totalBorrowings: b, paidUpCapital: c, publicDeposits: d } = f;
      if (t == null && b == null && c == null && d == null)
        return pending(
          'Turnover/borrowings/capital/deposits not captured — needed for the Sec 138 thresholds.',
        );
      const hit =
        (c != null && c >= 50 * CRORE) ||
        (t != null && t >= 200 * CRORE) ||
        (b != null && b >= 100 * CRORE) ||
        (d != null && d >= 25 * CRORE);
      return hit
        ? applies(
            'Meets a Sec 138 threshold (paid-up ≥ ₹50 cr / turnover ≥ ₹200 cr / borrowings ≥ ₹100 cr / deposits ≥ ₹25 cr).',
          )
        : judgement(
            'Below the common Sec 138 thresholds on captured facts — confirm class-specific limits before concluding.',
          );
    }

    case FRAMEWORK_AREA_KEY.secretarialAudit: {
      // Sec 204 / Rule 9: listed, or public with paid-up ≥ ₹50 cr or turnover ≥ ₹250 cr.
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
      const hit = (c != null && c >= 50 * CRORE) || (t != null && t >= 250 * CRORE);
      return hit
        ? applies(
            'Public company meeting a Sec 204 threshold (paid-up ≥ ₹50 cr or turnover ≥ ₹250 cr).',
          )
        : notApplies('Public company below the Sec 204 thresholds on captured facts.');
    }

    case FRAMEWORK_AREA_KEY.csr: {
      // Sec 135: net worth ≥ ₹500 cr OR turnover ≥ ₹1000 cr OR net profit ≥ ₹5 cr.
      const { netWorth: nw, turnover: t, netProfit: np } = f;
      if (nw == null && t == null && np == null)
        return pending(
          'Net worth/turnover/net profit not captured — needed for the Sec 135 CSR thresholds.',
        );
      const hit =
        (nw != null && nw >= 500 * CRORE) ||
        (t != null && t >= 1000 * CRORE) ||
        (np != null && np >= 5 * CRORE);
      return hit
        ? applies(
            'Meets a Sec 135 threshold (net worth ≥ ₹500 cr / turnover ≥ ₹1000 cr / net profit ≥ ₹5 cr) — CSR applies.',
          )
        : notApplies('Below all Sec 135 CSR thresholds on captured facts.');
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
