import {
  RECEIVABLE_BANDS,
  fromPaise,
  receivableBand,
  toPaise,
  type ReceivableBand,
  type ReceivableBands,
  type ReceivableRow,
  type ReceivablesReport,
} from '@hsdg/contracts';

/** An open invoice as the receivables report reads it. */
export interface OpenReceivable {
  id: string;
  invoiceNumber: string | null;
  engagementId: string;
  clientId: string;
  clientName: string;
  partnerId: string | null;
  partnerName: string | null;
  dueDate: string | null;
  /** Days since the due date (the issue date when there is none); <0 not yet due. */
  daysPastDue: number;
  balance: string;
}

const OVER_90: ReceivableBand[] = ['d91_180', 'over_180'];

interface Acc {
  id: string | null;
  name: string;
  bands: Record<ReceivableBand, bigint>;
  oldest: OpenReceivable | null;
  count: number;
}

const blank = (id: string | null, name: string): Acc => ({
  id,
  name,
  bands: Object.fromEntries(RECEIVABLE_BANDS.map((b) => [b, 0n])) as Record<ReceivableBand, bigint>,
  oldest: null,
  count: 0,
});

function add(acc: Acc, r: OpenReceivable): void {
  acc.bands[receivableBand(r.daysPastDue)] += toPaise(r.balance);
  acc.count += 1;
  if (
    !acc.oldest ||
    r.daysPastDue > acc.oldest.daysPastDue ||
    (r.daysPastDue === acc.oldest.daysPastDue && r.id < acc.oldest.id)
  ) {
    acc.oldest = r;
  }
}

function bandsOf(acc: Pick<Acc, 'bands'>): ReceivableBands {
  return Object.fromEntries(
    RECEIVABLE_BANDS.map((b) => [b, fromPaise(acc.bands[b])]),
  ) as ReceivableBands;
}

const sum = (acc: Pick<Acc, 'bands'>, bands: readonly ReceivableBand[]): bigint =>
  bands.reduce((s, b) => s + acc.bands[b], 0n);

function toRow(acc: Acc, lastReceipt: ReceivableRow['lastReceipt']): ReceivableRow {
  const o = acc.oldest;
  return {
    id: acc.id,
    name: acc.name,
    bands: bandsOf(acc),
    total: fromPaise(sum(acc, RECEIVABLE_BANDS)),
    over90: fromPaise(sum(acc, OVER_90)),
    oldestInvoice: o && {
      id: o.id,
      invoiceNumber: o.invoiceNumber,
      engagementId: o.engagementId,
      dueDate: o.dueDate,
      daysPastDue: o.daysPastDue,
      balance: o.balance,
    },
    lastReceipt,
    openInvoices: acc.count,
  };
}

/** Largest over-90 first, then the total, then the name. */
function byExposure(a: ReceivableRow, b: ReceivableRow): number {
  const d = toPaise(b.over90) - toPaise(a.over90) || toPaise(b.total) - toPaise(a.total);
  if (d !== 0n) return d > 0n ? 1 : -1;
  return a.name.localeCompare(b.name);
}

/**
 * PS-203 · the receivables report from the open invoices: each client's and
 * each engagement partner's balance by age band, their oldest invoice, and a
 * client's last receipt. DI-free and unit-tested; receivables.service.ts
 * feeds it.
 */
export function buildReceivables(
  asOf: string,
  open: OpenReceivable[],
  lastReceipts: Map<string, { date: string; amount: string }>,
): ReceivablesReport {
  const clients = new Map<string, Acc>();
  const partners = new Map<string, Acc>();
  const all = blank(null, 'All');
  for (const r of open) {
    if (toPaise(r.balance) <= 0n) continue;
    add(all, r);
    const c = clients.get(r.clientId) ?? blank(r.clientId, r.clientName);
    clients.set(r.clientId, c);
    add(c, r);
    const pk = r.partnerId ?? '';
    const p = partners.get(pk) ?? blank(r.partnerId, r.partnerName ?? 'No engagement partner');
    partners.set(pk, p);
    add(p, r);
  }
  return {
    asOf,
    totals: {
      ...bandsOf(all),
      total: fromPaise(sum(all, RECEIVABLE_BANDS)),
      over90: fromPaise(sum(all, OVER_90)),
    },
    byPartner: [...partners.values()].map((p) => toRow(p, null)).sort(byExposure),
    byClient: [...clients.values()]
      .map((c) => toRow(c, lastReceipts.get(c.id!) ?? null))
      .sort(byExposure),
  };
}
