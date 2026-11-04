'use client';

import { useState } from 'react';
import { Check, CheckCheck, Clock, RotateCcw, Send, X } from 'lucide-react';
import {
  QUICK_TASK_ETA_CHOICES,
  type QuickTaskDetail,
  type QuickTaskReplyInput,
  type QuickTaskSummary,
} from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { useQuickTaskReply } from './quick-task-api';

const chip =
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50';

/**
 * The one-tap answers. The doer: Received, Doing — done in 15 min … Tomorrow,
 * Done. The giver: Mark done, Cancel, Reopen. `compact` for the pop-up.
 */
export function QuickAnswers({
  task,
  canSet,
  onDone,
  compact,
}: {
  task: Pick<QuickTaskSummary, 'id' | 'status' | 'side'>;
  canSet: QuickTaskDetail['canSet'];
  onDone?: () => void;
  compact?: boolean;
}): JSX.Element | null {
  const toast = useToast();
  const reply = useQuickTaskReply(task.id);
  const [eta, setEta] = useState(false);
  const send = (input: QuickTaskReplyInput) =>
    reply.mutate(input, {
      onSuccess: () => {
        setEta(false);
        onDone?.();
      },
      onError: (err) =>
        toast(err instanceof ApiError ? err.message : 'Could not send the answer.', 'error'),
    });
  const doer = task.side === 'received';
  if (canSet.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canSet.includes('received') && (
        <button
          type="button"
          className={`${chip} border-line-strong text-ink hover:bg-surface-sunken`}
          disabled={reply.isPending}
          onClick={() => send({ status: 'received' })}
        >
          <Check className="h-3.5 w-3.5" /> Received
        </button>
      )}
      {doer && canSet.includes('doing') && !eta && (
        <button
          type="button"
          className={`${chip} border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100`}
          disabled={reply.isPending}
          onClick={() => setEta(true)}
        >
          <Clock className="h-3.5 w-3.5" /> {task.status === 'doing' ? 'New time' : 'Doing'}…
        </button>
      )}
      {eta && (
        <span className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-ink-muted">Done in</span>
          {QUICK_TASK_ETA_CHOICES.slice(0, compact ? 5 : undefined).map((c) => (
            <button
              type="button"
              key={c.label}
              className={`${chip} border-primary-300 text-primary-700 hover:bg-primary-50`}
              disabled={reply.isPending}
              onClick={() => send({ status: 'doing', etaMinutes: c.minutes })}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Back"
            className="rounded p-1 text-ink-faint hover:text-ink"
            onClick={() => setEta(false)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
      {canSet.includes('done') && !eta && (
        <button
          type="button"
          className={`${chip} border-success-300 bg-success-50 text-success-700 hover:bg-success-100`}
          disabled={reply.isPending}
          onClick={() => send({ status: 'done' })}
        >
          <CheckCheck className="h-3.5 w-3.5" /> {doer ? 'Done' : 'Mark done'}
        </button>
      )}
      {canSet.includes('cancelled') && !compact && (
        <button
          type="button"
          className={`${chip} border-line-strong text-ink-muted hover:bg-surface-sunken`}
          disabled={reply.isPending}
          onClick={() => {
            if (window.confirm('Cancel this task? They are told.')) send({ status: 'cancelled' });
          }}
        >
          <X className="h-3.5 w-3.5" /> Cancel task
        </button>
      )}
      {canSet.includes('sent') && (
        <button
          type="button"
          className={`${chip} border-line-strong text-ink hover:bg-surface-sunken`}
          disabled={reply.isPending}
          onClick={() => send({ status: 'sent' })}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reopen
        </button>
      )}
    </div>
  );
}

/** The message box under the thread. */
export function MessageBox({ taskId }: { taskId: string }): JSX.Element {
  const toast = useToast();
  const reply = useQuickTaskReply(taskId);
  const [text, setText] = useState('');
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    reply.mutate(
      { body },
      {
        onSuccess: () => setText(''),
        onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not send.', 'error'),
      },
    );
  };
  return (
    <div className="flex items-end gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={4000}
        placeholder="Write a message…"
        aria-label="Message"
        className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-primary-500 focus:outline-none"
      />
      <Button
        size="sm"
        disabled={!text.trim() || reply.isPending}
        onClick={submit}
        aria-label="Send message"
        className="h-10 w-10 rounded-full p-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
