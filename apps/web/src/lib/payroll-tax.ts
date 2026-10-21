import type { ExitStatus, ProofHead, ProofStatus, TaxDeclarationAmounts } from '@hsdg/contracts';

/** Payroll 2b screens: declarations, proofs, Forms 138 and 130, full and final, bonus. */

/** The tax year a date falls in, labelled by its start year (Oct 2026 → 2026, Feb 2027 → 2026). */
export function taxYearNow(now = new Date()): number {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

/** 2026 → '2026-27'. */
export const taxYearLabel = (year: number): string =>
  `${year}-${String((year + 1) % 100).padStart(2, '0')}`;

export const PROOF_HEAD_LABEL: Record<ProofHead, string> = {
  rent: 'Rent (year’s receipts)',
  lta: 'Leave travel',
  section80C: '80C (PF, PPF, LIC, ELSS, tuition…)',
  section80CCD1B: '80CCD(1B) — NPS',
  section80DSelf: '80D — self and family',
  section80DParents: '80D — parents',
  homeLoanInterest: 'Home-loan interest',
  section80E: '80E — education loan',
  section80G: '80G — donations',
  section80TTA: '80TTA — savings interest',
};

export const PROOF_STATUS_TONE: Record<ProofStatus, string> = {
  submitted: 'warn',
  accepted: 'success',
  rejected: 'danger',
};

export const EXIT_STATUS_LABEL: Record<ExitStatus | 'not_started', string> = {
  not_started: 'Not started',
  draft: 'Being prepared',
  submitted: 'Waiting for approval',
  approved: 'Approved',
};

export const EXIT_STATUS_TONE: Record<ExitStatus | 'not_started', string> = {
  not_started: 'danger',
  draft: 'neutral',
  submitted: 'warn',
  approved: 'success',
};

/** The declaration's money fields, in the order a person thinks of them; old regime only unless `both`. */
export const DECLARATION_FIELDS: {
  key: keyof TaxDeclarationAmounts;
  label: string;
  hint?: string;
  both?: boolean;
}[] = [
  {
    key: 'rentMonthly',
    label: 'Rent paid a month',
    hint: 'For HRA. Landlord’s PAN is needed above ₹1 lakh a year.',
  },
  { key: 'lta', label: 'Leave travel claimed' },
  {
    key: 'section80C',
    label: '80C',
    hint: 'PF is counted from payroll; enter the rest (cap ₹1.5 lakh).',
  },
  { key: 'section80CCD1B', label: '80CCD(1B) — own NPS', hint: 'Up to ₹50,000.' },
  { key: 'section80DSelf', label: '80D — self and family' },
  { key: 'section80DParents', label: '80D — parents' },
  { key: 'homeLoanInterest', label: 'Home-loan interest (self-occupied)', hint: 'Up to ₹2 lakh.' },
  { key: 'section80E', label: '80E — education-loan interest' },
  { key: 'section80G', label: '80G — qualifying donations' },
  { key: 'section80TTA', label: '80TTA — savings-account interest' },
  {
    key: 'otherIncome',
    label: 'Other income to tax here',
    hint: 'Interest and the like you want deducted through salary.',
    both: true,
  },
];

/** Read a File as base64 (without the data: prefix) and its content type. */
export function readFileBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        base64: result.slice(result.indexOf(',') + 1),
        contentType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  });
}

/** A typed amount, or null when it is not one ('', '12.345', '-1'). */
export function amountOrNull(raw: string): string | null {
  const v = raw.trim().replace(/,/g, '');
  return /^\d{1,12}(\.\d{1,2})?$/.test(v) ? v : null;
}
