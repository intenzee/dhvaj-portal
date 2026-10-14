'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Copy } from 'lucide-react';
import {
  CLIENT_REMINDER_CHANNEL,
  FEATURE_FLAG,
  type ClientChase as Chase,
  type ClientReminderResult,
  type WorkspaceInstance,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

export const clientChaseKey = (instanceId: string) => ['filing', 'chase', instanceId] as const;

/** "Waiting on client: Bank statement, Purchase register" — null when nothing is outstanding. Pure — tested. */
export function waitingLine(chase: Pick<Chase, 'waitingOn' | 'notRequested'>): string | null {
  const labels = [
    ...chase.waitingOn.map((w) => w.label),
    ...chase.notRequested.map((n) => n.label),
  ];
  return labels.length > 0 ? `Waiting on client: ${labels.join(', ')}` : null;
}

/** The reminder button's words: e-mail when the firm can, else text to paste. Pure — tested. */
export function reminderButtonLabel(chase: Pick<Chase, 'canEmail' | 'clientEmail'>): string {
  return chase.canEmail
    ? `E-mail reminder${chase.clientEmail ? ` to ${chase.clientEmail}` : ''}`
    : 'Send reminder';
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a filing's client reminder (WF-302): e-mailed when the firm's channel
 * is on and the client has an address, otherwise returned as text, copied to
 * the clipboard and kept in `pasteText` for the caller to show. Shared by the
 * filing panel and Today's "Remind client" row action.
 */
export function useClientReminder(instanceId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pasteText, setPasteText] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      apiFetch<ClientReminderResult>(`/compliance-instances/${instanceId}/client-chase/remind`, {
        method: 'POST',
      }),
    onSuccess: async (r) => {
      if (r.channel === CLIENT_REMINDER_CHANNEL.email) {
        setPasteText(null);
        toast('Reminder e-mailed to the client.');
      } else {
        setPasteText(r.text);
        toast(
          (await copy(r.text))
            ? 'Reminder copied — paste it to the client.'
            : 'Reminder ready to copy.',
        );
      }
      void qc.invalidateQueries({ queryKey: clientChaseKey(instanceId) });
      if (r.raised > 0) void qc.invalidateQueries({ queryKey: ['filing', 'instance', instanceId] });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not send the reminder.', 'error'),
  });
  return { ...m, pasteText };
}

/** The reminder text to paste, with a Copy button — shown when it couldn't go by e-mail. */
export function ReminderPaste({ text }: { text: string }): JSX.Element {
  const toast = useToast();
  return (
    <div className="space-y-1">
      <textarea
        readOnly
        aria-label="Reminder text"
        value={text}
        rows={Math.min(8, text.split('\n').length + 1)}
        className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink"
      />
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          void copy(text).then((ok) =>
            toast(ok ? 'Copied.' : 'Select the text and copy it.', ok ? 'success' : 'error'),
          )
        }
      >
        <Copy className="h-4 w-4" /> Copy
      </Button>
    </div>
  );
}

/**
 * Staff Workflow WF-302 — client chasing on the filing: what the filing still
 * needs from the client, and one button to remind them. The reminder goes by
 * e-mail (with fresh upload links) when the firm's channel is on and the
 * client has an address; otherwise the text is shown ready to paste into
 * WhatsApp or e-mail. A client upload into a slot closes its request on the
 * server, so the list shrinks on its own. Behind ff_filing_runs.
 */
export function ClientChase({ instance }: { instance: WorkspaceInstance }): JSX.Element | null {
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.filingRuns);
  const closed =
    instance.workflowStatus === 'filed' || instance.workflowStatus === 'not_applicable';
  const qc = useQueryClient();

  const chase = useQuery({
    queryKey: clientChaseKey(instance.id),
    queryFn: () => apiFetch<Chase>(`/compliance-instances/${instance.id}/client-chase`),
    enabled: on && !closed,
  });

  // An upload or a "received" in the workspace may close a request: re-read.
  const { refetch } = chase;
  const wsUpdatedAt = qc.getQueryState(['filing', 'instance', instance.id])?.dataUpdatedAt;
  useEffect(() => {
    if (on && !closed && wsUpdatedAt) void refetch();
  }, [wsUpdatedAt, on, closed, refetch]);

  const remind = useClientReminder(instance.id);
  const pasteText = remind.pasteText;

  if (!on || closed || !chase.data) return null;
  const line = waitingLine(chase.data);
  if (!line) return null;
  const overdue = chase.data.waitingOn.some((w) => w.overdue);

  return (
    <section
      aria-label="Waiting on client"
      className="space-y-2 rounded-md border border-warning-500/30 bg-warning-50 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm font-medium text-warning-700">{line}</p>
        {overdue && <Badge tone="danger">Escalated</Badge>}
        <Button
          size="sm"
          variant="secondary"
          disabled={remind.isPending}
          onClick={() => remind.mutate()}
        >
          <BellRing className="h-4 w-4" />
          {remind.isPending ? 'Sending…' : reminderButtonLabel(chase.data)}
        </Button>
      </div>
      {chase.data.waitingOn.length > 0 && (
        <ul className="space-y-0.5 text-xs text-ink-muted">
          {chase.data.waitingOn.map((w) => (
            <li key={w.dependencyId} data-request-id={w.dependencyId}>
              {w.label} — asked {formatDate(w.requestDate)}
              {w.reminderDate && `, remind ${formatDate(w.reminderDate)}`}
              {w.escalationDate && `, escalate ${formatDate(w.escalationDate)}`}
              {w.overdue && <span className="ml-1 font-medium text-danger-600">overdue</span>}
            </li>
          ))}
        </ul>
      )}
      {pasteText && <ReminderPaste text={pasteText} />}
    </section>
  );
}

/**
 * WF-201 / WF-302 — Today's "Remind client" row action: the filing's reminder
 * without opening it. Behind ff_filing_runs, like the rest of client chasing.
 */
export function RemindClientButton({ instanceId }: { instanceId: string }): JSX.Element | null {
  const { isOn } = useFeatureFlags();
  const remind = useClientReminder(instanceId);
  if (!isOn(FEATURE_FLAG.filingRuns)) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={remind.isPending}
        onClick={(e) => {
          e.stopPropagation();
          remind.mutate();
        }}
      >
        <BellRing className="h-4 w-4" />
        {remind.isPending ? 'Sending…' : 'Remind client'}
      </Button>
      {remind.pasteText && (
        <div className="min-w-72 basis-full" onClick={(e) => e.stopPropagation()}>
          <ReminderPaste text={remind.pasteText} />
        </div>
      )}
    </>
  );
}
