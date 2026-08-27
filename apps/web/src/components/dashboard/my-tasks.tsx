'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { MyTask } from '@/lib/types';
import { Panel, Spinner, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

export function MyTasksPanel(): JSX.Element {
  const q = useQuery({
    queryKey: ['work', 'tasks', 'dashboard'],
    queryFn: () => apiFetch<Paginated<MyTask>>('/work/tasks?limit=6'),
  });

  return (
    <Panel title="My Tasks" linkHref="/tasks" bodyClassName="p-0">
      {q.isLoading && <div className="p-5"><Spinner /></div>}
      {q.data && q.data.items.length === 0 && (
        <div className="p-5"><EmptyState>You&rsquo;re all caught up.</EmptyState></div>
      )}
      <ul>
        {(q.data?.items ?? []).map((t) => {
          const done = t.status === 'done';
          return (
            <li key={t.id} className="flex items-start gap-2.5 border-b border-line px-5 py-3 last:border-0">
              {done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-500" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
              )}
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-sm font-medium', done ? 'text-ink-faint line-through' : 'text-ink')}>
                  {t.title}
                </div>
                <div className="truncate text-xs text-ink-faint">
                  {t.entityName} · {t.engagementCode}
                </div>
              </div>
              {t.dueDate && (
                <div className={cn('shrink-0 text-xs font-medium', t.isOverdue ? 'text-danger-600' : 'text-ink-muted')}>
                  {formatDate(t.dueDate)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
