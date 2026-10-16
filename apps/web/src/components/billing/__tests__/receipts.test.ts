import type { OpenInvoice } from '@hsdg/contracts';
import { autoAllocate, checkAllocations, receiptGross, statementKindLabel } from '../receipts';

const inv = (id: string, dueDate: string, balance: string): OpenInvoice => ({
  id,
  invoiceNumber: `INV/26-27/${id}`,
  engagementId: 'e1',
  issueDate: '2026-04-01',
  dueDate,
  total: balance,
  balance,
});
const open = [inv('0002', '2026-09-30', '50000.00'), inv('0001', '2026-06-30', '30000.00')];

describe('receiptGross', () => {
  it('adds net and TDS, and waits for amounts', () => {
    expect(receiptGross('90000', '10000')).toBe('100000.00');
    expect(receiptGross('90000', '')).toBe('90000.00');
    expect(receiptGross('9o', '')).toBeNull();
  });
});

describe('autoAllocate', () => {
  it('fills the oldest due first and leaves the rest blank', () => {
    expect(autoAllocate('40000.00', open)).toEqual([
      { invoiceId: '0002', amount: '10000.00' },
      { invoiceId: '0001', amount: '30000.00' },
    ]);
    expect(autoAllocate('100.00', open)).toEqual([
      { invoiceId: '0002', amount: '' },
      { invoiceId: '0001', amount: '100.00' },
    ]);
    expect(autoAllocate(null, open).every((r) => r.amount === '')).toBe(true);
  });
});

describe('checkAllocations', () => {
  it('sends the non-zero rows and holds the rest as an advance', () => {
    expect(
      checkAllocations(
        '100000.00',
        [
          { invoiceId: '0002', amount: '50000' },
          { invoiceId: '0001', amount: '' },
        ],
        open,
      ),
    ).toEqual({
      ok: true,
      allocations: [{ invoiceId: '0002', amount: '50000.00' }],
      advance: '50000.00',
    });
  });

  it('refuses more than a balance, more than the receipt, or no amount', () => {
    expect(checkAllocations('100000', [{ invoiceId: '0001', amount: '30000.01' }], open)).toEqual({
      ok: false,
      error: 'More than the balance on INV/26-27/0001.',
    });
    expect(
      checkAllocations(
        '1000',
        [
          { invoiceId: '0001', amount: '600' },
          { invoiceId: '0002', amount: '600' },
        ],
        open,
      ).ok,
    ).toBe(false);
    expect(checkAllocations(null, [], open)).toEqual({
      ok: false,
      error: 'Enter the amount received.',
    });
  });
});

describe('statementKindLabel', () => {
  it('names each entry', () => {
    expect(statementKindLabel('tds')).toBe('TDS deducted');
    expect(statementKindLabel('marked_paid')).toBe('Marked paid');
  });
});
