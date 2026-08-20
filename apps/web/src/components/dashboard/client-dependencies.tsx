'use client';

import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { daysUntil, deadlineLabel } from '@/lib/format';
import type { MyClientDependency } from '@/lib/types';
import { Panel, Spinner, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

function tone(iso: string | null, overdue: boolean): string {
  if (overdue) return 'text-danger-600';
  const d = daysUntil(iso);
  if (d !== null && d <= 3) return 'text-warning-600';
  return 'text-ink-muted';
}

export function ClientDependenciesPanel(): JSX.Element {
  const q = useQuery({
    queryKey: ['work', 'client-dependencies', 'dashboard'],
    queryFn: () => apiFetch<Paginated<MyClientDependency>>('/work/client-dependencies?limit=5'),
  });

  return (
    <Panel
      title="Client Dependencies"
      linkHref="/client-dependencies"
      bodyClassName="p-0"
    >
      {q.isLoading && <div className="p-5"><Spinner /></div>}
      {q.data && q.data.items.length === 0 && (
        <div className="p-5"><EmptyState>Not waiting on any client information.</EmptyState></div>
      )}
      <ul>
        {(q.data?.items ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-3 border-b border-slate-50 px-5 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">
                {d.entityName} — {d.engagementCode}
              </div>
              <div className="truncate text-xs text-ink-faint">{d.requestedInfo}</div>
            </div>
            <div className={cn('shrink-0 text-xs font-semibold', tone(d.escalationDate, d.isOverdue))}>
              {d.isOverdue ? 'Overdue' : d.escalationDate ? deadlineLabel(d.escalationDate) : 'Waiting'}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
