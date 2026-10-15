'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkflowMeasure, WorkflowMeasuresReport } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import type { OfficeRow } from '@/lib/types';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

const UNIT: Record<WorkflowMeasure['unit'], string> = {
  steps: 'steps',
  percent: '%',
  hours: 'h',
  filings: 'filings',
  days: 'days',
  notifications: 'per person',
};

/** `2 steps`, `93.5%`, `4.25 h`, `25 min` — or a dash when there is nothing to measure. */
export function formatMeasure(value: number | null, unit: WorkflowMeasure['unit']): string {
  if (value === null) return '—';
  // Under an hour, in minutes: a review picked up at once reads "< 1 min", not "0 h".
  if (unit === 'hours' && value < 1) {
    const min = Math.round(value * 60);
    return min < 1 ? '< 1 min' : `${min} min`;
  }
  const n = Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 1);
  return unit === 'percent' ? `${n}%` : `${n} ${UNIT[unit]}`;
}

/** The change on the window before, as a signed percentage; null when either side is missing or zero. */
export function changeOf(m: Pick<WorkflowMeasure, 'value' | 'previous'>): number | null {
  if (m.value === null || m.previous === null || m.previous === 0) return null;
  return Math.round(((m.value - m.previous) / m.previous) * 100);
}

function istDay(offsetDays = 0): string {
  return new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Staff Workflow · How we measure it — the six numbers for a window of days,
 * each next to the window before it. Absolute targets show met / not met; the
 * percentage targets are read against the baseline the partners agree.
 */
export function WorkflowMeasures(): JSX.Element {
  const [to, setTo] = useState(() => istDay());
  const [from, setFrom] = useState(() => istDay(-6));
  const [officeId, setOfficeId] = useState('');

  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
  });
  const qs = new URLSearchParams({ from, to, ...(officeId ? { officeId } : {}) });
  const report = useQuery({
    queryKey: ['telemetry-measures', from, to, officeId],
    queryFn: () => apiFetch<WorkflowMeasuresReport>(`/telemetry/measures?${qs.toString()}`),
    enabled: from <= to,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Office">
          <Select value={officeId} onChange={(e) => setOfficeId(e.target.value)} className="w-44">
            <option value="">All offices</option>
            {(offices.data ?? [])
              .filter((o) => o.isActive)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      {report.isLoading ? (
        <Spinner />
      ) : report.isError || !report.data ? (
        <EmptyState>Couldn’t load the measures for these dates.</EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {report.data.measures.map((m) => {
            const change = changeOf(m);
            return (
              <section
                key={m.key}
                aria-label={m.label}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{m.label}</p>
                  <p className="text-xs text-ink-muted">{m.how}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums text-ink">
                    {formatMeasure(m.value, m.unit)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    before: {formatMeasure(m.previous, m.unit)}
                    {change !== null && ` (${change > 0 ? '+' : ''}${change}%)`} · n = {m.sample}
                  </p>
                </div>
                <div className="sm:w-40 sm:text-right">
                  <Badge
                    tone={m.meetsTarget === null ? 'neutral' : m.meetsTarget ? 'success' : 'warn'}
                  >
                    Target {m.target}
                  </Badge>
                </div>
              </section>
            );
          })}
        </Card>
      )}
      <p className="text-xs text-ink-muted">
        Steps and clicks come from page visits only — never what is on the page. The percentage
        targets are starting points to agree with the partners once the baseline is in.
      </p>
    </div>
  );
}
