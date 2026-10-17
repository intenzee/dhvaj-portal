import { sumAmounts, type UnbilledEngagement, type UnbilledItem } from '@hsdg/contracts';

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
