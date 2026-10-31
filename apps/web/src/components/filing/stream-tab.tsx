'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PENDING_REGISTRATION_STREAMS,
  STREAM_LABEL,
  STREAM_REGISTRATION_TYPES,
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
import { defaultPeriodKey } from '@/lib/period-choice';
import { rememberPlace } from '@/lib/last-place';
import { todayIst } from '@/components/work/my-task-columns';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Spinner,
} from '@/components/ui';
import { Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { WorkList } from '@/components/tasks/work-list';
import { filingEnd, filingStatusLabel } from './filing-status';
import { InstanceWorkspace } from './instance-workspace';
import { RocEvents } from './roc-events';
import { PeriodCleanup } from './period-cleanup';
import { GstinMissingBanner } from './gstin-missing-banner';
import { PriorFiledPanel } from './prior-filed-panel';

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
  if (item.workflowStatus === 'not_applicable')
    return 'border-line bg-surface-sunken text-ink-muted line-through';
  if (item.isOverdue) return 'border-danger-500/30 bg-danger-50 text-danger-700';
  if (item.workflowStatus === 'not_started') return 'border-line bg-surface-raised text-ink-muted';
  return 'border-primary-500/30 bg-primary-50 text-primary-700';
}

/** The URL key a period opens under: GST months use `m`, others `p`. */
export function periodParam(stream: Stream, periodKey: string): { key: 'm' | 'p'; value: string } {
  const m = stream === 'gst' ? monthParamOf(periodKey) : null;
  return m ? { key: 'm', value: m } : { key: 'p', value: periodKey };
}

