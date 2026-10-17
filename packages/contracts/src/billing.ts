/**
 * Practice Services Phase 2 · Fees to cash (PS-201 onwards).
 *
 * The pure money helpers live here so the API, the web and the tests share one
 * rounding: GST split, Indian amount in words, the financial year and the
 * invoice number. Money crosses the wire as decimal strings ('1234.50'); the
 * helpers work in whole paise so nothing drifts in floating point.
 */

/** SAC for accounting, auditing and book-keeping services (the firm may change it). */
export const SAC_DEFAULT = '998221';

/** The GST rates a line may carry; professional services are 18%. */
export const GST_RATES = [0, 5, 12, 18, 28] as const;

/** GST rule 46: an invoice number is at most 16 characters. */
export const INVOICE_NUMBER_MAX = 16;

/** Firm billing settings (Billing → Settings): who we are on the invoice. */
export interface BillingSettings {
  firmName: string;
  address: string | null;
  gstin: string | null;
  /** Two-digit GST state code of the firm's registration; null until set. */
  stateCode: string | null;
  sacDefault: string;
  /** 1–5 capitals or digits, e.g. 'INV' → INV/26-27/0001. */
  invoicePrefix: string;
  /** Due date = issue date + this many days unless the invoice says otherwise. */
  invoiceTermsDays: number;
  /** Days after due for the automatic reminder e-mails (PS-203). */
  invoiceReminderDays: number[];
  /** Automatic reminder e-mails to clients; off until the partners decide. */
  autoInvoiceReminders: boolean;
  /** Rupees a 26AS credit may differ from the TDS booked and still match (PS-204). */
  tdsMatchTolerance: string;
  version: number;
  updatedAt: string;
}

export interface UpdateBillingSettingsInput {
  gstin?: string | null;
  stateCode?: string | null;
  sacDefault?: string;
  invoicePrefix?: string;
  invoiceTermsDays?: number;
  invoiceReminderDays?: number[];
  autoInvoiceReminders?: boolean;
  tdsMatchTolerance?: string;
  version: number;
}

/** Voiding an issued invoice needs `billing.approve` and a reason. */
export interface VoidInvoiceInput {
  reason: string;
}

// ── Paise ────────────────────────────────────────────────────────────────

/** '1234.5' / 1234.5 → 123450n. Rejects anything that is not a plain decimal. */
export function toPaise(value: string | number): bigint {
  const s = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m) throw new Error(`Not an amount: ${String(value)}`);
  const rupees = BigInt(m[2]!);
  const paise = BigInt((m[3] ?? '').padEnd(2, '0'));
  const total = rupees * 100n + paise;
  return m[1] ? -total : total;
}

/** 123450n → '1234.50'. */
export function fromPaise(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${rupees.toString()}.${rest}`;
}

/** a × b / d rounded half up, for non-negative a, b and positive d. */
function mulDivRound(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b * 2n + d) / (2n * d);
}

/** A rate as basis points of a percent: '18' → 1800n, '2.5' → 250n. */
function rateBp(rate: string | number): bigint {
  const bp = toPaise(rate);
  if (bp < 0n || bp > 10000n) throw new Error(`Not a GST rate: ${String(rate)}`);
  return bp;
}

// ── GST split ────────────────────────────────────────────────────────────

export interface GstLine {
  /** quantity × unit amount, before tax. */
  taxableValue: string | number;
  gstRate: string | number;
}

export interface GstRateBand {
  rate: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface GstSplit {
  /** Firm state = place of supply → CGST + SGST; otherwise IGST. */
  intraState: boolean;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  total: string;
  /** One band per rate, highest first, as printed on the invoice. */
  byRate: GstRateBand[];
}

/**
 * The CGST/SGST or IGST on an invoice's lines. Tax is worked per rate on the
 * summed taxable value and rounded to the paisa, half up; intra-state each
 * half is rounded on its own so CGST always equals SGST. A missing place of
 * supply is taken as the firm's own state. Pure — tested.
 */
export function gstSplit(
  lines: GstLine[],
  firmState: string | null,
  placeOfSupply: string | null,
): GstSplit {
  const intraState = !placeOfSupply || !firmState || placeOfSupply === firmState;
  const bands = new Map<bigint, bigint>();
  for (const line of lines) {
    const bp = rateBp(line.gstRate);
    bands.set(bp, (bands.get(bp) ?? 0n) + toPaise(line.taxableValue));
  }
  let taxable = 0n;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  const byRate: GstRateBand[] = [];
  for (const [bp, base] of [...bands].sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : 0))) {
    const sign = base < 0n ? -1n : 1n;
    const abs = base * sign;
    const half = intraState ? sign * mulDivRound(abs, bp, 20000n) : 0n;
    const whole = intraState ? 0n : sign * mulDivRound(abs, bp, 10000n);
    taxable += base;
    cgst += half;
    sgst += half;
    igst += whole;
    byRate.push({
      rate: fromPaise(bp).replace(/\.?0+$/, '') || '0',
      taxable: fromPaise(base),
      cgst: fromPaise(half),
      sgst: fromPaise(half),
      igst: fromPaise(whole),
    });
  }
  const tax = cgst + sgst + igst;
  return {
    intraState,
    taxable: fromPaise(taxable),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    tax: fromPaise(tax),
    total: fromPaise(taxable + tax),
    byRate,
  };
}

// ── Amount in words (Indian numbering) ──────────────────────────────────

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const rest = n % 10;
  return rest ? `${TENS[Math.floor(n / 10)]!}-${ONES[rest]!}` : TENS[Math.floor(n / 10)]!;
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]!} Hundred` : '', rest ? below100(rest) : '']
    .filter(Boolean)
    .join(' ');
}

