import {
  FEE_WAIVER_REASON_MIN,
  sumAmounts,
  type FeeWaiver,
  type SetAsideFee,
  type SetAsideKind,
  type UnbilledEngagement,
  type UnbilledItem,
  type UnbilledSource,
} from '@hsdg/contracts';
import { formatDate } from '@/lib/format';

export const SOURCE_LABEL: Record<UnbilledSource, string> = {
  retainer: 'Retainer',
  year_fee: 'Year fee',
  milestone: 'Milestone fee',
};

/**
 * "Invoice TALLY/0412 of 30 Apr 2026 — Asha Rao, 3 Oct 2026", or
 * "Not billed: first month free — …"; older rows say only why.
 */
export function setAsideLine(
  a: Pick<SetAsideFee, 'reason' | 'byName' | 'at'> &
    Partial<Pick<SetAsideFee, 'kind' | 'externalInvoiceNumber' | 'externalInvoiceDate'>>,
): string {
  let what = a.reason;
  if (a.kind === 'billed_outside' && a.externalInvoiceNumber && a.externalInvoiceDate) {
    what = `Invoice ${a.externalInvoiceNumber} of ${formatDate(a.externalInvoiceDate)}`;
    if (!a.reason.startsWith('Billed outside the app:')) what += ` · ${a.reason}`;
  } else if (a.kind === 'not_billing') {
    what = `Not billed: ${a.reason}`;
  }
  const who = [a.byName, a.at ? formatDate(a.at) : null].filter(Boolean).join(', ');
  return who ? `${what} — ${who}` : what;
}

/** "July 2026, August 2026 · asked by Asha Rao, 3 Oct 2026: first two months free". */
export function waiverLine(
  w: Pick<FeeWaiver, 'periods' | 'requestedByName' | 'at' | 'reason'>,
): string {
  const who = [w.requestedByName, formatDate(w.at)].filter(Boolean).join(', ');
  return `${w.periods.map((p) => p.label).join(', ')} · asked by ${who}: ${w.reason}`;
}

/** Why the set-aside cannot go yet, or null when it can. `today` is YYYY-MM-DD. */
export function setAsideProblem(
  form: { kind: SetAsideKind; reason: string; number: string; date: string },
  today: string,
): string | null {
  if (form.kind === 'not_billing') {
    return form.reason.trim().length < FEE_WAIVER_REASON_MIN
      ? `Say why, in at least ${FEE_WAIVER_REASON_MIN} characters; a partner approves it.`
      : null;
  }
  if (!form.number.trim()) return 'Give the number of the invoice raised outside the app.';
  if (!form.date) return 'Give the date of that invoice.';
  if (form.date > today) return 'The outside invoice cannot be dated after today.';
  return null;
}

/** What the ticked periods come to. */
export function selectedTotal(items: UnbilledItem[], picked: ReadonlySet<string>): string {
  return sumAmounts(items.filter((i) => picked.has(i.key)).map((i) => i.amount));
}

/** "Running", "Ended 17 days ago". */
export function ageLine(item: Pick<UnbilledItem, 'ageDays'>): string {
  if (item.ageDays === 0) return 'Running';
  return `Ended ${item.ageDays} day${item.ageDays === 1 ? '' : 's'} ago`;
}

/** The engagement partners in the list, by name, for the filter. */
export function partnersOf(rows: UnbilledEngagement[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.partnerId) seen.set(r.partnerId, r.partnerName ?? 'Partner');
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
