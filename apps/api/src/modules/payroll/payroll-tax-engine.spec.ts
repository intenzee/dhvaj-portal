import {
  DEFAULT_TAX_RULES,
  EMPTY_DECLARATION,
  ZERO_SALARY,
  addSalary,
  completedServiceYears,
  computeAnnualTax,
  form138Due,
  gratuityDue,
  leaveEncashmentAmount,
  noticePay,
  projectMonthlyTds,
  quarterOf,
  scaleSalary,
  statutoryBonus,
  taxYearLabel,
  taxYearMonths,
  taxYearOf,
  type SalaryYear,
  type TaxComputation,
  type TaxDeclarationAmounts,
} from '@hsdg/contracts';

/**
 * Golden cases for the income-tax, exit and bonus engine (tax year 2026-27,
 * Income-tax Act 2025), each worked by hand. Pure: salary + declaration +
 * rules → computation.
 */
const R = DEFAULT_TAX_RULES;

const year = (over: Partial<SalaryYear>): SalaryYear => ({ ...ZERO_SALARY, months: 12, ...over });
const month = (gross: string): SalaryYear => ({ ...ZERO_SALARY, gross, basic: gross, months: 1 });
const declare = (over: Partial<TaxDeclarationAmounts> = {}): TaxDeclarationAmounts => ({
  ...EMPTY_DECLARATION,
  ...over,
});
const line = (lines: TaxComputation['exemptions'], code: string) =>
  lines.find((l) => l.code === code)?.amount;

