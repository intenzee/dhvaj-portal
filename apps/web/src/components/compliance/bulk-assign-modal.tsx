'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FilingRunBulkResult, Paginated } from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { EmployeeRow } from '@/lib/types';
import { Button, Spinner } from '@/components/ui';
import { Field, Select } from '@/components/form';
import { Modal } from '@/components/modal';

/** "Keep" leaves the field as it is; "none" clears it. */
export const KEEP = '__keep__';
export const NONE = '__none__';

export function pick(v: string): string | null | undefined {
  if (v === KEEP) return undefined;
  if (v === NONE) return null;
  return v;
}

/**
 * Bulk assign: one preparer and / or reviewer onto every ticked filing the
 * caller leads (POST /compliance/runs/assign). Shared by Filing runs and the
 * ITR desk; `noun` names what is ticked ("filing", "return").
 */
export function BulkAssignModal({
  open,
  instanceIds,
  onClose,
  onDone,
  noun = 'filing',
}: {
  open: boolean;
  instanceIds: string[];
  onClose: () => void;
  onDone: (r: FilingRunBulkResult) => void;
  noun?: string;
}): JSX.Element | null {
  const toast = useToast();
  const [preparer, setPreparer] = useState(KEEP);
  const [reviewer, setReviewer] = useState(KEEP);
  const employees = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
    enabled: open,
  });
  const assign = useMutation({
    mutationFn: () => {
      const p = pick(preparer);
      const r = pick(reviewer);
      return apiFetch<FilingRunBulkResult>('/compliance/runs/assign', {
        method: 'POST',
        body: {
          instanceIds,
          ...(p !== undefined ? { preparerId: p } : {}),
          ...(r !== undefined ? { reviewerId: r } : {}),
        },
      });
    },
    onSuccess: (r) => {
      setPreparer(KEEP);
      setReviewer(KEEP);
      onDone(r);
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not assign.', 'error'),
  });
  const people = employees.data?.items ?? [];
  const sameAsPreparer = preparer !== KEEP && preparer !== NONE && preparer === reviewer;
  const nothing = preparer === KEEP && reviewer === KEEP;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign ${instanceIds.length} ${noun}${instanceIds.length === 1 ? '' : 's'}`}
      description={`Only ${noun}s you lead are assigned; the rest are reported back.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={nothing || sameAsPreparer || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {assign.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {employees.isLoading && <Spinner label="Loading people…" />}
        <Field label="Preparer">
          <Select value={preparer} onChange={(e) => setPreparer(e.target.value)}>
            <option value={KEEP}>Keep as it is</option>
            <option value={NONE}>Unassign</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.gradeName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reviewer">
          <Select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            <option value={KEEP}>Keep as it is</option>
            <option value={NONE}>No reviewer</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.gradeName}
              </option>
            ))}
          </Select>
        </Field>
        {sameAsPreparer && (
          <p className="text-sm text-danger-600">
            The preparer and the reviewer must be different people.
          </p>
        )}
      </div>
    </Modal>
  );
}
