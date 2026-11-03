'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ClipboardList, FolderOpen, Minus, Plus } from 'lucide-react';
import { TASK_STATUS, type TaskAction } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useFirmChecks } from '@/lib/firm-checks';
import type { MyTask } from '@/lib/types';
import type { WorkTask } from '@/lib/work-types';
import { Button, Card, EmptyState } from '@/components/ui';
import { Textarea } from '@/components/form';
import { StatusBadge } from '@/components/status-badge';
import { TaskActions } from '@/components/tasks/task-actions';
import { cn } from '@/lib/cn';

/** C-5 — My Work for Articles: open work by when it is due. */
export const MY_WORK_GROUPS = ['overdue', 'today', 'week', 'later'] as const;
export type MyWorkGroup = (typeof MY_WORK_GROUPS)[number];

export const MY_WORK_GROUP_LABEL: Record<MyWorkGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
};

/** One row's only move forward: Start, then (once started) Send for review. Pure. */
export function nextStepOf(status: MyTask['status']): TaskAction {
  return status === TASK_STATUS.inProgress ? 'send-for-review' : 'start';
}

const OPEN = (t: MyTask) => t.status !== TASK_STATUS.done && t.status !== TASK_STATUS.cancelled;

/** `iso` (YYYY-MM-DD) plus `days`. Pure. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Which group a task falls in, `today` being IST's date. No due date is Later. Pure. */
export function groupOf(t: Pick<MyTask, 'dueDate'>, today: string): MyWorkGroup {
  if (!t.dueDate) return 'later';
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  if (t.dueDate <= addDays(today, 6)) return 'week';
  return 'later';
}

/** Open tasks in their groups, soonest first (no due date last). Pure. */
export function groupMyWork(tasks: MyTask[], today: string): Record<MyWorkGroup, MyTask[]> {
  const groups: Record<MyWorkGroup, MyTask[]> = { overdue: [], today: [], week: [], later: [] };
  for (const t of tasks.filter(OPEN)) groups[groupOf(t, today)].push(t);
  for (const g of MY_WORK_GROUPS) {
    groups[g].sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
  }
  return groups;
}

/**
 * The row as the task buttons take it. The person who gave the work stands in
 * for an unset reviewer: Send for review goes to them (the API defaults it),
 * so no reviewer is asked for. Pure.
 */
export function asWorkTask(t: MyTask, me: string | null): WorkTask {
  return {
    id: t.id,
    engagementId: t.engagementId,
    title: t.title,
    description: null,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    isOverdue: t.isOverdue,
    blockedByOpenCount: t.blockedByOpenCount,
    assignedToId: t.assignedToId ?? me,
    assignedToName: t.assignedToName ?? null,
    engagementServiceId: null,
    stream: t.stream ?? null,
    reviewerId: t.reviewerId ?? t.assignedById ?? null,
    reviewerName: t.reviewerName ?? t.assignedByName ?? null,
    workType: null,
    complianceInstanceId: t.complianceInstanceId ?? null,
    sentForReviewAt: null,
    reviewStartedAt: null,
    version: t.version,
    engagementCode: t.engagementCode,
    entityName: t.entityName,
  };
}

const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

