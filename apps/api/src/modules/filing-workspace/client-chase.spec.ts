import { reminderChannelFor, whatsappNumber, whatsappUrl } from '@hsdg/contracts';
import { CLIENT_DATA_SLOTS, chasingDates, reminderText, slotItemLabel } from './client-chase';
import { previousMonth } from './monthly-data-request.scheduler';

describe('client chasing (WF-302)', () => {
  describe('chasingDates', () => {
    it('reminds T-7 and escalates T-3 against the internal date by default', () => {
      expect(chasingDates('2026-10-11', '2026-10-01')).toEqual({
        reminderDate: '2026-10-04',
        escalationDate: '2026-10-08',
      });
    });

    it('follows the firm policy', () => {
      expect(
        chasingDates('2026-10-20', '2026-10-01', { reminderDays: 10, escalationDays: 5 }),
      ).toEqual({ reminderDate: '2026-10-10', escalationDate: '2026-10-15' });
    });

    it('never dates a request in the past', () => {
      expect(chasingDates('2026-10-11', '2026-10-09')).toEqual({
        reminderDate: '2026-10-09',
        escalationDate: '2026-10-09',
      });
      expect(chasingDates('2026-10-11', '2026-10-06')).toEqual({
        reminderDate: '2026-10-06',
        escalationDate: '2026-10-08',
      });
    });

    it('crosses month and year ends', () => {
      expect(chasingDates('2027-01-02', '2026-12-01')).toEqual({
        reminderDate: '2026-12-26',
        escalationDate: '2026-12-30',
      });
    });

    it('leaves both open without an internal date', () => {
      expect(chasingDates(null, '2026-10-01')).toEqual({
        reminderDate: null,
        escalationDate: null,
      });
    });
  });

  it('labels an item by what the client sends, not the checklist tick', () => {
    expect(slotItemLabel('Sales register received')).toBe('Sales register');
    expect(slotItemLabel('GSTR-2B downloaded')).toBe('GSTR-2B');
    expect(slotItemLabel('Bank statement')).toBe('Bank statement');
  });

  it('asks the client for data, never for the firm’s own working or approval', () => {
    expect(CLIENT_DATA_SLOTS).toEqual(
      expect.arrayContaining(['SALES_REGISTER', 'PURCHASE_REGISTER', 'BANK_STATEMENT']),
    );
    for (const own of ['WORKING_3B', 'CLIENT_APPROVAL', 'GSTR2B', 'ITC_RECON', 'ACK_GSTR1']) {
      expect(CLIENT_DATA_SLOTS).not.toContain(own);
    }
  });

  describe('reminderText', () => {
    it('lists each item with its upload link', () => {
      const text = reminderText({
        entityName: 'Bharat Traders',
        formLabel: 'GSTR-1',
        periodKey: '2026-09',
        items: [
          { label: 'Sales register', uploadUrl: 'https://x/client-upload/a' },
          { label: 'E-way bill report', uploadUrl: 'https://x/client-upload/b' },
        ],
        dueBy: '2026-10-08',
        firmName: 'HSDG & Co',
      });
      expect(text).toContain('Dear Bharat Traders,');
      expect(text).toContain('To prepare your GSTR-1 for Sep 2026, we still need by 2026-10-08:');
      expect(text).toContain('• Sales register: https://x/client-upload/a');
      expect(text).toContain('• E-way bill report: https://x/client-upload/b');
      expect(text).toContain('secure link');
      expect(text.endsWith('Thank you,\nHSDG & Co')).toBe(true);
    });

    it('reads as plain text to paste when there are no links', () => {
      const text = reminderText({
        entityName: 'Bharat Traders',
        formLabel: 'GSTR-3B',
        periodKey: null,
        items: [{ label: 'Purchase register' }],
        dueBy: null,
      });
      expect(text).toContain('To prepare your GSTR-3B, we still need:');
      expect(text).toContain('• Purchase register\n');
      expect(text).toContain('Please share them at the earliest.');
      expect(text).not.toContain('http');
    });
  });

  it('runs the monthly request for the month just ended', () => {
    expect(previousMonth('2026-10-01')).toEqual({ periodKey: '2026-09' });
    expect(previousMonth('2027-01-01')).toEqual({ periodKey: '2026-12' });
  });
});

describe('the reminder channel (client_reminder_channel)', () => {
  it('reads a phone number the way wa.me wants it', () => {
    expect(whatsappNumber('98765 43210')).toBe('919876543210');
    expect(whatsappNumber('098765-43210')).toBe('919876543210');
    expect(whatsappNumber('+91 98765 43210')).toBe('919876543210');
    expect(whatsappNumber('0044 20 7946 0958')).toBe('442079460958');
    expect(whatsappNumber('12345')).toBeNull();
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });

  it('builds the wa.me link with the text filled in', () => {
    expect(whatsappUrl('9876543210', 'Dear Sir & Madam,\nplease send')).toBe(
      'https://wa.me/919876543210?text=Dear%20Sir%20%26%20Madam%2C%0Aplease%20send',
    );
    expect(whatsappUrl(null, 'x')).toBeNull();
  });

  it('follows the setting and falls back to copy with a reason', () => {
    const reachable = { canEmail: true, phone: '9876543210' };
    expect(reminderChannelFor('email', reachable)).toEqual({ channel: 'email', fallback: null });
    expect(reminderChannelFor('whatsapp', reachable)).toEqual({
      channel: 'whatsapp',
      fallback: null,
    });
    expect(reminderChannelFor('copy', reachable)).toEqual({ channel: 'copy', fallback: null });
    expect(reminderChannelFor('email', { canEmail: false, phone: '9876543210' })).toEqual({
      channel: 'copy',
      fallback: 'no_email',
    });
    expect(reminderChannelFor('whatsapp', { canEmail: true, phone: 'n/a' })).toEqual({
      channel: 'copy',
      fallback: 'no_phone',
    });
  });
});
