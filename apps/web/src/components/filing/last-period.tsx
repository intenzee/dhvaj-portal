'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FilingReferenceKind, LastPeriodView } from '@hsdg/contracts';
import { apiFetch, ApiError, downloadFile } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Button, Spinner } from '@/components/ui';
import { FilingStatusBadge } from './filing-status';

const REFERENCE: Record<FilingReferenceKind, string> = {
  arn: 'ARN',
  srn: 'SRN',
  token: 'Token no.',
  ack: 'Ack no.',
  challan: 'Challan',
  internal: 'Internal ref.',
};

export const lastPeriodKey = (instanceId: string) => ['filing', 'last-period', instanceId] as const;

type Previous = NonNullable<LastPeriodView['previous']>;

/** One checklist answer as read back: Done (note), N/A — reason, or Open. */
export function answerText(i: Previous['checklist'][number]): string {
  if (i.status === 'done') return i.doneNote ? `Done · ${i.doneNote}` : 'Done';
  if (i.status === 'not_applicable') return `N/A — ${i.naReason ?? ''}`.trim();
  return 'Open';
}

/**
 * Staff Workflow WF-303 — last period beside this one: a toggle in the filing
 * panel showing the previous period's uploads, checklist answers, filed
 * reference and review points, read-only. Documents open (download) in place,
 * without leaving this filing. Fetched only when shown.
 */
export function LastPeriod({ instanceId }: { instanceId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: lastPeriodKey(instanceId),
    queryFn: () => apiFetch<LastPeriodView>(`/compliance-instances/${instanceId}/last-period`),
    enabled: open,
    staleTime: 60_000,
  });
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        aria-pressed={open}
        aria-controls={`last-period-${instanceId}`}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide last period' : 'Last period'}
      </Button>
      {open && (
        <section
          id={`last-period-${instanceId}`}
          aria-label="Last period"
          className="mt-2 space-y-3 rounded-md border border-line bg-surface-sunken/40 p-3 text-xs"
        >
          {q.isLoading && <Spinner label="Loading last period…" />}
          {q.isError && (
            <p className="text-danger-700">
              {q.error instanceof ApiError ? q.error.message : 'Could not load last period.'}
            </p>
          )}
          {q.data && !q.data.previous && (
            <p className="text-ink-muted">No earlier period for this filing.</p>
          )}
          {q.data?.previous && <PreviousPeriod p={q.data.previous} />}
        </section>
      )}
    </div>
  );
}

function PreviousPeriod({ p }: { p: Previous }): JSX.Element {
  const download = (id: string, name: string) =>
    void downloadFile(`/engagements/${p.engagementId}/documents/${id}/download`, name);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">
          {p.formLabel ?? p.ruleName} · {p.periodLabel || p.periodKey}
        </span>
        <FilingStatusBadge status={p.workflowStatus} />
        <span className="text-ink-muted">read-only</span>
      </div>

      {p.filing ? (
        <p>
          Filed {formatDate(p.filing.filedOn)}
          {p.filing.filedByName ? ` by ${p.filing.filedByName}` : ''} ·{' '}
          {p.filing.referenceNo ? (
            <>
              {REFERENCE[p.filing.referenceKind]}{' '}
              <span className="font-mono">{p.filing.referenceNo}</span>
            </>
          ) : (
            <span className="text-warning-700">reference to be added</span>
          )}
          {p.filing.isNil && ' · nil'}{' '}
          {p.filing.ackDocumentId ? (
            <button
              type="button"
              className="text-primary-700 underline-offset-2 hover:underline"
              onClick={() => download(p.filing!.ackDocumentId!, 'acknowledgement')}
            >
              acknowledgement
            </button>
          ) : (
            <span className="text-warning-700">· acknowledgement to be added</span>
          )}
        </p>
      ) : (
        <p className="text-ink-muted">Not filed.</p>
      )}

      <div>
        <h6 className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">Uploads</h6>
        {p.slots.length === 0 ? (
          <p className="text-ink-muted">No uploads.</p>
        ) : (
          <ul className="space-y-1" aria-label="Last period uploads">
            {p.slots.map((s) => (
              <li key={s.slotCode}>
                <span className="text-ink">{s.label}</span>
                <ul className="pl-3">
                  {s.documents.map((d) => (
                    <li key={d.id} className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-primary-700 underline-offset-2 hover:underline"
                        onClick={() => download(d.id, d.filename ?? d.title)}
                      >
                        {d.filename ?? d.title}
                      </button>
                      <span className="text-ink-muted">
                        {formatDate(d.uploadedAt)} ·{' '}
                        {d.fromClient ? 'from client' : (d.uploadedByName ?? '—')}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.checklist.length > 0 && (
        <div>
          <h6 className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">Checklist</h6>
          <ul className="space-y-0.5" aria-label="Last period checklist">
            {p.checklist.map((i) => (
              <li key={i.itemCode} className="flex flex-wrap gap-2">
                <span className="text-ink">{i.label}</span>
                <span className="ml-auto text-ink-muted">{answerText(i)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.reviewPoints.length > 0 && (
        <div>
          <h6 className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">
            Review points
          </h6>
          <ul className="space-y-1" aria-label="Last period review points">
            {p.reviewPoints.map((r) => (
              <li key={r.at}>
                <span className="text-ink">{r.note}</span>{' '}
                <span className="text-ink-muted">
                  — {r.byName ?? '—'}, {formatDate(r.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
