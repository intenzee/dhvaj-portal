import {
  INVOICE_NUMBER_MAX,
  allocateOldestFirst,
  amountInWords,
  financialYearOf,
  formatInr,
  fromPaise,
  gstSplit,
  invoiceNumberFor,
  sumAmounts,
  tdsQuarterOf,
  toPaise,
} from '@hsdg/contracts';

describe('PS-201 money helpers', () => {
  describe('gstSplit', () => {
    it('splits intra-state tax into equal CGST and SGST', () => {
      const s = gstSplit([{ taxableValue: '100000', gstRate: 18 }], '07', '07');
      expect(s).toMatchObject({
        intraState: true,
        taxable: '100000.00',
        cgst: '9000.00',
        sgst: '9000.00',
        igst: '0.00',
        tax: '18000.00',
        total: '118000.00',
      });
    });

    it('charges IGST when the place of supply is another state', () => {
      const s = gstSplit([{ taxableValue: '100000.00', gstRate: '18' }], '07', '27');
      expect(s).toMatchObject({ intraState: false, cgst: '0.00', igst: '18000.00' });
      expect(s.total).toBe('118000.00');
    });

    it('rounds each half to the paisa, half up', () => {
      // 12.50 × 9% = 1.125 → 1.13 each; 12.50 × 18% = 2.25 exactly.
      expect(gstSplit([{ taxableValue: '12.50', gstRate: 18 }], '07', '07')).toMatchObject({
        cgst: '1.13',
        sgst: '1.13',
        tax: '2.26',
      });
      expect(gstSplit([{ taxableValue: '12.50', gstRate: 18 }], '07', '09').tax).toBe('2.25');
      expect(gstSplit([{ taxableValue: '333.33', gstRate: 18 }], '07', '07').tax).toBe('60.00');
    });

    it('works tax per rate on the summed lines, highest rate first', () => {
      const s = gstSplit(
        [
          { taxableValue: '1000', gstRate: 18 },
          { taxableValue: '500', gstRate: 5 },
          { taxableValue: '200', gstRate: 18 },
        ],
        '27',
        '07',
      );
      expect(s.igst).toBe('241.00');
      expect(s.byRate.map((b) => [b.rate, b.taxable, b.igst])).toEqual([
        ['18', '1200.00', '216.00'],
        ['5', '500.00', '25.00'],
      ]);
    });

    it('treats a missing place of supply as the firm state, and no lines as nothing', () => {
      expect(gstSplit([{ taxableValue: 10, gstRate: 18 }], '07', null).intraState).toBe(true);
      expect(gstSplit([], '07', '07')).toMatchObject({ tax: '0.00', total: '0.00', byRate: [] });
    });

    it('keeps exempt lines at nil tax', () => {
      expect(gstSplit([{ taxableValue: '5000', gstRate: 0 }], '07', '07').tax).toBe('0.00');
    });
  });

  describe('amountInWords', () => {
    it.each([
      ['118000', 'Rupees One Lakh Eighteen Thousand Only'],
      ['10.50', 'Rupees Ten and Fifty Paise Only'],
      ['0', 'Rupees Zero Only'],
      ['101', 'Rupees One Hundred One Only'],
      [
        '12345678.90',
        'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety Paise Only',
      ],
      ['1000000000', 'Rupees One Hundred Crore Only'],
      [
        '99999.99',
        'Rupees Ninety-Nine Thousand Nine Hundred Ninety-Nine and Ninety-Nine Paise Only',
      ],
    ])('%s → %s', (amount, words) => {
      expect(amountInWords(amount)).toBe(words);
    });
  });

  describe('paise', () => {
    it('round-trips decimal strings exactly', () => {
      expect(toPaise('1234.5')).toBe(123450n);
      expect(toPaise('-0.01')).toBe(-1n);
      expect(fromPaise(123450n)).toBe('1234.50');
      expect(fromPaise(-5n)).toBe('-0.05');
      expect(() => toPaise('12a')).toThrow();
    });

    it('groups rupees in lakhs and crores', () => {
      expect(formatInr('118000')).toBe('1,18,000.00');
      expect(formatInr('12345678.9')).toBe('1,23,45,678.90');
      expect(formatInr('999')).toBe('999.00');
      expect(formatInr('-1000')).toBe('-1,000.00');
    });
  });

  describe('financial year and number', () => {
    it('starts the year in April', () => {
      expect(financialYearOf('2026-03-31')).toBe('2025-26');
      expect(financialYearOf('2026-04-01')).toBe('2026-27');
      expect(financialYearOf('2099-12-01')).toBe('2099-00');
    });

    it('fits a five-letter prefix inside rule 46’s 16 characters', () => {
      expect(invoiceNumberFor('INV', '2026-27', 1)).toBe('INV/26-27/0001');
      expect(invoiceNumberFor('ABCDE', '2026-27', 9999)).toHaveLength(INVOICE_NUMBER_MAX);
    });
  });
});

describe('allocateOldestFirst (PS-202)', () => {
  const inv = (id: string, dueDate: string | null, balance: string, issueDate = '2026-04-01') => ({
    id,
    issueDate,
    dueDate,
    balance,
  });

  it('pays the oldest due first and keeps the rest as an advance', () => {
    expect(
      allocateOldestFirst('150000.00', [
        inv('b', '2026-09-30', '100000.00'),
        inv('a', '2026-06-30', '30000.50'),
      ]),
    ).toEqual({
      allocations: [
        { invoiceId: 'a', amount: '30000.50' },
        { invoiceId: 'b', amount: '100000.00' },
      ],
      unallocated: '19999.50',
    });
  });

  it('pays part of an invoice when the money runs out', () => {
    expect(allocateOldestFirst('40000', [inv('a', '2026-06-30', '100000.00')])).toEqual({
      allocations: [{ invoiceId: 'a', amount: '40000.00' }],
      unallocated: '0.00',
    });
  });

  it('skips settled invoices and falls back to the issue date without a due date', () => {
    expect(
      allocateOldestFirst('10', [
        inv('late', null, '10.00', '2026-08-01'),
        inv('paid', '2026-05-01', '0.00'),
        inv('early', null, '10.00', '2026-05-01'),
      ]).allocations,
    ).toEqual([{ invoiceId: 'early', amount: '10.00' }]);
  });

  it('keeps it all as an advance when nothing is open', () => {
    expect(allocateOldestFirst('500', [])).toEqual({ allocations: [], unallocated: '500.00' });
  });
});

describe('tdsQuarterOf (PS-202)', () => {
  it('puts a date in its financial-year quarter', () => {
    expect(tdsQuarterOf('2026-04-01')).toEqual({ financialYear: '2026-27', quarter: 'Q1' });
    expect(tdsQuarterOf('2026-09-30')).toEqual({ financialYear: '2026-27', quarter: 'Q2' });
    expect(tdsQuarterOf('2026-10-16')).toEqual({ financialYear: '2026-27', quarter: 'Q3' });
    expect(tdsQuarterOf('2027-03-31')).toEqual({ financialYear: '2026-27', quarter: 'Q4' });
  });

  it('sums amounts exactly', () => {
    expect(sumAmounts(['0.10', '0.20', 0.3])).toBe('0.60');
  });
});
