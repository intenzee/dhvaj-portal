'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, X } from 'lucide-react';
import type { QuickTaskInbox, QuickTaskSummary } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { QUICK_TASK_KEYS, quickTime } from './quick-task-api';
import { QuickAnswers } from './quick-reply-bar';

const SEEN_KEY = 'dhvaj-quick-task-popups';

function seenIds(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function remember(id: string): void {
  try {
    const s = seenIds();
    s.add(id);
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: the pop-up shows again next poll */
  }
}

/** A chime for a new task, where the browser allows sound. */
function chime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    /* no sound */
  }
}

function Popup({ t, onClose }: { t: QuickTaskSummary; onClose: () => void }): JSX.Element {
  return (
    <div
      role="alertdialog"
      aria-label={`New task from ${t.assignedBy.name}`}
      className="pointer-events-auto w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line-strong bg-surface p-4 shadow-pop"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white">
          <MessageSquareText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink-faint">
            {t.urgent ? 'Urgent task' : 'Task'} from{' '}
            <span className="font-semibold text-ink">{t.assignedBy.name}</span> ·{' '}
            {quickTime(t.createdAt)}
          </div>
          <Link
            href={`/quick-tasks?t=${t.id}`}
            onClick={onClose}
            className="mt-0.5 block text-sm font-semibold text-ink hover:underline"
          >
            {t.title}
          </Link>
          {t.entityLabel && <div className="text-xs text-ink-muted">{t.entityLabel}</div>}
          {t.dueAt && <div className="text-xs text-danger-700">Needed by {quickTime(t.dueAt)}</div>}
        </div>
        <button
          type="button"
          aria-label="Later"
          title="Later"
          onClick={onClose}
          className="rounded p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3">
        <QuickAnswers task={t} canSet={['received', 'doing', 'done']} onDone={onClose} compact />
      </div>
    </div>
  );
}

/**
 * The top bar's quick-task button (unread answers and new tasks), and the
 * pop-up a new task raises on whatever screen its person is on.
 */
export function QuickTaskInboxButton(): JSX.Element | null {
  const { principal } = useAuth();
  const pathname = usePathname();
  const [, force] = useState(0);
  const known = useRef<Set<string> | null>(null);
  const inbox = useQuery({
    queryKey: QUICK_TASK_KEYS.inbox,
    queryFn: () => apiFetch<QuickTaskInbox>('/quick-tasks/inbox'),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    enabled: !!principal?.employeeId,
  });

  const waiting = useMemo(() => inbox.data?.waiting ?? [], [inbox.data]);
  useEffect(() => {
    if (typeof window === 'undefined' || waiting.length === 0) return;
    const seen = seenIds();
    const fresh = waiting.filter((w) => !seen.has(w.id) && !known.current?.has(w.id));
    if (known.current && fresh.length > 0) chime();
    known.current = new Set([...(known.current ?? []), ...waiting.map((w) => w.id)]);
  }, [waiting]);

  if (!principal?.employeeId) return null;
  const unread = inbox.data?.unread ?? 0;
  const popups =
    typeof window === 'undefined' || pathname?.startsWith('/quick-tasks')
      ? []
      : waiting.filter((w) => !seenIds().has(w.id)).slice(0, 3);

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
      {popups.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {popups.map((t) => (
            <Popup
              key={t.id}
              t={t}
              onClose={() => {
                remember(t.id);
                force((n) => n + 1);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
