import { fromPaise, toPaise } from './billing';

// ── Payroll (docs/accountant-hr-roles-spec.md §4.8, §7.6) ───────────────

export const PAY_KINDS = ['salary', 'stipend'] as const;
/** Salaries and articles' stipends run as separate registers in the same cycle. */
export type PayKind = (typeof PAY_KINDS)[number];

export const STRUCTURE_STATUSES = ['proposed', 'approved', 'rejected'] as const;
export type StructureStatus = (typeof STRUCTURE_STATUSES)[number];

/** Draft → Computed → Submitted → Approved → Paid → Locked (Submitted may return to Computed). */
export const PAYROLL_RUN_STATUSES = [
  'draft',
  'computed',
  'submitted',
  'approved',
  'paid',
  'locked',
] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_INPUT_KINDS = [
  'arrears',
  'incentive',
  'bonus',
  'reimbursement',
  'advance_recovery',
  'other_deduction',
  'tds',
] as const;
/** One-off monthly inputs HR enters for a person. */
export type PayrollInputKind = (typeof PAYROLL_INPUT_KINDS)[number];

export const STATUTORY_KINDS = ['pf', 'esi', 'pt', 'tds'] as const;
export type StatutoryKind = (typeof STATUTORY_KINDS)[number];

/** One earning in a structure, as a monthly amount. */
export interface PayComponent {
  /** Stable code, e.g. basic, hra, special. */
  code: string;
  label: string;
  /** Monthly amount, rupees ('25000.00'). */
  monthly: string;
  /** Counts as "wages" for PF and gratuity (basic, DA, retaining allowance). */
  pfWage?: boolean;
}

/** A person's pay from an effective date. Only an approved structure is paid. */
export interface SalaryStructureInput {
  kind: PayKind;
  /** Annual cost to the firm, for the record (the engine pays from components). */
  ctc: string;
  components: PayComponent[];
  /** PF applies (false: an excluded employee who joined above the ceiling). */
  pfApplicable: boolean;
  /** ESI applies when their wages are within the threshold. */
  esiApplicable: boolean;
  /** PT applies (false: exempt, e.g. a person with a disability). */
  ptApplicable: boolean;
}

/** One professional-tax slab on monthly gross; `to` null = and above. */
export interface PtSlab {
  from: string;
  to: string | null;
  amount: string;
  /** What February takes instead (Maharashtra: ₹300 in place of ₹200). */
  february?: string;
}

/**
 * Statutory rates as in force on the run's date. Settings, not code (§4.8):
 * HR confirms them each April. Rates are percents ('12', '0.75').
 */
export interface PaySettings {
  pf: {
    employeeRate: string;
    employerRate: string;
    /** Of the employer share, what goes to the pension scheme, on wages up to the ceiling. */
    epsRate: string;
    wageCeiling: string;
    /** The firm contributes on full PF wages, not just up to the ceiling. */
    onFullWages: boolean;
  };
  esi: {
    employeeRate: string;
    employerRate: string;
    /** Monthly gross at or below which a person is covered. */
    grossThreshold: string;
  };
  /** PT slabs for the state the person works in. */
  ptSlabs: PtSlab[];
  /** Gratuity provision on PF wages (15/26 of a month a year ≈ 4.81%). */
  gratuityRate: string;
  /** Labour Codes (21 Nov 2025): wages are at least half of total pay. */
  labourCodeWages: boolean;
  /** Stipends carry PF, ESI and PT (decision 9.13; default no). */
  stipendDeductions: boolean;
}

/** A person's month: who they are on the calendar, and what HR entered. */
export interface PayMonthInput {
  /** 'YYYY-MM'. */
  month: string;
  /** Joined this month ('YYYY-MM-DD'), else null. */
  joinedOn?: string | null;
  /** Left this month ('YYYY-MM-DD', their last day), else null. */
  exitedOn?: string | null;
  lossOfPayDays: number;
  /** One-off inputs; tds is HR's figure until the tax engine (phase 2b) projects it. */
  inputs: { kind: PayrollInputKind; amount: string; note?: string }[];
  /**
   * Was covered by ESI at the start of this contribution period (April–September,
   * October–March): they stay covered for the period even if pay rises above
   * the threshold.
   */
  esiContinuing?: boolean;
}

