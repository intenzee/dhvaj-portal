import type {
  FirmInvoiceProfile,
  InvoiceSendRecord,
  InvoiceService,
  RecurringInvoiceSchedule,
} from '@hsdg/contracts';
import { invoiceSendLine, noContactNote, sendButtons } from '../invoice-send';
import { ordinal, quickPreview, repeatDay, serviceLabel } from '../quick-invoice-row';
import { scheduleForm, scheduleSummary, validDay } from '../monthly-invoices';
import { firmForm, firmProfileChanges, logoProblem } from '../firm-profile-card';

describe('sending an invoice', () => {
  const both = { email: 'a@acme.in', whatsappNumber: '919810000000', emailDelivery: false };

  it('offers mail app and WhatsApp when both contacts are on file, and download always', () => {
    expect(sendButtons(both, true)).toEqual(['mail_app', 'whatsapp', 'download']);
  });

  it('adds e-mail from the portal only when the portal sends mail', () => {
    expect(sendButtons({ ...both, emailDelivery: true }, true)).toEqual([
      'email',
      'mail_app',
      'whatsapp',
      'download',
    ]);
  });

  it('only download with no contact, or for someone who may not send', () => {
    const none = { email: null, whatsappNumber: null, emailDelivery: true };
    expect(sendButtons(none, true)).toEqual(['download']);
    expect(sendButtons(both, false)).toEqual(['download']);
    expect(sendButtons(undefined, true)).toEqual(['download']);
    expect(noContactNote(none)).toMatch(/download the PDF/);
    expect(noContactNote(both)).toBeNull();
  });

  it('logs who sent it, how and to whom', () => {
    const r: InvoiceSendRecord = {
      id: '1',
      channel: 'whatsapp',
      recipient: '919810000000',
      automatic: false,
      sentByName: 'Partner One',
      createdAt: '2026-11-04T05:00:00Z',
    };
    expect(invoiceSendLine(r)).toMatch(/^Sent .+ · WhatsApp · 919810000000 · Partner One$/);
    expect(invoiceSendLine({ ...r, channel: 'mail_app', automatic: true })).toMatch(
      /mail app · 919810000000 · automatic$/,
    );
  });
});

describe('the one-row invoice', () => {
  const service: InvoiceService = {
    engagementServiceId: 's1',
    name: 'GST compliance',
    stream: 'gst',
    financialYear: '2026-27',
    periodLabel: null,
    schedule: null,
  };

  it('labels a service with its year', () => {
    expect(serviceLabel(service)).toBe('GST compliance · FY 2026-27');
    expect(serviceLabel({ ...service, financialYear: null, periodLabel: 'Q3' })).toBe(
      'GST compliance · Q3',
    );
  });

  it('previews GST and the total, or nothing until there is an amount', () => {
    expect(quickPreview('15000', 18)).toBe('₹15,000.00 + 18% GST ₹2,700.00 = ₹17,700.00');
    expect(quickPreview('15000', 0)).toBe('₹15,000.00, no GST');
    expect(quickPreview('', 18)).toBeNull();
    expect(quickPreview('-5', 18)).toBeNull();
  });

  it('repeats on today’s day, up to the 28th', () => {
    expect(repeatDay('2026-11-04')).toBe(4);
    expect(repeatDay('2026-10-31')).toBe(28);
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(28)).toBe('28th');
  });
});

describe('monthly invoices', () => {
  const s: RecurringInvoiceSchedule = {
    id: 'r1',
    engagementServiceId: 's1',
    description: null,
    amount: '15000.00',
    gstRate: 18,
    dayOfMonth: 5,
    mode: 'active',
    nextRunOn: '2026-12-05',
    lastRunOn: '2026-11-05',
    lastInvoiceId: null,
    lastError: null,
    version: 1,
  };

  it('says how much, on which day and when next', () => {
    expect(scheduleSummary(s)).toMatch(/^₹15,000\.00 \+ 18% GST \(₹17,700\.00\) on the 5th · next /);
    expect(scheduleSummary({ ...s, mode: 'paused' })).toMatch(/paused$/);
  });

  it('opens with the schedule’s values, or defaults', () => {
    expect(scheduleForm(s)).toEqual({ amount: '15000', gstRate: 18, dayOfMonth: '5', mode: 'active' });
    expect(scheduleForm(null)).toEqual({ amount: '', gstRate: 18, dayOfMonth: '1', mode: 'active' });
  });

  it('takes a day every month has', () => {
    expect(validDay('28')).toBe(28);
    expect(validDay('29')).toBeNull();
    expect(validDay('0')).toBeNull();
    expect(validDay('x')).toBeNull();
  });
});

describe('the firm on its invoices', () => {
  const p: FirmInvoiceProfile = {
    firmName: 'Dhvaj & Co',
    address: null,
    gstin: null,
    stateCode: null,
    frn: null,
    email: null,
    pan: 'AAAFD1234K',
    phone: null,
    website: null,
    bankAccountName: null,
    bankName: 'HDFC Bank',
    bankAccountNumber: null,
    bankIfsc: null,
    bankBranch: null,
    upiId: null,
    logoContentType: null,
  };

  it('sends only what changed; blank clears', () => {
    const f = firmForm(p);
    expect(firmProfileChanges(p, f)).toEqual({});
    expect(
      firmProfileChanges(p, { ...f, pan: '  ', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank ' }),
    ).toEqual({ pan: null, bankIfsc: 'HDFC0001234' });
  });

  it('takes a PNG or JPEG up to 500 KB as the logo', () => {
    expect(logoProblem({ type: 'image/png', size: 2000 })).toBeNull();
    expect(logoProblem({ type: 'image/jpeg', size: 512_000 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG or a JPEG/);
    expect(logoProblem({ type: 'image/png', size: 600_000 })).toMatch(/500 KB/);
    expect(logoProblem({ type: 'image/png', size: 0 })).toMatch(/empty/);
  });
});
