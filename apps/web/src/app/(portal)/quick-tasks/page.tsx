'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, ArrowLeft, Plus } from 'lucide-react';
import { QUICK_TASK_STATUS_LABEL, type QuickTaskSummary } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Input } from '@/components/form';
import { NewQuickTaskModal } from '@/components/quick-tasks/new-quick-task-modal';
import { QuickTaskThread } from '@/components/quick-tasks/quick-task-thread';
import { QUICK_TASK_KEYS, STATUS_TONE, quickTime } from '@/components/quick-tasks/quick-task-api';

type Box = 'inbox' | 'sent' | 'all';
const BOXES: { key: Box; label: string }[] = [
  { key: 'inbox', label: 'Given to me' },
  { key: 'sent', label: 'Given by me' },
  { key: 'all', label: 'All' },
];

function Row({
  t,
  active,
  onOpen,
}: {
  t: QuickTaskSummary;
  active: boolean;
  onOpen: () => void;
}): JSX.Element {
  const other = t.side === 'sent' ? t.assignedTo : t.assignedBy;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left hover:bg-surface-sunken',
          active && 'bg-primary-50/60',
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-sm text-ink', t.unread > 0 && 'font-semibold')}>
            {t.side === 'sent'
              ? `To ${other.name}`
              : t.side === 'received'
                ? other.name
                : `${t.assignedBy.name} → ${t.assignedTo.name}`}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
            {quickTime(t.lastActivityAt)}
          </span>
        </div>
        <div className={cn('truncate text-sm', t.unread > 0 ? 'text-ink' : 'text-ink-muted')}>
          {t.title}
        </div>
        <div className="flex items-center gap-1.5">
          {t.urgent && t.status !== 'done' && t.status !== 'cancelled' && (
            <Badge tone="danger">Urgent</Badge>
          )}
          <Badge tone={STATUS_TONE[t.status]}>{QUICK_TASK_STATUS_LABEL[t.status]}</Badge>
          {t.late && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-danger-700">
              <AlarmClock className="h-3 w-3" /> Late
            </span>
          )}
          {t.entityLabel && (
            <span className="truncate text-[11px] text-ink-faint">{t.entityLabel}</span>
          )}
          {t.unread > 0 && (
            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-success-600 px-1.5 text-[11px] font-semibold text-white">
              {t.unread}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function QuickTasks(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const open = params.get('t');
  const [box, setBox] = useState<Box>((params.get('box') as Box | null) ?? 'inbox');
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [q, setQ] = useState('');
  const [composing, setComposing] = useState(false);

  const query = new URLSearchParams({ box, state });
  if (q.trim()) query.set('q', q.trim());
  const list = useQuery({
    queryKey: [...QUICK_TASK_KEYS.all, 'list', query.toString()],
    queryFn: () => apiFetch<QuickTaskSummary[]>(`/quick-tasks?${query.toString()}`),
    refetchInterval: 15_000,
  });
  const go = (id: string | null) =>
    router.replace(id ? `/quick-tasks?t=${id}` : '/quick-tasks', { scroll: false });

  return (
    <>
      <PageHeader
        title="Quick tasks"
        subtitle="Urgent jobs handed person to person. They answer Received, Doing (with a time) or Done."
        actions={
          <Button onClick={() => setComposing(true)}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        }
      />
      <div className="grid h-[calc(100vh-13rem)] min-h-[28rem] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-card md:grid-cols-[22rem_1fr]">
        <div className={cn('flex min-h-0 flex-col border-r border-line', open && 'hidden md:flex')}>
          <div className="space-y-2 border-b border-line p-3">
            <div className="flex gap-1 rounded-lg bg-surface-sunken p-1">
              {BOXES.map((b) => (
                <button
                  type="button"
                  key={b.key}
                  onClick={() => setBox(b.key)}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-xs font-medium',
                    box === b.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search task or client…"
                className="py-1.5"
              />
              <select
                value={state}
                onChange={(e) => setState(e.target.value as typeof state)}
                aria-label="Show"
                className="rounded-lg border border-line-strong bg-surface px-2 text-xs text-ink"
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="all">All</option>
              </select>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {list.isLoading && (
              <li className="p-4">
                <Spinner />
              </li>
            )}
            {list.data?.length === 0 && (
              <li className="p-4">
                <EmptyState>
                  {box === 'sent' ? 'You have not given any.' : 'Nothing here.'}
                </EmptyState>
              </li>
            )}
            {list.data?.map((t) => (
              <Row key={t.id} t={t} active={t.id === open} onOpen={() => go(t.id)} />
            ))}
          </ul>
        </div>
        <div className={cn('min-h-0', !open && 'hidden md:block')}>
          {open ? (
            <div className="flex h-full min-h-0 flex-col">
              <button
                type="button"
                onClick={() => go(null)}
                className="flex items-center gap-1 border-b border-line px-4 py-2 text-xs text-ink-muted md:hidden"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> All tasks
              </button>
              <div className="min-h-0 flex-1">
                <QuickTaskThread key={open} id={open} />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-ink-muted">
              Pick a task to see its thread.
            </div>
          )}
        </div>
      </div>
      {composing && <NewQuickTaskModal onClose={() => setComposing(false)} />}
    </>
  );
}

export default function QuickTasksPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <QuickTasks />
    </Suspense>
  );
}
