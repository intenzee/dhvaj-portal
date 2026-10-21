import type { PoolClient } from 'pg';
import {
  DEFAULT_TAX_RULES,
  EMPTY_DECLARATION,
  ZERO_SALARY,
  addSalary,
  computePayLine,
  fromPaise,
  projectMonthlyTds,
  taxYearOf,
  toPaise,
  type PayLine,
  type PayRules,
  type PaySettings,
  type PreviousEmployment,
  type ProofHead,
  type SalaryStructureInput,
  type SalaryYear,
  type TaxDeclarationAmounts,
  type TaxRegime,
  type TaxRules,
  type TdsProjection,
} from '@hsdg/contracts';

/** Earnings paid once, taxed in full in the month paid (not spread). */
const ONE_OFF = new Set([
  'arrears',
  'incentive',
  'bonus',
  'leave_encashment',
  'gratuity_paid',
  'notice_pay',
]);
const BASIC = new Set(['basic', 'da']);

/** The tax rules in force: the settings' own, else the seeded defaults. */
export function taxRulesOf(rules: PayRules): TaxRules {
  return rules.tax ?? DEFAULT_TAX_RULES;
}

/**
 * What a pay line means for income tax. `regular` is the month's salary;
 * `oneOff` what is taxed in full in the month (arrears, bonus, exit pay).
 */
export function salaryOf(line: PayLine, part: 'all' | 'regular' | 'oneOff'): SalaryYear {
  const sum = (pick: (code: string, kind: string) => boolean) =>
    line.items.filter((i) => pick(i.code, i.kind)).reduce((s, i) => s + toPaise(i.amount), 0n);
  const inPart = (code: string) =>
    part === 'all' || (part === 'oneOff' ? ONE_OFF.has(code) : !ONE_OFF.has(code));
  const earning = (code: string, kind: string) => kind === 'earning' && inPart(code);
  const regular = part !== 'oneOff';
  let basic = sum((c, k) => earning(c, k) && BASIC.has(c));
  if (basic === 0n && regular) basic = toPaise(line.pfWages);
  return {
    gross: fromPaise(sum(earning)),
    basic: fromPaise(basic),
    hra: fromPaise(sum((c, k) => earning(c, k) && c === 'hra')),
    lta: fromPaise(sum((c, k) => earning(c, k) && c === 'lta')),
    gratuity: fromPaise(sum((c, k) => earning(c, k) && c === 'gratuity_paid')),
    leaveEncashment: fromPaise(sum((c, k) => earning(c, k) && c === 'leave_encashment')),
    employeePf: regular ? fromPaise(sum((c, k) => k === 'deduction' && c === 'pf')) : '0.00',
    pt: regular ? fromPaise(sum((c, k) => k === 'deduction' && c === 'pt')) : '0.00',
    months: part === 'oneOff' ? 0 : 1,
  };
}

/** TDS deducted on a line. */
export const tdsOf = (line: PayLine): bigint =>
  line.items
    .filter((i) => i.kind === 'deduction' && i.code === 'tds')
    .reduce((s, i) => s + toPaise(i.amount), 0n);

export interface DeclarationRow {
  id: string;
  employee_id: string;
  tax_year: number;
  regime: TaxRegime;
  amounts: Partial<TaxDeclarationAmounts>;
  previous_employment: PreviousEmployment | null;
  submitted_at: Date | null;
  locked_at: Date | null;
  locked_by: string | null;
  version: number;
}

/** A person's tax year as far as it has been paid: the base of every projection. */
export interface PersonTaxYear {
  regime: TaxRegime;
  amounts: TaxDeclarationAmounts;
  previous: PreviousEmployment | null;
  /** Accepted proofs by head — what counts once the declaration is locked from January. */
  proved: Partial<Record<ProofHead, string>>;
  locked: boolean;
  /** Earlier months of the year (submitted or later runs), previous employer folded in. */
  paid: SalaryYear;
  tdsToDate: bigint;
}

export const yearStart = (year: number): string => `${year}-04`;
export const yearEnd = (year: number): string => `${year + 1}-03`;

/** Months strictly after `from` up to and including `to` ('YYYY-MM'). */
export function monthsAfter(from: string, to: string): number {
  const n = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return Math.max(0, n(to) - n(from));
}

export function amountsOf(
  raw: Partial<TaxDeclarationAmounts> | null | undefined,
): TaxDeclarationAmounts {
  return { ...EMPTY_DECLARATION, ...(raw ?? {}) };
}

/** Someone with no declaration and nothing paid yet this year: new regime, nil. */
export const blankTaxYear = (): PersonTaxYear => ({
  regime: 'new',
  amounts: amountsOf(null),
  previous: null,
  proved: {},
  locked: false,
  paid: { ...ZERO_SALARY },
  tdsToDate: 0n,
});

/**
 * Load the tax year for everyone (or the given people): declarations,
 * accepted proofs and salary paid before `beforeMonth` (exclusive; default
 * the whole year). Reads through RLS, so a person loads only their own.
 * Everyone asked for by id has an entry; with no ids, only people with a
 * declaration or a line do (use `blankTaxYear()` for the rest).
 */
