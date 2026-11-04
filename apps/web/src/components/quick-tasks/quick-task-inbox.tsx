'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import type { QuickTaskInbox } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { LiveState } from '@/lib/live';
import { QUICK_TASK_KEYS } from './quick-task-api';
import { TaskAlertCenter } from './task-alert';

/**
 * The top bar's quick-task button (unread answers and new tasks), and the
 * full-screen alert a new task — or an answer — raises on whatever screen its
 * person is on. Alerts arrive live; polling catches anything missed (more
 * often while the live stream is down).
 */
export function QuickTaskInboxButton(): JSX.Element | null {
  const { principal } = useAuth();
  const [live, setLive] = useState<LiveState>('connecting');
  const inbox = useQuery({
    queryKey: QUICK_TASK_KEYS.inbox,
    queryFn: () => apiFetch<QuickTaskInbox>('/quick-tasks/inbox'),
    refetchInterval: live === 'live' ? 60_000 : 15_000,
    refetchIntervalInBackground: true,
    enabled: !!principal?.employeeId,
  });
  const waiting = useMemo(() => inbox.data?.waiting ?? [], [inbox.data]);

  if (!principal?.employeeId) return null;
  const unread = inbox.data?.unread ?? 0;

  return (
    <>
      <Link
        href="/quick-tasks"
        title={`Quick tasks${unread ? ` — ${unread} new` : ''}`}
        aria-label="Quick tasks"
        className="relative rounded-lg p-2 text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
      >
        <MessageSquareText className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-success-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
      <TaskAlertCenter waiting={waiting} onLive={setLive} />
    </>
  );
}
