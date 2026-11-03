'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card } from '@/components/ui';
import { CompletionBar } from '@/components/completion';

/**
 * One row of GET /work-sets — the shape of WorkSetSummary in
 * packages/contracts/src/work-sets.ts (C-3, the other track). Kept here until
 * that contract is on this branch; at merge, import the type from
 * '@hsdg/contracts' and delete this copy.
 */
export interface MyWorkSet {
  id: string;
  name: string;
  assignedToId: string;
  assignedToName: string;
  assignedById: string | null;
  assignedByName: string | null;
  dueDate: string | null;
  note: string | null;
  taskCount: number;
  openCount: number;
  doneCount: number;
  createdAt: string;
  closedAt: string | null;
}

/** Open sets first, then by due date (none last). Pure. */
export function sortSets(sets: MyWorkSet[]): MyWorkSet[] {
  return [...sets].sort(
    (a, b) =>
      Number(!!a.closedAt) - Number(!!b.closedAt) ||
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'),
  );
}

export function MySetsList({ sets }: { sets: MyWorkSet[] }): JSX.Element | null {
  if (sets.length === 0) return null;
  return (
    <Card className="mb-4 p-0">
      <h3 className="border-b border-line px-4 py-2 text-sm font-semibold text-ink">My sets</h3>
      <ul className="divide-y divide-line">
        {sortSets(sets).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
              <span className="block truncate text-xs text-ink-faint">
                {s.assignedByName ? `From ${s.assignedByName}` : 'Set'}
                {s.dueDate ? ` · due ${formatDate(s.dueDate)}` : ''}
                {s.note ? ` · ${s.note}` : ''}
                {s.closedAt ? ' · closed' : ''}
              </span>
            </span>
            <CompletionBar done={s.doneCount} total={s.taskCount} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * C-5 — the sets given to me (C-3). Nothing shows while the server has no
 * /work-sets yet, or when I hold none.
 */
export function MySets(): JSX.Element | null {
  const sets = useQuery({
    queryKey: ['work', 'sets', 'assigned_to'],
    queryFn: () => apiFetch<MyWorkSet[]>('/work-sets?mine=assigned_to'),
    retry: false,
    staleTime: 30_000,
  });
  if (!sets.data) return null;
  return <MySetsList sets={sets.data} />;
}