export type PayLineItemKind = 'earning' | 'reimbursement' | 'deduction' | 'employer';

export interface PayLineItem {
  kind: PayLineItemKind;
  code: string;
  label: string;
  amount: string;
}

/** What the engine returns for one person and month — stored with its inputs. */
export interface PayLine {
  kind: PayKind;
  daysInMonth: number;
  /** Days on the rolls this month, before loss of pay. */
  daysEmployed: number;
  payableDays: number;
  lossOfPayDays: number;
  items: PayLineItem[];
  gross: string;
  reimbursements: string;
  deductions: string;
  employerCost: string;
  net: string;
  pfWages: string;
  esiWages: string;
  /** Plain-language warnings for HR (none of them stop the run). */
  warnings: string[];
}

// ── The engine ───────────────────────────────────────────────────────────

const RUPEE = 100n;

/** A percent as hundredths ('12' → 1200n, '0.75' → 75n). */
function pct(rate: string): bigint {
  const v = toPaise(rate);
  if (v < 0n || v > 10000n) throw new Error(`Not a rate: ${rate}`);
  return v;
}

/** a × b / d to the nearest paisa, half up (non-negative a, b; positive d). */
function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b * 2n + d) / (2n * d);
}

/** To the nearest rupee, half up. */
function roundRupee(p: bigint): bigint {
  return ((p * 2n + RUPEE) / (2n * RUPEE)) * RUPEE;
}

/** Up to the next whole rupee (ESI). */
function ceilRupee(p: bigint): bigint {
  return ((p + RUPEE - 1n) / RUPEE) * RUPEE;
}

/** Days in a 'YYYY-MM' month. */
export function daysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Not a month: ${month}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

function dayOf(date: string, month: string): number {
  if (!date.startsWith(`${month}-`)) throw new Error(`${date} is not in ${month}`);
  return Number(date.slice(8, 10));
}

/** The PT slab for a monthly gross, February taking its own amount. */
export function professionalTax(slabs: PtSlab[], grossPaise: bigint, month: string): bigint {
  const feb = month.endsWith('-02');
  for (const s of slabs) {
    const from = toPaise(s.from);
    const to = s.to === null ? null : toPaise(s.to);
    if (grossPaise >= from && (to === null || grossPaise <= to)) {
      return toPaise(feb && s.february ? s.february : s.amount);
    }
  }
  return 0n;
}

/**
 * Compute one person's pay for a month. Pure: the same structure, month and
 * settings always give the same line, so any line can be recomputed and
 * explained (§7.6).
 */
