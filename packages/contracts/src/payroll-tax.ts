import { fromPaise, toPaise } from './billing';

// ── Income tax on salary, exits and bonus (Income-tax Act 2025) ─────────
//
// Salary TDS under s.392: the year's tax is projected each month and spread
// over the months left. Form 130 (replacing Form 16) and the quarterly
// Form 138 (replacing 24Q) read from the same computation. Rates, slabs and
// caps are settings, not code: HR confirms them each April and every
// function takes them as a parameter.

export const TAX_REGIMES = ['new', 'old'] as const;
/** The new regime is the default; the old one is the person's choice. */
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** One slab of a regime; `upTo` null = and above. Rate is a percent. */
export interface IncomeTaxSlab {
  upTo: string | null;
  rate: string;
}

export interface RegimeRules {
  slabs: IncomeTaxSlab[];
  standardDeduction: string;
  /** Total income at or below which the rebate applies. */
  rebateLimit: string;
  rebateMax: string;
}

/** Surcharge on total income above `above`. */
export interface SurchargeBand {
  above: string;
  rate: string;
}

export interface TaxRules {
  new: RegimeRules;
  old: RegimeRules;
  cessRate: string;
  surcharge: SurchargeBand[];
  /** The new regime's surcharge stops at this rate. */
  newRegimeSurchargeMax: string;
  caps: {
    section80C: string;
    section80CCD1B: string;
    section80DSelf: string;
    section80DSelfSenior: string;
    section80DParents: string;
    section80DParentsSenior: string;
    homeLoanInterest: string;
    section80TTA: string;
  };
  /** HRA: percent of basic exempt in a metro / elsewhere. */
  hraMetroRate: string;
  hraOtherRate: string;
  gratuityExemption: string;
  leaveEncashmentExemption: string;
  /** Payment of Gratuity (Code on Social Security 2020): 15 days' wages a year, on 26. */
  gratuity: { minYears: number; daysPerYear: number; divisor: number; cap: string };
  leaveEncashment: { basis: 'basic' | 'gross'; divisor: number };
  /** Payment of Bonus: eligible up to the ceiling, worked on wages up to the calculation ceiling. */
  bonus: {
    eligibilityCeiling: string;
    calculationCeiling: string;
    minRate: string;
    maxRate: string;
  };
}

/** The seeded rates for tax year 2026-27 — HR confirms them each April. */
export const DEFAULT_TAX_RULES: TaxRules = {
  new: {
    slabs: [
      { upTo: '400000', rate: '0' },
      { upTo: '800000', rate: '5' },
      { upTo: '1200000', rate: '10' },
      { upTo: '1600000', rate: '15' },
      { upTo: '2000000', rate: '20' },
      { upTo: '2400000', rate: '25' },
      { upTo: null, rate: '30' },
    ],
    standardDeduction: '75000',
    rebateLimit: '1200000',
    rebateMax: '60000',
  },
  old: {
    slabs: [
      { upTo: '250000', rate: '0' },
      { upTo: '500000', rate: '5' },
      { upTo: '1000000', rate: '20' },
      { upTo: null, rate: '30' },
    ],
    standardDeduction: '50000',
    rebateLimit: '500000',
    rebateMax: '12500',
  },
  cessRate: '4',
  surcharge: [
    { above: '5000000', rate: '10' },
    { above: '10000000', rate: '15' },
    { above: '20000000', rate: '25' },
    { above: '50000000', rate: '37' },
  ],
  newRegimeSurchargeMax: '25',
  caps: {
    section80C: '150000',
    section80CCD1B: '50000',
    section80DSelf: '25000',
    section80DSelfSenior: '50000',
    section80DParents: '25000',
    section80DParentsSenior: '50000',
    homeLoanInterest: '200000',
    section80TTA: '10000',
  },
  hraMetroRate: '50',
  hraOtherRate: '40',
  gratuityExemption: '2000000',
  leaveEncashmentExemption: '2500000',
  gratuity: { minYears: 5, daysPerYear: 15, divisor: 26, cap: '2000000' },
  leaveEncashment: { basis: 'basic', divisor: 30 },
  bonus: {
    eligibilityCeiling: '21000',
    calculationCeiling: '7000',
    minRate: '8.33',
    maxRate: '20',
  },
};

