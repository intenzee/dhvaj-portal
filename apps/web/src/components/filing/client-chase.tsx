'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Copy, MessageCircle } from 'lucide-react';
import {
  CLIENT_REMINDER_CHANNEL,
  CLIENT_REMINDER_FALLBACK,
  FEATURE_FLAG,
  type ClientReminderChannel,
  type ClientReminderFallback,
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

/** The reminder button's words, by the channel the firm's setting picks for this client. Pure — tested. */
export function reminderButtonLabel(chase: Pick<Chase, 'channel' | 'clientEmail'>): string {
  if (chase.channel === CLIENT_REMINDER_CHANNEL.email)
    return `E-mail reminder${chase.clientEmail ? ` to ${chase.clientEmail}` : ''}`;
  if (chase.channel === CLIENT_REMINDER_CHANNEL.whatsapp) return 'WhatsApp reminder';
  return 'Send reminder';
}

/**
 * PS-001 — offer WhatsApp beside the firm's channel: the client's phone works
 * on WhatsApp and the firm's channel for this client is something else.
 * Pure — tested.
 */
export function offersWhatsapp(chase: Pick<Chase, 'canWhatsapp' | 'channel'>): boolean {
  return chase.canWhatsapp && chase.channel !== CLIENT_REMINDER_CHANNEL.whatsapp;
}

/** Why the reminder is text to copy instead of the firm's channel; null when copy is the channel. Pure — tested. */
export function fallbackNote(fallback: ClientReminderFallback | null): string | null {
  if (fallback === CLIENT_REMINDER_FALLBACK.noPhone)
    return 'The client has no phone number for WhatsApp — copy the text instead.';
  if (fallback === CLIENT_REMINDER_FALLBACK.noEmail)
    return 'The client cannot be e-mailed — copy the text instead.';
  return null;
}

/** A reminder the team still has to send: opened in WhatsApp or copied. */
export type ReminderToSend = Exclude<ClientReminderResult, { channel: 'email' }>;

/** The reminders a person still has to send, out of a batch. Pure — tested. */
export function remindersToSend(reminders: readonly ClientReminderResult[]): ReminderToSend[] {
  return reminders.filter((r): r is ReminderToSend => r.channel !== CLIENT_REMINDER_CHANNEL.email);
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
 * Send a filing's client reminder (WF-302) by the firm's channel — or, given
 * one, by that channel (PS-001: WhatsApp when the firm e-mails): e-mailed by
 * the server, or kept in `toSend` for the caller to show — a WhatsApp link to
 * open, or text (copied to the clipboard) to paste. Shared by the filing
 * panel and Today's "Remind client" row action.
 */
export function useClientReminder(instanceId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [toSend, setToSend] = useState<ReminderToSend | null>(null);
  const m = useMutation({
    mutationFn: (channel: ClientReminderChannel | void) =>
      apiFetch<ClientReminderResult>(`/compliance-instances/${instanceId}/client-chase/remind`, {
        method: 'POST',
        ...(channel ? { body: { channel } } : {}),
      }),
    onSuccess: async (r) => {
      if (r.channel === CLIENT_REMINDER_CHANNEL.email) {
        setToSend(null);
        toast(`Reminder e-mailed to ${r.to}.`);
      } else if (r.channel === CLIENT_REMINDER_CHANNEL.whatsapp) {
        setToSend(r);
        toast('Reminder ready — open WhatsApp to send it.');
      } else {
        setToSend(r);
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
  return { ...m, toSend };
}

/** "WhatsApp": the same reminder, from the client's phone, whatever the firm's channel (PS-001). */
function WhatsappReminderButton({
  remind,
}: {
  remind: ReturnType<typeof useClientReminder>;
}): JSX.Element {
  const sending = remind.isPending && remind.variables === CLIENT_REMINDER_CHANNEL.whatsapp;
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Remind on WhatsApp"
      disabled={remind.isPending}
      onClick={(e) => {
        e.stopPropagation();
        remind.mutate(CLIENT_REMINDER_CHANNEL.whatsapp);
      }}
    >
      <MessageCircle className="h-4 w-4" />
      {sending ? 'Opening…' : 'WhatsApp'}
    </Button>
  );
}

/** "Copy text": the reminder to the clipboard, with a toast either way. */
function CopyTextButton({ text, label }: { text: string; label?: string }): JSX.Element {
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      onClick={() =>
        void copy(text).then((ok) =>
          toast(ok ? 'Copied.' : 'Select the text and copy it.', ok ? 'success' : 'error'),
        )
      }
    >
      <Copy className="h-4 w-4" /> Copy text
    </Button>
  );
}

/** "Open WhatsApp": wa.me with the reminder filled in, in a new tab (the app on a phone). */
function OpenWhatsApp({ url, label }: { url: string; label?: string }): JSX.Element {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-md bg-success-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-success-700"
    >
      <MessageCircle className="h-4 w-4" /> Open WhatsApp
    </a>
  );
}

/**
 * A reminder still to send: "Open WhatsApp" under the WhatsApp channel, else
 * the text with "Copy text" (and why, when the firm's channel couldn't be used).
 */
export function ReminderToSendPanel({ reminder }: { reminder: ReminderToSend }): JSX.Element {
  const note =
    reminder.channel === CLIENT_REMINDER_CHANNEL.copy ? fallbackNote(reminder.fallback) : null;
  const text = reminder.text;
  return (
    <div className="space-y-1">
      {note && <p className="text-xs text-ink-muted">{note}</p>}
      <textarea
        readOnly
        aria-label="Reminder text"
        value={text}
        rows={Math.min(8, text.split('\n').length + 1)}
        className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink"
      />
      <div className="flex flex-wrap items-center gap-2">
        {reminder.channel === CLIENT_REMINDER_CHANNEL.whatsapp && (
          <OpenWhatsApp url={reminder.waUrl} />
        )}
        <CopyTextButton text={text} />
      </div>
    </div>
  );
}

/**
 * Filing runs: the reminders of a bulk remind that the team still has to send,
 * one row per client with "Open WhatsApp" or "Copy text".
 */
export function RemindersToSend({
  reminders,
  onDismiss,
}: {
  reminders: ReminderToSend[];
  onDismiss: () => void;
}): JSX.Element {
  const whatsapp = reminders.some((r) => r.channel === CLIENT_REMINDER_CHANNEL.whatsapp);
  return (
    <section
      aria-label="Reminders to send"
      className="space-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-ink">
          {reminders.length} reminder{reminders.length === 1 ? '' : 's'} to send
          {whatsapp ? ' — open each in WhatsApp' : ' — copy each to the client'}
        </p>
        <button type="button" onClick={onDismiss} className="text-xs font-medium underline">
          Done
        </button>
      </div>
      <ul className="divide-y divide-line">
        {reminders.map((r) => {
          const note = r.channel === CLIENT_REMINDER_CHANNEL.copy ? fallbackNote(r.fallback) : null;
          return (
            <li key={r.instanceId} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="flex-1 text-ink">
                {r.client}
                {note && <span className="block text-xs text-ink-muted">{note}</span>}
              </span>
              {r.channel === CLIENT_REMINDER_CHANNEL.whatsapp && (
                <OpenWhatsApp url={r.waUrl} label={`Open WhatsApp for ${r.client}`} />
              )}
              <CopyTextButton text={r.text} label={`Copy text for ${r.client}`} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Staff Workflow WF-302 — client chasing on the filing: what the filing still
 * needs from the client, and one button to remind them by the firm's channel:
 * e-mail (with fresh upload links), "Open WhatsApp" with the text filled in,
 * or the text to copy — the fallback when the client has no address or phone. A client upload into a slot closes its request on the
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
          {remind.isPending && !remind.variables ? 'Sending…' : reminderButtonLabel(chase.data)}
        </Button>
        {offersWhatsapp(chase.data) && <WhatsappReminderButton remind={remind} />}
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
      {remind.toSend && <ReminderToSendPanel reminder={remind.toSend} />}
    </section>
  );
}

/**
 * WF-201 / WF-302 — Today's "Remind client" row action: the filing's reminder
 * without opening it, and "WhatsApp" beside it when the client has a phone the
 * firm's channel would not use (PS-001). Behind ff_filing_runs, like the rest
 * of client chasing.
 */
export function RemindClientButton({ instanceId }: { instanceId: string }): JSX.Element | null {
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.filingRuns);
  const remind = useClientReminder(instanceId);
  // The same query the filing panel reads, so opening the filing is instant.
  const chase = useQuery({
    queryKey: clientChaseKey(instanceId),
    queryFn: () => apiFetch<Chase>(`/compliance-instances/${instanceId}/client-chase`),
    enabled: on,
    staleTime: 60_000,
  });
  if (!on) return null;
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
        {remind.isPending && !remind.variables ? 'Sending…' : 'Remind client'}
      </Button>
      {chase.data && offersWhatsapp(chase.data) && <WhatsappReminderButton remind={remind} />}
      {remind.toSend && (
        <div className="min-w-72 basis-full" onClick={(e) => e.stopPropagation()}>
          <ReminderToSendPanel reminder={remind.toSend} />
        </div>
      )}
    </>
  );
}