export function computePayLine(
  structure: SalaryStructureInput,
  month: PayMonthInput,
  settings: PaySettings,
): PayLine {
  const dim = daysInMonth(month.month);
  const first = month.joinedOn ? dayOf(month.joinedOn, month.month) : 1;
  const last = month.exitedOn ? dayOf(month.exitedOn, month.month) : dim;
  if (last < first) throw new Error('The exit date is before the joining date.');
  const daysEmployed = last - first + 1;
  if (month.lossOfPayDays < 0 || month.lossOfPayDays > daysEmployed) {
    throw new Error(`Loss-of-pay days must be between 0 and ${daysEmployed}.`);
  }
  const payableDays = daysEmployed - month.lossOfPayDays;
  const items: PayLineItem[] = [];
  const warnings: string[] = [];
  const add = (kind: PayLineItemKind, code: string, label: string, p: bigint) => {
    if (p !== 0n) items.push({ kind, code, label, amount: fromPaise(p) });
  };

  // Earnings, for the days payable.
  let gross = 0n;
  let wagesFromComponents = 0n;
  for (const c of structure.components) {
    const full = toPaise(c.monthly);
    const paid = payableDays === dim ? full : roundRupee(mulDiv(full, BigInt(payableDays), BigInt(dim)));
    add('earning', c.code, c.label, paid);
    gross += paid;
    if (c.pfWage) wagesFromComponents += paid;
  }

  const sumInputs = (kind: PayrollInputKind) =>
    month.inputs.filter((i) => i.kind === kind).reduce((s, i) => s + toPaise(i.amount), 0n);
  const arrears = sumInputs('arrears');
  const incentive = sumInputs('incentive');
  const bonus = sumInputs('bonus');
  const reimbursement = sumInputs('reimbursement');
  add('earning', 'arrears', 'Arrears', arrears);
  add('earning', 'incentive', 'Incentive', incentive);
  add('earning', 'bonus', 'Bonus', bonus);
  add('reimbursement', 'reimbursement', 'Reimbursements', reimbursement);
  gross += arrears + incentive + bonus;

  // Wages for PF: the wage components; under the Labour Codes, at least half of pay.
  let pfWages = wagesFromComponents;
  const regularPay = gross - arrears - bonus;
  if (settings.labourCodeWages && regularPay > 0n && pfWages * 2n < regularPay) {
    pfWages = (regularPay + 1n) / 2n;
    warnings.push(
      'Allowances are more than half of pay: wages for PF and gratuity are raised to half of pay (Labour Codes).',
    );
  }
  // ESI wages leave out reimbursements and annual bonus.
  const esiWages = gross - bonus;

  const statutory = structure.kind === 'salary' || settings.stipendDeductions;
  let pfEmployee = 0n;
  let esiEmployee = 0n;
  let pt = 0n;
  let employerCost = 0n;

  if (statutory && structure.pfApplicable && pfWages > 0n) {
    const ceiling = toPaise(settings.pf.wageCeiling);
    const base = settings.pf.onFullWages ? pfWages : pfWages < ceiling ? pfWages : ceiling;
    pfEmployee = roundRupee(mulDiv(base, pct(settings.pf.employeeRate), 10000n));
    const employer = roundRupee(mulDiv(base, pct(settings.pf.employerRate), 10000n));
    const epsBase = pfWages < ceiling ? pfWages : ceiling;
    const eps = roundRupee(mulDiv(epsBase, pct(settings.pf.epsRate), 10000n));
    const epsShare = eps < employer ? eps : employer;
    add('deduction', 'pf', 'Provident fund', pfEmployee);
    add('employer', 'pf_epf', 'Employer PF (EPF)', employer - epsShare);
    add('employer', 'pf_eps', 'Employer PF (pension)', epsShare);
    employerCost += employer;
  }

  if (statutory && structure.esiApplicable) {
    const threshold = toPaise(settings.esi.grossThreshold);
    const covered = esiWages <= threshold || month.esiContinuing === true;
    if (covered && esiWages > 0n) {
      esiEmployee = ceilRupee(mulDiv(esiWages, pct(settings.esi.employeeRate), 10000n));
      const employer = ceilRupee(mulDiv(esiWages, pct(settings.esi.employerRate), 10000n));
      add('deduction', 'esi', 'ESI', esiEmployee);
      add('employer', 'esi', 'Employer ESI', employer);
      employerCost += employer;
      if (esiWages > threshold) {
        warnings.push('Pay is above the ESI threshold; ESI continues to the end of this contribution period.');
      }
    }
  }

  if (statutory && structure.ptApplicable) {
    pt = professionalTax(settings.ptSlabs, gross, month.month);
    add('deduction', 'pt', 'Professional tax', pt);
  }

  if (structure.kind === 'salary' && pfWages > 0n) {
    const gratuity = roundRupee(mulDiv(pfWages, pct(settings.gratuityRate), 10000n));
    add('employer', 'gratuity', 'Gratuity provision', gratuity);
    employerCost += gratuity;
  }

  const tds = sumInputs('tds');
  const advance = sumInputs('advance_recovery');
  const other = sumInputs('other_deduction');
  add('deduction', 'tds', 'Income tax (TDS)', tds);
  add('deduction', 'advance_recovery', 'Advance recovery', advance);
  add('deduction', 'other', 'Other deductions', other);

  const deductions = pfEmployee + esiEmployee + pt + tds + advance + other;
  const net = gross + reimbursement - deductions;
  if (net < 0n) warnings.push('Deductions are more than pay: net pay is negative.');
  if (month.lossOfPayDays > 0) warnings.push(`${month.lossOfPayDays} loss-of-pay day(s).`);

  return {
    kind: structure.kind,
    daysInMonth: dim,
    daysEmployed,
    payableDays,
    lossOfPayDays: month.lossOfPayDays,
    items,
    gross: fromPaise(gross),
    reimbursements: fromPaise(reimbursement),
    deductions: fromPaise(deductions),
    employerCost: fromPaise(employerCost + gross),
    net: fromPaise(net),
    pfWages: fromPaise(pfWages),
    esiWages: fromPaise(esiWages),
    warnings,
  };
}