/** What a person declares for the year (money strings, '0' when nothing). */
export interface TaxDeclarationAmounts {
  rentMonthly: string;
  metroCity: boolean;
  landlordPanGiven: boolean;
  lta: string;
  section80C: string;
  section80CCD1B: string;
  section80DSelf: string;
  selfSenior: boolean;
  section80DParents: string;
  parentsSenior: boolean;
  homeLoanInterest: string;
  section80E: string;
  section80G: string;
  section80TTA: string;
  /** Interest and other income the person asks to be taxed through salary. */
  otherIncome: string;
}

export const EMPTY_DECLARATION: TaxDeclarationAmounts = {
  rentMonthly: '0',
  metroCity: false,
  landlordPanGiven: false,
  lta: '0',
  section80C: '0',
  section80CCD1B: '0',
  section80DSelf: '0',
  selfSenior: false,
  section80DParents: '0',
  parentsSenior: false,
  homeLoanInterest: '0',
  section80E: '0',
  section80G: '0',
  section80TTA: '0',
  otherIncome: '0',
};

/** The heads that need proof; rent is proved as the year's total. */
export const PROOF_HEADS = [
  'rent',
  'lta',
  'section80C',
  'section80CCD1B',
  'section80DSelf',
  'section80DParents',
  'homeLoanInterest',
  'section80E',
  'section80G',
  'section80TTA',
] as const;
export type ProofHead = (typeof PROOF_HEADS)[number];

/** Salary from an earlier employer this year (Form 130 / the person's statement). */
export interface PreviousEmployment {
  income: string;
  tds: string;
  pf: string;
  pt: string;
}

/** Salary for a span of months, as the tax computation needs it. */
export interface SalaryYear {
  /** All taxable-before-exemption earnings (not reimbursements), incl. HRA, LTA, gratuity, leave encashment. */
  gross: string;
  /** Basic + DA: the salary for HRA's 10% and 40/50%. */
  basic: string;
  /** HRA received. */
  hra: string;
  /** LTA received. */
  lta: string;
  /** Gratuity paid on exit. */
  gratuity: string;
  leaveEncashment: string;
  employeePf: string;
  pt: string;
  /** Months covered (HRA's rent is rent × months). */
  months: number;
}

const MONEY_FIELDS = [
  'gross',
  'basic',
  'hra',
  'lta',
  'gratuity',
  'leaveEncashment',
  'employeePf',
  'pt',
] as const;

export const ZERO_SALARY: SalaryYear = {
  gross: '0.00',
  basic: '0.00',
  hra: '0.00',
  lta: '0.00',
  gratuity: '0.00',
  leaveEncashment: '0.00',
  employeePf: '0.00',
  pt: '0.00',
  months: 0,
};

/** Two spans of salary as one. */
export function addSalary(a: SalaryYear, b: SalaryYear): SalaryYear {
  const out = { ...ZERO_SALARY, months: a.months + b.months };
  for (const f of MONEY_FIELDS) out[f] = fromPaise(toPaise(a[f]) + toPaise(b[f]));
  return out;
}

/** A month's salary over `months` months (monthly × n). */
export function scaleSalary(a: SalaryYear, months: number): SalaryYear {
  if (!Number.isInteger(months) || months < 0) throw new Error(`Not a number of months: ${months}`);
  const n = BigInt(months);
  const out = { ...ZERO_SALARY, months: a.months * months };
  for (const f of MONEY_FIELDS) out[f] = fromPaise(toPaise(a[f]) * n);
  return out;
}

export interface TaxLine {
  code: string;
  label: string;
  amount: string;
}

/** The year's computation, line by line, as Form 130 sets it out. */
export interface TaxComputation {
  regime: TaxRegime;
  grossSalary: string;
  exemptions: TaxLine[];
  standardDeduction: string;
  professionalTax: string;
  incomeFromSalary: string;
  otherIncome: string;
  grossTotalIncome: string;
  deductions: TaxLine[];
  /** Rounded to the nearest ₹10. */
  totalIncome: string;
  taxOnIncome: string;
  rebate: string;
  surcharge: string;
  cess: string;
  /** Rounded to the nearest rupee. */
  taxPayable: string;
  /** Plain-language notes for HR and the person. */
  notes: string[];
}

