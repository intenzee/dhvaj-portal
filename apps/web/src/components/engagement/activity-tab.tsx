'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_KIND,
  COMPLIANCE_EVENT_TYPE_LABEL,
  STREAMS,
  STREAM_LABEL,
  type ActivityItem,
  type ActivityKind,
  type ActivityPage,
  type Stream,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from '@/components/ui';
import { Select, Textarea } from '@/components/form';

const KIND_LABEL: Record<ActivityKind, string> = {
  status_change: 'Status',
  task_event: 'Task',
  filing_lodged: 'Filed',
  filing_undone: 'Filing undone',
  filing_correction: 'Correction',
  filing_waived: 'Not applicable',
  document_uploaded: 'Document',
  dependency_raised: 'Client request',
  dependency_closed: 'Client request closed',
  review_point: 'Review point',
  comment: 'Comment',
  time_day: 'Time',
  independence_ack: 'Independence',
  event_recorded: 'Event',
  event_corrected: 'Event corrected',
  event_voided: 'Event voided',
};

const EVENT_KINDS: readonly ActivityKind[] = [
  ACTIVITY_KIND.eventRecorded,
  ACTIVITY_KIND.eventCorrected,
  ACTIVITY_KIND.eventVoided,
];

/** A timeline line's text: an event shows its name (AGM held …), not its code. */
export function activityTitle(a: Pick<ActivityItem, 'kind' | 'title' | 'meta'>): string {
  if (!EVENT_KINDS.includes(a.kind)) return a.title;
  const label =
    (COMPLIANCE_EVENT_TYPE_LABEL as Record<string, string>)[a.title] ?? humanize(a.title);
  const on = typeof a.meta?.eventDate === 'string' ? ` on ${formatDate(a.meta.eventDate)}` : '';
  return `${label}${on}`;
}

/** Filter chips: a few kinds grouped the way people ask ("show me filings"). */
export const ACTIVITY_FILTERS: { key: string; label: string; kinds: ActivityKind[] }[] = [
  { key: 'all', label: 'Everything', kinds: [] },
  { key: 'comments', label: 'Comments', kinds: [ACTIVITY_KIND.comment] },
  {
    key: 'filings',
    label: 'Filings',
    kinds: [
      ACTIVITY_KIND.filingLodged,
      ACTIVITY_KIND.filingUndone,
      ACTIVITY_KIND.filingCorrection,
      ACTIVITY_KIND.filingWaived,
    ],
  },
  { key: 'events', label: 'Events', kinds: [...EVENT_KINDS] },
  { key: 'tasks', label: 'Tasks', kinds: [ACTIVITY_KIND.taskEvent, ACTIVITY_KIND.reviewPoint] },
  {
    key: 'client',
    label: 'Client',
    kinds: [ACTIVITY_KIND.dependencyRaised, ACTIVITY_KIND.dependencyClosed, ACTIVITY_KIND.documentUploaded],
  },
];

/** The activity list query string. Pure — tested. */
export function activityQuery(f: {
  filter: string;
  stream?: string;
  person?: string;
  cursor?: string | null;
}): string {
  const p = new URLSearchParams({ limit: '50' });
  const kinds = ACTIVITY_FILTERS.find((x) => x.key === f.filter)?.kinds ?? [];
  if (kinds.length) p.set('kind', kinds.join(','));
  if (f.stream) p.set('stream', f.stream);
  if (f.person) p.set('person', f.person);
  if (f.cursor) p.set('cursor', f.cursor);
  return p.toString();
}

/**
 * Change 3 — Activity: one timeline (status, tasks, filings, documents, client
 * requests, comments, a line per person-day of time) with filters and paging,
 * comments that can be pinned to the Overview.
 */