/**
 * Arrears when a revision is dated back into months already paid: for each
 * such month, the difference between what the new and the old structure pay
 * for the days that were payable. Statutory deductions on arrears fall in the
 * month the arrears are paid.
 */
export function revisionArrears(
  before: PayComponent[],
  after: PayComponent[],
  paidMonths: { month: string; payableDays: number }[],
): string {
  const monthly = (cs: PayComponent[]) => cs.reduce((s, c) => s + toPaise(c.monthly), 0n);
  const diff = monthly(after) - monthly(before);
  let total = 0n;
  for (const m of paidMonths) {
    const dim = daysInMonth(m.month);
    const share =
      m.payableDays === dim ? diff : diff < 0n
        ? -roundRupee(mulDiv(-diff, BigInt(m.payableDays), BigInt(dim)))
        : roundRupee(mulDiv(diff, BigInt(m.payableDays), BigInt(dim)));
    total += share;
  }
  return fromPaise(total);
}

/** The stipend floor check (ICAI minimum for the office's city class). */
export function stipendBelowMinimum(monthly: string, minimum: string): boolean {
  return toPaise(monthly) < toPaise(minimum);
}

/** Allowed run transitions (§4.8); the database trigger holds the same list. */
export const PAYROLL_RUN_TRANSITIONS: Record<PayrollRunStatus, PayrollRunStatus[]> = {
  draft: ['computed'],
  computed: ['computed', 'submitted', 'draft'],
  submitted: ['approved', 'computed'],
  approved: ['paid'],
  paid: ['locked'],
  locked: [],
};

/**
 * The seeded statutory defaults (§4.8 table) — HR confirms them each April.
 * PT here is Maharashtra's (men; ₹300 in February); other states are added in
 * settings.
 */
export const DEFAULT_PAY_SETTINGS: PaySettings = {
  pf: {
    employeeRate: '12',
    employerRate: '12',
    epsRate: '8.33',
    wageCeiling: '15000',
    onFullWages: false,
  },
  esi: { employeeRate: '0.75', employerRate: '3.25', grossThreshold: '21000' },
  ptSlabs: [
    { from: '0', to: '7500', amount: '0' },
    { from: '7500.01', to: '10000', amount: '175' },
    { from: '10000.01', to: null, amount: '200', february: '300' },
  ],
  gratuityRate: '4.81',
  labourCodeWages: true,
  stipendDeductions: false,
};

// ── API shapes ───────────────────────────────────────────────────────────

export interface SalaryStructure extends SalaryStructureInput {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  status: StructureStatus;
  proposedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
  /** Stipend under the ICAI minimum kept in settings. */
  belowStipendMinimum?: boolean;
  /** On HR's lists (not on a person's own view). */
  fullName?: string;
  employeeCode?: string;
  version?: number;
}

export interface ProposeStructureInput extends SalaryStructureInput {
  employeeId: string;
  effectiveFrom: string;
  note?: string;
}

export interface PayrollRunSummary {
  id: string;
  month: string;
  kind: PayKind;
  status: PayrollRunStatus;
  people: number;
  gross: string;
  deductions: string;
  employerCost: string;
  net: string;
  preparedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  returnedReason: string | null;
  bankReference: string | null;
  paidAt: string | null;
  payslipsReleasedAt: string | null;
  version: number;
}

export interface PayrollRunLine extends PayLine {
  id: string;
  employeeId: string;
  employeeCode: string;
  displayName: string;
  /** The bank account changed since the last paid run. */
  bankChanged: boolean;
}

/** What the Managing Partner reads to approve (§4.8 "Changes from last month"). */
export interface PayrollRunChanges {
  joiners: string[];
  leavers: string[];
  revisions: string[];
  lossOfPay: string[];
  bankChanged: string[];
  netChange: string;
}

