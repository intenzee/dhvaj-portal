import {
  DEFAULT_PAY_SETTINGS,
  computePayLine,
  daysInMonth,
  maskTail,
  professionalTax,
  revisionArrears,
  toPaise,
  type PayLine,
  type PaySettings,
  type SalaryStructureInput,
} from '@hsdg/contracts';

/**
 * Golden cases for the payroll engine (spec §7.6), each worked by hand. The
 * engine is pure: structure + month + settings → line.
 */
const S: PaySettings = { ...DEFAULT_PAY_SETTINGS, labourCodeWages: false };

const salary = (basic: string, hra: string, special: string): SalaryStructureInput => ({
  kind: 'salary',
  ctc: '0',
  components: [
    { code: 'basic', label: 'Basic', monthly: basic, pfWage: true },
    { code: 'hra', label: 'HRA', monthly: hra },
    { code: 'special', label: 'Special allowance', monthly: special },
  ],
  pfApplicable: true,
  esiApplicable: true,
  ptApplicable: true,
});

const item = (line: PayLine, code: string, kind?: string) =>
  line.items.find((i) => i.code === code && (!kind || i.kind === kind))?.amount;

describe('payroll engine', () => {
  it('pays a full month: PF on the ceiling, no ESI above the threshold, PT', () => {
    // Basic 20,000 + HRA 10,000 + special 10,000 = 40,000 gross.
    const line = computePayLine(
      salary('20000', '10000', '10000'),
      { month: '2026-10', lossOfPayDays: 0, inputs: [] },
      S,
    );
    expect(line.daysInMonth).toBe(31);
    expect(line.payableDays).toBe(31);
    expect(line.gross).toBe('40000.00');
    // PF wages 20,000, capped at 15,000: 12% = 1,800 each side.
    expect(item(line, 'pf', 'deduction')).toBe('1800.00');
    // EPS 8.33% of 15,000 = 1,249.50 → 1,250; EPF = 1,800 − 1,250 = 550.
    expect(item(line, 'pf_eps')).toBe('1250.00');
    expect(item(line, 'pf_epf')).toBe('550.00');
    expect(item(line, 'esi')).toBeUndefined();
    expect(item(line, 'pt')).toBe('200.00');
    // Gratuity 4.81% of 20,000 = 962.
    expect(item(line, 'gratuity')).toBe('962.00');
    expect(line.deductions).toBe('2000.00');
    expect(line.net).toBe('38000.00');
    // Cost: 40,000 + 1,800 + 962.
    expect(line.employerCost).toBe('42762.00');
  });

  it('pays a joiner for the days on the rolls', () => {
    // Joined 17 Sep (30 days): 14 days. Basic 15,000 × 14/30 = 7,000.
    const line = computePayLine(
      salary('15000', '6000', '9000'),
      { month: '2026-09', joinedOn: '2026-09-17', lossOfPayDays: 0, inputs: [] },
      S,
    );
    expect(line.daysEmployed).toBe(14);
    expect(item(line, 'basic')).toBe('7000.00');
    expect(item(line, 'hra')).toBe('2800.00');
    expect(item(line, 'special')).toBe('4200.00');
    expect(line.gross).toBe('14000.00');
    // PF 12% of 7,000 = 840; ESI 0.75% of 14,000 = 105, employer 3.25% = 455.
    expect(item(line, 'pf', 'deduction')).toBe('840.00');
    expect(item(line, 'esi', 'deduction')).toBe('105.00');
    expect(item(line, 'esi', 'employer')).toBe('455.00');
    // PT on 14,000 (above 10,000): 200.
    expect(item(line, 'pt')).toBe('200.00');
    expect(line.net).toBe('12855.00');
  });

  it('pays a leaver to their last day, and takes loss-of-pay days off', () => {
    // Left 10 Nov (30 days), 2 LOP days: 8 payable of 30. 30,000 × 8/30 = 8,000.
    const line = computePayLine(
      salary('12000', '6000', '12000'),
      { month: '2026-11', exitedOn: '2026-11-10', lossOfPayDays: 2, inputs: [] },
      S,
    );
    expect(line.daysEmployed).toBe(10);
    expect(line.payableDays).toBe(8);
    expect(line.gross).toBe('8000.00');
    expect(line.warnings).toContain('2 loss-of-pay day(s).');
  });

  it('rounds each prorated earning to the rupee', () => {
    // 10,000 × 20/31 = 6,451.61 → 6,452.
    const line = computePayLine(
      {
        ...salary('10000', '0', '0'),
        components: [{ code: 'basic', label: 'Basic', monthly: '10000', pfWage: true }],
      },
      { month: '2026-10', lossOfPayDays: 11, inputs: [] },
      S,
    );
    expect(item(line, 'basic')).toBe('6452.00');
  });

  it('takes ESI rounded up, and keeps it for the contribution period', () => {
    // 21,500 gross is above 21,000: not covered unless continuing.
    const st = salary('10000', '5000', '6500');
    const fresh = computePayLine(st, { month: '2026-10', lossOfPayDays: 0, inputs: [] }, S);
    expect(item(fresh, 'esi')).toBeUndefined();
    const continuing = computePayLine(
      st,
      { month: '2026-10', lossOfPayDays: 0, inputs: [], esiContinuing: true },
      S,
    );
    // 0.75% of 21,500 = 161.25 → 162; 3.25% = 698.75 → 699.
    expect(item(continuing, 'esi', 'deduction')).toBe('162.00');
    expect(item(continuing, 'esi', 'employer')).toBe('699.00');
    expect(continuing.warnings.join(' ')).toMatch(/ESI continues/);
  });

  it('takes the February PT slab', () => {
    const slabs = DEFAULT_PAY_SETTINGS.ptSlabs;
    expect(professionalTax(slabs, toPaise('25000'), '2027-02')).toBe(toPaise('300'));
    expect(professionalTax(slabs, toPaise('25000'), '2027-03')).toBe(toPaise('200'));
    expect(professionalTax(slabs, toPaise('9000'), '2027-02')).toBe(toPaise('175'));
    expect(professionalTax(slabs, toPaise('7500'), '2027-02')).toBe(0n);
  });

  it('raises PF wages to half of pay under the Labour Codes, and says so', () => {
    // Basic 8,000 of 40,000: wages become 20,000 → PF capped at 15,000 → 1,800.
    const st = salary('8000', '16000', '16000');
    const before = computePayLine(st, { month: '2026-10', lossOfPayDays: 0, inputs: [] }, S);
    expect(before.pfWages).toBe('8000.00');
    expect(item(before, 'pf', 'deduction')).toBe('960.00');
    const after = computePayLine(
      st,
      { month: '2026-10', lossOfPayDays: 0, inputs: [] },
      { ...S, labourCodeWages: true },
    );
    expect(after.pfWages).toBe('20000.00');
    expect(item(after, 'pf', 'deduction')).toBe('1800.00');
    expect(after.warnings.join(' ')).toMatch(/Labour Codes/);
  });

  it('pays PF on full wages when the firm chooses to', () => {
    const line = computePayLine(
      salary('20000', '10000', '10000'),
      { month: '2026-10', lossOfPayDays: 0, inputs: [] },
      { ...S, pf: { ...S.pf, onFullWages: true } },
    );
    expect(item(line, 'pf', 'deduction')).toBe('2400.00');
    // Pension still on the ceiling: 1,250; EPF takes the rest of 2,400.
    expect(item(line, 'pf_eps')).toBe('1250.00');
    expect(item(line, 'pf_epf')).toBe('1150.00');
  });

  it('adds inputs: arrears and incentive are pay, reimbursements are not, recoveries come off', () => {
    const line = computePayLine(
      salary('20000', '10000', '10000'),
      {
        month: '2026-10',
        lossOfPayDays: 0,
        inputs: [
          { kind: 'arrears', amount: '3000' },
          { kind: 'incentive', amount: '2000' },
          { kind: 'reimbursement', amount: '1500' },
          { kind: 'advance_recovery', amount: '5000' },
          { kind: 'tds', amount: '1234' },
        ],
      },
      S,
    );
    expect(line.gross).toBe('45000.00');
    expect(line.reimbursements).toBe('1500.00');
    // 1,800 PF + 200 PT + 1,234 TDS + 5,000 advance.
    expect(line.deductions).toBe('8234.00');
    expect(line.net).toBe('38266.00');
  });

  it('pays a stipend without deductions by default', () => {
    const stipend: SalaryStructureInput = {
      kind: 'stipend',
      ctc: '0',
      components: [{ code: 'stipend', label: 'Stipend', monthly: '12000' }],
      pfApplicable: true,
      esiApplicable: true,
      ptApplicable: true,
    };
    const line = computePayLine(stipend, { month: '2026-10', lossOfPayDays: 0, inputs: [] }, S);
    expect(line.deductions).toBe('0.00');
    expect(line.net).toBe('12000.00');
    expect(item(line, 'gratuity')).toBeUndefined();
    const withDeductions = computePayLine(
      stipend,
      { month: '2026-10', lossOfPayDays: 0, inputs: [] },
      { ...S, stipendDeductions: true },
    );
    expect(item(withDeductions, 'pt')).toBe('200.00');
  });

  it('works out arrears for a revision dated back', () => {
    const before = salary('20000', '10000', '10000').components;
    const after = salary('22000', '11000', '11000').components;
    // +4,000 a month: August full, September 15 of 30 days.
    expect(
      revisionArrears(before, after, [
        { month: '2026-08', payableDays: 31 },
        { month: '2026-09', payableDays: 15 },
      ]),
    ).toBe('6000.00');
  });

  it('refuses impossible days', () => {
    expect(() =>
      computePayLine(salary('1', '0', '0'), { month: '2026-10', lossOfPayDays: 32, inputs: [] }, S),
    ).toThrow(/Loss-of-pay days/);
    expect(() =>
      computePayLine(
        salary('1', '0', '0'),
        { month: '2026-10', joinedOn: '2026-11-01', lossOfPayDays: 0, inputs: [] },
        S,
      ),
    ).toThrow(/not in 2026-10/);
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('masks all but the last four', () => {
    expect(maskTail('123456789012')).toBe('••••••••9012');
    expect(maskTail('ABCDE1234F')).toBe('••••••234F');
  });
});