describe('payroll tax engine', () => {
  describe('computeAnnualTax', () => {
    it('new regime: ₹12,00,000 taxable pays nothing (rebate)', () => {
      // 12,75,000 − 75,000 standard = 12,00,000.
      // Slabs: 4–8L 5% = 20,000; 8–12L 10% = 40,000 → 60,000; rebate 60,000.
      const c = computeAnnualTax({
        salary: year({ gross: '1275000' }),
        regime: 'new',
        amounts: declare(),
        rules: R,
      });
      expect(c.standardDeduction).toBe('75000.00');
      expect(c.totalIncome).toBe('1200000.00');
      expect(c.taxOnIncome).toBe('60000.00');
      expect(c.rebate).toBe('60000.00');
      expect(c.cess).toBe('0.00');
      expect(c.taxPayable).toBe('0.00');
    });

    it('new regime: ₹12,10,000 gets marginal relief — tax is the ₹10,000 over the limit', () => {
      // 12,85,000 − 75,000 = 12,10,000. Slabs: 60,000 + 10,000 × 15% = 61,500.
      // Relief: tax limited to 12,10,000 − 12,00,000 = 10,000 → rebate 51,500.
      // Cess 4% of 10,000 = 400 → 10,400.
      const c = computeAnnualTax({
        salary: year({ gross: '1285000' }),
        regime: 'new',
        amounts: declare(),
        rules: R,
      });
      expect(c.totalIncome).toBe('1210000.00');
      expect(c.taxOnIncome).toBe('61500.00');
      expect(c.rebate).toBe('51500.00');
      expect(c.cess).toBe('400.00');
      expect(c.taxPayable).toBe('10400.00');
      expect(c.notes.join(' ')).toMatch(/Marginal relief/);
    });

    it('new regime: ₹18,00,000 salary ignores HRA, rent and 80C', () => {
      // 18,00,000 − 75,000 = 17,25,000.
      // 20,000 + 40,000 + 60,000 (12–16L) + 1,25,000 × 20% = 25,000 → 1,45,000.
      // Cess 5,800 → 1,50,800.
      const c = computeAnnualTax({
        salary: year({
          gross: '1800000',
          basic: '900000',
          hra: '360000',
          employeePf: '21600',
          pt: '2500',
        }),
        regime: 'new',
        amounts: declare({ rentMonthly: '30000', metroCity: true, section80C: '150000' }),
        rules: R,
      });
      expect(c.exemptions).toEqual([]);
      expect(c.deductions).toEqual([]);
      expect(c.professionalTax).toBe('0.00');
      expect(c.incomeFromSalary).toBe('1725000.00');
      expect(c.taxOnIncome).toBe('145000.00');
      expect(c.rebate).toBe('0.00');
      expect(c.cess).toBe('5800.00');
      expect(c.taxPayable).toBe('150800.00');
      expect(c.notes.join(' ')).toMatch(/not allowed/);
    });

    const oldSalary = year({
      gross: '1200000',
      basic: '600000',
      hra: '300000',
      employeePf: '72000',
      pt: '2500',
    });
    const oldDeclared = declare({
      rentMonthly: '25000',
      metroCity: true,
      landlordPanGiven: true,
      section80C: '100000',
      section80DSelf: '20000',
      section80DParents: '60000',
      parentsSenior: true,
    });

    it('old regime: HRA (metro), 80C with PF, 80D for senior parents', () => {
      // HRA: least of 3,00,000 received; rent 3,00,000 − 10% of 6,00,000 = 2,40,000;
      // 50% of basic 3,00,000 → 2,40,000.
      // Salary: 12,00,000 − 2,40,000 − 50,000 standard − 2,500 PT = 9,07,500.
      // 80C: 1,00,000 + PF 72,000 = 1,72,000 → cap 1,50,000.
      // 80D: self 20,000 (cap 25,000); senior parents 60,000 → cap 50,000.
      // Total income 9,07,500 − 2,20,000 = 6,87,500.
      // Tax: 2.5–5L 5% = 12,500; 1,87,500 × 20% = 37,500 → 50,000; cess 2,000.
      const c = computeAnnualTax({
        salary: oldSalary,
        regime: 'old',
        amounts: oldDeclared,
        rules: R,
      });
      expect(line(c.exemptions, 'hra')).toBe('240000.00');
      expect(c.standardDeduction).toBe('50000.00');
      expect(c.professionalTax).toBe('2500.00');
      expect(c.incomeFromSalary).toBe('907500.00');
      expect(line(c.deductions, '80C')).toBe('150000.00');
      expect(line(c.deductions, '80D_self')).toBe('20000.00');
      expect(line(c.deductions, '80D_parents')).toBe('50000.00');
      expect(c.totalIncome).toBe('687500.00');
      expect(c.taxOnIncome).toBe('50000.00');
      expect(c.cess).toBe('2000.00');
      expect(c.taxPayable).toBe('52000.00');
      expect(c.notes).toEqual([]);
    });

    it("old regime: asks for the landlord's PAN when rent is over ₹1,00,000", () => {
      const c = computeAnnualTax({
        salary: oldSalary,
        regime: 'old',
        amounts: { ...oldDeclared, landlordPanGiven: false },
        rules: R,
      });
      expect(c.notes.join(' ')).toMatch(/landlord's PAN/);
    });

    it('old regime from January: only what was proved counts', () => {
      // Proved: 80C 50,000 only. No rent proved → no HRA.
      // Salary: 12,00,000 − 50,000 − 2,500 = 11,47,500. 80C 50,000 + PF 72,000 = 1,22,000.
      // Total income 10,25,500. Tax: 12,500 + 1,00,000 (5–10L) + 25,500 × 30% = 7,650 → 1,20,150.
      // Cess 4,806 → 1,24,956.
      const c = computeAnnualTax({
        salary: oldSalary,
        regime: 'old',
        amounts: oldDeclared,
        proved: { section80C: '50000' },
        rules: R,
      });
      expect(line(c.exemptions, 'hra')).toBeUndefined();
      expect(line(c.deductions, '80C')).toBe('122000.00');
      expect(line(c.deductions, '80D_parents')).toBeUndefined();
      expect(c.totalIncome).toBe('1025500.00');
      expect(c.taxOnIncome).toBe('120150.00');
      expect(c.taxPayable).toBe('124956.00');
    });

    it('old regime: rebate at ₹5,00,000, and the cliff just above it', () => {
      // 5,52,500 − 50,000 − 2,500 PT = 5,00,000: tax 12,500, rebate 12,500.
      const at = computeAnnualTax({
        salary: year({ gross: '552500', pt: '2500' }),
        regime: 'old',
        amounts: declare(),
        rules: R,
      });
      expect(at.totalIncome).toBe('500000.00');
      expect(at.rebate).toBe('12500.00');
      expect(at.taxPayable).toBe('0.00');
      // 5,00,010: no rebate, no marginal relief in the old regime.
      // 12,500 + 10 × 20% = 12,502; cess 500.08 → 13,002.08 → 13,002.
      const over = computeAnnualTax({
        salary: year({ gross: '552510', pt: '2500' }),
        regime: 'old',
        amounts: declare(),
        rules: R,
      });
      expect(over.rebate).toBe('0.00');
      expect(over.taxPayable).toBe('13002.00');
    });

    it('home loan interest, 80E, 80G and 80TTA (capped)', () => {
      // Salary 10,50,000 − 50,000 = 10,00,000; other income 15,000 → GTI 10,15,000.
      // Interest 2,50,000 → 2,00,000; 80E 40,000; 80G 10,000; 80TTA 15,000 → 10,000.
      // Total income 10,15,000 − 2,60,000 = 7,55,000.
      // Tax 12,500 + 2,55,000 × 20% = 51,000 → 63,500; cess 2,540 → 66,040.
      const c = computeAnnualTax({
        salary: year({ gross: '1050000' }),
        regime: 'old',
        amounts: declare({
          homeLoanInterest: '250000',
          section80E: '40000',
          section80G: '10000',
          section80TTA: '15000',
          otherIncome: '15000',
        }),
        rules: R,
      });
      expect(c.grossTotalIncome).toBe('1015000.00');
      expect(line(c.deductions, 'home_loan_interest')).toBe('200000.00');
      expect(c.deductions.find((d) => d.code === 'home_loan_interest')?.label).toBe(
        'Interest on housing loan (self-occupied)',
      );
      expect(line(c.deductions, '80TTA')).toBe('10000.00');
      expect(c.totalIncome).toBe('755000.00');
      expect(c.taxPayable).toBe('66040.00');
    });

    it('exempts gratuity and leave encashment on exit in both regimes', () => {
      // Gross 30,00,000 includes gratuity 25,00,000 (20,00,000 exempt) and leave 3,00,000 (all exempt).
      // New: 30,00,000 − 23,00,000 − 75,000 = 6,25,000; tax 11,250, rebated.
      const c = computeAnnualTax({
        salary: year({ gross: '3000000', gratuity: '2500000', leaveEncashment: '300000' }),
        regime: 'new',
        amounts: declare(),
        rules: R,
      });
      expect(line(c.exemptions, 'gratuity')).toBe('2000000.00');
      expect(line(c.exemptions, 'leave_encashment')).toBe('300000.00');
      expect(c.totalIncome).toBe('625000.00');
      expect(c.taxPayable).toBe('0.00');
      expect(c.notes.join(' ')).toMatch(/10-month/);
    });

    it('surcharge with marginal relief just above ₹50 lakh', () => {
      // 50,85,000 − 75,000 = 50,10,000.
      // Tax at 50L: 20,000 + 40,000 + 60,000 + 80,000 + 1,00,000 + 26L × 30% 7,80,000 = 10,80,000.
      // At 50.1L: 10,83,000; surcharge 10% = 1,08,300 → 11,91,300.
      // Ceiling: 10,80,000 + 10,000 = 10,90,000 → surcharge 7,000. Cess 43,600 → 11,33,600.
      const c = computeAnnualTax({
        salary: year({ gross: '5085000' }),
        regime: 'new',
        amounts: declare(),
        rules: R,
      });
      expect(c.taxOnIncome).toBe('1083000.00');
      expect(c.surcharge).toBe('7000.00');
      expect(c.cess).toBe('43600.00');
      expect(c.taxPayable).toBe('1133600.00');
      expect(c.notes.join(' ')).toMatch(/surcharge/);
      // Well above (60L): full 10%. 10,80,000 + 10L × 30% = 13,80,000; +1,38,000; cess 60,720.
      const full = computeAnnualTax({
        salary: year({ gross: '6075000' }),
        regime: 'new',
        amounts: declare(),
        rules: R,
      });
      expect(full.surcharge).toBe('138000.00');
      expect(full.taxPayable).toBe('1578720.00');
    });

    it('rounds total income to ₹10 and never goes below nil', () => {
      // 12,85,004.50 − 75,000 = 12,10,004.50 → 12,10,000; 12,85,005 → 12,10,010.
      const down = computeAnnualTax({
        salary: year({ gross: '1285004.50' }),
        regime: 'new',
        amounts: declare(),
        rules: R,
      });
      expect(down.totalIncome).toBe('1210000.00');
      const up = computeAnnualTax({
        salary: year({ gross: '1285005' }),
        regime: 'new',
        amounts: declare(),
        rules: R,
      });
      expect(up.totalIncome).toBe('1210010.00');
      // Salary under the standard deduction: the deduction is the salary.
      const tiny = computeAnnualTax({
        salary: year({ gross: '40000' }),
        regime: 'old',
        amounts: declare(),
        rules: R,
      });
      expect(tiny.standardDeduction).toBe('40000.00');
      expect(tiny.totalIncome).toBe('0.00');
      expect(tiny.taxPayable).toBe('0.00');
    });
  });

  describe('projectMonthlyTds', () => {
    // ₹1,50,000 a month, new regime; October with six months paid.
    const pay = month('150000');
    const base = {
      month: '2026-10',
      paidToDate: scaleSalary(pay, 6),
      tdsToDate: '60000',
      currentRegular: pay,
      currentOneOff: { ...ZERO_SALARY },
      futureMonthly: pay,
      futureMonths: 5,
      regime: 'new' as const,
      amounts: declare(),
      rules: R,
    };

    it('spreads the year’s tax over the months left; a bonus bears its whole tax this month', () => {
      // Year 18,00,000 → tax 1,50,800 (above). (1,50,800 − 60,000) / 6 = 15,133.33 → 15,133.
      // With a 1,00,000 bonus: 18,25,000 taxable: 1,20,000 + 2,25,000 × 20% = 1,65,000;
      // cess 6,600 → 1,71,600. One-off tax 1,71,600 − 1,50,800 = 20,800.
      const p = projectMonthlyTds({ ...base, currentOneOff: { ...ZERO_SALARY, gross: '100000' } });
      expect(p.annualTax).toBe('150800.00');
      expect(p.annualTaxWithOneOffs).toBe('171600.00');
      expect(p.remainingMonths).toBe(6);
      expect(p.regularShare).toBe('15133.00');
      expect(p.oneOffTax).toBe('20800.00');
      expect(p.tds).toBe('35933.00');
      expect(p.computation.totalIncome).toBe('1825000.00');
    });

    it('takes a mid-year revision from the month it applies', () => {
      // April–September at 1,00,000, from October 1,50,000:
      // 6,00,000 + 1,50,000 + 7,50,000 = 15,00,000 → 14,25,000 taxable.
      // 20,000 + 40,000 + 2,25,000 × 15% = 33,750 → 93,750; cess 3,750 → 97,500.
      // (97,500 − 36,000) / 6 = 10,250.
      const p = projectMonthlyTds({
        ...base,
        paidToDate: scaleSalary(month('100000'), 6),
        tdsToDate: '36000',
      });
      expect(p.annualTax).toBe('97500.00');
      expect(p.oneOffTax).toBe('0.00');
      expect(p.tds).toBe('10250.00');
    });

    it("counts a previous employer's TDS against the year's tax", () => {
      // April–June with an earlier employer (4,50,000, TDS 30,000 on its Form 130), then
      // three months here (TDS 60,000): the same year, so (1,50,800 − 90,000) / 6 = 10,133.33 → 10,133.
      const previous: SalaryYear = { ...ZERO_SALARY, gross: '450000', basic: '450000', months: 3 };
      const p = projectMonthlyTds({
        ...base,
        paidToDate: addSalary(previous, scaleSalary(pay, 3)),
        tdsToDate: '90000',
      });
      expect(p.annualTax).toBe('150800.00');
      expect(p.regularShare).toBe('10133.00');
      expect(p.tds).toBe('10133.00');
    });

    it('never deducts below nil', () => {
      // Already deducted more than the year's tax.
      const over = projectMonthlyTds({ ...base, tdsToDate: '200000' });
      expect(over.regularShare).toBe('0.00');
      expect(over.tds).toBe('0.00');
      // March, small pay: nil tax, nil TDS.
      const small = projectMonthlyTds({
        ...base,
        month: '2027-03',
        paidToDate: scaleSalary(month('40000'), 11),
        currentRegular: month('40000'),
        futureMonthly: month('40000'),
        futureMonths: 0,
        tdsToDate: '0',
      });
      expect(small.remainingMonths).toBe(1);
      expect(small.annualTax).toBe('0.00');
      expect(small.tds).toBe('0.00');
      expect(() => projectMonthlyTds({ ...base, futureMonths: -1 })).toThrow(/months/);
    });
  });

  describe('salary spans', () => {
    it('adds and scales', () => {
      const m = { ...month('50000'), hra: '20000', employeePf: '1800' };
      const y = addSalary(scaleSalary(m, 11), m);
      expect(y.gross).toBe('600000.00');
      expect(y.hra).toBe('240000.00');
      expect(y.employeePf).toBe('21600.00');
      expect(y.months).toBe(12);
    });
  });

  describe('tax-year calendar', () => {
    it('places months in the tax year and quarter', () => {
      expect(taxYearOf('2026-04')).toBe(2026);
      expect(taxYearOf('2027-02')).toBe(2026);
      expect(taxYearOf('2027-03')).toBe(2026);
      expect(taxYearLabel(2026)).toBe('2026-27');
      expect(taxYearLabel(2099)).toBe('2099-00');
      const months = taxYearMonths(2026);
      expect(months).toHaveLength(12);
      expect(months[0]).toBe('2026-04');
      expect(months[8]).toBe('2026-12');
      expect(months[9]).toBe('2027-01');
      expect(months[11]).toBe('2027-03');
      expect(quarterOf('2026-04')).toBe(1);
      expect(quarterOf('2026-06')).toBe(1);
      expect(quarterOf('2026-07')).toBe(2);
      expect(quarterOf('2026-12')).toBe(3);
      expect(quarterOf('2027-01')).toBe(4);
      expect(quarterOf('2027-03')).toBe(4);
    });

    it('gives the Form 138 due dates', () => {
      expect(form138Due(2026, 1)).toBe('2026-07-31');
      expect(form138Due(2026, 2)).toBe('2026-10-31');
      expect(form138Due(2026, 3)).toBe('2027-01-31');
      expect(form138Due(2026, 4)).toBe('2027-05-31');
    });
  });

  describe('exit', () => {
    it('counts service, a part year over six months as a year', () => {
      // 1 Mar 2022 to 30 Sep 2026: 4 years 7 months → 5.
      expect(completedServiceYears('2022-03-01', '2026-09-30')).toEqual({
        years: 4,
        months: 7,
        days: 0,
        countedYears: 5,
      });
      // 1 May 2022 to 30 Sep 2026: 4 years 5 months → 4.
      expect(completedServiceYears('2022-05-01', '2026-09-30').countedYears).toBe(4);
      // Exactly six months over does not round up.
      expect(completedServiceYears('2022-04-01', '2026-09-30').countedYears).toBe(4);
      expect(() => completedServiceYears('2026-10-01', '2026-09-30')).toThrow(/before/);
    });

    it('pays gratuity after five counted years', () => {
      // 4y7m → 5 years: 26,000 × 15/26 × 5 = 75,000.
      const due = gratuityDue({
        joinedOn: '2022-03-01',
        lastDay: '2026-09-30',
        monthlyWages: '26000',
        rules: R,
      });
      expect(due.eligible).toBe(true);
      expect(due.countedYears).toBe(5);
      expect(due.amount).toBe('75000.00');
      // 4y5m → 4 years: not eligible.
      const short = gratuityDue({
        joinedOn: '2022-05-01',
        lastDay: '2026-09-30',
        monthlyWages: '26000',
        rules: R,
      });
      expect(short.eligible).toBe(false);
      expect(short.amount).toBe('0.00');
      expect(short.reason).toMatch(/short of 5/);
      // Fixed term: one year is enough. 1y: 26,000 × 15/26 = 15,000.
      const fixed = gratuityDue({
        joinedOn: '2025-10-01',
        lastDay: '2026-09-30',
        monthlyWages: '26000',
        rules: R,
        fixedTerm: true,
      });
      expect(fixed.eligible).toBe(true);
      expect(fixed.amount).toBe('15000.00');
    });

    it('caps gratuity', () => {
      // 10,00,000 × 15/26 × 10 = 57,69,230.77 → capped at 20,00,000.
      const due = gratuityDue({
        joinedOn: '2016-10-01',
        lastDay: '2026-09-30',
        monthlyWages: '1000000',
        rules: R,
      });
      expect(due.countedYears).toBe(10);
      expect(due.amount).toBe('2000000.00');
      expect(due.reason).toMatch(/capped/);
    });

    it('works out leave encashment and notice pay', () => {
      // 30,000 / 30 × 15 = 15,000; 25,000 / 30 × 7.5 = 6,250.
      expect(leaveEncashmentAmount({ days: 15, monthlyBase: '30000', rules: R })).toBe('15000.00');
      expect(leaveEncashmentAmount({ days: 7.5, monthlyBase: '25000', rules: R })).toBe('6250.00');
      // 62,000 × 10 / 31 = 20,000; 50,000 × 7 / 30 = 11,666.67 → 11,667.
      expect(noticePay({ days: 10, monthlyGross: '62000', daysInMonth: 31 })).toBe('20000.00');
      expect(noticePay({ days: 7, monthlyGross: '50000', daysInMonth: 30 })).toBe('11667.00');
    });
  });

  describe('statutoryBonus', () => {
    const months = (wages: string, daysWorked = 26) =>
      taxYearMonths(2025).map((month) => ({ month, wages, daysWorked }));

    it('pays the rate on wages capped at ₹7,000 a month', () => {
      // 12 × 7,000 = 84,000 × 8.33% = 6,997.20 → 6,997.
      const b = statutoryBonus({ months: months('20000'), ratePercent: '8.33', rules: R });
      expect(b.eligible).toBe(true);
      expect(b.bonusWages).toBe('84000.00');
      expect(b.amount).toBe('6997.00');
      // Wages under the calculation ceiling count as paid: 12 × 6,000 × 20% = 14,400.
      expect(statutoryBonus({ months: months('6000'), ratePercent: '20', rules: R }).amount).toBe(
        '14400.00',
      );
    });

    it('is not due above the ceiling or under 30 days', () => {
      const rich = statutoryBonus({
        months: [
          ...months('20000').slice(0, 11),
          { month: '2026-03', wages: '21000.01', daysWorked: 26 },
        ],
        ratePercent: '8.33',
        rules: R,
      });
      expect(rich.eligible).toBe(false);
      expect(rich.amount).toBe('0.00');
      expect(rich.reason).toMatch(/above/);
      const brief = statutoryBonus({
        months: [{ month: '2026-03', wages: '15000', daysWorked: 29 }],
        ratePercent: '8.33',
        rules: R,
      });
      expect(brief.eligible).toBe(false);
      expect(brief.reason).toMatch(/30/);
    });

    it('refuses a rate outside 8.33%–20%', () => {
      expect(() => statutoryBonus({ months: months('10000'), ratePercent: '8', rules: R })).toThrow(
        /between/,
      );
      expect(() =>
        statutoryBonus({ months: months('10000'), ratePercent: '20.01', rules: R }),
      ).toThrow(/between/);
    });
  });
});