export interface PayrollRunDetail extends PayrollRunSummary {
  lines: PayrollRunLine[];
  changes: PayrollRunChanges;
  /** Run-level notes: people with no approved structure, mid-month revisions. */
  warnings: string[];
}

/** Run totals only — what the Accountant books from (decision 9.11). */
export interface PayrollRunTotals {
  id: string;
  month: string;
  kind: PayKind;
  status: PayrollRunStatus;
  people: number;
  earnings: { code: string; label: string; amount: string }[];
  deductions: { code: string; label: string; amount: string }[];
  employer: { code: string; label: string; amount: string }[];
  reimbursements: string;
  gross: string;
  net: string;
  bankReference: string | null;
  paidAt: string | null;
}

/** Bank, PAN and statutory numbers — masked unless revealed (audited). */
export interface EmployeePayDetails {
  employeeId: string;
  accountHolder: string | null;
  accountMasked: string | null;
  ifsc: string | null;
  bankName: string | null;
  panMasked: string | null;
  uan: string | null;
  esiNumber: string | null;
  aadhaarLast4: string | null;
  updatedAt: string | null;
}

export interface SetPayDetailsInput {
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName?: string;
  pan?: string;
  uan?: string;
  esiNumber?: string;
  aadhaarLast4?: string;
}

export type BankChangeStatus = 'requested' | 'verified' | 'rejected';

export interface BankChangeRequest {
  id: string;
  employeeId: string;
  displayName: string;
  accountHolder: string;
  accountMasked: string;
  ifsc: string;
  status: BankChangeStatus;
  requestedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  reason: string | null;
}

export interface StatutoryWorking {
  month: string;
  kind: StatutoryKind;
  /** Employee share + employer share. */
  employee: string;
  employer: string;
  total: string;
  people: number;
  dueOn: string;
  challanNumber: string | null;
  paidOn: string | null;
  paidBy: string | null;
}

export interface RecordChallanInput {
  challanNumber: string;
  paidOn: string;
  amount: string;
}

/** A payslip as the person sees it (released only once the run is paid). */
export interface Payslip {
  runId: string;
  month: string;
  kind: PayKind;
  displayName: string;
  employeeCode: string;
  line: PayLine;
  paidAt: string | null;
  bankReference: string | null;
}

/** The stored rules: the engine's settings plus what varies by office (office code →). */
export interface PayRules extends PaySettings {
  ptSlabsByOffice: Record<string, PtSlab[]>;
  stipendMinimumByOffice: Record<string, string>;
}

export interface PaySettingsRecord {
  effectiveFrom: string;
  rules: PayRules;
  confirmedBy: string | null;
}

/** A person on the pay roster: who they are and whether they can be paid. */
export interface PayRosterRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  officeCode: string;
  grade: string | null;
  status: string;
  dateOfJoining: string;
  dateOfExit: string | null;
  current: SalaryStructure | null;
  pending: number;
  hasBankAccount: boolean;
  openBankChange: boolean;
}

/** One person's inputs for a month, as HR entered them. */
export interface PayrollMonthInputs {
  employeeId: string;
  lossOfPayDays: number;
  inputs: { kind: PayrollInputKind; amount: string; note: string | null }[];
}

/** A payslip in a person's list. */
export interface PayslipSummary {
  runId: string;
  month: string;
  kind: PayKind;
  net: string;
  paidAt: string | null;
}

/** The entry the Accountant books for a run (balanced: debits = credits). */
export interface PayrollJournal {
  runId: string;
  month: string;
  kind: PayKind;
  entries: { account: string; debit: string; credit: string }[];
  totalDebit: string;
  totalCredit: string;
}

/** Valid IFSC: four letters, a zero, six letters or digits. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** PAN: five letters, four digits, one letter. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** The last four of an account or PAN, the rest masked. */
export function maskTail(value: string): string {
  const v = value.replace(/\s+/g, '');
  return v.length <= 4 ? v : `${'•'.repeat(Math.min(v.length - 4, 8))}${v.slice(-4)}`;
}
