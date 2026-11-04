/**
 * Tax audit applicability (Phase 3, F-2): whether s.44AB needs a client's
 * accounts audited for a year, and why. The calculator is pure so the form can
 * show its answer as it is filled in; the API works it out again on save.
 * A partner or manager may override the answer, with a reason.
 *
 *   (a) business turnover over ₹1 crore — ₹10 crore when cash receipts and
 *       cash payments are each within 5% — unless the deemed profit is
 *       declared under s.44AD (turnover within ₹2 crore, ₹3 crore with cash
 *       within 5%);
 *   (b) professional receipts over ₹50 lakh, unless the deemed profit is
 *       declared under s.44ADA (receipts within ₹75 lakh with cash within 5%);
 *   (c) less than the deemed profit under s.44AE, 44BB or 44BBB;
 *   (d) less than the deemed profit under s.44ADA, income over the exemption limit;
 *   (e) out of s.44AD within five years of opting in (s.44AD(4)), income over
 *       the exemption limit.
 */
import type { TaxAuditStage } from './tax-audits';

export const TAX_AUDIT_PRESUMPTIVE_SCHEMES = ['44AD', '44ADA', '44AE', '44BB', '44BBB'] as const;
export type TaxAuditPresumptiveScheme = (typeof TAX_AUDIT_PRESUMPTIVE_SCHEMES)[number];

export const TAX_AUDIT_CLAUSES = ['44AB(a)', '44AB(b)', '44AB(c)', '44AB(d)', '44AB(e)'] as const;
export type TaxAuditClause = (typeof TAX_AUDIT_CLAUSES)[number];

/** What the calculator asks about the year. Amounts in rupees. */
export interface TaxAuditApplicabilityInput {
  /** Total sales, turnover or gross receipts of the business (null: no business). */
  businessTurnover: number | null;
  /** Gross receipts of the profession (null: no profession). */
  professionReceipts: number | null;
  /** Cash receipts and cash payments are each within 5% of the year's totals. */
  cashWithinFivePercent: boolean;
  /** The presumptive scheme the client files under, if any. */
  presumptiveScheme: TaxAuditPresumptiveScheme | null;
  /** Declares less profit than the scheme deems. */
  profitBelowPresumptive: boolean;
  /** Total income is over the basic exemption limit. */
  incomeAboveExemption: boolean;
  /** Left s.44AD within five years of opting in (s.44AD(4)). */
  optedOutOf44AD: boolean;
}

export interface TaxAuditApplicabilityResult {
  applicable: boolean;
  clause: TaxAuditClause | null;
  reason: string;
}

const LAKH = 1_00_000;
const CRORE = 1_00_00_000;

