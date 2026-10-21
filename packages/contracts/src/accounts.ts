/**
 * Accountant role, phase 1 (spec docs/accountant-hr-roles-spec.md §3): the
 * Accounts desk, a client's billing profile, an engagement's commercial view,
 * asking a partner to issue an ad-hoc invoice, and the approvals the desk is
 * waiting on. Amounts are rupee strings with two decimals, as in billing.
 */
import type { FeeMilestone } from './billing';
import type { InvoiceStatus } from './commercial';

/** GET /billing/clients/:id/profile — what an invoice needs, nothing more. */
export interface ClientBillingProfile {
  id: string;
  entityCode: string;
  legalName: string;
  displayName: string | null;
  pan: string | null;
  status: string;
  /** The one active, well-formed GSTIN; null with none or several. */
  gstin: string | null;
  gstinCount: number;
  /** Two-digit GST state code: the GSTIN's, else the billing address's. */
  stateCode: string | null;
  billingAddress: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    country: string | null;
  } | null;
  contact: { name: string | null; email: string | null; phone: string | null };
  /** Days to pay, from the billing settings. */
  creditTermsDays: number | null;
}

/** GET /billing/clients — the clients the caller may bill, for statements. */
export interface BillingClientRow {
  id: string;
  entityCode: string;
  legalName: string;
  gstin: string | null;
  /** Issued, unpaid balance. */
  outstanding: string;
  openInvoices: number;
}

export interface BillingClientListQuery {
  q?: string;
  /** Only clients with an unpaid balance. */
  owing?: boolean;
  limit?: number;
}

/** Billable hours on an engagement for one person: hours and rate, never the work. */
export interface EngagementBillableHours {
  employeeId: string;
  employeeName: string;
  billableSeconds: number;
  billedSeconds: number;
  unbilledSeconds: number;
  /** The rate last billed for this person here; null before any. */
  lastRatePerHour: string | null;
}

export interface EngagementCommercialInvoice {
  id: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  issueDate: string | null;
  total: string;
  balance: string;
}

/**
 * GET /billing/engagements/:id — the commercial view (spec §3.4): header,
 * fee schedule, billable hours by person, invoices. No tasks, documents,
 * review notes, time-entry notes or activity.
 */
export interface EngagementCommercialView {
  id: string;
  engagementCode: string;
  clientId: string;
  clientName: string;
  serviceName: string | null;
  financialYear: string | null;
  periodLabel: string | null;
  status: string;
  kind: string | null;
  billingModel: string | null;
  currency: string | null;
  partner: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  feeMilestones: FeeMilestone[];
  hours: EngagementBillableHours[];
  invoices: EngagementCommercialInvoice[];
}

/** POST /billing/invoices/:id/request-issue */
export interface RequestInvoiceIssueInput {
  note?: string;
}

export const ISSUE_REQUEST_CLOSED_REASONS = ['issued', 'void', 'withdrawn'] as const;
export type IssueRequestClosedReason = (typeof ISSUE_REQUEST_CLOSED_REASONS)[number];

/** A draft with an ad-hoc line, waiting for a partner to issue it (decision 9.3). */
export interface InvoiceIssueRequest {
  id: string;
  invoiceId: string;
  engagementId: string;
  clientId: string;
  clientName: string;
  total: string;
  /** The lines no agreed fee or billable time stands behind, when asked. */
  adHocLines: string[];
  note: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  at: string;
  closedAt: string | null;
  closedReason: IssueRequestClosedReason | null;
}

export const APPROVAL_KINDS = ['invoice_issue', 'credit_note', 'write_off', 'fee_waiver'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** Open, or how it ended: decided, or (an issue request) issued, voided, withdrawn. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | IssueRequestClosedReason;

/** One request to a partner, of any kind (Approvals sent). */
export interface ApprovalItem {
  kind: ApprovalKind;
  id: string;
  clientId: string;
  clientName: string;
  engagementId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amount: string;
  reason: string | null;
  status: ApprovalStatus;
  requestedById: string | null;
  requestedByName: string | null;
  at: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ApprovalListQuery {
  /** `mine` (default): what the caller asked for; `all`: every one they may see. */
  scope?: 'mine' | 'all';
  /** `pending` (default) or `recent` (decided in the last 30 days too). */
  status?: 'pending' | 'recent';
}

/** GET /accounts/desk — the Accounts desk (spec §3.4). */
export interface AccountsDesk {
  asOf: string;
  /** The IST month the billed and collected figures cover. */
  month: { start: string; end: string };
  kpis: {
    billed: string;
    collected: string;
    outstanding: string;
    over90: string;
    over90Count: number;
  };
  /** Counts; the web shows a queue only when it is not zero. */
  queues: {
    readyToIssue: number;
    unbilledFeesDue: number;
    receiptsUnallocated: number;
    tdsNotIn26as: number;
    remindersDueToday: number;
    waitingForPartner: number;
    /** Paid payroll runs not yet booked; null until payroll is on. */
    payrollToBook: number | null;
  };
  byPartner: { partnerId: string | null; partnerName: string; outstanding: string }[];
  /** Receipts by IST month, oldest first, the last six months. */
  collections: { month: string; amount: string }[];
}
