'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';

interface RollResult {
  horizonMonths: number;
  horizonEndDate: string;
  engagementsProcessed: number;
  generated: number;
  removed: number;
}

/**
 * Roll the recurring-work horizon forward (§18). Materialises the recurring
 * component work now within the configured future horizon across the
 * engagements the caller can lead — idempotent, so re-running never duplicates.
 */
export function RollHorizonButton(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();

  const horizon = useQuery({
    queryKey: ['compliance', 'horizon'],
    queryFn: () => apiFetch<{ horizonMonths: number }>('/compliance/horizon'),
  });

  const roll = useMutation({
    mutationFn: () => apiFetch<RollResult>('/compliance/horizon', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      toast(
        r.generated > 0
          ? `Generated ${r.generated} work instance${r.generated === 1 ? '' : 's'} across ${r.engagementsProcessed} engagement${r.engagementsProcessed === 1 ? '' : 's'}.`
          : `Up to date — nothing new within the ${r.horizonMonths}-month horizon.`,
      );
      void qc.invalidateQueries({ queryKey: ['compliance'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not roll the horizon.', 'error'),
  });

  const months = horizon.data?.horizonMonths;

  return (
    <Button variant="secondary" disabled={roll.isPending} onClick={() => roll.mutate()}>
      <CalendarClock className="h-4 w-4" />
      {roll.isPending
        ? 'Rolling…'
        : `Roll horizon${months !== undefined ? ` (${months} mo)` : ''}`}
    </Button>
  );
}
