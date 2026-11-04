'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, BellRing, Building2, CheckCheck, Clock, MessageSquareText, X } from 'lucide-react';
import {
  LIVE_EVENT,
  type LiveEvent,
  type QuickTaskDetail,
  type QuickTaskReplyInput,
  type QuickTaskSummary,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { connectLive, type LiveState } from '@/lib/live';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import {
  alertTitle,
  askDesktopAlerts,
  chime,
  desktopAlert,
  desktopAlertsState,
  flashTitle,
  shouldKeepRinging,
  startRinging,
  unlockSound,
} from './alarm';
import { QUICK_TASK_KEYS, quickTime, useQuickTaskReply } from './quick-task-api';
import { MessageBox } from './quick-reply-bar';
import { Bubble, statusLine } from './quick-task-thread';

// ── The queue (pure — tested) ──────────────────────────────────────────────

export interface TaskAlert {
  taskId: string;
  kind: 'assigned' | 'reply';
  urgent: boolean;
  fromName: string | null;
  /** When it happened; with the task, it names this one alert. */
  at: string;
}

/**
 * Names one alert for "dismissed": a new task is one alert however it arrives
 * (live or by polling); each answer is its own.
 */
export const alertKey = (a: Pick<TaskAlert, 'taskId' | 'kind' | 'at'>): string =>
  a.kind === 'assigned' ? `${a.taskId}@assigned` : `${a.taskId}@${a.at}`;

/** A task given to me and not yet answered, as an alert. */
export function alertFromWaiting(t: QuickTaskSummary): TaskAlert {
  return {
    taskId: t.id,
    kind: 'assigned',
    urgent: t.urgent,
    fromName: t.assignedBy.name,
    at: t.createdAt,
  };
}

export function alertFromEvent(e: LiveEvent): TaskAlert {
  return {
    taskId: e.taskId,
    kind: e.kind === LIVE_EVENT.quickTaskAssigned ? 'assigned' : 'reply',
    urgent: e.urgent,
    fromName: e.fromName,
    at: e.at,
  };
}

/**
 * Adds an alert: one card per task (a newer alert on a task replaces the
 * older, keeping its place — a new task stays "assigned" until answered);
 * an alert already dismissed never comes back.
 */
export function enqueueAlert(
  queue: TaskAlert[],
  a: TaskAlert,
  dismissed: ReadonlySet<string>,
): TaskAlert[] {
  if (dismissed.has(alertKey(a))) return queue;
  const i = queue.findIndex((q) => q.taskId === a.taskId);
  if (i < 0) return [...queue, a];
  const was = queue[i]!;
  if (was.kind === a.kind && was.at === a.at) return queue;
  // The same new task heard twice (live, then by polling): keep the first.
  if (was.kind === 'assigned' && a.kind === 'assigned') return queue;
  const next = [...queue];
  next[i] = {
    ...a,
    kind: was.kind === 'assigned' ? 'assigned' : a.kind,
    urgent: a.kind === 'reply' ? a.urgent : was.urgent || a.urgent,
  };
  return next;
}

// ── Dismissed alerts survive a reload of this tab ──────────────────────────

const DISMISSED_KEY = 'dhvaj-task-alerts-dismissed';

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function saveDismissed(s: Set<string>): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* storage unavailable: only this page view remembers */
  }
}

function useHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = (): void => setHidden(document.hidden);
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

// ── The centre: live stream + polling → queue → the card ───────────────────

/**
 * Quick-task alerts. The moment a task is given to this person — or the other
 * person on one of their tasks answers — the screen goes dark and the task
 * sits in the middle: Dismiss, Open Client 360, Mark as doing, Done, and a
 * reply box that chats with the sender live. Urgent tasks, and any alert
 * while the tab is out of sight, ring until answered.
 */
