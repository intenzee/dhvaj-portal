'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  STREAM_LABEL,
  type PeriodSection,
  type Stream,
  type StreamTree,
  type TreeItem,
  type TreePeriod,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { monthKeyFor, monthParamOf, useUrlState } from '@/lib/url-state';
import type { TaskActionContext } from '@/lib/work-types';
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from '@/components/ui';
import { Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { WorkList } from '@/components/tasks/work-list';
import { FILING_STATUS_LABEL } from './filing-status';
import { InstanceWorkspace } from './instance-workspace';

const GST_SECTIONS: { key: PeriodSection; label: string }[] = [
  { key: 'outward', label: 'Outward' },
  { key: 'inward', label: 'Inward' },
  { key: 'summary', label: 'Summary' },
];

/** Pill colour for a tree item: filed green, overdue red, working blue. */
export function pillTone(item: Pick<TreeItem, 'workflowStatus' | 'isOverdue' | 'isLate'>): string {
  if (item.workflowStatus === 'filed') {
    return item.isLate
      ? 'border-warning-500/30 bg-warning-50 text-warning-700'
      : 'border-success-500/30 bg-success-50 text-success-700';
  }
  if (item.workflowStatus === 'not_applicable') return 'border-line bg-surface-sunken text-ink-muted line-through';
  if (item.isOverdue) return 'border-danger-500/30 bg-danger-50 text-danger-700';
  if (item.workflowStatus === 'not_started') return 'border-line bg-surface-raised text-ink-muted';
  return 'border-primary-500/30 bg-primary-50 text-primary-700';
}

/** The URL key a period opens under: GST months use `m`, others `p`. */
export function periodParam(stream: Stream, periodKey: string): { key: 'm' | 'p'; value: string } {
  const m = stream === 'gst' ? monthParamOf(periodKey) : null;
  return m ? { key: 'm', value: m } : { key: 'p', value: periodKey };
}

function Pill({ item, label }: { item: TreeItem; label?: string }): JSX.Element {
  return (
    <span
      title={`${item.label}: ${FILING_STATUS_LABEL[item.workflowStatus]}${item.filedOn ? `, filed ${formatDate(item.filedOn)}` : ''}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${pillTone(item)}`}
    >
      {label ?? item.label}
      {item.workflowStatus !== 'filed' && item.requiredTotal > 0 && (
        <span className="opacity-70">
          {item.requiredDone}/{item.requiredTotal}
        </span>
      )}
      {item.workflowStatus === 'filed' && <span aria-hidden>✓</span>}
    </span>
  );
}

/**
 * Change 5 / 6 — one compliance stream (GST, TDS, Income Tax, ROC …):
 * registration bar (only when the client has more than one), year selector,
 * annual strip, the year's periods (QRMP months grouped by quarter) with
 * section pills and the next action, each period opening in place (+/−).
 * GST months show Outward / Inward / Summary side by side on wide screens.
 * State lives in the URL: ?tab=gst&gstin=…&fy=2026-27&m=10.
 */
export function StreamTab({
  engagementId,
  stream,
  ctx,
  defaultFy,
}: {
  engagementId: string;
  stream: Stream;
  ctx: TaskActionContext;
  /** The page's selected year, used until the stream's own selector is set. */
  defaultFy?: string | null;
}): JSX.Element {
  const url = useUrlState();
  const gstin = url.get('gstin');
  const fyParam = url.get('fy') ?? defaultFy ?? null;
  const [annualOpen, setAnnualOpen] = useState<string | null>(null);

  // The tree resolves the registration from ?gstin by number, so a pasted
  // link survives re-seeding; the first fetch tells us the id.
  const regQ = useQuery({
    queryKey: ['filing', 'tree', engagementId, stream, 'registrations'],
    queryFn: () => apiFetch<StreamTree>(`/engagements/${engagementId}/streams/${stream}/tree`),
    staleTime: 60_000,
  });
  const registrationId =
    regQ.data?.registrations.find((r) => r.number === gstin)?.id ?? regQ.data?.registrationId ?? null;
  const qs = new URLSearchParams();
  if (registrationId) qs.set('registrationId', registrationId);
  if (fyParam) qs.set('fy', fyParam);
  const q = useQuery({
    queryKey: ['filing', 'tree', engagementId, stream, qs.toString()],
    queryFn: () => apiFetch<StreamTree>(`/engagements/${engagementId}/streams/${stream}/tree?${qs.toString()}`),
    enabled: regQ.isSuccess,
  });

  const tree = q.data;
  const fy = tree?.financialYear ?? null;
  const openKey = useMemo(() => {
    if (!fy) return null;
    if (stream === 'gst') return monthKeyFor(fy, url.get('m'));
    return url.get('p');
  }, [fy, stream, url]);

  // Correction targets: every later filing in the same year.
  const targetsFor = (period: TreePeriod) =>
    (tree?.periods ?? [])
      .filter((p) => p.periodKey > period.periodKey)
      .flatMap((p) =>
        [...Object.values(p.sections).flat(), ...p.items].map((i) => ({
          id: i!.instanceId,
          label: `${i!.label} — ${p.label}`,
        })),
      );

  if (regQ.isLoading || q.isLoading) return <Spinner />;
  const err = regQ.error ?? q.error;
  if (err || !tree) {
    return <EmptyState>{err instanceof ApiError ? err.message : 'Could not load this stream.'}</EmptyState>;
  }

  let lastQuarter: string | null = null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tree.registrations.length > 1 && (
          <div role="tablist" aria-label="Registration" className="flex flex-wrap gap-1">
            {tree.registrations.map((r) => {
              const active = r.id === tree.registrationId;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => url.set({ gstin: r.number, m: null, p: null })}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    active ? 'border-primary-600 bg-primary-600 text-white' : 'border-line hover:border-primary-600/60'
                  }`}
                >
                  <span className="font-mono">{r.number}</span>
                  {r.stateCode && <span className="ml-1 opacity-80">· {r.stateCode}</span>}
                  {r.qrmpCategory && <span className="ml-1 opacity-80">· QRMP</span>}
                </button>
              );
            })}
          </div>
        )}
        {tree.registrations.length === 1 && (
          <span className="text-xs text-ink-muted">
            {tree.registrations[0]!.label} <span className="font-mono">{tree.registrations[0]!.number}</span>
          </span>
        )}
        <Select
          className="ml-auto w-auto"
          aria-label="Financial year"
          value={fy ?? ''}
          onChange={(e) => url.set({ fy: e.target.value, m: null, p: null })}
        >
          {tree.financialYears.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </Select>
      </div>

      {tree.annual.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Annual · FY {fy}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {tree.annual.map((a) => (
                <button
                  key={a.instanceId}
                  type="button"
                  className="group inline-flex items-center gap-1"
                  aria-expanded={annualOpen === a.instanceId}
                  onClick={() => setAnnualOpen(annualOpen === a.instanceId ? null : a.instanceId)}
                >
                  <ExpandToggle open={annualOpen === a.instanceId} />
                  <Pill item={a} label={`${a.label} · ${formatDate(a.dueDate)}`} />
                </button>
              ))}
            </div>
            {annualOpen && (
              <div className="rounded-lg border border-primary-600/30 border-l-4 border-l-primary-600 p-3">
                <InstanceWorkspace instanceId={annualOpen} ctx={ctx} />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {STREAM_LABEL[stream]} · {stream === 'gst' ? 'months' : 'periods'}
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {tree.periods.length === 0 ? (
            <div className="p-4">
              <EmptyState>No filings in FY {fy ?? '—'} for this stream.</EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {tree.periods.map((p) => {
                const open = openKey === p.periodKey;
                const param = periodParam(stream, p.periodKey);
                const showQuarter = p.quarter && p.quarter !== lastQuarter;
                lastQuarter = p.quarter;
                const sectioned = GST_SECTIONS.some((s) => (p.sections[s.key]?.length ?? 0) > 0);
                return (
                  <li key={p.periodKey} data-period={p.periodKey}>
                    {showQuarter && (
                      <p className="bg-surface-sunken px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        {p.quarter}
                      </p>
                    )}
                    <button
                      type="button"
                      className="group flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left hover:bg-surface-sunken/50"
                      aria-expanded={open}
                      onClick={() => url.set({ [param.key]: open ? null : param.value })}
                    >
                      <ExpandToggle open={open} />
                      <span className="w-24 shrink-0 font-medium text-ink">{p.label}</span>
                      <span className="flex flex-wrap gap-1">
                        {sectioned
                          ? GST_SECTIONS.flatMap((s) =>
                              (p.sections[s.key] ?? []).map((i) => (
                                <Pill key={i.instanceId} item={i} label={`${s.label}: ${i.label}`} />
                              )),
                            )
                          : p.items.map((i) => <Pill key={i.instanceId} item={i} />)}
                      </span>
                      {p.nextAction && (
                        <span className="ml-auto text-xs text-ink-muted">Next: {p.nextAction}</span>
                      )}
                    </button>
                    {open && (
                      <div className="border-l-4 border-l-primary-600 bg-surface-sunken/40 px-4 py-3">
                        {sectioned ? (
                          <div className="grid gap-4 lg:grid-cols-3">
                            {GST_SECTIONS.map((s) => (
                              <section key={s.key} aria-label={s.label} className="min-w-0 space-y-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                                  {s.label}
                                </h4>
                                {(p.sections[s.key] ?? []).length === 0 ? (
                                  <p className="text-xs text-ink-muted">Nothing due.</p>
                                ) : (
                                  (p.sections[s.key] ?? []).map((i) => (
                                    <div key={i.instanceId} className="rounded-lg border border-line bg-surface p-3">
                                      <InstanceWorkspace
                                        instanceId={i.instanceId}
                                        ctx={ctx}
                                        correctionTargets={targetsFor(p)}
                                      />
                                    </div>
                                  ))
                                )}
                              </section>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {p.items.map((i) => (
                              <div key={i.instanceId} className="rounded-lg border border-line bg-surface p-3">
                                <InstanceWorkspace
                                  instanceId={i.instanceId}
                                  ctx={ctx}
                                  correctionTargets={targetsFor(p)}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Other {STREAM_LABEL[stream]} work</CardTitle>
        </CardHeader>
        <CardBody>
          <WorkList
            engagementId={engagementId}
            ctx={ctx}
            stream={stream}
            unlinkedOnly
            emptyText="No other open tasks in this stream."
          />
        </CardBody>
      </Card>
    </div>
  );
}
