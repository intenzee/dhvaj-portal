'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  PERMISSION,
  type ComplianceMisReport,
  type EngagementMisReport,
  type UtilisationReport,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { humanize, formatCount } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { cn } from '@/lib/cn';
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Spinner, EmptyState, Button, Badge } from '@/components/ui';

type Tab = 'engagements' | 'compliance' | 'utilisation';

export default function ReportsPage(): JSX.Element {
  const { principal } = useAuth();
  const [tab, setTab] = useState<Tab>('engagements');

  if (!can(principal, PERMISSION.reportRead)) {
    return (
      <div>
        <PageHeader title="Reports & MIS" />
        <EmptyState>You don’t have permission to view firm reports.</EmptyState>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'engagements', label: 'Engagements' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'utilisation', label: 'Utilisation' },
  ];

  return (
    <div>
      <PageHeader
        title="Reports & MIS"
        subtitle="Management rollups across everything you can see. Firm-wide for partners; scoped by the database."
      />
      <div className="mb-4 flex gap-1 border-b border-line-strong">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition',
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'engagements' && <EngagementsReport />}
      {tab === 'compliance' && <ComplianceReport />}
      {tab === 'utilisation' && <UtilisationReportView />}
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

function MetricTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warn' | 'danger' | 'success';
}): JSX.Element {
  const color =
    tone === 'danger'
      ? 'text-danger-600'
      : tone === 'warn'
        ? 'text-warning-700'
        : tone === 'success'
          ? 'text-success-700'
          : 'text-ink';
  return (
    <div className="rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div className={cn('mt-1 text-3xl font-bold tabular-nums', color)}>{formatCount(value)}</div>
    </div>
  );
}

function ExportButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      <Download className="h-4 w-4" /> Export CSV
    </Button>
  );
}

