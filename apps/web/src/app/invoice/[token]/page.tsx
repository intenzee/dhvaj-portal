'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { InvoiceShareInfo } from '@hsdg/contracts';
import { API_BASE, apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';

function money(amount: string | null): string {
  return Number(amount ?? 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
}

/**
 * PUBLIC invoice page (no login). The link the firm sends with an invoice
 * opens it here for 30 days: who it is from, the amount and due date, and the
 * PDF. Nothing else is visible.
 */
export default function InvoiceLinkPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<InvoiceShareInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch<InvoiceShareInfo>(`/invoice-links/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setFailed(true));
  }, [token]);

  const valid = info?.valid === true;
  const owing = valid && Number(info.balance ?? 0) > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-line-strong bg-surface p-6 shadow-pop">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-ink">
            {valid && info.invoiceNumber ? `Invoice ${info.invoiceNumber}` : 'Invoice'}
          </h1>
          {valid && info.firmName && <p className="text-sm text-ink-muted">{info.firmName}</p>}
        </div>

        {!info && !failed && <p className="text-sm text-ink-muted">Loading…</p>}

        {(failed || (info && !valid)) && (
          <div className="rounded-lg bg-danger-50 p-4 text-sm text-danger-700">
            This invoice link has expired or is no longer valid. Please ask the firm for a new one.
          </div>
        )}

        {valid && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-raised/60 p-4 text-sm">
              {info.clientName && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-ink-faint">Billed to</dt>
                  <dd className="text-ink">{info.clientName}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Amount</dt>
                <dd className="font-semibold text-ink">{money(info.total)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-ink-faint">Dated</dt>
                <dd className="text-ink">{formatDate(info.issueDate)}</dd>
              </div>
              {owing && (
                <>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-faint">Still to pay</dt>
                    <dd className="text-ink">{money(info.balance)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-faint">Due</dt>
                    <dd className="text-ink">{formatDate(info.dueDate)}</dd>
                  </div>
                </>
              )}
              {!owing && (
                <p className="col-span-2 text-xs text-success-700">Paid — thank you.</p>
              )}
            </dl>
            <a
              href={`${API_BASE}/invoice-links/${encodeURIComponent(token)}/pdf`}
              className="block w-full rounded-lg bg-primary-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-primary-700"
            >
              Download the invoice (PDF)
            </a>
            <p className="text-center text-xs text-ink-faint">
              The bank details for payment are on the invoice.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