function AskGiver({ task }: { task: MyTask }): JSX.Element {
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const giver = task.assignedByName ?? 'them';
  const ask = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${task.engagementId}/tasks/${task.id}/ask`, {
        method: 'POST',
        body: { question: question.trim() },
      }),
    onSuccess: () => {
      toast(`Sent to ${giver}.`);
      setQuestion('');
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not send the question.', 'error'),
  });
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        if (question.trim()) ask.mutate();
      }}
    >
      <Textarea
        className="min-h-16 flex-1"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={`Your question for ${giver}`}
        aria-label={`Question for ${giver}`}
        maxLength={2000}
      />
      <Button size="sm" type="submit" disabled={!question.trim() || ask.isPending}>
        Ask {firstName(giver)}
      </Button>
    </form>
  );
}

function WorkRow({
  task,
  me,
  hrefOf,
  onOpen,
  onDocuments,
}: {
  task: MyTask;
  me: string | null;
  hrefOf: (t: MyTask) => string;
  onOpen?: (t: MyTask) => boolean;
  onDocuments: (t: MyTask) => void;
}): JSX.Element {
  const checks = useFirmChecks();
  const [open, setOpen] = useState(false);
  const canAsk = !!task.assignedById && task.assignedById !== me;
  const withReviewer = task.status === TASK_STATUS.inReview;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Close ${task.title}` : `Open ${task.title}`}
          onClick={() => setOpen(!open)}
          className="rounded p-1 text-ink-muted hover:bg-surface-sunken"
        >
          {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <Link
            href={hrefOf(task)}
            onClick={(e) => {
              if (onOpen?.(task)) e.preventDefault();
            }}
            className="block truncate text-sm font-medium text-primary-700 hover:underline"
          >
            {task.title}
          </Link>
          <span className="block truncate text-xs text-ink-faint">
            {task.engagementCode} · {task.entityName}
            {task.dueDate ? ` · due ${formatDate(task.dueDate)}` : ''}
            {task.assignedByName ? ` · from ${task.assignedByName}` : ''}
          </span>
        </div>
        <StatusBadge status={task.status} />
        {withReviewer ? (
          <span className="text-xs text-ink-muted">
            With {task.reviewerName ?? 'the reviewer'} for review
          </span>
        ) : (
          <TaskActions
            task={asWorkTask(task, me)}
            ctx={{ me, isLead: false, checks }}
            only={[nextStepOf(task.status)]}
          />
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-l-2 border-line pl-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onDocuments(task)}>
              <FolderOpen className="h-4 w-4" /> Client documents
            </Button>
            {task.complianceInstanceId && onOpen && (
              <Button size="sm" variant="secondary" onClick={() => onOpen(task)}>
                <ClipboardList className="h-4 w-4" /> Checklist
              </Button>
            )}
          </div>
          {task.status === TASK_STATUS.inProgress && task.assignedByName && (
            <p className="text-xs text-ink-muted">
              Send for review goes to {task.assignedByName}, who gave you this.
            </p>
          )}
          {canAsk && <AskGiver task={task} />}
        </div>
      )}
    </li>
  );
}

/**
 * C-5 — an Article's My Work: Overdue / Today / This week / Later, one next
 * step per row (Start → Send for review), and under each row (+) the client's
 * documents, the filing's checklist and "Ask <who gave it>".
 */
export function ArticleWork({
  tasks,
  today,
  me,
  hrefOf,
  onOpen,
  onDocuments,
}: {
  tasks: MyTask[];
  today: string;
  me: string | null;
  hrefOf: (t: MyTask) => string;
  onOpen?: (t: MyTask) => boolean;
  onDocuments: (t: MyTask) => void;
}): JSX.Element {
  const groups = useMemo(() => groupMyWork(tasks, today), [tasks, today]);
  const any = MY_WORK_GROUPS.some((g) => groups[g].length > 0);
  if (!any) {
    return (
      <Card className="p-5">
        <EmptyState>No open tasks assigned to you.</EmptyState>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {MY_WORK_GROUPS.filter((g) => groups[g].length > 0).map((g) => (
        <Card key={g} className="p-0">
          <h3
            className={cn(
              'border-b border-line px-4 py-2 text-sm font-semibold',
              g === 'overdue' ? 'text-danger-600' : 'text-ink',
            )}
          >
            {MY_WORK_GROUP_LABEL[g]} <span className="text-ink-faint">({groups[g].length})</span>
          </h3>
          <ul className="divide-y divide-line">
            {groups[g].map((t) => (
              <WorkRow
                key={t.id}
                task={t}
                me={me}
                hrefOf={hrefOf}
                onOpen={onOpen}
                onDocuments={onDocuments}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
