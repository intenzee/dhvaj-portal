/**
 * Practice Services PS-402 — the certificates desk. A certificate (Form 146 /
 * 15CB, net worth, turnover, utilisation, visa, bank) is a lightweight flow on
 * an Assignment engagement: pick a template, fill its figures, review,
 * partner signs with a UDIN, issue the PDF. Templates are versioned data
 * (hsdg.certificate_templates), so a new form or wording is a new version.
 */

export const CERTIFICATE_STATUS = {
  draft: 'draft',
  inReview: 'in_review',
  signed: 'signed',
  issued: 'issued',
  revoked: 'revoked',
} as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUS)[keyof typeof CERTIFICATE_STATUS];
export const CERTIFICATE_STATUSES: CertificateStatus[] = Object.values(CERTIFICATE_STATUS);

export const CERTIFICATE_STATUS_LABEL: Record<CertificateStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  signed: 'Signed',
  issued: 'Issued',
  revoked: 'Revoked',
};

export type CertificateVariableType =
  | 'text'
  | 'longtext'
  | 'amount'
  | 'number'
  | 'percent'
  | 'date'
  | 'pan'
  | 'yesno';

export interface CertificateVariable {
  key: string;
  label: string;
  type: CertificateVariableType;
  required: boolean;
  help?: string;
}

/** A figure the template works out from two others: `target` = `minuend` − `subtrahend`. */
export interface CertificateCheck {
  type: 'difference';
  target: string;
  minuend: string;
  subtrahend: string;
}

export interface CertificateTemplate {
  code: string;
  name: string;
  version: number;
  effectiveFrom: string;
  /** The prescribed form the certificate is (Form 146), or null for a free-form certificate. */
  formLabel: string | null;
  /** The law the template cites, as printed. */
  legalRef: string | null;
  /** 'verify' until a partner confirms the template against the current law. */
  verification: 'verified' | 'verify';
  variables: CertificateVariable[];
  checks: CertificateCheck[];
  /** Paragraphs with {{key}} placeholders. */
  body: string;
  /** Form 146 / 15CB: the Form 145 / 15CA acknowledgement is recorded after filing. */
  recordsForm15ca: boolean;
}

export type CertificateFigures = Record<string, string>;

export interface Certificate {
  id: string;
  engagementId: string;
  engagementCode: string;
  entityId: string;
  entityName: string;
  templateCode: string;
  templateName: string;
  templateVersion: number;
  formLabel: string | null;
  certificateNo: string | null;
  purpose: string;
  addressee: string;
  figures: CertificateFigures;
  status: CertificateStatus;
  preparedBy: { id: string; name: string } | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  signingPartner: { id: string; name: string; membershipNo: string | null } | null;
  signedOn: string | null;
  udin: string | null;
  issuedOn: string | null;
  documentId: string | null;
  form15caAckNo: string | null;
  form15caFiledOn: string | null;
  revokedReason: string | null;
  revokedAt: string | null;
  createdAt: string;
  version: number;
  /** What the caller may do next. */
  can: {
    edit: boolean;
    submit: boolean;
    review: boolean;
    sign: boolean;
    issue: boolean;
    revoke: boolean;
    recordForm15ca: boolean;
  };
}

export interface CertificateRegisterRow {
  id: string;
  certificateNo: string | null;
  templateCode: string;
  templateName: string;
  formLabel: string | null;
  entityId: string;
  entityName: string;
  engagementId: string;
  engagementCode: string;
  purpose: string;
  addressee: string;
  status: CertificateStatus;
  signingPartnerName: string | null;
  signedOn: string | null;
  udin: string | null;
  issuedOn: string | null;
  form15caAckNo: string | null;
}

export interface CreateCertificateInput {
  templateCode: string;
  purpose: string;
  addressee: string;
  figures: CertificateFigures;
  /** The date the template version is chosen on (default today). */
  asOnDate?: string;
}
export interface UpdateCertificateInput {
  purpose?: string;
  addressee?: string;
  figures?: CertificateFigures;
  version: number;
}
export interface ReviewCertificateInput {
  decision: 'approve' | 'return';
  note?: string;
  version: number;
}
export interface SignCertificateInput {
  udin: string;
  signedOn?: string;
  udinGeneratedOn?: string;
  version: number;
}
export interface RevokeCertificateInput {
  reason: string;
  version: number;
}
export interface RecordForm15caInput {
  ackNo: string;
  filedOn: string;
  version: number;
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;

/** The figures, trimmed, or what is wrong with them (key → message). */
export function checkCertificateFigures(
  template: Pick<CertificateTemplate, 'variables' | 'checks'>,
  raw: CertificateFigures,
): { figures: CertificateFigures; errors: Record<string, string> } {
  const figures: CertificateFigures = {};
  const errors: Record<string, string> = {};
  const known = new Set(template.variables.map((v) => v.key));
  for (const key of Object.keys(raw ?? {})) {
    if (!known.has(key)) errors[key] = 'Not a field of this certificate.';
  }
  for (const v of template.variables) {
    let value = String(raw?.[v.key] ?? '').trim();
    if (!value) {
      if (v.required) errors[v.key] = `${v.label} is required.`;
      continue;
    }
    if (v.type === 'amount' || v.type === 'number' || v.type === 'percent') {
      value = value.replace(/,/g, '');
      if (!DECIMAL.test(value)) {
        errors[v.key] = `${v.label} must be a number (up to 2 decimals).`;
        continue;
      }
      if (v.type === 'percent' && (Number(value) < 0 || Number(value) > 100)) {
        errors[v.key] = `${v.label} must be between 0 and 100.`;
        continue;
      }
    } else if (v.type === 'date') {
      if (!DATE.test(value) || Number.isNaN(Date.parse(value))) {
        errors[v.key] = `${v.label} must be a date (YYYY-MM-DD).`;
        continue;
      }
    } else if (v.type === 'pan') {
      value = value.toUpperCase();
      if (!PAN.test(value)) {
        errors[v.key] = `${v.label} must be a PAN (AAAAA9999A).`;
        continue;
      }
    } else if (v.type === 'yesno') {
      const yn = value.toLowerCase();
      if (yn !== 'yes' && yn !== 'no') {
        errors[v.key] = `${v.label} must be Yes or No.`;
        continue;
      }
      value = yn === 'yes' ? 'Yes' : 'No';
    } else if (value.length > (v.type === 'longtext' ? 4000 : 300)) {
      errors[v.key] = `${v.label} is too long.`;
      continue;
    }
    figures[v.key] = value;
  }
  for (const c of template.checks ?? []) {
    const [t, a, b] = [figures[c.target], figures[c.minuend], figures[c.subtrahend]];
    if (t === undefined || a === undefined || b === undefined || errors[c.target]) continue;
    const paise = (s: string) => Math.round(Number(s) * 100);
    if (paise(t) !== paise(a) - paise(b)) {
      const label = (k: string) => template.variables.find((v) => v.key === k)?.label ?? k;
      errors[c.target] = `${label(c.target)} must equal ${label(c.minuend)} less ${label(c.subtrahend)} (${(
        (paise(a) - paise(b)) /
        100
      ).toFixed(2)}).`;
    }
  }
  return { figures, errors };
}

/** The template's body with each {{key}} filled in (a missing figure prints as a blank). */
export function fillCertificateBody(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => values[k] ?? '________');
}
