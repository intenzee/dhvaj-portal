'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus } from 'lucide-react';
import type { ServiceComponentDocRequirementRecord } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Modal } from '@/components/modal';
import { Field, Input } from '@/components/form';
import { Button, Spinner, EmptyState, Badge } from '@/components/ui';

/**
 * Firm-admin config for a service component's required-documents checklist
 * (service.manage). The list of expected documents drives the missing-evidence
 * flag on component work and the checklist in each period's documents pop-up.
 */
export function ComponentChecklistConfigModal({
  componentId,
  componentName,
  onClose,
}: {
  componentId: string;
  componentName: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [mandatory, setMandatory] = useState(true);

  const key = ['service-components', componentId, 'doc-requirements'];
  const reqs = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<ServiceComponentDocRequirementRecord[]>(
        `/service-components/${componentId}/doc-requirements`,
      ),
  });
  const invalidate = (): void => void qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/service-components/${componentId}/doc-requirements`, {
        method: 'POST',
        body: { name: name.trim(), isMandatory: mandatory, displayOrder: reqs.data?.length ?? 0 },
      }),
    onSuccess: () => {
      toast('Requirement added.');
      setName('');
      setMandatory(true);
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add.', 'error'),
  });

  const toggle = useMutation({
    mutationFn: (r: ServiceComponentDocRequirementRecord) =>
      apiFetch(`/doc-requirements/${r.id}`, {
        method: 'PATCH',
        body: { isMandatory: !r.isMandatory },
      }),
    onSuccess: invalidate,
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (r: ServiceComponentDocRequirementRecord) =>
      apiFetch(`/doc-requirements/${r.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Requirement removed.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not remove.', 'error'),
  });

  const items = reqs.data ?? [];

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Required documents — ${componentName}`}
      description="The documents each period of this component should carry. Mandatory items drive the missing-evidence flag."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        {reqs.isLoading && <Spinner />}
        {reqs.isSuccess && items.length === 0 && (
          <EmptyState>No required documents defined yet.</EmptyState>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                  {r.description && (
                    <span className="block truncate text-xs text-ink-faint">{r.description}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => toggle.mutate(r)}
                  title="Toggle mandatory"
                  disabled={toggle.isPending}
                >
                  <Badge tone={r.isMandatory ? 'danger' : 'neutral'}>
                    {r.isMandatory ? 'Mandatory' : 'Optional'}
                  </Badge>
                </button>
                {!r.isActive && <Badge tone="neutral">Inactive</Badge>}
                <button
                  type="button"
                  onClick={() => remove.mutate(r)}
                  disabled={remove.isPending}
                  className="rounded p-1.5 text-ink-muted hover:bg-danger-50 hover:text-danger-600"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-lg border border-line bg-surface-raised/40 p-3">
          <Field label="Add a required document">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GSTR-3B"
                className="min-w-[12rem] flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) add.mutate();
                }}
              />
              <label className="flex items-center gap-1.5 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={mandatory}
                  onChange={(e) => setMandatory(e.target.checked)}
                />
                Mandatory
              </label>
              <Button size="sm" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
