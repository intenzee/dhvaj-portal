import type { ReceivableRow } from '@hsdg/contracts';

/** "INV/26-27/0012 · 45 days overdue" / "… · due in 3 days". Pure — tested. */
export function oldestLine(o: NonNullable<ReceivableRow['oldestInvoice']>): string {
  const n = o.daysPastDue;
  const when =
    n > 0
      ? `${n} day${n === 1 ? '' : 's'} overdue`
      : n === 0
        ? 'due today'
        : `due in ${-n} day${n === -1 ? '' : 's'}`;
  return `${o.invoiceNumber ?? 'Invoice'} · ${when}`;
}
