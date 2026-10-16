import { PERMISSION, type BillingSettings } from '@hsdg/contracts';
import { invoiceActions, invoiceNumberLabel, stateLabel, taxRows } from '../invoice-gst';
import { settingsChanges } from '../billing-settings';

const zero = { cgst: '0.00', sgst: '0.00', igst: '0.00', isReverseCharge: false };

describe('invoiceNumberLabel', () => {
  it('shows the number, or that a draft is numbered at issue', () => {
    expect(invoiceNumberLabel({ invoiceNumber: 'INV/26-27/0001' })).toBe('INV/26-27/0001');
    expect(invoiceNumberLabel({ invoiceNumber: null })).toBe('Draft (numbered at issue)');
  });
});

describe('stateLabel', () => {
  it('names a GST state code', () => {
    expect(stateLabel('07')).toBe('Delhi (07)');
    expect(stateLabel('99x')).toBe('99x');
    expect(stateLabel(null)).toBe('—');
  });
});

describe('taxRows', () => {
  it('keeps the single hand-entered tax on legacy invoices', () => {
    expect(taxRows({ ...zero, taxAmount: '180.00' })).toEqual([{ label: 'Tax', amount: '180.00' }]);
  });

  it('splits CGST and SGST intra-state', () => {
    expect(taxRows({ ...zero, cgst: '90.00', sgst: '90.00', taxAmount: '180.00' })).toEqual([
      { label: 'CGST', amount: '90.00' },
      { label: 'SGST', amount: '90.00' },
    ]);
  });

  it('shows IGST inter-state and marks reverse charge', () => {
    expect(taxRows({ ...zero, igst: '180.00', isReverseCharge: true, taxAmount: '0.00' })).toEqual([
      { label: 'IGST (reverse charge, payable by the client)', amount: '180.00' },
    ]);
  });
});

describe('invoiceActions', () => {
  const manage = [PERMISSION.billingManage];
  const approve = [PERMISSION.billingManage, PERMISSION.billingApprove];

  it('lets billing.manage issue a draft; anyone may discard one', () => {
    expect(invoiceActions({ status: 'draft' }, manage)).toEqual({
      issue: true,
      voidDraft: true,
      voidIssued: false,
      markPaid: false,
      recordReceipt: false,
    });
    expect(invoiceActions({ status: 'draft' }, []).issue).toBe(false);
  });

  it('keeps voiding an issued invoice to billing.approve', () => {
    expect(invoiceActions({ status: 'issued' }, manage).voidIssued).toBe(false);
    expect(invoiceActions({ status: 'issued' }, approve)).toEqual({
      issue: false,
      voidDraft: false,
      voidIssued: true,
      markPaid: true,
      recordReceipt: false,
    });
  });

  it('records a receipt instead of marking paid once receipts are on (PS-202)', () => {
    expect(invoiceActions({ status: 'issued' }, manage, true)).toMatchObject({
      markPaid: false,
      recordReceipt: true,
    });
    expect(invoiceActions({ status: 'partially_paid' }, manage, true).recordReceipt).toBe(true);
    expect(invoiceActions({ status: 'partially_paid' }, approve, true).voidIssued).toBe(false);
    expect(invoiceActions({ status: 'issued' }, [], true).recordReceipt).toBe(false);
  });

  it('offers nothing on a void or paid invoice', () => {
    for (const status of ['void', 'paid'] as const) {
      expect(Object.values(invoiceActions({ status }, approve)).some(Boolean)).toBe(false);
    }
  });
});

describe('settingsChanges', () => {
  const before: BillingSettings = {
    firmName: 'Dhvaj & Co',
    address: null,
    gstin: null,
    stateCode: null,
    sacDefault: '998221',
    invoicePrefix: 'INV',
    invoiceTermsDays: 15,
    version: 3,
    updatedAt: '2026-10-16T00:00:00Z',
  };
  const form = {
    gstin: '',
    stateCode: '',
    sacDefault: '998221',
    invoicePrefix: 'INV',
    invoiceTermsDays: '15',
  };

  it('sends only the version when nothing changed', () => {
    expect(settingsChanges(before, form)).toEqual({ version: 3 });
  });

  it('takes the state from the GSTIN and upper-cases the prefix', () => {
    expect(
      settingsChanges(before, {
        ...form,
        gstin: ' 07aaafd1234k1z5 ',
        stateCode: '27',
        invoicePrefix: 'dh',
      }),
    ).toEqual({ version: 3, gstin: '07AAAFD1234K1Z5', stateCode: '07', invoicePrefix: 'DH' });
  });

  it('clears the GSTIN and keeps a hand-picked state', () => {
    const set = { ...before, gstin: '07AAAFD1234K1Z5', stateCode: '07' };
    expect(settingsChanges(set, { ...form, stateCode: '07', invoiceTermsDays: '30' })).toEqual({
      version: 3,
      gstin: null,
      invoiceTermsDays: 30,
    });
  });
});
