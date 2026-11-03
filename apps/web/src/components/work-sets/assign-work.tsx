'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  STREAMS,
  STREAM_LABEL,
  periodKeyLabel,
  type AssignableTask,
  type AssignableTaskFilters,
  type CreateWorkSetInput,
  type Stream,
  type WorkSetDetail,
  type WorkSetPerson,
  type WorkSetSummary,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, EmptyState, Panel, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';

export const WORK_SETS_KEY = ['work-sets'] as const;

const errorText = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;

/** "GSTR-1 · Oct 2026" for a filing's task, else nothing. */
export function filingOf(t: Pick<AssignableTask, 'formLabel' | 'periodKey'>): string | null {
  if (!t.formLabel) return null;
  return t.periodKey ? `${t.formLabel} · ${periodKeyLabel(t.periodKey)}` : t.formLabel;
}

export function openTasksPath(f: AssignableTaskFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return `/work-sets/open-tasks${s ? `?${s}` : ''}`;
}

/**
 * Assign work (Phase 2, C-3). A Manager or above filters the open tasks, ticks
 * a batch (all 16 GSTR-1 for Oct 2026, say), picks who gets them, a due date
 * and a note, and gives them as one named set. Everyone sees the sets given to
 * them; givers also see the sets they gave.
 */
export function AssignWorkScreen(): JSX.Element {
  const people = useQuery({
    queryKey: [...WORK_SETS_KEY, 'people'],
    queryFn: () => apiFetch<WorkSetPerson[]>('/work-sets/people'),
    retry: false,
  });
  if (people.isLoading) return <Spinner label="Loading…" />;
  const giver = people.isSuccess;
  return (
    <div className="space-y-6">
      {giver ? (
        <AssignPanel people={people.data} />
      ) : (
        <p className="text-sm text-ink-muted">
          A Manager, a Partner, the Managing Partner or an administrator gives sets of work. The
          sets given to you are below; open one to split it among the people who report to you.
        </p>
      )}
      <SetList side="assigned_to" title="Given to you" />
      {giver && <SetList side="assigned_by" title="Given by you" />}
    </div>
  );
}

const DUE_WITHIN = [
  { value: '', label: 'Any time' },
  { value: '0', label: 'Overdue or due today' },
  { value: '7', label: 'Within 7 days' },
  { value: '15', label: 'Within 15 days' },
  { value: '30', label: 'Within 30 days' },
];

