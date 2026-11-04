'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, MessageSquarePlus } from 'lucide-react';
import { QUICK_TASK_STATUS_LABEL, type QuickTaskSummary } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui';
import { NewQuickTaskModal, type QuickTaskEngagement } from './new-quick-task-modal';
import { QUICK_TASK_KEYS, STATUS_TONE, quickTime } from './quick-task-api';

const SHOWN = 4;

/** The engagement's open quick tasks the caller can see (theirs, or all for the MP / admin). */
function useEngagementQuickTasks(engagementId: string) {
  const { principal } = useAuth();
  return useQuery({
    queryKey: [...QUICK_TASK_KEYS.all, 'engagement', engagementId],
    queryFn: () =>
      apiFetch<QuickTaskSummary[]>(
        `/quick-tasks?engagementId=${encodeURIComponent(engagementId)}&state=open`,
      ),
    refetchInterval: 30_000,
    enabled: !!principal?.employeeId,
  });
}

/**
 * The highlighted "New task" window on an engagement's tab line: a quick task
 * given from here carries the engagement and its client, and the open ones
 * are listed under the tabs.
 */
export function EngagementQuickTasks({
  engagement,
}: {
  engagement: QuickTaskEngagement;
}): JSX.Element | null {
  const { principal } = useAuth();
  const [composing, setComposing] = useState(false);
  const tasks = useEngagementQuickTasks(engagement.id);
  if (!principal?.employeeId) return null;
  const open = Array.isArray(tasks.data) ? tasks.data : [];

  return (
    <section
      aria-label="Quick tasks on this engagement"
      className="mt-3 flex flex-col gap-2 rounded-xl border border-primary-300 bg-primary-50 px-3 py-2.5 sm:flex-row sm:items-start"
    >
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
        >
          <MessageSquarePlus className="h-4 w-4" /> New task
        </button>
        <span className="text-xs text-primary-700">
          {open.length === 0
            ? 'No open quick tasks here'
            : `${open.length} open quick task${open.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {open.length > 0 && (
        <ul className="flex min-w-0 flex-1 flex-col gap-1 sm:border-l sm:border-primary-200 sm:pl-3">
          {open.slice(0, SHOWN).map((t) => (
            <li key={t.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <Link
                href={`/quick-tasks?t=${t.id}`}
                className="min-w-0 truncate font-medium text-ink hover:underline"
              >
                {t.title}
              </Link>
              <span className="text-xs text-ink-muted">
                {t.assignedBy.name} → {t.assignedTo.name}
              </span>
              {t.urgent && <Badge tone="danger">Urgent</Badge>}
              <Badge tone={STATUS_TONE[t.status]}>{QUICK_TASK_STATUS_LABEL[t.status]}</Badge>
              {(t.etaAt ?? t.dueAt) && (
                <span
                  className={`inline-flex items-center gap-0.5 text-xs ${
                    t.late ? 'font-medium text-danger-700' : 'text-ink-faint'
                  }`}
                >
                  {t.late && <AlarmClock className="h-3 w-3" />}
                  {t.etaAt ? 'Done by' : 'Needed by'} {quickTime((t.etaAt ?? t.dueAt)!)}
                </span>
              )}
            </li>
          ))}
          {open.length > SHOWN && (
            <li className="text-xs">
              <Link href="/quick-tasks?box=all" className="text-primary-700 hover:underline">
                {open.length - SHOWN} more in Quick tasks →
              </Link>
            </li>
          )}
        </ul>
      )}
      {composing && (
        <NewQuickTaskModal engagement={engagement} onClose={() => setComposing(false)} />
      )}
    </section>
  );
}