function Pill({
  item,
  stream,
  label,
}: {
  item: TreeItem;
  stream: Stream;
  label?: string;
}): JSX.Element {
  const done = filingEnd(stream, item.section, item.ruleCode).done.toLowerCase();
  return (
    <span
      title={`${item.label}: ${filingStatusLabel(item.workflowStatus, stream, item.section, item.ruleCode)}${item.filedOn ? `, ${done} ${formatDate(item.filedOn)}` : ''}${item.dscWarning ? ` — ${item.dscWarning}` : ''}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${pillTone(item)}`}
    >
      {label ?? item.label}
      {item.workflowStatus !== 'filed' && item.requiredTotal > 0 && (
        <span className="opacity-70">
          {item.requiredDone}/{item.requiredTotal}
        </span>
      )}
      {item.workflowStatus === 'filed' && <span aria-hidden>✓</span>}
      {(item.ackMissing || item.referenceMissing) && (
        <span
          className="text-warning-700"
          title={
            item.ackMissing && item.referenceMissing
              ? 'The acknowledgement and reference are still to be added.'
              : item.ackMissing
                ? 'The acknowledgement is still to be added.'
                : 'The reference number is still to be added.'
          }
        >
          {item.ackMissing && item.referenceMissing
            ? 'ack & ref?'
            : item.ackMissing
              ? 'ack?'
              : 'ref?'}
        </span>
      )}
      {item.dscWarning && (
        <span className="text-warning-700" aria-label={item.dscWarning}>
          DSC
        </span>
      )}
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
  team = [],
  clientName,
}: {
  engagementId: string;
  stream: Stream;
  /** Named on "Add GSTIN / TAN", so it is plain whose number is being added. */
  clientName?: string | null;
  ctx: TaskActionContext;
  /** For "filed by" on the lodge form. */
  team?: { employeeId: string; employeeName: string }[];
  /** The page's selected year, used until the stream's own selector is set. */
  defaultFy?: string | null;
}): JSX.Element {
  const url = useUrlState();
  const gstin = url.get('gstin');
  const fyParam = url.get('fy') ?? defaultFy ?? null;
  const [annualOpen, setAnnualOpen] = useState<string | null>(null);
  const [priorOpen, setPriorOpen] = useState(false);

  // The tree resolves the registration from ?gstin by number, so a pasted
  // link survives re-seeding; the first fetch tells us the id.
  const regQ = useQuery({
    queryKey: ['filing', 'tree', engagementId, stream, 'registrations'],
    queryFn: () => apiFetch<StreamTree>(`/engagements/${engagementId}/streams/${stream}/tree`),
    staleTime: 60_000,
  });
  const registrationId =
    regQ.data?.registrations.find((r) => r.number === gstin)?.id ??
    regQ.data?.registrationId ??
    null;
  const qs = new URLSearchParams();
  if (registrationId) qs.set('registrationId', registrationId);
  if (fyParam) qs.set('fy', fyParam);
  const q = useQuery({
    queryKey: ['filing', 'tree', engagementId, stream, qs.toString()],
    queryFn: () =>
      apiFetch<StreamTree>(`/engagements/${engagementId}/streams/${stream}/tree?${qs.toString()}`),
    enabled: regQ.isSuccess,
  });

  const qc = useQueryClient();
  const rebuild = useMutation({
    mutationFn: () =>
      apiFetch<{ created: number }>(`/engagements/${engagementId}/compliance/generate-calendar`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filing', 'tree', engagementId] }),
  });

  const tree = q.data;
  const fy = tree?.financialYear ?? null;
  const openKey = useMemo(() => {
    if (!fy) return null;
    if (stream === 'gst') return monthKeyFor(fy, url.get('m'));
    return url.get('p');
  }, [fy, stream, url]);

  // WF-203: with no period in the URL, open the one that needs action and put
  // it in the address bar — once per registration and year, so a period the
  // person collapses stays collapsed.
  const autoFor = useRef<string | null>(null);
  const hasPeriod = !!(url.get('m') || url.get('p'));
  useEffect(() => {
    if (!tree || !fy) return;
    const scope = `${tree.registrationId ?? ''}|${fy}`;
    if (autoFor.current === scope) return;
    autoFor.current = scope;
    if (hasPeriod) return;
    const key = defaultPeriodKey(tree.periods, todayIst());
    if (!key) return;
    const param = periodParam(stream, key);
    url.set({ [param.key]: param.value });
  }, [tree, fy, hasPeriod, stream, url]);

  // Remember where this engagement was left, for the Engagements list.
  useEffect(() => {
    if (openKey) rememberPlace(engagementId, window.location.search);
  }, [openKey, engagementId]);

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
    return (
      <EmptyState>
        {err instanceof ApiError ? err.message : 'Could not load this stream.'}
      </EmptyState>
    );
  }

  // A GST / TDS stream with no registration behind it has nothing to file:
  // say so, rather than twelve empty months.
  const regTypes = STREAM_REGISTRATION_TYPES[stream];
  const hasFilings =
    tree.annual.length > 0 ||
    tree.periods.some(
      (p) => p.items.length > 0 || Object.values(p.sections).some((x) => x?.length),
    );
  // GST and TDS are built even without the GSTIN / TAN: say the periods are
  // not built yet and offer to build them now, with the number to follow.
  const canWaitOnRegistration = PENDING_REGISTRATION_STREAMS.includes(stream);
  const pendingStream = stream === 'gst' || stream === 'tds' ? stream : null;
  const periodsWord = stream === 'gst' ? 'months' : 'quarters';
  if (
    stream !== 'roc' &&
    !regTypes.includes('entity') &&
    tree.registrations.length === 0 &&
    !hasFilings
  ) {
    const kind = regTypes.join(' / ').toUpperCase();
    return (
      <div className="space-y-3">
        {canWaitOnRegistration && pendingStream && (
          <GstinMissingBanner
            engagementId={engagementId}
            isLead={ctx.isLead}
            stream={pendingStream}
            clientName={clientName}
          />
        )}
        <Card>
          <CardBody className="space-y-3">
            {canWaitOnRegistration ? (
              <>
                <p className="text-sm text-ink">
                  The {STREAM_LABEL[stream]} {periodsWord} for this engagement have not been built
                  yet.
                </p>
                <p className="text-xs text-ink-muted">
                  Build them now — they are worked without the {kind} until it is added, then move
                  onto it — or add the {kind} first.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-ink">
                  No {kind} on this engagement yet, so there are no {STREAM_LABEL[stream]} returns
                  to show.
                </p>
                <p className="text-xs text-ink-muted">
                  {STREAM_LABEL[stream]} returns are built per {kind}. Add the client’s {kind} on
                  the client’s page (Registrations) — the calendar rebuilds itself — or rebuild it
                  here once it is on file.
                </p>
              </>
            )}
            {ctx.isLead && (
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
                  {rebuild.isPending
                    ? 'Building…'
                    : canWaitOnRegistration
                      ? `Build ${STREAM_LABEL[stream]} ${periodsWord}`
                      : 'Rebuild calendar'}
                </Button>
                {rebuild.isSuccess && rebuild.data.created === 0 && (
                  <span className="text-xs text-warning-700">
                    Still nothing to file — check the client has an active {kind}.
                  </span>
                )}
                {rebuild.error && (
                  <span className="text-xs text-danger-700">
                    {rebuild.error instanceof ApiError
                      ? rebuild.error.message
                      : 'Could not rebuild.'}
                  </span>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  // ROC: the FY's events sit below the annual strip (spec §6.1); with no
  // CIN / LLPIN the panel alone says why (G13).
  const rocPanel =
    stream === 'roc' ? (
      <RocEvents engagementId={engagementId} isLead={ctx.isLead} financialYear={fy ?? null} />
    ) : null;
  if (
    rocPanel &&
    tree.registrations.length === 0 &&
    tree.annual.length === 0 &&
    tree.periods.length === 0
  ) {
    return rocPanel;
  }

  let lastQuarter: string | null = null;
  return (
    <div className="space-y-4">
      {tree.registrationPending && canWaitOnRegistration && pendingStream && (
        <GstinMissingBanner
          engagementId={engagementId}
          isLead={ctx.isLead}
          stream={pendingStream}
          clientName={clientName}
        />
      )}
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
                    active
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-line hover:border-primary-600/60'
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
            {tree.registrations[0]!.label}{' '}
            <span className="font-mono">{tree.registrations[0]!.number}</span>
          </span>
        )}
        <span className="ml-auto" />
        {ctx.isLead && fy && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={priorOpen}
            onClick={() => setPriorOpen((o) => !o)}
          >
            <ExpandToggle open={priorOpen} /> Filed before the portal
          </Button>
        )}
        <Select
          className="w-auto"
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
      {priorOpen && fy && (
        <PriorFiledPanel
          engagementId={engagementId}
          stream={stream}
          financialYear={fy}
          onDone={() => setPriorOpen(false)}
        />
      )}

      {tree.annual.length > 0 && (
        <Card data-part="annual">
          <CardHeader>
            <CardTitle data-part-heading>Annual · FY {fy}</CardTitle>
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
                  <Pill item={a} stream={stream} label={`${a.label} · ${formatDate(a.dueDate)}`} />
                </button>
              ))}
            </div>
            {annualOpen && (
              <div className="rounded-lg border border-primary-600/30 border-l-4 border-l-primary-600 p-3">
                <InstanceWorkspace instanceId={annualOpen} ctx={ctx} team={team} />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {rocPanel}

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
                    <div className="flex flex-wrap items-center hover:bg-surface-sunken/50">
                      <button
                        type="button"
                        className="group flex min-w-0 flex-1 flex-wrap items-center gap-2 px-4 py-2 text-left"
                        aria-expanded={open}
                        onClick={() => url.set({ [param.key]: open ? null : param.value })}
                      >
                        <ExpandToggle open={open} />
                        <span className="w-24 shrink-0 font-medium text-ink">{p.label}</span>
                        <span className="flex flex-wrap gap-1">
                          {sectioned
                            ? GST_SECTIONS.flatMap((s) =>
                                (p.sections[s.key] ?? []).map((i) => (
                                  <Pill
                                    key={i.instanceId}
                                    item={i}
                                    stream={stream}
                                    label={`${s.label}: ${i.label}`}
                                  />
                                )),
                              )
                            : p.items.map((i) => (
                                <Pill key={i.instanceId} item={i} stream={stream} />
                              ))}
                        </span>
                        {p.nextAction && (
                          <span className="ml-auto text-xs text-ink-muted">
                            Next: {p.nextAction}
                          </span>
                        )}
                      </button>
                      {ctx.isLead && (
                        <PeriodCleanup
                          engagementId={engagementId}
                          stream={stream}
                          period={p}
                          registrationId={tree.registrationId}
                        />
                      )}
                    </div>
                    {open && (
                      <div
                        data-open-period={p.periodKey}
                        className="border-l-4 border-l-primary-600 bg-surface-sunken/40 px-4 py-3"
                      >
                        {sectioned ? (
                          <div className="grid gap-4 lg:grid-cols-3">
                            {GST_SECTIONS.map((s) => (
                              <section
                                key={s.key}
                                aria-label={s.label}
                                data-part={s.key}
                                className="min-w-0 space-y-3"
                              >
                                <h4
                                  data-part-heading
                                  className="text-xs font-semibold uppercase tracking-wide text-ink-muted"
                                >
                                  {s.label}
                                </h4>
                                {(p.sections[s.key] ?? []).length === 0 ? (
                                  <p className="text-xs text-ink-muted">Nothing due.</p>
                                ) : (
                                  (p.sections[s.key] ?? []).map((i) => (
                                    <div
                                      key={i.instanceId}
                                      className="rounded-lg border border-line bg-surface p-3"
                                    >
                                      <InstanceWorkspace
                                        instanceId={i.instanceId}
                                        ctx={ctx}
                                        correctionTargets={targetsFor(p)}
                                        team={team}
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
                              <div
                                key={i.instanceId}
                                className="rounded-lg border border-line bg-surface p-3"
                              >
                                <InstanceWorkspace
                                  instanceId={i.instanceId}
                                  ctx={ctx}
                                  correctionTargets={targetsFor(p)}
                                  team={team}
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
