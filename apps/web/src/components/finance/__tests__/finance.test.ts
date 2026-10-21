import { PERMISSION, type BankMatchLine, type GstOutwardRegister } from '@hsdg/contracts';
import type { Principal } from '@/lib/principal';
import {
  canReadFinance,
  currentMonth,
  gstr1Due,
  receiptFromMatch,
  registerSections,
  shiftMonth,
  tieDifference,
  voucherAmount,
} from '../finance';

const who = (...permissions: string[]) => ({ permissions }) as unknown as Principal;
const zero = { taxable: '0.00', igst: '0.00', cgst: '0.00', sgst: '0.00', total: '0.00' };

describe('finance reports', () => {
  it('is for those who read the firm’s billing', () => {
    expect(canReadFinance(who(PERMISSION.entityReadBilling))).toBe(true);
    expect(canReadFinance(who(PERMISSION.reportRead))).toBe(false);
    expect(canReadFinance(null)).toBe(false);
  });

  it('works months in IST', () => {
    // 20:00 UTC on 31 Oct is 1 Nov in India.
    expect(currentMonth(new Date('2026-10-31T20:00:00Z'))).toBe('2026-11');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(gstr1Due('2026-12')).toBe('2027-01-11');
  });

  it('sums the register tables and the tie-out difference', () => {
    const item = (taxable: string) => ({
      rate: '18',
      taxable,
      igst: '0.00',
      cgst: '0.00',
      sgst: '0.00',
      cess: '0.00',
    });
    const r = {
      b2b: [{ items: [item('1000.00'), item('500.50')] }, { items: [item('200.00')] }],
      b2cl: [],
      b2cs: [{ taxable: '300.00' }, { taxable: '-100.00' }],
      cdnr: [{ items: [item('50.00')] }],
      cdnur: [],
    } as unknown as GstOutwardRegister;
    expect(registerSections(r).map((s) => [s.key, s.count, s.taxable])).toEqual([
      ['b2b', 2, '1700.50'],
      ['b2cl', 0, '0.00'],
      ['b2cs', 2, '200.00'],
      ['cdnr', 1, '50.00'],
      ['cdnur', 0, '0.00'],
    ]);
    expect(
      tieDifference(
        { ...zero, taxable: '10.00', total: '11.80' },
        { ...zero, taxable: '10.00', total: '11.00' },
      ),
    ).toEqual({
      ...zero,
      total: '0.80',
    });
  });

  it('gives a voucher its debit total', () => {
    expect(
      voucherAmount({
        entries: [
          { ledger: 'Bank', debit: '900.00', credit: '0.00' },
          { ledger: 'TDS Receivable', debit: '100.00', credit: '0.00' },
          { ledger: 'Client', debit: '0.00', credit: '1000.00' },
        ],
      } as never),
    ).toBe('1000.00');
  });

  it('fills a receipt from a matched credit', () => {
    const line: BankMatchLine = {
      credit: {
        row: 5,
        date: '2026-10-05',
        narration: 'NEFT CR-LAKE VIEW',
        reference: null,
        amount: '10800.00',
      },
      recordedReceiptId: null,
      proposals: [],
    };
    expect(
      receiptFromMatch(line, {
        clientId: 'c1',
        clientName: 'Lake View',
        gross: '11800.00',
        tds: '1000.00',
        confidence: 'high',
        reasons: [],
        invoices: [
          { invoiceId: 'i1', invoiceNumber: 'INV/1', balance: '11800.00', allocate: '11800.00' },
        ],
      }),
    ).toEqual({
      receivedOn: '2026-10-05',
      reference: 'NEFT CR-LAKE VIEW',
      net: '10800.00',
      tds: '1000.00',
      allocations: [{ invoiceId: 'i1', amount: '11800.00' }],
    });
  });
});
