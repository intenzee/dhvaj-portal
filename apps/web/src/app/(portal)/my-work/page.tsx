'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { FolderOpen, CheckCircle2 } from 'lucide-react';
import { NOTIFICATION_TYPE, TASK_STATUS, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, deadlineLabel } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { MyTask, MyClientDependency, NotificationRow } from '@/lib/types';
import { PageHeader, Spinner, Card, EmptyState, Button } from '@/components/ui';
import { StatusBadge, PriorityBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { TaskStatusControl } from '@/components/actions/task-status-control';
import { ClientDependencyActions } from '@/components/actions/client-dependency-actions';
import { ScopedDocumentsModal } from '@/components/documents/scoped-documents-modal';
import { CompletionBar } from '@/components/completion';
import { cn } from '@/lib/cn';

type Tab = 'tasks' | 'client-dependencies' | 'to-review';

const depColumns: ColumnDef<MyClientDependency, unknown>[] = [
  { header: 'Requested', accessorKey: 'requestedInfo' },
  {
    header: 'Engagement',
    cell: ({ row }) => (
      <span className="text-ink-muted">
        {row.original.engagementCode} · {row.original.entityName}
      </span>
    ),
  },
  { header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  {
    header: 'Escalation',
    cell: ({ row }) =>
      row.original.escalationDate ? (
        <span className={row.original.isOverdue ? 'font-medium text-danger-600' : ''}>
          {deadlineLabel(row.original.escalationDate)}
        </span>
      ) : (
        <span className="text-ink-faint">—</span>
      ),
  },
  { header: '', cell: ({ row }) => <ClientDependencyActions dep={row.original} /> },
];

function MyWorkInner(): JSX.Element {
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const initialTab = params.get('tab');
  const [tab, setTab] = useState<Tab>(
    initialTab === 'client-dependencies'
      ? 'client-dependencies'
      : initialTab === 'to-review'
        ? 'to-review'
        : 'tasks',
  );
  const [docsForTask, setDocsForTask] = useState<MyTask | null>(null);

  const taskColumns = useMemo<ColumnDef<MyTask, unknown>[]>(
    () => [
      {
        header: 'Task',
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setDocsForTask(row.original)}
            className="text-left font-medium text-primary-700 hover:underline"
            title="Open documents for this task"
          >
            {row.original.title}
          </button>
        ),
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
        cell: ({ row }) =>
          row.original.dueDate ? (
            <span className={row.original.isOverdue ? 'font-medium text-danger-600' : ''}>
              {formatDate(row.original.dueDate)}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      { header: 'Status', cell: ({ row }) => <TaskStatusControl task={row.original} /> },
      {
        header: '',
        id: 'documents',
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setDocsForTask(row.original)}
            className="inline-flex items-center gap-1 rounded p-1.5 text-ink-muted hover:bg-surface-sunken hover:text-primary-600"
            title="Documents"
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [],
  );

  const tasks = useQuery({
    queryKey: ['work', 'tasks'],
    queryFn: () => apiFetch<Paginated<MyTask>>('/work/tasks?limit=100'),
    enabled: tab === 'tasks',
  });
  const deps = useQuery({
    queryKey: ['work', 'client-dependencies'],
    queryFn: () => apiFetch<Paginated<MyClientDependency>>('/work/client-dependencies?limit=100'),
    enabled: tab === 'client-dependencies',
  });
  const toReview = useQuery({
    queryKey: ['work', 'to-review'],
    queryFn: () =>
      apiFetch<Paginated<NotificationRow>>(
        `/notifications?limit=100&unreadOnly=true&type=${NOTIFICATION_TYPE.documentUploaded}`,
      ),
    enabled: tab === 'to-review',
  });
  const markReviewed = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      toast('Marked as reviewed.');
      void qc.invalidateQueries({ queryKey: ['work', 'to-review'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  return (
    <div>
      <PageHeader title="My Work" subtitle="Everything assigned to you, across every engagement." />

      <div className="mb-4 inline-flex rounded-lg border border-line-strong bg-surface p-1">
        {(
          [
            ['tasks', 'My Tasks'],
            ['client-dependencies', 'Client Dependencies'],
            ['to-review', 'To Review'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              tab === key ? 'bg-primary-600 text-white' : 'text-ink-muted hover:bg-surface-sunken',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <>
          {tasks.data && tasks.data.items.length > 0 && (
            <div className="mb-3 flex items-center gap-3">
              <span className="text-sm text-ink-muted">Your progress:</span>
              <CompletionBar
                done={tasks.data.items.filter((t) => t.status === TASK_STATUS.done).length}
                total={
                  tasks.data.items.filter((t) => t.status !== TASK_STATUS.cancelled).length
                }
              />
            </div>
          )}
          <Card className="p-0">
            {tasks.isLoading && (
              <div className="p-4">
                <Spinner />
              </div>
            )}
            {tasks.data && (
              <DataTable
                columns={taskColumns}
                data={tasks.data.items}
                empty="No open tasks assigned to you."
              />
            )}
          </Card>
        </>
      )}
      {tab === 'client-dependencies' && (
        <Card className="p-0">
          {deps.isLoading && <div className="p-4"><Spinner /></div>}
          {deps.data && (
            <DataTable
              columns={depColumns}
              data={deps.data.items}
              empty="No open client dependencies you're waiting on."
            />
          )}
        </Card>
      )}

      {tab === 'to-review' && (
        <Card className="p-0">
          {toReview.isLoading && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {toReview.isSuccess && toReview.data.items.length === 0 && (
            <div className="p-5">
              <EmptyState>No documents awaiting your review.</EmptyState>
            </div>
          )}
          {toReview.data && toReview.data.items.length > 0 && (
            <ul className="divide-y divide-line">
              {toReview.data.items.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{n.title}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {n.body ? `${n.body} · ` : ''}
                      {formatDate(n.createdAt)}
                    </span>
                  </span>
                  {n.engagementId && (
                    <Link
                      href={`/engagements/${n.engagementId}`}
                      className="text-sm font-medium text-primary-700 hover:underline"
                    >
                      Open engagement
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={markReviewed.isPending}
                    onClick={() => markReviewed.mutate(n.id)}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Mark reviewed
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Looking for an engagement?{' '}
        <Link href="/engagements" className="text-primary-600 hover:underline">
          Browse engagements
        </Link>
        .
      </p>

      {docsForTask && (
        <ScopedDocumentsModal
          engagementId={docsForTask.engagementId}
          scope={{ taskId: docsForTask.id }}
          title={docsForTask.title}
          subtitle={`${docsForTask.engagementCode} · ${docsForTask.entityName}`}
          onClose={() => setDocsForTask(null)}
        />
      )}
    </div>
  );
}

export default function MyWorkPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <MyWorkInner />
    </Suspense>
  );
}
