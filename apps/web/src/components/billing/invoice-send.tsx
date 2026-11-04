'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Mail, MessageCircle, Send } from 'lucide-react';
import {
  INVOICE_SEND_CHANNEL,
  PERMISSION,
  type InvoiceSendChannel,
  type InvoiceSendOptions,
  type InvoiceSendRecord,
  type SendInvoiceResult,
} from '@hsdg/contracts';
import { ApiError, apiFetch, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';

export type SendButton = InvoiceSendChannel | 'download';

/**
 * The ways an issued invoice can go out, in order: e-mail from the portal
 * (when it sends mail), the biller's own mail app (an e-mail on file), WhatsApp
 * (a phone WhatsApp takes) — and download, always. Pure — tested.
 */
export function sendButtons(o: InvoiceSendOptions | undefined, maySend: boolean): SendButton[] {
  const out: SendButton[] = [];
  if (o && maySend) {
    if (o.email && o.emailDelivery) out.push(INVOICE_SEND_CHANNEL.email);
    if (o.email) out.push(INVOICE_SEND_CHANNEL.mailApp);
    if (o.whatsappNumber) out.push(INVOICE_SEND_CHANNEL.whatsapp);
  }
  out.push('download');
  return out;
}

/** What the panel says when no contact is on file. Pure — tested. */
export function noContactNote(o: InvoiceSendOptions | undefined): string | null {
  if (!o || o.email || o.whatsappNumber) return null;
  return 'No e-mail or mobile number for this client — download the PDF and send it yourself, or add a contact on the client.';
}

const SENT_BY: Record<InvoiceSendChannel, string> = {
  email: 'e-mailed',
  mail_app: 'mail app',
  whatsapp: 'WhatsApp',
};

/** "Sent 4 Nov 2026 · WhatsApp · +91 98100 00000 · Partner X". Pure — tested. */
export function invoiceSendLine(r: InvoiceSendRecord): string {
  return [
    `Sent ${formatDate(r.createdAt)}`,
    SENT_BY[r.channel],
    r.recipient,
    r.automatic ? 'automatic' : r.sentByName,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Quick invoices · send an issued invoice: e-mail and WhatsApp when the client
 * has them, else (and always) download. Each message carries a 30-day link to
 * the PDF. billing.manage / engagement.manage send; readers see the log.
 */
export function InvoiceSend({
  engagementId,
  invoiceId,
  invoiceNumber,
}: {
  engagementId: string;
  invoiceId: string;
  invoiceNumber: string;
}): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/invoices/${invoiceId}`;
  const maySend =
    can(principal, PERMISSION.engagementManage) || can(principal, PERMISSION.billingManage);
  const options = useQuery({
    queryKey: ['engagement', engagementId, 'invoice-send-options', invoiceId],
    queryFn: () => apiFetch<InvoiceSendOptions>(`${base}/send-options`),
  });
  const logKey = ['engagement', engagementId, 'invoice-sends', invoiceId] as const;
  const log = useQuery({
    queryKey: logKey,
    queryFn: () => apiFetch<InvoiceSendRecord[]>(`${base}/sends`),
  });

  const send = useMutation({
    mutationFn: (channel: InvoiceSendChannel) =>
      apiFetch<SendInvoiceResult>(`${base}/send`, { method: 'POST', body: { channel } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: logKey });
      if (r.queued) toast(`Invoice e-mailed to ${r.to}.`);
      else if (r.waUrl) {
        window.open(r.waUrl, '_blank', 'noopener');
        toast('WhatsApp opened with the message — press send there.');
      } else if (r.mailtoUrl) {
        window.location.href = r.mailtoUrl;
        toast('Your mail app opened with the invoice link — press send there.');
      }
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not send.', 'error'),
  });

  const download = async (): Promise<void> => {
    try {
      await downloadFile(`${base}/pdf`, `${invoiceNumber.replace(/\//g, '-')}.pdf`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not download.', 'error');
    }
  };

  const buttons = sendButtons(options.data, maySend);
  const note = noContactNote(options.data);
  const sent = log.data ?? [];

  return (
    <div className="space-y-2" data-testid="invoice-send">
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map((b) =>
          b === 'download' ? (
            <Button key={b} size="sm" variant="secondary" onClick={() => void download()}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          ) : (
            <Button
              key={b}
              size="sm"
              variant={b === INVOICE_SEND_CHANNEL.mailApp ? 'secondary' : 'primary'}
              onClick={() => send.mutate(b)}
              disabled={send.isPending}
            >
              {b === INVOICE_SEND_CHANNEL.whatsapp ? (
                <>
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </>
              ) : b === INVOICE_SEND_CHANNEL.email ? (
                <>
                  <Send className="h-4 w-4" /> E-mail {options.data?.email}
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" /> Open in mail app
                </>
              )}
            </Button>
          ),
        )}
      </div>
      {note && maySend && <p className="text-xs text-ink-muted">{note}</p>}
      {!maySend && (
        <p className="text-xs text-ink-faint">
          The engagement’s manager, a partner or billing staff send invoices to the client.
        </p>
      )}
      {sent.length > 0 && (
        <ul className="space-y-0.5 text-xs text-ink-muted">
          {sent.map((r) => (
            <li key={r.id}>{invoiceSendLine(r)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