// ── Arithmetic ───────────────────────────────────────────────────────────

const RUPEE = 100n;

/** A percent as hundredths ('12' → 1200n, '8.33' → 833n). */
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

/** Total income to the nearest ₹10: paise dropped first, 5 and over up. */
function roundTen(p: bigint): bigint {
  const rupees = p / RUPEE;
  const rest = rupees % 10n;
  return (rupees - rest + (rest >= 5n ? 10n : 0n)) * RUPEE;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max0 = (a: bigint) => (a > 0n ? a : 0n);

/** Tax by slabs on an income in paise. */
function slabTax(slabs: IncomeTaxSlab[], income: bigint): bigint {
  let tax = 0n;
  let from = 0n;
  for (const s of slabs) {
    const to = s.upTo === null ? null : toPaise(s.upTo);
    const top = to === null || income < to ? income : to;
    if (top > from) tax += mulDiv(top - from, pct(s.rate), 10000n);
    if (to === null || income <= to) break;
    from = to;
  }
  return tax;
}

/** Tax on slabs and the rebate (with the new regime's marginal relief above the limit). */
function taxAndRebate(
  r: RegimeRules,
  regime: TaxRegime,
  income: bigint,
): { tax: bigint; rebate: bigint } {
  const tax = slabTax(r.slabs, income);
  const limit = toPaise(r.rebateLimit);
  if (income <= limit) return { tax, rebate: min(tax, toPaise(r.rebateMax)) };
  if (regime === 'new' && tax > income - limit) return { tax, rebate: tax - (income - limit) };
  return { tax, rebate: 0n };
}

/** The surcharge rate (hundredths of a percent) and band threshold for an income. */
function surchargeBand(
  rules: TaxRules,
  regime: TaxRegime,
  income: bigint,
): { rate: bigint; above: bigint } | null {
  const bands = [...rules.surcharge].sort((a, b) => (toPaise(a.above) < toPaise(b.above) ? -1 : 1));
  let hit: SurchargeBand | null = null;
  for (const b of bands) if (income > toPaise(b.above)) hit = b;
  if (!hit) return null;
  let rate = pct(hit.rate);
  if (regime === 'new') rate = min(rate, pct(rules.newRegimeSurchargeMax));
  return { rate, above: toPaise(hit.above) };
}

/**
 * The surcharge with marginal relief: tax and surcharge together may not
 * exceed what they are at the band's threshold plus the income above it.
 */
function surchargeFor(
  rules: TaxRules,
  regime: TaxRegime,
  income: bigint,
  netTax: bigint,
): { surcharge: bigint; relief: boolean } {
  const band = surchargeBand(rules, regime, income);
  if (!band) return { surcharge: 0n, relief: false };
  const surcharge = mulDiv(netTax, band.rate, 10000n);
  const at = taxAndRebate(rules[regime], regime, band.above);
  const atNet = at.tax - at.rebate;
  const below = surchargeBand(rules, regime, band.above);
  const ceiling = atNet + (below ? mulDiv(atNet, below.rate, 10000n) : 0n) + (income - band.above);
  if (netTax + surcharge > ceiling) return { surcharge: max0(ceiling - netTax), relief: true };
  return { surcharge, relief: false };
}

// ── The year's computation ───────────────────────────────────────────────

/**
 * The tax on a year's salary under a regime. Pure: the same salary,
 * declaration, proofs and rules always give the same computation, so it can
 * be stored with the month's TDS and explained line by line.
 */
export function computeAnnualTax(args: {
  /** The whole year, a previous employer's salary folded in by the caller. */
  salary: SalaryYear;
  regime: TaxRegime;
  amounts: TaxDeclarationAmounts;
  /** From January the proofs decide: when given, these (accepted) amounts per head replace what was declared. */
  proved?: Partial<Record<ProofHead, string>> | null;
  rules: TaxRules;
}): TaxComputation {
  const { salary, regime, amounts, rules } = args;
  const proved = args.proved ?? null;
  const r = rules[regime];
  const old = regime === 'old';
  const notes: string[] = [];
  const exemptions: TaxLine[] = [];
  const deductions: TaxLine[] = [];
  const line = (into: TaxLine[], code: string, label: string, p: bigint) => {
    if (p !== 0n) into.push({ code, label, amount: fromPaise(p) });
    return p;
  };
  // A head's claim: what was proved once proofs decide (nothing proved = nil), else what was declared.
  const claim = (head: ProofHead, declared: string) =>
    max0(toPaise(proved ? (proved[head] ?? '0') : declared));

  const gross = toPaise(salary.gross);
  let exempt = 0n;

  // Gratuity and leave encashment on exit: exempt in both regimes up to the limits.
  const gratuity = toPaise(salary.gratuity);
  exempt += line(
    exemptions,
    'gratuity',
    'Gratuity',
    min(gratuity, toPaise(rules.gratuityExemption)),
  );
  const leave = toPaise(salary.leaveEncashment);
  exempt += line(
    exemptions,
    'leave_encashment',
    'Leave encashment on leaving',
    min(leave, toPaise(rules.leaveEncashmentExemption)),
  );
  if (leave > 0n) {
    notes.push(
      'Leave encashment is exempt up to the limit only; the 10-month-average-salary and leave-days limits are for HR to confirm.',
    );
  }

  let pt = 0n;
  if (old) {
    // HRA: the least of HRA received, rent less 10% of basic, and 50% (metro) / 40% of basic.
    const basic = toPaise(salary.basic);
    const rent = proved
      ? claim('rent', '0')
      : max0(toPaise(amounts.rentMonthly)) * BigInt(salary.months);
    if (rent > 0n) {
      const share = mulDiv(
        basic,
        pct(amounts.metroCity ? rules.hraMetroRate : rules.hraOtherRate),
        10000n,
      );
      const overTenth = max0(rent - mulDiv(basic, 1000n, 10000n));
      exempt += line(
        exemptions,
        'hra',
        'House rent allowance',
        max0(min(min(toPaise(salary.hra), overTenth), share)),
      );
      if (rent > toPaise('100000') && !amounts.landlordPanGiven) {
        notes.push(
          "Rent is over ₹1,00,000 for the year: the landlord's PAN is needed for the HRA exemption.",
        );
      }
    }
    // LTA: what was claimed (or proved), up to what was received.
    exempt += line(
      exemptions,
      'lta',
      'Leave travel allowance',
      min(claim('lta', amounts.lta), toPaise(salary.lta)),
    );
    pt = max0(toPaise(salary.pt));
  } else {
    const oldOnly = [
      amounts.rentMonthly,
      amounts.lta,
      amounts.section80C,
      amounts.section80DSelf,
      amounts.homeLoanInterest,
    ];
    if (oldOnly.some((a) => toPaise(a) > 0n)) {
      notes.push(
        'New regime: HRA, LTA, professional tax and Chapter VI-A deductions are not allowed.',
      );
    }
  }

  const afterExemptions = max0(gross - exempt);
  const standard = min(toPaise(r.standardDeduction), afterExemptions);
  const incomeFromSalary = max0(afterExemptions - standard - pt);
  const otherIncome = max0(toPaise(amounts.otherIncome));
  const grossTotalIncome = incomeFromSalary + otherIncome;

  if (old) {
    const caps = rules.caps;
    // 24(b): the loss on a self-occupied house is set off only up to the cap.
    line(
      deductions,
      'home_loan_interest',
      'Interest on housing loan (self-occupied)',
      min(claim('homeLoanInterest', amounts.homeLoanInterest), toPaise(caps.homeLoanInterest)),
    );
    // Employee PF counts toward 80C.
    line(
      deductions,
      '80C',
      'Section 80C (incl. employee PF)',
      min(
        claim('section80C', amounts.section80C) + max0(toPaise(salary.employeePf)),
        toPaise(caps.section80C),
      ),
    );
    line(
      deductions,
      '80CCD1B',
      'Section 80CCD(1B) — NPS',
      min(claim('section80CCD1B', amounts.section80CCD1B), toPaise(caps.section80CCD1B)),
    );
    line(
      deductions,
      '80D_self',
      'Section 80D — self and family',
      min(
        claim('section80DSelf', amounts.section80DSelf),
        toPaise(amounts.selfSenior ? caps.section80DSelfSenior : caps.section80DSelf),
      ),
    );
    line(
      deductions,
      '80D_parents',
      'Section 80D — parents',
      min(
        claim('section80DParents', amounts.section80DParents),
        toPaise(amounts.parentsSenior ? caps.section80DParentsSenior : caps.section80DParents),
      ),
    );
    line(
      deductions,
      '80E',
      'Section 80E — education loan interest',
      claim('section80E', amounts.section80E),
    );
    line(
      deductions,
      '80G',
      'Section 80G — donations (qualifying)',
      claim('section80G', amounts.section80G),
    );
    // 80TTA: savings interest, which is part of other income.
    line(
      deductions,
      '80TTA',
      'Section 80TTA — savings interest',
      min(
        min(claim('section80TTA', amounts.section80TTA), toPaise(caps.section80TTA)),
        otherIncome,
      ),
    );
  }

  const totalDeductions = deductions.reduce((s, d) => s + toPaise(d.amount), 0n);
  const totalIncome = roundTen(max0(grossTotalIncome - totalDeductions));

  const { tax, rebate } = taxAndRebate(r, regime, totalIncome);
  if (regime === 'new' && totalIncome > toPaise(r.rebateLimit) && rebate > 0n) {
    notes.push('Marginal relief: tax is limited to the income above the rebate limit.');
  }
  const netTax = tax - rebate;
  const { surcharge, relief } = surchargeFor(rules, regime, totalIncome, netTax);
  if (relief) notes.push('Marginal relief on surcharge applied.');
  const cess = mulDiv(netTax + surcharge, pct(rules.cessRate), 10000n);
  const taxPayable = roundRupee(netTax + surcharge + cess);

  return {
    regime,
    grossSalary: fromPaise(gross),
    exemptions,
    standardDeduction: fromPaise(standard),
    professionalTax: fromPaise(pt),
    incomeFromSalary: fromPaise(incomeFromSalary),
    otherIncome: fromPaise(otherIncome),
    grossTotalIncome: fromPaise(grossTotalIncome),
    deductions,
    totalIncome: fromPaise(totalIncome),
    taxOnIncome: fromPaise(tax),
    rebate: fromPaise(rebate),
    surcharge: fromPaise(surcharge),
    cess: fromPaise(cess),
    taxPayable: fromPaise(taxPayable),
    notes,
  };
}

// ── Monthly TDS (s.392) ──────────────────────────────────────────────────

export interface TdsProjection {
  month: string;
  regime: TaxRegime;
  /** Tax on the regular pay for the year. */
  annualTax: string;
  /** Tax with this month's one-offs as well. */
  annualTaxWithOneOffs: string;
  tdsToDate: string;
  remainingMonths: number;
  regularShare: string;
  oneOffTax: string;
  /** This month's TDS, whole rupees, never negative. */
  tds: string;
  /** The with-one-offs computation, to explain the figure. */
  computation: TaxComputation;
}

/**
 * This month's TDS by the usual practice: the year's tax on regular pay, less
 * what was already deducted, spread over the months left; one-offs (arrears,
 * bonus, gratuity, leave encashment) bear their whole extra tax in the month
 * they are paid.
 */
export function projectMonthlyTds(args: {
  /** 'YYYY-MM'. */
  month: string;
  /** Earlier months of the tax year (incl. a previous employer). */
  paidToDate: SalaryYear;
  /** TDS already deducted this tax year (incl. a previous employer). */
  tdsToDate: string;
  /** This month's regular pay (months: 1). */
  currentRegular: SalaryYear;
  /** This month's arrears, bonus, incentive, gratuity, leave encashment (months: 0). */
  currentOneOff: SalaryYear;
  /** One future month's regular pay (months: 1). */
  futureMonthly: SalaryYear;
  /** Months after this one to March (or to the exit month). */
  futureMonths: number;
  regime: TaxRegime;
  amounts: TaxDeclarationAmounts;
  proved?: Partial<Record<ProofHead, string>> | null;
  rules: TaxRules;
}): TdsProjection {
  if (!Number.isInteger(args.futureMonths) || args.futureMonths < 0) {
    throw new Error(`Not a number of months: ${args.futureMonths}`);
  }
  const { regime, amounts, proved, rules } = args;
  const regular = addSalary(
    addSalary(args.paidToDate, args.currentRegular),
    scaleSalary(args.futureMonthly, args.futureMonths),
  );
  const base = computeAnnualTax({ salary: regular, regime, amounts, proved, rules });
  const withOneOffs = computeAnnualTax({
    salary: addSalary(regular, args.currentOneOff),
    regime,
    amounts,
    proved,
    rules,
  });
  const annual = toPaise(base.taxPayable);
  const annualWith = toPaise(withOneOffs.taxPayable);
  const tdsToDate = toPaise(args.tdsToDate);
  const remainingMonths = args.futureMonths + 1;
  const regularShare = roundRupee(max0(annual - tdsToDate) / BigInt(remainingMonths));
  const oneOffTax = max0(annualWith - annual);
  return {
    month: args.month,
    regime,
    annualTax: fromPaise(annual),
    annualTaxWithOneOffs: fromPaise(annualWith),
    tdsToDate: fromPaise(tdsToDate),
    remainingMonths,
    regularShare: fromPaise(regularShare),
    oneOffTax: fromPaise(oneOffTax),
    tds: fromPaise(regularShare + oneOffTax),
    computation: withOneOffs,
  };
}

// ── Tax-year calendar ────────────────────────────────────────────────────

function parseMonth(month: string): [number, number] {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`Not a month: ${month}`);
  return [Number(m[1]), Number(m[2])];
}

