/**
 * Commercial Scope & Billing vocabulary (Service Configuration spec §31),
 * shared by the API and web.
 *
 * An engagement carries a 1:1 commercial configuration (billing frequency,
 * effective/end dates, retainer) alongside the billing MODEL and currency that
 * already live on the engagement itself. Invoices bill the engagement's scope,
 * each line optionally tied to a configured component.
 */

/** How often the engagement is billed (spec §31 "Billing Frequency"). */
export const BILLING_FREQUENCY = {
  monthly: 'monthly',
  quarterly: 'quarterly',
  annual: 'annual',
  milestone: 'milestone',
  onCompletion: 'on_completion',
  oneTime: 'one_time',
  event: 'event',
} as const;
export type BillingFrequency = (typeof BILLING_FREQUENCY)[keyof typeof BILLING_FREQUENCY];
export const BILLING_FREQUENCIES: BillingFrequency[] = Object.values(BILLING_FREQUENCY);

/** The 1:1 commercial configuration for an engagement (spec §31). */
export interface EngagementCommercial {
  engagementId: string;
  billingFrequency: BillingFrequency;
  effectiveDate: string | null;
  endDate: string | null;
  retainerAmount: string | null;
  scopeNotes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Invoice lifecycle (spec §31). Draft is editable; issued/paid/void are locked. */
export const INVOICE_STATUS = {
  draft: 'draft',
  issued: 'issued',
  paid: 'paid',
  void: 'void',
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];
export const INVOICE_STATUSES: InvoiceStatus[] = Object.values(INVOICE_STATUS);

/** A billed line on an invoice, optionally tied to a configured component. */
export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  engagementComponentId: string | null;
  componentName: string | null;
  description: string;
  /** Numeric strings preserve exact money/decimal values across the wire. */
  quantity: string;
  unitAmount: string;
  amount: string;
  sortOrder: number;
}

/** An engagement invoice header (spec §31). Totals are derived from the lines. */
export interface InvoiceRecord {
  id: string;
  engagementId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotal: string;
  taxAmount: string;
  total: string;
  notes: string | null;
  createdByEmployeeId: string | null;
  createdByName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** An invoice with its lines (the detail view). */
export interface InvoiceDetail extends InvoiceRecord {
  lines: InvoiceLineItem[];
}

/**
 * An invoice flattened with its engagement/client context for the firm-wide
 * Billing & Collections view (spec §31). Same RLS visibility as the
 * per-engagement list — the caller sees an invoice only for an engagement they
 * are on. `overdue` is derived: issued and past its due date.
 */
export interface GlobalInvoiceRecord extends InvoiceRecord {
  engagementCode: string;
  entityId: string | null;
  entityName: string | null;
  overdue: boolean;
}

/** A billing rollup bucket: how many invoices and their summed total. */
export interface BillingBucket {
  count: number;
  /** Decimal string; sum of the invoices' totals in the bucket. */
  amount: string;
}

/** The ordered receivables-aging buckets over outstanding (issued, unpaid) invoices. */
export const AGING_BUCKET = {
  notDue: 'not_due',
  d1_30: 'd1_30',
  d31_60: 'd31_60',
  d61_90: 'd61_90',
  d90Plus: 'd90_plus',
} as const;
export type AgingBucketKey = (typeof AGING_BUCKET)[keyof typeof AGING_BUCKET];

/** One receivables-aging band: outstanding invoices by how far past due they are. */
export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  count: number;
  /** Decimal string; sum of the band's invoice totals. */
  amount: string;
}

/**
 * Firm-wide billing rollup (spec §31), RLS-scoped exactly like the invoice
 * list. Amounts are naive sums of invoice totals; `currency` is the dominant
 * invoice currency in scope (most invoicing is single-currency). `outstanding`
 * is issued-but-unpaid; `overdue` is the past-due subset of that.
 */
export interface BillingSummary {
  currency: string;
  draft: BillingBucket;
  issued: BillingBucket;
  paid: BillingBucket;
  void: BillingBucket;
  outstanding: BillingBucket;
  overdue: BillingBucket;
  /**
   * Receivables aging over the outstanding (issued, unpaid) invoices, split by
   * days past the due date. The buckets partition `outstanding`: their counts
   * sum to `outstanding.count`.
   */
  aging: AgingBucket[];
}
