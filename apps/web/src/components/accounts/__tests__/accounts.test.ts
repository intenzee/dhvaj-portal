import { PERMISSION, type AccountsDesk, type ApprovalItem, type ClientBillingProfile } from '@hsdg/contracts';
import type { Principal } from '@/lib/principal';
import {
  addressLine,
  barWidths,
  canReadAccounts,
  deskQueues,
  mayWithdraw,
  monthLabel,
  profileGaps,
} from '../accounts';

const who = (...permissions: string[]) => ({ permissions }) as unknown as Principal;

const queues = (over: Partial<AccountsDesk['queues']> = {}): AccountsDesk['queues'] => ({
  readyToIssue: 0,
  unbilledFeesDue: 0,
  receiptsUnallocated: 0,
  tdsNotIn26as: 0,
  remindersDueToday: 0,
  waitingForPartner: 0,
  payrollToBook: null,
  ...over,
});

const profile = (over: Partial<ClientBillingProfile> = {}): ClientBillingProfile => ({
  id: 'c',
  entityCode: 'CL-1',
  legalName: 'Lake View Traders',
  displayName: null,
  pan: 'AAAAA0000A',
  status: 'active',
  gstin: '19AAAAA0000A1Z5',
  gstinCount: 1,
  stateCode: '19',
  billingAddress: null,
  address: null,
  contact: { name: null, email: 'accounts@example.test', phone: null },
  creditTermsDays: 15,
  ...over,
});

describe('Accounts desk', () => {
  it('opens to billers, report readers and billing-profile readers only', () => {
    expect(canReadAccounts(who(PERMISSION.entityReadBilling))).toBe(true);
    expect(canReadAccounts(who(PERMISSION.billingManage))).toBe(true);
    expect(canReadAccounts(who(PERMISSION.reportRead))).toBe(true);
    expect(canReadAccounts(who(PERMISSION.engagementRead))).toBe(false);
    expect(canReadAccounts(null)).toBe(false);
  });

  it('shows only the queues with work, each linking to its list', () => {
    const q = deskQueues(queues({ readyToIssue: 2, waitingForPartner: 1 }));
    expect(q.map((x) => [x.key, x.count, x.href])).toEqual([
      ['readyToIssue', 2, '/billing?status=draft'],
      ['waitingForPartner', 1, '/billing/approvals?scope=all'],
    ]);
    expect(deskQueues(queues())).toEqual([]);
  });

  it('keeps payroll out until payroll is on', () => {
    expect(deskQueues(queues({ payrollToBook: null }))).toEqual([]);
    expect(deskQueues(queues({ payrollToBook: 3 }))[0]?.key).toBe('payrollToBook');
  });

  it('names months and scales bars against the largest', () => {
    expect(monthLabel('2026-10')).toBe('Oct 2026');
    expect(monthLabel('bad')).toBe('bad');
    expect(barWidths(['100.00', '50.00', '0.00', '0.40'])).toEqual([100, 50, 0, 2]);
    expect(barWidths(['0.00'])).toEqual([0]);
  });
});

describe('Approvals sent', () => {
  const item = (over: Partial<ApprovalItem>) =>
    ({ kind: 'invoice_issue', status: 'pending', requestedById: 'e1', ...over }) as ApprovalItem;

  it('lets only the asker take back an open issue request', () => {
    expect(mayWithdraw(item({}), 'e1')).toBe(true);
    expect(mayWithdraw(item({}), 'e2')).toBe(false);
    expect(mayWithdraw(item({}), null)).toBe(false);
    expect(mayWithdraw(item({ status: 'issued' }), 'e1')).toBe(false);
    expect(mayWithdraw(item({ kind: 'credit_note' }), 'e1')).toBe(false);
  });
});

describe('billing profile', () => {
  it('writes the address from its parts, else the free-text one', () => {
    expect(
      addressLine(
        profile({
          address: {
            line1: 'Flat 4, Lake View',
            line2: ' ',
            city: 'Kolkata',
            state: 'West Bengal',
            pincode: '700001',
            country: 'India',
          },
        }),
      ),
    ).toBe('Flat 4, Lake View, Kolkata 700001, West Bengal');
    expect(addressLine(profile({ billingAddress: '12 Park St, Kolkata' }))).toBe('12 Park St, Kolkata');
    expect(addressLine(profile())).toBeNull();
  });

  it('flags what would make an invoice wrong', () => {
    expect(profileGaps(profile())).toEqual([]);
    expect(
      profileGaps(profile({ gstin: null, gstinCount: 2, stateCode: null, contact: { name: null, email: null, phone: null } })),
    ).toHaveLength(3);
  });
});
