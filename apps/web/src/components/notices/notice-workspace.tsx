'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Upload } from 'lucide-react';
import {
  NOTICE_EVENT_KIND_LABEL,
  NOTICE_OUTCOME_LABEL,
  NOTICE_SERVED_VIA_LABEL,
  NOTICE_STREAM_LABEL,
  isNoticeOpen,
  noticeTypeLabel,
  type AppealNoticeResponse,
  type Notice,
  type NoticeDocument,
  type NoticeEvent,
  type NoticeEventKind,
} from '@hsdg/contracts';
import { ApiError, downloadFile } from '@/lib/api';
import { formatDate } from '@/lib/format';
import {
  noticeDocumentDownloadPath,
  noticeKey,
  startAppealClock,
  uploadNoticeDocument,
  type NoticeDocumentType,
} from '@/lib/notices-api';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@/components/ui';
import { Select } from '@/components/form';
import { money, NoticeClockBadge, NoticeStatusBadge } from './notice-bits';
import {
  AppealModal,
  CloseModal,
  EditNoticeModal,
  EVENT_SPEC,
  EventModal,
  VoidEventModal,
} from './notice-actions';

type Dialog =
  | { kind: 'event'; event: NoticeEventKind }
  | { kind: 'close'; accept?: boolean }
  | { kind: 'appeal' }
  | { kind: 'void'; event: NoticeEvent }
  | { kind: 'edit' }
  | null;

/** The event actions on an open notice, in the order a notice usually runs. */
const EVENT_ACTIONS: NoticeEventKind[] = [
  'reply_filed',
  'hearing',
  'adjournment_sought',
  'adjournment_granted',
  'submission',
  'order',
  'note',
];

/** Timeline order: newest first; the same day falls back to when it was recorded. */
export function timelineOrder(events: NoticeEvent[]): NoticeEvent[] {
  return [...events].sort((a, b) =>
    a.occurredOn === b.occurredOn
      ? b.createdAt.localeCompare(a.createdAt)
      : b.occurredOn.localeCompare(a.occurredOn),
  );
}

const DOC_GROUPS: { type: NoticeDocumentType; label: string }[] = [
  { type: 'notice', label: 'Notice' },
  { type: 'reply', label: 'Replies and submissions' },
  { type: 'order', label: 'Orders' },
];

function Fact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="truncate text-sm text-ink">{children}</div>
    </div>
  );
}

