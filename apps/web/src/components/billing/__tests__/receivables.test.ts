import type { InvoiceReminderRecord } from '@hsdg/contracts';
import { oldestLine } from '../receivables';
import { invoiceReminderLine } from '../invoice-reminders';
import { parseReminderDays, settingsChanges } from '../billing-settings';

describe('PS-203 receivables on the web', () => {
  const o = {
    id: 'i',
    invoiceNumber: 'INV/26-27/0012',
    engagementId: 'e',
    dueDate: '2026-09-01',
    balance: '100.00',
  };
  it('says how old the oldest invoice is', () => {
    expect(oldestLine({ ...o, daysPastDue: 45 })).toBe('INV/26-27/0012 · 45 days overdue');
    expect(oldestLine({ ...o, daysPastDue: 1 })).toBe('INV/26-27/0012 · 1 day overdue');
    expect(oldestLine({ ...o, daysPastDue: 0 })).toBe('INV/26-27/0012 · due today');
    expect(oldestLine({ ...o, invoiceNumber: null, daysPastDue: -3 })).toBe(
      'Invoice · due in 3 days',
    );
  });

  it('describes a reminder sent', () => {
    const r: InvoiceReminderRecord = {
      id: 'r',
      channel: 'whatsapp',
      automatic: false,
      daysPastDue: 20,
      sentByName: 'Manager X',
      createdAt: '2026-10-16T10:00:00.000Z',
    };
    expect(invoiceReminderLine(r)).toMatch(
      /^Reminded .+ · WhatsApp · 20 days past due · Manager X$/,
    );
    expect(
      invoiceReminderLine({ ...r, channel: 'email', automatic: true, daysPastDue: 0 }),
    ).toMatch(/ · e-mailed · automatic$/);
  });

  it('reads the reminder days', () => {
    expect(parseReminderDays('30, 7 15,7')).toEqual([7, 15, 30]);
    expect(parseReminderDays('')).toEqual([]);
    expect(parseReminderDays('0')).toBeNull();
    expect(parseReminderDays('7, x')).toBeNull();
    expect(parseReminderDays('1 2 3 4 5 6 7')).toBeNull();
  });

  it('sends only the reminder settings that changed', () => {
    const before = {
      firmName: 'F',
      address: null,
      gstin: null,
      stateCode: null,
      sacDefault: '998221',
      invoicePrefix: 'INV',
      invoiceTermsDays: 15,
      invoiceReminderDays: [7, 15, 30],
      autoInvoiceReminders: false,
      tdsMatchTolerance: '1.00',
      gstFiledThrough: null,
      version: 3,
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const form = {
      gstin: '',
      stateCode: '',
      sacDefault: '998221',
      invoicePrefix: 'INV',
      invoiceTermsDays: '15',
    };
    expect(settingsChanges(before, { ...form, invoiceReminderDays: '7,15, 30' })).toEqual({
      version: 3,
    });
    expect(
      settingsChanges(before, {
        ...form,
        invoiceReminderDays: '10, 20',
        autoInvoiceReminders: true,
      }),
    ).toEqual({ version: 3, invoiceReminderDays: [10, 20], autoInvoiceReminders: true });
  });
});
