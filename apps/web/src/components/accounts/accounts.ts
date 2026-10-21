import {
  PERMISSION,
  type AccountsDesk,
  type ApprovalItem,
  type ApprovalKind,
  type ApprovalStatus,
  type ClientBillingProfile,
} from '@hsdg/contracts';
import { can, type Principal } from '@/lib/principal';

/**
 * The Accountant's pages (spec §3.4) read what the API's billing readers read:
 * billing.manage or report.read, or entity.read_billing, which the nav gates on.
 */
export function canReadAccounts(principal: Principal | null): boolean {
  return (
    can(principal, PERMISSION.billingManage) ||
    can(principal, PERMISSION.reportRead) ||
    can(principal, PERMISSION.entityReadBilling)
  );
}

export interface DeskQueue {
  key: keyof AccountsDesk['queues'];
  label: string;
  count: number;
  href: string;
}

/** Today's work, each queue linking to the list that clears it; empty queues drop out. */
export function deskQueues(q: AccountsDesk['queues']): DeskQueue[] {
  const all: (Omit<DeskQueue, 'count'> & { count: number | null })[] = [
    { key: 'readyToIssue', label: 'Drafts ready to issue', count: q.readyToIssue, href: '/billing?status=draft' },
    { key: 'unbilledFeesDue', label: 'Agreed fees not yet billed', count: q.unbilledFeesDue, href: '/billing/unbilled' },
    { key: 'remindersDueToday', label: 'Payment reminders due today', count: q.remindersDueToday, href: '/billing?overdue=1' },
    { key: 'receiptsUnallocated', label: 'Receipts held as advance', count: q.receiptsUnallocated, href: '/billing/statements' },
    { key: 'tdsNotIn26as', label: 'TDS not yet in 26AS', count: q.tdsNotIn26as, href: '/billing/tds' },
    { key: 'waitingForPartner', label: 'Waiting for a partner', count: q.waitingForPartner, href: '/billing/approvals?scope=all' },
    { key: 'payrollToBook', label: 'Payroll runs to book', count: q.payrollToBook, href: '/payroll/books' },
  ];
  return all.filter((x): x is DeskQueue => (x.count ?? 0) > 0);
}

/** "Oct 2026" from "2026-10". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Bar widths in percent of the largest, with a sliver for any non-zero. */
export function barWidths(amounts: readonly string[]): number[] {
  const n = amounts.map((a) => Math.max(0, Number(a) || 0));
  const max = Math.max(1, ...n);
  return n.map((v) => (v > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0));
}

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  invoice_issue: 'Issue invoice',
  credit_note: 'Credit note',
  write_off: 'Write-off',
  fee_waiver: 'Fee waiver',
};

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: string }> = {
  pending: { label: 'Waiting', tone: 'warn' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  issued: { label: 'Issued', tone: 'success' },
  void: { label: 'Voided', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** Only the one who asked takes back an issue request, while it is open. */
export function mayWithdraw(a: ApprovalItem, employeeId: string | null | undefined): boolean {
  return (
    a.kind === 'invoice_issue' &&
    a.status === 'pending' &&
    !!employeeId &&
    a.requestedById === employeeId
  );
}

/** "Flat 4, Lake View, Kolkata 700001, West Bengal": the parts the client gave. */
export function addressLine(p: Pick<ClientBillingProfile, 'address' | 'billingAddress'>): string | null {
  const a = p.address;
  if (a) {
    const cityPin = [a.city, a.pincode].filter(Boolean).join(' ');
    const parts = [a.line1, a.line2, cityPin, a.state].filter((x): x is string => !!x && !!x.trim());
    if (parts.length) return parts.join(', ');
  }
  return p.billingAddress?.trim() || null;
}

/** Why an invoice for this client may come out wrong, for the profile card. */
export function profileGaps(p: ClientBillingProfile): string[] {
  const gaps: string[] = [];
  if (p.gstinCount > 1) gaps.push('More than one active GSTIN: pick the right one on the invoice.');
  if (!p.stateCode) gaps.push('No GSTIN or billing state: place of supply cannot be worked out.');
  if (!p.contact.email) gaps.push('No billing email: invoices and reminders cannot be emailed.');
  return gaps;
}

/**
 * Where an engagement link goes from billing: the full engagement for those
 * who may read it, else its commercial view (the Accountant).
 */
export function engagementHref(principal: Principal | null, engagementId: string): string {
  return can(principal, PERMISSION.engagementRead)
    ? `/engagements/${engagementId}`
    : `/billing/engagements/${engagementId}`;
}
