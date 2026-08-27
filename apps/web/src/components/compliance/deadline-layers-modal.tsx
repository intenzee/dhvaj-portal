'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEADLINE_LAYER_TYPES, DUE_DATE_CATEGORIES } from '@hsdg/contracts';
import { Check, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { ComplianceDeadlineLayer, ComplianceInstanceDetail, ComplianceRow } from '@/lib/types';
import { Button, Badge, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';

/**
 * Manage an obligation's deadline layers (§16): the preparation target and
 * review/stage gates that surface as their own calendar events alongside the
 * statutory and internal-SLA clocks.
 */
export function DeadlineLayersModal({
  engagementId,
  obligation,
  onClose,
}: {
  engagementId: string;
  obligation: ComplianceRow;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/engagements/${engagementId}/compliance/${obligation.id}`;

  const detail = useQuery({
    queryKey: ['engagement', engagementId, 'compliance', obligation.id],
    queryFn: () => apiFetch<ComplianceInstanceDetail>(base),
  });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'compliance'] });
    void qc.invalidateQueries({ queryKey: ['compliance'] });
  };

  // ── Add form ──
  const [layerType, setLayerType] = useState<string>(DEADLINE_LAYER_TYPES[0] ?? 'manager_review');
  const [label, setLabel] = useState('');
  const [dueDateCategory, setCategory] = useState<string>('HSDG_MILESTONE');
  const [dueDate, setDueDate] = useState('');
  const ready = label.trim().length > 0 && !!dueDate;

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`${base}/deadlines`, {
        method: 'POST',
        body: { layerType, label: label.trim(), dueDateCategory, dueDate },
      }),
    onSuccess: () => {
      toast('Deadline layer added.');
      setLabel('');
      setDueDate('');
      void detail.refetch();
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add the layer.', 'error'),
  });

  const complete = useMutation({
    mutationFn: (layerId: string) =>
      apiFetch(`${base}/deadlines/${layerId}/complete`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast('Layer completed.');
      void detail.refetch();
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not complete.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (layerId: string) => apiFetch(`${base}/deadlines/${layerId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Layer removed.');
      void detail.refetch();
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not remove.', 'error'),
  });

  const layers: ComplianceDeadlineLayer[] = detail.data?.deadlines ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Deadline layers"
      description={`${obligation.complianceRuleName} — statutory and internal-SLA plus the layers below.`}
      wide
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Anchor clocks (read-only context) */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="neutral">Statutory · {formatDate(obligation.effectiveStatutoryDeadline)}</Badge>
          <Badge tone="neutral">Internal SLA · {formatDate(obligation.effectiveInternalSlaDate)}</Badge>
          {obligation.isExtended && <Badge tone="warn">Extended</Badge>}
        </div>

        {/* Layers */}
        {detail.isLoading ? (
          <Spinner />
        ) : layers.length === 0 ? (
          <p className="text-sm text-ink-faint">No deadline layers yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {layers.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{l.label}</span>
                    <Badge tone="neutral">{humanize(l.dueDateCategory)}</Badge>
                    {l.status !== 'open' && <Badge tone="neutral">{humanize(l.status)}</Badge>}
                  </div>
                  <div className={`text-xs ${l.isOverdue ? 'font-medium text-danger-600' : 'text-ink-faint'}`}>
                    {humanize(l.layerType)} · {formatDate(l.dueDate)}
                    {l.isOverdue ? ' · overdue' : ''}
                  </div>
                </div>
                {l.status === 'open' && (
                  <>
                    <Button size="sm" variant="ghost" disabled={complete.isPending} onClick={() => complete.mutate(l.id)}>
                      <Check className="h-3.5 w-3.5" /> Complete
                    </Button>
                    <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add a layer */}
        <div className="rounded-lg border border-line-strong bg-surface-raised/40 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Add a layer</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <Select value={layerType} onChange={(e) => setLayerType(e.target.value)}>
                {DEADLINE_LAYER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={dueDateCategory} onChange={(e) => setCategory(e.target.value)}>
                {DUE_DATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Manager review" />
            </Field>
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!ready || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? 'Adding…' : 'Add layer'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
