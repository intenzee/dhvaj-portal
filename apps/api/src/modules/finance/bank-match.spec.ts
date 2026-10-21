import {
  findColumns,
  matchCredits,
  nameHit,
  parseBankAmount,
  parseBankDate,
  parseStatement,
  tdsOn,
  type OpenInvoice,
} from './bank-match';

const open = (over: Partial<OpenInvoice>): OpenInvoice => ({
  id: 'i1',
  number: 'INV/26-27/0001',
  clientId: 'c1',
  clientName: 'Lake View Traders Pvt Ltd',
  issueDate: '2026-09-05',
  balance: '11800.00',
  subtotal: '10000.00',
  total: '11800.00',
  ...over,
});

const credit = (amount: string, narration: string, date = '2026-10-06') => ({
  row: 2,
  date,
  narration,
  reference: null,
  amount,
});

describe('bank statement: reading the file', () => {
  it('reads day-first dates, ISO dates and Excel serials', () => {
    expect(parseBankDate('05/10/2026')).toBe('2026-10-05');
    expect(parseBankDate('05-10-26')).toBe('2026-10-05');
    expect(parseBankDate('5 Oct 2026')).toBe('2026-10-05');
    expect(parseBankDate('05-Oct-26')).toBe('2026-10-05');
    expect(parseBankDate('2026-10-05')).toBe('2026-10-05');
    expect(parseBankDate(46300)).toBe('2026-10-05');
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankDate('Opening balance')).toBeNull();
  });

  it('reads Indian amounts', () => {
    expect(parseBankAmount('1,18,000.00')).toBe(11800000n);
    expect(parseBankAmount('118000 Cr')).toBe(11800000n);
    expect(parseBankAmount(59000)).toBe(5900000n);
    expect(parseBankAmount('')).toBeNull();
    expect(parseBankAmount('0.00')).toBeNull();
  });

  it('finds the header under the bank preamble, with separate debit and credit columns', () => {
    const rows = [
      ['HDFC BANK Ltd.'],
      ['Account No : XXXXXXXX1234'],
      [],
      [
        'Date',
        'Narration',
        'Chq./Ref.No.',
        'Value Dt',
        'Withdrawal Amt.',
        'Deposit Amt.',
        'Closing Balance',
      ],
      [
        '05/10/26',
        'NEFT CR-LAKE VIEW TRADERS PVT LTD',
        'N278261234',
        '05/10/26',
        '',
        '10,800.00',
        '1,10,800.00',
      ],
      ['06/10/26', 'POS PURCHASE', '', '06/10/26', '1,200.00', '', '1,09,600.00'],
    ];
    expect(findColumns(rows)).toMatchObject({
      header: 3,
      date: 0,
      narration: 1,
      reference: 2,
      credit: 5,
      debit: 4,
    });
    const s = parseStatement(rows)!;
    expect(s.credits).toEqual([
      {
        row: 5,
        date: '2026-10-05',
        narration: 'NEFT CR-LAKE VIEW TRADERS PVT LTD',
        reference: 'N278261234',
        amount: '10800.00',
      },
    ]);
    expect(s.debitsSkipped).toBe(1);
    expect(s.columns).toEqual({
      date: 'Date',
      narration: 'Narration',
      credit: 'Deposit Amt.',
      reference: 'Chq./Ref.No.',
    });
  });

  it('reads an amount with a Cr/Dr column', () => {
    const rows = [
      ['Txn Date', 'Description', 'Amount', 'Cr/Dr'],
      ['2026-10-07', 'UPI/R SEN', '5000', 'CR'],
      ['2026-10-07', 'ATM', '2000', 'DR'],
    ];
    const s = parseStatement(rows)!;
    expect(s.credits.map((c) => c.amount)).toEqual(['5000.00']);
    expect(s.debitsSkipped).toBe(1);
  });

  it('says no statement when it finds no header', () => {
    expect(
      parseStatement([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBeNull();
  });
});

describe('bank statement: proposing invoices', () => {
  it('works TDS at 10% of the taxable part of the balance', () => {
    expect(tdsOn(open({}))).toBe(100000n);
    expect(tdsOn(open({ balance: '5900.00' }))).toBe(50000n);
  });

  it('matches names on their significant words', () => {
    expect(nameHit('Lake View Traders Pvt Ltd', 'NEFT CR-LAKE VIEW TRADERS')).toBe(true);
    expect(nameHit('Lake View Traders Pvt Ltd', 'NEFT CR-PVT LTD')).toBe(false);
    expect(nameHit('R. Sen', 'UPI/R SEN')).toBe(false);
  });

  it('is sure when the amount is the balance less TDS and the client is named', () => {
    const [line] = matchCredits([credit('10800.00', 'NEFT CR-LAKE VIEW TRADERS')], [open({})], []);
    expect(line!.proposals).toEqual([
      expect.objectContaining({
        clientId: 'c1',
        gross: '11800.00',
        tds: '1000.00',
        confidence: 'high',
        invoices: [
          {
            invoiceId: 'i1',
            invoiceNumber: 'INV/26-27/0001',
            balance: '11800.00',
            allocate: '11800.00',
          },
        ],
      }),
    ]);
  });

  it('accepts TDS rounded to the rupee, and takes the TDS as the difference', () => {
    const [line] = matchCredits([credit('10801.00', 'LAKE VIEW TRADERS')], [open({})], []);
    expect(line!.proposals[0]).toMatchObject({
      tds: '999.00',
      gross: '11800.00',
      confidence: 'high',
    });
  });

  it('finds two invoices of a named client that make the credit', () => {
    const invs = [
      open({}),
      open({
        id: 'i2',
        number: 'INV/26-27/0002',
        issueDate: '2026-09-20',
        balance: '5900.00',
        subtotal: '5000.00',
        total: '5900.00',
      }),
      open({
        id: 'i3',
        number: 'INV/26-27/0003',
        issueDate: '2026-10-01',
        balance: '2360.00',
        subtotal: '2000.00',
        total: '2360.00',
      }),
    ];
    const [line] = matchCredits([credit('17700.00', 'LAKE VIEW TRADERS')], invs, []);
    expect(line!.proposals[0]!.invoices.map((i) => i.invoiceId)).toEqual(['i1', 'i2']);
    expect(line!.proposals[0]!.tds).toBe('0.00');
  });

  it('reads the invoice number from the narration even without its slashes', () => {
    const [line] = matchCredits([credit('5000.00', 'NEFT INV2627 0001 PART')], [open({})], []);
    expect(line!.proposals[0]).toMatchObject({ confidence: 'medium', gross: '5000.00' });
    expect(line!.proposals[0]!.invoices[0]!.allocate).toBe('5000.00');
  });

  it('calls an amount that fits several unnamed clients a guess', () => {
    const invs = [
      open({}),
      open({
        id: 'i9',
        number: 'INV/26-27/0009',
        clientId: 'c2',
        clientName: 'Marine Drive Exports',
      }),
    ];
    const [line] = matchCredits([credit('11800.00', 'CHQ DEP 000123')], invs, []);
    expect(line!.proposals.map((p) => p.confidence)).toEqual(['low', 'low']);
  });

  it('spots a credit already recorded as a receipt', () => {
    const [line] = matchCredits(
      [credit('10800.00', 'LAKE VIEW TRADERS', '2026-10-06')],
      [open({})],
      [{ id: 'r1', date: '2026-10-05', net: '10800.00' }],
    );
    expect(line!.recordedReceiptId).toBe('r1');
  });
});
