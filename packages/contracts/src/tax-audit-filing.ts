/**
 * Tax Audit sign and file (Phase 5, F-8).
 *
 * Signed (UDIN and the signed report, by the signing Partner) → Uploaded on
 * the e-filing portal → Accepted by the client (a rejection sends it back to
 * review) → Filed, with the acknowledgement. Filing lodges the year's
 * IT_TAX_AUDIT filing, so the audit-case ITR can follow. A filed report can
 * be revised: the revision is the next one of the year's audit, with a reason.
 */
import { TAX_AUDIT_STAGE_LABEL, type TaxAuditStage } from './tax-audits';

/** As ICAI issues it: 8 digits (year + membership number), 6 letters, 4 digits. */
export const TAX_AUDIT_UDIN_PATTERN = /^[0-9]{8}[A-Z]{6}[0-9]{4}$/;

/** The rule codes of the ITR that waits on the tax audit report. */
export const ITR_AFTER_TAX_AUDIT_RULES = ['IT_ITR_AUDIT', 'IT_ITR_TP'] as const;

/** Stages in which the portal is running the report (the ITR waits; the filing is the desk's). */
export const TAX_AUDIT_IN_HAND: readonly TaxAuditStage[] = [
  'acceptance',
  'information',
  'clause_work',
  'review',
  'signed',
  'uploaded',
  'client_accepted',
];

/** The UDIN, upper-cased and without spaces, or why it is not one. */
export function checkUdin(
  raw: string,
  membershipNo: string | null,
): { value: string } | { error: string } {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!TAX_AUDIT_UDIN_PATTERN.test(value)) {
    return { error: 'A UDIN is 18 characters: 8 digits, 6 letters, 4 digits.' };
  }
  // Digits 3–8 are the member's membership number.
  const m = membershipNo?.trim() ?? '';
  if (/^[0-9]{1,6}$/.test(m) && value.slice(2, 8) !== m.padStart(6, '0')) {
    return {
      error: `This UDIN is not on the signing Partner’s membership number (${m.padStart(6, '0')}).`,
    };
  }
  return { value };
}

/** Why the audit-case ITR cannot be lodged yet, or null. */
export function itrWaitReason(financialYear: string, stage: TaxAuditStage | null): string | null {
  if (!stage || stage === 'filed' || stage === 'not_applicable') return null;
  return (
    `The tax audit report for FY ${financialYear} is not filed yet ` +
    `(${TAX_AUDIT_STAGE_LABEL[stage]}); the ITR waits on it.`
  );
}

/** Why the IT_TAX_AUDIT filing cannot be lodged from the filing itself, or null. */
export function reportLodgeReason(stage: TaxAuditStage): string | null {
  if (stage === 'not_started' || stage === 'client_accepted') return null;
  if (stage === 'filed' || stage === 'not_applicable') return null;
  return (
    `The tax audit report is at ${TAX_AUDIT_STAGE_LABEL[stage]}: ` +
    'sign it, upload it and record the client’s acceptance on the Tax audit tab first.'
  );
}

export interface TaxAuditFileRef {
  id: string;
  title: string;
}

export interface TaxAuditRevisionRef {
  id: string;
  revision: number;
  stage: TaxAuditStage;
  filedOn: string | null;
}

/** GET engagements/:id/tax-audits/:auditId/filing */
export interface TaxAuditFiling {
  auditId: string;
  engagementId: string;
  financialYear: string;
  revision: number;
  revisedFromId: string | null;
  revisionReason: string | null;
  stage: TaxAuditStage;
  formType: '3CA' | '3CB' | null;
  signingPartnerId: string | null;
  signingPartnerName: string | null;
  udin: string | null;
  signedAt: string | null;
  signedByName: string | null;
  signedReport: TaxAuditFileRef | null;
  uploadedOn: string | null;
  clientAcceptedOn: string | null;
  clientRejectedOn: string | null;
  clientRejectionReason: string | null;
  filedOn: string | null;
  acknowledgementNo: string | null;
  acknowledgement: TaxAuditFileRef | null;
  /** The year's IT_TAX_AUDIT filing (the original report only). */
  complianceInstanceId: string | null;
  /** What stops the signing Partner signing (F-7's review blockers). */
  signingBlockers: string[];
  /** Every report of the year, oldest first. */
  revisions: TaxAuditRevisionRef[];
  can: {
    sign: boolean;
    withdraw: boolean;
    upload: boolean;
    clientDecision: boolean;
    file: boolean;
    revise: boolean;
  };
  version: number;
}

/** POST …/filing/sign */
export interface SignTaxAuditReportInput {
  udin: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
  version: number;
}

/** POST …/filing/withdraw — the signature, before upload (the UDIN is revoked on the ICAI portal). */
export interface WithdrawTaxAuditSignatureInput {
  reason: string;
  version: number;
}

/** POST …/filing/uploaded */
export interface RecordTaxAuditUploadInput {
  uploadedOn: string;
  version: number;
}

/** POST …/filing/client-accepted */
export interface RecordTaxAuditAcceptanceInput {
  acceptedOn: string;
  version: number;
}

/** POST …/filing/client-rejected */
export interface RecordTaxAuditRejectionInput {
  rejectedOn: string;
  reason: string;
  version: number;
}

/** POST …/filing/filed — the acknowledgement file is optional unless the firm's check needs it. */
export interface FileTaxAuditReportInput {
  acknowledgementNo: string;
  filedOn: string;
  filename?: string;
  contentType?: string;
  contentBase64?: string;
  version: number;
}

/** POST …/filing/revise */
export interface ReviseTaxAuditReportInput {
  reason: string;
  version: number;
}