export function TaskAlertCenter({
  waiting,
  onLive,
}: {
  waiting: QuickTaskSummary[];
  /** The live stream's state, so polling can slow down while it is up. */
  onLive?: (s: LiveState) => void;
}): JSX.Element | null {
  const qc = useQueryClient();
  const pathname = usePathname();
  const [queue, setQueue] = useState<TaskAlert[]>([]);
  const dismissed = useRef<Set<string>>(new Set());
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;

  useEffect(() => {
    dismissed.current = loadDismissed();
    return unlockSound();
  }, []);

  const add = useCallback((a: TaskAlert) => {
    setQueue((q) => enqueueAlert(q, a, dismissed.current));
  }, []);

  // The live stream: refresh the task views and raise the card.
  useEffect(() => {
    const stop = connectLive((e) => {
      void qc.invalidateQueries({ queryKey: QUICK_TASK_KEYS.all });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      // On the quick-tasks page the chat is already in front of them.
      if (e.kind === LIVE_EVENT.quickTaskReply && pathRef.current?.startsWith('/quick-tasks')) {
        return;
      }
      add(alertFromEvent(e));
    }, (s) => onLiveRef.current?.(s));
    return stop;
  }, [qc, add]);

  // Polling (and a fresh sign-in): tasks given while they were away.
  useEffect(() => {
    for (const w of waiting) add(alertFromWaiting(w));
  }, [waiting, add]);

  const close = useCallback((a: TaskAlert) => {
    dismissed.current.add(alertKey(a));
    // Seen on screen: the task itself no longer pops up as new.
    dismissed.current.add(alertKey({ ...a, kind: 'assigned' }));
    saveDismissed(dismissed.current);
    setQueue((q) => q.filter((x) => x.taskId !== a.taskId));
  }, []);

  const current = queue[0];
  if (!current || typeof document === 'undefined') return null;
  // On <body>, over the whole app (the top bar's own layer would keep the
  // sidebar out of the dark).
  return createPortal(
    <TaskAlertCard
      key={current.taskId}
      alert={current}
      more={queue.length - 1}
      onClose={() => close(current)}
    />,
    document.body,
  );
}

// ── The card ───────────────────────────────────────────────────────────────