/** ₹2.5 crore / ₹80 lakh / ₹45,000. */
export function rupeesShort(n: number): string {
  const fmt = (v: number) => String(Number(v.toFixed(2)));
  if (n >= CRORE) return `₹${fmt(n / CRORE)} crore`;
  if (n >= LAKH) return `₹${fmt(n / LAKH)} lakh`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function taxAuditApplicability(i: TaxAuditApplicabilityInput): TaxAuditApplicabilityResult {
  const turnover = i.businessTurnover ?? 0;
  const receipts = i.professionReceipts ?? 0;
  const scheme = i.presumptiveScheme;
  const yes = (clause: TaxAuditClause, reason: string): TaxAuditApplicabilityResult => ({
    applicable: true,
    clause,
    reason,
  });

  if (scheme && i.profitBelowPresumptive) {
    if (scheme === '44AE' || scheme === '44BB' || scheme === '44BBB') {
      return yes('44AB(c)', `Declares less than the deemed profit under s.${scheme}.`);
    }
    if (scheme === '44ADA' && i.incomeAboveExemption) {
      return yes(
        '44AB(d)',
        'Declares less than the deemed profit under s.44ADA, with income over the exemption limit.',
      );
    }
  }
  if (
    (i.optedOutOf44AD || (scheme === '44AD' && i.profitBelowPresumptive)) &&
    i.incomeAboveExemption
  ) {
    return yes(
      '44AB(e)',
      'Out of s.44AD within five years of opting in (s.44AD(4)), with income over the exemption limit.',
    );
  }

  const notes: string[] = [];
  if (turnover > 0) {
    const limit44AD = i.cashWithinFivePercent ? 3 * CRORE : 2 * CRORE;
    if (scheme === '44AD' && !i.profitBelowPresumptive && turnover <= limit44AD) {
      notes.push(
        `Deemed profit under s.44AD on turnover of ${rupeesShort(turnover)}, within ${rupeesShort(limit44AD)}.`,
      );
    } else {
      const limit = i.cashWithinFivePercent ? 10 * CRORE : CRORE;
      const within = i.cashWithinFivePercent ? `${rupeesShort(limit)} (cash within 5%)` : rupeesShort(limit);
      if (turnover > limit) {
        return yes('44AB(a)', `Business turnover of ${rupeesShort(turnover)} is over ${within}.`);
      }
      notes.push(`Business turnover of ${rupeesShort(turnover)} is within ${within}.`);
    }
  }
  if (receipts > 0) {
    const on44ADA =
      scheme === '44ADA' &&
      !i.profitBelowPresumptive &&
      receipts <= (i.cashWithinFivePercent ? 75 * LAKH : 50 * LAKH);
    if (receipts > 50 * LAKH && !on44ADA) {
      return yes('44AB(b)', `Professional receipts of ${rupeesShort(receipts)} are over ₹50 lakh.`);
    }
    notes.push(
      on44ADA && receipts > 50 * LAKH
        ? `Deemed profit under s.44ADA on receipts of ${rupeesShort(receipts)}, within ₹75 lakh.`
        : `Professional receipts of ${rupeesShort(receipts)} are within ₹50 lakh.`,
    );
  }
  if (scheme && i.profitBelowPresumptive && !i.incomeAboveExemption) {
    notes.push(`Less than the deemed profit under s.${scheme}, but income within the exemption limit.`);
  }
  return {
    applicable: false,
    clause: null,
    reason: notes.length ? notes.join(' ') : 'No business or professional income for the year.',
  };
}

/** A year's decision on the engagement (GET /engagements/:id/tax-audit-applicability). */
export interface TaxAuditApplicability {
  id: string;
  engagementId: string;
  financialYear: string;
  inputs: TaxAuditApplicabilityInput;
  computed: TaxAuditApplicabilityResult;
  /** A partner's or manager's answer over the calculator's, with a reason. */
  override: { applicable: boolean; reason: string } | null;
  /** The answer the calendar and the radar use. */
  applicable: boolean;
  reason: string;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: string;
  version: number;
}

/** PUT /engagements/:id/tax-audit-applicability/:fy */
export interface SaveTaxAuditApplicabilityInput {
  inputs: TaxAuditApplicabilityInput;
  override: { applicable: boolean; reason: string } | null;
  /** The decision's version when it is being changed; omit for a new one. */
  version?: number;
}

/** Where the radar's answer comes from. */
export const TAX_AUDIT_RADAR_BASES = ['decided', 'pan_profile', 'turnover'] as const;
export type TaxAuditRadarBasis = (typeof TAX_AUDIT_RADAR_BASES)[number];

/** One client on the firm's tax audit radar (GET /tax-audits/radar). */
export interface TaxAuditRadarRow {
  engagementId: string;
  engagementCode: string;
  entityId: string;
  entityName: string;
  financialYear: string;
  /** The compliance year's version, to add the stream to it. */
  yearVersion: number;
  likely: boolean;
  basis: TaxAuditRadarBasis;
  reason: string;
  /** Tax Audit is in the year's scope. */
  inScope: boolean;
  /** Bookkeeping is in the year's scope: the firm cannot take the tax audit. */
  booksKept: boolean;
  stage: TaxAuditStage | null;
  /** 30 September after the year (or the filing's own due date); ISO date. */
  dueDate: string;
  daysToDue: number;
  /** Likely, not in scope, and the report is due within 90 days. */
  alert: boolean;
}
