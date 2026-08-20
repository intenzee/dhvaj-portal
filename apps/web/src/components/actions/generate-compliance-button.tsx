'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui';

interface BulkResult {
  generated: unknown[];
  skipped: Array<{ rule: string; reason: string }>;
}

/** Generate compliance obligations for the engagement's service (bulk, audited). */
export function GenerateComplianceButton({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();

  const gen = useMutation({
    mutationFn: () =>
      apiFetch<BulkResult>(`/engagements/${engagementId}/compliance/generate-for-service`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) => {
      const made = r.generated.length;
      const skipped = r.skipped.length;
      toast(
        made > 0
          ? `Generated ${made} obligation${made === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
          : `Nothing to generate${skipped ? ` (${skipped} skipped)` : ''}.`,
      );
      qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'compliance'] });
      qc.invalidateQueries({ queryKey: ['compliance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not generate.', 'error'),
  });

  return (
    <Button size="sm" variant="secondary" disabled={gen.isPending} onClick={() => gen.mutate()}>
      <CalendarPlus className="h-4 w-4" /> {gen.isPending ? 'Generating…' : 'Generate'}
    </Button>
  );
}
