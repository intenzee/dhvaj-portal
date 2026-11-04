/**
 * Quick invoices (Phase 4): the firm in full on the invoice PDF, a one-row
 * invoice from a service already on the engagement, sending it (e-mail,
 * WhatsApp, download) and a monthly schedule per service.
 */
import type { InvoiceDetail } from './commercial';

// ── The firm on its invoices ───────────────────────────────────────────────

export type FirmLogoType = 'image/png' | 'image/jpeg';

/** GET /billing/firm-profile — everything the invoice PDF prints about the firm. */
export interface FirmInvoiceProfile {
  firmName: string;
  address: string | null;
  gstin: string | null;
  stateCode: string | null;
  frn: string | null;
  email: string | null;
  pan: string | null;
  phone: string | null;
  website: string | null;
  bankAccountName: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  upiId: string | null;
  /** Set when a logo is on file (GET /billing/firm-profile/logo). */
  logoContentType: FirmLogoType | null;
}

/** The fields PATCH /billing/firm-profile changes (null clears one). */
export const FIRM_PROFILE_FIELDS = [
  'pan',
  'phone',
  'website',
  'bankAccountName',
  'bankName',
  'bankAccountNumber',
  'bankIfsc',
  'bankBranch',
  'upiId',
] as const;
export type FirmProfileField = (typeof FIRM_PROFILE_FIELDS)[number];
export type UpdateFirmInvoiceProfileInput = Partial<Record<FirmProfileField, string | null>>;

/** PUT /billing/firm-profile/logo — a PNG or JPEG, base64, at most 500 KB. */
export interface SetFirmLogoInput {
  contentType: FirmLogoType;
  contentBase64: string;
}
export const FIRM_LOGO_MAX_BYTES = 512_000;

// ── Quick create ───────────────────────────────────────────────────────────

export const QUICK_INVOICE_GST_RATES = [0, 5, 12, 18, 28] as const;
export type QuickInvoiceGstRate = (typeof QUICK_INVOICE_GST_RATES)[number];
export const QUICK_INVOICE_DEFAULT_GST_RATE: QuickInvoiceGstRate = 18;

/** POST /engagements/:id/invoices/quick — one line, one service. */
export interface QuickInvoiceInput {
  engagementServiceId: string;
  /** Taxable value, rupees (decimal string). */
  amount: string;
  gstRate: QuickInvoiceGstRate;
  /** Default: the service's name and this month. */
  description?: string | null;
  /** Default true: issue at once (numbered, PDF kept). False keeps a draft. */
  issue?: boolean;
}

export interface QuickInvoiceResult {
  invoice: InvoiceDetail;
  issued: boolean;
  /** Why it stayed a draft when issuing was asked for (e.g. a partner issues it). */
  notIssuedReason: string | null;
}

// ── Recurring ──────────────────────────────────────────────────────────────

export const RECURRING_INVOICE_MODE = {
  /** Issued as is on the day, every month. */
  active: 'active',
  /** A draft on the day, to change and issue by hand. */
  manual: 'manual',
  /** Nothing until resumed. */
  paused: 'paused',
} as const;
export type RecurringInvoiceMode =
  (typeof RECURRING_INVOICE_MODE)[keyof typeof RECURRING_INVOICE_MODE];

export interface RecurringInvoiceSchedule {
  id: string;
  engagementServiceId: string;
  description: string | null;
  amount: string;
  gstRate: number;
  dayOfMonth: number;
  mode: RecurringInvoiceMode;
  nextRunOn: string;
  lastRunOn: string | null;
  lastInvoiceId: string | null;
  lastError: string | null;
  version: number;
}

/** PUT /engagements/:id/invoice-services/:engagementServiceId/schedule */
export interface SetRecurringInvoiceInput {
  amount: string;
  gstRate: QuickInvoiceGstRate;
  /** 1–28, so every month has the day. */
  dayOfMonth: number;
  mode: RecurringInvoiceMode;
  description?: string | null;
}

