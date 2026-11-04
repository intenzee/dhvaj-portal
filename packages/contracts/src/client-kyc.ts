/**
 * Practice Services PS-404 — client KYC and acceptance for non-audit clients.
 * ICAI's KYC norms for members in practice expect the firm to know its
 * client — who it is, where it is, who owns and runs it — before it takes the
 * work on. Statutory audit has its own acceptance; this is every other client.
 * A client with no KYC on file is pending; a complete one expires when its
 * periodic review falls due (high risk every year, others every three — a
 * firm setting).
 */

export const KYC_STATUSES = ['pending', 'complete', 'expired'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export const KYC_STATUS_LABEL: Record<KycStatus, string> = {
  pending: 'Pending',
  complete: 'Complete',
  expired: 'Review due',
};

export const KYC_RISK_RATINGS = ['low', 'medium', 'high'] as const;
export type KycRiskRating = (typeof KYC_RISK_RATINGS)[number];
export const KYC_RISK_LABEL: Record<KycRiskRating, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * What a new non-audit engagement does for a client whose KYC is not
 * complete: nothing, warn (the default — a firm starting out has no KYC on
 * file yet), or require it, with a partner's override and reason.
 */
export const KYC_GATES = ['off', 'warn', 'require'] as const;
export type KycGate = (typeof KYC_GATES)[number];
export const KYC_GATE_LABEL: Record<KycGate, string> = {
  off: 'Off — no check',
  warn: 'Warn — show it, let the engagement be created',
  require: 'Require — a partner overrides with a reason',
};

/** The 409 rule a new engagement answers with when the gate requires KYC. */
export const KYC_RULE = 'CLIENT_KYC_PENDING';

/** The document requirement template the KYC checklist reads (catalogue_templates). */
export const KYC_CHECKLIST_TEMPLATE_CODE = 'DOC_CLIENT_KYC';

export interface BeneficialOwner {
  name: string;
  pan: string | null;
  /** Holding or interest, %, as a decimal string. */
  holdingPercent: string | null;
  /** Shareholder, partner, settlor, controlling person … */
  role: string | null;
}

export interface KycChecklistItem {
  code: string;
  label: string;
  mandatory: boolean;
  done: boolean;
}

export interface KycSettings {
  gate: KycGate;
  reviewYearsHigh: number;
  reviewYearsOther: number;
  version: number;
}

export interface ClientKyc {
  entityId: string;
  entityName: string;
  /** Effective: a complete KYC past its review date is `expired`. */
  status: KycStatus;
  /** False while nothing has been saved for the client. */
  onFile: boolean;
  panVerified: boolean;
  panVerifiedOn: string | null;
  addressProofDocumentId: string | null;
  identityProofDocumentIds: string[];
  beneficialOwners: BeneficialOwner[];
  riskRating: KycRiskRating | null;
  checklist: KycChecklistItem[];
  notes: string | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedOn: string | null;
  nextReviewOn: string | null;
  /** 0 while nothing is on file. */
  version: number;
  settings: Pick<KycSettings, 'gate' | 'reviewYearsHigh' | 'reviewYearsOther'>;
  can: { edit: boolean; complete: boolean };
}

export interface SaveClientKycInput {
  panVerified?: boolean;
  panVerifiedOn?: string | null;
  addressProofDocumentId?: string | null;
  identityProofDocumentIds?: string[];
  beneficialOwners?: BeneficialOwner[];
  riskRating?: KycRiskRating | null;
  /** Item code → done. */
  checklist?: Record<string, boolean>;
  notes?: string | null;
  /** 0 for the first save. */
  version: number;
}

export interface CompleteClientKycInput {
  /** Default today. */
  reviewedOn?: string;
  version: number;
}

export interface UpdateKycSettingsInput {
  gate?: KycGate;
  reviewYearsHigh?: number;
  reviewYearsOther?: number;
  version: number;
}

export interface KycRegisterRow {
  entityId: string;
  entityCode: string;
  entityName: string;
  officeName: string | null;
  status: KycStatus;
  riskRating: KycRiskRating | null;
  reviewedOn: string | null;
  nextReviewOn: string | null;
}

export interface KycRegisterResponse {
  items: KycRegisterRow[];
  total: number;
  counts: Record<KycStatus, number>;
}

/** The years to the next review for a risk rating. */
export function kycReviewYears(
  risk: KycRiskRating,
  s: Pick<KycSettings, 'reviewYearsHigh' | 'reviewYearsOther'>,
): number {
  return risk === 'high' ? s.reviewYearsHigh : s.reviewYearsOther;
}

/**
 * The next review date: the review date plus the rating's years, on the
 * same day of the month (29 February falls back to the 28th).
 */
export function kycNextReviewOn(
  reviewedOn: string,
  risk: KycRiskRating,
  s: Pick<KycSettings, 'reviewYearsHigh' | 'reviewYearsOther'>,
): string {
  const [y, m, d] = reviewedOn.split('-').map(Number) as [number, number, number];
  const year = y + kycReviewYears(risk, s);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The status as of today: a complete KYC whose review date has come is due again. */
export function kycEffectiveStatus(
  stored: 'pending' | 'complete' | null,
  nextReviewOn: string | null,
  today: string,
): KycStatus {
  if (stored !== 'complete') return 'pending';
  return nextReviewOn && nextReviewOn <= today ? 'expired' : 'complete';
}

/** What stops the KYC being marked complete (empty when it can be). */
export function kycCompleteProblems(k: {
  panVerified: boolean;
  riskRating: KycRiskRating | null;
  checklist: KycChecklistItem[];
}): string[] {
  const out: string[] = [];
  if (!k.panVerified) out.push('Verify the PAN on the income-tax portal.');
  if (!k.riskRating) out.push('Rate the client’s risk.');
  const open = k.checklist.filter((i) => i.mandatory && !i.done);
  if (open.length) out.push(`Still to collect: ${open.map((i) => i.label).join('; ')}.`);
  return out;
}
