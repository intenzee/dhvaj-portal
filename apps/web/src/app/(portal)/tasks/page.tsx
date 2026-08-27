'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { MyTask } from '@/lib/types';
import { PageHeader, Spinner } from '@/components/ui';
import { PriorityBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { TaskStatusControl } from '@/components/actions/task-status-control';
import { cn } from '@/lib/cn';

const columns: ColumnDef<MyTask, unknown>[] = [
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
        <span className={row.original.isOverdue ? 'font-medium text-danger-600' : 'text-ink-muted'}>
          {formatDate(row.original.dueDate)}
        </span>
      ) : (
        <span className="text-ink-faint">—</span>
      ),
  },
  { header: 'Status', cell: ({ row }) => <TaskStatusControl task={row.original} /> },
];

export default function TasksPage(): JSX.Element {
  const router = useRouter();
  const [openOnly, setOpenOnly] = useState(true);

  const q = useQuery({
    queryKey: ['tasks', 'mine', openOnly],
    queryFn: () => apiFetch<Paginated<MyTask>>(`/work/tasks?limit=100${openOnly ? '' : ''}`),
  });

  const rows = (q.data?.items ?? []).filter((t) =>
    openOnly ? t.status !== 'done' && t.status !== 'cancelled' : true,
  );

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Tasks assigned to you across every engagement." />

      <div className="mb-4 flex gap-2">
        {(
          [
            [true, 'Open'],
            [false, 'All'],
          ] as const
        ).map(([val, label]) => (
          <button
            key={label}
            onClick={() => setOpenOnly(val)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition',
              openOnly === val
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {q.isLoading && <Spinner />}
      {q.data && (
        <DataTable
          columns={columns}
          data={rows}
          empty="No tasks match this view."
          onRowClick={(row) => router.push(`/engagements/${row.engagementId}`)}
        />
      )}
    </div>
  );
}
