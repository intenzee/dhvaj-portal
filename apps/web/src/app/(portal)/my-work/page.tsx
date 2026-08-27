'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate, deadlineLabel } from '@/lib/format';
import type { MyTask, MyClientDependency } from '@/lib/types';
import { PageHeader, Spinner, Card } from '@/components/ui';
import { StatusBadge, PriorityBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { TaskStatusControl } from '@/components/actions/task-status-control';
import { ClientDependencyActions } from '@/components/actions/client-dependency-actions';
import { cn } from '@/lib/cn';

type Tab = 'tasks' | 'client-dependencies';

const taskColumns: ColumnDef<MyTask, unknown>[] = [
  { header: 'Task', accessorKey: 'title' },
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
];

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
  const [tab, setTab] = useState<Tab>(
    params.get('tab') === 'client-dependencies' ? 'client-dependencies' : 'tasks',
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

  return (
    <div>
      <PageHeader title="My Work" subtitle="Everything assigned to you, across every engagement." />

      <div className="mb-4 inline-flex rounded-lg border border-line-strong bg-surface p-1">
        {(
          [
            ['tasks', 'My Tasks'],
            ['client-dependencies', 'Client Dependencies'],
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
        <Card className="p-0">
          {tasks.isLoading && <div className="p-4"><Spinner /></div>}
          {tasks.data && <DataTable columns={taskColumns} data={tasks.data.items} empty="No open tasks assigned to you." />}
        </Card>
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

      <p className="mt-4 text-xs text-ink-faint">
        Looking for an engagement?{' '}
        <Link href="/engagements" className="text-primary-600 hover:underline">
          Browse engagements
        </Link>
        .
      </p>
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
