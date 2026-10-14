'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { FEATURE_FLAG, type Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useWorkHref } from '@/lib/work-href';
import { formatDate } from '@/lib/format';
import type { MyTask } from '@/lib/types';
import { Panel, Spinner, EmptyState } from '@/components/ui';
import { SectionSelect, useStoredSections, withSections } from '@/components/section-filter';
import { cn } from '@/lib/cn';

export function MyTasksPanel(): JSX.Element {
  const [sections, setSections] = useStoredSections('home-tasks');
  const workHref = useWorkHref();
  const { isOn } = useFeatureFlags();
  // With ff_work_links the Tasks page is a My Work tab.
  const listHref = withSections(
    isOn(FEATURE_FLAG.workLinks) ? '/my-work?tab=tasks' : '/tasks',
    sections,
  );
  const q = useQuery({
    queryKey: ['work', 'tasks', 'dashboard', sections],
    queryFn: () => apiFetch<Paginated<MyTask>>(withSections('/work/tasks?limit=6', sections)),
  });

  return (
    <Panel
      title="My Tasks"
      linkHref={listHref}
      bodyClassName="p-0"
      toolbar={<SectionSelect value={sections} onChange={setSections} />}
    >
      {q.isLoading && <div className="p-5"><Spinner /></div>}
      {q.data && q.data.items.length === 0 && (
        <div className="p-5">
          <EmptyState>
            {sections.length ? 'No tasks for you in this section.' : <>You&rsquo;re all caught up.</>}
          </EmptyState>
        </div>
      )}
      <ul>
        {(q.data?.items ?? []).map((t) => {
          const done = t.status === 'done';
          return (
            <li key={t.id} className="border-b border-line last:border-0">
              <Link href={workHref(t)} className="flex items-start gap-2.5 px-5 py-3 hover:bg-surface-raised">
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
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
