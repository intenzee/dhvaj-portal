'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { MyClientDependency } from '@/lib/types';
import { Button } from '@/components/ui';

/** Receive / waive actions for an open client dependency. */
export function ClientDependencyActions({ dep }: { dep: MyClientDependency }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();

  const invalidate = (): void => {
    qc.invalidateQueries({ queryKey: ['work'] });
    qc.invalidateQueries({ queryKey: ['client-dependencies'] });
    qc.invalidateQueries({ queryKey: ['engagement', dep.engagementId] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const receive = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${dep.engagementId}/client-dependencies/${dep.id}/receive`, {
        method: 'POST',
        body: { fully: true, version: dep.version },
      }),
    onSuccess: () => {
      toast('Marked as received.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  const waive = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${dep.engagementId}/client-dependencies/${dep.id}/close`, {
        method: 'POST',
        body: { status: 'waived', reason: 'No longer required', version: dep.version },
      }),
    onSuccess: () => {
      toast('Dependency waived.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  if (!dep.isOpen) return null;
  const busy = receive.isPending || waive.isPending;

  return (
    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="subtle" disabled={busy} onClick={() => receive.mutate()}>
        Received
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => waive.mutate()}>
        Waive
      </Button>
    </div>
  );
}
