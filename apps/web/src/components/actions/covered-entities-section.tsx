'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Star, X } from 'lucide-react';
import { PERMISSION, type EngagementCoveredEntity, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { EntityRow } from '@/lib/types';
import { Card, Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field } from '@/components/form';

/**
 * Entities covered by the engagement (multi-entity / group, §30). Lists every
 * covered entity (primary first), lets a lead add another entity from the
 * client register, and remove a non-primary one (the primary anchors identity).
 */
export function CoveredEntitiesSection({
  engagementId,
  entities,
}: {
  engagementId: string;
  entities: EngagementCoveredEntity[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/entities`, {
        method: 'POST',
        body: { entityId: picked!.id, role: 'covered' },
      }),
    onSuccess: () => {
      toast('Entity added to coverage.');
      setOpen(false);
      setPicked(null);
      invalidate();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not add the entity.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (coverageId: string) =>
      apiFetch(`/engagements/${engagementId}/entities/${coverageId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Entity removed from coverage.');
      invalidate();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not remove the entity.', 'error'),
  });

  const visible = entities.filter((e) => e.status !== 'removed');
  // A group engagement covers more than the single primary entity.
  if (visible.length <= 1 && !canManage) return <></>;

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Entities covered</h2>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add entity
          </Button>
        )}
      </div>
      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Entity</th>
              <th className="px-4 py-2.5 font-semibold">Code</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              {canManage && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 text-ink">
                  <span className="inline-flex items-center gap-1.5">
                    {e.isPrimary && (
                      <Star className="h-3.5 w-3.5 text-amber-500" aria-label="Primary entity" />
                    )}
                    {e.entityName}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{e.entityCode}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={e.isPrimary ? 'info' : 'neutral'}>{humanize(e.role)}</Badge>
                </td>
                {canManage && (
                  <td className="px-4 py-2.5 text-right">
                    {!e.isPrimary && (
                      <button
                        onClick={() => remove.mutate(e.id)}
                        disabled={remove.isPending}
                        className="rounded p-0.5 text-ink-faint hover:bg-surface-sunken hover:text-danger-600"
                        aria-label={`Remove ${e.entityName}`}
                        title="Remove from coverage"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Add an entity to coverage">
        <div className="space-y-4">
          <Field label="Entity">
            <EntitySearch
              exclude={new Set(visible.map((e) => e.entityId))}
              value={picked}
              onChange={setPicked}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => add.mutate()} disabled={!picked || add.isPending}>
              Add entity
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

/** Search-and-select an entity from the client register. */
function EntitySearch({
  exclude,
  value,
  onChange,
}: {
  exclude: Set<string>;
  value: { id: string; label: string } | null;
  onChange: (v: { id: string; label: string } | null) => void;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const q = useQuery({
    queryKey: ['entities', 'pick', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(debounced)}&limit=6`),
    enabled: debounced.length >= 2,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line-strong px-3 py-2 text-sm">
        <span className="font-medium text-ink">{value.label}</span>
        <button
          className="text-xs text-primary-600 hover:underline"
          onClick={() => onChange(null)}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2">
        <Search className="h-4 w-4 text-ink-faint" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search entities by name or PAN…"
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      {debounced.length >= 2 && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1">
          {q.isFetching && <div className="px-3 py-2 text-sm text-ink-faint">Searching…</div>}
          {q.data && q.data.items.filter((e) => !exclude.has(e.id)).length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-faint">No other entities found.</div>
          )}
          {(q.data?.items ?? [])
            .filter((e) => !exclude.has(e.id))
            .map((e) => (
              <button
                key={e.id}
                onClick={() => onChange({ id: e.id, label: e.legalName })}
                className="block w-full px-3 py-2 text-left hover:bg-surface-raised"
              >
                <span className="block text-sm font-medium text-ink">{e.legalName}</span>
                <span className="block text-xs text-ink-faint">
                  {e.entityCode} · {e.typeName}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
