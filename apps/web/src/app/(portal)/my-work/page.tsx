'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { FolderOpen, CheckCircle2 } from 'lucide-react';
import {
  FEATURE_FLAG,
  NOTIFICATION_TYPE,
  PERMISSION,
  TASK_STATUS,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, deadlineLabel } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useWorkHref } from '@/lib/work-href';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import type { MyTask, MyClientDependency, NotificationRow } from '@/lib/types';
import { PageHeader, Spinner, Card, EmptyState, Button } from '@/components/ui';
import { StatusBadge, PriorityBadge } from '@/components/status-badge';
import { DataTable } from '@/components/data-table';
import { TaskStatusControl } from '@/components/actions/task-status-control';
import { ClientDependencyActions } from '@/components/actions/client-dependency-actions';
import { ScopedDocumentsModal } from '@/components/documents/scoped-documents-modal';
import { CompletionBar } from '@/components/completion';
import { cn } from '@/lib/cn';
import { sortMyTasks, todayIst, useMyTaskColumns } from '@/components/work/my-task-columns';
import { ReviewQueueTab, reviewFilterOf } from '@/components/work/review-queue-tab';
import { SectionChips, useUrlSections, withSections } from '@/components/section-filter';

type Tab = 'tasks' | 'client-dependencies' | 'to-review' | 'new-uploads';
type TaskScope = 'mine' | 'team';

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
        : initialTab === 'new-uploads'
          ? 'new-uploads'
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

  // ff_work_links (WF-104): the title opens the work, filing context and both
  // dates show, overdue first; the folder icon keeps the documents popup.
  const { isOn } = useFeatureFlags();
  const workLinks = isOn(FEATURE_FLAG.workLinks);
  const workHref = useWorkHref();
  const today = useMemo(() => todayIst(), []);
  const linkedTaskColumns = useMyTaskColumns({
    hrefOf: workHref,
    onDocuments: setDocsForTask,
    today,
  });
  // WF-106: engagement leads can switch the Tasks tab to their team's tasks
  // (everything on engagements they manage or partner), with an Assignee column.
  const { principal } = useAuth();
  const canTeam = workLinks && can(principal, PERMISSION.engagementManage);
  const [scope, setScope] = useState<TaskScope>('mine');
  const teamScope = canTeam && scope === 'team';
  const teamTaskColumns = useMemo<ColumnDef<MyTask, unknown>[]>(
    () => [
      ...linkedTaskColumns.slice(0, 1),
      {
        header: 'Assignee',
        cell: ({ row }) =>
          row.original.assignedToName ?? <span className="text-ink-faint">Unassigned</span>,
      },
      ...linkedTaskColumns.slice(1),
    ],
    [linkedTaskColumns],
  );
  // With ff_work_links, "To Review" is the review queue (WF-105) and the
  // document-upload notifications move to their own "New client uploads" tab.
  const uploadsTab: Tab = workLinks ? 'new-uploads' : 'to-review';

  // The section a Home panel's "View all" carried (?section=roc), as on /tasks.
  const [sections, setSections] = useUrlSections();
  const tasks = useQuery({
    queryKey: teamScope ? ['work', 'tasks', sections, 'team'] : ['work', 'tasks', sections],
    queryFn: () =>
      apiFetch<Paginated<MyTask>>(
        withSections(`/work/tasks?limit=100${teamScope ? '&scope=team' : ''}`, sections),
      ),
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
    enabled: tab === uploadsTab,
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
            ...(workLinks ? ([['new-uploads', 'New client uploads']] as const) : []),
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
          <div className="mb-3">
            <SectionChips value={sections} onChange={setSections} />
          </div>
          {canTeam && (
            <div className="mb-3 flex items-center gap-2" role="group" aria-label="Whose tasks">
              {(
                [
                  ['mine', 'Mine'],
                  ['team', 'Team'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={scope === key}
                  onClick={() => setScope(key)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition',
                    scope === key
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!teamScope && tasks.data && tasks.data.items.length > 0 && (
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
                columns={
                  teamScope ? teamTaskColumns : workLinks ? linkedTaskColumns : taskColumns
                }
                data={workLinks ? sortMyTasks(tasks.data.items, today) : tasks.data.items}
                empty={
                  teamScope ? 'No open tasks on your team.' : 'No open tasks assigned to you.'
                }
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
              rowHref={workLinks ? workHref : undefined}
            />
          )}
        </Card>
      )}

      {tab === 'to-review' && workLinks && (
        <ReviewQueueTab initialFilter={reviewFilterOf(params.get('filter'))} />
      )}

      {tab === uploadsTab && (
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
