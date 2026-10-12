'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIVITY_KIND,
  NON_BILLABLE_TIME_CATEGORIES,
  OTHER_TIME_CATEGORIES,
  STREAMS,
  STREAM_LABEL,
  type ActivityItem,
  type ActivityKind,
  type ActivityPage,
  type EngagementTimeReport,
  type OtherTimeCategory,
  type Stream,
  type TimeAdjustmentRecord,
  type TimeEntryRecord,
  type TimeSummary,
  type TimeSummaryBy,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatDuration, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { TeamMember } from '@/lib/types';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';

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
};

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
  { key: 'tasks', label: 'Tasks', kinds: [ACTIVITY_KIND.taskEvent, ACTIVITY_KIND.reviewPoint] },
  {
    key: 'client',
    label: 'Client',
    kinds: [ACTIVITY_KIND.dependencyRaised, ACTIVITY_KIND.dependencyClosed, ACTIVITY_KIND.documentUploaded],
  },
  { key: 'time', label: 'Time', kinds: [ACTIVITY_KIND.timeDay] },
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
 * comments that can be pinned to the Overview; and the Time view.
 */
export function ActivityTab({
  engagementId,
  team,
  isLead,
  timeView,
}: {
  engagementId: string;
  team: TeamMember[];
  isLead: boolean;
  /** The Time view to show beside the timeline (auto-time summary or the legacy timer). */
  timeView: JSX.Element;
}): JSX.Element {
  const [view, setView] = useState<'timeline' | 'time' | 'notes'>('timeline');
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Activity view" className="inline-flex rounded-lg border border-line p-0.5">
        {(['timeline', 'time', 'notes'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1 text-sm ${view === v ? 'bg-primary-600 text-white' : 'text-ink-muted hover:text-ink'}`}
          >
            {v === 'timeline' ? 'Timeline' : v === 'time' ? 'Time' : 'Notes'}
          </button>
        ))}
      </div>
      {view === 'timeline' && <Timeline engagementId={engagementId} team={team} isLead={isLead} />}
      {view === 'time' && timeView}
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
                  <p className={a.kind === 'comment' ? 'whitespace-pre-wrap text-ink' : 'text-ink'}>{a.title}</p>
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

/** Seconds → decimal hours for CSV. */
function hrs(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

/**
 * Change 3 — Activity → Time: recorded time by person / stream / month / task
 * for a date range, budget vs actual per stream, CSV export, "Add other time"
 * (calls, travel, meetings) and, for leads, the corrections awaiting approval.
 */
export function TimePanel({
  engagementId,
  isLead,
  me = null,
  streams,
}: {
  engagementId: string;
  isLead: boolean;
  /** The caller's employee id (their own recent entries can be corrected). */
  me?: string | null;
  /** Streams offered when adding other time (service line ids, when known). */
  streams: { stream: string; engagementServiceId: string | null }[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [by, setBy] = useState<TimeSummaryBy>('person');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [stream, setStream] = useState('');
  const qs = new URLSearchParams({ by });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (stream) qs.set('stream', stream);
  const summary = useQuery({
    queryKey: ['time', 'summary', engagementId, qs.toString()],
    queryFn: () => apiFetch<TimeSummary>(`/engagements/${engagementId}/time/summary?${qs.toString()}`),
  });
  const adjustments = useQuery({
    queryKey: ['time', 'adjustments', engagementId],
    queryFn: () => apiFetch<TimeAdjustmentRecord[]>(`/engagements/${engagementId}/time/adjustments`),
    enabled: isLead,
  });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      apiFetch(`/time/adjustments/${id}/approve`, { method: 'POST', body: { approve } }),
    onSuccess: (_d, v) => {
      toast(v.approve ? 'Correction approved.' : 'Correction rejected.');
      void qc.invalidateQueries({ queryKey: ['time'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not decide.', 'error'),
  });

  const s = summary.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">Recorded time</CardTitle>
          <Select className="w-auto" aria-label="Group by" value={by} onChange={(e) => setBy(e.target.value as TimeSummaryBy)}>
            <option value="person">By person</option>
            <option value="stream">By stream</option>
            <option value="month">By month</option>
            <option value="task">By task</option>
          </Select>
          <Select className="w-auto" aria-label="Stream" value={stream} onChange={(e) => setStream(e.target.value)}>
            <option value="">All streams</option>
            {STREAMS.map((x) => (
              <option key={x} value={x}>
                {STREAM_LABEL[x]}
              </option>
            ))}
          </Select>
          <Input className="w-auto" type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input className="w-auto" type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button
            size="sm"
            variant="secondary"
            disabled={!s || s.rows.length === 0}
            onClick={() =>
              s &&
              downloadCsv(
                `time-by-${by}`,
                [humanize(by), 'Total hours', 'Billable hours', 'Non-billable hours', 'Entries'],
                s.rows.map((r) => [r.label, hrs(r.totalSeconds), hrs(r.billableSeconds), hrs(r.nonBillableSeconds), r.entryCount]),
              )
            }
          >
            Export CSV
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {summary.isLoading ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : !s || s.rows.length === 0 ? (
            <div className="p-4">
              <EmptyState>No time recorded for this selection.</EmptyState>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2 font-semibold">{humanize(by)}</th>
                  <th className="px-4 py-2 text-right font-semibold">Total</th>
                  <th className="px-4 py-2 text-right font-semibold">Billable</th>
                  <th className="px-4 py-2 text-right font-semibold">Non-billable</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{r.label}</td>
                    <td className="px-4 py-2 text-right">{formatDuration(r.totalSeconds)}</td>
                    <td className="px-4 py-2 text-right">{formatDuration(r.billableSeconds)}</td>
                    <td className="px-4 py-2 text-right text-ink-muted">{formatDuration(r.nonBillableSeconds)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-sunken/50 font-medium">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{formatDuration(s.totals.totalSeconds)}</td>
                  <td className="px-4 py-2 text-right">{formatDuration(s.totals.billableSeconds)}</td>
                  <td className="px-4 py-2 text-right">{formatDuration(s.totals.nonBillableSeconds)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {s && s.budget.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Budget vs actual</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {s.budget.map((b) => {
                const pct = b.budgetHours ? Math.min(100, (b.actualHours / b.budgetHours) * 100) : 0;
                const over = !!b.budgetHours && b.actualHours > b.budgetHours;
                return (
                  <li key={`${b.financialYear}-${b.stream}`}>
                    <div className="flex justify-between text-xs">
                      <span>
                        FY {b.financialYear} · {STREAM_LABEL[b.stream as Stream] ?? b.stream}
                      </span>
                      <span className={over ? 'font-semibold text-danger-700' : 'text-ink-muted'}>
                        {Math.round(b.actualHours * 10) / 10}h
                        {b.budgetHours != null ? ` of ${b.budgetHours}h` : ' · no budget'}
                      </span>
                    </div>
                    {b.budgetHours != null && (
                      <div className="mt-1 h-1.5 rounded bg-surface-sunken" aria-hidden>
                        <div
                          className={`h-1.5 rounded ${over ? 'bg-danger-500' : 'bg-primary-600'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      <OtherTimeForm engagementId={engagementId} streams={streams} />

      {me && <MyEntries engagementId={engagementId} me={me} />}

      {isLead && (
        <Card>
          <CardHeader>
            <CardTitle>Corrections awaiting approval ({adjustments.data?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardBody>
            {(adjustments.data ?? []).length === 0 ? (
              <EmptyState>No corrections waiting.</EmptyState>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {adjustments.data!.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p>
                        <strong>{a.employeeName}</strong>: {formatDuration(a.originalSeconds)} →{' '}
                        {formatDuration(a.durationSeconds)} on {formatDate(a.startedAt)}
                      </p>
                      <p className="text-xs text-ink-muted">{a.reason}</p>
                    </div>
                    <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: true })}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: a.id, approve: false })}
                    >
                      Reject
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function OtherTimeForm({
  engagementId,
  streams,
}: {
  engagementId: string;
  streams: { stream: string; engagementServiceId: string | null }[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<OtherTimeCategory>('client_call');
  const [minutes, setMinutes] = useState('30');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const [serviceId, setServiceId] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/time/other`, {
        method: 'POST',
        body: {
          category,
          minutes: Number(minutes),
          date,
          isBillable: billable,
          ...(serviceId ? { engagementServiceId: serviceId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast('Time added.');
      setOpen(false);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['time'] });
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add the time.', 'error'),
  });
  const withService = streams.filter((s) => s.engagementServiceId);
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Other time</CardTitle>
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '−' : '+'} Add other time
        </Button>
      </CardHeader>
      {open && (
        <CardBody>
          <form
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label="What">
              <Select
                value={category}
                onChange={(e) => {
                  const c = e.target.value as OtherTimeCategory;
                  setCategory(c);
                  setBillable(!NON_BILLABLE_TIME_CATEGORIES.includes(c));
                }}
              >
                {OTHER_TIME_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Minutes" required>
              <Input type="number" min={1} max={720} value={minutes} onChange={(e) => setMinutes(e.target.value)} required />
            </Field>
            <Field label="Date" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            {withService.length > 0 && (
              <Field label="Stream">
                <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  <option value="">Engagement (no stream)</option>
                  {withService.map((s) => (
                    <option key={s.engagementServiceId!} value={s.engagementServiceId!}>
                      {STREAM_LABEL[s.stream as Stream] ?? s.stream}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Note" className="sm:col-span-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable
            </label>
            <div className="self-end">
              <Button size="sm" type="submit" disabled={add.isPending || !(Number(minutes) > 0)}>
                Add
              </Button>
            </div>
          </form>
        </CardBody>
      )}
    </Card>
  );
}

/** Entries the caller may still correct: theirs, finished, original, within the window. Pure — tested. */
export function adjustableEntries(entries: TimeEntryRecord[], me: string, now: number): TimeEntryRecord[] {
  const cutoff = now - ADJUST_WINDOW_DAYS * 24 * 3600 * 1000;
  return entries.filter(
    (e) =>
      e.employeeId === me && !e.isRunning && !!e.endedAt && !e.adjustsEntryId && Date.parse(e.startedAt) >= cutoff,
  );
}

const ADJUST_WINDOW_DAYS = 3;

/** ISO → the value of an <input type="datetime-local"> in IST. */
function localValue(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 16);
}

/** <input type="datetime-local"> in IST → ISO. */
function fromLocal(v: string): string {
  return new Date(`${v}:00+05:30`).toISOString();
}

/**
 * Change 3 — "a person may adjust their own entries for 3 days with a reason".
 * The adjustment is a new row pointing at the original; over 30 minutes of
 * change it waits for the manager.
 */
function MyEntries({ engagementId, me }: { engagementId: string; me: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const report = useQuery({
    queryKey: ['time', 'report', engagementId],
    queryFn: () => apiFetch<EngagementTimeReport>(`/engagements/${engagementId}/time`),
  });
  const adjust = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/time/${id}/adjust`, {
        method: 'POST',
        body: { startedAt: fromLocal(start), endedAt: fromLocal(end), reason: reason.trim() },
      }),
    onSuccess: () => {
      toast('Correction recorded.');
      setEditing(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['time'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not record the correction.', 'error'),
  });
  const mine = adjustableEntries(report.data?.entries ?? [], me, Date.now());
  if (mine.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>My recent entries</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-2 text-xs text-ink-muted">
          You can correct your own time for {ADJUST_WINDOW_DAYS} days. Changes over 30 minutes go to the manager.
        </p>
        <ul className="divide-y divide-line text-sm">
          {mine.map((e) => (
            <li key={e.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {e.taskTitle ?? (e.category ? humanize(e.category) : 'Time')} · {formatDate(e.startedAt)} ·{' '}
                  {formatDuration(e.durationSeconds)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={editing === e.id}
                  onClick={() => {
                    if (editing === e.id) return setEditing(null);
                    setEditing(e.id);
                    setStart(localValue(e.startedAt));
                    setEnd(localValue(e.endedAt!));
                    setReason('');
                  }}
                >
                  {editing === e.id ? '−' : '+'} Adjust
                </Button>
              </div>
              {editing === e.id && (
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-[auto_auto_1fr_auto]"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (reason.trim() && start && end) adjust.mutate(e.id);
                  }}
                >
                  <Input type="datetime-local" aria-label="Start" value={start} onChange={(ev) => setStart(ev.target.value)} />
                  <Input type="datetime-local" aria-label="End" value={end} onChange={(ev) => setEnd(ev.target.value)} />
                  <Input
                    aria-label="Reason"
                    placeholder="Why (e.g. forgot to pause over lunch)"
                    value={reason}
                    onChange={(ev) => setReason(ev.target.value)}
                  />
                  <Button size="sm" type="submit" disabled={adjust.isPending || !reason.trim()}>
                    Save
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