/** A horizontal bar row for a labelled count, scaled to the largest value. */
function BarRow({ label, count, max }: { label: string; count: number; max: number }): JSX.Element {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-40 shrink-0 truncate text-sm text-ink" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-ink">{count}</span>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

// ── Engagements ──────────────────────────────────────────────────────────────

function EngagementsReport(): JSX.Element {
  const q = useQuery({
    queryKey: ['reports', 'engagements'],
    queryFn: () => apiFetch<EngagementMisReport>('/reports/engagements'),
  });
  if (q.isLoading) return <Spinner label="Loading engagement MIS…" />;
  if (!q.data) return <EmptyState>No data.</EmptyState>;
  const r = q.data;
  const maxLine = Math.max(1, ...r.byServiceLine.map((x) => x.count));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Total" value={r.totals.total} />
        <MetricTile label="Active" value={r.totals.active} tone="success" />
        <MetricTile label="On hold" value={r.totals.onHold} tone="warn" />
        <MetricTile label="Completed" value={r.totals.completed} />
        <MetricTile label="Waiting for client" value={r.totals.waitingForClient} tone="warn" />
        <MetricTile label="Signed off" value={r.totals.signedOff} tone="success" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="By status"
          action={
            <ExportButton
              onClick={() =>
                downloadCsv('engagements-by-status', ['Status', 'Count'], r.byStatus.map((x) => [humanize(x.status), x.count]))
              }
            />
          }
        >
          {r.byStatus.length === 0 ? (
            <EmptyState>No engagements.</EmptyState>
          ) : (
            <div>
              {r.byStatus.map((x) => (
                <BarRow key={x.status} label={humanize(x.status)} count={x.count} max={Math.max(1, ...r.byStatus.map((s) => s.count))} />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="By service line"
          action={
            <ExportButton
              onClick={() =>
                downloadCsv('engagements-by-service-line', ['Service line', 'Count'], r.byServiceLine.map((x) => [x.serviceLine, x.count]))
              }
            />
          }
        >
          {r.byServiceLine.length === 0 ? (
            <EmptyState>No engagements.</EmptyState>
          ) : (
            <div>
              {r.byServiceLine.map((x) => (
                <BarRow key={x.serviceLine} label={x.serviceLine} count={x.count} max={maxLine} />
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section
        title="By Engagement Partner"
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(
                'engagements-by-partner',
                ['Partner', 'Active', 'Total'],
                r.byPartner.map((x) => [x.partnerName, x.active, x.total]),
              )
            }
          />
        }
      >
        {r.byPartner.length === 0 ? (
          <EmptyState>No engagements with an assigned partner.</EmptyState>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pr-4 font-semibold">Partner</th>
                  <th className="py-2 pr-4 font-semibold">Active</th>
                  <th className="py-2 pr-4 font-semibold">Total</th>
                  <th className="py-2 pr-4 font-semibold">Office share</th>
                </tr>
              </thead>
              <tbody>
                {r.byPartner.map((p) => (
                  <tr key={p.partnerId} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 font-medium text-ink">{p.partnerName}</td>
                    <td className="py-2 pr-4 tabular-nums">{p.active}</td>
                    <td className="py-2 pr-4 tabular-nums">{p.total}</td>
                    <td className="py-2 pr-4">
                      <Badge tone="info">{r.totals.total > 0 ? Math.round((p.total / r.totals.total) * 100) : 0}%</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Compliance ───────────────────────────────────────────────────────────────

function ComplianceReport(): JSX.Element {
  const q = useQuery({
    queryKey: ['reports', 'compliance'],
    queryFn: () => apiFetch<ComplianceMisReport>('/reports/compliance?dueSoonDays=30'),
  });
  if (q.isLoading) return <Spinner label="Loading compliance MIS…" />;
  if (!q.data) return <EmptyState>No data.</EmptyState>;
  const r = q.data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile label="Open" value={r.totals.open} />
        <MetricTile label="Overdue" value={r.totals.overdue} tone="danger" />
        <MetricTile label={`Due ≤ ${r.dueSoonWindowDays}d`} value={r.totals.dueSoon} tone="warn" />
        <MetricTile label="Completed" value={r.totals.completed} tone="success" />
        <MetricTile label="Waived" value={r.totals.waived} />
      </div>

      <Section
        title="By category"
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(
                'compliance-by-category',
                ['Category', 'Open', 'Overdue', `Due ≤ ${r.dueSoonWindowDays}d`],
                r.byCategory.map((x) => [humanize(x.category), x.open, x.overdue, x.dueSoon]),
              )
            }
          />
        }
      >
        {r.byCategory.length === 0 ? (
          <EmptyState>No compliance obligations in scope.</EmptyState>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pr-4 font-semibold">Category</th>
                  <th className="py-2 pr-4 font-semibold">Open</th>
                  <th className="py-2 pr-4 font-semibold">Overdue</th>
                  <th className="py-2 pr-4 font-semibold">Due ≤ {r.dueSoonWindowDays}d</th>
                </tr>
              </thead>
              <tbody>
                {r.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 font-medium text-ink">{humanize(c.category)}</td>
                    <td className="py-2 pr-4 tabular-nums">{c.open}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {c.overdue > 0 ? <span className="font-medium text-danger-600">{c.overdue}</span> : c.overdue}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {c.dueSoon > 0 ? <span className="font-medium text-warning-700">{c.dueSoon}</span> : c.dueSoon}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Utilisation ──────────────────────────────────────────────────────────────

function UtilisationReportView(): JSX.Element {
  const q = useQuery({
    queryKey: ['reports', 'utilisation'],
    queryFn: () => apiFetch<UtilisationReport>('/reports/utilisation'),
  });
  if (q.isLoading) return <Spinner label="Loading utilisation…" />;
  if (!q.data) return <EmptyState>No data.</EmptyState>;
  const rows = q.data.rows;

  return (
    <Section
      title="Workload by person"
      action={
        <ExportButton
          onClick={() =>
            downloadCsv(
              'utilisation',
              ['Employee', 'Grade', 'Office', 'As EP', 'As Manager', 'As Member', 'Open tasks', 'Overdue tasks'],
              rows.map((r) => [
                r.employeeName,
                r.gradeName ?? '',
                r.officeCode,
                r.asEp,
                r.asManager,
                r.asMember,
                r.openTasks,
                r.overdueTasks,
              ]),
            )
          }
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No workload to show in your scope.</EmptyState>
      ) : (
        <div className="scroll-slim overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pr-4 font-semibold">Employee</th>
                <th className="py-2 pr-4 font-semibold">Office</th>
                <th className="py-2 pr-4 font-semibold">EP</th>
                <th className="py-2 pr-4 font-semibold">Mgr</th>
                <th className="py-2 pr-4 font-semibold">Member</th>
                <th className="py-2 pr-4 font-semibold">Open tasks</th>
                <th className="py-2 pr-4 font-semibold">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-line last:border-0">
                  <td className="py-2 pr-4">
                    <span className="block font-medium text-ink">{r.employeeName}</span>
                    {r.gradeName && <span className="block text-xs text-ink-faint">{r.gradeName}</span>}
                  </td>
                  <td className="py-2 pr-4">{r.officeCode}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.asEp}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.asManager}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.asMember}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.openTasks}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {r.overdueTasks > 0 ? <span className="font-medium text-danger-600">{r.overdueTasks}</span> : r.overdueTasks}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
