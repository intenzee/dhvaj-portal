'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  STREAM_LABEL,
  type ActivityPage,
  type EngagementTabs,
  type OverviewDueItem,
  type Stream,
  type WorkItemRef,
  workItemHref,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { FilingStatusBadge, daysLeftText, dueTone } from '@/components/filing/filing-status';

export const tabsKey = (engagementId: string) => ['engagement', engagementId, 'tabs'] as const;

/** GET /engagements/:id/tabs — kind, years, streams in scope, Overview widgets. */
export function useEngagementTabs(engagementId: string) {
  return useQuery({
    queryKey: tabsKey(engagementId),
    queryFn: () => apiFetch<EngagementTabs>(`/engagements/${engagementId}/tabs`),
  });
}

/** An Overview due item as a work link (its filing's month and part in the stream tab). */
export function dueItemRef(engagementId: string, d: OverviewDueItem): WorkItemRef {
  return {
    engagementId,
    engagementKind: 'compliance',
    instanceId: d.instanceId,
    stream: d.stream,
    periodKey: d.periodKey,
    section: d.section,
    registrationNumber: d.registrationNumber,
  };
}

function hours(n: number): string {
  return `${Math.round(n * 10) / 10}h`;
}

/**
 * Change 3 — the Overview widgets: due in the next 30 days, overdue, waiting
 * on the client, hours (month / year vs budget), fee vs invoiced, and the
 * pinned comments.
 */
export function OverviewWidgets({
  engagementId,
  tabs,
}: {
  engagementId: string;
  tabs: EngagementTabs;
}): JSX.Element {
  const o = tabs.overview;
  const pinned = useQuery({
    queryKey: ['engagement', engagementId, 'activity', 'pinned'],
    queryFn: () => apiFetch<ActivityPage>(`/engagements/${engagementId}/activity?pinned=true&limit=10`),
  });
  const DueList = ({ items, empty }: { items: OverviewDueItem[]; empty: string }) =>
    items.length === 0 ? (
      <EmptyState>{empty}</EmptyState>
    ) : (
      <ul className="divide-y divide-line text-sm">
        {items.map((d) => (
          <li key={d.instanceId} className="flex flex-wrap items-center gap-2 py-1.5">
            <Link href={workItemHref(dueItemRef(engagementId, d))} className="font-medium text-primary-700 hover:underline">
              {d.label}
            </Link>
            <span className="text-xs text-ink-muted">
              {d.periodLabel}
              {d.stream && ` · ${STREAM_LABEL[d.stream as Stream] ?? d.stream}`}
              {d.registrationNumber && ` · ${d.registrationNumber}`}
            </span>
            <FilingStatusBadge status={d.workflowStatus} />
            <span className={`ml-auto text-xs ${dueTone(d.daysLeft)}`}>
              {formatDate(d.dueDate)} · {daysLeftText(d.daysLeft)}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Overdue ({o.overdue.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DueList items={o.overdue} empty="Nothing overdue." />
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Due in the next 30 days ({o.dueNext30.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DueList items={o.dueNext30} empty="Nothing due in the next 30 days." />
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Waiting on client ({o.waitingOnClient.length})</CardTitle>
        </CardHeader>
        <CardBody>
          {o.waitingOnClient.length === 0 ? (
            <EmptyState>Nothing outstanding from the client.</EmptyState>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {o.waitingOnClient.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="text-ink">{w.requestedInfo}</span>
                  {w.stream && (
                    <span className="text-xs text-ink-muted">{STREAM_LABEL[w.stream as Stream] ?? w.stream}</span>
                  )}
                  <span className={`ml-auto text-xs ${w.isOverdue ? 'font-semibold text-danger-700' : 'text-ink-muted'}`}>
                    asked {formatDate(w.requestDate)}
                    {w.escalationDate && ` · escalate ${formatDate(w.escalationDate)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Hours and fees{tabs.financialYear ? ` · FY ${tabs.financialYear}` : ''}</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label="This month" value={hours(o.hoursThisMonth)} />
          <Stat
            label="This year"
            value={`${hours(o.hoursThisYear)}${o.budgetHoursThisYear ? ` of ${hours(o.budgetHoursThisYear)}` : ''}`}
            warn={!!o.budgetHoursThisYear && o.hoursThisYear > o.budgetHoursThisYear}
          />
          <Stat label="Fee" value={o.feeAmount != null ? formatMoney(o.feeAmount) : '—'} />
          <Stat label="Invoiced" value={formatMoney(o.invoicedAmount)} />
          <Stat label="Unbilled" value={o.unbilledAmount != null ? formatMoney(o.unbilledAmount) : '—'} />
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Pinned comments</CardTitle>
        </CardHeader>
        <CardBody>
          {(pinned.data?.items ?? []).length === 0 ? (
            <EmptyState>No pinned comments. Pin one from Activity.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm">
              {pinned.data!.items.map((c) => (
                <li key={c.id} className="rounded-md border border-line px-3 py-2">
                  <p className="whitespace-pre-wrap text-ink">{c.title}</p>
                  <p className="text-xs text-ink-muted">
                    {c.actorName ?? '—'} · {formatDate(c.occurredAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={warn ? 'font-medium text-danger-700' : 'text-ink'}>{value}</div>
    </div>
  );
}

/** Team tab — who leads each stream (the stream service line's lead). */
export function StreamLeadsCard({ tabs }: { tabs: EngagementTabs }): JSX.Element | null {
  if (tabs.streams.length === 0) return null;
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Stream leads</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {tabs.streams.map((s) => (
            <li key={s.stream} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span className="font-medium">{STREAM_LABEL[s.stream as Stream] ?? s.stream}</span>
              <span className={s.leadName ? 'text-ink' : 'text-ink-muted'}>{s.leadName ?? 'No lead set'}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Services tab — which streams are in scope for each year (read-only here). */
export function ScopeByYearCard({ tabs }: { tabs: EngagementTabs }): JSX.Element | null {
  if (tabs.financialYears.length === 0) return null;
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Scope by year</CardTitle>
      </CardHeader>
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2 font-semibold">Year</th>
              {tabs.streams.map((s) => (
                <th key={s.stream} className="px-4 py-2 font-semibold">
                  {STREAM_LABEL[s.stream as Stream] ?? s.stream}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabs.financialYears.map((fy) => (
              <tr key={fy} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-medium">FY {fy}</td>
                {tabs.streams.map((s) => (
                  <td key={s.stream} className="px-4 py-2">
                    {s.financialYears.includes(fy) ? (
                      <span className="text-success-700">✓ in scope</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
