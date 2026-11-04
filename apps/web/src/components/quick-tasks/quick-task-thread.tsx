'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Building2, Check, CheckCheck } from 'lucide-react';
import {
  QUICK_TASK_STATUS_LABEL,
  type QuickTaskDetail,
  type QuickTaskMessage,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Badge, Spinner } from '@/components/ui';
import { QUICK_TASK_KEYS, STATUS_TONE, quickTime } from './quick-task-api';
import { MessageBox, QuickAnswers } from './quick-reply-bar';

export function statusLine(m: QuickTaskMessage): string | null {
  if (!m.status && !m.etaAt) return null;
  if (m.status === 'sent') return 'Reopened';
  const label = m.status ? QUICK_TASK_STATUS_LABEL[m.status] : 'New time';
  return m.etaAt ? `${label} — done by ${quickTime(m.etaAt)}` : label;
}

export function Bubble({
  mine,
  name,
  at,
  read,
  children,
}: {
  mine: boolean;
  name: string | null;
  at: string;
  read?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
          mine
            ? 'rounded-br-md bg-primary-600 text-white'
            : 'rounded-bl-md border border-line bg-surface text-ink',
        )}
      >
        {!mine && name && (
          <div className="mb-0.5 text-xs font-semibold text-primary-700">{name}</div>
        )}
        {children}
        <div
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[10px]',
            mine ? 'text-white/70' : 'text-ink-faint',
          )}
        >
          {quickTime(at)}
          {mine &&
            (read ? (
              <CheckCheck className="h-3 w-3" aria-label="Seen" />
            ) : (
              <Check className="h-3 w-3" aria-label="Sent" />
            ))}
        </div>
      </div>
    </div>
  );
}

/** One quick task as a chat: the task first, then every answer and message. */
export function QuickTaskThread({ id }: { id: string }): JSX.Element {
  const qc = useQueryClient();
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: QUICK_TASK_KEYS.one(id),
    queryFn: () => apiFetch<QuickTaskDetail>(`/quick-tasks/${id}`),
    refetchInterval: 8_000,
  });
  const t = q.data;
  const unread = t?.unread ?? 0;

  useEffect(() => {
    if (!t || unread === 0 || !t.canWrite) return;
    void apiFetch(`/quick-tasks/${id}/read`, { method: 'POST' }).then(() => {
      void qc.invalidateQueries({ queryKey: QUICK_TASK_KEYS.all });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    });
  }, [id, t, unread, qc]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [t?.messages.length]);

  if (q.isLoading) return <Spinner />;
  if (!t) return <p className="p-4 text-sm text-ink-muted">This task is not yours to see.</p>;
  const givenByMe = t.side === 'sent';
  const lastReadOfMine = (m: QuickTaskMessage) => !!m.readAt;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-faint">#{t.number}</span>
          {t.urgent && <Badge tone="danger">Urgent</Badge>}
          <Badge tone={STATUS_TONE[t.status]}>{QUICK_TASK_STATUS_LABEL[t.status]}</Badge>
          {t.late && (
            <Badge tone="danger">
              <AlarmClock className="mr-1 inline h-3 w-3" />
              Late
            </Badge>
          )}
          {t.etaAt && t.status === 'doing' && (
            <span className="text-xs text-ink-muted">done by {quickTime(t.etaAt)}</span>
          )}
        </div>
        <h2 className="mt-1 text-base font-semibold text-ink">{t.title}</h2>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
          <span>
            {t.assignedBy.name} → {t.assignedTo.name}
          </span>
          {t.entityLabel &&
            (t.entityId ? (
              <Link
                href={`/entities/${t.entityId}`}
                className="inline-flex items-center gap-1 text-primary-700 hover:underline"
              >
                <Building2 className="h-3 w-3" /> {t.entityLabel}
              </Link>
            ) : (
              <span>{t.entityLabel}</span>
            ))}
          {t.dueAt && <span>needed by {quickTime(t.dueAt)}</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-sunken/50 px-4 py-3">
        <Bubble mine={givenByMe} name={t.assignedBy.name} at={t.createdAt} read={!!t.receivedAt}>
          <div className="font-medium">{t.title}</div>
          {t.details && <div className="mt-1 whitespace-pre-wrap">{t.details}</div>}
        </Bubble>
        {t.messages.map((m) => {
          const line = statusLine(m);
          return (
            <Bubble
              key={m.id}
              mine={m.mine}
              name={m.authorName}
              at={m.createdAt}
              read={lastReadOfMine(m)}
            >
              {line && <div className={cn('font-semibold', m.body && 'mb-0.5')}>{line}</div>}
              {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
            </Bubble>
          );
        })}
        <div ref={end} />
      </div>

      {t.canWrite && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          <QuickAnswers task={t} canSet={t.canSet} />
          <MessageBox taskId={t.id} />
        </div>
      )}
    </div>
  );
}
