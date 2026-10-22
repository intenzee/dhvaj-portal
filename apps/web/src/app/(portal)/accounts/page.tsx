'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { FEATURE_FLAG, type AccountsDesk } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { cn } from '@/lib/cn';
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { barWidths, canReadAccounts, deskQueues, monthLabel } from '@/components/accounts/accounts';

/**
 * Accountant role · the Accounts desk (spec §3.4): this month's billing and
 * collections, what is outstanding, and today's work queues.
 */
export default function AccountsDeskPage(): JSX.Element {
  const { principal } = useAuth();
  const v2 = useFeatureFlags().isOn(FEATURE_FLAG.billing);
  const allowed = canReadAccounts(principal);

  const desk = useQuery({
    queryKey: ['billing', 'accounts-desk'],
    queryFn: () => apiFetch<AccountsDesk>('/accounts/desk'),
    enabled: v2 && allowed,
  });

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Accounts desk" />
        <EmptyState>You don’t have permission to view the firm’s billing.</EmptyState>
      </div>
    );
  }
  if (!v2) {
    return (
      <div>
        <PageHeader title="Accounts desk" />
        <EmptyState>The Accounts desk arrives with the new billing.</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Accounts desk"
        subtitle={
          desk.data
            ? `Billing and collections for ${monthLabel(desk.data.month.start.slice(0, 7))}, as of ${formatDate(desk.data.asOf)}.`
            : 'Billing and collections this month, and today’s work.'
        }
        actions={
          <div className="flex gap-2">
            <Link href="/billing/statements">
              <Button variant="secondary">Client statements</Button>
            </Link>
            <Link href="/billing">
              <Button variant="secondary">All invoices</Button>
            </Link>
          </div>
        }
      />
      {desk.isLoading && <Spinner />}
      {desk.error && (
        <EmptyState>
          {desk.error instanceof ApiError ? desk.error.message : 'Could not load the desk.'}
        </EmptyState>
      )}
      {desk.data && <Desk d={desk.data} />}
    </div>
  );
}

function Desk({ d }: { d: AccountsDesk }): JSX.Element {
  const queues = deskQueues(d.queues);
  const partnerBars = barWidths(d.byPartner.map((p) => p.outstanding));
  const monthBars = barWidths(d.collections.map((c) => c.amount));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Billed this month" value={d.kpis.billed} />
        <Kpi label="Collected this month" value={d.kpis.collected} tone="ok" />
        <Kpi label="Outstanding" value={d.kpis.outstanding} tone="warn" />
        <Kpi
          label="Over 90 days"
          value={d.kpis.over90}
          sub={`${d.kpis.over90Count} invoice${d.kpis.over90Count === 1 ? '' : 's'}`}
          tone={Number(d.kpis.over90) > 0 ? 'danger' : undefined}
          href="/billing/receivables"
        />
      </div>

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Today’s work</CardTitle>
        </CardHeader>
        {queues.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-faint">Nothing waiting. Every queue is clear.</p>
          </CardBody>
        ) : (
          <ul>
            {queues.map((q) => (
              <li key={q.key} className="border-b border-line last:border-0">
                <Link
                  href={q.href}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-raised"
                >
                  <span className="flex-1 text-ink">{q.label}</span>
                  <span className="font-semibold tabular-nums text-ink">{q.count}</span>
                  <ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Outstanding by partner</CardTitle>
            <Link href="/billing/receivables" className="text-xs text-primary-700 hover:underline">
              Receivables by age
            </Link>
          </CardHeader>
          <CardBody>
            {d.byPartner.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing outstanding.</p>
            ) : (
              <div className="space-y-1">
                {d.byPartner.map((p, i) => (
                  <Bar
                    key={p.partnerId ?? 'none'}
                    label={p.partnerName}
                    amount={p.outstanding}
                    pct={partnerBars[i] ?? 0}
                  />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Collections, last six months</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-1">
              {d.collections.map((c, i) => (
                <Bar key={c.month} label={monthLabel(c.month)} amount={c.amount} pct={monthBars[i] ?? 0} />
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warn' | 'danger';
  href?: string;
}): JSX.Element {
  const body = (
    <div className="h-full rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-ink-muted">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          tone === 'danger'
            ? 'text-danger-600'
            : tone === 'warn'
              ? 'text-warning-700'
              : tone === 'ok'
                ? 'text-success-700'
                : 'text-ink',
        )}
      >
        {formatMoney(value, 'INR')}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-faint">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function Bar({ label, amount, pct }: { label: string; amount: string; pct: number }): JSX.Element {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-32 shrink-0 truncate text-sm text-ink" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 shrink-0 text-right text-xs tabular-nums text-ink-muted">
        {formatMoney(amount, 'INR')}
      </span>
    </div>
  );
}