/** Whole rupees in lakh and crore: 11800000n → 'One Crore Eighteen Lakh'. */
function indianWords(n: bigint): string {
  if (n === 0n) return 'Zero';
  const parts: string[] = [];
  const crore = n / 10000000n;
  let rest = Number(n % 10000000n);
  if (crore > 0n) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 100000);
  rest %= 100000;
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/**
 * The total as printed on a tax invoice: '118000' → 'Rupees One Lakh Eighteen
 * Thousand Only'; '10.50' → 'Rupees Ten and Fifty Paise Only'. Pure — tested.
 */
export function amountInWords(amount: string | number): string {
  const paise = toPaise(amount);
  if (paise < 0n) return `Minus ${amountInWords(fromPaise(-paise))}`;
  const rupees = paise / 100n;
  const rest = Number(paise % 100n);
  const words = `Rupees ${indianWords(rupees)}`;
  return rest ? `${words} and ${below100(rest)} Paise Only` : `${words} Only`;
}

// ── Financial year and the invoice number ───────────────────────────────

/** '2026-10-16' → '2026-27'; April starts the year. Pure — tested. */
export function financialYearOf(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * `<prefix>/<YY-YY>/<seq>`: ('INV', '2026-27', 1) → 'INV/26-27/0001'. The year
 * is shortened so a five-letter prefix still fits rule 46's 16 characters.
 * Mirrors hsdg.next_invoice_number. Pure — tested.
 */
export function invoiceNumberFor(prefix: string, financialYear: string, seq: number): string {
  return `${prefix}/${financialYear.slice(2)}/${String(seq).padStart(4, '0')}`;
}

/** '118000' → '1,18,000.00' (lakh grouping). Pure — tested. */
export function formatInr(amount: string | number): string {
  const [whole, paise] = fromPaise(toPaise(amount)).split('.') as [string, string];
  const neg = whole.startsWith('-');
  const digits = neg ? whole.slice(1) : whole;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${rest ? `${rest},${last3}` : last3}.${paise}`;
}

// ── PS-203 · Receivables ageing and payment reminders ────────────────────

/** Age of what is owed, counted from the due date. `current`: not yet due. */
export const RECEIVABLE_BANDS = [
  'current',
  'd0_30',
  'd31_60',
  'd61_90',
  'd91_180',
  'over_180',
] as const;
export type ReceivableBand = (typeof RECEIVABLE_BANDS)[number];

export const RECEIVABLE_BAND_LABEL: Record<ReceivableBand, string> = {
  current: 'Not yet due',
  d0_30: '0–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d91_180: '91–180 days',
  over_180: 'Over 180 days',
};

/** The band for an invoice `daysPastDue` days past its due date. Pure — tested. */
export function receivableBand(daysPastDue: number): ReceivableBand {
  if (daysPastDue < 0) return 'current';
  if (daysPastDue <= 30) return 'd0_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  if (daysPastDue <= 180) return 'd91_180';
  return 'over_180';
}

/** Days past due at which the partner hears of an unpaid invoice. */
export const INVOICE_OVERDUE_NUDGE_DAYS = [15, 30, 60] as const;

/** The nudge an invoice this late has reached (60 from then on), or null. Pure — tested. */
export function invoiceOverdueNudge(daysPastDue: number): 15 | 30 | 60 | null {
  if (daysPastDue >= 60) return 60;
  if (daysPastDue >= 30) return 30;
  if (daysPastDue >= 15) return 15;
  return null;
}

/**
 * The automatic reminder due now: the latest threshold the invoice has
 * passed, unless that one (or a later one) was already sent — so turning the
 * e-mails on never sends a backlog. Pure — tested.
 */
export function autoInvoiceReminderDue(
  daysPastDue: number,
  thresholds: number[],
  sent: number[],
): number | null {
  const reached = thresholds.filter((t) => t <= daysPastDue);
  if (reached.length === 0) return null;
  const latest = Math.max(...reached);
  return sent.some((t) => t >= latest) ? null : latest;
}

/** The payment reminder a client reads (e-mail, WhatsApp or pasted). Pure — tested. */
export function invoiceReminderText(r: {
  clientName: string;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  balance: string;
  daysPastDue: number;
  firmName: string;
}): string {
  const inv = r.invoiceNumber ? `invoice ${r.invoiceNumber}` : 'our invoice';
  const dated = r.issueDate ? ` dated ${formatIsoDate(r.issueDate)}` : '';
  const when =
    r.dueDate === null
      ? ''
      : r.daysPastDue > 0
        ? `, which was due on ${formatIsoDate(r.dueDate)} (${r.daysPastDue} day${r.daysPastDue === 1 ? '' : 's'} ago)`
        : `, due on ${formatIsoDate(r.dueDate)}`;
  return [
    `Dear ${r.clientName},`,
    '',
    `This is a reminder that ${formatInr(r.balance)} is outstanding on ${inv}${dated}${when}.`,
    'If you have already paid, please share the payment reference so we can match it; if TDS was deducted, the TDS details too.',
    '',
    'Thank you,',
    r.firmName,
  ].join('\n');
}

function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export type ReceivableBands = Record<ReceivableBand, string>;

/** One client's (or one engagement partner's) receivable. */
export interface ReceivableRow {
  /** Client entity, or the engagement partner (null: no partner on the engagement). */
  id: string | null;
  name: string;
  bands: ReceivableBands;
  total: string;
  /** 91+ days past due. */
  over90: string;
  oldestInvoice: {
    id: string;
    invoiceNumber: string | null;
    engagementId: string;
    dueDate: string | null;
    daysPastDue: number;
    balance: string;
  } | null;
  /** The client's last posted receipt (clients only). */
  lastReceipt: { date: string; amount: string } | null;
  openInvoices: number;
}

/** GET /reports/receivables. */
export interface ReceivablesReport {
  /** IST date the ages are counted to. */
  asOf: string;
  totals: ReceivableBands & { total: string; over90: string };
  byPartner: ReceivableRow[];
  byClient: ReceivableRow[];
}

/** POST /billing/invoices/:id/remind — omit `channel` for the firm's own. */
export interface RemindInvoiceInput {
  channel?: 'email' | 'whatsapp' | 'copy';
}

interface InvoiceReminderBase {
  invoiceId: string;
  client: string;
  text: string;
}

/** As the filing chase (PS-001): e-mailed, a wa.me link to open, or text to copy. */
export type InvoiceReminderResult = InvoiceReminderBase &
  (
    | { channel: 'email'; to: string }
    | { channel: 'whatsapp'; waUrl: string }
    | { channel: 'copy'; fallback: 'no_email' | 'no_phone' | null }
  );

/** A reminder sent about an invoice. */
export interface InvoiceReminderRecord {
  id: string;
  channel: 'email' | 'whatsapp' | 'copy';
  automatic: boolean;
  daysPastDue: number | null;
  sentByName: string | null;
  createdAt: string;
}

// ── PS-202 · Receipts, part payments and TDS on our fees ────────────────

export const RECEIPT_MODES = ['bank', 'upi', 'cheque', 'cash', 'adjustment'] as const;
export type ReceiptMode = (typeof RECEIPT_MODES)[number];

/** The section the client deducted TDS under; professional fees are 194J. */
export const TDS_SECTIONS = ['194J', '194C', 'other'] as const;
export type TdsSection = (typeof TDS_SECTIONS)[number];

export const RECEIPT_STATUSES = ['posted', 'reversed'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface ReceiptAllocation {
  invoiceId: string;
  invoiceNumber: string | null;
  /** Decimal string; counts towards the invoice's total (gross of TDS). */
  amount: string;
}

/**
 * Money from a client. gross = net received + TDS the client deducted; the
 * gross is what settles invoices. What is not allocated is an advance.
 */
export interface ReceiptRecord {
  id: string;
  clientEntityId: string;
  clientName: string;
  receivedOn: string;
  mode: ReceiptMode;
  reference: string | null;
  grossAmount: string;
  tdsAmount: string;
  tdsSection: TdsSection | null;
  netAmount: string;
  bankAccount: string | null;
  status: ReceiptStatus;
  reversedReason: string | null;
  reversedAt: string | null;
  recordedByName: string | null;
  allocations: ReceiptAllocation[];
  /** gross − allocated; held as an advance. */
  unallocated: string;
  /** e.g. { financialYear: '2026-27', quarter: 'Q3' }. */
  tdsQuarter: TdsQuarter;
  version: number;
  createdAt: string;
}

export interface CreateReceiptInput {
  clientEntityId: string;
  receivedOn: string;
  mode: ReceiptMode;
  reference?: string | null;
  /** What reached the bank. */
  netAmount: string;
  tdsAmount?: string;
  tdsSection?: TdsSection | null;
  bankAccount?: string | null;
  /** Omit to allocate oldest invoice first; [] keeps it all as an advance. */
  allocations?: { invoiceId: string; amount: string }[];
}

export interface ReverseReceiptInput {
  reason: string;
  version?: number;
}

/** An open (issued or partly paid) invoice of a client, for allocation. */
export interface OpenInvoice {
  id: string;
  invoiceNumber: string | null;
  engagementId: string;
  issueDate: string | null;
  dueDate: string | null;
  total: string;
  balance: string;
}

export interface TdsQuarter {
  financialYear: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
}

export interface StatementLine {
  date: string;
  /** marked_paid: an invoice marked paid by hand before receipts existed. */
  kind: 'invoice' | 'receipt' | 'tds' | 'credit_note' | 'write_off' | 'marked_paid';
  reference: string | null;
  /** What the client owes more (invoice) … */
  debit: string;
  /** … or less (receipt, TDS, credit). */
  credit: string;
  /** Running balance after this line. */
  balance: string;
  invoiceId: string | null;
  receiptId: string | null;
}

/** GET /billing/clients/:entityId/statement. */
export interface ClientStatement {
  entityId: string;
  entityName: string;
  invoices: OpenInvoice[];
  receipts: ReceiptRecord[];
  /** Approved credit notes and write-offs (PS-205), oldest first. */
  credits: {
    id: string;
    kind: AdjustmentKind;
    invoiceId: string;
    number: string | null;
    date: string;
    amount: string;
  }[];
  lines: StatementLine[];
  totals: {
    invoiced: string;
    received: string;
    tds: string;
    /** Approved credit notes and write-offs. */
    credited: string;
    /** invoiced − (received + tds + credited) on invoices; >0 the client owes. */
    balance: string;
    /** Receipts not allocated to any invoice. */
    advance: string;
  };
  /** TDS the client deducted, which we claim from 26AS, by quarter. */
  tdsReceivable: (TdsQuarter & { amount: string })[];
}

/** '2026-10-16' → { financialYear: '2026-27', quarter: 'Q3' }. Pure — tested. */
export function tdsQuarterOf(isoDate: string): TdsQuarter {
  const m = Number(isoDate.slice(5, 7));
  const quarter = m >= 4 && m <= 6 ? 'Q1' : m <= 9 && m >= 7 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4';
  return { financialYear: financialYearOf(isoDate), quarter };
}

/**
 * Spread a receipt's gross over open invoices, oldest due (then issued) first,
 * never more than each balance. What is left over stays an advance. Amounts are
 * decimal strings; worked in paise. Pure — tested.
 */
export function allocateOldestFirst(
  gross: string,
  invoices: Pick<OpenInvoice, 'id' | 'issueDate' | 'dueDate' | 'balance'>[],
): { allocations: { invoiceId: string; amount: string }[]; unallocated: string } {
  let left = toPaise(gross);
  if (left < 0n) throw new Error('A receipt cannot be negative.');
  const key = (i: { issueDate: string | null; dueDate: string | null }): string =>
    i.dueDate ?? i.issueDate ?? '9999-12-31';
  const ordered = [...invoices].sort(
    (a, b) =>
      key(a).localeCompare(key(b)) ||
      (a.issueDate ?? '').localeCompare(b.issueDate ?? '') ||
      a.id.localeCompare(b.id),
  );
  const allocations: { invoiceId: string; amount: string }[] = [];
  for (const inv of ordered) {
    if (left <= 0n) break;
    const balance = toPaise(inv.balance);
    if (balance <= 0n) continue;
    const take = balance < left ? balance : left;
    allocations.push({ invoiceId: inv.id, amount: fromPaise(take) });
    left -= take;
  }
  return { allocations, unallocated: fromPaise(left) };
}

/** Sum decimal strings exactly. Pure — tested. */
export function sumAmounts(amounts: (string | number)[]): string {
  return fromPaise(amounts.reduce<bigint>((s, a) => s + toPaise(a), 0n));
}

// ── PS-205 · Credit notes and write-offs, with a partner's approval ──────

export const ADJUSTMENT_KINDS = ['credit_note', 'write_off'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** A write-off is never void; an approved credit note may be voided. */
export const ADJUSTMENT_STATUSES = ['pending', 'approved', 'rejected', 'void'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

/**
 * A request to reduce what a client owes on an invoice. Asked for with
 * billing.manage, decided by someone else with billing.approve; only an
 * approved one counts against the invoice's balance.
 */
export interface InvoiceAdjustment {
  id: string;
  kind: AdjustmentKind;
  invoiceId: string;
  invoiceNumber: string | null;
  engagementId: string;
  clientEntityId: string;
  clientName: string;
  /** CN/26-27/0001 once a credit note is approved; null otherwise. */
  number: string | null;
  /** The credit note's date (approval day, IST); null until then. */
  creditDate: string | null;
  reason: string;
  /** Before tax; a write-off's amount. */
  taxableValue: string;
  /** The one rate a credit note's lines carry; null when they differ. */
  gstRate: string | null;
  cgst: string;
  sgst: string;
  igst: string;
  /** What comes off the balance. */
  total: string;
  /** A credit note's lines (PS-205); empty for a write-off. */
  lines: CreditNoteLine[];
  status: AdjustmentStatus;
  requestedById: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  version: number;
}

/** One invoice line a credit note reduces, before tax. */
export interface CreditNoteLineInput {
  invoiceLineId: string;
  taxableValue: string;
}

/** POST /billing/invoices/:invoiceId/credit-notes. */
export interface RequestCreditNoteInput {
  /** The invoice lines it reduces; each keeps that line's GST rate. */
  lines: CreditNoteLineInput[];
  reason: string;
}

/** A credit note's line: part of one invoice line, taxed at its rate. */
export interface CreditNoteLine {
  invoiceLineId: string;
  description: string;
  taxableValue: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

/** POST /billing/invoices/:invoiceId/write-offs. */
export interface RequestWriteOffInput {
  amount: string;
  reason: string;
}

/** POST /billing/{credit-notes|write-offs}/:id/decision. */
export interface DecideAdjustmentInput {
  decision: 'approve' | 'reject';
  note?: string | null;
  version?: number;
}

/**
 * The GST on a credit note, worked as on its invoice (gstSplit): CGST + SGST
 * when the place of supply is the firm's state, else IGST. No tax when the
 * invoice carried none — reverse charge, or billed before GST invoicing.
 * Pure — tested.
 */
export function creditNoteSplit(
  taxableValue: string,
  gstRate: string | number,
  invoice: { firmState: string | null; placeOfSupply: string | null; charged: boolean },
): { cgst: string; sgst: string; igst: string; total: string } {
  if (!invoice.charged || !invoice.firmState) {
    const total = fromPaise(toPaise(taxableValue));
    return { cgst: '0.00', sgst: '0.00', igst: '0.00', total };
  }
  const s = gstSplit([{ taxableValue, gstRate }], invoice.firmState, invoice.placeOfSupply);
  return { cgst: s.cgst, sgst: s.sgst, igst: s.igst, total: s.total };
}

/** An invoice line as a credit note may reduce it. */
export interface CreditableLine {
  id: string;
  description: string;
  taxableValue: string;
  gstRate: string | number;
  /** Already on pending or approved credit notes, before tax. */
  credited: string;
}

/**
 * A credit note's lines, each taxed at its own invoice line's rate (gstSplit
 * per line, so the lines add up to the note), and never more than is left
 * of a line after earlier credit notes. No tax when the invoice carried
 * none. Pure — tested.
 */
export function creditNoteLines(
  asked: CreditNoteLineInput[],
  lines: CreditableLine[],
  invoice: { firmState: string | null; placeOfSupply: string | null; charged: boolean },
):
  | {
      ok: true;
      lines: CreditNoteLine[];
      taxableValue: string;
      gstRate: string | null;
      cgst: string;
      sgst: string;
      igst: string;
      total: string;
    }
  | { ok: false; error: string } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out: CreditNoteLine[] = [];
  let taxable = 0n;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  for (const a of asked) {
    const line = byId.get(a.invoiceLineId);
    if (!line) return { ok: false, error: 'A credit note line must be a line of this invoice.' };
    if (seen.has(line.id)) return { ok: false, error: 'Credit each invoice line once.' };
    seen.add(line.id);
    let paise: bigint;
    try {
      paise = toPaise(a.taxableValue.trim());
    } catch {
      return { ok: false, error: `Enter an amount for "${line.description}".` };
    }
    if (paise <= 0n) return { ok: false, error: `Enter an amount for "${line.description}".` };
    const left = toPaise(line.taxableValue) - toPaise(line.credited);
    if (paise > left) {
      return {
        ok: false,
        error: `Only ${formatInr(fromPaise(left > 0n ? left : 0n))} of "${line.description}" is left to credit.`,
      };
    }
    const value = fromPaise(paise);
    const tax =
      invoice.charged && invoice.firmState
        ? gstSplit(
            [{ taxableValue: value, gstRate: line.gstRate }],
            invoice.firmState,
            invoice.placeOfSupply,
          )
        : null;
    const row: CreditNoteLine = {
      invoiceLineId: line.id,
      description: line.description,
      taxableValue: value,
      gstRate: tax ? Number(line.gstRate).toFixed(2) : '0.00',
      cgst: tax?.cgst ?? '0.00',
      sgst: tax?.sgst ?? '0.00',
      igst: tax?.igst ?? '0.00',
      total: tax?.total ?? value,
    };
    out.push(row);
    taxable += paise;
    cgst += toPaise(row.cgst);
    sgst += toPaise(row.sgst);
    igst += toPaise(row.igst);
  }
  if (out.length === 0) return { ok: false, error: 'Credit at least one invoice line.' };
  const rates = new Set(out.map((l) => l.gstRate));
  return {
    ok: true,
    lines: out,
    taxableValue: fromPaise(taxable),
    gstRate: rates.size === 1 ? out[0]!.gstRate : null,
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    total: fromPaise(taxable + cgst + sgst + igst),
  };
}

// ── PS-206 · Unbilled fixed fees into a draft invoice ──────────────────────

/** Where a fixed fee comes from: the retainer, a compliance year's fee, or a fee milestone. */
export const UNBILLED_SOURCES = ['retainer', 'year_fee', 'milestone'] as const;
export type UnbilledSource = (typeof UNBILLED_SOURCES)[number];

/** One fixed-fee period that is due and on no live invoice. */
export interface UnbilledItem {
  /** Stable per engagement: `retainer:2026-09`, `year:<id>:2026-27:Q2`, `milestone:<id>`. */
  key: string;
  source: UnbilledSource;
  /** "September 2026", "Q2 2026-27 (Jul–Sep 2026)", "FY 2026-27", "Fixed fee". */
  label: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  /** Days since the period ended; 0 while it is running. */
  ageDays: number;
}

/** An engagement's unbilled fixed fees. */
export interface UnbilledEngagement {
  engagementId: string;
  engagementCode: string;
  serviceName: string;
  clientId: string;
  clientName: string;
  partnerId: string | null;
  partnerName: string | null;
  items: UnbilledItem[];
  total: string;
  /** Periods set aside as billed outside the app or not billed, in the window. */
  setAside: SetAsideFee[];
}

/** A fee period set aside without an invoice; restoring it lists it again. */
export interface SetAsideFee {
  key: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  reason: string;
  byName: string | null;
  at: string;
}

export interface UnbilledReport {
  asOf: string;
  engagements: UnbilledEngagement[];
  total: string;
  /** What the report leaves out, said once: time until PS-302. */
  notes: string[];
}

/** POST /billing/unbilled/draft — the chosen periods onto one draft invoice. */
export interface DraftFromUnbilledInput {
  engagementId: string;
  keys: string[];
}

/** POST /billing/unbilled/set-aside — billed outside the app, or not billing them. */
export interface SetAsideFeesInput {
  engagementId: string;
  keys: string[];
  reason: string;
}

/** POST /billing/unbilled/restore — list a set-aside period again. */
export interface RestoreFeeInput {
  engagementId: string;
  key: string;
}

/** A fee billed on a milestone or an event, not by the calendar. */
export const FEE_MILESTONE_KINDS = ['milestone', 'event'] as const;
export type FeeMilestoneKind = (typeof FEE_MILESTONE_KINDS)[number];

/** upcoming: not yet due; due: on the unbilled list; billed: on a live invoice. */
export type FeeMilestoneStatus = 'upcoming' | 'due' | 'billed' | 'set_aside' | 'cancelled';

export interface FeeMilestone {
  id: string;
  engagementId: string;
  kind: FeeMilestoneKind;
  description: string;
  amount: string;
  dueOn: string;
  status: FeeMilestoneStatus;
  /** The live invoice it is on, when billed. */
  invoiceId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface CreateFeeMilestoneInput {
  kind: FeeMilestoneKind;
  description: string;
  amount: string;
  dueOn: string;
}

// ── PS-204 · TDS on our fees against the firm's 26AS ─────────────────────

/** The 26AS text export from TRACES (a year), or a Form 16A PDF (a deductor's quarter). */
export const TDS_IMPORT_SOURCES = ['26as_text', 'form16a_pdf'] as const;
export type TdsImportSource = (typeof TDS_IMPORT_SOURCES)[number];

/** POST /billing/tds-credits/import — the file as downloaded from TRACES. */
export interface ImportTdsCreditsInput {
  filename: string;
  contentBase64: string;
  contentType?: string;
  /**
   * Opens a TRACES PDF: the PAN holder's date of birth or incorporation,
   * DDMMYYYY. Used to read the file; never stored.
   */
  password?: string;
}

/**
 * The 400's `reason` when a file needs its password, or was given a wrong
 * one: a TRACES PDF, or the ZIP the 26AS text export arrives in.
 */
export const TDS_FILE_PASSWORD_CODE = 'TDS_PDF_PASSWORD';
/** @deprecated The PDF-only name of TDS_FILE_PASSWORD_CODE. */
export const TDS_PDF_PASSWORD_CODE = TDS_FILE_PASSWORD_CODE;

export interface TdsImportResult {
  batchId: string;
  source: TdsImportSource;
  financialYear: string;
  pan: string | null;
  credits: number;
  deductors: number;
  tdsTotal: string;
  /** Rows of earlier imports this file replaced. */
  superseded: number;
  /** The date the statement is as on (a 26AS's creation date); null for a Form 16A. */
  asOn: string | null;
  /** Rows skipped or totals that did not add up, said in words. */
  warnings: string[];
}

export interface TdsImportBatch {
  id: string;
  source: TdsImportSource;
  fileName: string;
  financialYear: string;
  pan: string | null;
  credits: number;
  superseded: number;
  /** The date the statement is as on; null for a Form 16A. */
  asOn: string | null;
  importedByName: string | null;
  importedAt: string;
}

/**
 * What a 26AS section code says the payment was. Sections changed names:
 * 194J was split in 2020 into 194J(a) technical (2%) and 194J(b) professional
 * (10%), and the Income-tax Act 2025 numbers payments (1026, 1027, 1028…).
 */
export const TDS_SECTION_KINDS = [
  'professional_10',
  'technical_2',
  'director',
  'contract',
  'commission',
  'other',
] as const;
export type TdsSectionKind = (typeof TDS_SECTION_KINDS)[number];

/** '194JB', '194J(b)', '1027' → 'professional_10'; '194C' → 'contract'… Pure — tested. */
export function tdsSectionKind(section: string): TdsSectionKind {
  const s = section.toUpperCase().replace(/[\s().]/g, '');
  if (s === '194J' || s === '194JB' || s === '1027') return 'professional_10';
  if (s === '194JA' || s === '1026') return 'technical_2';
  if (s === '194JBA' || s === '1028') return 'director';
  if (s === '194C' || s === '1023' || s === '1024') return 'contract';
  if (s === '194H' || s === '1006') return 'commission';
  return 'other';
}

/** A quarter's TDS return (Form 26Q) is due: Q1 31 Jul, Q2 31 Oct, Q3 31 Jan, Q4 31 May. Pure — tested. */
export function tdsReturnDueDate(financialYear: string, quarter: TdsQuarter['quarter']): string {
  const y = Number(financialYear.slice(0, 4));
  return { Q1: `${y}-07-31`, Q2: `${y}-10-31`, Q3: `${y + 1}-01-31`, Q4: `${y + 1}-05-31` }[
    quarter
  ];
}

/** Days after the return's due date a credit can fairly be expected in the 26AS. */
export const TDS_26AS_LAG_DAYS = 15;

/** The return's due date and TDS_26AS_LAG_DAYS: before a 26AS as on this date, a missing credit is only awaited. Pure — tested. */
export function tdsExpectedBy(financialYear: string, quarter: TdsQuarter['quarter']): string {
  const due = tdsReturnDueDate(financialYear, quarter);
  const d = new Date(`${due}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + TDS_26AS_LAG_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * What a senior would query on a line. flag: the client deducted wrongly
 * (rate or section); risk: the credit may not be ours to claim yet; note: for
 * information.
 */
export const TDS_CHECK_CODES = [
  'rate_2',
  'rate_20',
  'tds_on_gst',
  'unusual_rate',
  'wrong_section',
  'director_section',
  'lower_deduction_certificate',
  'short_deposit',
  'status_unmatched',
  'status_overbooked',
  'status_provisional',
  'booked_rate',
] as const;
export type TdsCheckCode = (typeof TDS_CHECK_CODES)[number];

export interface TdsCheck {
  code: TdsCheckCode;
  level: 'flag' | 'risk' | 'note';
  message: string;
}

/** A Part I row of the 26AS: TDS a deductor deposited against the firm's PAN. */
export interface TdsCreditLine {
  id: string;
  deductorTan: string;
  deductorName: string;
  section: string;
  sectionKind: TdsSectionKind;
  transactionDate: string;
  amountPaid: string;
  taxDeducted: string;
  tdsDeposited: string;
  /** F final, P provisional, U unmatched (the credit is not yet available), O overbooked. */
  bookingStatus: string | null;
  /** 26AS remarks: A challan rectified, B statement rectified, F a s.197 certificate, G reprocessed. */
  remarks: string | null;
  financialYear: string;
  quarter: TdsQuarter['quarter'];
  checks: TdsCheck[];
}

/** TDS a client deducted, as booked on a posted receipt (PS-202). */
export interface TdsBookedLine {
  receiptId: string;
  receivedOn: string;
  reference: string | null;
  grossAmount: string;
  tdsAmount: string;
  tdsSection: TdsSection | null;
  financialYear: string;
  quarter: TdsQuarter['quarter'];
  checks: TdsCheck[];
}

/** Booked TDS not in the 26AS yet, but not late: the return is not due, or the 26AS is older. */
export interface TdsAwaitedLine extends TdsBookedLine {
  /** The 26AS should carry it by this date (TDS_26AS_LAG_DAYS after the return's due date). */
  expectedBy: string;
  /** "Return due 31 Oct 2026", or "Your 26AS is as on 20 Oct 2026 — import a newer one after 15 Nov 2026". */
  reason: string;
}

/**
 * exact / tolerance: one credit, one receipt. split: one receipt, deposited
 * as several credits. combined: several receipts in one credit.
 * quarter_total: the client's quarter agrees in total only. other_quarter:
 * one to one, but the deductor booked it in the next or previous quarter.
 */
export const TDS_MATCH_KINDS = [
  'exact',
  'tolerance',
  'split',
  'combined',
  'quarter_total',
  'other_quarter',
] as const;
export type TdsMatchKind = (typeof TDS_MATCH_KINDS)[number];

export interface TdsMatchedGroup {
  kind: TdsMatchKind;
  clientId: string;
  clientName: string;
  credits: TdsCreditLine[];
  receipts: TdsBookedLine[];
  /** Credited − booked; within the tolerance. */
  difference: string;
}

/** One client's mismatches. */
export interface TdsClientMismatch {
  clientId: string;
  clientName: string;
  /** The client's TANs on file; none means nothing of theirs can match. */
  tans: string[];
  /** In the 26AS, but no receipt books it. */
  notBooked: TdsCreditLine[];
  notBookedTotal: string;
  /** Booked on a receipt, but missing from the 26AS: ask the client to file or correct. */
  missing: TdsBookedLine[];
  missingTotal: string;
  /** Booked, not in the 26AS yet, and not late: no reminder. */
  awaited: TdsAwaitedLine[];
  awaitedTotal: string;
  lastReminder: {
    channel: 'email' | 'whatsapp' | 'copy';
    at: string;
    byName: string | null;
  } | null;
}

/** GET /billing/tds-credits/match?financialYear=2026-27&quarter=Q2 */
export interface TdsMatchReport {
  financialYear: string;
  /** null: the whole year. */
  quarter: TdsQuarter['quarter'] | null;
  /** Rupees, from the billing settings. */
  tolerance: string;
  /** The firm's PAN, as the latest import gave it. */
  pan: string | null;
  /** The latest 26AS of the year is as on this date; null before one is imported. */
  asOn: string | null;
  /** This year's imports, newest first. */
  imports: TdsImportBatch[];
  matched: TdsMatchedGroup[];
  /** Clients with a mismatch, the largest missing TDS first. */
  clients: TdsClientMismatch[];
  /** Credits from a TAN on no client: add the TAN, or it is not a client's. */
  unknownDeductors: TdsCreditLine[];
  totals: {
    credited: string;
    booked: string;
    matched: string;
    notBooked: string;
    missing: string;
    awaited: string;
  };
  /** The flags, risks and notes on the period's lines, by client (null: a TAN on no client). */
  checks: { clientId: string | null; clientName: string; checks: TdsCheck[] }[];
  notes: string[];
}

/** POST /billing/tds-credits/remind — omit `channel` for the firm's own. */
export interface RemindTdsInput {
  clientId: string;
  financialYear: string;
  quarter?: TdsQuarter['quarter'];
  channel?: 'email' | 'whatsapp' | 'copy';
  /** Send although the client was reminded of the same period within TDS_REMINDER_GAP_DAYS. */
  force?: boolean;
}

/** A client is not reminded of the same period again within this many days, unless forced. */
export const TDS_REMINDER_GAP_DAYS = 7;

interface TdsReminderBase {
  clientId: string;
  client: string;
  text: string;
  tdsAmount: string;
  receipts: number;
}

export type TdsReminderResult = TdsReminderBase &
  (
    | { channel: 'email'; to: string }
    | { channel: 'whatsapp'; waUrl: string }
    | { channel: 'copy'; fallback: 'no_email' | 'no_phone' | null }
  );

/** '2026-27', 'Q2' → 'Q2 (July–September 2026) of 2026-27'. Pure — tested. */
export function tdsQuarterLabel(financialYear: string, quarter: TdsQuarter['quarter']): string {
  const start = Number(financialYear.slice(0, 4));
  const span: Record<TdsQuarter['quarter'], string> = {
    Q1: `April–June ${start}`,
    Q2: `July–September ${start}`,
    Q3: `October–December ${start}`,
    Q4: `January–March ${start + 1}`,
  };
  return `${quarter} (${span[quarter]}) of ${financialYear}`;
}

/**
 * The client's reminder to file or correct their TDS return for deductions
 * missing from the firm's 26AS (e-mail, WhatsApp or pasted). Pure — tested.
 */
export function tdsReminderText(r: {
  clientName: string;
  firmName: string;
  pan: string | null;
  financialYear: string;
  quarter: TdsQuarter['quarter'] | null;
  lines: {
    receivedOn: string;
    tdsAmount: string;
    tdsSection: string | null;
    reference: string | null;
  }[];
}): string {
  const when = r.quarter
    ? tdsQuarterLabel(r.financialYear, r.quarter)
    : `the year ${r.financialYear}`;
  const ours = r.pan ? `our Form 26AS (PAN ${r.pan})` : 'our Form 26AS';
  const quote = r.pan ? `our PAN ${r.pan}` : 'our PAN';
  const total = sumAmounts(r.lines.map((l) => l.tdsAmount));
  const several = r.lines.length > 1;
  return [
    `Dear ${r.clientName},`,
    '',
    `We have matched the TDS deducted from our fees with ${ours} for ${when}. ${
      several ? 'These deductions do' : 'This deduction does'
    } not appear in it yet:`,
    '',
    ...r.lines.map(
      (l) =>
        `• Payment of ${formatIsoDate(l.receivedOn)}${l.reference ? ` (${l.reference})` : ''}: TDS ₹${formatInr(l.tdsAmount)}${l.tdsSection && l.tdsSection !== 'other' ? ` under section ${l.tdsSection}` : ''}`,
    ),
    ...(several ? [`Total: ₹${formatInr(total)}`] : []),
    '',
    `Please file your TDS return (Form 26Q) for the quarter, or correct it if it is filed, quoting ${quote}, so the credit reaches us. If you have filed it recently, please share the acknowledgement.`,
    '',
    'Thank you,',
    r.firmName,
  ].join('\n');
}
