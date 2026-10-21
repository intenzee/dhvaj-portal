'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FEATURE_FLAG, type ApprovalItem, type InvoiceIssueRequest } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import {
  APPROVAL_KIND_LABEL,
  APPROVAL_STATUS,
  canReadAccounts,
  mayWithdraw,
} from '@/components/accounts/accounts';

type Scope = 'mine' | 'all';
type Status = 'pending' | 'recent';

/**
 * Accountant role · Approvals sent (spec §3.4): credit notes, write-offs, fee
 * waivers and ad-hoc invoices waiting on a partner, and how recent ones ended.
 */
export default function ApprovalsPage(): JSX.Element {
  const { principal } = useAuth();
  const v2 = useFeatureFlags().isOn(FEATURE_FLAG.billing);
  if (!canReadAccounts(principal)) {
    return (
      <div>
        <PageHeader title="Approvals sent" />
        <EmptyState>You don’t have permission to view the firm’s billing.</EmptyState>
      </div>
    );
  }
  if (!v2) {
    return (
      <div>
        <PageHeader title="Approvals sent" />
        <EmptyState>Approvals arrive with the new billing.</EmptyState>
      </div>
    );
  }
  return (
    <Suspense fallback={<Spinner />}>
      <Approvals />
    </Suspense>
  );
}

function Approvals(): JSX.Element {
  const params = useSearchParams();
  const [scope, setScope] = useState<Scope>(params.get('scope') === 'all' ? 'all' : 'mine');
  const [status, setStatus] = useState<Status>(params.get('status') === 'recent' ? 'recent' : 'pending');

  const list = useQuery({
    queryKey: ['billing', 'approvals', scope, status],
    queryFn: () => apiFetch<ApprovalItem[]>(`/billing/approvals?scope=${scope}&status=${status}`),
  });

  return (
    <div>
      <PageHeader
        title="Approvals sent"
        subtitle="What a partner has to decide: credit notes, write-offs, fee waivers and invoices with an ad-hoc line."
        back={{ href: '/accounts', label: 'Accounts desk' }}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip label="Asked by me" active={scope === 'mine'} onClick={() => setScope('mine')} />
        <Chip label="Everyone’s" active={scope === 'all'} onClick={() => setScope('all')} />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Chip label="Waiting" active={status === 'pending'} onClick={() => setStatus('pending')} />
        <Chip label="Last 30 days" active={status === 'recent'} onClick={() => setStatus('recent')} />
      </div>
      <Card className="p-0">
        {list.isLoading && (
          <div className="p-4">
            <Spinner />
          </div>
        )}
        {list.error && (
          <div className="p-4 text-sm text-danger-700">
            {list.error instanceof ApiError ? list.error.message : 'Could not load the approvals.'}
          </div>
        )}
        {list.data && list.data.length === 0 && (
          <p className="p-4 text-sm text-ink-faint">
            {status === 'pending' ? 'Nothing waiting on a partner.' : 'Nothing in the last 30 days.'}
          </p>
        )}
        {list.data && list.data.length > 0 && (
          <ul>
            {list.data.map((a) => (
              <ApprovalRow key={`${a.kind}-${a.id}`} a={a} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ApprovalRow({ a }: { a: ApprovalItem }): JSX.Element {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const withdraw = useMutation({
    mutationFn: () =>
      apiFetch<InvoiceIssueRequest>(`/billing/issue-requests/${a.id}/withdraw`, { method: 'POST' }),
    onSuccess: () => {
      toast('Request taken back.');
      void qc.invalidateQueries({ queryKey: ['billing', 'approvals'] });
      void qc.invalidateQueries({ queryKey: ['billing', 'accounts-desk'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not take it back.', 'error'),
  });
  const st = APPROVAL_STATUS[a.status];

  return (
    <li className="border-b border-line px-4 py-3 text-sm last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-ink">{APPROVAL_KIND_LABEL[a.kind]}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <Link href={`/billing/statements/${a.clientId}`} className="text-primary-700 hover:underline">
          {a.clientName}
        </Link>
        {a.invoiceNumber && <span className="tabular-nums text-ink-muted">{a.invoiceNumber}</span>}
        <span className="ml-auto font-medium tabular-nums text-ink">{formatMoney(a.amount, 'INR')}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-ink-faint">
        <span>
          Asked {a.requestedByName ? `by ${a.requestedByName}, ` : ''}
          {formatDate(a.at)}
        </span>
        {a.decidedAt && (
          <span>
            {st.label}
            {a.decidedByName ? ` by ${a.decidedByName}` : ''}, {formatDate(a.decidedAt)}
          </span>
        )}
        <Link href={`/billing/engagements/${a.engagementId}`} className="text-primary-700 hover:underline">
          Engagement
        </Link>
      </div>
      {a.reason && <p className="mt-1 text-ink-muted">{a.reason}</p>}
      {a.decisionNote && <p className="mt-1 text-ink-muted">Partner: {a.decisionNote}</p>}
      {mayWithdraw(a, principal?.employeeId) && (
        <div className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
            Take back
          </Button>
        </div>
      )}
    </li>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised',
      )}
    >
      {label}
    </button>
  );
}