export function ActivityTab({
  engagementId,
  team,
  isLead,
}: {
  engagementId: string;
  team: TeamMember[];
  isLead: boolean;
}): JSX.Element {
  const [view, setView] = useState<'timeline' | 'notes'>('timeline');
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Activity view" className="inline-flex rounded-lg border border-line p-0.5">
        {(['timeline', 'notes'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 text-sm ${view === v ? 'bg-primary-600 text-white' : 'text-ink-muted hover:text-ink'}`}
          >
            {v === 'timeline' ? 'Timeline' : 'Notes'}
          </button>
        ))}
      </div>
      {view === 'timeline' && <Timeline engagementId={engagementId} team={team} isLead={isLead} />}
      {view === 'notes' && (
        <Timeline key="notes" engagementId={engagementId} team={team} isLead={isLead} notesOnly />
      )}
    </div>
  );
}

function Timeline({
  engagementId,
  team,
  isLead,
  notesOnly = false,
}: {
  engagementId: string;
  team: TeamMember[];
  isLead: boolean;
  /** The Notes view: comments only, pinned first. */
  notesOnly?: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState(notesOnly ? 'comments' : 'all');
  const [stream, setStream] = useState('');
  const [person, setPerson] = useState('');
  const [comment, setComment] = useState('');
  const [pin, setPin] = useState(false);

  const q = useInfiniteQuery({
    queryKey: ['engagement', engagementId, 'activity', filter, stream, person],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiFetch<ActivityPage>(
        `/engagements/${engagementId}/activity?${activityQuery({ filter, stream, person, cursor: pageParam })}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  const all = q.data?.pages.flatMap((p) => p.items) ?? [];
  const items = notesOnly ? [...all.filter((a) => a.isPinned), ...all.filter((a) => !a.isPinned)] : all;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'activity'] });
  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/notes`, {
        method: 'POST',
        body: { body: comment.trim(), ...(pin ? { isPinned: true } : {}) },
      }),
    onSuccess: () => {
      setComment('');
      setPin(false);
      toast('Comment added.');
      refresh();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add the comment.', 'error'),
  });
  const togglePin = useMutation({
    mutationFn: (c: ActivityItem) =>
      apiFetch(`/engagements/${engagementId}/notes/${String(c.meta.noteId)}`, {
        method: 'PATCH',
        body: { isPinned: !c.isPinned, version: Number(c.meta.version) },
      }),
    onSuccess: refresh,
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not change the pin.', 'error'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2">
        <CardTitle className="mr-auto">{notesOnly ? 'Notes' : 'Timeline'}</CardTitle>
        <div className={notesOnly ? 'hidden' : 'flex flex-wrap gap-1'} role="group" aria-label="Show">
          {ACTIVITY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                filter === f.key ? 'border-primary-600 bg-primary-600 text-white' : 'border-line text-ink-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Select className="w-auto" aria-label="Stream" value={stream} onChange={(e) => setStream(e.target.value)}>
          <option value="">All streams</option>
          {STREAMS.map((s) => (
            <option key={s} value={s}>
              {STREAM_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select className="w-auto" aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Everyone</option>
          {team.map((m) => (
            <option key={m.employeeId} value={m.employeeId}>
              {m.employeeName}
            </option>
          ))}
        </Select>
      </CardHeader>
      <CardBody className="space-y-3">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) add.mutate();
          }}
        >
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment for the team…"
            aria-label="Comment"
          />
          <div className="flex items-center gap-3">
            <Button size="sm" type="submit" disabled={!comment.trim() || add.isPending}>
              Comment
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin to Overview
            </label>
          </div>
        </form>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <EmptyState>{q.error instanceof ApiError ? q.error.message : 'Could not load activity.'}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>Nothing here yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((a) => (
              <li key={a.id} className="flex items-start gap-3 py-2 text-sm">
                <Badge tone={a.kind === 'comment' ? 'info' : a.kind.startsWith('filing') ? 'success' : 'neutral'}>
                  {KIND_LABEL[a.kind] ?? humanize(a.kind)}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className={a.kind === 'comment' ? 'whitespace-pre-wrap text-ink' : 'text-ink'}>{activityTitle(a)}</p>
                  {a.detail && <p className="text-xs text-ink-muted">{a.detail}</p>}
                  <p className="text-xs text-ink-faint">
                    {a.actorName ?? 'System'} · {formatDate(a.occurredAt)}{' '}
                    {new Date(a.occurredAt).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })}
                    {a.stream && ` · ${STREAM_LABEL[a.stream as Stream] ?? a.stream}`}
                  </p>
                </div>
                {a.kind === 'comment' && (isLead || a.isPinned) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={togglePin.isPending || !isLead}
                    aria-pressed={a.isPinned}
                    onClick={() => togglePin.mutate(a)}
                    title={a.isPinned ? 'Unpin from Overview' : 'Pin to Overview'}
                  >
                    {a.isPinned ? '📌 Pinned' : 'Pin'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {q.hasNextPage && (
          <Button variant="secondary" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
