import type { TreeItem, TreePeriod } from '@hsdg/contracts';

/**
 * Staff Workflow WF-203 — which period a stream tab opens on when the URL
 * names none. Pure — tested.
 */

const CLOSED = new Set(['filed', 'not_applicable']);

function periodItems(p: TreePeriod): TreeItem[] {
  return [...Object.values(p.sections).flatMap((items) => items ?? []), ...p.items];
}

const isOpen = (i: TreeItem): boolean => !CLOSED.has(i.workflowStatus);

/** The quarter (Q1 = Apr–Jun) a YYYY-MM month falls in. */
function quarterOf(month: string): string {
  const m = Number(month.slice(5, 7));
  return `Q${Math.floor(((m + 8) % 12) / 3) + 1}`;
}

/**
 * The period to open, in the tree's own order: the earliest with an open item
 * of mine, else the earliest with any open item, else the one today falls in
 * (its month, or its quarter), else none.
 */
export function defaultPeriodKey(periods: readonly TreePeriod[], today: string): string | null {
  const mine = periods.find((p) => periodItems(p).some((i) => isOpen(i) && i.mine));
  if (mine) return mine.periodKey;
  const open = periods.find((p) => periodItems(p).some(isOpen));
  if (open) return open.periodKey;
  const month = today.slice(0, 7);
  const current =
    periods.find((p) => p.periodKey === month) ??
    periods.find((p) => p.periodKey.endsWith(`:${quarterOf(month)}`));
  return current?.periodKey ?? null;
}