/** The tax year (by its starting calendar year) a month falls in: '2027-02' → 2026. */
export function taxYearOf(month: string): number {
  const [y, m] = parseMonth(month);
  return m >= 4 ? y : y - 1;
}

/** 2026 → '2026-27'. */
export function taxYearLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

/** April to March. */
export function taxYearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${i < 9 ? year : year + 1}-${String(m).padStart(2, '0')}`;
  });
}

/** April–June = 1 … January–March = 4. */
export function quarterOf(month: string): 1 | 2 | 3 | 4 {
  const [, m] = parseMonth(month);
  return (m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4) as 1 | 2 | 3 | 4;
}

/** Form 138 (quarterly salary TDS statement) due date. */
export function form138Due(year: number, quarter: 1 | 2 | 3 | 4): string {
  return [`${year}-07-31`, `${year}-10-31`, `${year + 1}-01-31`, `${year + 1}-05-31`][quarter - 1]!;
}

// ── Exit and bonus ───────────────────────────────────────────────────────

function parseDate(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== date) throw new Error(`Not a date: ${date}`);
  return d;
}

/**
 * Service from the joining date to the last day, both counted. `countedYears`
 * rounds a part year of more than six months up to a year.
 */
export function completedServiceYears(
  joinedOn: string,
  lastDay: string,
): { years: number; months: number; days: number; countedYears: number } {
  const start = parseDate(joinedOn);
  const last = parseDate(lastDay);
  if (last < start) throw new Error('The last day is before the joining date.');
  const end = new Date(last.getTime() + 86400000);
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  let months = end.getUTCMonth() - start.getUTCMonth();
  let days = end.getUTCDate() - start.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const countedYears = years + (months > 6 || (months === 6 && days > 0) ? 1 : 0);
  return { years, months, days, countedYears };
}

/**
 * Gratuity on leaving: 15 days' wages (of 26) for each counted year, up to the
 * cap. Eligible after five years (a fixed-term employee after one, Code on
 * Social Security 2020).
 */
export function gratuityDue(args: {
  joinedOn: string;
  lastDay: string;
  /** Last drawn monthly wages (basic + DA). */
  monthlyWages: string;
  rules: TaxRules;
  fixedTerm?: boolean;
}): { eligible: boolean; countedYears: number; amount: string; reason: string } {
  const g = args.rules.gratuity;
  const service = completedServiceYears(args.joinedOn, args.lastDay);
  const needed = args.fixedTerm ? 1 : g.minYears;
  const length = `${service.years} year(s) ${service.months} month(s) ${service.days} day(s)`;
  if (service.countedYears < needed) {
    return {
      eligible: false,
      countedYears: service.countedYears,
      amount: '0.00',
      reason: `Service of ${length} is short of ${needed} year(s).`,
    };
  }
  const full = roundRupee(
    mulDiv(
      toPaise(args.monthlyWages),
      BigInt(g.daysPerYear * service.countedYears),
      BigInt(g.divisor),
    ),
  );
  const cap = toPaise(g.cap);
  const amount = min(full, cap);
  return {
    eligible: true,
    countedYears: service.countedYears,
    amount: fromPaise(amount),
    reason:
      `Service of ${length} counts as ${service.countedYears} year(s): ${g.daysPerYear}/${g.divisor} of a month's wages a year` +
      (full > cap ? `, capped at ₹${fromPaise(cap)}.` : '.'),
  };
}

