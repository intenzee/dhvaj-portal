'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CornerUpLeft,
  MessageSquarePlus,
  Reply,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
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
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';

/**
 * Review — first-class review control (Audit Spec §25, §344). The pending-review
 * queue and the four headline counts are derived from procedure/area state; a
 * review note is anchored to a professional object and moves open → responded →
 * cleared. A blocking open note is the completion gate (§29).
 *
 * Notes are a compact list; a note's detail and its respond / clear / remove
 * actions open in a pop-up, as does recording a note against a queue item.
 *
 * Review reads the file: each queued item shows its pre-review checks and the
 * notes those checks suggest (raised in one click, or dismissed for good);
 * Approve / Return are one step; a note raised from a suggestion says when the
 * issue has been fixed in the file; "Waiting on you" shows the viewer's share.
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
  const [mine, setMine] = useState(false);

  const query = useQuery({
    queryKey: REVIEW_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditReview[]>(`/engagements/${engagementId}/statutory-audit/review`),
  });

  if (query.isLoading) return <Spinner label="Loading review…" />;
  const review = query.data?.[0];
  if (!review) return null;

  const s = review.summary;
  // Older API builds send no "for me" counts.
  const forMe = review.forMe ?? { toReview: 0, toAnswer: 0, toClear: 0 };
  const forMeTotal = forMe.toReview + forMe.toAnswer + forMe.toClear;
  const queue = mine ? review.queue.filter((q) => q.isMine) : review.queue;
  const notes = mine
    ? review.notes.filter((n) => n.forMeToAnswer || n.forMeToClear)
    : review.notes;

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
        {forMeTotal > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-ink">Waiting on you:</span>
            {forMe.toReview > 0 && <Badge tone="info">{forMe.toReview} to review</Badge>}
            {forMe.toAnswer > 0 && <Badge tone="warn">{forMe.toAnswer} to answer</Badge>}
            {forMe.toClear > 0 && <Badge tone="success">{forMe.toClear} to clear</Badge>}
            <label className="ml-auto inline-flex items-center gap-1.5 text-ink-muted">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
              Only mine
            </label>
          </div>
        )}
      </Card>

      {/* Pending-review queue (§25) */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-ink">Review queue</h3>
        {queue.length === 0 ? (
          <EmptyState>
            {mine
              ? 'Nothing is waiting for your review.'
              : 'Nothing is awaiting review. Submit a procedure or area conclusion.'}
          </EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {queue.map((q) => (
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
        {notes.length === 0 ? (
          <EmptyState>{mine ? 'No review notes waiting on you.' : 'No review notes raised.'}</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {notes.map((n) => (
              <NoteRow key={n.id} engagementId={engagementId} note={n} canManage={canManage} />
            ))}
          </ul>
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

  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/review`;
  const done = (msg: string) => () => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: REVIEW_QK(engagementId) });
    // Approve / return change the procedure or area itself.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };
  const failed = (fallback: string) => (e: unknown) =>
    toast(e instanceof ApiError ? e.message : fallback);
  const suggested = item.suggestedNotes ?? [];
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [withSuggested, setWithSuggested] = useState(true);

  const raiseSuggested = useMutation({
    mutationFn: (sourceKeys?: string[]) =>
      apiFetch(`${base}/suggestions/raise`, {
        method: 'POST',
        body: { targetId: item.targetId, ...(sourceKeys ? { sourceKeys } : {}) },
      }),
    onSuccess: done('Review note(s) raised.'),
    onError: failed('Could not raise the notes.'),
  });
  const dismiss = useMutation({
    mutationFn: (sourceKey: string) =>
      apiFetch(`${base}/suggestions/dismiss`, { method: 'POST', body: { sourceKey } }),
    onSuccess: done('Suggestion dismissed — it will not be offered again.'),
    onError: failed('Could not dismiss.'),
  });
  const decide = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`${base}/decide`, {
        method: 'POST',
        body: { targetType: item.targetType, targetId: item.targetId, ...body },
      }),
    onSuccess: (_d, body) => {
      setReturning(false);
      setReturnNote('');
      done(body.decision === 'approve' ? 'Approved.' : 'Returned to the preparer.')();
    },
    onError: failed('Could not record the decision.'),
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
          {(item.checks ?? []).length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {item.checks.map((c) => (
                <li
                  key={c.key}
                  className={`inline-flex items-center gap-1 ${c.ok ? 'text-ink-muted' : 'text-danger-600'}`}
                >
                  {c.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {c.label}
                </li>
              ))}
            </ul>
          )}
          {(item.context ?? []).map((c) => (
            <p key={c} className="mt-0.5 text-[11px] text-ink-faint">
              {c}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {item.ready && <Badge tone="success">Ready to approve</Badge>}
          {(item.openNotes ?? 0) > 0 && <Badge tone="warn">{item.openNotes} open note(s)</Badge>}
          {canManage && (
            <>
              <Button
                className="h-8"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ decision: 'approve' })}
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
              <Button variant="secondary" className="h-8" onClick={() => setReturning(true)}>
                <CornerUpLeft className="mr-1 h-4 w-4" />
                Return
              </Button>
              <Button
                variant="secondary"
                className="h-8"
                onClick={() => setNoting(true)}
                title="Record note"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
      {suggested.length > 0 && (
        <div className="mt-2 rounded-lg border border-line bg-surface-sunken/40 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1 text-xs font-medium text-ink">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Suggested review notes
            </p>
            {canManage && suggested.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={raiseSuggested.isPending}
                onClick={() => raiseSuggested.mutate(undefined)}
              >
                Raise all
              </Button>
            )}
          </div>
          <ul className="mt-1 space-y-1">
            {suggested.map((n) => (
              <li key={n.sourceKey} className="flex items-start gap-2 text-xs">
                <span className="min-w-0 flex-1 text-ink-muted">
                  {n.isBlocking && <Badge tone="danger">Blocking</Badge>} {n.body}
                </span>
                {canManage && (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={raiseSuggested.isPending}
                      onClick={() => raiseSuggested.mutate([n.sourceKey])}
                    >
                      Raise
                    </Button>
                    <button
                      type="button"
                      title="Dismiss — never suggest again"
                      aria-label={`Dismiss: ${n.body}`}
                      className="text-ink-faint hover:text-ink"
                      onClick={() => dismiss.mutate(n.sourceKey)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <InlinePanel
        open={returning && canManage}
        onClose={() => setReturning(false)}
        title="Return to the preparer"
        description={item.label}
      >
        <div className="space-y-3">
          <Field label="What needs doing">
            <Textarea
              rows={3}
              value={returnNote}
              placeholder="Optional when the suggested notes say it…"
              onChange={(e) => setReturnNote(e.target.value)}
            />
          </Field>
          {suggested.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={withSuggested}
                onChange={(e) => setWithSuggested(e.target.checked)}
              />
              Also raise the {suggested.length} suggested note(s)
            </label>
          )}
          <div className="flex gap-2">
            <Button
              className="h-8"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate({
                  decision: 'return',
                  ...(returnNote.trim() ? { note: returnNote } : {}),
                  raiseSuggested: withSuggested && suggested.length > 0,
                })
              }
            >
              Return
            </Button>
            <Button variant="secondary" className="h-8" onClick={() => setReturning(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </InlinePanel>
      <InlinePanel
        open={noting && canManage}
        onClose={() => setNoting(false)}
        title="Record review note"
        description={item.label}
      >
        <div className="space-y-3">
          <Field label="Review note">
            <Textarea
              rows={3}
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
      </InlinePanel>
    </li>
  );
}

function NoteRow({
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
  const [open, setOpen] = useState(false);
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState('');
  const close = () => {
    setOpen(false);
    setResponding(false);
  };
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
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove note.'),
  });

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="group flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-surface-sunken"
      >
        <ExpandToggle open={open} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{note.body}</span>
          <span className="block truncate text-[11px] text-ink-muted">
            {note.targetLabel ? `on ${note.targetLabel} · ` : ''}
            {note.raisedByName ?? 'reviewer'} · {formatDate(note.createdAt)}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {note.resolvedInFile && <Badge tone="success">Fixed in the file</Badge>}
          {note.forMeToAnswer && <Badge tone="warn">Yours to answer</Badge>}
          {note.forMeToClear && <Badge tone="info">Yours to clear</Badge>}
          {note.isBlocking && note.status !== 'cleared' && <Badge tone="danger">Blocking</Badge>}
          <Badge tone={note.reviewLevel === 'partner' ? 'info' : 'neutral'}>
            {note.reviewLevel === 'partner' ? 'Partner' : 'Manager'}
          </Badge>
          <Badge tone={NOTE_TONE[note.status]}>{note.status}</Badge>
        </span>
      </button>

      <InlinePanel
        className="mb-3"
        open={open}
        onClose={close}
        title="Review note"
        description={note.targetLabel ? `on ${note.targetLabel}` : undefined}
        size="lg"
      >
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
            {note.resolvedInFile && (
              <p className="mt-1 text-xs text-success-700">
                The issue this note raised is fixed in the file — ready to clear.
              </p>
            )}
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
      </InlinePanel>
    </li>
  );
}