function AssignPanel({ people }: { people: WorkSetPerson[] }): JSX.Element {
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<AssignableTaskFilters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const tasks = useQuery({
    queryKey: [...WORK_SETS_KEY, 'open-tasks', filters],
    queryFn: () => apiFetch<AssignableTask[]>(openTasksPath(filters)),
  });
  const rows = useMemo(() => tasks.data ?? [], [tasks.data]);
  const movable = rows.filter((t) => t.movable);
  const picked = rows.filter((t) => selected.has(t.id));

  const give = useMutation({
    mutationFn: (body: CreateWorkSetInput) =>
      apiFetch<WorkSetDetail>('/work-sets', { method: 'POST', body }),
    onSuccess: (set) => {
      toast(`Gave ${set.taskCount} to ${set.assignedToName} as “${set.name}”.`, 'success');
      setSelected(new Set());
      setName('');
      setNote('');
      void qc.invalidateQueries({ queryKey: WORK_SETS_KEY });
      router.push(`/work-sets/${set.id}`);
    },
    onError: (err) => toast(errorText(err, 'Could not give the work.'), 'error'),
  });

  const set = (patch: Partial<AssignableTaskFilters>): void => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(new Set());
  };
  const toggle = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = movable.length > 0 && movable.every((t) => selected.has(t.id));

  return (
    <Panel title="Give a set of work">
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Stream">
          <Select
            value={filters.stream ?? ''}
            onChange={(e) => set({ stream: e.target.value || undefined })}
          >
            <option value="">All</option>
            {STREAMS.map((s: Stream) => (
              <option key={s} value={s}>
                {STREAM_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Form">
          <Input
            placeholder="GSTR-1"
            value={filters.form ?? ''}
            onChange={(e) => set({ form: e.target.value.trim() || undefined })}
          />
        </Field>
        <Field label="Period">
          <Input
            placeholder="2026-10"
            value={filters.period ?? ''}
            onChange={(e) => set({ period: e.target.value.trim() || undefined })}
          />
        </Field>
        <Field label="Held by">
          <Select
            value={filters.ownerId ?? ''}
            onChange={(e) => set({ ownerId: e.target.value || undefined })}
          >
            <option value="">Anyone</option>
            <option value="none">Nobody</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due">
          <Select
            value={filters.dueWithinDays === undefined ? '' : String(filters.dueWithinDays)}
            onChange={(e) =>
              set({ dueWithinDays: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          >
            {DUE_WITHIN.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {tasks.isLoading ? (
        <Spinner label="Loading tasks…" />
      ) : tasks.isError ? (
        <EmptyState>{errorText(tasks.error, 'Could not load the tasks.')}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No open tasks match.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    aria-label="Tick every task that can be handed on"
                    checked={allPicked}
                    onChange={() =>
                      setSelected(allPicked ? new Set() : new Set(movable.map((t) => t.id)))
                    }
                  />
                </th>
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">Task</th>
                <th className="py-2 pr-3">Held by</th>
                <th className="py-2 pr-3">Due</th>
                <th className="py-2">Set</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((t) => (
                <tr key={t.id} className={t.movable ? '' : 'text-ink-faint'}>
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
                  <td className="py-2 pr-3">
                    <div className="text-ink">{t.entityName}</div>
                    <div className="text-xs text-ink-faint">{t.engagementCode}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{t.title}</div>
                    {filingOf(t) && <div className="text-xs text-ink-faint">{filingOf(t)}</div>}
                  </td>
                  <td className="py-2 pr-3">{t.assignedToName ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{formatDate(t.dueDate)}</td>
                  <td className="py-2">
                    {t.workSetId ? (
                      <Link href={`/work-sets/${t.workSetId}`} className="text-primary-600">
                        {t.workSetName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Give to" required>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Pick someone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {p.gradeName ? ` · ${p.gradeName}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due" hint="Every task in the set becomes due then.">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Name" hint="Left blank: the form and period, and their name.">
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Note">
          <Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        <span className="text-sm text-ink-muted">
          {picked.length === 1 ? '1 task ticked' : `${picked.length} tasks ticked`}
        </span>
        <Button
          disabled={picked.length === 0 || !to || give.isPending}
          onClick={() =>
            give.mutate({
              taskIds: picked.map((t) => t.id),
              assignedToId: to,
              dueDate: dueDate || null,
              name: name.trim() || null,
              note: note.trim() || null,
            })
          }
        >
          Give
        </Button>
      </div>
    </Panel>
  );
}

function SetList({
  side,
  title,
}: {
  side: 'assigned_to' | 'assigned_by';
  title: string;
}): JSX.Element {
  const sets = useQuery({
    queryKey: [...WORK_SETS_KEY, 'list', side],
    queryFn: () => apiFetch<WorkSetSummary[]>(`/work-sets?mine=${side}`),
  });
  return (
    <Panel title={title}>
      {sets.isLoading ? (
        <Spinner />
      ) : !sets.data?.length ? (
        <p className="text-sm text-ink-muted">None yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {sets.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <div>
                <Link href={`/work-sets/${s.id}`} className="font-medium text-primary-600">
                  {s.name}
                </Link>
                <span className="ml-2 text-xs text-ink-faint">
                  {side === 'assigned_to'
                    ? `from ${s.assignedByName ?? 'someone'}`
                    : `to ${s.assignedToName}`}
                  {s.dueDate ? ` · due ${formatDate(s.dueDate)}` : ''}
                </span>
              </div>
              <Badge tone={s.openCount === 0 ? 'success' : 'info'}>
                {s.doneCount} of {s.taskCount} done
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
