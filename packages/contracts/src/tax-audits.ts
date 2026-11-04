/**
 * Tax Audit (s.44AB) — the seventh stream on a Compliance engagement (Phase 3,
 * F-1). One audit a financial year, with a revision number for a revised
 * report; the stage moves from Not started to Filed. The year's report filing
 * (rule IT_TAX_AUDIT, Form 3CA/3CB-3CD) is on the calendar beside it and
 * carries the statutory due date.
 */
import type { FilingStatus } from './engagement-restructure';

export const TAX_AUDIT_STAGES = [
  'not_started',
  'acceptance',
  'information',
  'clause_work',
  'review',
  'signed',
  'uploaded',
  'client_accepted',
  'filed',
  'not_applicable',
] as const;
export type TaxAuditStage = (typeof TAX_AUDIT_STAGES)[number];

export const TAX_AUDIT_STAGE_LABEL: Record<TaxAuditStage, string> = {
  not_started: 'Not started',
  acceptance: 'Acceptance',
  information: 'Information from client',
  clause_work: 'Clause work',
  review: 'Review',
  signed: 'Signed',
  uploaded: 'Uploaded',
  client_accepted: 'Accepted by client',
  filed: 'Filed',
  not_applicable: 'Not applicable',
};

/** 3CA: accounts already audited under another law; 3CB: audited only for tax. */
export const TAX_AUDIT_FORMS = ['3CA', '3CB'] as const;
export type TaxAuditForm = (typeof TAX_AUDIT_FORMS)[number];

/**
 * The first tax year under the Income-tax Act 2025. Its tax audit (section 63,
 * rule 47 of the Income-tax Rules 2026) is reported in one Form 26, which
 * takes the place of 3CA / 3CB and the 3CD particulars. FY 2025-26 and earlier
 * are still audited under s.44AB of the 1961 Act, in 3CA / 3CB with 3CD.
 */
export const TAX_AUDIT_FORM_26_FROM_FY = '2026-27';

/** Which Act and report a year's tax audit falls under. */
export function taxAuditRegime(financialYear: string): {
  act: '1961' | '2025';
  section: string;
  /** The report, e.g. 'Form 3CA / 3CB with 3CD' or 'Form 26'. */
  report: string;
  /** The particulars the clauses fill: '3CD' or 'Form 26'. */
  particulars: string;
} {
  return financialYear >= TAX_AUDIT_FORM_26_FROM_FY
    ? { act: '2025', section: 's.63, Income-tax Act 2025', report: 'Form 26', particulars: 'Form 26' }
    : {
        act: '1961',
        section: 's.44AB, Income-tax Act 1961',
        report: 'Form 3CA / 3CB with 3CD',
        particulars: '3CD',
      };
}

/**
 * A year's form, as the firm says it: "Form 3CB" up to FY 2025-26; from
 * 2026-27, "Form 26" with the case that 3CA / 3CB used to tell apart.
 */
export function taxAuditFormLabel(financialYear: string, form: TaxAuditForm | null): string {
  if (financialYear < TAX_AUDIT_FORM_26_FROM_FY) return form ? `Form ${form}` : 'Form 3CA / 3CB';
  if (!form) return 'Form 26';
  return form === '3CA' ? 'Form 26 (audited under another law)' : 'Form 26 (tax audit only)';
}

/** One year's audit on the engagement's Tax Audit tab (GET /engagements/:id/tax-audits). */
export interface TaxAuditRow {
  id: string;
  engagementId: string;
  financialYear: string;
  /** 0 = the original report; 1, 2 … revised reports. */
  revision: number;
  stage: TaxAuditStage;
  formType: TaxAuditForm | null;
  signingPartnerId: string | null;
  signingPartnerName: string | null;
  applicabilityReason: string | null;
  udin: string | null;
  signedAt: string | null;
  /** ISO dates. */
  uploadedOn: string | null;
  clientAcceptedOn: string | null;
  clientRejectedOn: string | null;
  filedOn: string | null;
  acknowledgementNo: string | null;
  /** The year's report filing on the calendar, when there is one. */
  instanceId: string | null;
  filingStatus: FilingStatus | null;
  /** The filing's due date (override, then extension, then statute); ISO date. */
  dueDate: string | null;
  /** Negative when overdue; null once filed or without a filing. */
  daysLeft: number | null;
}
