import type { PayLine, PayLineItem } from './payroll';
import type {
  PreviousEmployment,
  ProofHead,
  TaxComputation,
  TaxDeclarationAmounts,
  TaxRegime,
  TdsProjection,
} from './payroll-tax';

// ── Payroll tax and exit, API shapes (spec §4.8, §7.6; phase 2b) ────────

export const PROOF_STATUSES = ['submitted', 'accepted', 'rejected'] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

export interface TaxProof {
  id: string;
  head: ProofHead;
  amount: string;
  filename: string;
  status: ProofStatus;
  acceptedAmount: string | null;
  reason: string | null;
  submittedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** A person's regime and declared amounts for a tax year (2026 = 2026-27). */
export interface TaxDeclaration {
  employeeId: string;
  /** Null until saved once: the defaults (new regime, nothing declared). */
  id: string | null;
  taxYear: number;
  regime: TaxRegime;
  amounts: TaxDeclarationAmounts;
  previousEmployment: PreviousEmployment | null;
  submittedAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  version: number;
  proofs: TaxProof[];
}

export interface SaveTaxDeclarationInput {
  version: number;
  regime: TaxRegime;
  amounts: TaxDeclarationAmounts;
  previousEmployment?: PreviousEmployment | null;
}

export interface SubmitTaxProofInput {
  head: ProofHead;
  amount: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
}

export interface DecideTaxProofInput {
  decision: 'accept' | 'reject';
  /** Accept in part: what the proof supports (default: all of it). */
  acceptedAmount?: string;
  reason?: string;
}

/** HR's list for a tax year: one row a person on the salary rolls. */
export interface TaxDeclarationRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  regime: TaxRegime;
  declared: boolean;
  submittedAt: string | null;
  lockedAt: string | null;
  proofsPending: number;
  proofsAccepted: number;
  /** Projected tax for the year and TDS so far (paid runs). */
  projectedTax: string;
  tdsToDate: string;
}

/** Why this month's TDS is what it is. */
export interface TdsExplanation extends TdsProjection {
  employeeId: string;
  fullName: string;
  basis: 'declared' | 'proved';
}

// ── Form 138 (was 24Q): quarterly TDS-on-salary statement data ───────────

export interface Form138Challan {
  month: string;
  amount: string;
  challanNumber: string | null;
  paidOn: string | null;
  tdsInRuns: string;
}

export interface Form138Deductee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  panMasked: string | null;
  month: string;
  paidOn: string | null;
  amountPaid: string;
  tds: string;
}

export interface Form138Quarter {
  taxYear: number;
  quarter: 1 | 2 | 3 | 4;
  dueOn: string;
  challans: Form138Challan[];
  deductees: Form138Deductee[];
  totals: { amountPaid: string; tds: string; deposited: string };
  /** Plain-language problems to fix before filing (missing PAN, undeposited TDS…). */
  warnings: string[];
}

// ── Form 130 Part B (was Form 16 Part B) ─────────────────────────────────

export interface Form130PartB {
  taxYear: number;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  panMasked: string | null;
  periodFrom: string;
  periodTo: string;
  computation: TaxComputation;
  previousEmployment: PreviousEmployment | null;
  tdsDeducted: string;
  /** Tax payable less TDS: positive is short, negative is excess. */
  balance: string;
  /** Every salary month of the year is paid. */
  final: boolean;
}

// ── Full and final ───────────────────────────────────────────────────────

export const EXIT_STATUSES = ['draft', 'submitted', 'approved'] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];

export interface ExitSettlementInput {
  /** Earned leave left to encash. */
  leaveDays: number;
  /** Notice not served, recovered from the leaver (days). */
  noticeShortfallDays: number;
  /** Notice the firm waives and pays in lieu (days). */
  noticePayDays: number;
  /** HR's override of the gratuity rule, with why (e.g. fixed-term, 4 years 240 days). */
  gratuityOverride?: { eligible: boolean; reason: string } | null;
  otherEarnings: { label: string; amount: string }[];
  otherDeductions: { label: string; amount: string }[];
  note?: string | null;
}

export interface ExitWorking {
  /** The exit month's pay as the run will compute it (null when already paid). */
  lastMonth: PayLine | null;
  gratuity: { eligible: boolean; countedYears: number; amount: string; reason: string };
  /** The settlement's own items, paid with the run of the pay month. */
  items: PayLineItem[];
  /** Tax on the settlement (exempt gratuity and leave encashment left out). */
  tds: string;
  gross: string;
  deductions: string;
  net: string;
  warnings: string[];
}

export interface ExitSettlement {
  id: string | null;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  joinedOn: string;
  exitDate: string;
  /** The Code on Wages: wages due on exit within two working days. */
  dueBy: string;
  payMonth: string;
  status: ExitStatus | 'not_started';
  input: ExitSettlementInput;
  working: ExitWorking | null;
  preparedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  returnedReason: string | null;
  /** The run that paid it, once computed into one. */
  runId: string | null;
  runStatus: string | null;
  version: number;
}

export interface ExitRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  exitDate: string;
  dueBy: string;
  status: ExitStatus | 'not_started';
  net: string | null;
  runStatus: string | null;
}

// ── Statutory bonus ──────────────────────────────────────────────────────

export interface BonusRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  eligible: boolean;
  reason: string;
  bonusWages: string;
  amount: string;
  /** Already added to a month's inputs. */
  appliedMonth: string | null;
}

export interface BonusWorking {
  taxYear: number;
  ratePercent: string;
  minRate: string;
  maxRate: string;
  /** Within eight months of the year's end. */
  dueBy: string;
  rows: BonusRow[];
  total: string;
}

export interface ApplyBonusInput {
  ratePercent: string;
  /** The month whose run pays it ('YYYY-MM'). */
  month: string;
}
