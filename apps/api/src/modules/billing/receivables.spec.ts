import {
  autoInvoiceReminderDue,
  invoiceOverdueNudge,
  invoiceReminderText,
  receivableBand,
} from '@hsdg/contracts';
import { buildReceivables, type OpenReceivable } from './receivables';

describe('PS-203 receivables', () => {
  it('bands days past due at their edges', () => {
    expect([-1, 0, 30, 31, 60, 61, 90, 91, 180, 181].map((d) => receivableBand(d))).toEqual([
      'current',
      'd0_30',
      'd0_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'd91_180',
      'd91_180',
      'over_180',
    ]);
  });

  it('nudges at 15, 30 and 60 days past due', () => {
    expect([14, 15, 29, 30, 59, 60, 400].map(invoiceOverdueNudge)).toEqual([
      null,
      15,
      15,
      30,
      30,
      60,
      60,
    ]);
  });

  describe('autoInvoiceReminderDue', () => {
    const days = [7, 15, 30];
    it('sends the latest reminder day reached, once', () => {
      expect(autoInvoiceReminderDue(6, days, [])).toBeNull();
      expect(autoInvoiceReminderDue(7, days, [])).toBe(7);
      expect(autoInvoiceReminderDue(10, days, [7])).toBeNull();
      expect(autoInvoiceReminderDue(16, days, [7])).toBe(15);
    });
    it('never sends a backlog when switched on late', () => {
      expect(autoInvoiceReminderDue(45, days, [])).toBe(30);
      expect(autoInvoiceReminderDue(45, days, [30])).toBeNull();
    });
  });

  it('writes the reminder a client reads', () => {
    const text = invoiceReminderText({
      clientName: 'Bharat Traders',
      invoiceNumber: 'HSDG/26-27/0012',
      issueDate: '2026-08-01',
      dueDate: '2026-08-16',
      balance: '59000.00',
      daysPastDue: 20,
      firmName: 'Dhvaj & Co',
    });
    expect(text).toContain('Bharat Traders');
    expect(text).toContain('HSDG/26-27/0012');
    expect(text).toContain('01/08/2026');
    expect(text).toContain('16/08/2026');
    expect(text).toContain('59,000');
    expect(text).toContain('Dhvaj & Co');
  });

  describe('buildReceivables', () => {
    const row = (o: Partial<OpenReceivable>): OpenReceivable => ({
      id: 'i1',
      invoiceNumber: 'INV/1',
      engagementId: 'e1',
      clientId: 'c1',
      clientName: 'Alpha',
      partnerId: 'p1',
      partnerName: 'Partner A',
      dueDate: '2026-08-01',
      daysPastDue: 10,
      balance: '1000.00',
      ...o,
    });

    it('sums each client and partner by band, with the oldest invoice', () => {
      const r = buildReceivables(
        '2026-10-17',
        [
          row({ id: 'i1', daysPastDue: 10, balance: '1000.00' }),
          row({ id: 'i2', daysPastDue: 100, balance: '2500.50' }),
          row({ id: 'i3', clientId: 'c2', clientName: 'Beta', daysPastDue: -5, balance: '300' }),
          row({ id: 'i4', clientId: 'c2', clientName: 'Beta', partnerId: null, partnerName: null }),
        ],
        new Map([['c1', { date: '2026-09-01', amount: '500.00' }]]),
      );
      expect(r.totals).toMatchObject({
        current: '300.00',
        d0_30: '2000.00',
        d91_180: '2500.50',
        total: '4800.50',
        over90: '2500.50',
      });
      const [alpha, beta] = r.byClient;
      expect(alpha).toMatchObject({
        id: 'c1',
        total: '3500.50',
        over90: '2500.50',
        openInvoices: 2,
        oldestInvoice: { id: 'i2', daysPastDue: 100 },
        lastReceipt: { date: '2026-09-01', amount: '500.00' },
      });
      expect(beta).toMatchObject({ id: 'c2', total: '1300.00', lastReceipt: null });
      expect(r.byPartner.map((p) => [p.id, p.name, p.total])).toEqual([
        ['p1', 'Partner A', '3800.50'],
        [null, 'No engagement partner', '1000.00'],
      ]);
    });

    it('leaves out settled invoices', () => {
      const r = buildReceivables('2026-10-17', [row({ balance: '0.00' })], new Map());
      expect(r.byClient).toEqual([]);
      expect(r.totals.total).toBe('0.00');
    });
  });
});
