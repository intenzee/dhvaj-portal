/**
 * Tax Audit acceptance desk (Phase 4, F-3). Before work starts on a year's
 * tax audit: the s.44AB independence check (the firm that keeps the books
 * cannot do the tax audit), the written communication to a previous auditor
 * (ICAI Code of Ethics), the form (3CA / 3CB), the signing partner — only a
 * partner with a valid certificate of practice (COP) and room under the
 * firm's yearly limit (ICAI: 60 reports a partner) — and the appointment
 * letter from the firm's template.
 *
 * GET  /engagements/:id/tax-audits/:auditId/acceptance
 * PUT  /engagements/:id/tax-audits/:auditId/acceptance
 * POST /engagements/:id/tax-audits/:auditId/acceptance/previous-auditor-letter
 * POST /engagements/:id/tax-audits/:auditId/acceptance/appointment-letter
 * POST /engagements/:id/tax-audits/:auditId/acceptance/accept
 */
import type { IndependenceFinding } from './engagement-restructure';
import type { TaxAuditForm, TaxAuditStage } from './tax-audits';

/** One partner in the signing-partner picker. */
export interface TaxAuditSigningPartner {
  employeeId: string;
  name: string;
  copNo: string | null;
  /** ISO date. */
  copValidUntil: string | null;
  /** Tax audit reports the partner signs for the year, across every client. */
  reports: number;
  /** "Deepak: 41 of 60 for FY 2025-26". */
  summary: string;
  /** May be chosen: a valid COP and room under the limit (or already this audit's partner). */
  offered: boolean;
  /** Why not, when not offered. */
  reason: string | null;
  /** Offered, but near the limit: "52 of 60 — 8 left for FY 2025-26". */
  warning: string | null;
}

/** GET …/acceptance */
/**
 * F-10: last year's filed audit this year's row was rolled over from, and
 * what it proposes — the form, the signing partner (offered again only if
 * still within the COP and the limit) and the engagement's team.
 */
export interface TaxAuditRolloverProposal {
  fromAuditId: string;
  fromFinancialYear: string;
  formType: TaxAuditForm | null;
  signingPartnerId: string | null;
  signingPartnerName: string | null;
  /** "Partner A (engagement partner)", "Senior Y (in charge)", … */
  team: string[];
}

export interface TaxAuditAcceptance {
  auditId: string;
  engagementId: string;
  financialYear: string;
  stage: TaxAuditStage;
  formType: TaxAuditForm | null;
  signingPartnerId: string | null;
  signingPartnerName: string | null;
  /** The s.44AB check (bookkeeping and tax audit for the same year). */
  independence: {
    ok: boolean;
    findings: IndependenceFinding[];
    confirmedAt: string | null;
    confirmedByName: string | null;
  };
  previousAuditor: {
    /** null: not answered; true: another firm signed last year's report. */
    changed: boolean | null;
    name: string | null;
    letterDocumentId: string | null;
    letterTitle: string | null;
  };
  appointmentLetter: { documentId: string; title: string } | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  /** Rolled over from last year's filed audit (F-10); null otherwise. */
  proposal: TaxAuditRolloverProposal | null;
  /** The firm's yearly limit of reports a partner (60 at most). */
  limit: number;
  partners: TaxAuditSigningPartner[];
  /** What still stands between the audit and acceptance; empty when it can be accepted. */
  missing: string[];
  /** The engagement's partner or manager, before acceptance. */
  canEdit: boolean;
  version: number;
}

/** PUT …/acceptance — any subset, with the version read. */
export interface SaveTaxAuditAcceptanceInput {
  version: number;
  formType?: TaxAuditForm | null;
  signingPartnerId?: string | null;
  previousAuditorChanged?: boolean | null;
  previousAuditorName?: string | null;
}

/** POST …/acceptance/previous-auditor-letter */
export interface UploadPreviousAuditorLetterInput {
  version: number;
  filename: string;
  contentType?: string;
  contentBase64: string;
}

/** POST …/acceptance/appointment-letter and …/accept */
export interface TaxAuditAcceptanceStepInput {
  version: number;
  variantKey?: string;
}

/** "Deepak: 41 of 60 for FY 2025-26". */
export function partnerLoadSummary(
  name: string,
  reports: number,
  limit: number,
  financialYear: string,
): string {
  return `${name}: ${reports} of ${limit} for FY ${financialYear}`;
}

/**
 * A partner is warned from this many reports in a year (50 of the 60 the
 * ICAI allows), so the last few are planned rather than found at signing.
 */
export const TAX_AUDIT_WARN_AT = 50;

/** The warning point for the firm's limit: 50 at 60, ten short of a lower limit. */
export function taxAuditWarnAt(limit: number): number {
  return Math.max(1, Math.min(TAX_AUDIT_WARN_AT, limit - 10));
}

/** COP valid on the IST date `today` (YYYY-MM-DD): valid until today or later. */
export function copValid(copValidUntil: string | null, today: string): boolean {
  return copValidUntil !== null && copValidUntil >= today;
}

/**
 * Whether a partner may be chosen to sign: a valid COP, and room under the
 * limit — a partner already signing this audit keeps their place.
 */
export function signingPartnerOffer(
  p: { name: string; copValidUntil: string | null; reports: number },
  limit: number,
  financialYear: string,
  today: string,
  current = false,
): { offered: boolean; reason: string | null; summary: string; warning: string | null } {
  const summary = partnerLoadSummary(p.name, p.reports, limit, financialYear);
  if (!copValid(p.copValidUntil, today)) {
    return {
      offered: false,
      summary,
      warning: null,
      reason: p.copValidUntil
        ? `COP expired on ${p.copValidUntil}. An administrator updates it under Admin → People.`
        : 'No certificate of practice on the partner profile. An administrator adds it under Admin → People.',
    };
  }
  if (!current && p.reports >= limit) {
    return {
      offered: false,
      summary,
      warning: null,
      reason: `${p.reports} of ${limit} tax audit reports for FY ${financialYear}: no room for another.`,
    };
  }
  const warning =
    p.reports >= taxAuditWarnAt(limit)
      ? `${p.reports} of ${limit} — ${Math.max(0, limit - p.reports)} left for FY ${financialYear}`
      : null;
  return { offered: true, reason: null, summary, warning };
}

/** What still stands between a tax audit and its acceptance. */
export function acceptanceMissing(a: {
  independenceOk: boolean;
  formType: TaxAuditForm | null;
  signingPartnerId: string | null;
  previousAuditorChanged: boolean | null;
  previousAuditorName: string | null;
  previousAuditorLetterDocumentId: string | null;
  appointmentLetterDocumentId: string | null;
}): string[] {
  const missing: string[] = [];
  if (!a.independenceOk) missing.push('Resolve the independence conflict (s.44AB).');
  if (a.previousAuditorChanged === null) {
    missing.push('Say whether another auditor signed last year’s report.');
  } else if (a.previousAuditorChanged) {
    if (!a.previousAuditorName?.trim()) missing.push('Name the previous auditor.');
    if (!a.previousAuditorLetterDocumentId) {
      missing.push('Upload the written communication to the previous auditor.');
    }
  }
  if (!a.formType) missing.push('Choose the form: 3CA or 3CB.');
  if (!a.signingPartnerId) missing.push('Choose the signing partner.');
  if (!a.appointmentLetterDocumentId) missing.push('Make the appointment letter.');
  return missing;
}

/** Assessment year for a financial year: 2025-26 → 2026-27. */
export function assessmentYearOf(financialYear: string): string {
  const start = Number(financialYear.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
