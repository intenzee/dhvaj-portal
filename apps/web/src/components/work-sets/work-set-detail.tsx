'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SplitWorkSetInput,
  SplitWorkSetResult,
  WorkSetDetail,
  WorkSetPerson,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, EmptyState, PageHeader, Panel, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { StatusBadge } from '@/components/status-badge';
import { WORK_SETS_KEY, filingOf } from './assign-work';

const errorText = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;

/**
 * One set of work (Phase 2, C-4): who gave it, to whom, and who holds each
 * task now. The person it was given to (or its giver) may tick some of its
 * tasks and hand them on to someone below them, as reviewer of that piece.
 */
export function WorkSetDetailScreen({ id }: { id: string }): JSX.Element {
  const set = useQuery({
    queryKey: [...WORK_SETS_KEY, 'detail', id],
    queryFn: () => apiFetch<WorkSetDetail>(`/work-sets/${id}`),
    retry: false,
  });

  if (set.isLoading) return <Spinner />;
  if (set.isError || !set.data) {
    return (
      <div>
        <PageHeader title="Set of work" back={{ href: '/work-sets', label: 'Assign work' }} />
        <EmptyState>{errorText(set.error, 'Could not load this set.')}</EmptyState>
      </div>
    );
  }
  const s = set.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={s.name}
        subtitle={[
          `Given to ${s.assignedToName}`,
          s.assignedByName ? `by ${s.assignedByName}` : null,
          s.dueDate ? `due ${formatDate(s.dueDate)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        back={{ href: '/work-sets', label: 'Assign work' }}
        actions={
          <Badge tone={s.openCount === 0 ? 'success' : 'info'}>
            {s.doneCount} of {s.taskCount} done
          </Badge>
        }
      />
      {s.note && <p className="whitespace-pre-line text-sm text-ink-muted">{s.note}</p>}
      <SetTasks set={s} />
    </div>
  );
}

function SetTasks({ set }: { set: WorkSetDetail }): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');

  const below = useQuery({
    queryKey: [...WORK_SETS_KEY, 'people', 'below'],
    queryFn: () => apiFetch<WorkSetPerson[]>('/work-sets/people?below=true'),
    enabled: set.canSplit,
  });

  const split = useMutation({
    mutationFn: (body: SplitWorkSetInput) =>
      apiFetch<SplitWorkSetResult>(`/work-sets/${set.id}/split`, { method: 'POST', body }),
    onSuccess: (res) => {
      const who = below.data?.find((p) => p.id === to)?.fullName ?? 'them';
      toast(`Handed ${res.moved === 1 ? '1 task' : `${res.moved} tasks`} to ${who}.`, 'success');
      setSelected(new Set());
      setNote('');
      void qc.invalidateQueries({ queryKey: WORK_SETS_KEY });
    },
    onError: (err) => toast(errorText(err, 'Could not hand the tasks on.'), 'error'),
  });

  const toggle = (taskId: string): void =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  return (
    <Panel title="Tasks">
      {set.tasks.length === 0 ? (
        <EmptyState>No tasks left in this set.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                {set.canSplit && <th className="w-8 py-2" />}
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3">Held by</th>
                <th className="py-2 pr-3">Reviewer</th>
                <th className="py-2 pr-3">Due</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {set.tasks.map((t) => (
                <tr key={t.id}>
                  {set.canSplit && (
                    <td className="py-2">
                      <input
                        type="checkbox"
                        aria-label={`Tick ${t.title}`}
                        disabled={!t.movable}
                        title={
                          t.movable ? undefined : 'In progress or in review: it stays with them.'
                        }
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                      />
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <Link
                      href={`/engagements/${t.engagementId}`}
                      className="text-ink hover:text-primary-600"
                    >
                      {t.entityName}
                    </Link>
                    <div className="text-xs text-ink-faint">{t.engagementCode}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{t.title}</div>
                    {filingOf(t) && <div className="text-xs text-ink-faint">{filingOf(t)}</div>}
                  </td>
                  <td className="py-2 pr-3">{t.assignedToName ?? '—'}</td>
                  <td className="py-2 pr-3">{t.reviewerName ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{formatDate(t.dueDate)}</td>
                  <td className="py-2">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {set.canSplit && set.tasks.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          {below.data && below.data.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody reports to you to hand these on to.</p>
          ) : (
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
              <Field label="Hand on to">
                <Select value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Pick someone</option>
                  {(below.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                      {p.gradeName ? ` · ${p.gradeName}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note">
                <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button
                disabled={selected.size === 0 || !to || split.isPending}
                onClick={() =>
                  split.mutate({
                    taskIds: [...selected],
                    toEmployeeId: to,
                    note: note.trim() || null,
                  })
                }
              >
                Hand on {selected.size > 0 ? selected.size : ''}
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