function TaskAlertCard({
  alert,
  more,
  onClose,
}: {
  alert: TaskAlert;
  more: number;
  onClose: () => void;
}): JSX.Element {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const hidden = useHidden();
  const [touched, setTouched] = useState(false);
  const [desktop, setDesktop] = useState(desktopAlertsState());
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: QUICK_TASK_KEYS.one(alert.taskId),
    queryFn: () => apiFetch<QuickTaskDetail>(`/quick-tasks/${alert.taskId}`),
  });
  const t = q.data;
  const reply = useQuickTaskReply(alert.taskId);

  // A new alert on the same card (a fresh answer) asks for attention again.
  useEffect(() => setTouched(false), [alert.at]);

  // Ring: on and on while it must, else once.
  const loop = shouldKeepRinging({ urgent: alert.urgent, hidden, touched });
  useEffect(() => {
    if (loop) return startRinging(alert.urgent);
    return undefined;
  }, [loop, alert.urgent, alert.at]);
  useEffect(() => {
    if (!shouldKeepRinging({ urgent: alert.urgent, hidden: document.hidden, touched: false })) {
      chime(false);
    }
  }, [alert.at, alert.urgent]);

  // Out of sight: a desktop notification and the tab title flashing.
  const title = alertTitle(alert);
  useEffect(() => {
    if (!hidden) return undefined;
    desktopAlert(title, t?.title ?? 'Open the portal to answer.', alert.taskId, alert.urgent);
    return flashTitle(title);
  }, [hidden, title, alert.taskId, alert.urgent, t?.title]);

  // The page behind stays still; the reply box takes the keys.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [t?.messages.length]);

  // Seen: their messages are read once the card is on screen.
  const unread = t?.unread ?? 0;
  useEffect(() => {
    if (!t || unread === 0 || hidden) return;
    void apiFetch(`/quick-tasks/${t.id}/read`, { method: 'POST' }).then(() => {
      void qc.invalidateQueries({ queryKey: QUICK_TASK_KEYS.inbox });
    });
  }, [t, unread, hidden, qc]);

  const answer = (input: QuickTaskReplyInput, then?: () => void): void =>
    reply.mutate(input, {
      onSuccess: () => {
        onClose();
        then?.();
      },
      onError: (err) =>
        toast(err instanceof ApiError ? err.message : 'Could not send the answer.', 'error'),
    });

  const canSet = t?.canSet ?? [];
  const acknowledge = (then?: () => void): void => {
    // Dismissing a new task tells the sender it reached them.
    if (t && t.status === 'sent' && canSet.includes('received')) answer({ status: 'received' }, then);
    else {
      onClose();
      then?.();
    }
  };

  const from = t ? (t.side === 'sent' ? t.assignedTo.name : t.assignedBy.name) : alert.fromName;
  const heading =
    alert.kind === 'assigned'
      ? `${alert.urgent ? 'Urgent task' : 'New task'} from ${from ?? 'someone'}`
      : `${from ?? 'Someone'} answered`;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="task-alert-heading"
      data-testid="task-alert"
      onPointerDownCapture={() => setTouched(true)}
      onKeyDownCapture={() => setTouched(true)}
    >
      <div
        className={cn(
          'flex max-h-[min(90vh,46rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-surface shadow-2xl',
          alert.urgent ? 'border-danger-500 ring-4 ring-danger-500/30' : 'border-line-strong',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-3 px-5 py-3 text-white',
            alert.urgent ? 'bg-danger-600' : 'bg-primary-600',
          )}
        >
          {alert.kind === 'assigned' ? (
            <BellRing className={cn('h-5 w-5 shrink-0', loop && 'animate-bounce')} aria-hidden />
          ) : (
            <MessageSquareText className="h-5 w-5 shrink-0" aria-hidden />
          )}
          <h2 id="task-alert-heading" className="min-w-0 flex-1 truncate text-sm font-semibold">
            {heading}
          </h2>
          <span className="text-xs text-white/80">{quickTime(alert.at)}</span>
          {more > 0 && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
              +{more} more
            </span>
          )}
        </div>

        {!t ? (
          <div className="p-6">
            {q.isError ? (
              <p className="text-sm text-ink-muted">This task can no longer be opened.</p>
            ) : (
              <Spinner />
            )}
          </div>
        ) : (
          <>
            <div className="border-b border-line px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-faint">#{t.number}</span>
                {t.urgent && <Badge tone="danger">Urgent</Badge>}
                {t.late && (
                  <Badge tone="danger">
                    <AlarmClock className="mr-1 inline h-3 w-3" />
                    Late
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-lg font-semibold leading-snug text-ink">{t.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-muted">
                {t.entityLabel && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" /> {t.entityLabel}
                  </span>
                )}
                {t.engagementLabel && <span>{t.engagementLabel}</span>}
                {t.dueAt && (
                  <span className="font-medium text-danger-700">Needed by {quickTime(t.dueAt)}</span>
                )}
              </div>
              {t.details && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{t.details}</p>
              )}
            </div>

            {t.messages.length > 0 && (
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-sunken/50 px-5 py-3">
                {t.messages.map((m) => {
                  const line = statusLine(m);
                  return (
                    <Bubble key={m.id} mine={m.mine} name={m.authorName} at={m.createdAt} read={!!m.readAt}>
                      {line && <div className={cn('font-semibold', m.body && 'mb-0.5')}>{line}</div>}
                      {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
                    </Bubble>
                  );
                })}
                <div ref={end} />
              </div>
            )}

            {t.canWrite && (
              <div className="border-t border-line px-5 py-3">
                <MessageBox taskId={t.id} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-raised px-5 py-3">
              <Button variant="ghost" size="sm" onClick={() => acknowledge()} disabled={reply.isPending}>
                <X className="h-4 w-4" /> Dismiss
              </Button>
              {t.entityId && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={reply.isPending}
                  onClick={() => acknowledge(() => router.push(`/entities/${t.entityId}`))}
                >
                  <Building2 className="h-4 w-4" /> Open Client 360
                </Button>
              )}
              <span className="flex-1" />
              {canSet.includes('doing') && t.status !== 'doing' && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={reply.isPending}
                  onClick={() => answer({ status: 'doing' })}
                >
                  <Clock className="h-4 w-4" /> Mark as doing
                </Button>
              )}
              {canSet.includes('done') && (
                <Button size="sm" disabled={reply.isPending} onClick={() => answer({ status: 'done' })}>
                  <CheckCheck className="h-4 w-4" /> {t.side === 'received' ? 'Done' : 'Mark done'}
                </Button>
              )}
            </div>
          </>
        )}

        {desktop === 'default' && (
          <button
            type="button"
            className="border-t border-line px-5 py-2 text-left text-xs text-primary-700 hover:bg-surface-sunken"
            onClick={() => void askDesktopAlerts().then(setDesktop)}
          >
            Alert me even when this tab is in the background →
          </button>
        )}
      </div>
    </div>
  );
}