/** Encashment of leave on leaving: the monthly base over the divisor, for each day. */
export function leaveEncashmentAmount(args: {
  days: number;
  monthlyBase: string;
  rules: TaxRules;
}): string {
  if (args.days < 0) throw new Error('Leave days cannot be negative.');
  // Days may be half days: work in hundredths of a day.
  const hundredths = BigInt(Math.round(args.days * 100));
  return fromPaise(
    roundRupee(
      mulDiv(
        toPaise(args.monthlyBase),
        hundredths,
        BigInt(args.rules.leaveEncashment.divisor) * 100n,
      ),
    ),
  );
}

/** Pay for notice days, at the exit month's per-day rate. */
export function noticePay(args: {
  days: number;
  monthlyGross: string;
  daysInMonth: number;
}): string {
  if (args.days < 0 || args.daysInMonth <= 0) throw new Error('Not a notice period.');
  return fromPaise(
    roundRupee(mulDiv(toPaise(args.monthlyGross), BigInt(args.days), BigInt(args.daysInMonth))),
  );
}

/**
 * Statutory bonus for an accounting year: for people whose wages stay within
 * the eligibility ceiling and who worked at least 30 days, the rate on wages
 * each capped at the calculation ceiling.
 */
export function statutoryBonus(args: {
  months: { month: string; wages: string; daysWorked: number }[];
  ratePercent: string;
  rules: TaxRules;
}): { eligible: boolean; reason: string; bonusWages: string; amount: string } {
  const b = args.rules.bonus;
  const rate = pct(args.ratePercent);
  if (rate < pct(b.minRate) || rate > pct(b.maxRate)) {
    throw new Error(`The bonus rate must be between ${b.minRate}% and ${b.maxRate}%.`);
  }
  const calcCeiling = toPaise(b.calculationCeiling);
  let highest = 0n;
  let days = 0;
  let bonusWages = 0n;
  for (const m of args.months) {
    const w = max0(toPaise(m.wages));
    if (w > highest) highest = w;
    days += m.daysWorked;
    bonusWages += min(w, calcCeiling);
  }
  const wages = fromPaise(bonusWages);
  if (highest > toPaise(b.eligibilityCeiling)) {
    return {
      eligible: false,
      reason: `Wages of ₹${fromPaise(highest)} a month are above the ₹${b.eligibilityCeiling} ceiling.`,
      bonusWages: wages,
      amount: '0.00',
    };
  }
  if (days < 30) {
    return {
      eligible: false,
      reason: `Worked ${days} day(s); 30 are needed.`,
      bonusWages: wages,
      amount: '0.00',
    };
  }
  return {
    eligible: true,
    reason: `${args.ratePercent}% of bonus wages (each month up to ₹${b.calculationCeiling}).`,
    bonusWages: wages,
    amount: fromPaise(roundRupee(mulDiv(bonusWages, rate, 10000n))),
  };
}
