'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Minus, Plus } from 'lucide-react';
import {
  PERMISSION,
  PROGRESS_GROUP,
  PROGRESS_GROUPS,
  PROGRESS_STATUS_LABEL,
  ROLE,
  TIMELINE_EVENT_LABEL,
  WORK_SECTIONS,
  WORK_SECTION_LABEL,
  workItemHref,
  type Paginated,
  type ProgressFilters,
  type ProgressGroup,
  type ProgressItem,
  type ProgressRow,
  type ProgressScope,
  type ProgressView,
  type TaskTimeline,
  type TeamSummary,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can, hasRole, type Principal } from '@/lib/principal';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { istTime, istToday } from '@/lib/people';
import { cn } from '@/lib/cn';
import type { OfficeRow } from '@/lib/types';
import {
  PERIOD_PRESET,
  PERIOD_PRESET_LABEL,
  PROGRESS_GROUP_LABEL,
  holdersLine,
  periodRange,
  progressCsv,
  progressQuery,
  type PeriodPreset,
} from '@/lib/progress';
import { Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { CompletionBar } from '@/components/completion';

/** Seniors and above open the tracker; an Article has My Work. */
export const PROGRESS_ROLES = [
  ROLE.managingPartner,
  ROLE.admin,
  ROLE.partner,
  ROLE.manager,
  ROLE.senior,
] as const;

export function canSeeProgress(principal: Principal | null): boolean {
  return can(principal, PERMISSION.engagementRead) && hasRole(principal, ...PROGRESS_ROLES);
}

const SCOPE_LINE: Record<ProgressScope, string> = {
  firm: 'The whole firm.',
  tree: 'You and the people who report to you.',
  own: 'Your own work.',
};

const ITEMS_PAGE = 50;

/** D-2 — who has done what, for a period: by person, by client or by filing. */
export function ProgressScreen(): JSX.Element {
  const { principal } = useAuth();
  const allowed = canSeeProgress(principal);
  const today = istToday();
  const [groupBy, setGroupBy] = useState<ProgressGroup>(PROGRESS_GROUP.person);
  const [preset, setPreset] = useState<PeriodPreset>(PERIOD_PRESET.thisMonth);
  const [custom, setCustom] = useState({ from: today, to: today });
  const [officeId, setOfficeId] = useState('');
  const [stream, setStream] = useState('');
  const [teamId, setTeamId] = useState('');
  const range = periodRange(preset, today, custom);
  const filters: ProgressFilters = { ...range, officeId, stream, teamId };

  const showOffices = allowed && can(principal, PERMISSION.officeRead);
  const showTeams = allowed && can(principal, PERMISSION.teamRead);
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
    enabled: showOffices,
  });
  const teams = useQuery({
    queryKey: ['teams', 'list', '', false],
    queryFn: () => apiFetch<TeamSummary[]>('/teams?q='),
    enabled: showTeams,
  });
  const view = useQuery({
    queryKey: ['work', 'progress', groupBy, filters],
    queryFn: () =>
      apiFetch<ProgressView>(`/work/progress?${progressQuery({ groupBy, ...filters })}`),
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Progress" />
        <EmptyState>
          Progress is for Seniors and above. Your own work is on{' '}
          <Link href="/my-work" className="text-primary-600 hover:underline">
            My Work
          </Link>
          ; ask your Senior or Manager for the team&apos;s progress.
        </EmptyState>
      </div>
    );
  }

  const v = view.data;
  const exportCsv = (data: ProgressView): void => {
    const csv = progressCsv(data.groupBy, data.rows);
    downloadCsv(
      `progress-${data.groupBy}-${range.from || 'all'}-to-${range.to || 'all'}`,
      csv.headers,
      csv.rows,
    );
  };

  return (
    <div>
      <PageHeader
        title="Progress"
        subtitle={`Not started, in progress and completed work by internal due date. ${
          v ? SCOPE_LINE[v.scope] : ''
        }`}
        actions={
          v && v.rows.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => exportCsv(v)}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Period">
          <Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)}>
            {Object.values(PERIOD_PRESET).map((p) => (
              <option key={p} value={p}>
                {PERIOD_PRESET_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        {preset === PERIOD_PRESET.custom && (
          <>
            <Field label="From">
              <Input
                type="date"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </Field>
          </>
        )}
        {showOffices && (offices.data?.length ?? 0) > 1 && (
          <Field label="Office">
            <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
              <option value="">Every office</option>
              {offices.data!.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Stream">
          <Select value={stream} onChange={(e) => setStream(e.target.value)}>
            <option value="">Every stream</option>
            {WORK_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {WORK_SECTION_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        {showTeams && (teams.data?.length ?? 0) > 0 && (
          <Field label="Client team">
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Every team</option>
              {teams.data!.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {view.isLoading && <Spinner label="Loading progress…" />}
      {view.isError && <EmptyState>Could not load progress. Try again in a moment.</EmptyState>}
      {v && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Count label="Overdue" value={v.totals.overdue} tone="danger" />
            <Count label="Not started" value={v.totals.notStarted} tone="neutral" />
            <Count
              label="In progress"
              value={v.totals.inProgress}
              tone="info"
              note={inProgressNote(v.totals)}
            />
            <Count label="Completed" value={v.totals.completed} tone="success" />
          </div>

          <div role="tablist" aria-label="Group by" className="flex flex-wrap gap-2">
            {PROGRESS_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={groupBy === g}
                onClick={() => setGroupBy(g)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium',
                  groupBy === g
                    ? 'bg-primary-600 text-white'
                    : 'border border-line-strong bg-surface text-ink hover:bg-surface-raised',
                )}
              >
                {PROGRESS_GROUP_LABEL[g]}
              </button>
            ))}
          </div>

          {v.groupBy === groupBy && v.rows.length === 0 ? (
            <EmptyState>
              {groupBy === PROGRESS_GROUP.filing
                ? 'No filing work due in this period.'
                : 'No work due in this period.'}
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {v.rows.map((row) => (
                <ProgressRowCard key={row.key} row={row} groupBy={v.groupBy} filters={filters} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function inProgressNote(c: { waitingOnClient: number; inReview: number }): string | undefined {
  const parts = [
    c.waitingOnClient ? `${c.waitingOnClient} waiting on client` : '',
    c.inReview ? `${c.inReview} in review` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

const COUNT_TONE = {
  danger: 'text-danger-600',
  neutral: 'text-ink-muted',
  info: 'text-primary-700',
  success: 'text-success-700',
};

function Count({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: number;
  tone: keyof typeof COUNT_TONE;
  note?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div
        className={cn(
          'mt-1 text-3xl font-bold tabular-nums',
          tone === 'danger' && value === 0 ? 'text-ink' : COUNT_TONE[tone],
        )}
      >
        {value}
      </div>
      {note && <div className="mt-1 text-xs text-ink-faint">{note}</div>}
    </div>
  );
}

/** One row of a table: its counts, the done bar and one verb — show its tasks, under it. */
function ProgressRowCard({
  row,
  groupBy,
  filters,
}: {
  row: ProgressRow;
  groupBy: ProgressGroup;
  filters: ProgressFilters;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const sub =
    groupBy === PROGRESS_GROUP.client
      ? row.engagementLabel
      : groupBy === PROGRESS_GROUP.filing
        ? summaryLine(row)
        : undefined;
  return (
    <li className="rounded-xl border border-line-strong bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate font-medium text-ink">{row.label}</div>
          {sub && <div className="truncate text-xs text-ink-faint">{sub}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {row.overdue > 0 && <Badge tone="danger">{row.overdue} overdue</Badge>}
          <Badge tone="neutral">{row.notStarted} not started</Badge>
          <Badge tone="info">{row.inProgress} in progress</Badge>
          <Badge tone="success">{row.completed} completed</Badge>
        </div>
        <CompletionBar done={row.completed} total={row.total} label="completed" />
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          aria-label={`${open ? 'Hide' : 'Show'} tasks for ${row.label}`}
        >
          {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {open ? 'Hide tasks' : 'Show tasks'}
        </Button>
      </div>
      {open && (
        <div className="border-t border-line px-3 pb-3">
          <ProgressItems groupBy={groupBy} rowKey={row.key} filters={filters} />
        </div>
      )}
    </li>
  );
}

/** "14 of 16 completed, 2 with Kirandeep, 1 overdue". */
export function summaryLine(row: ProgressRow): string {
  const parts = [`${row.completed} of ${row.total} completed`];
  const holders = holdersLine(row);
  if (holders) parts.push(holders);
  if (row.overdue) parts.push(`${row.overdue} overdue`);
  return parts.join(', ');
}

function ProgressItems({
  groupBy,
  rowKey,
  filters,
}: {
  groupBy: ProgressGroup;
  rowKey: string;
  filters: ProgressFilters;
}): JSX.Element {
  const [limit, setLimit] = useState(ITEMS_PAGE);
  const items = useQuery({
    queryKey: ['work', 'progress', 'items', groupBy, rowKey, filters, limit],
    queryFn: () =>
      apiFetch<Paginated<ProgressItem>>(
        `/work/progress/items?${progressQuery({ groupBy, key: rowKey, ...filters, limit })}`,
      ),
  });
  if (items.isLoading) return <Spinner label="Loading tasks…" />;
  if (items.isError || !items.data) return <EmptyState>Could not load the tasks.</EmptyState>;
  const { items: list, total } = items.data;
  return (
    <div>
      <ul className="divide-y divide-line">
        {list.map((item) => (
          <ProgressItemRow key={item.taskId} item={item} groupBy={groupBy} />
        ))}
      </ul>
      {total > list.length && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => setLimit((l) => Math.min(l + ITEMS_PAGE, 100))}
          disabled={limit >= 100}
        >
          {limit >= 100
            ? `Showing ${list.length} of ${total}. Narrow the period to see the rest.`
            : `Show more (${total - list.length} left)`}
        </Button>
      )}
    </div>
  );
}

const STATUS_NOTE: Record<string, string> = {
  blocked: 'Waiting on client',
  in_review: 'In review',
  paused: 'Paused',
};

function ProgressItemRow({
  item,
  groupBy,
}: {
  item: ProgressItem;
  groupBy: ProgressGroup;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const tone =
    item.progress === 'completed'
      ? 'success'
      : item.progress === 'in_progress'
        ? 'info'
        : 'neutral';
  const meta = [
    groupBy !== PROGRESS_GROUP.client ? (item.clientName ?? item.entityName) : null,
    groupBy !== PROGRESS_GROUP.filing ? item.filingLabel : null,
    groupBy !== PROGRESS_GROUP.person ? (item.assigneeName ?? 'Not assigned') : null,
    item.dueDate ? `Due ${formatDate(item.dueDate)}` : 'No due date',
  ].filter(Boolean);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <Link href={workItemHref(item.link)} className="font-medium text-ink hover:underline">
            {item.title}
          </Link>
          <div className="text-xs text-ink-faint">{meta.join(' · ')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.isOverdue && <Badge tone="danger">Overdue</Badge>}
          <Badge tone={tone}>
            {PROGRESS_STATUS_LABEL[item.progress]}
            {item.progress === 'in_progress' && STATUS_NOTE[item.status]
              ? ` · ${STATUS_NOTE[item.status]}`
              : ''}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          aria-label={`${open ? 'Hide' : 'Show'} history of ${item.title}`}
        >
          {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          History
        </Button>
      </div>
      {open && <TimelineList taskId={item.taskId} />}
    </li>
  );
}

function TimelineList({ taskId }: { taskId: string }): JSX.Element {
  const t = useQuery({
    queryKey: ['work', 'progress', 'timeline', taskId],
    queryFn: () => apiFetch<TaskTimeline>(`/work/progress/tasks/${taskId}/timeline`),
  });
  if (t.isLoading) return <Spinner label="Loading history…" />;
  if (t.isError || !t.data) return <EmptyState>Could not load the history.</EmptyState>;
  return (
    <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs">
      {t.data.entries.map((e, i) => (
        <li key={`${e.event}-${e.at}-${i}`}>
          <span className="font-medium text-ink">{TIMELINE_EVENT_LABEL[e.event]}</span>
          {e.toName ? ` to ${e.toName}` : ''}
          {e.byName ? ` by ${e.byName}` : ''}
          <span className="text-ink-faint">
            {' '}
            · {formatDate(e.at)} {istTime(e.at)}
          </span>
          {e.note && <span className="block text-ink-muted">{e.note}</span>}
        </li>
      ))}
    </ol>
  );
}
