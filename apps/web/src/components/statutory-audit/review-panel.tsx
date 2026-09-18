'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, MessageSquarePlus, Reply, Trash2 } from 'lucide-react';
import {
  PERMISSION,
  type AuditReviewNote,
  type ReviewQueueItem,
  type StatutoryAuditReview,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { Field, Textarea } from '@/components/form';

/**
 * Review — first-class review control (Audit Spec §25, §344). The pending-review
 * queue and the four headline counts are derived from procedure/area state; a
 * review note is anchored to a professional object and moves open → responded →
 * cleared. A blocking open note is the completion gate (§29).
 */

const REVIEW_QK = (id: string) => ['engagement', id, 'statutory-audit-review'];

const NOTE_TONE: Record<string, string> = {
  open: 'warn',
  responded: 'info',
  cleared: 'success',
};

export function ReviewPanel({ engagementId }: { engagementId: string }): JSX.Element | null {
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const query = useQuery({
    queryKey: REVIEW_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditReview[]>(`/engagements/${engagementId}/statutory-audit/review`),
  });

  if (query.isLoading) return <Spinner label="Loading review…" />;
  const review = query.data?.[0];
  if (!review) return null;

  const s = review.summary;

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">Review</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Pending Manager Review" value={s.pendingManagerReview} />
          <Metric label="Pending Partner Review" value={s.pendingPartnerReview} />
          <Metric label="Open Review Notes" value={s.openReviewNotes} />
          <Metric
            label="Overdue Reviews"
            value={s.overdueReviews}
            tone={s.overdueReviews > 0 ? 'danger' : undefined}
          />
        </div>
        {s.blockingOpenNotes > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-danger-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {s.blockingOpenNotes} blocking review note(s) open — completion is prevented (§29).
          </p>
        )}
      </Card>

      {/* Pending-review queue (§25) */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-ink">Review queue</h3>
        {review.queue.length === 0 ? (
          <EmptyState>Nothing is awaiting review. Submit a procedure or area conclusion.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {review.queue.map((q) => (
              <QueueRow
                key={`${q.targetType}:${q.targetId}`}
                engagementId={engagementId}
                workflowInstanceId={review.workflowInstanceId}
                item={q}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Review notes (§344) */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-ink">Review notes</h3>
        {review.notes.length === 0 ? (
          <EmptyState>No review notes raised.</EmptyState>
        ) : (
          <div className="mt-2 space-y-2">
            {review.notes.map((n) => (
              <NoteCard
                key={n.id}
                engagementId={engagementId}
                note={n}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'danger';
}): JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 px-3 py-2">
      <p className={`text-2xl font-semibold ${tone === 'danger' ? 'text-danger-600' : 'text-ink'}`}>
        {value}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}

function QueueRow({
  engagementId,
  workflowInstanceId,
  item,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  item: ReviewQueueItem;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [noting, setNoting] = useState(false);
  const [body, setBody] = useState('');
  const [blocking, setBlocking] = useState(false);

  const raise = useMutation({
    mutationFn: () =>
      apiFetch(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/review/notes`,
        {
          method: 'POST',
          body: {
            targetType: item.targetType,
            targetId: item.targetId,
            body,
            isBlocking: blocking,
          },
        },
      ),
    onSuccess: () => {
      toast('Review note recorded.');
      setNoting(false);
      setBody('');
      setBlocking(false);
      void qc.invalidateQueries({ queryKey: REVIEW_QK(engagementId) });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not record note.'),
  });

  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink">{item.label}</span>
            <Badge tone={item.reviewLevel === 'partner' ? 'info' : 'neutral'}>
              {item.reviewLevel === 'partner' ? 'Partner' : 'Manager'}
            </Badge>
            {item.isOverdue && (
              <Badge tone="danger">
                <AlertTriangle className="mr-1 h-3 w-3" />
                Overdue
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {item.preparerName && `Preparer: ${item.preparerName}`}
            {item.reviewerName && ` · Reviewer: ${item.reviewerName}`}
            {item.dueDate && ` · Due ${formatDate(item.dueDate)}`}
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" className="h-8 shrink-0" onClick={() => setNoting((v) => !v)}>
            <MessageSquarePlus className="mr-1 h-4 w-4" />
            Record note
          </Button>
        )}
      </div>
      {noting && canManage && (
        <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface-sunken/30 p-3">
          <Field label="Review note">
            <Textarea
              rows={2}
              value={body}
              placeholder="Reviewer comment requiring response/clearance…"
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={blocking}
              onChange={(e) => setBlocking(e.target.checked)}
            />
            Blocking — prevents completion until cleared (§29)
          </label>
          <div className="flex gap-2">
            <Button
              className="h-8"
              disabled={raise.isPending || body.trim().length === 0}
              onClick={() => raise.mutate()}
            >
              Record
            </Button>
            <Button variant="secondary" className="h-8" onClick={() => setNoting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function NoteCard({
  engagementId,
  note,
  canManage,
}: {
  engagementId: string;
  note: AuditReviewNote;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState('');
  const invalidate = () => void qc.invalidateQueries({ queryKey: REVIEW_QK(engagementId) });

  const respond = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/review/notes/${note.id}/respond`, {
        method: 'POST',
        body: { response, version: note.version },
      }),
    onSuccess: () => {
      toast('Response recorded.');
      setResponding(false);
      setResponse('');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not respond.'),
  });

  const clear = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/review/notes/${note.id}/clear`, {
        method: 'POST',
        body: { version: note.version },
      }),
    onSuccess: () => {
      toast('Review note cleared.');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not clear note.'),
  });

  const remove = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/review/notes/${note.id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast('Review note removed.');
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove note.'),
  });

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={NOTE_TONE[note.status]}>{note.status}</Badge>
            <Badge tone={note.reviewLevel === 'partner' ? 'info' : 'neutral'}>
              {note.reviewLevel === 'partner' ? 'Partner' : 'Manager'}
            </Badge>
            {note.isBlocking && note.status !== 'cleared' && (
              <Badge tone="danger">Blocking</Badge>
            )}
            {note.targetLabel && (
              <span className="text-xs text-ink-faint">on {note.targetLabel}</span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-ink">{note.body}</p>
          <p className="mt-1 text-[11px] text-ink-faint">
            Raised by {note.raisedByName ?? 'reviewer'} · {formatDate(note.createdAt)}
          </p>
          {note.response && (
            <div className="mt-2 rounded-md bg-surface-sunken/40 px-2.5 py-1.5">
              <p className="text-sm text-ink">{note.response}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                Response by {note.respondedByName ?? 'preparer'}
                {note.respondedAt && ` · ${formatDate(note.respondedAt)}`}
              </p>
            </div>
          )}
          {note.status === 'cleared' && (
            <p className="mt-1 text-[11px] text-success-700">
              Cleared by {note.clearedByName ?? 'reviewer'}
              {note.clearedAt && ` · ${formatDate(note.clearedAt)}`}
            </p>
          )}
        </div>
        {canManage && note.status !== 'cleared' && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="secondary"
              className="h-8"
              onClick={() => setResponding((v) => !v)}
              title="Respond"
            >
              <Reply className="h-4 w-4" />
            </Button>
            <Button className="h-8" onClick={() => clear.mutate()} disabled={clear.isPending}>
              <Check className="mr-1 h-4 w-4" />
              Clear
            </Button>
            <button
              type="button"
              onClick={() => remove.mutate()}
              className="text-ink-faint hover:text-danger-600"
              title="Remove note"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {responding && canManage && (
        <div className="mt-2 space-y-2">
          <Field label="Response">
            <Textarea
              rows={2}
              value={response}
              placeholder="Preparer's response to the note…"
              onChange={(e) => setResponse(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              className="h-8"
              disabled={respond.isPending || response.trim().length === 0}
              onClick={() => respond.mutate()}
            >
              Submit response
            </Button>
            <Button variant="secondary" className="h-8" onClick={() => setResponding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
