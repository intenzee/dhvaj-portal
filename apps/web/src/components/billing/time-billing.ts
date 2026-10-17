import { fromPaise, toPaise, type BillableTimeEntry, type TimeLineDraft } from '@hsdg/contracts';

/** "Unbilled", "On INV/26-27/0004", "On a draft invoice", "Correction awaiting approval". */
export function timeStatusLine(
  e: Pick<BillableTimeEntry, 'status' | 'invoiceNumber' | 'invoiceStatus'>,
): string {
  if (e.status === 'correction_pending') return 'Correction awaiting approval';
  if (e.status === 'billed') {
    return e.invoiceNumber && e.invoiceStatus !== 'draft'
      ? `On ${e.invoiceNumber}`
      : 'On a draft invoice';
  }
  return 'Unbilled';
}

/** The entries to bill: every unbilled one not unticked. */
export function pickedEntries(
  entries: BillableTimeEntry[],
  unticked: ReadonlySet<string>,
): BillableTimeEntry[] {
  return entries.filter((e) => e.status === 'unbilled' && !unticked.has(e.entryId));
}

/** The streams the picked time falls in, once each, in first-seen order. */
export function pickedStreams(picked: BillableTimeEntry[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const e of picked) if (!seen.has(e.stream)) seen.set(e.stream, e.streamLabel);
  return [...seen].map(([key, label]) => ({ key, label }));
}

/** Hours × rate over the lines, before tax, to the paisa. */
export function linesTotal(lines: Pick<TimeLineDraft, 'quantity' | 'unitAmount'>[]): string {
  const paise = lines.reduce(
    (sum, l) => sum + (toPaise(l.quantity) * toPaise(l.unitAmount) + 50n) / 100n,
    0n,
  );
  return fromPaise(paise);
}
