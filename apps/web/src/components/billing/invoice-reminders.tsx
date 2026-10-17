'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Copy, MessageCircle } from 'lucide-react';
import {
  PERMISSION,
  type InvoiceDetail,
  type InvoiceReminderRecord,
  type InvoiceReminderResult,
  type RemindInvoiceInput,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { fallbackNote } from '@/components/filing/client-chase';

const SENT_BY: Record<InvoiceReminderRecord['channel'], string> = {
  email: 'e-mailed',
  whatsapp: 'WhatsApp',
  copy: 'text copied',
};

/** "Reminded 16 Oct 2026 · WhatsApp · 20 days past due · Manager X". Pure — tested. */
export function invoiceReminderLine(r: InvoiceReminderRecord): string {
  return [
    `Reminded ${formatDate(r.createdAt)}`,
    SENT_BY[r.channel],
    r.daysPastDue !== null && r.daysPastDue > 0 ? `${r.daysPastDue} days past due` : null,
    r.automatic ? 'automatic' : r.sentByName,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type ToSend = Exclude<InvoiceReminderResult, { channel: 'email' }>;

/**
 * PS-203 · On an issued, unpaid invoice: remind the client to pay, by the
 * firm's client-chase channel (PS-001) or WhatsApp / copied text, and the
 * reminders already sent. billing.manage sends; billing readers see the log.
 */
export function InvoiceReminders({ invoice }: { invoice: InvoiceDetail }): JSX.Element | null {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [toSend, setToSend] = useState<ToSend | null>(null);
  const key = ['billing', 'invoice-reminders', invoice.id] as const;
  const log = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<InvoiceReminderRecord[]>(`/billing/invoices/${invoice.id}/reminders`),
  });
  const open = invoice.status === 'issued' || invoice.status === 'partially_paid';
  const mayRemind = open && can(principal, PERMISSION.billingManage);

  const remind = useMutation({
    mutationFn: (channel: RemindInvoiceInput['channel'] | void) =>
      apiFetch<InvoiceReminderResult>(`/billing/invoices/${invoice.id}/remind`, {
        method: 'POST',
        body: channel ? { channel } : {},
      }),
    onSuccess: async (r) => {
      if (r.channel === 'email') {
        setToSend(null);
        toast(`Payment reminder e-mailed to ${r.to}.`);
      } else if (r.channel === 'whatsapp') {
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
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not send the reminder.', 'error'),
  });

  const rows = log.data ?? [];
  if (!mayRemind && rows.length === 0) return null;
  const note = toSend?.channel === 'copy' ? fallbackNote(toSend.fallback) : null;

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">Payment reminders</span>
        {mayRemind && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={remind.isPending}
              onClick={() => remind.mutate()}
            >
              <BellRing className="h-4 w-4" />{' '}
              {remind.isPending && !remind.variables ? 'Sending…' : 'Remind client'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remind.isPending}
              onClick={() => remind.mutate('whatsapp')}
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remind.isPending}
              onClick={() => remind.mutate('copy')}
            >
              <Copy className="h-4 w-4" /> Copy text
            </Button>
          </div>
        )}
      </div>
      {toSend && (
        <div className="space-y-2 rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm">
          {note && <p className="text-xs text-warning-700">{note}</p>}
          <pre className="whitespace-pre-wrap font-sans text-xs text-ink">{toSend.text}</pre>
          {toSend.channel === 'whatsapp' ? (
            <a
              href={toSend.waUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline"
            >
              <MessageCircle className="h-4 w-4" /> Open WhatsApp
            </a>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => toast((await copy(toSend.text)) ? 'Copied.' : 'Could not copy.')}
            >
              <Copy className="h-4 w-4" /> Copy again
            </Button>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-ink-faint">No reminder sent yet.</p>
      ) : (
        <ul className="space-y-0.5 text-xs text-ink-muted">
          {rows.map((r) => (
            <li key={r.id}>{invoiceReminderLine(r)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