/** GET /engagements/:id/invoice-services — the drop-down, each with its schedule. */
export interface InvoiceService {
  engagementServiceId: string;
  name: string;
  stream: string | null;
  financialYear: string | null;
  periodLabel: string | null;
  schedule: RecurringInvoiceSchedule | null;
}

// ── Sending ────────────────────────────────────────────────────────────────

export const INVOICE_SEND_CHANNEL = {
  email: 'email',
  whatsapp: 'whatsapp',
  /** "Open in mail app": a mailto: the biller sends from their own mail. */
  mailApp: 'mail_app',
} as const;
export type InvoiceSendChannel = (typeof INVOICE_SEND_CHANNEL)[keyof typeof INVOICE_SEND_CHANNEL];

/** GET /engagements/:id/invoices/:invoiceId/send-options */
export interface InvoiceSendOptions {
  email: string | null;
  /** The client's phone as WhatsApp takes it; null when it cannot. */
  whatsappNumber: string | null;
  /** Whether the portal itself e-mails (an external mail channel is on). */
  emailDelivery: boolean;
}

/** POST /engagements/:id/invoices/:invoiceId/send */
export interface SendInvoiceInput {
  channel: InvoiceSendChannel;
}

export interface SendInvoiceResult {
  channel: InvoiceSendChannel;
  to: string | null;
  subject: string;
  text: string;
  /** The signed PDF link the text carries (30 days). */
  link: string;
  waUrl: string | null;
  mailtoUrl: string | null;
  /** True when the portal queued the e-mail itself. */
  queued: boolean;
}

export interface InvoiceSendRecord {
  id: string;
  channel: InvoiceSendChannel;
  recipient: string | null;
  automatic: boolean;
  sentByName: string | null;
  createdAt: string;
}

/** GET /invoice-links/:token — public: what the client's link opens. */
export interface InvoiceShareInfo {
  valid: boolean;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  total: string | null;
  balance: string | null;
  firmName: string | null;
  clientName: string | null;
}

export const INVOICE_SHARE_LINK_DAYS = 30;

// ── Pure helpers (tested) ──────────────────────────────────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "GST compliance — November 2026" for a date (yyyy-mm-dd). */
export function quickInvoiceDescription(serviceName: string, isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${serviceName} — ${MONTHS[Number(m) - 1] ?? ''} ${y}`.trim();
}

/** The first run on or after `today` falling on `day` (1–28). */
export function firstRunOn(today: string, day: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return d <= day ? isoDay(y, m, day) : addMonth(isoDay(y, m, day));
}

/** The same day next month. */
export function addMonth(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return m === 12 ? isoDay(y + 1, 1, d) : isoDay(y, m + 1, d);
}

function isoDay(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The tax a quick invoice will carry, and its total — for the row's preview. */
export function quickInvoiceTotals(
  amount: string,
  gstRate: number,
): { taxable: number; tax: number; total: number } | null {
  const taxable = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(taxable) || taxable <= 0) return null;
  const tax = Math.round(taxable * gstRate) / 100;
  return { taxable, tax, total: Math.round((taxable + tax) * 100) / 100 };
}

/** The text an invoice goes out with (e-mail body and WhatsApp message). */
export function invoiceSendText(p: {
  clientName: string;
  invoiceNumber: string;
  total: string;
  dueDate: string | null;
  firmName: string;
  link: string;
}): { subject: string; text: string } {
  const amount = `Rs. ${Number(p.total).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const due = p.dueDate ? `, due ${p.dueDate.split('-').reverse().join('-')}` : '';
  return {
    subject: `Invoice ${p.invoiceNumber} from ${p.firmName}`,
    text: [
      `Dear ${p.clientName},`,
      '',
      `Please find our invoice ${p.invoiceNumber} for ${amount}${due}.`,
      `Download it here: ${p.link}`,
      '',
      'Thank you,',
      p.firmName,
    ].join('\n'),
  };
}

/** mailto: with the subject and body filled in. */
export function invoiceMailtoUrl(email: string, subject: string, text: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
