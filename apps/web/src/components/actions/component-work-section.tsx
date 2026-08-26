'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import {
  type ComponentInstanceRecord,
  type ComponentInstanceStatus,
  type GenerateInstancesResult,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { PERMISSION } from '@hsdg/contracts';
import { useToast } from '@/lib/toast';
import { Card, EmptyState, Badge, Button } from '@/components/ui';

const STATUS_TONE: Record<ComponentInstanceStatus, string> = {
  scheduled: 'neutral',
  active: 'info',
  completed: 'success',
  waived: 'warn',
  cancelled: 'danger',
};

/**
 * Component work (spec §21–§22, §26): the period-specific instances generated
 * from the configured recurring components, with a bulk "Generate work" action
 * and per-instance completion. Scheduled/future work is visually distinct from
 * current work.
 */
export function ComponentWorkSection({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const work = useQuery({
    queryKey: ['engagement', engagementId, 'component-work'],
    queryFn: () =>
      apiFetch<Paginated<ComponentInstanceRecord>>(
        `/engagements/${engagementId}/component-work?limit=100`,
      ),
  });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'component-work'] });
  };

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<GenerateInstancesResult>(`/engagements/${engagementId}/component-work/generate`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) => {
      const made = r.generated.length;
      const gone = r.removed.length;
      const parts: string[] = [];
      if (made > 0) parts.push(`generated ${made}`);
      if (gone > 0) parts.push(`removed ${gone} out-of-scope`);
      toast(
        parts.length > 0
          ? `Work synced — ${parts.join(', ')}.`
          : 'Nothing to change — work matches the current scope.',
      );
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not generate.', 'error'),
  });

  const complete = useMutation({
    mutationFn: (instanceId: string) =>
      apiFetch(`/engagements/${engagementId}/component-work/${instanceId}/status`, {
        method: 'POST',
        body: { status: 'completed' },
      }),
    onSuccess: () => {
      toast('Work item completed.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update.', 'error'),
  });

  // Hide cancelled work from the operational view — reconciling to a narrower
  // window/frequency cancels out-of-scope instances, which should simply
  // disappear here (they remain in the DB for audit).
  const items = (work.data?.items ?? []).filter((w) => w.status !== 'cancelled');

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Component work</h2>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            <CalendarPlus className="h-4 w-4" /> {generate.isPending ? 'Generating…' : 'Generate work'}
          </Button>
        )}
      </div>
      <Card className="overflow-hidden p-0">
        {work.isSuccess && items.length === 0 && (
          <div className="p-5">
            <EmptyState>
              No work generated yet.{' '}
              {canManage && 'Configure components above, then “Generate work”.'}
            </EmptyState>
          </div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Component</th>
                <th className="px-4 py-2.5 font-semibold">Period</th>
                <th className="px-4 py-2.5 font-semibold">Statutory</th>
                <th className="px-4 py-2.5 font-semibold">Internal SLA</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {items.map((w) => {
                const open = w.status === 'scheduled' || w.status === 'active';
                return (
                  <tr key={w.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 text-ink">{w.componentName}</td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {w.periodLabel}
                      {w.isFuture && (
                        <Badge tone="neutral" className="ml-2">
                          Scheduled
                        </Badge>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2.5 ${w.isOverdue ? 'font-medium text-danger-600' : 'text-ink-muted'}`}
                    >
                      {w.statutoryDeadline ? formatDate(w.statutoryDeadline) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {w.internalSlaDate ? formatDate(w.internalSlaDate) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[w.status] ?? 'neutral'}>{humanize(w.status)}</Badge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        {open && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={complete.isPending}
                            onClick={() => complete.mutate(w.id)}
                          >
                            Complete
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