export async function loadTaxYears(
  client: PoolClient,
  year: number,
  opts: { employeeIds?: string[]; beforeMonth?: string; excludeRunId?: string } = {},
): Promise<Map<string, PersonTaxYear>> {
  const ids = opts.employeeIds ?? null;
  const decls = await client.query<DeclarationRow>(
    `SELECT d.id, d.employee_id, d.tax_year, d.regime, d.amounts, d.previous_employment,
            d.submitted_at, d.locked_at, NULL::text AS locked_by, d.version
       FROM hsdg.tax_declarations d
      WHERE d.tax_year = $1 AND ($2::uuid[] IS NULL OR d.employee_id = ANY ($2))`,
    [year, ids],
  );
  const proofs = await client.query<{ employee_id: string; head: ProofHead; accepted: string }>(
    `SELECT p.employee_id, p.head, sum(p.accepted_amount)::text AS accepted
       FROM hsdg.tax_proofs p JOIN hsdg.tax_declarations d ON d.id = p.declaration_id
      WHERE d.tax_year = $1 AND p.status = 'accepted'
        AND ($2::uuid[] IS NULL OR p.employee_id = ANY ($2))
      GROUP BY p.employee_id, p.head`,
    [year, ids],
  );
  const end = opts.beforeMonth ?? `${year + 1}-04`;
  const lines = await client.query<{ employee_id: string; line: PayLine }>(
    `SELECT l.employee_id, l.line
       FROM hsdg.payroll_lines l JOIN hsdg.payroll_runs r ON r.id = l.run_id
      WHERE l.kind = 'salary' AND l.month >= $1::date AND l.month < $2::date
        AND r.status NOT IN ('draft', 'computed') AND r.id IS DISTINCT FROM $4
        AND ($3::uuid[] IS NULL OR l.employee_id = ANY ($3))`,
    [`${yearStart(year)}-01`, `${end}-01`, ids, opts.excludeRunId ?? null],
  );

  const out = new Map<string, PersonTaxYear>();
  const get = (employeeId: string): PersonTaxYear => {
    let p = out.get(employeeId);
    if (!p) {
      p = blankTaxYear();
      out.set(employeeId, p);
    }
    return p;
  };
  for (const id of ids ?? []) get(id);
  for (const d of decls.rows) {
    const p = get(d.employee_id);
    p.regime = d.regime;
    p.amounts = amountsOf(d.amounts);
    p.locked = d.locked_at !== null;
    if (d.previous_employment) {
      const prev = d.previous_employment;
      p.previous = prev;
      p.paid = addSalary(p.paid, {
        ...ZERO_SALARY,
        gross: prev.income,
        employeePf: prev.pf,
        pt: prev.pt,
      });
      p.tdsToDate += toPaise(prev.tds);
    }
  }
  for (const r of proofs.rows) get(r.employee_id).proved[r.head] = r.accepted;
  for (const l of lines.rows) {
    const p = get(l.employee_id);
    p.paid = addSalary(p.paid, salaryOf(l.line, 'all'));
    p.tdsToDate += tdsOf(l.line);
  }
  return out;
}

/** What a run line keeps about its TDS, so it can be explained later. */
export interface StoredTds extends TdsProjection {
  basis: 'declared' | 'proved';
}

/**
 * This month's TDS for a person (s.392): the year's tax on salary paid so far
 * plus this month plus the rest of the year at the current structure, less
 * TDS already deducted, spread over the months left; one-off pay taxed in
 * full now. From January a locked declaration counts only what is proved.
 */
export function projectTds(args: {
  month: string;
  line: PayLine;
  structure: SalaryStructureInput;
  settings: PaySettings;
  rules: TaxRules;
  person: PersonTaxYear;
  exitedOn: string | null;
}): StoredTds {
  const { month, line, person } = args;
  const year = taxYearOf(month);
  const exitMonth = args.exitedOn ? args.exitedOn.slice(0, 7) : null;
  const last = exitMonth && exitMonth < yearEnd(year) ? exitMonth : yearEnd(year);
  const futureMonths = exitMonth && exitMonth <= month ? 0 : monthsAfter(month, last);
  const full = computePayLine(
    args.structure,
    { month, lossOfPayDays: 0, inputs: [] },
    args.settings,
  );
  const proving = person.locked && Number(month.slice(5, 7)) <= 3;
  const p = projectMonthlyTds({
    month,
    paidToDate: person.paid,
    tdsToDate: fromPaise(person.tdsToDate),
    currentRegular: salaryOf(line, 'regular'),
    currentOneOff: salaryOf(line, 'oneOff'),
    futureMonthly: salaryOf(full, 'regular'),
    futureMonths,
    regime: person.regime,
    amounts: person.amounts,
    proved: proving ? person.proved : null,
    rules: args.rules,
  });
  return { ...p, basis: proving ? 'proved' : 'declared' };
}