/** PS-102 / PS-103 — one notice: its clock, timeline, documents and what to do next. */
export function NoticeWorkspace({ notice: n }: { notice: Notice }): JSX.Element {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [appealed, setAppealed] = useState<AppealNoticeResponse | null>(null);
  const close = (): void => setDialog(null);
  const toast = useToast();
  const qc = useQueryClient();
  const clock = useMutation({
    mutationFn: () => startAppealClock(n.id, n.version),
    onSuccess: (next) => {
      qc.setQueryData(noticeKey(n.id), next);
      toast(
        next.appealDueOn
          ? `Appeal clock started: appeal by ${formatDate(next.appealDueOn)}.`
          : 'Appeal clock started.',
      );
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not start the appeal clock.', 'error'),
  });
  const open = isNoticeOpen(n.status) && n.status !== 'appealed';
  const canAct = n.can.edit && open;
  const afterOrder = n.status === 'order_received';
  const events = useMemo(() => timelineOrder(n.events), [n.events]);
  const appealEngagement = appealed
    ? { id: appealed.engagementId, code: appealed.engagementCode }
    : n.appealEngagementId
      ? { id: n.appealEngagementId, code: n.appealEngagementCode ?? 'Appeal engagement' }
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: '/notices', label: 'Notices' }}
        title={noticeTypeLabel(n.noticeType)}
        subtitle={`${NOTICE_STREAM_LABEL[n.noticeType.stream]} · Ref ${n.referenceNo}`}
        actions={
          n.can.edit ? (
            <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'edit' })}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <NoticeClockBadge clock={n.clock} className="px-2.5 py-1 text-sm" />
            <NoticeStatusBadge status={n.status} />
            <span className="text-lg font-semibold tabular-nums text-ink">
              {money(n.amountDemanded)}
            </span>
            {n.amountDemanded && <span className="text-xs text-ink-faint">demanded</span>}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Fact label="Client">
              <Link href={`/entities/${n.entityId}`} className="text-primary-700 hover:underline">
                {n.entityName}
              </Link>
            </Fact>
            <Fact label="Engagement">
              <Link
                href={`/engagements/${n.engagementId}`}
                className="text-primary-700 hover:underline"
              >
                {n.engagementCode}
              </Link>
            </Fact>
            <Fact label="Owner">{n.ownerName}</Fact>
            <Fact label="Reviewer">{n.reviewerName ?? '—'}</Fact>
            <Fact label="Issued">{formatDate(n.issuedOn)}</Fact>
            <Fact label="Received">
              {formatDate(n.receivedOn)} · {NOTICE_SERVED_VIA_LABEL[n.servedVia]}
            </Fact>
            <Fact label="Reply due (department)">{formatDate(n.replyDueOn)}</Fact>
            <Fact label="Our date">{formatDate(n.internalDueOn)}</Fact>
            {n.nextHearingOn && <Fact label="Next hearing">{formatDate(n.nextHearingOn)}</Fact>}
            {n.appealDueOn && <Fact label="Appeal by">{formatDate(n.appealDueOn)}</Fact>}
            <Fact label="Year">
              {[
                n.financialYear && `FY ${n.financialYear}`,
                n.assessmentYear && `AY ${n.assessmentYear}`,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </Fact>
            {(n.periodFrom || n.periodTo) && (
              <Fact label="Period">
                {formatDate(n.periodFrom)} – {formatDate(n.periodTo)}
              </Fact>
            )}
            {n.registrationNumber && <Fact label="Registration">{n.registrationNumber}</Fact>}
            {n.outcome && (
              <Fact label="Outcome">
                {NOTICE_OUTCOME_LABEL[n.outcome]}
                {n.outcomeAmount != null && ` · ${money(n.outcomeAmount)}`}
                {n.closedOn && ` · ${formatDate(n.closedOn)}`}
              </Fact>
            )}
          </div>
          {n.summary && <p className="whitespace-pre-wrap text-sm text-ink-muted">{n.summary}</p>}
          {appealEngagement && (
            <p className="rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-800">
              Appealed —{' '}
              <Link
                href={`/engagements/${appealEngagement.id}`}
                className="font-semibold underline"
              >
                open the appeal engagement {appealEngagement.code}
              </Link>
              .
            </p>
          )}
        </CardBody>
      </Card>

      {canAct && afterOrder && (
        <Card className="border-warning-500/40">
          <CardBody className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold text-ink">The order is in. Appeal or accept it?</div>
              <div className="text-ink-muted">
                {n.appealDueOn
                  ? `The appeal limitation runs to ${formatDate(n.appealDueOn)}.`
                  : n.can.startAppealClock
                    ? 'The appeal clock hasn’t started: the order was recorded by someone who doesn’t lead the engagement.'
                    : n.noticeType.appealable
                      ? 'The appeal date appears once the engagement partner or manager starts the appeal clock.'
                      : 'This notice type is not appealable.'}
              </div>
            </div>
            {n.can.startAppealClock && (
              <Button variant="secondary" disabled={clock.isPending} onClick={() => clock.mutate()}>
                Start appeal clock
              </Button>
            )}
            {n.can.appeal && <Button onClick={() => setDialog({ kind: 'appeal' })}>Appeal</Button>}
            <Button variant="secondary" onClick={() => setDialog({ kind: 'close', accept: true })}>
              Accept
            </Button>
          </CardBody>
        </Card>
      )}

      {canAct && (
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Record on this notice">
          {EVENT_ACTIONS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={k === 'reply_filed' || k === 'order' ? 'primary' : 'secondary'}
              onClick={() => setDialog({ kind: 'event', event: k })}
            >
              {EVENT_SPEC[k]?.title ?? NOTICE_EVENT_KIND_LABEL[k]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'close' })}>
            Close notice
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardBody>
            {events.length === 0 ? (
              <EmptyState>
                Nothing recorded yet — the reply, hearings and the order go here.
              </EmptyState>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <TimelineRow
                    key={e.id}
                    event={e}
                    doc={n.documents.find((d) => d.id === e.documentId) ?? null}
                    engagementId={n.engagementId}
                    onVoid={
                      n.can.edit && !e.voidedAt
                        ? () => setDialog({ kind: 'void', event: e })
                        : undefined
                    }
                  />
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
        <NoticeDocuments notice={n} />
      </div>

      {dialog?.kind === 'event' && <EventModal notice={n} kind={dialog.event} onClose={close} />}
      {dialog?.kind === 'close' && <CloseModal notice={n} accept={dialog.accept} onClose={close} />}
      {dialog?.kind === 'appeal' && (
        <AppealModal notice={n} onClose={close} onAppealed={setAppealed} />
      )}
      {dialog?.kind === 'void' && (
        <VoidEventModal notice={n} event={dialog.event} onClose={close} />
      )}
      {dialog?.kind === 'edit' && <EditNoticeModal notice={n} onClose={close} />}
    </div>
  );
}

function TimelineRow({
  event: e,
  doc,
  engagementId,
  onVoid,
}: {
  event: NoticeEvent;
  doc: NoticeDocument | null;
  engagementId: string;
  onVoid?: () => void;
}): JSX.Element {
  const voided = !!e.voidedAt;
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          voided ? 'bg-line-strong' : 'bg-primary-600',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'flex flex-wrap items-baseline gap-x-2 text-sm',
            voided && 'text-ink-faint line-through',
          )}
        >
          <span className="font-semibold">{NOTICE_EVENT_KIND_LABEL[e.kind]}</span>
          <span className="text-ink-muted">{formatDate(e.occurredOn)}</span>
          {e.nextDate && (
            <span className="text-ink-muted">
              → {e.kind === 'hearing' || e.kind === 'adjournment_granted' ? 'hearing' : 'next'}{' '}
              {formatDate(e.nextDate)}
            </span>
          )}
          {e.ackReference && (
            <span className="font-mono text-xs text-ink-muted">Ack {e.ackReference}</span>
          )}
        </div>
        {e.body && (
          <p className={cn('whitespace-pre-wrap text-sm text-ink-muted', voided && 'line-through')}>
            {e.body}
          </p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <span>
            {e.createdByName ?? '—'} · {formatDate(e.createdAt)}
          </span>
          {e.documentId && (
            <button
              type="button"
              className="text-primary-700 hover:underline"
              onClick={() =>
                void downloadFile(
                  noticeDocumentDownloadPath(engagementId, e.documentId!),
                  doc?.filename ?? 'document',
                )
              }
            >
              {doc?.title ?? 'Document'}
            </button>
          )}
          {voided && (
            <span className="text-danger-700">
              Voided {formatDate(e.voidedAt)}
              {e.voidReason ? ` — ${e.voidReason}` : ''}
            </span>
          )}
          {onVoid && (
            <button
              type="button"
              className="text-ink-muted hover:text-danger-700 hover:underline"
              onClick={onVoid}
            >
              Void
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Documents grouped notice / reply / order, with an upload filed under the notice. */
function NoticeDocuments({ notice: n }: { notice: Notice }): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [type, setType] = useState<NoticeDocumentType>('notice');
  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadNoticeDocument({
        engagementId: n.engagementId,
        file,
        documentType: type,
        noticeId: n.id,
      }),
    onSuccess: () => {
      toast('Document uploaded.');
      void qc.invalidateQueries({ queryKey: noticeKey(n.id) });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Upload failed.', 'error'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {DOC_GROUPS.map((g) => {
          const docs = n.documents.filter((d) => d.documentType === g.type);
          return (
            <div key={g.type}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {g.label} ({docs.length})
              </div>
              {docs.length === 0 ? (
                <p className="text-xs text-ink-faint">None yet.</p>
              ) : (
                <ul className="space-y-1">
                  {docs.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{d.title}</span>
                        <span className="block truncate text-xs text-ink-faint">
                          {formatDate(d.uploadedAt)}
                          {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-primary-600"
                        title={`Download ${d.filename ?? d.title}`}
                        aria-label={`Download ${d.title}`}
                        onClick={() =>
                          void downloadFile(
                            noticeDocumentDownloadPath(n.engagementId, d.id),
                            d.filename ?? d.title,
                          ).catch((err: unknown) =>
                            toast(err instanceof Error ? err.message : 'Download failed.', 'error'),
                          )
                        }
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {n.can.edit && (
          <div className="flex items-center gap-2 border-t border-line pt-3">
            <Select
              className="w-auto"
              value={type}
              onChange={(e) => setType(e.target.value as NoticeDocumentType)}
              aria-label="Document type"
            >
              {DOC_GROUPS.map((g) => (
                <option key={g.type} value={g.type}>
                  {g.type === 'notice' ? 'Notice' : g.type === 'reply' ? 'Reply' : 'Order'}
                </option>
              ))}
            </Select>
            <label
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-raised',
                upload.isPending && 'pointer-events-none opacity-50',
              )}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              {upload.isPending ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                className="sr-only"
                aria-label="Upload a notice document"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) upload.mutate(f);
                }}
              />
            </label>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
