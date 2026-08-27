'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { PERMISSION, type ComponentChecklistItem } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui';
import { Input } from '@/components/form';

/**
 * A component's checklist (spec §13/§17): the steps to complete its work. Any
 * engagement member can tick a step; leads can add or remove steps.
 */
export function ComponentChecklistModal({
  engagementId,
  componentId,
  componentName,
  onClose,
}: {
  engagementId: string;
  componentId: string;
  componentName: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [newLabel, setNewLabel] = useState('');

  const key = ['engagement', engagementId, 'components', componentId, 'checklist'];
  const base = `/engagements/${engagementId}/components/${componentId}/checklist`;

  const checklist = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<ComponentChecklistItem[]>(base),
  });

  const onError = (err: unknown): void =>
    toast(err instanceof ApiError ? err.message : 'Could not update the checklist.', 'error');
  const onData = (items: ComponentChecklistItem[]): void => {
    qc.setQueryData(key, items);
  };

  const toggle = useMutation({
    mutationFn: (v: { id: string; isDone: boolean }) =>
      apiFetch<ComponentChecklistItem[]>(`${base}/${v.id}`, {
        method: 'PATCH',
        body: { isDone: v.isDone },
      }),
    onSuccess: onData,
    onError,
  });

  const add = useMutation({
    mutationFn: (label: string) =>
      apiFetch<ComponentChecklistItem[]>(base, { method: 'POST', body: { label } }),
    onSuccess: (items) => {
      onData(items);
      setNewLabel('');
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<ComponentChecklistItem[]>(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: onData,
    onError,
  });

  const items = checklist.data ?? [];
  const done = items.filter((i) => i.isDone).length;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Checklist — ${componentName}`}
      description={items.length > 0 ? `${done} of ${items.length} steps done` : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {checklist.isLoading && <p className="text-sm text-ink-faint">Loading checklist…</p>}
      {checklist.isSuccess && items.length === 0 && (
        <p className="text-sm text-ink-muted">
          No checklist steps yet.{canManage ? ' Add the first below.' : ''}
        </p>
      )}
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="group flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-raised"
          >
            <input
              type="checkbox"
              checked={item.isDone}
              onChange={(e) => toggle.mutate({ id: item.id, isDone: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary-600"
              aria-label={item.label}
            />
            <div className="min-w-0 flex-1">
              <span
                className={
                  item.isDone ? 'text-sm text-ink-faint line-through' : 'text-sm text-ink'
                }
              >
                {item.label}
              </span>
              {item.isDone && item.doneByName && (
                <span className="ml-2 text-xs text-ink-faint">
                  {item.doneByName}
                  {item.doneAt ? ` · ${formatDate(item.doneAt)}` : ''}
                </span>
              )}
            </div>
            {canManage && (
              <button
                onClick={() => remove.mutate(item.id)}
                disabled={remove.isPending}
                className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition hover:text-danger-600 group-hover:opacity-100"
                aria-label={`Remove ${item.label}`}
                title="Remove step"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newLabel.trim()) add.mutate(newLabel.trim());
            }}
            placeholder="Add a step…"
          />
          <Button
            size="sm"
            onClick={() => add.mutate(newLabel.trim())}
            disabled={!newLabel.trim() || add.isPending}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      )}
    </Modal>
  );
}
