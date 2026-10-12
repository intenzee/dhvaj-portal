'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FEATURE_FLAG,
  STREAMS,
  STREAM_LABEL,
  TASK_STATUSES,
  type Paginated,
  type Stream,
  type TaskStatus,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { formatDate, humanize } from '@/lib/format';
import type { TeamMember } from '@/lib/types';
import type { TaskActionContext, WorkTask } from '@/lib/work-types';
import { Badge, EmptyState, Spinner } from '@/components/ui';
import { Select } from '@/components/form';
import { TaskActions } from './task-actions';
import { TaskStatusControl } from '@/components/actions/task-status-control';

/** The list query string for a WorkList filter. Pure — tested. */
export function workListQuery(f: {
  stream?: string | null;
  assignee?: string | null;
  status?: string | null;
  open?: boolean;
}): string {
  const p = new URLSearchParams({ limit: '100' });
  if (f.stream) p.set('stream', f.stream);
  if (f.assignee) p.set('assignedToEmployeeId', f.assignee);
  if (f.status) p.set('status', f.status);
  else if (f.open) p.set('open', 'true');
  return p.toString();
}

/**
 * Change 3 — the engagement's tasks with their next moves. Used as
 * Services → All work (with stream / assignee / status filters) and as each
 * stream tab's "Other work" (tasks not tied to a filing). With ff_auto_time
 * off it falls back to the plain status control.
 */
export function WorkList({
  engagementId,
  ctx,
  stream,
  team = [],
  showFilters = false,
  unlinkedOnly = false,
  emptyText = 'No tasks.',
}: {
  engagementId: string;
  ctx: TaskActionContext;
  /** Fix the list to one stream (stream tabs). */
  stream?: Stream;
  team?: TeamMember[];
  showFilters?: boolean;
  /** Only tasks that do not produce a filing (the "Other work" list). */
  unlinkedOnly?: boolean;
  emptyText?: string;
}): JSX.Element {
  const { isOn } = useFeatureFlags();
  const autoTime = isOn(FEATURE_FLAG.autoTime);
  const [fStream, setFStream] = useState<string>('');
  const [assignee, setAssignee] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const qs = workListQuery({ stream: stream ?? fStream, assignee, status, open: !status });
  const q = useQuery({
    queryKey: ['tasks', engagementId, qs],
    queryFn: () => apiFetch<Paginated<WorkTask>>(`/engagements/${engagementId}/tasks?${qs}`),
  });
  const rows = (q.data?.items ?? []).filter((t) => !unlinkedOnly || !t.complianceInstanceId);

  return (
    <div className="space-y-2">
      {showFilters && (
        <div className="flex flex-wrap gap-2">
          {!stream && (
            <Select
              className="w-auto"
              aria-label="Stream"
              value={fStream}
              onChange={(e) => setFStream(e.target.value)}
            >
              <option value="">All streams</option>
              {STREAMS.map((s) => (
                <option key={s} value={s}>
                  {STREAM_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
          <Select
            className="w-auto"
            aria-label="Assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Everyone</option>
            {team.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>
                {m.employeeName}
              </option>
            ))}
          </Select>
          <Select className="w-auto" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Open</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
      )}
      {q.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{t.title}</p>
                <p className="text-xs text-ink-muted">
                  {t.stream && `${STREAM_LABEL[t.stream as Stream] ?? t.stream} · `}
                  {t.assignedToName ?? 'Unassigned'}
                  {t.reviewerName && ` → ${t.reviewerName}`}
                  {t.dueDate && ` · due ${formatDate(t.dueDate)}`}
                </p>
              </div>
              <Badge tone={t.isOverdue ? 'danger' : t.status === 'done' ? 'success' : 'neutral'}>
                {humanize(t.status as TaskStatus)}
              </Badge>
              {autoTime ? (
                <TaskActions task={t} ctx={ctx} />
              ) : (
                <TaskStatusControl
                  task={{ ...t, engagementCode: t.engagementCode ?? '', entityName: t.entityName ?? '' }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
