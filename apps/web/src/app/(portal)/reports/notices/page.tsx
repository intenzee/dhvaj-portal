'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  FEATURE_FLAG,
  NOTICE_OUTCOME_LABEL,
  NOTICE_STATUS_LABEL,
  NOTICE_STREAM_LABEL,
  PERMISSION,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { downloadCsv } from '@/lib/csv';
import { formatCount, formatDate } from '@/lib/format';
import { fetchNoticesReport } from '@/lib/notices-api';
import { noticesReportCsv } from '@/lib/notices';
import type { OfficeRow } from '@/lib/types';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { Select } from '@/components/form';
import { DataTable } from '@/components/data-table';
import { money, noticeColumns, noticeHref } from '@/components/notices/notice-bits';

const dueColumns = noticeColumns();

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}): JSX.Element {
  return (
    <div className="rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-danger-600' : 'text-ink'}`}
      >
        {value}
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }): JSX.Element {
  if (rows.length === 0) return <EmptyState>Nothing to show.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
            {head.map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-semibold ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1.5 ${j > 0 ? 'text-right tabular-nums' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/** PS-105 — the firm's notice exposure for partners: open by stream, status and office; what closed for how much. */
export default function NoticesReportPage(): JSX.Element {
  const { principal } = useAuth();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.notices);
  const allowed = can(principal, PERMISSION.reportRead);
  const [officeId, setOfficeId] = useState('');
  const offices = useQuery({
    queryKey: ['admin', 'offices'],
    queryFn: () => apiFetch<OfficeRow[]>('/offices'),
    enabled: on && allowed,
  });
  const q = useQuery({
    queryKey: ['reports', 'notices', officeId],
    queryFn: () => fetchNoticesReport(officeId),
    enabled: on && allowed,
  });

  const back = { href: '/reports', label: 'Reports & MIS' };
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Notices report" back={back} />
        <EmptyState>You don’t have permission to view firm reports.</EmptyState>
      </div>
    );
  }
  if (!flags.isLoading && !on) {
    return (
      <div>
        <PageHeader title="Notices report" back={back} />
        <EmptyState>The notice register isn&rsquo;t switched on for your office yet.</EmptyState>
      </div>
    );
  }

  const r = q.data;
  const exportCsv = (): void => {
    if (!r) return;
    const { headers, rows } = noticesReportCsv(r);
    downloadCsv(`notices-report-${r.asOf.slice(0, 10)}`, headers, rows);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notices report"
        subtitle="Open exposure across the notices you can see, what falls due this week, and how closed notices ended."
        back={back}
        actions={
          <div className="flex items-center gap-2">
            <Select
              className="w-auto"
              aria-label="Office"
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
            >
              <option value="">Every office</option>
              {(offices.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!r}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        }
      />
      {q.isLoading && <Spinner />}
      {q.isError && (
        <EmptyState>Could not load the report. Check that the API is reachable.</EmptyState>
      )}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Open notices" value={formatCount(r.open.total)} />
            <Tile label="Open demand" value={money(r.open.amountDemanded)} />
            <Tile
              label="Due in 7 days"
              value={formatCount(r.dueSoon.length)}
              tone={r.dueSoon.length > 0 ? 'danger' : undefined}
            />
            <Tile
              label="Average days to reply"
              value={
                r.avgDaysToReply == null ? '—' : String(Math.round(r.avgDaysToReply * 10) / 10)
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Section title="Open by stream">
              <Table
                head={['Stream', 'Count', 'Demand']}
                rows={r.open.byStream.map((s) => [
                  NOTICE_STREAM_LABEL[s.stream] ?? s.stream,
                  formatCount(s.count),
                  money(s.amountDemanded),
                ])}
              />
            </Section>
            <Section title="Open by status">
              <Table
                head={['Status', 'Count']}
                rows={r.open.byStatus.map((s) => [
                  NOTICE_STATUS_LABEL[s.status] ?? s.status,
                  formatCount(s.count),
                ])}
              />
            </Section>
            <Section title="Open by office">
              <Table
                head={['Office', 'Count', 'Demand']}
                rows={r.open.byOffice.map((o) => [
                  o.officeName,
                  formatCount(o.count),
                  money(o.amountDemanded),
                ])}
              />
            </Section>
          </div>

          <Section title={`Due in the next 7 days (${r.dueSoon.length})`}>
            <DataTable
              columns={dueColumns}
              data={r.dueSoon}
              rowHref={noticeHref}
              empty="Nothing falls due in the next 7 days."
            />
          </Section>

          <Section title={`Closed notices (${formatCount(r.closed.count)})`}>
            <Table
              head={['Outcome', 'Count', 'Demanded', 'Final amount']}
              rows={[
                ...r.closed.byOutcome.map((o) => [
                  NOTICE_OUTCOME_LABEL[o.outcome] ?? o.outcome,
                  formatCount(o.count),
                  money(o.amountDemanded),
                  money(o.outcomeAmount),
                ]),
                ...(r.closed.count > 0
                  ? [
                      [
                        <span key="t" className="font-semibold">
                          Total
                        </span>,
                        <span key="c" className="font-semibold">
                          {formatCount(r.closed.count)}
                        </span>,
                        <span key="d" className="font-semibold">
                          {money(r.closed.amountDemanded)}
                        </span>,
                        <span key="o" className="font-semibold">
                          {money(r.closed.outcomeAmount)}
                        </span>,
                      ],
                    ]
                  : []),
              ]}
            />
          </Section>
          <p className="text-xs text-ink-faint">
            As of {formatDate(r.asOf)}. Scoped to the engagements you can see.
          </p>
        </>
      )}
    </div>
  );
}
