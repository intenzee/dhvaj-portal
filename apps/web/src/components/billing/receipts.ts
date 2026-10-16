import { allocateOldestFirst, toPaise, fromPaise, type OpenInvoice } from '@hsdg/contracts';

/** One editable allocation row in Record receipt. */
export interface AllocationDraft {
  invoiceId: string;
  amount: string;
}

/** A typed amount as paise, or null when it is not a plain amount. */
function paise(s: string): bigint | null {
  try {
    return s.trim() ? toPaise(s.trim()) : 0n;
  } catch {
    return null;
  }
}

/** net + TDS, as typed; null while either is not an amount. Pure — tested. */
export function receiptGross(net: string, tds: string): string | null {
  const n = paise(net);
  const t = paise(tds);
  if (n === null || t === null || n < 0n || t < 0n) return null;
  return fromPaise(n + t);
}

/** Every open invoice's row, filled oldest due first from the gross. Pure — tested. */
export function autoAllocate(gross: string | null, open: OpenInvoice[]): AllocationDraft[] {
  const fill = gross
    ? new Map(allocateOldestFirst(gross, open).allocations.map((a) => [a.invoiceId, a.amount]))
    : new Map<string, string>();
  return open.map((i) => ({ invoiceId: i.id, amount: fill.get(i.id) ?? '' }));
}

/**
 * What Record receipt sends, or why it cannot yet: each amount within its
 * invoice's balance, and all of them within the gross; the rest is an
 * advance. Pure — tested.
 */
export function checkAllocations(
  gross: string | null,
  rows: AllocationDraft[],
  open: OpenInvoice[],
): { ok: true; allocations: AllocationDraft[]; advance: string } | { ok: false; error: string } {
  if (!gross || toPaise(gross) <= 0n) return { ok: false, error: 'Enter the amount received.' };
  const balance = new Map(open.map((i) => [i.id, toPaise(i.balance)]));
  const out: AllocationDraft[] = [];
  let total = 0n;
  for (const r of rows) {
    const p = paise(r.amount);
    if (p === null || p < 0n) return { ok: false, error: 'Allocations must be amounts.' };
    if (p === 0n) continue;
    const label = open.find((i) => i.id === r.invoiceId)?.invoiceNumber ?? 'an invoice';
    if (p > (balance.get(r.invoiceId) ?? 0n)) {
      return { ok: false, error: `More than the balance on ${label}.` };
    }
    total += p;
    out.push({ invoiceId: r.invoiceId, amount: fromPaise(p) });
  }
  if (total > toPaise(gross)) {
    return { ok: false, error: `Allocations exceed the receipt's ${gross} (net plus TDS).` };
  }
  return { ok: true, allocations: out, advance: fromPaise(toPaise(gross) - total) };
}

/** Statement line kinds as the client reads them. Pure — tested. */
export function statementKindLabel(kind: string): string {
  switch (kind) {
    case 'invoice':
      return 'Invoice';
    case 'receipt':
      return 'Received';
    case 'tds':
      return 'TDS deducted';
    case 'credit_note':
      return 'Credit note';
    case 'write_off':
      return 'Written off';
    case 'marked_paid':
      return 'Marked paid';
    default:
      return kind;
  }
}
