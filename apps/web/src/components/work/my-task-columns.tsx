'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { FolderOpen } from 'lucide-react';
import { TASK_STATUS } from '@hsdg/contracts';
import { formatDate } from '@/lib/format';
import type { MyTask } from '@/lib/types';
import { PriorityBadge } from '@/components/status-badge';
import { TaskStatusControl } from '@/components/actions/task-status-control';

const CLOSED: string[] = [TASK_STATUS.done, TASK_STATUS.cancelled];

/** The firm's internal date for a task: its filing's, else the task's own due date. */
export function internalDueOf(t: MyTask): string | null {
  return t.filing?.internalDate ?? t.dueDate ?? null;
}

/** Overdue against the internal date (design rule 4), or as the API flagged it. */
export function isTaskOverdue(t: MyTask, today: string): boolean {
  if (CLOSED.includes(t.status)) return false;
  const due = internalDueOf(t);
  return t.isOverdue || (due !== null && due.slice(0, 10) < today);
}

/** "GSTR-1 · Sep 2026 · 19AAAC…" — the filing a task produces; null with no filing. */
export function filingContextLine(t: MyTask): string | null {
  const f = t.filing;
  if (!f) return null;
  return [f.formLabel, f.periodLabel, f.registrationNumber].filter(Boolean).join(' · ') || null;
}

/**
 * My Work's default order (WF-104): overdue first, then by internal due date
 * (no date last), open before closed. Stable for equal keys. Pure — tested.
 */
export function sortMyTasks(tasks: MyTask[], today: string): MyTask[] {
  const rank = (t: MyTask) => (CLOSED.includes(t.status) ? 2 : isTaskOverdue(t, today) ? 0 : 1);
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const r = rank(a.t) - rank(b.t);
      if (r !== 0) return r;
      const da = internalDueOf(a.t);
      const db = internalDueOf(b.t);
      if (da !== db) {
        if (da === null) return 1;
        if (db === null) return -1;
        return da < db ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map(({ t }) => t);
}

/** Today in IST as yyyy-mm-dd (the firm's calendar day). */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * My Work's task columns with ff_work_links (WF-104): the title opens the work
 * itself (filing month and part, or the task's tab), the filing context sits
 * under it, the internal date leads with the statutory date muted beside it,
 * and the folder icon still opens the task's documents.
 */
export function useMyTaskColumns({
  hrefOf,
  onDocuments,
  today,
}: {
  hrefOf: (t: MyTask) => string;
  onDocuments: (t: MyTask) => void;
  today: string;
}): ColumnDef<MyTask, unknown>[] {
  return useMemo<ColumnDef<MyTask, unknown>[]>(
    () => [
      {
        header: 'Task',
        cell: ({ row }) => {
          const context = filingContextLine(row.original);
          return (
            <div className="min-w-0">
              <Link
                href={hrefOf(row.original)}
                className="block font-medium text-primary-700 hover:underline"
                title="Open the work"
              >
                {row.original.title}
              </Link>
              {context && <span className="block text-xs text-ink-faint">{context}</span>}
            </div>
          );
        },
      },
      {
        header: 'Engagement',
        cell: ({ row }) => (
          <span className="text-ink-muted">
            {row.original.engagementCode} · {row.original.entityName}
          </span>
        ),
      },
      { header: 'Priority', cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
      {
        header: 'Due',
        cell: ({ row }) => {
          const internal = internalDueOf(row.original);
          const statutory = row.original.filing?.statutoryDate ?? null;
          if (!internal && !statutory) return <span className="text-ink-faint">—</span>;
          return (
            <span>
              {internal && (
                <span
                  className={isTaskOverdue(row.original, today) ? 'font-medium text-danger-600' : ''}
                  title="Internal due date"
                >
                  {formatDate(internal)}
                </span>
              )}
              {statutory && statutory !== internal && (
                <span className="block text-xs text-ink-faint" title="Statutory due date">
                  Statutory {formatDate(statutory)}
                </span>
              )}
            </span>
          );
        },
      },
      { header: 'Status', cell: ({ row }) => <TaskStatusControl task={row.original} /> },
      {
        header: '',
        id: 'documents',
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onDocuments(row.original)}
            className="inline-flex items-center gap-1 rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-primary-600"
            title="Documents"
            aria-label={`Documents for ${row.original.title}`}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [hrefOf, onDocuments, today],
  );
}
