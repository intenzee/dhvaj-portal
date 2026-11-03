'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MoveWorkOptions, MoveWorkResult } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';
import { Input, Select } from '@/components/form';

export const moveWorkKey = (employeeId: string) => ['people', 'move-work', employeeId] as const;

/**
 * C-6 — move all of one person's open work (doing or reviewing) to someone
 * else, with a reason kept on each task. The People screen's leave panel and
 * the person's page both use it; the caller says who may take the work.
 */
export function MoveWorkForm({
  fromId,
  openTasks,
  takers,
  onMoved,
}: {
  fromId: string;
  openTasks: number;
  takers: { employeeId: string; fullName: string }[];
  onMoved?: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');

  const move = useMutation({
    mutationFn: () =>
      apiFetch<MoveWorkResult>('/people/admin/move-work', {
        method: 'POST',
        body: { fromEmployeeId: fromId, toEmployeeId: to, reason: reason.trim() },
      }),
    onSuccess: (r) => {
      toast(
        `Moved ${r.assigned} task${r.assigned === 1 ? '' : 's'} and ${r.reviews} review${r.reviews === 1 ? '' : 's'}.`,
      );
      setReason('');
      void qc.invalidateQueries({ queryKey: moveWorkKey(fromId) });
      onMoved?.();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not move the work.', 'error'),
  });

  return (
    <section aria-label="Move open work" className="space-y-2">
      <h4 className="font-semibold text-ink">Move open work</h4>
      <p className="text-xs text-ink-muted">
        {openTasks === 0
          ? 'Nothing open is theirs.'
          : `${openTasks} open task${openTasks === 1 ? '' : 's'} (doing or reviewing) go to the person you pick; they join those engagements’ teams.`}
      </p>
      <Select
        id={`move-to-${fromId}`}
        aria-label="Move to"
        value={to}
        onChange={(e) => setTo(e.target.value)}
      >
        <option value="">— Move to… —</option>
        {takers.map((o) => (
          <option key={o.employeeId} value={o.employeeId}>
            {o.fullName}
          </option>
        ))}
      </Select>
      <Input
        aria-label="Why the work is moving"
        placeholder="Why (kept on each task)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        disabled={!to || !reason.trim() || openTasks === 0 || move.isPending}
        onClick={() => move.mutate()}
      >
        {move.isPending ? 'Moving…' : 'Move all open work'}
      </Button>
    </section>
  );
}

/** Whether the viewer may move this person's work, and to whom (server-decided). */
export function useMoveWorkOptions(employeeId: string, enabled: boolean) {
  return useQuery({
    queryKey: moveWorkKey(employeeId),
    queryFn: () => apiFetch<MoveWorkOptions>(`/people/employees/${employeeId}/move-work`),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * The person's page, "Open work" tab: shown only to someone who may move it —
 * the Managing Partner, an administrator, or someone above them in the
 * reporting line (to someone in their own tree).
 */
export function MoveWorkTab({ options }: { options: MoveWorkOptions }): JSX.Element {
  const qc = useQueryClient();
  return (
    <div className="max-w-md">
      <MoveWorkForm
        fromId={options.employeeId}
        openTasks={options.openTasks}
        takers={options.takers}
        onMoved={() => void qc.invalidateQueries({ queryKey: ['people'] })}
      />
    </div>
  );
}
