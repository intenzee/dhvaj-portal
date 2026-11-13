import { PERMISSION, type BillingSettings } from '@hsdg/contracts';
import { invoiceActions, invoiceNumberLabel, lineRateLabel, stateLabel, taxRows } from '../invoice-gst';
import { isMonthEnd, settingsChanges } from '../billing-settings';

const zero = { cgst: '0.00', sgst: '0.00', igst: '0.00', isReverseCharge: false };

describe('invoiceNumberLabel', () => {
  it('shows the number, or that a draft is numbered at issue', () => {
    expect(invoiceNumberLabel({ invoiceNumber: '202627/11/07' })).toBe('202627/11/07');
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

describe('lineRateLabel', () => {
  it('names the rate only when GST is charged', () => {
    expect(lineRateLabel('18.00')).toBe('18%');
    expect(lineRateLabel('0.00')).toBe('');
    expect(lineRateLabel(null)).toBe('');
  });
});

describe('taxRows', () => {
  it('shows no tax line when none is charged', () => {
    expect(taxRows({ ...zero, taxAmount: '0.00' })).toEqual([]);
  });

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
      edit: true,
      remove: false,
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
      edit: true,
      remove: true,
    });
  });

  it('lets anyone who bills edit or delete an issued invoice until something blocks it', () => {
    expect(invoiceActions({ status: 'issued' }, manage)).toMatchObject({ edit: true, remove: true });
    expect(
      invoiceActions({ status: 'issued' }, [PERMISSION.engagementManage]),
    ).toMatchObject({ edit: true, remove: true });
    expect(invoiceActions({ status: 'issued' }, [])).toMatchObject({ edit: false, remove: false });
    const blocked = { status: 'issued' as const, editBlockedReason: 'In a filed GSTR-1.' };
    expect(invoiceActions(blocked, approve)).toMatchObject({ edit: false, remove: false });
    expect(invoiceActions({ status: 'void' }, approve)).toMatchObject({ edit: false, remove: false });
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
    invoiceReminderDays: [7, 15, 30],
    autoInvoiceReminders: false,
    tdsMatchTolerance: '1.00',
    billingFrom: null,
    gstFiledThrough: null,
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

describe('isMonthEnd (GSTR-1 filed through, PS-205)', () => {
  it('takes the last day of a month, or blank', () => {
    expect(isMonthEnd('2026-09-30')).toBe(true);
    expect(isMonthEnd('2027-02-28')).toBe(true);
    expect(isMonthEnd('2028-02-29')).toBe(true);
    expect(isMonthEnd(null)).toBe(true);
    expect(isMonthEnd('2026-09-29')).toBe(false);
    expect(isMonthEnd('2026-02-30')).toBe(false);
    expect(isMonthEnd('30-09-2026')).toBe(false);
  });
});
