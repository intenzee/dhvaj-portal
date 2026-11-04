'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  SaveTaxAuditMilestoneInput,
  TaxAuditMilestone,
  TaxAuditMilestones,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EmployeeRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { Select } from '@/components/form';
import { TAX_AUDITS_KEY } from './keys';

/**
 * Tax audit milestones (Phase 5, F-9), opened under the year's row: the
 * firm's internal dates counted back from the report's due date, who answers
 * for each, and what is done. A missed one is red and sits on its owner's
 * Today. The desks move the stage and with it the milestones behind it; the
 * owner or the engagement's partner or manager ticks the ones no desk moves
 * yet, and the partner or manager may name someone else for a milestone.
 */
export function MilestonesPanel({
  engagementId,
  auditId,
}: {
  engagementId: string;
  auditId: string;
}): JSX.Element {
  const url = `/engagements/${engagementId}/tax-audits/${auditId}/milestones`;
  const key = [...TAX_AUDITS_KEY, 'milestones', auditId];
  const q = useQuery({ queryKey: key, queryFn: () => apiFetch<TaxAuditMilestones>(url) });
  const qc = useQueryClient();
  const toast = useToast();
  const [naming, setNaming] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
    enabled: naming !== null,
  });
  const save = useMutation({
    mutationFn: ({ key: m, ...body }: SaveTaxAuditMilestoneInput & { key: string }) =>
      apiFetch<TaxAuditMilestones>(`${url}/${m}`, { method: 'PUT', body }),
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      setNaming(null);
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });

  if (q.isLoading) return <Spinner label="Loading the milestones…" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger-700">Could not load them.</p>;
  const v = q.data;
  if (v.milestones.length === 0) {
    return (
      <p className="text-sm text-ink-muted">No milestones: this tax audit is not applicable.</p>
    );
  }
  const missed = v.milestones.filter((m) => m.missed).length;

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-muted">
        {v.dueDate
          ? `Counted back from the report's due date, ${formatDate(v.dueDate)}. The firm sets the days in Admin → Workflow.`
          : 'No due date yet: the dates appear once the report is on the calendar.'}
        {missed > 0 && (
          <span className="ml-1 font-medium text-danger-700">
            {missed === 1 ? '1 milestone missed.' : `${missed} milestones missed.`}
          </span>
        )}
      </p>
      <ul
        className="divide-y divide-line rounded border border-line bg-surface"
        aria-label="Milestones"
      >
        {v.milestones.map((m) => (
          <li key={m.key} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="min-w-0 flex-1 font-medium text-ink">{m.label}</span>
              <span
                className={
                  m.missed ? 'w-28 text-sm font-medium text-danger-700' : 'w-28 text-sm text-ink'
                }
              >
                {m.dueOn ? formatDate(m.dueOn) : '—'}
              </span>
              <span className="w-44 text-sm text-ink-muted">
                {m.ownerName ?? `No ${m.roleLabel.toLowerCase()} yet`}
                <span className="block text-xs text-ink-faint">
                  {m.ownerNamed ? `Named for this · ${m.roleLabel} by role` : m.roleLabel}
                </span>
              </span>
              <span className="w-28">
                <MilestoneState m={m} />
              </span>
              <span className="flex shrink-0 gap-1.5">
                {m.canTick && (
                  <Button
                    size="sm"
                    variant={m.done ? 'ghost' : 'secondary'}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ key: m.key, done: !m.done })}
                  >
                    {m.done ? 'Not done' : 'Mark done'}
                  </Button>
                )}
                {v.canNameOwners && !m.done && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={naming === m.key}
                    onClick={() => setNaming(naming === m.key ? null : m.key)}
                  >
                    {naming === m.key ? '−' : '+'} Owner
                  </Button>
                )}
              </span>
            </div>
            {naming === m.key && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {people.isLoading ? (
                  <Spinner />
                ) : (
                  <Select
                    aria-label={`Who answers for ${m.label}`}
                    value={m.ownerNamed ? (m.ownerId ?? '') : ''}
                    disabled={save.isPending}
                    onChange={(e) => save.mutate({ key: m.key, ownerId: e.target.value || null })}
                  >
                    <option value="">The {m.roleLabel.toLowerCase()} by role</option>
                    {(people.data?.items ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} · {p.gradeName}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MilestoneState({ m }: { m: TaxAuditMilestone }): JSX.Element {
  if (m.done) {
    return (
      <Badge tone="success">
        {m.doneAt ? `Done ${formatDate(m.doneAt.slice(0, 10))}` : 'Done'}
      </Badge>
    );
  }
  if (m.missed) return <Badge tone="danger">Missed</Badge>;
  return <Badge tone="neutral">Open</Badge>;
}
